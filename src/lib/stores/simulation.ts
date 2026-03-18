import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import type { ChangeSetProto, EntityProto } from "$lib/proto/RCRSProto";
import { applyChanges, decodeEntity } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { ComponentCommandURN, ComponentControlMsgURN } from "$lib/rcrs/urns";
import { extract7zAllFiles } from "$lib/sevenzip";
import { derived, get, writable } from "svelte/store";

type LogProtoMsg = ReturnType<(typeof LogProtoCodec)["decode"]>;

// ── Source state ─────────────────────────────────────────────────────────────

export type Mode = "idle" | "ws" | "file";

export const mode = writable<Mode>("idle");
export const connected = writable(false);
export const loading = writable(false);
export const errorMsg = writable<string | null>(null);

// ── Simulation data ──────────────────────────────────────────────────────────

/**
 * Base (initial conditions) entity map — never mutated after load.
 * Used as the snapshot to replay from when scrubbing.
 */
let baseEntities = new Map<number, SimEntity>();

/**
 * Per-timestep changes — only populated in file mode.
 */
let timeline: Map<number, ChangeSetProto> = new Map();

/**
 * Per-timestep agent commands — only populated in file mode.
 * Maps step → (agentId → AgentAction)
 */
let commandTimeline: Map<number, Map<number, AgentAction>> = new Map();

export interface AgentAction {
  urn:     number
  target?: number   // AK_CLEAR: 対象ブロッケード entity ID
  destX?:  number   // AK_CLEAR_AREA: 中心 X
  destY?:  number   // AK_CLEAR_AREA: 中心 Y
}

export const entities = writable<Map<number, SimEntity>>(new Map());
export const currentStep = writable(0);
export const maxStep = writable(0);
export const selectedId   = writable<number | null>(null)
export const kernelConfig = writable<Record<string, string>>({})
/** マップを指定座標にズームさせるトリガー。セット後 SimMap が null にリセット */
export const focusPoint = writable<{ x: number; y: number } | null>(null)
/** 選択中エージェントへの追従モード */
export const followMode = writable(false)
/** agentId → AgentAction (current timestep only) */
export const agentActions = writable<Map<number, AgentAction>>(new Map())
/** 初期ステップの瓦礫 repairCost 合計（除去率計算用） */
export const initialBlockadeCost = writable(0)

export const selectedEntity = derived(
  [entities, selectedId],
  ([$entities, $selectedId]) =>
    $selectedId !== null ? ($entities.get($selectedId) ?? null) : null,
);

// ── WebSocket ─────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;

export function connectWS(url: string) {
  if (ws) disconnectWS();
  errorMsg.set(null);
  mode.set("ws");

  try {
    ws = new WebSocket(url);
  } catch (e) {
    errorMsg.set(`WebSocket error: ${e}`);
    mode.set("idle");
    return;
  }

  ws.onopen = () => connected.set(true);

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
        maxStep.set(msg.maxStep);
        kernelConfig.set(msg.config ?? {});
      } else if (msg.type === "TIMESTEP") {
        entities.update((map) => {
          const next = applyChanges(map, msg.changes as ChangeSetProto);
          if (msg.time === 1) {
            let totalCost = 0;
            for (const e of next.values()) {
              if ('repairCost' in e) totalCost += (e as { repairCost: number }).repairCost;
            }
            initialBlockadeCost.set(totalCost);
          }
          return next;
        });
        currentStep.set(msg.time);
        if (Array.isArray(msg.commands)) {
          const actions = new Map<number, AgentAction>();
          for (const c of msg.commands as { agentId: number; urn: number; target?: number; destX?: number; destY?: number }[]) {
            const action: AgentAction = { urn: c.urn };
            if (c.target !== undefined) action.target = c.target;
            if (c.destX  !== undefined) action.destX  = c.destX;
            if (c.destY  !== undefined) action.destY  = c.destY;
            actions.set(c.agentId, action);
          }
          agentActions.set(actions);
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
    connected.set(false);
    // Auto-reconnect after 3 s
    setTimeout(() => {
      if (get(mode) === "ws") connectWS(url);
    }, 3000);
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

async function loadRaw(raw: ArrayBuffer, filename = 'archive.7z') {
  const files = await extract7zAllFiles(raw, filename);

  // INITIAL_CONDITIONS may be at top level or inside a subdirectory (e.g. rescue.log/)
  const configKey = Array.from(files.keys()).find((k) => k.endsWith("CONFIG"));
  if (configKey) {
    handleLogFrame(LogProtoCodec.decode(files.get(configKey)!));
  }

  const initialKey = Array.from(files.keys()).find((k) =>
    k.endsWith("INITIAL_CONDITIONS"),
  );
  if (initialKey) {
    handleLogFrame(LogProtoCodec.decode(files.get(initialKey)!));
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

  for (const { key } of collectStepFiles("/UPDATES")) {
    handleLogFrame(LogProtoCodec.decode(files.get(key)!));
  }

  for (const { key } of collectStepFiles("/COMMANDS")) {
    handleLogFrame(LogProtoCodec.decode(files.get(key)!));
  }

  // ステップ1のスナップショットから瓦礫の初期 repairCost 合計を計算
  const step1 = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }])
  );
  const step1changes = timeline.get(1);
  if (step1changes) applyChanges(step1, step1changes);
  let totalCost = 0;
  for (const e of step1.values()) {
    if ('repairCost' in e) totalCost += (e as { repairCost: number }).repairCost;
  }
  initialBlockadeCost.set(totalCost);

  currentStep.set(0);
  rebuildState(0);
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

