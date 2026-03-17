import SevenZipFactory from '7z-wasm'
import type { SevenZipModule } from '7z-wasm'
import wasmUrl from '7z-wasm/7zz.wasm?url'

let modulePromise: Promise<SevenZipModule> | null = null
let extractCounter = 0

function getModule(): Promise<SevenZipModule> {
  if (!modulePromise) {
    modulePromise = SevenZipFactory({ locateFile: () => wasmUrl })
  }
  return modulePromise
}

function collectAllFiles(
  sz: SevenZipModule,
  dir: string,
  prefix: string,
  result: Map<string, Uint8Array>,
) {
  for (const name of sz.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    if (name.endsWith(':Zone.Identifier')) continue

    const fullPath = `${dir}/${name}`
    const relPath = prefix ? `${prefix}/${name}` : name
    const stat = sz.FS.stat(fullPath)

    if (sz.FS.isDir(stat.mode)) {
      collectAllFiles(sz, fullPath, relPath, result)
    } else {
      result.set(relPath, sz.FS.readFile(fullPath))
    }
  }
}

function cleanupDir(sz: SevenZipModule, dir: string) {
  for (const name of sz.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    const path = `${dir}/${name}`
    const stat = sz.FS.stat(path)
    if (sz.FS.isDir(stat.mode)) {
      cleanupDir(sz, path)
      sz.FS.rmdir(path)
    } else {
      sz.FS.unlink(path)
    }
  }
}

/**
 * Extract a .7z archive and return all contained files as a path → bytes map.
 * Paths are relative (e.g. "INITIAL_CONDITIONS", "1/UPDATES").
 * Windows Zone.Identifier alternate data stream files are excluded.
 */
export async function extract7zAllFiles(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const sz = await getModule()
  const id = ++extractCounter
  const inPath = `/in_${id}.7z`
  const outDir = `/out_${id}`

  sz.FS.writeFile(inPath, new Uint8Array(buffer))
  sz.FS.mkdir(outDir)

  sz.callMain(['x', inPath, `-o${outDir}`, '-y'])

  const result = new Map<string, Uint8Array>()
  collectAllFiles(sz, outDir, '', result)

  cleanupDir(sz, outDir)
  sz.FS.rmdir(outDir)
  sz.FS.unlink(inPath)

  return result
}
