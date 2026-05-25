import { applyChanges } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { CommandURN } from "$lib/rcrs/urns";
import { get } from "svelte/store";
import { sim } from "./data";
import { updatePerceptionState } from "./perception";
import {
  agentActions,
  agentCommStats,
  agentSubscriptions,
  animatedEntities,
  currentSpeakStats,
  currentStep,
  entities,
  maxStep,
  mode,
  selectedId,
  simEvents,
  type AgentAction,
  type SimEvent,
} from "./state";

export function seekToStep(step: number) {
  if (get(mode) !== "file") return;
  rebuildState(step);
  currentStep.set(step);
  currentSpeakStats.set(sim.speakTimeline.get(step) ?? new Map());
  agentCommStats.set(sim.agentCommTimeline.get(step) ?? new Map());
  const subs = new Map<number, number[]>();
  for (let s = 1; s <= step; s++) {
    const m = sim.agentSubscribeTimeline.get(s);
    if (m) for (const [id, chs] of m) subs.set(id, chs);
  }
  agentSubscriptions.set(subs);
  updatePerceptionState(step, get(selectedId));
}

export function rebuildState(targetStep: number) {
  const snapshot = new Map<number, SimEntity>(
    Array.from(sim.baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );
  for (let s = 1; s <= targetStep; s++) {
    const changes = sim.timeline.get(s);
    if (changes) applyChanges(snapshot, changes);
  }
  sim.currentSnapshot = snapshot;
  entities.set(snapshot);
  animatedEntities.set(snapshot);
  agentActions.set(sim.commandTimeline.get(targetStep) ?? new Map());
}

export function getCommandsAtStep(step: number): Map<number, AgentAction> {
  return sim.commandTimeline.get(step) ?? new Map();
}

export function computeSimEvents(): void {
  const result: SimEvent[] = [];
  const maxS = get(maxStep);
  const ambulanceCarrying = new Map<number, number>();

  for (let step = 1; step <= maxS; step++) {
    const cur = sim.commandTimeline.get(step);
    const prev = sim.commandTimeline.get(step - 1);

    if (cur) {
      for (const [agentId, action] of cur) {
        if (action.urn === CommandURN.AK_LOAD && action.target !== undefined) {
          ambulanceCarrying.set(agentId, action.target);
          result.push({ step, type: "carry_start", agentId, targetId: action.target });
        } else if (action.urn === CommandURN.AK_UNLOAD) {
          const civilianId = ambulanceCarrying.get(agentId);
          if (civilianId !== undefined) {
            result.push({ step, type: "carry_end", agentId, targetId: civilianId });
            ambulanceCarrying.delete(agentId);
          }
        }
        if (action.urn === CommandURN.AK_RESCUE && action.target !== undefined) {
          const prevAction = prev?.get(agentId);
          if (prevAction?.urn !== CommandURN.AK_RESCUE || prevAction.target !== action.target) {
            result.push({ step, type: "rescue_start", agentId, targetId: action.target });
          }
        }
      }
    }

    if (prev) {
      for (const [agentId, prevAction] of prev) {
        if (prevAction.urn !== CommandURN.AK_RESCUE || prevAction.target === undefined) continue;
        const curAction = cur?.get(agentId);
        if (curAction?.urn !== CommandURN.AK_RESCUE || curAction.target !== prevAction.target) {
          result.push({ step: step - 1, type: "rescue_end", agentId, targetId: prevAction.target });
        }
      }
    }
  }

  simEvents.set(result.sort((a, b) => a.step - b.step));
}

export function computeNextSnapshot(nextStep: number): Map<number, SimEntity> {
  const snapshot = new Map<number, SimEntity>(
    Array.from(sim.currentSnapshot.entries()).map(([k, v]) => [k, { ...v }]),
  );
  const changes = sim.timeline.get(nextStep);
  if (changes) applyChanges(snapshot, changes);
  return snapshot;
}
