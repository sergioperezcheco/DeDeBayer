import { useEffect, useRef } from 'react'
import { downloadImageData } from '../lib/download'

interface Props {
  imageData: ImageData | null
  label?: string
  className?: string
  /** 提供文件名以启用下载按钮 */
  downloadName?: string
  /** 点击图片回调（用于打开查看器）*/
  onImageClick?: () => void
}

export function CanvasView({ imageData, label, className = '', downloadName, onImageClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!imageData || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(imageData, 0, 0)
  }, [imageData])

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (imageData && downloadName) {
      downloadImageData(imageData, downloadName)
    }
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      {label && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-400">{label}</span>
          {downloadName && imageData && (
            <button
              onClick={handleDownload}
              className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700
                         text-gray-300 rounded transition-colors flex items-center gap-1"
              title="下载为 PNG"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              保存 PNG
            </button>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={onImageClick}
        className={`max-w-full rounded-lg shadow-lg border border-gray-800 ${
          onImageClick ? 'cursor-zoom-in hover:border-gray-600 transition-colors' : ''
        }`}
        style={{
          imageRendering: 'pixelated',
          width: imageData ? `min(100%, ${imageData.width}px)` : undefined,
          aspectRatio: imageData ? `${imageData.width} / ${imageData.height}` : undefined,
        }}
        title={onImageClick ? '点击放大查看' : undefined}
      />
    </div>
  )
}
