import { useMemo, useState } from 'react'
import { ImageUploader } from './components/ImageUploader'
import { CanvasView } from './components/CanvasView'
import { DemosaicPlayer } from './components/DemosaicPlayer'
import { ImageViewer } from './components/ImageViewer'
import {
  type BayerResult,
  type BayerPattern,
  rgbToBayer,
  bayerToColorVisualization,
  bayerToGrayscale,
} from './lib/bayer'
import { type RawMetadata } from './lib/raw-loader'

type ViewTab = 'mosaic-gray' | 'mosaic-color' | 'demosaic'

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export default function App() {
  const [originalImage, setOriginalImage] = useState<ImageData | null>(null)
  const [processedImage, setProcessedImage] = useState<ImageData | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [bayer, setBayer] = useState<BayerResult | null>(null)
  const [pattern, setPattern] = useState<BayerPattern>('RGGB')
  const [activeTab, setActiveTab] = useState<ViewTab>('mosaic-color')
  const [isRaw, setIsRaw] = useState(false)
  const [rawMeta, setRawMeta] = useState<RawMetadata | null>(null)

  // 查看器状态
  const [viewerImage, setViewerImage] = useState<ImageData | null>(null)
  const [viewerTitle, setViewerTitle] = useState<string>('')

  const handleImageLoaded = (imageData: ImageData, name: string) => {
    setOriginalImage(imageData)
    setProcessedImage(null)
    setFileName(name)
    setIsRaw(false)
    setRawMeta(null)
    const bayerResult = rgbToBayer(imageData, pattern)
    setBayer(bayerResult)
    setActiveTab('mosaic-color')
  }

  const handleRawLoaded = (
    bayerResult: BayerResult,
    processed: ImageData,
    metadata: RawMetadata,
    name: string
  ) => {
    setOriginalImage(null)
    setProcessedImage(processed)
    setFileName(name)
    setIsRaw(true)
    setRawMeta(metadata)
    setBayer(bayerResult)
    setPattern(bayerResult.pattern)
    setActiveTab('mosaic-color')
  }

  const handlePatternChange = (newPattern: BayerPattern) => {
    setPattern(newPattern)
    if (!isRaw && originalImage) {
      const bayerResult = rgbToBayer(originalImage, newPattern)
      setBayer(bayerResult)
    } else if (isRaw && processedImage) {
      const bayerResult = rgbToBayer(processedImage, newPattern)
      setBayer(bayerResult)
    }
  }

  const handleReset = () => {
    setBayer(null)
    setOriginalImage(null)
    setProcessedImage(null)
    setIsRaw(false)
    setRawMeta(null)
  }

  const openViewer = (imageData: ImageData | null, title: string) => {
    if (!imageData) return
    setViewerImage(imageData)
    setViewerTitle(title)
  }

  const tabs: { id: ViewTab; label: string }[] = [
    { id: 'mosaic-gray', label: '原始传感器数据' },
    { id: 'mosaic-color', label: 'Bayer 彩色马赛克' },
    { id: 'demosaic', label: '解拜耳演示' },
  ]

  const baseName = fileName ? stripExt(fileName) : 'image'

  // 缓存可视化结果，避免每次渲染都重算
  const grayscaleViz = useMemo(
    () => (bayer ? bayerToGrayscale(bayer) : null),
    [bayer]
  )
  const colorViz = useMemo(
    () => (bayer ? bayerToColorVisualization(bayer) : null),
    [bayer]
  )

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-green-400">De</span>
              <span className="text-red-400">De</span>
              <span className="text-blue-400">Bayer</span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Bayer 滤色阵列与解拜耳算法可视化
            </p>
          </div>
          {bayer && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Bayer 模式:</label>
              <select
                value={pattern}
                onChange={(e) => handlePatternChange(e.target.value as BayerPattern)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm
                           focus:outline-none focus:border-green-500"
              >
                <option value="RGGB">RGGB</option>
                <option value="BGGR">BGGR</option>
                <option value="GRBG">GRBG</option>
                <option value="GBRG">GBRG</option>
              </select>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {!bayer ? (
            <div className="flex flex-col items-center gap-8 py-12">
              <div className="text-center max-w-md">
                <h2 className="text-xl font-semibold mb-2">上传一张图片</h2>
                <p className="text-gray-400 text-sm">
                  支持 RAW 文件（NEF/CR2/ARW/DNG 等）和普通图片（JPEG/PNG）。
                  上传后可以观察 Bayer 滤色阵列的样貌，以及多种解拜耳算法如何还原彩色图像。
                </p>
              </div>
              <ImageUploader
                onImageLoaded={handleImageLoaded}
                onRawLoaded={handleRawLoaded}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm text-gray-400">
                  {isRaw ? '📷' : '🖼️'} {fileName} · {bayer.width}×{bayer.height} · {pattern}
                  {isRaw && rawMeta && (
                    <span className="ml-2 text-gray-600">
                      {rawMeta.make} {rawMeta.model} · {rawMeta.format}
                      {rawMeta.sensorWidth > 0 && (
                        <> · 传感器 {rawMeta.sensorWidth}×{rawMeta.sensorHeight}</>
                      )}
                    </span>
                  )}
                  {isRaw && (
                    <span className="ml-2 inline-block px-2 py-0.5 bg-green-900/50 text-green-400 text-xs rounded">
                      RAW 内嵌预览
                    </span>
                  )}
                  {!isRaw && (
                    <span className="ml-2 inline-block px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded">
                      模拟 Bayer
                    </span>
                  )}
                </div>
                <button
                  onClick={handleReset}
                  className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  ← 重新选择图片
                </button>
              </div>

              {isRaw && rawMeta && rawMeta.sensorWidth > rawMeta.previewWidth && (
                <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg px-4 py-2 text-xs text-blue-300">
                  ℹ️ 真实传感器分辨率为 {rawMeta.sensorWidth}×{rawMeta.sensorHeight}，
                  RAW 文件中嵌入的最大 JPEG 预览为 {rawMeta.previewWidth}×{rawMeta.previewHeight}（相机决定）。
                  解码 14bit 原始传感器数据需要 LibRaw 等专门的解码库。
                </div>
              )}

              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-300">
                  {isRaw ? '展开查看 RAW 内嵌的完整图像' : '展开查看原图'}
                </summary>
                <div className="mt-3 flex justify-center">
                  <CanvasView
                    imageData={isRaw ? processedImage : originalImage}
                    label={isRaw ? 'RAW 内嵌的全尺寸 JPEG 预览' : '原始 RGB 图像'}
                    downloadName={`${baseName}_original.png`}
                    onImageClick={() =>
                      openViewer(isRaw ? processedImage : originalImage, '原图')
                    }
                  />
                </div>
              </details>

              <div className="flex gap-1 bg-gray-900 rounded-lg p-1 self-center">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-center">
                {activeTab === 'mosaic-gray' && (
                  <CanvasView
                    imageData={grayscaleViz}
                    label="传感器原始数据（灰度）— 每个像素只记录了一个颜色通道的亮度"
                    downloadName={`${baseName}_bayer_grayscale.png`}
                    onImageClick={() => openViewer(grayscaleViz, '传感器原始数据（灰度）')}
                  />
                )}
                {activeTab === 'mosaic-color' && (
                  <CanvasView
                    imageData={colorViz}
                    label="Bayer 彩色马赛克 — 红/绿/蓝滤色片下的实际采样（点击查看大图）"
                    downloadName={`${baseName}_bayer_color.png`}
                    onImageClick={() => openViewer(colorViz, 'Bayer 彩色马赛克')}
                  />
                )}
                {activeTab === 'demosaic' && (
                  <DemosaicPlayer bayer={bayer} fileBaseName={baseName} />
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        DeDeBayer — 纯前端实现，所有计算在浏览器本地完成，图片不会上传到任何服务器
      </footer>

      {/* 全屏图片查看器 */}
      {viewerImage && (
        <ImageViewer
          imageData={viewerImage}
          title={viewerTitle}
          onClose={() => setViewerImage(null)}
        />
      )}
    </div>
  )
}
