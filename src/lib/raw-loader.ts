/**
 * RAW 文件加载器
 *
 * 通过解析 TIFF 结构（NEF/CR2/ARW/DNG 都基于 TIFF）找到内嵌的全尺寸 JPEG 预览，
 * 并正确读取 EXIF orientation，避免竖屏照片显示成横屏。
 *
 * 注意：内嵌 JPEG 的尺寸由相机决定，通常小于真实传感器尺寸。
 * 真正的全尺寸传感器数据需要解码 RAW 压缩数据本身（这需要 WASM 库），
 * 这里使用内嵌 JPEG 作为合理的演示替代品。
 */

import { type BayerPattern, type BayerResult, rgbToBayer } from './bayer'
import { parseRaw, applyOrientation } from './tiff-parser'

export const RAW_EXTENSIONS = [
  '.nef', '.cr2', '.cr3', '.arw', '.dng', '.orf', '.rw2',
  '.raf', '.pef', '.srw', '.x3f', '.3fr', '.rwl', '.raw',
]

export function isRawFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
  return RAW_EXTENSIONS.includes(ext)
}

export interface RawMetadata {
  /** 提取的 JPEG 预览的最终（旋转后）尺寸 */
  width: number
  height: number
  /** 真实传感器全尺寸 */
  sensorWidth: number
  sensorHeight: number
  /** 内嵌预览原始尺寸（旋转前） */
  previewWidth: number
  previewHeight: number
  make: string
  model: string
  format: string
  orientation: number
  /** 检测到的 Bayer 模式 */
  pattern: BayerPattern
  /** 文件中找到的 JPEG 预览数量 */
  numPreviews: number
}

/**
 * 把内嵌的 JPEG bytes 解码为 ImageBitmap，应用 orientation，可选下采样
 */
async function decodePreview(
  jpegBytes: Uint8Array,
  orientation: number,
  maxSize: number | null
): Promise<{ imageData: ImageData; previewW: number; previewH: number }> {
  const blob = new Blob([new Uint8Array(jpegBytes)], { type: 'image/jpeg' })
  const bitmap = await createImageBitmap(blob)
  const previewW = bitmap.width
  const previewH = bitmap.height

  // 1. 应用 orientation 旋转
  const { canvas: rotatedCanvas, width: rW, height: rH } = applyOrientation(bitmap, orientation)
  bitmap.close()

  // 2. 可选下采样
  let finalW = rW
  let finalH = rH
  if (maxSize !== null && (rW > maxSize || rH > maxSize)) {
    const scale = maxSize / Math.max(rW, rH)
    finalW = Math.round(rW * scale)
    finalH = Math.round(rH * scale)
  }

  // 3. 确保宽高为偶数
  finalW = finalW - (finalW % 2)
  finalH = finalH - (finalH % 2)

  let imageData: ImageData
  if (finalW === rW && finalH === rH) {
    const ctx = rotatedCanvas.getContext('2d')!
    imageData = ctx.getImageData(0, 0, finalW, finalH)
  } else {
    const downCanvas = new OffscreenCanvas(finalW, finalH)
    const downCtx = downCanvas.getContext('2d')!
    downCtx.imageSmoothingEnabled = true
    downCtx.imageSmoothingQuality = 'high'
    downCtx.drawImage(rotatedCanvas, 0, 0, finalW, finalH)
    imageData = downCtx.getImageData(0, 0, finalW, finalH)
  }

  return { imageData, previewW, previewH }
}

/**
 * 加载 RAW 文件
 *
 * @param fileBuffer RAW 文件二进制
 * @param maxSize 最大边长（像素），传 null 保持预览原尺寸
 */
export async function loadRawFile(
  fileBuffer: ArrayBuffer,
  maxSize: number | null = null
): Promise<{
  bayer: BayerResult
  metadata: RawMetadata
  processedImage: ImageData
}> {
  const data = new Uint8Array(fileBuffer)
  const info = parseRaw(data)

  if (info.jpegs.length === 0) {
    throw new Error('未在 RAW 文件中找到内嵌 JPEG 预览')
  }

  // 选最大的 JPEG
  const best = info.jpegs[0]!
  const jpegBytes = data.slice(best.offset, best.offset + best.length)

  const { imageData, previewW, previewH } = await decodePreview(
    jpegBytes,
    info.orientation,
    maxSize
  )

  // CFA Pattern 默认 RGGB（绝大多数民用相机）
  const pattern: BayerPattern = 'RGGB'

  const bayer = rgbToBayer(imageData, pattern)

  // 根据品牌确定文件格式
  const format = detectFormat(info.make)

  // 根据 orientation 调整传感器尺寸的方向
  const swap = info.orientation >= 5 && info.orientation <= 8
  const sensorW = swap ? info.sensorHeight : info.sensorWidth
  const sensorH = swap ? info.sensorWidth : info.sensorHeight

  const metadata: RawMetadata = {
    width: imageData.width,
    height: imageData.height,
    sensorWidth: sensorW,
    sensorHeight: sensorH,
    previewWidth: previewW,
    previewHeight: previewH,
    make: info.make || 'Unknown',
    model: info.model || 'Unknown',
    format,
    orientation: info.orientation,
    pattern,
    numPreviews: info.jpegs.length,
  }

  return { bayer, metadata, processedImage: imageData }
}

function detectFormat(make: string): string {
  const m = make.toUpperCase()
  if (m.includes('NIKON')) return 'NEF'
  if (m.includes('CANON')) return 'CR2/CR3'
  if (m.includes('SONY')) return 'ARW'
  if (m.includes('OLYMPUS')) return 'ORF'
  if (m.includes('PANASONIC')) return 'RW2'
  if (m.includes('FUJIFILM') || m.includes('FUJI')) return 'RAF'
  if (m.includes('PENTAX')) return 'PEF'
  return 'RAW'
}
