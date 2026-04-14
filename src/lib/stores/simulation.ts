import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import type { ChangeSetProto, EntityProto } from "$lib/proto/RCRSProto";
import {
  applyChanges,
  decodeEntity,
  readDelimitedFrames,
} from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import {
  CommandURN,
  ComponentCommandURN,
  ComponentControlMsgURN,
  EntityURN,
  isAgent,
  isArea,
} from "$lib/rcrs/urns";
import { extract7zAllFiles } from "$lib/sevenzip";
import type { PerceptionResult } from "$lib/stores/perception.worker";
import PerceptionWorker from "$lib/stores/perception.worker?worker";
import { derived, get, writable } from "svelte/store";

type LogProtoMsg = ReturnType<(typeof LogProtoCodec)["decode"]>;

// ── Source state ─────────────────────────────────────────────────────────────

export type Mode = "idle" | "ws" | "file";

export const mode = writable<Mode>("idle");
export const connected = writable(false);
export const loading = writable(false);
/** URLダウンロードの進捗 (0〜1)。ダウンロード中以外は null */
export const downloadProgress = writable<number | null>(null);
/** ログパース進捗 (0〜1)。パース中以外は null */
export const parseProgress = writable<number | null>(null);
/** 7z解凍進捗 (0〜100)。解凍中以外は null */
export const extractProgress = writable<number | null>(null);
export const errorMsg = writable<string | null>(null);

// ── Simulation data ──────────────────────────────────────────────────────────

/**
 * Base (initial conditions) entity map — never mutated after load.
 * Used as the snapshot to replay from when scrubbing.
 */
let baseEntities = new Map<number, SimEntity>();
let _currentSnapshot = new Map<number, SimEntity>();

/**
 * Per-timestep changes — only populated in file mode.
 */
let timeline: Map<number, ChangeSetProto> = new Map();

/**
 * Per-timestep agent commands — only populated in file mode.
 * Maps step → (agentId → AgentAction)
 */
let commandTimeline: Map<number, Map<number, AgentAction>> = new Map();

/**
 * Per-timestep perception data — only populated in file mode.
 * Maps step → (agentId → visible entity ID array)
 */
let perceptionTimeline: Map<number, Map<number, number[]>> = new Map();

/**
 * Per-timestep perception entity changes — only populated in file mode.
 * Maps step → (agentId → ChangeSetProto of perceived entity states)
 */
let perceptionChangesTimeline: Map<
  number,
  Map<number, ChangeSetProto>
> = new Map();

/**
 * Per-timestep communication data — only populated in file mode.
 * Maps step → (agentId → received communication list)
 */
let commTimeline: Map<number, Map<number, CommMessage[]>> = new Map();

/**
 * Per-timestep AK_SPEAK stats — only populated in file mode.
 * Maps step → (channel → { count, bytes })
 */
let speakTimeline: Map<
  number,
  Map<number, { count: number; bytes: number }>
> = new Map();
let agentCommTimeline: Map<
  number,
  Map<number, { speak: number; bytes: number }>
> = new Map();
let agentSubscribeTimeline: Map<number, Map<number, number[]>> = new Map();

export interface CommMessage {
  senderId: number;
  channel: number;
  text: string; // UTF-8 decoded rawData (不明なバイト列は hex 文字列)
}

export interface AgentAction {
  urn: number;
  target?: number; // AK_CLEAR: 対象ブロッケード entity ID
  destX?: number; // AK_CLEAR_AREA: 中心 X
  destY?: number; // AK_CLEAR_AREA: 中心 Y
  path?: number[]; // AK_MOVE: 通過エリア entity ID 列（末尾が目的地）
}

export type SimEventType =
  | "rescue_start"
  | "rescue_end"
  | "carry_start"
  | "carry_end";

export interface SimEvent {
  step: number;
  type: SimEventType;
  agentId: number;
  targetId: number;
}

