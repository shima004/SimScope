import type { ChangeSetProto } from "$lib/proto/RCRSProto";
import type { SimEntity } from "$lib/rcrs/types";
import type { AgentAction, CommMessage } from "./state";

/**
 * Non-reactive simulation data. Collected into one mutable object so any
 * module can reassign fields (e.g. `sim.timeline = new Map()` in reset)
 * without hitting ES-module immutable-binding restrictions.
 */
export const sim = {
  baseEntities: new Map<number, SimEntity>(),
  currentSnapshot: new Map<number, SimEntity>(),
  timeline: new Map<number, ChangeSetProto>(),
  commandTimeline: new Map<number, Map<number, AgentAction>>(),
  perceptionTimeline: new Map<number, Map<number, number[]>>(),
  perceptionChangesRaw: new Map<number, Map<number, Uint8Array>>(),
  commTimeline: new Map<number, Map<number, CommMessage[]>>(),
  speakTimeline: new Map<number, Map<number, { count: number; bytes: number }>>(),
  agentCommTimeline: new Map<number, Map<number, { speak: number; bytes: number }>>(),
  agentSubscribeTimeline: new Map<number, Map<number, number[]>>(),
};
