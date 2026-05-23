import { env as publicEnv } from "$env/dynamic/public";
import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import { applyChanges, readDelimitedFrames } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { EntityURN } from "$lib/rcrs/urns";
import { extract7zAllFiles } from "$lib/sevenzip";
import type { PerceptionWorkerMsg } from "$lib/stores/perception.worker";
import PerceptionWorker from "$lib/stores/perception.worker?worker";
import {
  baseEntities,
  commTimeline,
  computeSimEvents,
  currentStep,
  downloadProgress,
  downloadSize,
  errorMsg,
  extractProgress,
  handleLogFrame,
  initialBlockadeCost,
  loading,
  mode,
  parseProgress,
  perceptionChangesRaw,
  perceptionTimeline,
  rebuildState,
  resetSimulationState,
  timeline,
  type CommMessage,
} from "$lib/stores/simulation";

async function loadRaw(raw: ArrayBuffer, filename = "archive.7z") {
  extractProgress.set(0);
  let pendingPct = 0;
  let rafScheduled = false;
  const files = await extract7zAllFiles(raw, filename, (pct) => {
    pendingPct = pct;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        extractProgress.set(pendingPct);
      });
    }
  });
  extractProgress.set(null);

  // .xz/.lzma: single raw RCRS log (delimited LogProto frame stream)
  const rawLog = files.get("__raw_log__");
  if (rawLog) {
    parseProgress.set(0);
    let lastYield = Date.now();
    for (const frame of readDelimitedFrames(
      rawLog.buffer as ArrayBuffer,
      (pos, total) => parseProgress.set(pos / total),
    )) {
      const msg = LogProtoCodec.decode(frame);
      // Discard civilian PERCEPTION frames before handleLogFrame to save memory
      if (
        msg.perception !== undefined &&
        baseEntities.get(msg.perception.entityID)?.urn === EntityURN.CIVILIAN
      )
        continue;
      handleLogFrame(msg);
      // Yield to the browser periodically so the UI can re-render
      if (Date.now() - lastYield > 16) {
        await new Promise<void>((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    }
    finishFileLoad();
    return;
  }

  // INITIAL_CONDITIONS may be at top level or inside a subdirectory (e.g. rescue.log/)
  const configKey = Array.from(files.keys()).find((k) => k.endsWith("CONFIG"));
  if (configKey) {
    handleLogFrame(LogProtoCodec.decode(files.get(configKey)!));
    files.delete(configKey);
  }

  const initialKey = Array.from(files.keys()).find((k) =>
    k.endsWith("INITIAL_CONDITIONS"),
  );
  if (initialKey) {
    handleLogFrame(LogProtoCodec.decode(files.get(initialKey)!));
    files.delete(initialKey);
  }

  // Collect all N/UPDATES and N/COMMANDS entries and process in numeric order
  function collectStepFiles(suffix: string) {
    return Array.from(files.keys())
      .filter((k) => k.endsWith(suffix))
      .map((k) => {
        const parts = k.split("/");
        const step = parseInt(parts[parts.length - 2], 10);
        return { step, key: k };
      })
      .filter(({ step }) => !isNaN(step))
      .sort((a, b) => a.step - b.step);
  }

  const updateKeys = collectStepFiles("/UPDATES");
  const commandKeys = collectStepFiles("/COMMANDS");
  const percKeys = Array.from(files.keys()).filter((k) =>
    k.includes("/PERCEPTION/"),
  );
  // totalFiles will be updated once percEntries is built (percKeys may include
  // invalid entries that get filtered out, so we can't use percKeys.length here).
  let totalFiles = updateKeys.length + commandKeys.length + percKeys.length;
  let parsedFiles = 0;
  parseProgress.set(0);
  let lastYield = Date.now();

  // Helper to yield to the browser if more than ~16ms has passed
  async function maybeYield() {
    if (Date.now() - lastYield > 16) {
      await new Promise<void>((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  for (const { key } of updateKeys) {
    handleLogFrame(LogProtoCodec.decode(files.get(key)!));
    files.delete(key);
    parseProgress.set(++parsedFiles / totalFiles);
    await maybeYield();
  }

  for (const { key } of commandKeys) {
    handleLogFrame(LogProtoCodec.decode(files.get(key)!));
    files.delete(key);
    parseProgress.set(++parsedFiles / totalFiles);
    await maybeYield();
  }

  // N/PERCEPTION/agentId 形式のファイルを Worker でバックグラウンドパース。
  // メインスレッドはすぐに続行し、UPDATES/COMMANDS パース後にシミュを利用可能にする。
  const civilianIds = Array.from(baseEntities.entries())
    .filter(([, e]) => e.urn === EntityURN.CIVILIAN)
    .map(([id]) => id);

  const percEntries: { step: number; agentId: number; bytes: Uint8Array }[] =
    [];
  for (const k of percKeys) {
    const parts = k.split("/");
    const percIdx = parts.indexOf("PERCEPTION");
    if (percIdx < 1) continue;
    const step = parseInt(parts[percIdx - 1], 10);
    const agentId = parseInt(parts[percIdx + 1], 10);
    if (isNaN(step) || isNaN(agentId)) continue;
    const bytes = files.get(k);
    if (bytes) percEntries.push({ step, agentId, bytes });
    files.delete(k);
  }

  // Recalculate totalFiles now that we know the exact number of valid entries.
  totalFiles = parsedFiles + percEntries.length;
  parseProgress.set(parsedFiles / totalFiles);

  // Run PERCEPTION parsing in a worker and await completion before making
  // the simulation available. The worker runs on another thread so UPDATES/
  // COMMANDS are already decoded while it works.
  await parsePerceptionEntries(percEntries, civilianIds, parsedFiles, totalFiles);

  finishFileLoad();
}

function finishFileLoad() {
  parseProgress.set(null);

  // ステップ1のスナップショットから瓦礫の初期 repairCost 合計を計算
  const step1 = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );
  const step1changes = timeline.get(1);
  if (step1changes) applyChanges(step1, step1changes);
  let totalCost = 0;
  for (const e of step1.values()) {
    if ("repairCost" in e)
      totalCost += (e as { repairCost: number }).repairCost;
  }
  initialBlockadeCost.set(totalCost);

  currentStep.set(0);
  rebuildState(0);
  computeSimEvents();
}

function parsePerceptionEntries(
  percEntries: { step: number; agentId: number; bytes: Uint8Array }[],
  civilianIds: number[],
  parsedFiles: number,
  totalFiles: number,
) {
  return new Promise<void>((resolve) => {
    const percWorker = new PerceptionWorker();
    percWorker.onmessage = (e: MessageEvent<PerceptionWorkerMsg>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        parseProgress.set((parsedFiles + msg.done) / totalFiles);
        return;
      }
      // type === "done": merge results
      for (const [step, agents] of msg.perceptionTimeline) {
        if (!perceptionTimeline.has(step)) perceptionTimeline.set(step, new Map());
        for (const [agentId, ids] of agents)
          perceptionTimeline.get(step)!.set(agentId, ids);
      }
      for (const [step, agents] of msg.commTimeline) {
        if (!commTimeline.has(step)) commTimeline.set(step, new Map());
        for (const [agentId, msgs] of agents)
          commTimeline.get(step)!.set(agentId, msgs as CommMessage[]);
      }
      for (const [step, agents] of msg.percChangesRaw) {
        if (!perceptionChangesRaw.has(step))
          perceptionChangesRaw.set(step, new Map());
        for (const [agentId, bytes] of agents)
          perceptionChangesRaw.get(step)!.set(agentId, bytes);
      }
      percWorker.terminate();
      resolve();
    };
    percWorker.onerror = (err: ErrorEvent) => {
      percWorker.terminate();
      console.warn(
        "PERCEPTION worker error — continuing without perception data:",
        err.message ?? err,
      );
      resolve();
    };
    // Transfer bytes to the worker to avoid duplicating memory.
    // Raw bytes for percChangesRaw are transferred back as Transferables.
    percWorker.postMessage(
      { entries: percEntries, civilianIds },
      percEntries.map((e) => e.bytes.buffer),
    );
  });
}

export async function loadFile(file: File) {
  loading.set(true);
  errorMsg.set(null);
  mode.set("file");
  resetSimulationState();
  try {
    await loadRaw(await file.arrayBuffer(), file.name);
  } catch (e) {
    errorMsg.set(`Failed to parse log file: ${e}`);
    mode.set("idle");
  } finally {
    loading.set(false);
  }
}

export async function loadUrl(
  url: string,
): Promise<"ok" | "not_found" | "error"> {
  loading.set(true);
  errorMsg.set(null);
  mode.set("file");
  resetSimulationState();
  const directFetch = publicEnv.PUBLIC_DIRECT_FETCH === "true";
  const fetchUrl =
    !directFetch && url.startsWith("http")
      ? `/fetch-proxy?url=${encodeURIComponent(url)}`
      : url;
  try {
    const res = await fetch(fetchUrl);
    if (res.status === 404) {
      mode.set("idle");
      return "not_found";
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Content-Length があれば進捗を表示、なければ不確定プログレス
    const contentLength = parseInt(
      res.headers.get("Content-Length") ?? "0",
      10,
    );
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    downloadProgress.set(contentLength > 0 ? 0 : -1);
    downloadSize.set(contentLength > 0 ? contentLength : null);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0)
        downloadProgress.set(Math.min(1, received / contentLength));
    }

    downloadProgress.set(null);
    downloadSize.set(null);

    // チャンクを結合して ArrayBuffer に変換
    const total = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      total.set(chunk, offset);
      offset += chunk.length;
    }

    const filename = url.split("/").pop()?.split("?")[0] ?? "archive.7z";
    await loadRaw(total.buffer, filename);
    return "ok";
  } catch (e) {
    downloadProgress.set(null);
    downloadSize.set(null);
    errorMsg.set(`Failed to load URL: ${e}`);
    mode.set("idle");
    return "error";
  } finally {
    loading.set(false);
  }
}