export const entities = writable<Map<number, SimEntity>>(new Map());
export const animatedEntities = writable<Map<number, SimEntity>>(new Map());
export const currentStep = writable(0);
export const maxStep = writable(0);
export const selectedId = writable<number | null>(null);
export const kernelConfig = writable<Record<string, string>>({});
/** マップを指定座標にズームさせるトリガー。セット後 SimMap が null にリセット */
export const focusPoint = writable<{ x: number; y: number } | null>(null);
/** 選択中エージェントへの追従モード */
export const followMode = writable(false);
/** agentId → AgentAction (current timestep only) */
export const agentActions = writable<Map<number, AgentAction>>(new Map());
/** channel → { count, bytes } AK_SPEAK stats (current timestep only) */
export const currentSpeakStats = writable<
  Map<number, { count: number; bytes: number }>
>(new Map());
/** 通信可視化で非表示にするチャンネル番号のセット */
export const hiddenChannels = writable<Set<number>>(new Set());
/** agentId → AK_SPEAK件数 (current step) */
export const agentCommStats = writable<
  Map<number, { speak: number; bytes: number }>
>(new Map());
/** agentId → サブスクライブ中のチャンネル番号[] (現ステップまでの最新 AK_SUBSCRIBE) */
export const agentSubscriptions = writable<Map<number, number[]>>(new Map());
/** 初期ステップの瓦礫 repairCost 合計（除去率計算用） */
export const initialBlockadeCost = writable(0);

export const selectedEntity = derived(
  [entities, selectedId],
  ([$entities, $selectedId]) =>
    $selectedId !== null ? ($entities.get($selectedId) ?? null) : null,
);

/** シミュレーション中に発生したイベント一覧（ファイルモードのみ） */
export const simEvents = writable<SimEvent[]>([]);

/** ピン止め中のエージェント ID */
export const pinnedAgentId = writable<number | null>(null);

/** ピン止め中のエージェントエンティティ */
export const pinnedEntity = derived(
  [entities, pinnedAgentId],
  ([$entities, $pinnedAgentId]) =>
    $pinnedAgentId !== null ? ($entities.get($pinnedAgentId) ?? null) : null,
);

/**
 * 選択中エージェントが現在ステップで知覚したエンティティIDのセット。
 * ファイルモードかつ知覚データがある場合のみ非 null。
 */
export const agentVisibleIds = writable<Set<number> | null>(null);

/**
 * 選択中エージェントが現在ステップで受信した通信メッセージリスト。
 * ファイルモードかつ通信データがある場合のみ非 null。
 */
export const agentReceivedComms = writable<CommMessage[] | null>(null);

/**
 * 知覚ビューモード: ON のとき選択エージェントの累積知識マップを表示する。
 * ファイルモードかつエージェント選択時のみ有効。
 */
export const perceptionViewMode = writable(false);

/**
 * 知覚ビューで使うエンティティマップ（選択エージェントの累積知覚から再構築）。
 */
export const perceivedEntities = writable<Map<number, SimEntity>>(new Map());

/**
 * ピン止め中に別エンティティを参照するための一時選択 ID。
 * ピン止めなし時は null。
 */
export const inspectedId = writable<number | null>(null);

export const inspectedEntity = derived(
  [entities, perceivedEntities, perceptionViewMode, inspectedId],
  ([$entities, $perceivedEntities, $perceptionViewMode, $inspectedId]) => {
    if ($inspectedId === null) return null;
    const map = $perceptionViewMode ? $perceivedEntities : $entities;
    return map.get($inspectedId) ?? null;
  },
);

// ピン止め変化時: ON → selectedId をピン固定、OFF → inspectedId をクリア
pinnedAgentId.subscribe((id) => {
  if (id !== null) {
    selectedId.set(id);
    inspectedId.set(null);
  } else {
    inspectedId.set(null);
  }
});

