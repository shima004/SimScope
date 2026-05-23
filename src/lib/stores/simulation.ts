import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import type { ChangeSetProto } from "$lib/proto/RCRSProto";
import { applyChanges, decodeEntity } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import {
  CommandURN,
  ComponentCommandURN,
  ComponentControlMsgURN,
  EntityURN,
  isAgent,
  isArea,
} from "$lib/rcrs/urns";
import { derived, get, writable } from "svelte/store";

type LogProtoMsg = ReturnType<(typeof LogProtoCodec)["decode"]>;

// ── Source state ─────────────────────────────────────────────────────────────

export type Mode = "idle" | "ws" | "file";

export const mode = writable<Mode>("idle");
export const connected = writable(false);
export const loading = writable(false);
/** URLダウンロードの進捗 (0〜1)。ダウンロード中以外は null */
export const downloadProgress = writable<number | null>(null);
/** URLダウンロードのファイルサイズ (bytes)。不明または非ダウンロード中は null */
export const downloadSize = writable<number | null>(null);
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
export let baseEntities = new Map<number, SimEntity>();
let _currentSnapshot = new Map<number, SimEntity>();

/**
 * Per-timestep changes — only populated in file mode.
 */
export let timeline: Map<number, ChangeSetProto> = new Map();

/**
 * Per-timestep agent commands — only populated in file mode.
 * Maps step → (agentId → AgentAction)
 */
export let commandTimeline: Map<number, Map<number, AgentAction>> = new Map();

/**
 * Per-timestep perception data — only populated in file mode.
 * Maps step → (agentId → visible entity ID array)
 */
export let perceptionTimeline: Map<number, Map<number, number[]>> = new Map();

/**
 * Per-timestep perception entity changes — only populated in file mode.
 * Maps step → (agentId → raw LogProto bytes); decoded on demand in rebuildPerceivedWorld.
 */
export let perceptionChangesRaw: Map<number, Map<number, Uint8Array>> = new Map();

/**
 * Per-timestep communication data — only populated in file mode.
 * Maps step → (agentId → received communication list)
 */
export let commTimeline: Map<number, Map<number, CommMessage[]>> = new Map();

/**
 * Per-timestep AK_SPEAK stats — only populated in file mode.
 * Maps step → (channel → { count, bytes })
 */
export let speakTimeline: Map<
  number,
  Map<number, { count: number; bytes: number }>
> = new Map();
export let agentCommTimeline: Map<
  number,
  Map<number, { speak: number; bytes: number }>
> = new Map();
export let agentSubscribeTimeline: Map<number, Map<number, number[]>> = new Map();

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

