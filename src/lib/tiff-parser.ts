/**
 * 极简 TIFF / NEF / CR2 / DNG 解析器
 *
 * 这些 RAW 格式都基于 TIFF 6.0 结构。我们只需读取必要的标签：
 *  - 各级 IFD（包括 SubIFDs）
 *  - 内嵌 JPEG 预览（JPEGInterchangeFormat / JPEGInterchangeFormatLength）
 *  - 主图尺寸、Orientation、Make/Model
 *  - CFAPattern（Bayer 排列）
 *  - 真实传感器尺寸（在 SubIFD 中）
 */

/**
 * 读取 JPEG 的 SOF 标记，验证并获取真实尺寸
 * 返回 null 表示这不是有效的 baseline/extended JPEG
 */
function getJpegDimensions(data: Uint8Array, offset: number, length: number): { w: number; h: number } | null {
  const end = Math.min(offset + length, data.length)
  // 必须以 FFD8FF 开头
  if (data[offset] !== 0xFF || data[offset + 1] !== 0xD8 || data[offset + 2] !== 0xFF) {
    return null
  }
  // 寻找 SOF0/SOF1/SOF2 (FFC0/FFC1/FFC2) — 跳过其他 marker
  let i = offset + 2
  while (i < end - 9) {
    if (data[i] !== 0xFF) {
      i++
      continue
    }
    const marker = data[i + 1]!
    // SOF 标记
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      const h = (data[i + 5]! << 8) | data[i + 6]!
      const w = (data[i + 7]! << 8) | data[i + 8]!
      return { w, h }
    }
    // 跳过 padding
    if (marker === 0xFF) {
      i++
      continue
    }
    // SOI/EOI/RSTn 没有长度
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2
      continue
    }
    // 其他 marker 后跟 2 字节长度
    if (i + 4 >= end) return null
    const segLen = (data[i + 2]! << 8) | data[i + 3]!
    if (segLen < 2) return null
    i += 2 + segLen
  }
  return null
}

const TAG = {
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  PhotometricInterpretation: 262,
  Make: 271,
  Model: 272,
  StripOffsets: 273,
  Orientation: 274,
  StripByteCounts: 279,
  SubIFDs: 330,
  JPEGInterchangeFormat: 513,
  JPEGInterchangeFormatLength: 514,
  CFARepeatPatternDim: 33421,
  CFAPattern: 33422,
  ExifIFD: 34665,
} as const

const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

interface TiffEntry {
  tag: number
  type: number
  count: number
  /** 原始 valueOrOffset 字段 */
  raw: number
  /** 实际数据偏移（如果数据放在 IFD 外）*/
  offset: number
  /** 数据大小（字节）*/
  size: number
}

interface TiffIFD {
  entries: Map<number, TiffEntry>
  nextIFDOffset: number
}

export interface RawJpegPreview {
  offset: number
  length: number
  source: string
  /** 真实像素宽 */
  width: number
  /** 真实像素高 */
  height: number
}

export interface RawInfo {
  /** 字节序 (true = little endian) */
  littleEndian: boolean
  /** 顶层 IFD0 */
  ifd0: TiffIFD
  /** 所有 SubIFDs */
  subIFDs: TiffIFD[]
  /** 找到的所有 JPEG 预览（按尺寸降序） */
  jpegs: RawJpegPreview[]
  /** 真实传感器尺寸 */
  sensorWidth: number
  sensorHeight: number
  /** EXIF Orientation (1-8)，1 = 不旋转 */
  orientation: number
  /** 相机品牌 */
  make: string
  /** 相机型号 */
  model: string
}

class TiffReader {
  data: Uint8Array
  view: DataView
  littleEndian: boolean

  constructor(data: Uint8Array) {
    this.data = data
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const byteOrder = String.fromCharCode(data[0]!, data[1]!)
    this.littleEndian = byteOrder === 'II'
    if (byteOrder !== 'II' && byteOrder !== 'MM') {
      throw new Error('不是有效的 TIFF/RAW 文件')
    }
    const magic = this.u16(2)
    if (magic !== 42) {
      throw new Error(`无效的 TIFF magic: ${magic}`)
    }
  }

