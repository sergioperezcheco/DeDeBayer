import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  imageData: ImageData | null
  /** 关闭回调 */
  onClose: () => void
  title?: string
}

/**
 * 全屏图片查看器
 * 功能：滚轮缩放、拖拽平移、旋转、键盘快捷键
 */
export function ImageViewer({ imageData, onClose, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0) // 初始 0，等 fitToScreen 计算后再显示
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [rotation, setRotation] = useState(0) // 0, 90, 180, 270
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // 渲染图像到 canvas
  useEffect(() => {
    if (!imageData || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(imageData, 0, 0)
  }, [imageData])

  // 计算 fit-to-screen 初始缩放
  const fitToScreen = useCallback(() => {
    if (!imageData || !containerRef.current) return
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    if (cw === 0 || ch === 0) return
    const swap = rotation % 180 !== 0
    const iw = swap ? imageData.height : imageData.width
    const ih = swap ? imageData.width : imageData.height
    const fitScale = Math.min(cw / iw, ch / ih) * 0.95
    setScale(fitScale)
    setTx(0)
    setTy(0)
    setReady(true)
  }, [imageData, rotation])

  // 进入查看器自动 fit（延迟一帧确保容器有尺寸）
  useEffect(() => {
    requestAnimationFrame(() => fitToScreen())
  }, [fitToScreen])

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case '0':
          fitToScreen()
          break
        case '+':
        case '=':
          setScale((s) => Math.min(s * 1.25, 20))
          break
        case '-':
          setScale((s) => Math.max(s / 1.25, 0.05))
          break
        case 'r':
        case 'R':
          setRotation((r) => (r + 90) % 360)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, fitToScreen])

  // 滚轮缩放（以鼠标位置为中心）
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left - rect.width / 2
    const my = e.clientY - rect.top - rect.height / 2

    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const newScale = Math.max(0.05, Math.min(20, scale * delta))
    const ratio = newScale / scale

    // 让鼠标位置对应的图像点保持不动
    setScale(newScale)
    setTx((tx - mx) * ratio + mx)
    setTy((ty - my) * ratio + my)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, tx, ty }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return
    setTx(dragStart.current.tx + (e.clientX - dragStart.current.x))
    setTy(dragStart.current.ty + (e.clientY - dragStart.current.y))
  }

  const handleMouseUp = () => {
    setDragging(false)
    dragStart.current = null
  }

  const handleDoubleClick = () => {
    fitToScreen()
  }

  if (!imageData) return null

  const transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale})`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={(e) => {
        // 点击背景关闭
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur border-b border-gray-800">
        <div className="text-sm text-gray-400 truncate flex-1">
          {title}
          <span className="ml-3 text-gray-600">
            {imageData.width} × {imageData.height} · {Math.round(scale * 100)}%
            {rotation !== 0 && ` · ${rotation}°`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => setScale((s) => Math.max(s / 1.25, 0.05))} title="缩小 (-)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => setScale((s) => Math.min(s * 1.25, 20))} title="放大 (+)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={fitToScreen} title="适应屏幕 (0)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => setScale(1)} title="100%">
            <span className="text-xs px-1">1:1</span>
          </ToolbarButton>
          <div className="w-px h-6 bg-gray-700 mx-1" />
          <ToolbarButton onClick={() => setRotation((r) => (r - 90 + 360) % 360)} title="逆时针旋转">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => setRotation((r) => (r + 90) % 360)} title="顺时针旋转 (R)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
          <div className="w-px h-6 bg-gray-700 mx-1" />
          <ToolbarButton onClick={onClose} title="关闭 (Esc)">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ToolbarButton>
        </div>
      </div>

      {/* 图片区域 */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform,
            transformOrigin: 'center',
            imageRendering: scale > 2 ? 'pixelated' : 'auto',
            transition: dragging ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            maxWidth: 'none',
            opacity: ready ? 1 : 0,
          }}
          draggable={false}
        />
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 bg-gray-900/80 backdrop-blur border-t border-gray-800 text-xs text-gray-500 text-center">
        滚轮缩放 · 拖拽平移 · 双击适应屏幕 · 快捷键: R 旋转 · 0 适应屏幕 · +/- 缩放 · Esc 关闭
      </div>
    </div>
  )
}

function ToolbarButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors
                 flex items-center justify-center min-w-9 h-9"
    >
      {children}
    </button>
  )
}
