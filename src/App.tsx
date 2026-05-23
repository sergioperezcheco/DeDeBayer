import { useMemo, useState, useEffect } from 'react'
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
import { type Theme, getInitialTheme, applyTheme } from './lib/theme'

type ViewTab = 'mosaic-gray' | 'mosaic-color' | 'demosaic'

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
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

  // 初始化主题
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  }

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
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-green-600 dark:text-green-400">De</span>
              <span className="text-red-600 dark:text-red-400">De</span>
              <span className="text-blue-600 dark:text-blue-400">Bayer</span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Bayer 滤色阵列与解拜耳算法可视化
            </p>
          </div>
          <div className="flex items-center gap-3">
            {bayer && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Bayer 模式:</label>
                <select
                  value={pattern}
                  onChange={(e) => handlePatternChange(e.target.value as BayerPattern)}
                  className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700
                             rounded px-2 py-1 text-sm focus:outline-none focus:border-green-500"
                >
                  <option value="RGGB">RGGB</option>
                  <option value="BGGR">BGGR</option>
                  <option value="GRBG">GRBG</option>
                  <option value="GBRG">GBRG</option>
                </select>
              </div>
            )}
            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100
                         hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={theme === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
            >
              {theme === 'light' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>
            {/* GitHub 链接 */}
            <a
              href="https://github.com/sergioperezcheco/DeDeBayer"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100
                         hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {!bayer ? (
            <div className="flex flex-col items-center gap-8 py-12">
              <div className="text-center max-w-md">
                <h2 className="text-xl font-semibold mb-2">上传一张图片</h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
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
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {isRaw ? '📷' : '🖼️'} {fileName} · {bayer.width}×{bayer.height} · {pattern}
                  {isRaw && rawMeta && (
                    <span className="ml-2 text-gray-500 dark:text-gray-600">
                      {rawMeta.make} {rawMeta.model} · {rawMeta.format}
                      {rawMeta.sensorWidth > 0 && (
                        <> · 传感器 {rawMeta.sensorWidth}×{rawMeta.sensorHeight}</>
                      )}
                    </span>
                  )}
                  {isRaw && (
                    <span className="ml-2 inline-block px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 text-xs rounded">
                      RAW 内嵌预览
                    </span>
                  )}
                  {!isRaw && (
                    <span className="ml-2 inline-block px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 text-xs rounded">
                      模拟 Bayer
                    </span>
                  )}
                </div>
                <button
                  onClick={handleReset}
                  className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  ← 重新选择图片
                </button>
              </div>

              {isRaw && rawMeta && rawMeta.sensorWidth > rawMeta.previewWidth && (
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-lg px-4 py-2 text-xs text-blue-700 dark:text-blue-300">
                  ℹ️ 真实传感器分辨率为 {rawMeta.sensorWidth}×{rawMeta.sensorHeight}，
                  RAW 文件中嵌入的最大 JPEG 预览为 {rawMeta.previewWidth}×{rawMeta.previewHeight}（相机决定）。
                  解码 14bit 原始传感器数据需要 LibRaw 等专门的解码库。
                </div>
              )}

              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
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

              <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 rounded-lg p-1 self-center">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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

      <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 text-center text-xs text-gray-500">
        DeDeBayer — 纯前端实现，所有计算在浏览器本地完成，图片不会上传到任何服务器 ·{' '}
        <a href="https://github.com/sergioperezcheco/DeDeBayer" target="_blank" rel="noopener noreferrer"
           className="text-green-600 dark:text-green-400 hover:underline">
          GitHub
        </a>
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
