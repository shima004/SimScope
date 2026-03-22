import type { SevenZipModule } from "7z-wasm";
import SevenZipFactory from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";

let modulePromise: Promise<SevenZipModule> | null = null;
let extractCounter = 0;

function getModule(): Promise<SevenZipModule> {
  if (!modulePromise) {
    modulePromise = SevenZipFactory({ locateFile: () => wasmUrl });
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

/**
 * Extract an archive and return all contained files as a path → bytes map.
 * Paths are relative (e.g. "INITIAL_CONDITIONS", "1/UPDATES").
 * Windows Zone.Identifier alternate data stream files are excluded.
 * Supports .7z, .tgz, .tar.gz, .xz, .lzma formats.
 *
 * For single-file formats (.xz/.lzma) that decompress to a raw RCRS log,
 * the map will contain a single entry keyed "__raw_log__".
 */
export async function extract7zAllFiles(
  buffer: ArrayBuffer,
  filename = "archive.7z",
): Promise<Map<string, Uint8Array>> {
  const sz = await getModule();
  const id = ++extractCounter;

  // Normalise extensions to a single token
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
  sz.callMain(["x", inPath, `-o${outDir}`, "-y"]);

  // .tgz extracts to a single .tar file — run a second pass to expand it
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

  // .xz / .lzma decompresses to a single raw file (RCRS log frame stream)
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