function updatePerceptionState(step: number, selId: number | null) {
  if (selId === null) {
    agentVisibleIds.set(null);
    agentReceivedComms.set(null);
    return;
  }

  // 実世界 step T = コマンド実行後 → PERCEPTION は step T+1 に対応
  const percStep = step + 1;
  const ids = perceptionTimeline.get(percStep)?.get(selId);
  agentVisibleIds.set(ids ? new Set(ids) : null);

  const comms = commTimeline.get(percStep)?.get(selId) ?? null;
  agentReceivedComms.set(comms?.length ? comms : null);

  // データの有無に関わらず再構築（early return すると古い状態が残る）
  if (get(perceptionViewMode)) rebuildPerceivedWorld(step, selId);
}

// selectedId が変化したときも知覚データを更新
selectedId.subscribe((selId) => {
  // ピン止めなし・Perception ON の状態でエージェント以外を選択したらモード解除
  if (get(pinnedAgentId) === null && get(perceptionViewMode)) {
    const e = selId !== null ? get(entities).get(selId) : null;
    if (!e || !isAgent(e.urn)) {
      perceptionViewMode.set(false);
      agentVisibleIds.set(null);
      agentReceivedComms.set(null);
      return;
    }
  }
  updatePerceptionState(get(currentStep), selId);
});

// perceptionViewMode が ON になったとき即時再構築
perceptionViewMode.subscribe((enabled) => {
  const selId = get(selectedId);
  if (enabled && selId !== null) rebuildPerceivedWorld(get(currentStep), selId);
  else if (!enabled) perceivedEntities.set(new Map());
});

/**
 * 選択エージェントの累積知覚から「エージェントが認識している世界」を再構築する。
 * - 道路・建物: baseEntities をベースに知覚データのみで上書き（実世界 timeline は反映しない）
 * - エージェント・瓦礫: 一度でも知覚したものだけ表示（最終知覚時の状態で固定）
 */
export function rebuildPerceivedWorld(targetStep: number, agentId: number) {
  // 1. ベースエンティティから開始（静的マップ知識）
  const snapshot = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );

  // 2. 知覚データを累積適用（step T+1 の PERCEPTION = step T の実世界に対応）
  const seenIds = new Set<number>();
  for (let s = 1; s <= targetStep + 1; s++) {
    const percMap = perceptionChangesTimeline.get(s);
    if (!percMap) continue;
    const percChanges = percMap.get(agentId);
    if (!percChanges) continue;
    for (const c of percChanges.changes) seenIds.add(c.entityID);
    applyChanges(snapshot, percChanges);
  }

  // 3. 一度も知覚していないエージェント・瓦礫を除去
  // （知覚データが一件もない場合は除去しない＝初期世界をそのまま表示）
  if (seenIds.size > 0) {
    // エリアの blockades リストに載っている瓦礫 ID を収集
    const referencedBlockades = new Set<number>();
    for (const e of snapshot.values()) {
      if (isArea(e.urn) && "blockades" in e) {
        for (const bid of (e as { blockades: number[] }).blockades)
          referencedBlockades.add(bid);
      }
    }

    for (const [id, e] of snapshot) {
      if (isAgent(e.urn) && !seenIds.has(id)) {
        snapshot.delete(id);
      } else if (e.urn === EntityURN.BLOCKADE) {
        // 知覚したことがない、またはいずれのエリアにも参照されていない瓦礫を除去
        if (!seenIds.has(id) || !referencedBlockades.has(id))
          snapshot.delete(id);
      }
    }
  }

  perceivedEntities.set(snapshot);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;

