// @ts-nocheck
/**
 * RCRS Kernel → WebSocket proxy (control protocol).
 *
 * Flow:
 *   1. TCP connect → send VKConnect
 *   2. Receive KVConnectOK → send VKAcknowledge, forward JSON {type:'INITIAL'} to WS
 *   3. Receive KVTimestep  → forward JSON {type:'TIMESTEP'} to WS
 */

import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = protobuf.loadSync(join(__dirname, "proto/RCRSProto.proto"));
const MessageProtoType = root.lookupType("MessageProto");
const MessageListProtoType = root.lookupType("MessageListProto");
const EntityListProtoType = root.lookupType("EntityListProto");
const ChangeSetProtoType = root.lookupType("ChangeSetProto");

// RCRS URN constants
const URN = {
  // Message types
  VK_CONNECT: 0x010d,
  VK_ACKNOWLEDGE: 0x010e,
  KV_CONNECT_OK: 0x010f,
  KV_CONNECT_ERROR: 0x0110,
  KV_TIMESTEP: 0x0111,
  // Component keys
  RequestID: 0x0201,
  AgentID:   0x0202,
  Version:   0x0203,
  Name:      0x0204,
  Entities:  0x020b,
  ViewerID:  0x020c,
  AgentConfig: 0x020d,
  Time:      0x020e,
  Updates:   0x020f,
  Commands:  0x0214,
  Changes:   0x0216,
};

const TOOBJ_OPTS = { defaults: true, longs: Number };

function sendTcpMessage(tcp, msgBytes) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(msgBytes.length, 0);
  tcp.write(Buffer.concat([header, msgBytes]));
}

function buildVKConnect(requestID) {
  return Buffer.from(
    MessageProtoType.encode(
      MessageProtoType.create({
        urn: URN.VK_CONNECT,
        components: {
          [URN.RequestID]: { intValue: requestID },
          [URN.Version]: { intValue: 1 },
          [URN.Name]: { stringValue: "SimScope" },
        },
      }),
    ).finish(),
  );
}

function buildVKAcknowledge(requestID, viewerID) {
  return Buffer.from(
    MessageProtoType.encode(
      MessageProtoType.create({
        urn: URN.VK_ACKNOWLEDGE,
        components: {
          [URN.RequestID]: { intValue: requestID },
          [URN.ViewerID]: { intValue: viewerID },
        },
      }),
    ).finish(),
  );
}

/**
 * Handle an RCRS viewer WebSocket connection.
 * @param {import('ws').WebSocket} ws
 * @param {string} tcpHost
 * @param {number} tcpPort
 */
export function handleRcrsViewer(ws, tcpHost, tcpPort) {
  const tcp = net.createConnection({ host: tcpHost, port: tcpPort });
  const requestID = Date.now() & 0x7fffffff;
  let buf = Buffer.alloc(0);
  let viewerID = 0;

  tcp.on("connect", () => {
    console.log(`[proxy] TCP connected → ${tcpHost}:${tcpPort}`);
    sendTcpMessage(tcp, buildVKConnect(requestID));
  });

  tcp.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const msgLen = buf.readUInt32BE(0);
      if (buf.length < 4 + msgLen) break;
      const msgBytes = buf.subarray(4, 4 + msgLen);
      buf = buf.subarray(4 + msgLen);
      handleMessage(msgBytes);
    }
  });

  tcp.on("error", (err) => {
    console.error(`[proxy] TCP error: ${err.code ?? ""} ${err.message ?? ""} (${tcpHost}:${tcpPort})`);
    ws.close();
  });

  tcp.on("close", () => ws.close());
  ws.on("close", () => tcp.destroy());
  ws.on("error", () => tcp.destroy());

  function handleMessage(bytes) {
    let msg;
    try {
      msg = MessageProtoType.decode(bytes);
    } catch (e) {
      console.error("[proxy] decode error:", e.message);
      return;
    }

    const { urn, components: comps } = msg;

    if (urn === URN.KV_CONNECT_OK) {
      viewerID = comps[URN.ViewerID]?.intValue ?? 0;

      const entityListMsg = comps[URN.Entities]?.entityList;
      const entities = entityListMsg
        ? (EntityListProtoType.toObject(entityListMsg, TOOBJ_OPTS).entities ??
          [])
        : [];

      const configData = comps[URN.AgentConfig]?.config?.data ?? {};
      const maxStep = parseInt(configData["kernel.timesteps"] ?? "300", 10);

      sendTcpMessage(tcp, buildVKAcknowledge(requestID, viewerID));
      console.log(
        `[proxy] KVConnectOK: viewerID=${viewerID}, maxStep=${maxStep}, entities=${entities.length}`,
      );

      send({ type: "INITIAL", viewerID, maxStep, entities, config: configData });
    } else if (urn === URN.KV_CONNECT_ERROR) {
      const reason = comps[URN.RequestID]?.stringValue ?? "unknown";
      console.error("[proxy] KVConnectError:", reason);
      send({ type: "ERROR", reason });
      ws.close();
    } else if (urn === URN.KV_TIMESTEP) {
      const time = comps[URN.Time]?.intValue ?? 0;
      const changeSetMsg = (comps[URN.Updates] ?? comps[URN.Changes])
        ?.changeSet;
      const changes = changeSetMsg
        ? ChangeSetProtoType.toObject(changeSetMsg, TOOBJ_OPTS)
        : { changes: [], deletes: [] };

      const commandListMsg = comps[URN.Commands]?.commandList;
      const commands = [];
      if (commandListMsg) {
        for (const cmd of (commandListMsg.commands ?? [])) {
          const agentId = cmd.components?.[URN.AgentID]?.entityID
                       || cmd.components?.[URN.AgentID]?.intValue;
          if (!agentId) continue;
          const entry = { urn: cmd.urn, agentId };
          const target   = cmd.components?.[0x1401]?.entityID;
          const destX    = cmd.components?.[0x1402]?.intValue;
          const destY    = cmd.components?.[0x1403]?.intValue;
          const channel  = cmd.components?.[0x1407]?.intValue;   // AK_SPEAK channel
          const msgLen   = cmd.components?.[0x1406]?.rawData?.length ?? 0; // message bytes
          const channels = cmd.components?.[0x1408]?.intList?.values ?? []; // AK_SUBSCRIBE
          if (target   != null) entry.target   = target;
          if (destX    != null) entry.destX    = destX;
          if (destY    != null) entry.destY    = destY;
          if (channel  != null) entry.channel  = channel;
          if (msgLen    > 0   ) entry.messageBytes = msgLen;
          if (channels.length > 0) entry.channels = channels;
          commands.push(entry);
        }
      }

      console.log(
        `[proxy] KVTimestep: time=${time}, changes=${changes.changes?.length ?? 0}, commands=${commands.length}`,
      );
      send({ type: "TIMESTEP", time, changes, commands });
    }
  }

  function send(obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }
}
