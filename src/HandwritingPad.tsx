import { forwardRef, useEffect, useImperativeHandle, useRef, type PointerEvent } from 'react'

const BITMAP_WIDTH = 1200
const BITMAP_HEIGHT = 480
const STROKE_WIDTH = 16
const INK = '#111111'

type Point = {
  x: number
  y: number
}

export type HandwritingPadHandle = {
  clear: () => void
  getCanvas: () => HTMLCanvasElement | null
}

type HandwritingPadProps = {
  disabled?: boolean
  onInkChange: (hasInk: boolean) => void
}

function prepareContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return
  }

  canvas.width = BITMAP_WIDTH
  canvas.height = BITMAP_HEIGHT
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = INK
  context.fillStyle = INK
  context.lineWidth = STROKE_WIDTH
}

export function cropToInk(source: HTMLCanvasElement) {
  const context = source.getContext('2d')
  if (!context) {
    return source
  }

  const { width, height } = source
  const pixels = context.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let found = false

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4
      const red = pixels[offset] ?? 255
      const green = pixels[offset + 1] ?? 255
      const blue = pixels[offset + 2] ?? 255
      if (red < 250 || green < 250 || blue < 250) {
        found = true
        if (x < minX) {
          minX = x
        }
        if (y < minY) {
          minY = y
        }
        if (x > maxX) {
          maxX = x
        }
        if (y > maxY) {
          maxY = y
        }
      }
    }
  }

  if (!found) {
    return source
  }

  const padding = 32
  const left = Math.max(0, minX - padding)
  const top = Math.max(0, minY - padding)
  const right = Math.min(width, maxX + padding + 1)
  const bottom = Math.min(height, maxY + padding + 1)
  const cropWidth = right - left
  const cropHeight = bottom - top
  const copy = document.createElement('canvas')
  copy.width = cropWidth
  copy.height = cropHeight
  const copyContext = copy.getContext('2d')
  if (!copyContext) {
    return source
  }

  copyContext.fillStyle = '#ffffff'
  copyContext.fillRect(0, 0, cropWidth, cropHeight)
  copyContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return copy
}

function pointOnCanvas(event: PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Point | null {
  const bounds = canvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height) {
    return null
  }

  const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width
  const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height

  return {
    x: Math.min(canvas.width, Math.max(0, x)),
    y: Math.min(canvas.height, Math.max(0, y)),
  }
}

export const HandwritingPad = forwardRef<HandwritingPadHandle, HandwritingPadProps>(
  function HandwritingPad({ disabled = false, onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawingRef = useRef(false)
    const lastPointRef = useRef<Point | null>(null)
    const onInkChangeRef = useRef(onInkChange)
    onInkChangeRef.current = onInkChange

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      prepareContext(canvas)
    }, [])

    useImperativeHandle(ref, () => ({
      clear() {
        const canvas = canvasRef.current
        if (!canvas) {
          return
        }

        drawingRef.current = false
        lastPointRef.current = null
        prepareContext(canvas)
        onInkChangeRef.current(false)
      },
      getCanvas() {
        return canvasRef.current
      },
    }))

    function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
      if (disabled || event.button !== 0) {
        return
      }

      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      const context = canvas.getContext('2d')
      const point = pointOnCanvas(event, canvas)
      if (!context || !point) {
        return
      }

      drawingRef.current = true
      lastPointRef.current = point
      context.beginPath()
      context.moveTo(point.x, point.y)
      context.lineTo(point.x + 0.01, point.y + 0.01)
      context.stroke()
      onInkChangeRef.current(true)
      event.preventDefault()

      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic and some pointer events cannot be captured. Drawing still tracks while the pointer stays over the pad.
      }
    }

    function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) {
        return
      }

      const canvas = canvasRef.current
      const lastPoint = lastPointRef.current
      if (!canvas || !lastPoint) {
        return
      }

      const context = canvas.getContext('2d')
      const point = pointOnCanvas(event, canvas)
      if (!context || !point) {
        return
      }

      context.beginPath()
      context.moveTo(lastPoint.x, lastPoint.y)
      context.lineTo(point.x, point.y)
      context.stroke()
      lastPointRef.current = point
    }

    function endStroke() {
      drawingRef.current = false
      lastPointRef.current = null
    }

    let className = 'writing-pad'
    if (disabled) {
      className += ' is-disabled'
    }

    return (
      <div className={className}>
        <canvas
          ref={canvasRef}
          width={BITMAP_WIDTH}
          height={BITMAP_HEIGHT}
          aria-label="Writing pad"
          aria-describedby="writing-hint"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        <p className="preview-hint" id="writing-hint">
          Write on the pad, then scan it.
        </p>
      </div>
    )
  },
)
