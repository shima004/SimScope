import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import type { ChangeSetProto } from "$lib/proto/RCRSProto";
import { applyChanges } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { EntityURN, isAgent, isArea } from "$lib/rcrs/urns";
import { get } from "svelte/store";
import { sim } from "./data";
import {
  agentReceivedComms,
  agentVisibleIds,
  currentStep,
  entities,
  inspectedId,
  perceivedEntities,
  perceptionViewMode,
  pinnedAgentId,
  selectedId,
} from "./state";

export function updatePerceptionState(step: number, selId: number | null) {
  if (selId === null) {
    agentVisibleIds.set(null);
    agentReceivedComms.set(null);
    return;
  }

  // PERCEPTION at step T+1 corresponds to the world state after step T commands
  const percStep = step + 1;
  const ids = sim.perceptionTimeline.get(percStep)?.get(selId);
  agentVisibleIds.set(ids ? new Set(ids) : null);

  const comms = sim.commTimeline.get(percStep)?.get(selId) ?? null;
  agentReceivedComms.set(comms?.length ? comms : null);

  // Rebuild regardless of data presence — early return leaves stale state
  if (get(perceptionViewMode)) rebuildPerceivedWorld(step, selId);
}

/**
 * Reconstruct the "world as seen by an agent" from cumulative perception data.
 * Roads/buildings: based on baseEntities + perception-only updates (not world timeline).
 * Agents/blockades: shown only if ever perceived; fixed at last-seen state.
 */
export function rebuildPerceivedWorld(targetStep: number, agentId: number) {
  const snapshot = new Map<number, SimEntity>(
    Array.from(sim.baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  );

  const seenIds = new Set<number>();
  for (let s = 1; s <= targetStep + 1; s++) {
    const percMap = sim.perceptionChangesRaw.get(s);
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

  if (seenIds.size > 0) {
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
        if (!seenIds.has(id) || !referencedBlockades.has(id))
          snapshot.delete(id);
      }
    }
  }

  perceivedEntities.set(snapshot);
}

// ── Subscribers (wired up at module load) ─────────────────────────────────────

pinnedAgentId.subscribe((id) => {
  if (id !== null) {
    selectedId.set(id);
    inspectedId.set(null);
  } else {
    inspectedId.set(null);
  }
});

selectedId.subscribe((selId) => {
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

perceptionViewMode.subscribe((enabled) => {
  const selId = get(selectedId);
  if (enabled && selId !== null) rebuildPerceivedWorld(get(currentStep), selId);
  else if (!enabled) perceivedEntities.set(new Map());
});