export function connectWS(url: string) {
  if (ws) disconnectWS();
  errorMsg.set(null);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    errorMsg.set(`WebSocket error: ${e}`);
    return;
  }

  ws.onopen = () => {
    connected.set(true);
  };

  ws.onmessage = ({ data }: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "INITIAL") {
        const map = new Map<number, SimEntity>();
        for (const proto of msg.entities as EntityProto[]) {
          const entity = decodeEntity(proto);
          if (entity) map.set(entity.id, entity);
        }
        entities.set(map);
        animatedEntities.set(map);
        maxStep.set(msg.maxStep);
        kernelConfig.set(msg.config ?? {});
        mode.set("ws");
      } else if (msg.type === "TIMESTEP") {
        let nextMap: Map<number, SimEntity> | null = null;
        entities.update((map) => {
          const next = applyChanges(map, msg.changes as ChangeSetProto);
          if (msg.time === 1) {
            let totalCost = 0;
            for (const e of next.values()) {
              if ("repairCost" in e)
                totalCost += (e as { repairCost: number }).repairCost;
            }
            initialBlockadeCost.set(totalCost);
          }
          nextMap = next;
          return next;
        });
        if (nextMap) animatedEntities.set(nextMap);
        currentStep.set(msg.time);
        if (Array.isArray(msg.commands)) {
          const actionMap = new Map<number, AgentAction>();
          const commMap = new Map<number, { speak: number; bytes: number }>();
          const speakMap = new Map<number, { count: number; bytes: number }>();
          const subMap = new Map<number, number[]>();
          for (const c of msg.commands as {
            agentId: number;
            urn: number;
            target?: number;
            destX?: number;
            destY?: number;
            channel?: number;
            messageBytes?: number;
            channels?: number[];
          }[]) {
            const {
              agentId,
              urn,
              target,
              destX,
              destY,
              channel,
              messageBytes,
              channels,
            } = c;
            if (urn === CommandURN.AK_SPEAK) {
              const cur = commMap.get(agentId) ?? { speak: 0, bytes: 0 };
              commMap.set(agentId, {
                speak: cur.speak + 1,
                bytes: cur.bytes + (messageBytes ?? 0),
              });
              if (channel !== undefined) {
                const cs = speakMap.get(channel) ?? { count: 0, bytes: 0 };
                speakMap.set(channel, {
                  count: cs.count + 1,
                  bytes: cs.bytes + (messageBytes ?? 0),
                });
              }
              continue;
            }
            if (urn === CommandURN.AK_SAY || urn === CommandURN.AK_TELL)
              continue;
            if (urn === CommandURN.AK_SUBSCRIBE) {
              if (channels && channels.length > 0)
                subMap.set(agentId, channels);
              continue;
            }
            const action: AgentAction = { urn };
            if (target !== undefined) action.target = target;
            if (destX !== undefined) action.destX = destX;
            if (destY !== undefined) action.destY = destY;
            actionMap.set(agentId, action);
          }
          agentActions.set(actionMap);
          agentCommStats.set(commMap);
          currentSpeakStats.set(speakMap);
          if (subMap.size > 0) {
            agentSubscriptions.update((existing) => {
              for (const [id, chs] of subMap) existing.set(id, chs);
              return existing;
            });
          }
        }
      } else if (msg.type === "ERROR") {
        errorMsg.set(`Kernel error: ${msg.reason}`);
      }
    } catch (e) {
      console.error("Failed to parse WS message", e);
    }
  };

  ws.onerror = () => errorMsg.set("WebSocket connection error");

  ws.onclose = () => {
    const wasConnected = get(mode) === "ws";
    connected.set(false);
    mode.set("idle");
    if (!wasConnected) {
      errorMsg.set("Connection failed");
    } else {
      errorMsg.set("Disconnected from server");
    }
  };
}

export function disconnectWS() {
  if (!ws) return;
  ws.onclose = null;
  ws.close();
  ws = null;
  connected.set(false);
  mode.set("idle");
}

