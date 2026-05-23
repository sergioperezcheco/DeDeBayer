import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type BayerResult, getChannelAt, bayerToColorVisualization } from '../lib/bayer'
import { type DemosaicAlgorithm, demosaic } from '../lib/demosaic'

interface Props {
  bayer: BayerResult
  fileBaseName?: string
}

const ALGORITHMS: { id: DemosaicAlgorithm; label: string; desc: string }[] = [
  { id: 'nearest', label: '最近邻', desc: '最简单，直接复制最近的同色像素' },
  { id: 'bilinear', label: '双线性插值', desc: '取周围同色像素的平均值（标准教科书算法）' },
  { id: 'smooth-hue', label: '平滑色调', desc: 'Kimmel 1999，利用色调比率 R/G、B/G 的平滑性' },
  { id: 'malvar', label: 'Malvar-He-Cutler', desc: 'Microsoft Research 2004，5×5 卷积核利用跨通道信息' },
  { id: 'edge', label: '边缘导向', desc: 'Hamilton & Adams 1997，根据梯度方向选择插值方向' },
]

/** 缩放档位：每个档位决定每个 Bayer 像素在画布上占多少屏幕像素 */
const ZOOM_LEVELS = [
  { label: '100%', pixelSize: 1, cropSize: 800 },
  { label: '200%', pixelSize: 2, cropSize: 400 },
  { label: '400%', pixelSize: 4, cropSize: 200 },
  { label: '800%', pixelSize: 8, cropSize: 100 },
  { label: '1600%', pixelSize: 16, cropSize: 50 },
] as const

type ZoomLevel = typeof ZOOM_LEVELS[number]

type DemoStep = 'mosaic' | 'interpolating' | 'result'