  u16(o: number): number { return this.view.getUint16(o, this.littleEndian) }
  u32(o: number): number { return this.view.getUint32(o, this.littleEndian) }

  /** 读取以零结尾的 ASCII 字符串 */
  readString(offset: number, count: number): string {
    let end = offset + count
    while (end > offset && this.data[end - 1] === 0) end--
    return new TextDecoder('ascii', { fatal: false }).decode(this.data.slice(offset, end))
  }

  parseIFD(offset: number): TiffIFD {
    if (offset === 0 || offset + 2 > this.data.length) {
      return { entries: new Map(), nextIFDOffset: 0 }
    }
    const numEntries = this.u16(offset)
    const entries = new Map<number, TiffEntry>()

    for (let i = 0; i < numEntries; i++) {
      const e = offset + 2 + i * 12
      if (e + 12 > this.data.length) break
      const tag = this.u16(e)
      const type = this.u16(e + 2)
      const count = this.u32(e + 4)
      const raw = this.u32(e + 8)
      const size = (TYPE_SIZES[type] ?? 0) * count
      const dataOffset = size <= 4 ? e + 8 : raw
      entries.set(tag, { tag, type, count, raw, offset: dataOffset, size })
    }

    const nextOffset = offset + 2 + numEntries * 12
    const nextIFDOffset = nextOffset + 4 <= this.data.length ? this.u32(nextOffset) : 0

    return { entries, nextIFDOffset }
  }

  /** 读取标签的整数值（支持 SHORT/LONG） */
  getInt(ifd: TiffIFD, tag: number): number | null {
    const e = ifd.entries.get(tag)
    if (!e) return null
    if (e.type === 3 && e.count === 1) {
      // SHORT，存在 raw 的低 16 位
      return e.size <= 4 ? (e.raw & 0xFFFF) : this.u16(e.offset)
    }
    if (e.type === 4 && e.count === 1) {
      return e.raw
    }
    return null
  }

  getString(ifd: TiffIFD, tag: number): string | null {
    const e = ifd.entries.get(tag)
    if (!e || e.type !== 2) return null
    return this.readString(e.offset, e.count)
  }
}

/**
 * 解析 RAW 文件结构，提取所有可用的 JPEG 预览和元信息
 */
