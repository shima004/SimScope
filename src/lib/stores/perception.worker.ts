// Background worker for parsing PERCEPTION log frames.
// Runs off the main thread so the simulation becomes usable immediately
// after UPDATES/COMMANDS are parsed.

import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import {
  ComponentCommandURN,
  ComponentControlMsgURN,
} from "$lib/rcrs/urns";

export type CommMsg = { senderId: number; channel: number; text: string };

export type PerceptionResult = {
  // step → [agentId, visibleEntityIds[]][]
  perceptionTimeline: [number, [number, number[]][]][];
  // step → [agentId, CommMsg[]][]
  commTimeline: [number, [number, CommMsg[]][]][];
  // step → [agentId, changes (ChangeSetProto-compatible)][]
  perceptionChanges: [number, [number, unknown][]][];
};

self.onmessage = ({
  data,
}: MessageEvent<{
  entries: { step: number; agentId: number; bytes: Uint8Array }[];
  civilianIds: number[];
}>) => {
  const { entries, civilianIds } = data;
  const civSet = new Set(civilianIds);

  // Accumulate results in Maps, then convert to arrays for transfer
  const percMap = new Map<number, Map<number, number[]>>();
  const commMap = new Map<number, Map<number, CommMsg[]>>();
  const changesMap = new Map<number, Map<number, unknown>>();

  for (const { step, agentId, bytes } of entries) {
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
      percMap.get(time)!.set(entityID, visible.changes.map((c) => c.entityID));

      if (!changesMap.has(time)) changesMap.set(time, new Map());
      changesMap.get(time)!.set(entityID, visible);
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

  // Convert nested Maps to serializable arrays
  const result: PerceptionResult = {
    perceptionTimeline: Array.from(percMap.entries()).map(([step, m]) => [
      step,
      Array.from(m.entries()),
    ]),
    commTimeline: Array.from(commMap.entries()).map(([step, m]) => [
      step,
      Array.from(m.entries()),
    ]),
    perceptionChanges: Array.from(changesMap.entries()).map(([step, m]) => [
      step,
      Array.from(m.entries()),
    ]),
  };

  self.postMessage(result);
};
