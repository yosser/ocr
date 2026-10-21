declare module 'scribe.js-ocr' {
  type ProgressMessage = {
    type?: string
    n?: number
    info?: {
      status?: string
      pct?: number
      stage?: string
    }
  }

  type ScribeDoc = {
    recognize: (options?: {
      langs?: string[]
      mode?: 'speed' | 'quality'
    }) => Promise<unknown>
    exportData: (format?: string) => Promise<string | ArrayBuffer>
    close: () => Promise<void>
  }

  const scribe: {
    opt: {
      workerN: number | null
      progressHandler: (message: ProgressMessage) => void
    }
    openDocument: (files: File[] | FileList) => Promise<ScribeDoc>
  }

  export default scribe
}