export async function loadUrl(url: string) {
  loading.set(true);
  errorMsg.set(null);
  mode.set("file");
  reset();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const filename = url.split('/').pop()?.split('?')[0] ?? 'archive.7z';
    await loadRaw(await res.arrayBuffer(), filename);
  } catch (e) {
    errorMsg.set(`Failed to load URL: ${e}`);
    mode.set("idle");
  } finally {
    loading.set(false);
  }
}

// ── Timeline scrubbing (file mode only) ───────────────────────────────────────

export function seekToStep(step: number) {
  if (get(mode) !== "file") return;
  rebuildState(step);
  currentStep.set(step);
}

function rebuildState(targetStep: number) {
  const snapshot = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );

  for (let s = 1; s <= targetStep; s++) {
    const changes = timeline.get(s);
    if (changes) applyChanges(snapshot, changes);
  }

  entities.set(snapshot);
  agentActions.set(commandTimeline.get(targetStep) ?? new Map());
}

// ── Frame handling (shared by WS + file) ─────────────────────────────────────

function handleLogFrame(frame: LogProtoMsg) {
  if (frame.config) {
    kernelConfig.set(frame.config.config?.data ?? {})
  }

  if (frame.initialCondition) {
    const map = new Map<number, SimEntity>();
    for (const proto of frame.initialCondition.entities) {
      const entity = decodeEntity(proto);
      if (entity) map.set(entity.id, entity);
    }
    baseEntities = new Map(map);
    entities.set(map);
  }

  if (frame.command) {
    const { time, commands: cmds } = frame.command;
    const actionMap = new Map<number, AgentAction>();
    for (const cmd of cmds) {
      const agentId = cmd.components[ComponentControlMsgURN.AgentID]?.entityID;
      if (agentId === undefined) continue;
      const action: AgentAction = { urn: cmd.urn };
      const target = cmd.components[ComponentCommandURN.Target]?.entityID;
      const destX  = cmd.components[ComponentCommandURN.DestinationX]?.intValue;
      const destY  = cmd.components[ComponentCommandURN.DestinationY]?.intValue;
      if (target !== undefined) action.target = target;
      if (destX  !== undefined) action.destX  = destX;
      if (destY  !== undefined) action.destY  = destY;
      actionMap.set(agentId, action);
    }
    commandTimeline.set(time, actionMap);
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
  entities.set(new Map());
  currentStep.set(0);
  maxStep.set(0);
  selectedId.set(null);
  initialBlockadeCost.set(0);
  kernelConfig.set({});
  agentActions.set(new Map());
}
