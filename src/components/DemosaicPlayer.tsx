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

/** 裁剪区域大小 */
const CROP_SIZE = 200
/** 每个像素的显示大小 */
const PIXEL_SIZE = 4

type DemoStep = 'mosaic' | 'interpolating' | 'result'

export function DemosaicPlayer({ bayer, fileBaseName: _fileBaseName }: Props) {
  const [algorithm, setAlgorithm] = useState<DemosaicAlgorithm>('bilinear')
  const [step, setStep] = useState<DemoStep>('mosaic')
  const [cropX, setCropX] = useState(0)
  const [cropY, setCropY] = useState(0)
  const [animProgress, setAnimProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const animRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  // 缩略图 canvas 用于选择区域
  const thumbRef = useRef<HTMLCanvasElement>(null)
  // 放大演示 canvas
  const demoRef = useRef<HTMLCanvasElement>(null)

  // 初始化裁剪位置到图片中心
  useEffect(() => {
    const cx = Math.floor(bayer.width / 2) - CROP_SIZE / 2
    const cy = Math.floor(bayer.height / 2) - CROP_SIZE / 2
    setCropX(Math.max(0, Math.min(cx, bayer.width - CROP_SIZE)))
    setCropY(Math.max(0, Math.min(cy, bayer.height - CROP_SIZE)))
  }, [bayer])

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
  }, [bayer, cropX, cropY])

  // 解拜耳结果
  const demosaiced = useMemo(
    () => demosaic(cropBayer, algorithm),
    [cropBayer, algorithm]
  )

  // 绘制缩略图（带裁剪框）
  useEffect(() => {
    if (!thumbRef.current) return
    const canvas = thumbRef.current
    // 缩略图最大 300px
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
  }, [bayer, cropX, cropY])

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
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const { mosaic, pattern } = cropBayer

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const x = c * pw
        const y = r * pw
        const ch = getChannelAt(r + cropY, c + cropX, pattern)
        const val = mosaic[r * w + c]!

        if (step === 'mosaic') {
          // 显示 Bayer 马赛克：每个像素只有一个颜色通道
          const colors = ['rgb(' + val + ',0,0)', 'rgb(0,' + val + ',0)', 'rgb(0,0,' + val + ')']
          ctx.fillStyle = colors[ch]!
          ctx.fillRect(x, y, pw, pw)
        } else if (step === 'result' || (step === 'interpolating' && animProgress >= 1)) {
          // 显示完整 RGB
          const idx = (r * w + c) * 4
          const rr = demosaiced.data[idx]!
          const gg = demosaiced.data[idx + 1]!
          const bb = demosaiced.data[idx + 2]!
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`
          ctx.fillRect(x, y, pw, pw)
        } else {
          // 插值动画：逐渐填充缺失通道
          const idx = (r * w + c) * 4
          const finalR = demosaiced.data[idx]!
          const finalG = demosaiced.data[idx + 1]!
          const finalB = demosaiced.data[idx + 2]!

          // 已有通道保持，缺失通道从 0 渐变到最终值
          const t = animProgress
          let rr: number, gg: number, bb: number
          if (ch === 0) { // R 像素
            rr = val
            gg = Math.round(finalG * t)
            bb = Math.round(finalB * t)
          } else if (ch === 1) { // G 像素
            rr = Math.round(finalR * t)
            gg = val
            bb = Math.round(finalB * t)
          } else { // B 像素
            rr = Math.round(finalR * t)
            gg = Math.round(finalG * t)
            bb = val
          }
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`
          ctx.fillRect(x, y, pw, pw)
        }

        // 网格线
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(x, y, pw, pw)

        // 在马赛克模式下标注通道字母
        if (step === 'mosaic' && pw >= 16) {
          const labels = ['R', 'G', 'B']
          ctx.fillStyle = 'rgba(255,255,255,0.5)'
          ctx.font = '9px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(labels[ch]!, x + pw / 2, y + pw / 2)
        }
      }
    }
  }, [cropBayer, cropX, cropY, step, animProgress, demosaiced])

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
    const newX = Math.round(mx * scaleX - CROP_SIZE / 2)
    const newY = Math.round(my * scaleY - CROP_SIZE / 2)
    setCropX(Math.max(0, Math.min(newX, bayer.width - CROP_SIZE)))
    setCropY(Math.max(0, Math.min(newY, bayer.height - CROP_SIZE)))
  }, [bayer])

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
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 self-center">
        {steps.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setStep(s.id)
              if (s.id !== 'interpolating') setAnimProgress(s.id === 'result' ? 1 : 0)
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              step === s.id
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
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
