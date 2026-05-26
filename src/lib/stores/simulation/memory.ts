import { get } from "svelte/store";
import { sim } from "./data";
import {
  agentActions,
  agentCommStats,
  agentReceivedComms,
  agentSubscriptions,
  agentVisibleIds,
  animatedEntities,
  currentSpeakStats,
  entities,
  kernelConfig,
  perceivedEntities,
  simEvents,
} from "./state";

const OBJECT_OVERHEAD_BYTES = 24;
const MAP_OVERHEAD_BYTES = 48;
const MAP_ENTRY_OVERHEAD_BYTES = 16;
const ARRAY_OVERHEAD_BYTES = 24;
const STRING_BYTES_PER_CHAR = 2;

type MemoryRow = {
  name: string;
  bytes: number;
  kib: string;
  mib: string;
};

function estimateValueBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;

  switch (typeof value) {
    case "boolean":
      return 4;
    case "number":
      return 8;
    case "bigint":
      return 8;
    case "string":
      return value.length * STRING_BYTES_PER_CHAR;
    case "symbol":
    case "function":
      return 0;
    case "object":
      break;
  }

  if (seen.has(value)) return 0;
  seen.add(value);

  if (ArrayBuffer.isView(value)) {
    return OBJECT_OVERHEAD_BYTES + value.byteLength;
  }

  if (value instanceof ArrayBuffer) {
    return OBJECT_OVERHEAD_BYTES + value.byteLength;
  }

  if (value instanceof Map) {
    let bytes = MAP_OVERHEAD_BYTES + value.size * MAP_ENTRY_OVERHEAD_BYTES;
    for (const [k, v] of value) {
      bytes += estimateValueBytes(k, seen);
      bytes += estimateValueBytes(v, seen);
    }
    return bytes;
  }

  if (value instanceof Set) {
    let bytes = MAP_OVERHEAD_BYTES + value.size * MAP_ENTRY_OVERHEAD_BYTES;
    for (const item of value) bytes += estimateValueBytes(item, seen);
    return bytes;
  }

  if (Array.isArray(value)) {
    let bytes = ARRAY_OVERHEAD_BYTES + value.length * 8;
    for (const item of value) bytes += estimateValueBytes(item, seen);
    return bytes;
  }

  let bytes = OBJECT_OVERHEAD_BYTES;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    bytes += key.length * STRING_BYTES_PER_CHAR;
    bytes += estimateValueBytes(nested, seen);
  }
  return bytes;
}

function toRow(name: string, value: unknown): MemoryRow {
  const bytes = estimateValueBytes(value);
  return {
    name,
    bytes,
    kib: (bytes / 1024).toFixed(2),
    mib: (bytes / 1024 / 1024).toFixed(2),
  };
}

function logRows(title: string, rows: MemoryRow[]) {
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  console.groupCollapsed(title);
  console.table(rows);
  console.log(
    "Estimated total:",
    `${(totalBytes / 1024 / 1024).toFixed(2)} MiB`,
    `(${totalBytes.toLocaleString()} bytes)`,
  );

  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (memory) {
    console.log("Browser JS heap:", {
      usedMiB: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2),
      totalMiB: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2),
      limitMiB: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2),
    });
  }
  console.groupEnd();
}

export function logSimulationMemoryUsage(label: string) {
  logRows(`Simulation memory estimate: ${label}`, [
    toRow("sim.baseEntities", sim.baseEntities),
    toRow("sim.currentSnapshot", sim.currentSnapshot),
    toRow("sim.timeline", sim.timeline),
    toRow("sim.commandTimeline", sim.commandTimeline),
    toRow("sim.perceptionTimeline", sim.perceptionTimeline),
    toRow("sim.perceptionChangesRaw", sim.perceptionChangesRaw),
    toRow("sim.commTimeline", sim.commTimeline),
    toRow("sim.speakTimeline", sim.speakTimeline),
    toRow("sim.agentCommTimeline", sim.agentCommTimeline),
    toRow("sim.agentSubscribeTimeline", sim.agentSubscribeTimeline),
    toRow("store.entities", get(entities)),
    toRow("store.animatedEntities", get(animatedEntities)),
    toRow("store.agentActions", get(agentActions)),
    toRow("store.currentSpeakStats", get(currentSpeakStats)),
    toRow("store.agentCommStats", get(agentCommStats)),
    toRow("store.agentSubscriptions", get(agentSubscriptions)),
    toRow("store.agentVisibleIds", get(agentVisibleIds)),
    toRow("store.agentReceivedComms", get(agentReceivedComms)),
    toRow("store.perceivedEntities", get(perceivedEntities)),
    toRow("store.simEvents", get(simEvents)),
    toRow("store.kernelConfig", get(kernelConfig)),
  ]);
}
