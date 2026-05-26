import type { ChangeSetProto, EntityProto } from "$lib/proto/RCRSProto";
import { applyChanges, decodeEntity } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { CommandURN } from "$lib/rcrs/urns";
import { get } from "svelte/store";
import { logSimulationMemoryUsage } from "./memory";
import {
  agentActions,
  agentCommStats,
  agentSubscriptions,
  animatedEntities,
  connected,
  currentSpeakStats,
  currentStep,
  entities,
  errorMsg,
  initialBlockadeCost,
  kernelConfig,
  maxStep,
  mode,
  simEvents,
  type AgentAction,
  type SimEvent,
} from "./state";

type WsCommand = {
  agentId: number;
  urn: number;
  target?: number;
  destX?: number;
  destY?: number;
  channel?: number;
  messageBytes?: number;
  channels?: number[];
};

let ws: WebSocket | null = null;
let prevWsActions = new Map<number, AgentAction>();
let wsAmbulanceCarrying = new Map<number, number>();
let lastWsMemoryLogStep = -1;

function resetWsEventState() {
  prevWsActions = new Map();
  wsAmbulanceCarrying = new Map();
  lastWsMemoryLogStep = -1;
}

export function connectWS(url: string) {
  if (ws) disconnectWS();
  resetWsEventState();
  errorMsg.set(null);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    errorMsg.set(`WebSocket error: ${e}`);
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
        animatedEntities.set(map);
        maxStep.set(msg.maxStep);
        kernelConfig.set(msg.config ?? {});
        mode.set("ws");
        logSimulationMemoryUsage("ws initial");
      } else if (msg.type === "TIMESTEP") {
        let nextMap: Map<number, SimEntity> | null = null;
        entities.update((map) => {
          const next = applyChanges(new Map(map), msg.changes as ChangeSetProto);
          if (msg.time === 1) {
            let totalCost = 0;
            for (const e of next.values()) {
              if ("repairCost" in e) totalCost += (e as { repairCost: number }).repairCost;
            }
            initialBlockadeCost.set(totalCost);
          }
          nextMap = next;
          return next;
        });
        if (nextMap) animatedEntities.set(nextMap);
        currentStep.set(msg.time);
        if (Array.isArray(msg.commands)) {
          handleWsCommands(msg.time as number, msg.commands);
        }
        logWsMemoryUsage(msg.time as number);
      } else if (msg.type === "ERROR") {
        errorMsg.set(`Kernel error: ${msg.reason}`);
      }
    } catch (e) {
      console.error("Failed to parse WS message", e);
    }
  };

  ws.onerror = () => errorMsg.set("WebSocket connection error");

  ws.onclose = () => {
    const wasConnected = get(mode) === "ws";
    connected.set(false);
    mode.set("idle");
    errorMsg.set(wasConnected ? "Disconnected from server" : "Connection failed");
  };
}

function logWsMemoryUsage(step: number) {
  if (step === lastWsMemoryLogStep) return;
  if (step !== 1 && step % 25 !== 0) return;
  lastWsMemoryLogStep = step;
  logSimulationMemoryUsage(`ws step ${step}`);
}

export function disconnectWS() {
  if (!ws) return;
  ws.onclose = null;
  ws.close();
  ws = null;
  connected.set(false);
  mode.set("idle");
}

function handleWsCommands(step: number, commands: WsCommand[]) {
  const actionMap = new Map<number, AgentAction>();
  const commMap = new Map<number, { speak: number; bytes: number }>();
  const speakMap = new Map<number, { count: number; bytes: number }>();
  const subMap = new Map<number, number[]>();

  for (const c of commands) {
    const { agentId, urn, target, destX, destY, channel, messageBytes, channels } = c;
    if (urn === CommandURN.AK_SPEAK) {
      const cur = commMap.get(agentId) ?? { speak: 0, bytes: 0 };
      commMap.set(agentId, { speak: cur.speak + 1, bytes: cur.bytes + (messageBytes ?? 0) });
      if (channel !== undefined) {
        const cs = speakMap.get(channel) ?? { count: 0, bytes: 0 };
        speakMap.set(channel, { count: cs.count + 1, bytes: cs.bytes + (messageBytes ?? 0) });
      }
      continue;
    }
    if (urn === CommandURN.AK_SAY || urn === CommandURN.AK_TELL) continue;
    if (urn === CommandURN.AK_SUBSCRIBE) {
      if (channels?.length) subMap.set(agentId, channels);
      continue;
    }
    const action: AgentAction = { urn };
    if (target !== undefined) action.target = target;
    if (destX !== undefined) action.destX = destX;
    if (destY !== undefined) action.destY = destY;
    actionMap.set(agentId, action);
  }

  agentActions.set(actionMap);
  agentCommStats.set(commMap);
  currentSpeakStats.set(speakMap);
  if (subMap.size > 0) {
    agentSubscriptions.update((existing) => {
      for (const [id, chs] of subMap) existing.set(id, chs);
      return existing;
    });
  }

  detectWsEvents(step, actionMap);
  prevWsActions = actionMap;
}

function detectWsEvents(step: number, actionMap: Map<number, AgentAction>) {
  const newEvents: SimEvent[] = [];
  for (const [agentId, action] of actionMap) {
    if (action.urn === CommandURN.AK_LOAD && action.target !== undefined) {
      wsAmbulanceCarrying.set(agentId, action.target);
      newEvents.push({ step, type: "carry_start", agentId, targetId: action.target });
    } else if (action.urn === CommandURN.AK_UNLOAD) {
      const civilianId = wsAmbulanceCarrying.get(agentId);
      if (civilianId !== undefined) {
        newEvents.push({ step, type: "carry_end", agentId, targetId: civilianId });
        wsAmbulanceCarrying.delete(agentId);
      }
    }
    if (action.urn === CommandURN.AK_RESCUE && action.target !== undefined) {
      const prev = prevWsActions.get(agentId);
      if (prev?.urn !== CommandURN.AK_RESCUE || prev.target !== action.target) {
        newEvents.push({ step, type: "rescue_start", agentId, targetId: action.target });
      }
    }
  }
  for (const [agentId, prevAction] of prevWsActions) {
    if (prevAction.urn !== CommandURN.AK_RESCUE || prevAction.target === undefined) continue;
    const cur = actionMap.get(agentId);
    if (cur?.urn !== CommandURN.AK_RESCUE || cur.target !== prevAction.target) {
      newEvents.push({ step: step - 1, type: "rescue_end", agentId, targetId: prevAction.target });
    }
  }
  if (newEvents.length > 0) {
    simEvents.update((ev) => [...ev, ...newEvents].sort((a, b) => a.step - b.step));
  }
}
