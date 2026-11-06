import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { api, useMutation } from './data'
import { pocketBaseErrorMessage } from './data/pocketBaseError'
import { cropToInk, HandwritingPad, type HandwritingPadHandle } from './HandwritingPad'
import { ScanHistory } from './ScanHistory'
import {
  defaultAdjustments,
  fullCrop,
  isOriginalAdjustment,
  prepareImage,
  PREVIEW_LONG_EDGE,
  type ImageAdjustments,
  type NormalizedCrop,
} from './prepareImage'
import './App.css'

const MIN_CROP_PX = 48
const TAP_SLOP_PX = 8

type Point = {
  x: number
  y: number
}

type CropHandle = 'nw' | 'ne' | 'sw' | 'se'

type CropDrag = {
  kind: CropHandle | 'move'
  startPoint: Point
  startClient: Point
  startCrop: NormalizedCrop
}

type ImageMetrics = {
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
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

function normalizedPoint(event: ReactPointerEvent<HTMLElement>, image: HTMLImageElement): Point | null {
  const bounds = image.getBoundingClientRect()
  if (!bounds.width || !bounds.height) {
    return null
  }

  return {
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  }
}

function cropStyle(crop: NormalizedCrop, metrics: ImageMetrics): CSSProperties | null {
  if (!metrics.width || !metrics.height) {
    return null
  }

  return {
    left: crop.left * metrics.width,
    top: crop.top * metrics.height,
    width: crop.width * metrics.width,
    height: crop.height * metrics.height,
  }
}

function minimumCrop(metrics: ImageMetrics) {
  return {
    width: metrics.width > 0 ? Math.min(1, MIN_CROP_PX / metrics.width) : 1,
    height: metrics.height > 0 ? Math.min(1, MIN_CROP_PX / metrics.height) : 1,
  }
}

function movedCrop(drag: CropDrag, point: Point, metrics: ImageMetrics): NormalizedCrop {
  const minimum = minimumCrop(metrics)
  const start = drag.startCrop

  if (drag.kind === 'move') {
    const width = start.width
    const height = start.height

    return {
      left: clamp(start.left + (point.x - drag.startPoint.x), 0, 1 - width),
      top: clamp(start.top + (point.y - drag.startPoint.y), 0, 1 - height),
      width,
      height,
    }
  }

  const right = start.left + start.width
  const bottom = start.top + start.height

  if (drag.kind === 'nw') {
    const left = clamp(point.x, 0, right - minimum.width)
    const top = clamp(point.y, 0, bottom - minimum.height)
    return { left, top, width: right - left, height: bottom - top }
  }

  if (drag.kind === 'ne') {
    const top = clamp(point.y, 0, bottom - minimum.height)
    const nextRight = clamp(point.x, start.left + minimum.width, 1)
    return { left: start.left, top, width: nextRight - start.left, height: bottom - top }
  }

  if (drag.kind === 'sw') {
    const left = clamp(point.x, 0, right - minimum.width)
    const nextBottom = clamp(point.y, start.top + minimum.height, 1)
    return { left, top: start.top, width: right - left, height: nextBottom - start.top }
  }

  const nextRight = clamp(point.x, start.left + minimum.width, 1)
  const nextBottom = clamp(point.y, start.top + minimum.height, 1)
  return {
    left: start.left,
    top: start.top,
    width: nextRight - start.left,
    height: nextBottom - start.top,
  }
}

function cameraErrorMessage(caught: unknown) {
  if (caught instanceof DOMException) {
    if (caught.name === 'NotAllowedError' || caught.name === 'SecurityError') {
      return 'Camera access was blocked. Allow the camera for this site, then try again.'
    }
    if (caught.name === 'NotFoundError' || caught.name === 'OverconstrainedError') {
      return 'No camera was found.'
    }
    if (caught.name === 'NotReadableError') {
      return 'The camera is already in use by another application.'
    }
    if (caught.name === 'NotSupportedError') {
      return 'This browser cannot use the camera.'
    }
  }

  return 'Could not open the camera.'
}

async function requestCameraStream() {
  const devices = navigator.mediaDevices
  if (!devices?.getUserMedia) {
    throw new DOMException('Camera is unavailable.', 'NotSupportedError')
  }

  try {
    return await devices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    })
  } catch (caught) {
    if (
      caught instanceof DOMException &&
      (caught.name === 'NotAllowedError' ||
        caught.name === 'SecurityError' ||
        caught.name === 'NotSupportedError')
    ) {
      throw caught
    }

    return devices.getUserMedia({ audio: false, video: true })
  }
}

