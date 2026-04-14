import type { SevenZipModule } from "7z-wasm";
import SevenZipFactory from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";

let modulePromise: Promise<SevenZipModule> | null = null;
let extractCounter = 0;

// Mutable print handler — passed to Emscripten at init time via a wrapper closure.
// Emscripten binds the print function at initialization, so we can't replace it
// afterward. Instead we keep a single wrapper that delegates to this variable.
let printHandler: ((line: string) => void) | null = null;

function getModule(): Promise<SevenZipModule> {
  if (!modulePromise) {
    modulePromise = SevenZipFactory({
      locateFile: () => wasmUrl,
      print: (line: string) => printHandler?.(line),
    });
  }
  return modulePromise;
}

function collectAllFiles(
  sz: SevenZipModule,
  dir: string,
  prefix: string,
  result: Map<string, Uint8Array>,
) {
  for (const name of sz.FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    if (name.endsWith(":Zone.Identifier")) continue;

    const fullPath = `${dir}/${name}`;
    const relPath = prefix ? `${prefix}/${name}` : name;
    const stat = sz.FS.stat(fullPath);

    if (sz.FS.isDir(stat.mode)) {
      collectAllFiles(sz, fullPath, relPath, result);
    } else {
      result.set(relPath, sz.FS.readFile(fullPath));
    }
  }
}

function cleanupDir(sz: SevenZipModule, dir: string) {
  for (const name of sz.FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const path = `${dir}/${name}`;
    const stat = sz.FS.stat(path);
    if (sz.FS.isDir(stat.mode)) {
      cleanupDir(sz, path);
      sz.FS.rmdir(path);
    } else {
      sz.FS.unlink(path);
    }
  }
}

// Send progress to main thread (0–100)
function sendProgress(pct: number) {
  self.postMessage({ ok: "progress", pct });
}

// Extract with progress. Output format with -bb1: " XX% NNNNN\b...\b- filepath"
// Throttle to 1% increments to avoid flooding the main thread with messages.
function extractWithProgress(
  sz: SevenZipModule,
  inPath: string,
  outDir: string,
) {
  let lastPct = -1;
  printHandler = (line: string) => {
    const m = line.match(/^\s*(\d+)%/);
    if (!m) return;
    const pct = parseInt(m[1], 10);
    if (pct !== lastPct) {
      lastPct = pct;
      sendProgress(pct);
    }
  };
  try {
    sz.callMain(["x", inPath, `-o${outDir}`, "-y", "-bb1"]);
  } finally {
    printHandler = null;
  }
}

async function extract(
  buffer: ArrayBuffer,
  filename: string,
): Promise<Map<string, Uint8Array>> {
  const sz = await getModule();
  const id = ++extractCounter;

  let ext: string;
  if (filename.endsWith(".tar.gz")) {
    ext = ".tgz";
  } else {
    ext = filename.slice(filename.lastIndexOf("."));
  }

  const inPath = `/in_${id}${ext}`;
  const outDir = `/out_${id}`;

  sz.FS.writeFile(inPath, new Uint8Array(buffer));
  sz.FS.mkdir(outDir);
  extractWithProgress(sz, inPath, outDir);

  if (ext === ".tgz") {
    const entries = sz.FS.readdir(outDir).filter(
      (n: string) => n !== "." && n !== "..",
    );
    const tarName = entries.find((n: string) => n.endsWith(".tar"));
    if (tarName) {
      const tarPath = `${outDir}/${tarName}`;
      const tarOutDir = `/out_${id}_tar`;
      sz.FS.mkdir(tarOutDir);
      sz.callMain(["x", tarPath, `-o${tarOutDir}`, "-y"]);
      sz.FS.unlink(tarPath);

      const result = new Map<string, Uint8Array>();
      collectAllFiles(sz, tarOutDir, "", result);
      cleanupDir(sz, tarOutDir);
      sz.FS.rmdir(tarOutDir);
      cleanupDir(sz, outDir);
      sz.FS.rmdir(outDir);
      sz.FS.unlink(inPath);
      return result;
    }
  }

  if (ext === ".xz" || ext === ".lzma") {
    const entries = sz.FS.readdir(outDir).filter(
      (n: string) => n !== "." && n !== "..",
    );
    if (entries.length === 1) {
      const rawPath = `${outDir}/${entries[0]}`;
      const bytes = sz.FS.readFile(rawPath);
      sz.FS.unlink(rawPath);
      sz.FS.rmdir(outDir);
      sz.FS.unlink(inPath);
      return new Map([["__raw_log__", bytes]]);
    }
  }

  const result = new Map<string, Uint8Array>();
  collectAllFiles(sz, outDir, "", result);
  cleanupDir(sz, outDir);
  sz.FS.rmdir(outDir);
  sz.FS.unlink(inPath);
  return result;
}

self.onmessage = async (
  e: MessageEvent<{ buffer: ArrayBuffer; filename: string }>,
) => {
  try {
    const files = await extract(e.data.buffer, e.data.filename);
    // Uint8Array の underlying buffer を transfer して zero-copy で返す
    const entries = Array.from(files.entries());
    const transfers: Transferable[] = entries.map(
      ([, v]) => v.buffer as ArrayBuffer,
    );
    (self as unknown as Worker).postMessage({ ok: true, entries }, transfers);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
