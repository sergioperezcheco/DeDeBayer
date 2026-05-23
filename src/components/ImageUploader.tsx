import { useCallback, useEffect, useRef, useState } from 'react'
import { isRawFile, loadRawFile, RAW_EXTENSIONS, type RawMetadata } from '../lib/raw-loader'
import { type BayerResult } from '../lib/bayer'

interface Props {
  onImageLoaded: (imageData: ImageData, fileName: string) => void
  onRawLoaded: (bayer: BayerResult, processedImage: ImageData, metadata: RawMetadata, fileName: string) => void
}

export type SizeOption = 'small' | 'medium' | 'full'

export const SIZE_OPTIONS: { id: SizeOption; label: string; maxSize: number | null; desc: string }[] = [
  { id: 'small', label: '小（最大 800px）', maxSize: 800, desc: '快速演示，适合算法对比' },
  { id: 'medium', label: '中（最大 1600px）', maxSize: 1600, desc: '平衡性能和细节' },
  { id: 'full', label: '原始尺寸', maxSize: null, desc: '保持内嵌预览的原分辨率' },
]

export function ImageUploader({ onImageLoaded, onRawLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [sizeOption, setSizeOption] = useState<SizeOption>('full')
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const startProgress = useCallback((fileSizeMB: number) => {
    setProgress(0)
    const estimatedSeconds = Math.max(1, fileSizeMB * 0.1)
    const intervalMs = 100
    const totalSteps = (estimatedSeconds * 1000) / intervalMs
    let step = 0

    progressTimer.current = setInterval(() => {
      step++
      const t = step / totalSteps
      const p = Math.min(0.92, 1 - Math.pow(1 - t, 2))
      setProgress(p)

      if (t < 0.3) setStatusText('解析 RAW 结构...')
      else if (t < 0.7) setStatusText('解码内嵌预览图...')
      else setStatusText('生成 Bayer 马赛克...')
    }, intervalMs)
  }, [])

  const stopProgress = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
    setProgress(1)
    setStatusText('完成!')
  }, [])

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current)
    }
  }, [])

  const getMaxSize = (): number | null => {
    return SIZE_OPTIONS.find((o) => o.id === sizeOption)?.maxSize ?? null
  }

  const handleFile = useCallback(async (file: File) => {
    setError(null)

    if (isRawFile(file.name)) {
      setLoading(true)
      const fileSizeMB = file.size / (1024 * 1024)
      startProgress(fileSizeMB)
      try {
        const buffer = await file.arrayBuffer()
        const { bayer, processedImage, metadata } = await loadRawFile(buffer, getMaxSize())
        stopProgress()
        onRawLoaded(bayer, processedImage, metadata, file.name)
      } catch (err) {
        stopProgress()
        console.error('RAW decode error:', err)
        setError(`无法解析 RAW 文件: ${err instanceof Error ? err.message : '未知错误'}`)
      } finally {
        setLoading(false)
      }
    } else {
      const url = URL.createObjectURL(file)
      try {
        const blob = await fetch(url).then((r) => r.blob())
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })

        const maxSize = getMaxSize()
        let { width, height } = bitmap
        if (maxSize !== null && (width > maxSize || height > maxSize)) {
          const scale = maxSize / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }

        width = width - (width % 2)
        height = height - (height % 2)

        const canvas = canvasRef.current!
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0, width, height)
        bitmap.close()
        const imageData = ctx.getImageData(0, 0, width, height)

        URL.revokeObjectURL(url)
        onImageLoaded(imageData, file.name)
      } catch (err) {
        URL.revokeObjectURL(url)
        setError(`无法加载图片: ${err instanceof Error ? err.message : '未知错误'}`)
      }
    }
  }, [onImageLoaded, onRawLoaded, sizeOption, startProgress, stopProgress])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-lg">
      {!loading && (
        <div className="w-full bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
          <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
            处理尺寸
          </label>
          <div className="flex gap-2">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSizeOption(opt.id)}
                className={`flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  sizeOption === opt.id
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {SIZE_OPTIONS.find((o) => o.id === sizeOption)?.desc}
          </p>
        </div>
      )}

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => !loading && inputRef.current?.click()}
        className={`w-full border-2 border-dashed rounded-xl p-12
                   flex flex-col items-center justify-center gap-3
                   transition-colors min-h-64 ${
                     loading
                       ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 cursor-wait'
                       : 'border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer'
                   }`}
      >
        {loading ? (
          <>
            <div className="w-full max-w-xs">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{statusText}</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-200 ease-out"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
            <p className="text-gray-600 text-xs mt-2">从 RAW 提取内嵌预览图...</p>
          </>
        ) : (
          <>
            <svg className="w-12 h-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-400 text-center">
              拖拽图片到这里，或点击选择文件
            </p>
            <p className="text-gray-600 text-sm text-center">
              支持 RAW: {RAW_EXTENSIONS.slice(0, 6).join(', ')}...
            </p>
            <p className="text-gray-600 text-xs">也支持 JPEG / PNG</p>
          </>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.orf,.rw2,.raf,.pef,.srw,.x3f,.3fr,.rwl,.raw"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
