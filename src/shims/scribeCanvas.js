export class Canvas {
  constructor() {
    throw new Error('@scribe.js/canvas is only available in Node.js.')
  }
}

export const ImageData = globalThis.ImageData
export const DOMMatrix = globalThis.DOMMatrix

export default {
  Canvas,
  ImageData,
  DOMMatrix,
}
