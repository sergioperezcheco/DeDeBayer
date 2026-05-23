// 为 Node 测试环境提供 ImageData polyfill
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray
    width: number
    height: number
    colorSpace: 'srgb' = 'srgb'

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = widthOrHeight
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = dataOrWidth
        this.width = widthOrHeight
        this.height = height!
      }
    }
  }
  ;(globalThis as unknown as { ImageData: typeof ImageDataPolyfill }).ImageData = ImageDataPolyfill
}