/** エージェントの描画モード: 'circle' = 従来の丸、'emoji' = 絵文字アイコン */
export const agentDisplayMode = writable<"circle" | "emoji">("circle");

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
  // Raw bytes are decoded on demand to avoid storing large ChangeSetProto objects.
  const seenIds = new Set<number>();
  for (let s = 1; s <= targetStep + 1; s++) {
    const percMap = perceptionChangesRaw.get(s);
    if (!percMap) continue;
    const rawBytes = percMap.get(agentId);
    if (!rawBytes) continue;
    let percChanges: ChangeSetProto | undefined;
    try {
      const frame = LogProtoCodec.decode(rawBytes);
      percChanges = frame.perception?.visible as ChangeSetProto | undefined;
    } catch {
      continue;
    }
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

export { connectWS, disconnectWS } from "$lib/stores/simulation.ws";
export { loadFile, loadUrl } from "$lib/stores/simulation.file";

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

export function rebuildState(targetStep: number) {
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

function handleConfigFrame(config: NonNullable<LogProtoMsg["config"]>) {
  const data = config.config?.data ?? {};
  kernelConfig.set(data);
  const allCh = new Set<number>();
  for (let i = 0; data[`comms.channels.${i}.type`]; i++) allCh.add(i);
  if (allCh.size > 0) hiddenChannels.set(allCh);
}

function handleInitialConditionFrame(ic: NonNullable<LogProtoMsg["initialCondition"]>) {
  const map = new Map<number, SimEntity>();
  for (const proto of ic.entities) {
    const entity = decodeEntity(proto);
    if (entity) map.set(entity.id, entity);
  }
  baseEntities = new Map(map);
  _currentSnapshot = new Map(map);
  entities.set(map);
  animatedEntities.set(map);
}

function handleCommandFrame({ time, commands: cmds }: NonNullable<LogProtoMsg["command"]>) {
  const actionMap = new Map<number, AgentAction>();
  const speakMap = new Map<number, { count: number; bytes: number }>();
  const agentCommMap = new Map<number, { speak: number; bytes: number }>();
  const agentSubMap = new Map<number, number[]>();

  for (const cmd of cmds) {
    const agentId = cmd.components[ComponentControlMsgURN.AgentID]?.entityID;
    if (agentId === undefined) continue;

    if (cmd.urn === CommandURN.AK_SPEAK) {
      const channel = cmd.components[ComponentCommandURN.Channel]?.intValue;
      const raw = cmd.components[ComponentCommandURN.Message]?.rawData;
      const bytes = raw?.length ?? 0;
      const ac = agentCommMap.get(agentId) ?? { speak: 0, bytes: 0 };
      agentCommMap.set(agentId, { speak: ac.speak + 1, bytes: ac.bytes + bytes });
      if (channel !== undefined && raw) {
        const cs = speakMap.get(channel) ?? { count: 0, bytes: 0 };
        speakMap.set(channel, { count: cs.count + 1, bytes: cs.bytes + raw.length });
      }
      continue;
    }

    if (cmd.urn === CommandURN.AK_SAY || cmd.urn === CommandURN.AK_TELL) continue;

    if (cmd.urn === CommandURN.AK_SUBSCRIBE) {
      const channels = cmd.components[ComponentCommandURN.Channels]?.intList?.values ?? [];
      agentSubMap.set(agentId, channels);
      continue;
    }

    const action: AgentAction = { urn: cmd.urn };
    const target = cmd.components[ComponentCommandURN.Target]?.entityID;
    const destX = cmd.components[ComponentCommandURN.DestinationX]?.intValue;
    const destY = cmd.components[ComponentCommandURN.DestinationY]?.intValue;
    const path = cmd.components[ComponentCommandURN.Path]?.entityIDList?.values;
    if (target !== undefined) action.target = target;
    if (destX !== undefined) action.destX = destX;
    if (destY !== undefined) action.destY = destY;
    if (path?.length) action.path = path;
    actionMap.set(agentId, action);
  }

  commandTimeline.set(time, actionMap);
  if (speakMap.size > 0) speakTimeline.set(time, speakMap);
  if (agentCommMap.size > 0) agentCommTimeline.set(time, agentCommMap);
  if (agentSubMap.size > 0) agentSubscribeTimeline.set(time, agentSubMap);
}

function handlePerceptionFrame({ time, entityID, visible, communications }: NonNullable<LogProtoMsg["perception"]>) {
  if (visible && visible.changes.length > 0) {
    if (!perceptionTimeline.has(time)) perceptionTimeline.set(time, new Map());
    perceptionTimeline.get(time)!.set(entityID, visible.changes.map((c) => c.entityID));

    // WS mode: encode visible back to bytes for on-demand decoding.
    // (File mode populates perceptionChangesRaw via the worker result.)
    if (!perceptionChangesRaw.has(time)) perceptionChangesRaw.set(time, new Map());
    perceptionChangesRaw.get(time)!.set(
      entityID,
      LogProtoCodec.encode({ perception: { time, entityID, visible, communications: [] } }).finish(),
    );
  }

  if (communications.length > 0) {
    const msgs: CommMessage[] = [];
    for (const msg of communications) {
      const senderId = msg.components[ComponentControlMsgURN.AgentID]?.entityID;
      if (senderId === undefined) continue;
      const channel = msg.components[ComponentCommandURN.Channel]?.intValue ?? 0;
      const rawData = msg.components[ComponentCommandURN.Message]?.rawData;
      let text = "";
      if (rawData?.length) {
        try {
          text = new TextDecoder().decode(rawData);
        } catch {
          text = Array.from(rawData).map((b) => b.toString(16).padStart(2, "0")).join("");
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

function handleUpdateFrame({ time, changes }: NonNullable<LogProtoMsg["update"]>) {
  if (!changes) return;
  if (get(mode) === "file") {
    timeline.set(time, changes);
    if (time > get(maxStep)) maxStep.set(time);
  } else {
    entities.update((map) => applyChanges(map, changes));
    currentStep.set(time);
  }
}

export function handleLogFrame(frame: LogProtoMsg) {
  if (frame.config) handleConfigFrame(frame.config);
  if (frame.initialCondition) handleInitialConditionFrame(frame.initialCondition);
  if (frame.command) handleCommandFrame(frame.command);
  if (frame.perception) handlePerceptionFrame(frame.perception);
  if (frame.update) handleUpdateFrame(frame.update);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetSimulationState() {
  baseEntities = new Map();
  timeline = new Map();
  commandTimeline = new Map();
  perceptionTimeline = new Map();
  perceptionChangesRaw = new Map();
  commTimeline = new Map();
  speakTimeline = new Map();
  agentCommTimeline = new Map();
  agentSubscribeTimeline = new Map();
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
