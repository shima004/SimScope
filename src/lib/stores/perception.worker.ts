// Background worker for parsing PERCEPTION log frames.
// Returns perceptionTimeline and commTimeline as decoded data, and
// percChangesRaw as raw bytes (Transferable) to avoid OOM on structured clone.

import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import { ComponentCommandURN, ComponentControlMsgURN } from "$lib/rcrs/urns";

export type CommMsg = { senderId: number; channel: number; text: string };

export type PerceptionResult = {
  // step → [agentId, visibleEntityIds[]][]
  perceptionTimeline: [number, [number, number[]][]][];
  // step → [agentId, CommMsg[]][]
  commTimeline: [number, [number, CommMsg[]][]][];
  // step → [agentId, raw LogProto bytes][] — transferred, not cloned
  percChangesRaw: [number, [number, Uint8Array][]][];
};

export type PerceptionWorkerMsg =
  | { type: "progress"; done: number; total: number }
  | ({ type: "done" } & PerceptionResult);

const PROGRESS_EVERY = 500;

self.onmessage = ({
  data,
}: MessageEvent<{
  entries: { step: number; agentId: number; bytes: Uint8Array }[];
  civilianIds: number[];
}>) => {
  const { entries, civilianIds } = data;
  const civSet = new Set(civilianIds);
  const total = entries.length;

  const percMap = new Map<number, Map<number, number[]>>();
  const commMap = new Map<number, Map<number, CommMsg[]>>();
  // Raw bytes for entries that have visible changes, keyed by step → agentId
  const changesRaw = new Map<number, Map<number, Uint8Array>>();

  for (let i = 0; i < entries.length; i++) {
    if (i % PROGRESS_EVERY === 0) {
      self.postMessage({
        type: "progress",
        done: i,
        total,
      } satisfies PerceptionWorkerMsg);
    }

    const { step, agentId, bytes } = entries[i];
    if (civSet.has(agentId)) continue;

    let frame;
    try {
      frame = LogProtoCodec.decode(bytes);
    } catch {
      continue;
    }
    if (!frame.perception) continue;

    const { time, entityID, visible, communications } = frame.perception;

    if (visible && visible.changes.length > 0) {
      if (!percMap.has(time)) percMap.set(time, new Map());
      percMap.get(time)!.set(
        entityID,
        visible.changes.map((c) => c.entityID),
      );

      // Keep raw bytes so the main thread can decode ChangeSetProto on demand
      if (!changesRaw.has(time)) changesRaw.set(time, new Map());
      changesRaw.get(time)!.set(entityID, bytes);
    }

    if (communications.length > 0) {
      const msgs: CommMsg[] = [];
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
        if (!commMap.has(time)) commMap.set(time, new Map());
        commMap.get(time)!.set(entityID, msgs);
      }
    }
  }

  // Collect all raw byte buffers to transfer (avoids structured clone)
  const percChangesRaw: [number, [number, Uint8Array][]][] = Array.from(
    changesRaw.entries(),
  ).map(([step, m]) => [step, Array.from(m.entries())]);

  const transferables: Transferable[] = [];
  for (const [, agents] of percChangesRaw) {
    for (const [, buf] of agents) transferables.push(buf.buffer as ArrayBuffer);
  }

  const result: PerceptionWorkerMsg = {
    type: "done",
    perceptionTimeline: Array.from(percMap.entries()).map(([step, m]) => [
      step,
      Array.from(m.entries()),
    ]),
    commTimeline: Array.from(commMap.entries()).map(([step, m]) => [
      step,
      Array.from(m.entries()),
    ]),
    percChangesRaw,
  };

  (self as unknown as { postMessage(msg: unknown, transfer: Transferable[]): void }).postMessage(result, transferables);
};
