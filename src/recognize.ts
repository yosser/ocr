import scribe from 'scribe.js-ocr'

export type PixelRectangle = {
  left: number
  top: number
  width: number
  height: number
}

type ProgressHandler = (label: string, progress: number) => void

scribe.opt.workerN = 1

function describeProgress(message: {
  type?: string
  info?: { status?: string; pct?: number }
}) {
  if (message.type === 'importImage' || message.type === 'importPDF') {
    return { label: 'Importing image', progress: 0.15 }
  }

  if (message.type === 'recognize') {
    if (typeof message.info?.pct === 'number') {
      return { label: 'Recognizing', progress: message.info.pct / 100 }
    }

    if (message.info?.status) {
      const status = message.info.status
      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        progress: 0.6,
      }
    }

    return { label: 'Recognizing', progress: 0.6 }
  }

  if (message.type === 'export') {
    return { label: 'Exporting text', progress: 0.9 }
  }

  return { label: 'Working', progress: 0.3 }
}

function canvasToPngFile(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not prepare the image.'))
        return
      }

      resolve(new File([blob], name, { type: 'image/png' }))
    }, 'image/png')
  })
}

async function cropFile(file: File, rectangle: PixelRectangle) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = rectangle.width
  canvas.height = rectangle.height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Could not prepare the selected area.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    bitmap,
    rectangle.left,
    rectangle.top,
    rectangle.width,
    rectangle.height,
    0,
    0,
    rectangle.width,
    rectangle.height,
  )
  bitmap.close()
  return canvasToPngFile(canvas, 'selection.png')
}

function namedImageFile(file: File) {
  if (/\.(png|jpe?g)$/i.test(file.name)) {
    return file
  }

  if (file.type === 'image/png') {
    return new File([file], 'image.png', { type: file.type })
  }

  if (file.type === 'image/jpeg') {
    return new File([file], 'image.jpg', { type: file.type })
  }

  return file
}

async function sourceToFile(source: File | HTMLCanvasElement, rectangle: PixelRectangle | null) {
  if (source instanceof HTMLCanvasElement) {
    return canvasToPngFile(source, 'writing.png')
  }

  if (rectangle) {
    return cropFile(source, rectangle)
  }

  if (source.type === 'image/png' || source.type === 'image/jpeg') {
    return namedImageFile(source)
  }

  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Could not prepare the image.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvasToPngFile(canvas, 'image.png')
}

export async function recognizeImage(
  source: File | HTMLCanvasElement,
  options: {
    rectangle?: PixelRectangle | null
    onProgress?: ProgressHandler
  } = {},
) {
  const file = await sourceToFile(source, options.rectangle ?? null)
  scribe.opt.progressHandler = (message) => {
    const described = describeProgress(message)
    options.onProgress?.(described.label, described.progress)
  }

  const doc = await scribe.openDocument([file])
  try {
    await doc.recognize({
      langs: ['eng'],
      mode: 'speed',
    })
    const exported = await doc.exportData('txt')
    if (typeof exported !== 'string') {
      return ''
    }

    return exported.trim()
  } finally {
    await doc.close()
  }
}