export function parseRaw(data: Uint8Array): RawInfo {
  const reader = new TiffReader(data)
  const ifd0Offset = reader.u32(4)
  const ifd0 = reader.parseIFD(ifd0Offset)

  // 解析所有 SubIFDs
  const subIFDs: TiffIFD[] = []
  const subIFDsEntry = ifd0.entries.get(TAG.SubIFDs)
  if (subIFDsEntry) {
    for (let i = 0; i < subIFDsEntry.count; i++) {
      const offset = reader.u32(subIFDsEntry.offset + i * 4)
      subIFDs.push(reader.parseIFD(offset))
    }
  }

  // 收集所有 JPEG 预览：从 IFD0、SubIFDs 中查找
  const jpegs: RawJpegPreview[] = []
  const allIFDs = [ifd0, ...subIFDs]
  let next = ifd0.nextIFDOffset
  while (next > 0 && next < data.length) {
    const ifd = reader.parseIFD(next)
    allIFDs.push(ifd)
    next = ifd.nextIFDOffset
    if (allIFDs.length > 10) break
  }

  for (let i = 0; i < allIFDs.length; i++) {
    const ifd = allIFDs[i]!
    const offset = reader.getInt(ifd, TAG.JPEGInterchangeFormat)
    const length = reader.getInt(ifd, TAG.JPEGInterchangeFormatLength)
    if (offset !== null && length !== null && length > 1024) {
      // 验证 JPEG 并读取真实尺寸
      const dims = getJpegDimensions(data, offset, length)
      if (dims && dims.w > 0 && dims.h > 0) {
        jpegs.push({
          offset, length,
          source: i === 0 ? 'IFD0' : `SubIFD${i - 1}`,
          width: dims.w, height: dims.h,
        })
      }
    }
  }

  // 兜底：如果 IFD 里没找到，做一次全文件扫描
  if (jpegs.length === 0) {
    for (let i = 0; i < data.length - 2; i++) {
      if (data[i] === 0xFF && data[i + 1] === 0xD8 && data[i + 2] === 0xFF) {
        for (let j = i + 3; j < data.length - 1; j++) {
          if (data[j] === 0xFF && data[j + 1] === 0xD9) {
            const length = j - i + 2
            if (length > 100 * 1024) {
              const dims = getJpegDimensions(data, i, length)
              if (dims && dims.w > 0 && dims.h > 0) {
                jpegs.push({ offset: i, length, source: 'scan', width: dims.w, height: dims.h })
              }
            }
            break
          }
        }
      }
    }
  }

  // 按像素总数（宽×高）降序：选最大分辨率的预览
  jpegs.sort((a, b) => b.width * b.height - a.width * a.height)

  // 查找真实传感器尺寸：通常在某个 SubIFD 中（PhotometricInterpretation = 32803 即 CFA）
  let sensorWidth = reader.getInt(ifd0, TAG.ImageWidth) ?? 0
  let sensorHeight = reader.getInt(ifd0, TAG.ImageLength) ?? 0
  for (const sub of subIFDs) {
    const photo = reader.getInt(sub, TAG.PhotometricInterpretation)
    if (photo === 32803) { // CFA
      sensorWidth = reader.getInt(sub, TAG.ImageWidth) ?? sensorWidth
      sensorHeight = reader.getInt(sub, TAG.ImageLength) ?? sensorHeight
      break
    }
    // 也接受最大的 ImageWidth 作为备选
    const w = reader.getInt(sub, TAG.ImageWidth) ?? 0
    const h = reader.getInt(sub, TAG.ImageLength) ?? 0
    if (w > sensorWidth) {
      sensorWidth = w
      sensorHeight = h
    }
  }

  const orientation = reader.getInt(ifd0, TAG.Orientation) ?? 1
  const make = (reader.getString(ifd0, TAG.Make) ?? '').trim()
  const model = (reader.getString(ifd0, TAG.Model) ?? '').trim()

  return {
    littleEndian: reader.littleEndian,
    ifd0,
    subIFDs,
    jpegs,
    sensorWidth,
    sensorHeight,
    orientation,
    make,
    model,
  }
}

/**
 * 根据 EXIF Orientation 应用旋转/翻转到 ImageBitmap
 * 1 = 不变, 3 = 180°, 6 = 顺时针 90°, 8 = 逆时针 90°
 * 2/4/5/7 = 镜像变体（少见）
 */
export function applyOrientation(
  bitmap: ImageBitmap,
  orientation: number
): { canvas: OffscreenCanvas; width: number; height: number } {
  const w = bitmap.width
  const h = bitmap.height

  // 旋转 90/270 度时宽高互换
  const swap = orientation >= 5 && orientation <= 8
  const outW = swap ? h : w
  const outH = swap ? w : h

  const canvas = new OffscreenCanvas(outW, outH)
  const ctx = canvas.getContext('2d')!

  ctx.save()
  switch (orientation) {
    case 2: // 水平镜像
      ctx.translate(outW, 0)
      ctx.scale(-1, 1)
      break
    case 3: // 180°
      ctx.translate(outW, outH)
      ctx.rotate(Math.PI)
      break
    case 4: // 垂直镜像
      ctx.translate(0, outH)
      ctx.scale(1, -1)
      break
    case 5: // 顺时针 90° + 水平镜像
      ctx.rotate(0.5 * Math.PI)
      ctx.scale(1, -1)
      break
    case 6: // 顺时针 90°
      ctx.translate(outW, 0)
      ctx.rotate(0.5 * Math.PI)
      break
    case 7: // 逆时针 90° + 水平镜像
      ctx.rotate(-0.5 * Math.PI)
      ctx.translate(-outW, outH)
      ctx.scale(1, -1)
      break
    case 8: // 逆时针 90°
      ctx.translate(0, outH)
      ctx.rotate(-0.5 * Math.PI)
      break
    case 1:
    default:
      // 不变换
      break
  }
  ctx.drawImage(bitmap, 0, 0)
  ctx.restore()

  return { canvas, width: outW, height: outH }
}
