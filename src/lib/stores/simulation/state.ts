import type { SimEntity } from "$lib/rcrs/types";
import { derived, writable } from "svelte/store";

export type Mode = "idle" | "ws" | "file";

export interface CommMessage {
  senderId: number;
  channel: number;
  text: string;
}

export interface AgentAction {
  urn: number;
  target?: number;
  destX?: number;
  destY?: number;
  path?: number[];
}

export type SimEventType = "rescue_start" | "rescue_end" | "carry_start" | "carry_end";

export interface SimEvent {
  step: number;
  type: SimEventType;
  agentId: number;
  targetId: number;
}

// ── Source state ──────────────────────────────────────────────────────────────

export const mode = writable<Mode>("idle");
export const connected = writable(false);
export const loading = writable(false);
export const downloadProgress = writable<number | null>(null);
export const downloadSize = writable<number | null>(null);
export const parseProgress = writable<number | null>(null);
export const extractProgress = writable<number | null>(null);
export const errorMsg = writable<string | null>(null);

// ── Simulation stores ─────────────────────────────────────────────────────────

export const entities = writable<Map<number, SimEntity>>(new Map());
export const animatedEntities = writable<Map<number, SimEntity>>(new Map());
export const currentStep = writable(0);
export const maxStep = writable(0);
export const selectedId = writable<number | null>(null);
export const kernelConfig = writable<Record<string, string>>({});
export const focusPoint = writable<{ x: number; y: number } | null>(null);
export const followMode = writable(false);
export const agentActions = writable<Map<number, AgentAction>>(new Map());
export const currentSpeakStats = writable<Map<number, { count: number; bytes: number }>>(new Map());
export const hiddenChannels = writable<Set<number>>(new Set());
export const agentCommStats = writable<Map<number, { speak: number; bytes: number }>>(new Map());
export const agentSubscriptions = writable<Map<number, number[]>>(new Map());
export const initialBlockadeCost = writable(0);

export const selectedEntity = derived(
  [entities, selectedId],
  ([$entities, $selectedId]) =>
    $selectedId !== null ? ($entities.get($selectedId) ?? null) : null,
);

export const simEvents = writable<SimEvent[]>([]);
export const pinnedAgentId = writable<number | null>(null);

export const pinnedEntity = derived(
  [entities, pinnedAgentId],
  ([$entities, $pinnedAgentId]) =>
    $pinnedAgentId !== null ? ($entities.get($pinnedAgentId) ?? null) : null,
);

export const agentVisibleIds = writable<Set<number> | null>(null);
export const agentReceivedComms = writable<CommMessage[] | null>(null);
export const perceptionViewMode = writable(false);
export const agentDisplayMode = writable<"circle" | "emoji">("circle");
export const perceivedEntities = writable<Map<number, SimEntity>>(new Map());
export const inspectedId = writable<number | null>(null);

export const inspectedEntity = derived(
  [entities, perceivedEntities, perceptionViewMode, inspectedId],
  ([$entities, $perceivedEntities, $perceptionViewMode, $inspectedId]) => {
    if ($inspectedId === null) return null;
    const map = $perceptionViewMode ? $perceivedEntities : $entities;
    return map.get($inspectedId) ?? null;
  },
);
