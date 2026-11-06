import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const nodeBuiltin = fileURLToPath(new URL('./src/shims/nodeBuiltin.js', import.meta.url))
const scribeCanvas = fileURLToPath(new URL('./src/shims/scribeCanvas.js', import.meta.url))

const nodeBuiltinNames = [
  'child_process',
  'crypto',
  'fs',
  'http',
  'https',
  'module',
  'os',
  'path',
  'stream',
  'url',
  'util',
  'worker_threads',
  'zlib',
]

const nodeAliases = nodeBuiltinNames.flatMap((name) => [
  { find: new RegExp(`^${name}$`), replacement: nodeBuiltin },
  { find: new RegExp(`^node:${name}$`), replacement: nodeBuiltin },
])

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs, so dist/ works from any directory, such as /ocr/dist/.
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      ...nodeAliases,
      { find: /^node:fs\/promises$/, replacement: nodeBuiltin },
      { find: /^@scribe\.js\/canvas(?:\/.*|-.*)?$/, replacement: scribeCanvas },
    ],
  },
  optimizeDeps: {
    exclude: ['scribe.js-ocr'],
  },
  worker: {
    format: 'es',
  },
  build: {
    // Scribe.js ships the OCR engine, fonts, and PDF support as large chunks.
    chunkSizeWarningLimit: 2000,
  },
})
