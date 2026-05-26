import { sim } from "./data";
import {
  agentActions,
  agentCommStats,
  agentReceivedComms,
  agentSubscriptions,
  agentVisibleIds,
  currentStep,
  entities,
  initialBlockadeCost,
  inspectedId,
  kernelConfig,
  maxStep,
  perceivedEntities,
  perceptionViewMode,
  pinnedAgentId,
  selectedId,
  simEvents,
} from "./state";

export function resetSimulationState() {
  sim.baseEntities = new Map();
  sim.currentSnapshot = new Map();
  sim.timeline = new Map();
  sim.commandTimeline = new Map();
  sim.perceptionTimeline = new Map();
  sim.perceptionChangesRaw = new Map();
  sim.commTimeline = new Map();
  sim.speakTimeline = new Map();
  sim.agentCommTimeline = new Map();
  sim.agentSubscribeTimeline = new Map();

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
