import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cropToInk, HandwritingPad, type HandwritingPadHandle } from './HandwritingPad'
import { recognizeImage, type PixelRectangle } from './recognize'
import './App.css'

const MIN_SELECTION_PX = 8

type Point = {
  x: number
  y: number
}

type Selection = {
  left: number
  top: number
  width: number
  height: number
}

type ImageMetrics = {
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

type DragState = {
  origin: Point
  previous: Selection | null
}

type InputMode = 'image' | 'write'

const emptyMetrics: ImageMetrics = {
  width: 0,
  height: 0,
  naturalWidth: 0,
  naturalHeight: 0,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function rectangleFromPoints(start: Point, end: Point): Selection {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  }
}

function metricsMatch(current: ImageMetrics, next: ImageMetrics) {
  return (
    current.width === next.width &&
    current.height === next.height &&
    current.naturalWidth === next.naturalWidth &&
    current.naturalHeight === next.naturalHeight
  )
}

function readMetrics(image: HTMLImageElement): ImageMetrics {
  const bounds = image.getBoundingClientRect()

  return {
    width: bounds.width,
    height: bounds.height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }
}

function pointOnImage(event: ReactPointerEvent<HTMLElement>, image: HTMLImageElement): Point | null {
  if (!image.naturalWidth || !image.naturalHeight) {
    return null
  }

  const bounds = image.getBoundingClientRect()
  if (!bounds.width || !bounds.height) {
    return null
  }

  const displayX = clamp(event.clientX - bounds.left, 0, bounds.width)
  const displayY = clamp(event.clientY - bounds.top, 0, bounds.height)

  return {
    x: (displayX / bounds.width) * image.naturalWidth,
    y: (displayY / bounds.height) * image.naturalHeight,
  }
}

function selectionStyle(selection: Selection, metrics: ImageMetrics): CSSProperties | null {
  if (!metrics.width || !metrics.height || !metrics.naturalWidth || !metrics.naturalHeight) {
    return null
  }

  return {
    left: (selection.left / metrics.naturalWidth) * metrics.width,
    top: (selection.top / metrics.naturalHeight) * metrics.height,
    width: (selection.width / metrics.naturalWidth) * metrics.width,
    height: (selection.height / metrics.naturalHeight) * metrics.height,
  }
}

function toPixelRectangle(
  selection: Selection,
  naturalWidth: number,
  naturalHeight: number,
): PixelRectangle {
  const left = clamp(Math.floor(selection.left), 0, Math.max(0, naturalWidth - 1))
  const top = clamp(Math.floor(selection.top), 0, Math.max(0, naturalHeight - 1))
  const right = clamp(Math.ceil(selection.left + selection.width), left + 1, naturalWidth)
  const bottom = clamp(Math.ceil(selection.top + selection.height), top + 1, naturalHeight)

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

function App() {
  const imageRef = useRef<HTMLImageElement>(null)
  const writingRef = useRef<HandwritingPadHandle>(null)
  const dragRef = useRef<DragState | null>(null)
  const [mode, setMode] = useState<InputMode>('image')
  const [hasInk, setHasInk] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics>(emptyMetrics)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  useEffect(() => {
    const image = imageRef.current
    if (!image || !previewUrl || mode !== 'image') {
      return
    }

    const update = () => {
      const next = readMetrics(image)
      setImageMetrics((current) => {
        if (metricsMatch(current, next)) {
          return current
        }

        return next
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(image)

    return () => {
      observer.disconnect()
    }
  }, [previewUrl, mode])

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null

    dragRef.current = null
    setImageFile(file)
    setPreviewUrl(file ? URL.createObjectURL(file) : null)
    setImageMetrics(emptyMetrics)
    setSelection(null)
    setText(null)
    setError('')
    setStatus('')
    setProgress(null)
  }

  function handleModeChange(next: InputMode) {
    if (next === mode || isScanning) {
      return
    }

    setMode(next)
    setText(null)
    setError('')
    setStatus('')
    setProgress(null)
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current
    const drag = dragRef.current
    if (!image || !drag) {
      return
    }

    const point = pointOnImage(event, image)
    if (!point) {
      return
    }

    setSelection(rectangleFromPoints(drag.origin, point))
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current
    const drag = dragRef.current
    dragRef.current = null

    if (!image || !drag) {
      return
    }

    const point = pointOnImage(event, image)
    if (!point) {
      setSelection(drag.previous)
      return
    }

    const next = rectangleFromPoints(drag.origin, point)
    const bounds = image.getBoundingClientRect()
    const displayWidth = (next.width / image.naturalWidth) * bounds.width
    const displayHeight = (next.height / image.naturalHeight) * bounds.height

    if (displayWidth < MIN_SELECTION_PX || displayHeight < MIN_SELECTION_PX) {
      setSelection(drag.previous)
      return
    }

    setSelection(next)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current
    if (!image || isScanning || event.button !== 0) {
      return
    }

    const origin = pointOnImage(event, image)
    if (!origin) {
      return
    }

    dragRef.current = { origin, previous: selection }
    event.preventDefault()

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and some pointer events cannot be captured. Dragging still tracks while the pointer stays over the image.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const canvas = mode === 'write' ? writingRef.current?.getCanvas() ?? null : null
    if (isScanning) {
      return
    }
    if (mode === 'write' && (!canvas || !hasInk)) {
      return
    }
    if (mode === 'image' && !imageFile) {
      return
    }

    const image = imageRef.current
    const selectedArea =
      mode === 'image' && selection && image && image.naturalWidth && image.naturalHeight
        ? toPixelRectangle(selection, image.naturalWidth, image.naturalHeight)
        : null

    let source: File | HTMLCanvasElement | null = null
    if (mode === 'write' && canvas) {
      source = cropToInk(canvas)
    } else if (mode === 'image' && imageFile) {
      source = imageFile
    }

    if (!source) {
      return
    }

    setIsScanning(true)
    setError('')
    setText(null)
    setStatus('Preparing')
    setProgress(0)

    try {
      const recognized = await recognizeImage(source, {
        rectangle: selectedArea,
        onProgress: (label, progressValue) => {
          setStatus(label)
          setProgress(progressValue)
        },
      })

      setText(recognized)
      setStatus(recognized ? 'Finished' : 'Finished, no text found')
      setProgress(1)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not read the text.'

      setError(message)
      setStatus('')
      setProgress(null)
    } finally {
      setIsScanning(false)
    }
  }

  const progressPercent =
    progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const boxStyle = selection ? selectionStyle(selection, imageMetrics) : null
  const imageReady = imageMetrics.naturalWidth > 0 && imageMetrics.naturalHeight > 0

  let frameClassName = 'preview-frame'
  if (isScanning) {
    frameClassName += ' is-disabled'
  }

  let buttonLabel = 'Read text'
  if (isScanning) {
    buttonLabel = 'Scanning…'
  } else if (mode === 'write') {
    buttonLabel = 'Read writing'
  } else if (selection) {
    buttonLabel = 'Read selected area'
  }

  let canSubmit = false
  if (!isScanning && mode === 'write') {
    canSubmit = hasInk
  }
  if (!isScanning && mode === 'image') {
    canSubmit = Boolean(imageFile) && imageReady
  }

  return (
    <main className="ocr">
      <h1>Read text</h1>
      <p className="lede">
        Upload an image or write on the pad, then scan it. On an image, drag to choose the area to
        read. Recognition uses English and runs in your browser.
      </p>

      <form className="ocr-form" onSubmit={handleSubmit}>
        <div className="mode-switch" role="group" aria-label="Input">
          <button
            type="button"
            aria-pressed={mode === 'image'}
            onClick={() => handleModeChange('image')}
            disabled={isScanning}
          >
            Image
          </button>
          <button
            type="button"
            aria-pressed={mode === 'write'}
            onClick={() => handleModeChange('write')}
            disabled={isScanning}
          >
            Write
          </button>
        </div>

        <div className="input-panel" hidden={mode !== 'image'}>
        <label className="file-field" htmlFor="image">
          Image
          <input
            id="image"
            name="image"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            disabled={isScanning}
          />
        </label>

        {previewUrl ? (
          <>
            <div
              className={frameClassName}
              onPointerDown={handlePointerDown}
              onPointerMove={updateDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              aria-describedby="selection-hint"
            >
              <img
                ref={imageRef}
                className="preview"
                src={previewUrl}
                alt="Preview of the selected image"
                draggable={false}
                onLoad={() => {
                  const image = imageRef.current
                  if (image) {
                    const next = readMetrics(image)
                    setImageMetrics((current) => {
                      if (metricsMatch(current, next)) {
                        return current
                      }

                      return next
                    })
                  }
                }}
              />
              {boxStyle ? <div className="selection" style={boxStyle} /> : null}
            </div>
            <p className="preview-hint" id="selection-hint">
              Drag on the image to select the area to read.
            </p>
          </>
        ) : null}
        </div>

        <div className="input-panel" hidden={mode !== 'write'}>
          <HandwritingPad ref={writingRef} disabled={isScanning} onInkChange={setHasInk} />
        </div>

        <div className="actions">
          <button className="scan-button" type="submit" disabled={!canSubmit}>
            {buttonLabel}
          </button>
          {mode === 'image' && selection ? (
            <button
              className="text-button"
              type="button"
              onClick={() => setSelection(null)}
              disabled={isScanning}
            >
              Clear selection
            </button>
          ) : null}
          {mode === 'write' && hasInk ? (
            <button
              className="text-button"
              type="button"
              onClick={() => writingRef.current?.clear()}
              disabled={isScanning}
            >
              Clear writing
            </button>
          ) : null}
        </div>
      </form>

      {isScanning || status ? (
        <div className="progress" aria-live="polite">
          <p>
            {status}
            {progressPercent !== null ? ` (${progressPercent}%)` : ''}
          </p>
          {isScanning ? <progress value={progress ?? 0} max={1} /> : null}
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {text !== null ? (
        <section className="result">
          <h2>Text</h2>
          <pre>{text || 'No text was found.'}</pre>
        </section>
      ) : null}
    </main>
  )
}

export default App
