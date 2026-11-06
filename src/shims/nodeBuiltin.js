function unavailable(name) {
  return () => {
    throw new Error(`${name} is only available in Node.js.`)
  }
}

const builtin = {
  readFile: unavailable('fs.readFile'),
  readFileSync: unavailable('fs.readFileSync'),
  promises: {
    readFile: unavailable('fs.promises.readFile'),
  },
  gunzipSync: unavailable('zlib.gunzipSync'),
  gzipSync: unavailable('zlib.gzipSync'),
  fileURLToPath: unavailable('url.fileURLToPath'),
  pathToFileURL: unavailable('url.pathToFileURL'),
  cpus: unavailable('os.cpus'),
  parentPort: null,
  createRequire: unavailable('module.createRequire'),
  randomFillSync: unavailable('crypto.randomFillSync'),
  basename: unavailable('path.basename'),
  dirname: unavailable('path.dirname'),
  join: unavailable('path.join'),
  Worker: class NodeWorker {
    constructor() {
      throw new Error('worker_threads.Worker is only available in Node.js.')
    }
  },
}

export const {
  readFile,
  readFileSync,
  promises,
  gunzipSync,
  gzipSync,
  fileURLToPath,
  pathToFileURL,
  cpus,
  parentPort,
  createRequire,
  randomFillSync,
  basename,
  dirname,
  join,
  Worker,
} = builtin

export default builtin