// ── File loading ──────────────────────────────────────────────────────────────

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
    parseProgress.set(null);
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
  const totalFiles = updateKeys.length + commandKeys.length + percKeys.length;
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

  // Start background worker — transfers Uint8Array buffers to avoid copying.
  // Main thread continues immediately; perception data merges in when ready.
  const percWorker = new PerceptionWorker();
  percWorker.onmessage = (e: MessageEvent<PerceptionResult>) => {
    const { perceptionTimeline: pt, commTimeline: ct, perceptionChanges: pc } =
      e.data;
    for (const [step, agents] of pt) {
      if (!perceptionTimeline.has(step))
        perceptionTimeline.set(step, new Map());
      for (const [agentId, ids] of agents)
        perceptionTimeline.get(step)!.set(agentId, ids);
    }
    for (const [step, agents] of ct) {
      if (!commTimeline.has(step)) commTimeline.set(step, new Map());
      for (const [agentId, msgs] of agents)
        commTimeline.get(step)!.set(agentId, msgs as CommMessage[]);
    }
    for (const [step, agents] of pc) {
      if (!perceptionChangesTimeline.has(step))
        perceptionChangesTimeline.set(step, new Map());
      for (const [agentId, changes] of agents)
        perceptionChangesTimeline
          .get(step)!
          .set(agentId, changes as ChangeSetProto);
    }
    percWorker.terminate();
  };

  percWorker.postMessage(
    { entries: percEntries, civilianIds },
    percEntries.map((e) => e.bytes.buffer),
  );

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

export async function loadFile(file: File) {
  loading.set(true);
  errorMsg.set(null);
  mode.set("file");
  reset();
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
  reset();
  // 外部URLはCORSを回避するためプロキシ経由で取得
  const fetchUrl = url.startsWith("http")
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0)
        downloadProgress.set(Math.min(1, received / contentLength));
    }

    downloadProgress.set(null);

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
    errorMsg.set(`Failed to load URL: ${e}`);
    mode.set("idle");
    return "error";
  } finally {
    loading.set(false);
  }
}

// ── Timeline scrubbing (file mode only) ───────────────────────────────────────

export function seekToStep(step: number) {
  if (get(mode) !== "file") return;
  rebuildState(step);
  currentStep.set(step);
  currentSpeakStats.set(speakTimeline.get(step) ?? new Map());
  agentCommStats.set(agentCommTimeline.get(step) ?? new Map());
  // 現ステップまでの最新 AK_SUBSCRIBE を集約
  const subs = new Map<number, number[]>();
  for (let s = 1; s <= step; s++) {
    const m = agentSubscribeTimeline.get(s);
    if (m) for (const [id, chs] of m) subs.set(id, chs);
  }
  agentSubscriptions.set(subs);
  updatePerceptionState(step, get(selectedId));
}

function rebuildState(targetStep: number) {
  const snapshot = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );

  for (let s = 1; s <= targetStep; s++) {
    const changes = timeline.get(s);
    if (changes) applyChanges(snapshot, changes);
  }

  _currentSnapshot = snapshot;
  entities.set(snapshot);
  animatedEntities.set(snapshot);
  agentActions.set(commandTimeline.get(targetStep) ?? new Map());
}

export function getCommandsAtStep(step: number): Map<number, AgentAction> {
  return commandTimeline.get(step) ?? new Map();
}

export function computeSimEvents(): void {
  const result: SimEvent[] = [];
  const maxS = get(maxStep);
  const ambulanceCarrying = new Map<number, number>(); // ambulanceId → civilianId

  for (let step = 1; step <= maxS; step++) {
    const cur = commandTimeline.get(step);
    const prev = commandTimeline.get(step - 1);

    if (cur) {
      for (const [agentId, action] of cur) {
        if (action.urn === CommandURN.AK_LOAD && action.target !== undefined) {
          ambulanceCarrying.set(agentId, action.target);
          result.push({
            step,
            type: "carry_start",
            agentId,
            targetId: action.target,
          });
        } else if (action.urn === CommandURN.AK_UNLOAD) {
          const civilianId = ambulanceCarrying.get(agentId);
          if (civilianId !== undefined) {
            result.push({
              step,
              type: "carry_end",
              agentId,
              targetId: civilianId,
            });
            ambulanceCarrying.delete(agentId);
          }
        }
        if (
          action.urn === CommandURN.AK_RESCUE &&
          action.target !== undefined
        ) {
          const prevAction = prev?.get(agentId);
          if (
            prevAction?.urn !== CommandURN.AK_RESCUE ||
            prevAction.target !== action.target
          ) {
            result.push({
              step,
              type: "rescue_start",
              agentId,
              targetId: action.target,
            });
          }
        }
      }
    }

    // 救助終了: 前ステップに AK_RESCUE があり、現ステップにない（または対象が変わった）
    if (prev) {
      for (const [agentId, prevAction] of prev) {
        if (
          prevAction.urn !== CommandURN.AK_RESCUE ||
          prevAction.target === undefined
        )
          continue;
        const curAction = cur?.get(agentId);
        if (
          curAction?.urn !== CommandURN.AK_RESCUE ||
          curAction.target !== prevAction.target
        ) {
          result.push({
            step: step - 1,
            type: "rescue_end",
            agentId,
            targetId: prevAction.target,
          });
        }
      }
    }
  }

  simEvents.set(result.sort((a, b) => a.step - b.step));
}

