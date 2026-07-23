import jsQR from 'jsqr'

export interface QrCrop {
  x: number
  y: number
  width: number
  height: number
}

const MAX_IMAGE_EDGE = 2400

async function sourceToBlob(source: Blob | string) {
  if (source instanceof Blob) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error('二维码图片读取失败')
  return response.blob()
}

export async function decodeQrImage(source: Blob | string, crop?: QrCrop) {
  const bitmap = await createImageBitmap(await sourceToBlob(source))
  try {
    const sourceX = Math.max(0, Math.floor(crop?.x || 0))
    const sourceY = Math.max(0, Math.floor(crop?.y || 0))
    const sourceWidth = Math.max(1, Math.min(bitmap.width - sourceX, Math.floor(crop?.width || bitmap.width)))
    const sourceHeight = Math.max(1, Math.min(bitmap.height - sourceY, Math.floor(crop?.height || bitmap.height)))
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器无法读取二维码图片')
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    return jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })?.data.trim() || ''
  } finally {
    bitmap.close()
  }
}