export function DemosaicPlayer({ bayer, fileBaseName: _fileBaseName }: Props) {
  const [algorithm, setAlgorithm] = useState<DemosaicAlgorithm>('bilinear')
  const [step, setStep] = useState<DemoStep>('mosaic')
  const [zoomIdx, setZoomIdx] = useState(2) // 默认 400%
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)
  const [animProgress, setAnimProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const animRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  const zoom: ZoomLevel = ZOOM_LEVELS[zoomIdx]!
  const CROP_SIZE = Math.min(zoom.cropSize, bayer.width, bayer.height)
  const PIXEL_SIZE = zoom.pixelSize

  // 缩略图 canvas 用于选择区域
  const thumbRef = useRef<HTMLCanvasElement>(null)
  // 放大演示 canvas
  const demoRef = useRef<HTMLCanvasElement>(null)

  // 初始化裁剪位置到图片中心（必须偶数对齐 Bayer 2x2 块）
  useEffect(() => {
    const cx = Math.floor(bayer.width / 2) - CROP_SIZE / 2
    const cy = Math.floor(bayer.height / 2) - CROP_SIZE / 2
    const x = Math.max(0, Math.min(cx, bayer.width - CROP_SIZE))
    const y = Math.max(0, Math.min(cy, bayer.height - CROP_SIZE))
    setCropX(x - (x % 2))
    setCropY(y - (y % 2))
  }, [bayer, CROP_SIZE])

  // 当 cropX/cropY 因为图像变小越界时，钳制到合法范围
  useEffect(() => {
    setCropX((x) => {
      const clamped = Math.max(0, Math.min(x, bayer.width - CROP_SIZE))
      return clamped - (clamped % 2)
    })
    setCropY((y) => {
      const clamped = Math.max(0, Math.min(y, bayer.height - CROP_SIZE))
      return clamped - (clamped % 2)
    })
  }, [CROP_SIZE, bayer.width, bayer.height])

  // 裁剪区域的 Bayer 子集
  const cropBayer = useMemo((): BayerResult => {
    const w = CROP_SIZE
    const h = CROP_SIZE
    const mosaic = new Uint8ClampedArray(w * h)
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const srcR = cropY + r
        const srcC = cropX + c
        if (srcR < bayer.height && srcC < bayer.width) {
          mosaic[r * w + c] = bayer.mosaic[srcR * bayer.width + srcC]!
        }
      }
    }
    return { mosaic, width: w, height: h, pattern: bayer.pattern }
  }, [bayer, cropX, cropY, CROP_SIZE])

  // 解拜耳结果
  const demosaiced = useMemo(
    () => demosaic(cropBayer, algorithm),
    [cropBayer, algorithm]
  )

  // 绘制缩略图（带裁剪框）
  useEffect(() => {
    if (!thumbRef.current) return
    const canvas = thumbRef.current
    const scale = Math.min(300 / bayer.width, 200 / bayer.height, 1)
    const tw = Math.round(bayer.width * scale)
    const th = Math.round(bayer.height * scale)
    canvas.width = tw
    canvas.height = th

    const ctx = canvas.getContext('2d')!
    // 绘制彩色马赛克缩略图
    const viz = bayerToColorVisualization(bayer)
    const tempCanvas = new OffscreenCanvas(bayer.width, bayer.height)
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.putImageData(viz, 0, 0)
    ctx.drawImage(tempCanvas, 0, 0, tw, th)

    // 绘制裁剪框
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 2
    ctx.strokeRect(
      cropX * scale, cropY * scale,
      CROP_SIZE * scale, CROP_SIZE * scale
    )
  }, [bayer, cropX, cropY, CROP_SIZE])

  // 绘制放大演示
  useEffect(() => {
    if (!demoRef.current) return
    const canvas = demoRef.current
    const w = CROP_SIZE
    const h = CROP_SIZE
    const pw = PIXEL_SIZE
    canvas.width = w * pw
    canvas.height = h * pw
    const ctx = canvas.getContext('2d')!

    const { mosaic, pattern } = cropBayer

    // 高效路径：先把每个 Bayer 像素的颜色画到原始尺寸的离屏 ImageData
    const small = ctx.createImageData(w, h)
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const idx = (r * w + c) * 4
        const ch = getChannelAt(r, c, pattern)
        const val = mosaic[r * w + c]!
        let rr = 0, gg = 0, bb = 0

        if (step === 'mosaic') {
          if (ch === 0) rr = val
          else if (ch === 1) gg = val
          else bb = val
        } else if (step === 'result' || (step === 'interpolating' && animProgress >= 1)) {
          rr = demosaiced.data[idx]!
          gg = demosaiced.data[idx + 1]!
          bb = demosaiced.data[idx + 2]!
        } else {
          // 插值动画：逐渐填充缺失通道
          const finalR = demosaiced.data[idx]!
          const finalG = demosaiced.data[idx + 1]!
          const finalB = demosaiced.data[idx + 2]!
          const t = animProgress

          if (ch === 0) {
            rr = val
            gg = Math.round(finalG * t)
            bb = Math.round(finalB * t)
          } else if (ch === 1) {
            rr = Math.round(finalR * t)
            gg = val
            bb = Math.round(finalB * t)
          } else {
            rr = Math.round(finalR * t)
            gg = Math.round(finalG * t)
            bb = val
          }
        }

        small.data[idx] = rr
        small.data[idx + 1] = gg
        small.data[idx + 2] = bb
        small.data[idx + 3] = 255
      }
    }

    if (pw === 1) {
      // 100% 缩放：直接 putImageData，无需放大
      ctx.putImageData(small, 0, 0)
    } else {
      // 高倍缩放：先绘制到离屏 canvas，再放大
      const offCanvas = new OffscreenCanvas(w, h)
      const offCtx = offCanvas.getContext('2d')!
      offCtx.putImageData(small, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(offCanvas, 0, 0, w * pw, h * pw)

      // 高倍率时绘制网格和字母（仅在每像素够大时）
      if (pw >= 4) {
        ctx.strokeStyle = 'rgba(128,128,128,0.15)'
        ctx.lineWidth = 0.5
        for (let r = 0; r <= h; r++) {
          ctx.beginPath()
          ctx.moveTo(0, r * pw)
          ctx.lineTo(w * pw, r * pw)
          ctx.stroke()
        }
        for (let c = 0; c <= w; c++) {
          ctx.beginPath()
          ctx.moveTo(c * pw, 0)
          ctx.lineTo(c * pw, h * pw)
          ctx.stroke()
        }
      }

      if (step === 'mosaic' && pw >= 16) {
        const labels = ['R', 'G', 'B']
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = `${Math.floor(pw * 0.5)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const ch = getChannelAt(r, c, pattern)
            ctx.fillText(labels[ch]!, c * pw + pw / 2, r * pw + pw / 2)
          }
        }
      }
    }
  }, [cropBayer, step, animProgress, demosaiced, CROP_SIZE, PIXEL_SIZE])

  // 动画循环
  useEffect(() => {
    if (!playing) return
    let cancelled = false
    const duration = 2000

    const tick = (ts: number) => {
      if (cancelled) return
      if (startRef.current === null) startRef.current = ts
      const t = Math.min(1, (ts - startRef.current) / duration)
      setAnimProgress(t)
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setPlaying(false)
        startRef.current = null
      }
    }
    animRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    }
  }, [playing])

  const handleThumbClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = thumbRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const scaleX = bayer.width / canvas.width
    const scaleY = bayer.height / canvas.height
    let newX = Math.round(mx * scaleX - CROP_SIZE / 2)
    let newY = Math.round(my * scaleY - CROP_SIZE / 2)
    newX = Math.max(0, Math.min(newX, bayer.width - CROP_SIZE))
    newY = Math.max(0, Math.min(newY, bayer.height - CROP_SIZE))
    setCropX(newX - (newX % 2))
    setCropY(newY - (newY % 2))
  }, [bayer, CROP_SIZE])

  const handlePlayDemo = () => {
    setStep('interpolating')
    setAnimProgress(0)
    startRef.current = null
    setPlaying(true)
  }

  const steps: { id: DemoStep; label: string }[] = [
    { id: 'mosaic', label: '① 原始马赛克' },
    { id: 'interpolating', label: '② 插值过程' },
    { id: 'result', label: '③ 最终结果' },
  ]

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* 算法选择 */}
      <div className="flex flex-wrap gap-4 items-center justify-center">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 uppercase tracking-wide">算法</label>
          <select
            value={algorithm}
            onChange={(e) => {
              setAlgorithm(e.target.value as DemosaicAlgorithm)
              setStep('mosaic')
              setAnimProgress(0)
            }}
            className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:border-green-500"
          >
            {ALGORITHMS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 uppercase tracking-wide">缩放</label>
          <select
            value={zoomIdx}
            onChange={(e) => setZoomIdx(parseInt(e.target.value, 10))}
            className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:border-green-500"
          >
            {ZOOM_LEVELS.map((z, i) => (
              <option key={z.label} value={i}>
                {z.label}（{z.cropSize}×{z.cropSize}px）
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 items-end">
          <button
            onClick={handlePlayDemo}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-colors
                       bg-green-600 hover:bg-green-500 text-white"
          >
            ▶ 播放插值动画
          </button>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        {ALGORITHMS.find((a) => a.id === algorithm)?.desc}
      </p>

      {/* 步骤切换 */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 rounded-lg p-1 self-center">
        {steps.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setStep(s.id)
              if (s.id !== 'interpolating') setAnimProgress(s.id === 'result' ? 1 : 0)
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              step === s.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 主内容区 */}
      <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
        {/* 左侧：缩略图选择区域 */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-gray-500">点击选择演示区域</span>
          <canvas
            ref={thumbRef}
            onClick={handleThumbClick}
            className="rounded border border-gray-300 dark:border-gray-700 cursor-crosshair hover:border-green-500 transition-colors"
          />
          <span className="text-xs text-gray-600">
            区域: ({cropX}, {cropY}) · {CROP_SIZE}×{CROP_SIZE}px
          </span>
        </div>

        {/* 右侧：放大演示 */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-gray-500">
            {step === 'mosaic' && '每个像素只有一个颜色通道的数据'}
            {step === 'interpolating' && `缺失通道正在被插值填充... ${Math.round(animProgress * 100)}%`}
            {step === 'result' && '所有像素都有完整的 RGB 三通道'}
          </span>
          <canvas
            ref={demoRef}
            className="rounded-lg border border-gray-700 shadow-lg"
            style={{ imageRendering: 'pixelated' }}
          />
          <div className="flex gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-red-600 inline-block" /> R 像素
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-green-600 inline-block" /> G 像素
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" /> B 像素
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