export function computeNextSnapshot(nextStep: number): Map<number, SimEntity> {
  const snapshot = new Map<number, SimEntity>(
    Array.from(_currentSnapshot.entries()).map(([k, v]) => [k, { ...v }]),
  );
  const changes = timeline.get(nextStep);
  if (changes) applyChanges(snapshot, changes);
  return snapshot;
}

// ── Frame handling (shared by WS + file) ─────────────────────────────────────

function handleLogFrame(frame: LogProtoMsg) {
  if (frame.config) {
    const data = frame.config.config?.data ?? {};
    kernelConfig.set(data);
    // 全チャンネルをデフォルトで非表示に初期化
    const allCh = new Set<number>();
    for (let i = 0; data[`comms.channels.${i}.type`]; i++) allCh.add(i);
    if (allCh.size > 0) hiddenChannels.set(allCh);
  }

  if (frame.initialCondition) {
    const map = new Map<number, SimEntity>();
    for (const proto of frame.initialCondition.entities) {
      const entity = decodeEntity(proto);
      if (entity) map.set(entity.id, entity);
    }
    baseEntities = new Map(map);
    _currentSnapshot = new Map(map);
    entities.set(map);
    animatedEntities.set(map);
  }

  if (frame.command) {
    const { time, commands: cmds } = frame.command;
    const actionMap = new Map<number, AgentAction>();
    for (const cmd of cmds) {
      // 通信コマンドは行動マップに含めない（メイン行動を上書きしないため）
      if (
        cmd.urn === CommandURN.AK_SPEAK ||
        cmd.urn === CommandURN.AK_SAY ||
        cmd.urn === CommandURN.AK_TELL ||
        cmd.urn === CommandURN.AK_SUBSCRIBE
      )
        continue;
      const agentId = cmd.components[ComponentControlMsgURN.AgentID]?.entityID;
      if (agentId === undefined) continue;
      const action: AgentAction = { urn: cmd.urn };
      const target = cmd.components[ComponentCommandURN.Target]?.entityID;
      const destX = cmd.components[ComponentCommandURN.DestinationX]?.intValue;
      const destY = cmd.components[ComponentCommandURN.DestinationY]?.intValue;
      const path =
        cmd.components[ComponentCommandURN.Path]?.entityIDList?.values;
      if (target !== undefined) action.target = target;
      if (destX !== undefined) action.destX = destX;
      if (destY !== undefined) action.destY = destY;
      if (path && path.length > 0) action.path = path;
      actionMap.set(agentId, action);
    }
    commandTimeline.set(time, actionMap);

    // AK_SPEAK の送信メッセージ数・バイト数をチャンネル別に集計
    const speakMap = new Map<number, { count: number; bytes: number }>();
    for (const cmd of cmds) {
      if (cmd.urn !== CommandURN.AK_SPEAK) continue;
      const channel = cmd.components[ComponentCommandURN.Channel]?.intValue;
      const raw = cmd.components[ComponentCommandURN.Message]?.rawData;
      if (channel === undefined || !raw) continue;
      const cur = speakMap.get(channel) ?? { count: 0, bytes: 0 };
      speakMap.set(channel, {
        count: cur.count + 1,
        bytes: cur.bytes + raw.length,
      });
    }
    if (speakMap.size > 0) speakTimeline.set(time, speakMap);

    // AK_SPEAK をエージェント別にステップ単位で保存
    const agentCommMap = new Map<number, { speak: number; bytes: number }>();
    // AK_SUBSCRIBE のチャンネルリストをエージェント別に保存
    const agentSubMap = new Map<number, number[]>();
    for (const cmd of cmds) {
      const agentId = cmd.components[ComponentControlMsgURN.AgentID]?.entityID;
      if (agentId === undefined) continue;
      if (cmd.urn === CommandURN.AK_SPEAK) {
        const raw = cmd.components[ComponentCommandURN.Message]?.rawData;
        const cur = agentCommMap.get(agentId) ?? { speak: 0, bytes: 0 };
        agentCommMap.set(agentId, {
          speak: cur.speak + 1,
          bytes: cur.bytes + (raw?.length ?? 0),
        });
      } else if (cmd.urn === CommandURN.AK_SUBSCRIBE) {
        const channels =
          cmd.components[ComponentCommandURN.Channels]?.intList?.values ?? [];
        agentSubMap.set(agentId, channels);
      }
    }
    if (agentCommMap.size > 0) agentCommTimeline.set(time, agentCommMap);
    if (agentSubMap.size > 0) agentSubscribeTimeline.set(time, agentSubMap);
  }

  if (frame.perception) {
    const { time, entityID, visible, communications } = frame.perception;
    if (visible && visible.changes.length > 0) {
      if (!perceptionTimeline.has(time))
        perceptionTimeline.set(time, new Map());
      perceptionTimeline.get(time)!.set(
        entityID,
        visible.changes.map((c) => c.entityID),
      );

      if (!perceptionChangesTimeline.has(time))
        perceptionChangesTimeline.set(time, new Map());
      perceptionChangesTimeline.get(time)!.set(entityID, visible);
    }
    if (communications.length > 0) {
      const msgs: CommMessage[] = [];
      for (const msg of communications) {
        const senderId =
          msg.components[ComponentControlMsgURN.AgentID]?.entityID;
        if (senderId === undefined) continue;
        const channel =
          msg.components[ComponentCommandURN.Channel]?.intValue ?? 0;
        const rawData = msg.components[ComponentCommandURN.Message]?.rawData;
        let text = "";
        if (rawData?.length) {
          try {
            text = new TextDecoder().decode(rawData);
          } catch {
            text = Array.from(rawData)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
          }
        }
        msgs.push({ senderId, channel, text });
      }
      if (msgs.length > 0) {
        if (!commTimeline.has(time)) commTimeline.set(time, new Map());
        commTimeline.get(time)!.set(entityID, msgs);
      }
    }
  }

  if (frame.update) {
    const { time, changes } = frame.update;

    if (get(mode) === "file") {
      if (changes) {
        timeline.set(time, changes);
        if (time > get(maxStep)) maxStep.set(time);
      }
    } else {
      // WS: apply immediately
      if (changes) {
        entities.update((map) => applyChanges(map, changes));
        currentStep.set(time);
      }
    }
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function reset() {
  baseEntities = new Map();
  timeline = new Map();
  commandTimeline = new Map();
  perceptionTimeline = new Map();
  perceptionChangesTimeline = new Map();
  commTimeline = new Map();
  speakTimeline = new Map();
  agentCommTimeline = new Map();
  agentSubscribeTimeline = new Map();
  agentCommStats.set(new Map());
  agentSubscriptions.set(new Map());
  entities.set(new Map());
  currentStep.set(0);
  maxStep.set(0);
  selectedId.set(null);
  initialBlockadeCost.set(0);
  kernelConfig.set({});
  agentActions.set(new Map());
  agentCommStats.set(new Map());
  agentVisibleIds.set(null);
  agentReceivedComms.set(null);
  perceptionViewMode.set(false);
  perceivedEntities.set(new Map());
  pinnedAgentId.set(null);
  inspectedId.set(null);
  simEvents.set([]);
}
