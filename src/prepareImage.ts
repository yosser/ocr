export type NormalizedCrop = {
  left: number
  top: number
  width: number
  height: number
}

export type ImageAdjustments = {
  quarterTurns: number
  straighten: number
  crop: NormalizedCrop
  brightness: number
  contrast: number
}

export const PREVIEW_LONG_EDGE = 1600

export function fullCrop(): NormalizedCrop {
  return { left: 0, top: 0, width: 1, height: 1 }
}

export function defaultAdjustments(): ImageAdjustments {
  return {
    quarterTurns: 0,
    straighten: 0,
    crop: fullCrop(),
    brightness: 1,
    contrast: 1,
  }
}

export function isOriginalAdjustment(adjustments: ImageAdjustments) {
  const crop = adjustments.crop

  return (
    adjustments.quarterTurns === 0 &&
    adjustments.straighten === 0 &&
    adjustments.brightness === 1 &&
    adjustments.contrast === 1 &&
    crop.left === 0 &&
    crop.top === 0 &&
    crop.width === 1 &&
    crop.height === 1
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function rotatedSize(width: number, height: number, radians: number) {
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))

  return {
    width: Math.max(1, Math.round(width * cos + height * sin)),
    height: Math.max(1, Math.round(width * sin + height * cos)),
  }
}

function cropCanvas(source: HTMLCanvasElement, crop: NormalizedCrop) {
  const left = clamp(Math.floor(crop.left * source.width), 0, Math.max(0, source.width - 1))
  const top = clamp(Math.floor(crop.top * source.height), 0, Math.max(0, source.height - 1))
  const width = clamp(Math.round(crop.width * source.width), 1, source.width - left)
  const height = clamp(Math.round(crop.height * source.height), 1, source.height - top)

  if (left === 0 && top === 0 && width === source.width && height === source.height) {
    return source
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not prepare the image.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, left, top, width, height, 0, 0, width, height)
  return canvas
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not prepare the image.'))
        return
      }

      resolve(blob)
    }, 'image/jpeg', 0.92)
  })
}

export async function prepareImage(
  file: File,
  adjustments: ImageAdjustments,
  options: { maxEdge?: number; applyCrop?: boolean } = {},
) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const turns = ((adjustments.quarterTurns % 4) + 4) % 4
    const degrees = turns * 90 + adjustments.straighten
    const radians = (degrees * Math.PI) / 180
    let target = rotatedSize(bitmap.width, bitmap.height, radians)
    let scale = 1

    if (options.maxEdge && Math.max(target.width, target.height) > options.maxEdge) {
      scale = options.maxEdge / Math.max(target.width, target.height)
      target = {
        width: Math.max(1, Math.round(target.width * scale)),
        height: Math.max(1, Math.round(target.height * scale)),
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not prepare the image.')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, target.width, target.height)
    context.translate(target.width / 2, target.height / 2)
    context.rotate(radians)

    context.filter = `grayscale(1) brightness(${adjustments.brightness}) contrast(${adjustments.contrast})`
    context.drawImage(
      bitmap,
      (-bitmap.width * scale) / 2,
      (-bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    )

    const output = options.applyCrop ? cropCanvas(canvas, adjustments.crop) : canvas
    const blob = await canvasToJpeg(output)
    return new File([blob], 'prepared.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
