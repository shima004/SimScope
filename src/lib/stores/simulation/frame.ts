import { LogProto as LogProtoCodec } from "$lib/proto/RCRSLogProto";
import { applyChanges, decodeEntity } from "$lib/rcrs/decoder";
import type { SimEntity } from "$lib/rcrs/types";
import { CommandURN, ComponentCommandURN, ComponentControlMsgURN } from "$lib/rcrs/urns";
import { get } from "svelte/store";
import { sim } from "./data";
import {
  animatedEntities,
  currentStep,
  entities,
  hiddenChannels,
  kernelConfig,
  maxStep,
  mode,
  type AgentAction,
  type CommMessage,
} from "./state";

type LogProtoMsg = ReturnType<(typeof LogProtoCodec)["decode"]>;

function handleConfigFrame(config: NonNullable<LogProtoMsg["config"]>) {
  const data = config.config?.data ?? {};
  kernelConfig.set(data);
  const allCh = new Set<number>();
  for (let i = 0; data[`comms.channels.${i}.type`]; i++) allCh.add(i);
  if (allCh.size > 0) hiddenChannels.set(allCh);
}

function handleInitialConditionFrame(ic: NonNullable<LogProtoMsg["initialCondition"]>) {
  const map = new Map<number, SimEntity>();
  for (const proto of ic.entities) {
    const entity = decodeEntity(proto);
    if (entity) map.set(entity.id, entity);
  }
  sim.baseEntities = new Map(map);
  sim.currentSnapshot = new Map(map);
  entities.set(map);
  animatedEntities.set(map);
}

function handleCommandFrame({ time, commands: cmds }: NonNullable<LogProtoMsg["command"]>) {
  const actionMap = new Map<number, AgentAction>();
  const speakMap = new Map<number, { count: number; bytes: number }>();
  const agentCommMap = new Map<number, { speak: number; bytes: number }>();
  const agentSubMap = new Map<number, number[]>();

  for (const cmd of cmds) {
    const agentId = cmd.components[ComponentControlMsgURN.AgentID]?.entityID;
    if (agentId === undefined) continue;

    if (cmd.urn === CommandURN.AK_SPEAK) {
      const channel = cmd.components[ComponentCommandURN.Channel]?.intValue;
      const raw = cmd.components[ComponentCommandURN.Message]?.rawData;
      const bytes = raw?.length ?? 0;
      const ac = agentCommMap.get(agentId) ?? { speak: 0, bytes: 0 };
      agentCommMap.set(agentId, { speak: ac.speak + 1, bytes: ac.bytes + bytes });
      if (channel !== undefined && raw) {
        const cs = speakMap.get(channel) ?? { count: 0, bytes: 0 };
        speakMap.set(channel, { count: cs.count + 1, bytes: cs.bytes + raw.length });
      }
      continue;
    }

    if (cmd.urn === CommandURN.AK_SAY || cmd.urn === CommandURN.AK_TELL) continue;

    if (cmd.urn === CommandURN.AK_SUBSCRIBE) {
      const channels = cmd.components[ComponentCommandURN.Channels]?.intList?.values ?? [];
      agentSubMap.set(agentId, channels);
      continue;
    }

    const action: AgentAction = { urn: cmd.urn };
    const target = cmd.components[ComponentCommandURN.Target]?.entityID;
    const destX = cmd.components[ComponentCommandURN.DestinationX]?.intValue;
    const destY = cmd.components[ComponentCommandURN.DestinationY]?.intValue;
    const path = cmd.components[ComponentCommandURN.Path]?.entityIDList?.values;
    if (target !== undefined) action.target = target;
    if (destX !== undefined) action.destX = destX;
    if (destY !== undefined) action.destY = destY;
    if (path?.length) action.path = path;
    actionMap.set(agentId, action);
  }

  sim.commandTimeline.set(time, actionMap);
  if (speakMap.size > 0) sim.speakTimeline.set(time, speakMap);
  if (agentCommMap.size > 0) sim.agentCommTimeline.set(time, agentCommMap);
  if (agentSubMap.size > 0) sim.agentSubscribeTimeline.set(time, agentSubMap);
}

function handlePerceptionFrame({ time, entityID, visible, communications }: NonNullable<LogProtoMsg["perception"]>) {
  if (visible && visible.changes.length > 0) {
    if (!sim.perceptionTimeline.has(time)) sim.perceptionTimeline.set(time, new Map());
    sim.perceptionTimeline.get(time)!.set(entityID, visible.changes.map((c) => c.entityID));

    // WS mode: encode visible back to bytes for on-demand decoding in rebuildPerceivedWorld.
    // (File mode populates perceptionChangesRaw via the perception worker.)
    if (!sim.perceptionChangesRaw.has(time)) sim.perceptionChangesRaw.set(time, new Map());
    sim.perceptionChangesRaw.get(time)!.set(
      entityID,
      LogProtoCodec.encode({ perception: { time, entityID, visible, communications: [] } }).finish(),
    );
  }

  if (communications.length > 0) {
    const msgs: CommMessage[] = [];
    for (const msg of communications) {
      const senderId = msg.components[ComponentControlMsgURN.AgentID]?.entityID;
      if (senderId === undefined) continue;
      const channel = msg.components[ComponentCommandURN.Channel]?.intValue ?? 0;
      const rawData = msg.components[ComponentCommandURN.Message]?.rawData;
      let text = "";
      if (rawData?.length) {
        try {
          text = new TextDecoder().decode(rawData);
        } catch {
          text = Array.from(rawData).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
      }
      msgs.push({ senderId, channel, text });
    }
    if (msgs.length > 0) {
      if (!sim.commTimeline.has(time)) sim.commTimeline.set(time, new Map());
      sim.commTimeline.get(time)!.set(entityID, msgs);
    }
  }
}

function handleUpdateFrame({ time, changes }: NonNullable<LogProtoMsg["update"]>) {
  if (!changes) return;
  if (get(mode) === "file") {
    sim.timeline.set(time, changes);
    if (time > get(maxStep)) maxStep.set(time);
  } else {
    entities.update((map) => applyChanges(map, changes));
    currentStep.set(time);
  }
}

export function handleLogFrame(frame: LogProtoMsg) {
  if (frame.config) handleConfigFrame(frame.config);
  if (frame.initialCondition) handleInitialConditionFrame(frame.initialCondition);
  if (frame.command) handleCommandFrame(frame.command);
  if (frame.perception) handlePerceptionFrame(frame.perception);
  if (frame.update) handleUpdateFrame(frame.update);
}
