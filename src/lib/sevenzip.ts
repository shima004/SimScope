import SevenZipWorker from "./sevenzip.worker?worker";

/**
 * Extract an archive in a Web Worker and return all contained files as a
 * path → bytes map.  Runs off the main thread to avoid browser "page
 * unresponsive" warnings on large files.
 *
 * Supports .7z, .tgz, .tar.gz, .xz, .lzma formats.
 * For single-file formats (.xz/.lzma) the map contains one entry keyed
 * "__raw_log__".
 */
export function extract7zAllFiles(
  buffer: ArrayBuffer,
  filename = "archive.7z",
): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const worker = new SevenZipWorker();

    worker.onmessage = (
      e: MessageEvent<
        | { ok: true; entries: [string, Uint8Array][] }
        | { ok: false; error: string }
      >,
    ) => {
      worker.terminate();
      if (e.data.ok) {
        resolve(new Map(e.data.entries));
      } else {
        reject(new Error(e.data.error));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    // Transfer the buffer to the worker (zero-copy)
    worker.postMessage({ buffer, filename }, [buffer]);
  });
}
