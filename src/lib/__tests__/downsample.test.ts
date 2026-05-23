import { describe, it, expect } from 'vitest'
import { downsampleBayer } from '../downsample'
import { type BayerResult } from '../bayer'

function makeBayer(w: number, h: number, fill: number): BayerResult {
  return {
    mosaic: new Uint8ClampedArray(w * h).fill(fill),
    width: w,
    height: h,
    pattern: 'RGGB',
  }
}

describe('downsampleBayer', () => {
  it('preserves Bayer pattern (even dimensions)', () => {
    const bayer = makeBayer(800, 600, 100)
    const result = downsampleBayer(bayer, 400)

    expect(result.width % 2).toBe(0)
    expect(result.height % 2).toBe(0)
  })

  it('returns same bayer if already small', () => {
    const bayer = makeBayer(100, 100, 50)
    const result = downsampleBayer(bayer, 200)
    expect(result).toBe(bayer)
  })

  it('reduces size when input larger than maxSize', () => {
    const bayer = makeBayer(2000, 1500, 100)
    const result = downsampleBayer(bayer, 800)
    expect(result.width).toBeLessThanOrEqual(800)
    expect(result.height).toBeLessThanOrEqual(800)
  })

  it('preserves uniform values after downsampling', () => {
    const bayer = makeBayer(1000, 1000, 200)
    const result = downsampleBayer(bayer, 500)
    // 平均值应该接近原值
    let sum = 0
    for (const v of result.mosaic) sum += v
    const avg = sum / result.mosaic.length
    expect(Math.abs(avg - 200)).toBeLessThan(2)
  })
})