function photoFileFromVideo(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context || !canvas.width || !canvas.height) {
    return Promise.reject(new Error('Could not take the photo.'))
  }

  context.drawImage(video, 0, 0)

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((jpeg) => {
      if (jpeg) {
        resolve(new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }))
        return
      }

      canvas.toBlob((png) => {
        if (!png) {
          reject(new Error('Could not take the photo.'))
          return
        }

        resolve(new File([png], 'photo.png', { type: 'image/png' }))
      }, 'image/png')
    }, 'image/jpeg', 0.92)
  })
}

function canvasToPngFile(canvas: HTMLCanvasElement) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not save the writing.'))
        return
      }

      resolve(new File([blob], 'writing.png', { type: 'image/png' }))
    }, 'image/png')
  })
}

function cropHandleFromEvent(event: ReactPointerEvent<HTMLElement>): CropHandle | null {
  const target = event.target
  if (!(target instanceof Element)) {
    return null
  }

  const handle = target.closest('[data-handle]')
  if (!(handle instanceof HTMLElement)) {
    return null
  }

  const name = handle.dataset.handle
  if (name === 'nw' || name === 'ne' || name === 'sw' || name === 'se') {
    return name
  }

  return null
}

function App() {
  const imageRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraRequestRef = useRef(0)
  const writingRef = useRef<HandwritingPadHandle>(null)
  const sourceFileRef = useRef<File | null>(null)
  const adjustmentsRef = useRef<ImageAdjustments>(defaultAdjustments())
  const cropDragRef = useRef<CropDrag | null>(null)
  const prepareRequestRef = useRef(0)
  const [mode, setMode] = useState<InputMode>('image')
  const [hasSource, setHasSource] = useState(false)
  const [sourceId, setSourceId] = useState(0)
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(defaultAdjustments)
  const [preparing, setPreparing] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics>(emptyMetrics)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const saveScan = useMutation(api.scans.create)

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  useEffect(() => {
    return () => {
      const stream = streamRef.current
      streamRef.current = null
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
      }
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!cameraOpen || !video || !stream) {
      return
    }

    video.srcObject = stream

    const markReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setCameraReady(true)
      }
    }

    video.addEventListener('loadedmetadata', markReady)
    video.addEventListener('resize', markReady)
    markReady()

    const playback = video.play()
    if (playback) {
      playback.catch(() => {
        // Playback starts once the camera has a frame. The shutter stays disabled until then.
      })
    }

    return () => {
      video.removeEventListener('loadedmetadata', markReady)
      video.removeEventListener('resize', markReady)
      video.srcObject = null
    }
  }, [cameraOpen])

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

  useEffect(() => {
    const source = sourceFileRef.current
    if (!source || cameraOpen) {
      return
    }

    const requestId = prepareRequestRef.current + 1
    prepareRequestRef.current = requestId
    const settings: ImageAdjustments = {
      quarterTurns: adjustments.quarterTurns,
      straighten: adjustments.straighten,
      brightness: adjustments.brightness,
      contrast: adjustments.contrast,
      crop: fullCrop(),
    }

    setPreparing(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const prepared = await prepareImage(source, settings, {
            maxEdge: PREVIEW_LONG_EDGE,
            applyCrop: false,
          })
          if (prepareRequestRef.current !== requestId) {
            return
          }

          setPreviewUrl(URL.createObjectURL(prepared))
        } catch (caught) {
          if (prepareRequestRef.current !== requestId) {
            return
          }

          const message = caught instanceof Error ? caught.message : 'Could not prepare the image.'
          setError(message)
        } finally {
          if (prepareRequestRef.current === requestId) {
            setPreparing(false)
          }
        }
      })()
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    sourceId,
    cameraOpen,
    adjustments.quarterTurns,
    adjustments.straighten,
    adjustments.brightness,
    adjustments.contrast,
  ])

  function stopCamera() {
    cameraRequestRef.current += 1
    const stream = streamRef.current
    streamRef.current = null
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }

    setCameraOpen(false)
    setCameraReady(false)
    setCameraStarting(false)
  }

  function clearResult() {
    setText(null)
    setError('')
    setStatus('')
    setProgress(null)
  }

  function changeAdjustments(recipe: (current: ImageAdjustments) => ImageAdjustments) {
    const next = recipe(adjustmentsRef.current)
    adjustmentsRef.current = next
    setAdjustments(next)
    clearResult()
  }

  function applyImageFile(file: File | null) {
    prepareRequestRef.current += 1
    sourceFileRef.current = file
    cropDragRef.current = null
    setHasSource(Boolean(file))
    setSourceId((current) => current + 1)
    const nextAdjustments = defaultAdjustments()
    adjustmentsRef.current = nextAdjustments
    setAdjustments(nextAdjustments)
    setPreparing(false)
    setPreviewUrl(null)
    setImageMetrics(emptyMetrics)
    setCameraError('')
    clearResult()
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    stopCamera()
    applyImageFile(file)
  }

  async function openCamera() {
    if (isScanning || cameraOpen || cameraStarting) {
      return
    }

    const requestId = cameraRequestRef.current + 1
    cameraRequestRef.current = requestId
    setCameraError('')
    setCameraStarting(true)

    try {
      const stream = await requestCameraStream()
      if (cameraRequestRef.current !== requestId) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }

      streamRef.current = stream
      setCameraReady(false)
      setCameraOpen(true)
    } catch (caught) {
      if (cameraRequestRef.current !== requestId) {
        return
      }

      setCameraError(cameraErrorMessage(caught))
    } finally {
      if (cameraRequestRef.current === requestId) {
        setCameraStarting(false)
      }
    }
  }

  async function takePhoto() {
    const video = videoRef.current
    if (!video || !cameraReady) {
      return
    }

    try {
      const file = await photoFileFromVideo(video)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      stopCamera()
      applyImageFile(file)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not take the photo.'
      setCameraError(message)
    }
  }

  function handleModeChange(next: InputMode) {
    if (next === mode || isScanning) {
      return
    }

    if (next !== 'image') {
      stopCamera()
    }

    setMode(next)
    clearResult()
    setCameraError('')
  }

  function rotate(direction: 1 | -1) {
    changeAdjustments((current) => ({
      ...current,
      quarterTurns: (current.quarterTurns + direction + 4) % 4,
      crop: fullCrop(),
    }))
  }

  function handleCropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current
    if (!image || isScanning || event.button !== 0) {
      return
    }

    const point = normalizedPoint(event, image)
    if (!point) {
      return
    }

    const handle = cropHandleFromEvent(event)
    const crop = adjustmentsRef.current.crop
    const inside =
      point.x >= crop.left &&
      point.x <= crop.left + crop.width &&
      point.y >= crop.top &&
      point.y <= crop.top + crop.height

    if (!handle && !inside) {
      return
    }

    cropDragRef.current = {
      kind: handle ?? 'move',
      startPoint: point,
      startClient: { x: event.clientX, y: event.clientY },
      startCrop: { ...crop },
    }
    event.preventDefault()

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and some pointer events cannot be captured. Dragging still tracks while the pointer stays over the image.
    }
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current
    const drag = cropDragRef.current
    if (!image || !drag) {
      return
    }

    const point = normalizedPoint(event, image)
    if (!point) {
      return
    }

    const next = {
      ...adjustmentsRef.current,
      crop: movedCrop(drag, point, readMetrics(image)),
    }
    adjustmentsRef.current = next
    setAdjustments(next)
  }

  function handleCropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current
    cropDragRef.current = null
    if (!drag) {
      return
    }

    const distance = Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y)
    if (distance < TAP_SLOP_PX) {
      const next = { ...adjustmentsRef.current, crop: drag.startCrop }
      adjustmentsRef.current = next
      setAdjustments(next)
      return
    }

    clearResult()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const canvas = mode === 'write' ? writingRef.current?.getCanvas() ?? null : null
    const source = sourceFileRef.current
    if (isScanning || preparing) {
      return
    }
    if (mode === 'write' && (!canvas || !hasInk)) {
      return
    }
    if (mode === 'image' && !source) {
      return
    }

    setIsScanning(true)
    setError('')
    setSaveError('')
    setText(null)
    setStatus('Preparing')
    setProgress(0)

    try {
      let scanSource: File | HTMLCanvasElement | null = null
      if (mode === 'write' && canvas) {
        scanSource = cropToInk(canvas)
      } else if (mode === 'image' && source) {
        scanSource = await prepareImage(source, adjustmentsRef.current, { applyCrop: true })
      }

      if (!scanSource) {
        return
      }

      const { recognizeImage } = await import('./recognize')
      const recognized = await recognizeImage(scanSource, {
        onProgress: (label, progressValue) => {
          setStatus(label)
          setProgress(progressValue)
        },
      })

      setText(recognized)
      setStatus(recognized ? 'Finished' : 'Finished, no text found')
      setProgress(1)

      try {
        const image = scanSource instanceof HTMLCanvasElement ? await canvasToPngFile(scanSource) : scanSource
        await saveScan({
          text: recognized,
          image,
          kind: mode === 'write' ? 'writing' : 'image',
        })
      } catch (caught) {
        setSaveError(pocketBaseErrorMessage(caught, 'The text was read, but it could not be saved.'))
      }
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
  const frameStyle = cropStyle(adjustments.crop, imageMetrics)
  const imageReady = imageMetrics.naturalWidth > 0 && imageMetrics.naturalHeight > 0
  const original = isOriginalAdjustment(adjustments)

  let frameClassName = 'preview-frame'
  if (isScanning) {
    frameClassName += ' is-disabled'
  }

  let buttonLabel = 'Read text'
  if (isScanning) {
    buttonLabel = 'Scanning…'
  } else if (mode === 'write') {
    buttonLabel = 'Read writing'
  }

  let canSubmit = false
  if (!isScanning && mode === 'write') {
    canSubmit = hasInk
  }
  if (!isScanning && !preparing && mode === 'image') {
    canSubmit = hasSource && imageReady
  }

  return (
    <main className="ocr">
      <h1>Read text</h1>
      <p className="lede">
        Upload an image, take a photo, or write on the pad, then scan it. On an image, rotate and
        crop it, then adjust brightness and contrast so the text is clear. Recognition uses English
        and runs in your browser.
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
          <div className="image-sources">
            <label className="file-field" htmlFor="image">
              Image
              <input
                ref={fileInputRef}
                id="image"
                name="image"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isScanning}
              />
            </label>
            <button
              className="scan-button"
              type="button"
              onClick={() => {
                void openCamera()
              }}
              disabled={isScanning || cameraOpen || cameraStarting}
            >
              {cameraStarting ? 'Opening camera…' : 'Use camera'}
            </button>
          </div>

          {cameraError ? (
            <p className="error" role="alert">
              {cameraError}
            </p>
          ) : null}

          {cameraOpen ? (
            <div className="camera-frame">
              <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" />
              <div className="actions">
                <button
                  className="scan-button"
                  type="button"
                  onClick={() => {
                    void takePhoto()
                  }}
                  disabled={!cameraReady || isScanning}
                >
                  Take photo
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={stopCamera}
                  disabled={isScanning}
                >
                  Close camera
                </button>
              </div>
            </div>
          ) : null}

          {hasSource && !previewUrl && !cameraOpen ? <p className="preview-hint">Preparing the photo…</p> : null}

          {previewUrl && !cameraOpen ? (
            <>
              <div
                className={frameClassName}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerCancel={handleCropPointerUp}
                aria-describedby="crop-hint"
              >
                <img
                  ref={imageRef}
                  className="preview"
                  src={previewUrl}
                  alt="Preview of the photo to read"
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
                {frameStyle ? (
                  <div className="crop" style={frameStyle}>
                    <button type="button" className="crop-handle" data-handle="nw" aria-label="Resize crop from the top left" />
                    <button type="button" className="crop-handle" data-handle="ne" aria-label="Resize crop from the top right" />
                    <button type="button" className="crop-handle" data-handle="sw" aria-label="Resize crop from the bottom left" />
                    <button type="button" className="crop-handle" data-handle="se" aria-label="Resize crop from the bottom right" />
                  </div>
                ) : null}
              </div>
              <p className="preview-hint" id="crop-hint">
                Drag the frame to move the area to read. Drag a corner to resize it.
              </p>
              <div className="prep">
                <div className="prep-row">
                  <button type="button" onClick={() => rotate(-1)} disabled={isScanning}>
                    Rotate left
                  </button>
                  <button type="button" onClick={() => rotate(1)} disabled={isScanning}>
                    Rotate right
                  </button>
                </div>
                <label className="prep-slider">
                  Straighten ({adjustments.straighten}°)
                  <input
                    type="range"
                    min={-20}
                    max={20}
                    step={1}
                    value={adjustments.straighten}
                    aria-valuetext={`${adjustments.straighten} degrees`}
                    disabled={isScanning}
                    onChange={(event) => {
                      const straighten = Number(event.target.value)
                      changeAdjustments((current) => ({ ...current, straighten, crop: fullCrop() }))
                    }}
                  />
                </label>
                <label className="prep-slider">
                  Brightness ({Math.round(adjustments.brightness * 100)}%)
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={5}
                    value={Math.round(adjustments.brightness * 100)}
                    aria-valuetext={`${Math.round(adjustments.brightness * 100)} percent`}
                    disabled={isScanning}
                    onChange={(event) => {
                      const brightness = Number(event.target.value) / 100
                      changeAdjustments((current) => ({ ...current, brightness }))
                    }}
                  />
                </label>
                <label className="prep-slider">
                  Contrast ({Math.round(adjustments.contrast * 100)}%)
                  <input
                    type="range"
                    min={50}
                    max={250}
                    step={5}
                    value={Math.round(adjustments.contrast * 100)}
                    aria-valuetext={`${Math.round(adjustments.contrast * 100)} percent`}
                    disabled={isScanning}
                    onChange={(event) => {
                      const contrast = Number(event.target.value) / 100
                      changeAdjustments((current) => ({ ...current, contrast }))
                    }}
                  />
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => changeAdjustments(() => defaultAdjustments())}
                  disabled={isScanning || original}
                >
                  Reset
                </button>
              </div>
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

      {saveError ? (
        <p className="error" role="alert">
          {saveError}
        </p>
      ) : null}

      <ScanHistory />
    </main>
  )
}

export default App
