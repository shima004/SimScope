import type {
  ChangeSetProto,
  EntityProto,
  PropertyProto,
} from "$lib/proto/RCRSProto";
import type {
  AreaEntity,
  BlockadeEntity,
  BuildingEntity,
  FireBrigadeEntity,
  HumanEntity,
  Polygon,
  RcrsEdge,
  RefugeEntity,
  RoadEntity,
  SimEntity,
} from "./types";
import { EntityURN, PropertyURN, isAgent, isArea, isBuilding } from "./urns";

// ── Property helpers ────────────────────────────────────────────────────────

function propMap(props: PropertyProto[]): Map<number, PropertyProto> {
  const m = new Map<number, PropertyProto>();
  for (const p of props) m.set(p.urn, p);
  return m;
}

function intProp(m: Map<number, PropertyProto>, urn: number): number {
  const p = m.get(urn);
  return p?.defined && p.intValue !== undefined ? p.intValue : 0;
}

function boolProp(m: Map<number, PropertyProto>, urn: number): boolean {
  const p = m.get(urn);
  return p?.defined && p.boolValue !== undefined ? p.boolValue : false;
}

function intListProp(m: Map<number, PropertyProto>, urn: number): number[] {
  const p = m.get(urn);
  return p?.defined && p.intList ? p.intList.values : [];
}

function apexesProp(m: Map<number, PropertyProto>): Polygon {
  const flat = intListProp(m, PropertyURN.APEXES);
  const polygon: Polygon = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    polygon.push([flat[i], flat[i + 1]]);
  }
  return polygon;
}

function edgesProp(m: Map<number, PropertyProto>): RcrsEdge[] {
  const p = m.get(PropertyURN.EDGES);
  if (!p?.defined || !p.edgeList) return [];
  return p.edgeList.edges.map((e) => ({
    startX: e.startX,
    startY: e.startY,
    endX: e.endX,
    endY: e.endY,
    neighbour: e.neighbour,
  }));
}

// ── Entity decoders ─────────────────────────────────────────────────────────

function decodeArea(proto: EntityProto): AreaEntity {
  const m = propMap(proto.properties);
  const apexesFromIntList = apexesProp(m);
  const edges = edgesProp(m);
  // When apexes intList is absent (common in this RCRS version),
  // reconstruct the polygon from the ordered edge start points.
  const apexes: Polygon =
    apexesFromIntList.length > 0
      ? apexesFromIntList
      : edges.map((e) => [e.startX, e.startY]);
  return {
    id: proto.entityID,
    urn: proto.urn,
    x: intProp(m, PropertyURN.X),
    y: intProp(m, PropertyURN.Y),
    apexes,
    edges,
    blockades: intListProp(m, PropertyURN.BLOCKADES),
  };
}

function decodeBuilding(proto: EntityProto): BuildingEntity {
  const area = decodeArea(proto);
  const m = propMap(proto.properties);
  return {
    ...area,
    fieryness: intProp(m, PropertyURN.FIERYNESS),
    brokenness: intProp(m, PropertyURN.BROKENNESS),
    floors: intProp(m, PropertyURN.FLOORS),
    temperature: intProp(m, PropertyURN.TEMPERATURE),
    ignition: boolProp(m, PropertyURN.IGNITION),
    importance: intProp(m, PropertyURN.IMPORTANCE),
    buildingAreaGround: intProp(m, PropertyURN.BUILDING_AREA_GROUND),
  };
}

function decodeBlockade(proto: EntityProto): BlockadeEntity {
  const m = propMap(proto.properties);
  return {
    id: proto.entityID,
    urn: proto.urn,
    x: intProp(m, PropertyURN.X),
    y: intProp(m, PropertyURN.Y),
    apexes: apexesProp(m),
    repairCost: intProp(m, PropertyURN.REPAIR_COST),
    position: intProp(m, PropertyURN.POSITION),
  };
}

function decodeHuman(proto: EntityProto): HumanEntity {
  const m = propMap(proto.properties);
  return {
    id: proto.entityID,
    urn: proto.urn,
    x: intProp(m, PropertyURN.X),
    y: intProp(m, PropertyURN.Y),
    position: intProp(m, PropertyURN.POSITION),
    hp: intProp(m, PropertyURN.HP),
    damage: intProp(m, PropertyURN.DAMAGE),
    buriedness: intProp(m, PropertyURN.BURIEDNESS),
    stamina: intProp(m, PropertyURN.STAMINA),
    positionHistory: intListProp(m, PropertyURN.POSITION_HISTORY),
    direction: intProp(m, PropertyURN.DIRECTION),
  };
}

function decodeRefuge(proto: EntityProto): RefugeEntity {
  const m = propMap(proto.properties);
  return {
    ...decodeBuilding(proto),
    bedCapacity: intProp(m, PropertyURN.BED_CAPACITY),
    occupiedBeds: intProp(m, PropertyURN.OCCUPIED_BEDS),
    waitingListSize: intProp(m, PropertyURN.WAITING_LIST_SIZE),
  };
}

function decodeFireBrigade(proto: EntityProto): FireBrigadeEntity {
  const human = decodeHuman(proto);
  const m = propMap(proto.properties);
  return {
    ...human,
    waterQuantity: intProp(m, PropertyURN.WATER_QUANTITY),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function decodeEntity(proto: EntityProto): SimEntity | null {
  const { urn } = proto;
  if (urn === EntityURN.REFUGE) return decodeRefuge(proto);
  if (isBuilding(urn)) return decodeBuilding(proto);
  if (urn === EntityURN.ROAD) return decodeArea(proto) as RoadEntity;
  if (urn === EntityURN.BLOCKADE) return decodeBlockade(proto);
  if (urn === EntityURN.FIRE_BRIGADE) return decodeFireBrigade(proto);
  if (isAgent(urn)) return decodeHuman(proto);
  if (isArea(urn)) return decodeArea(proto);
  return null; // WORLD etc.
}

/**
 * Apply a ChangeSetProto diff to a mutable entity map.
 * Returns the same map (mutated in place) for convenience.
 */
export function applyChanges(
  entities: Map<number, SimEntity>,
  changes: ChangeSetProto,
): Map<number, SimEntity> {
  for (const change of changes.changes) {
    const existing = entities.get(change.entityID);
    if (!existing) {
      // New entity created mid-simulation (e.g. blockade).
      // EntityChangeProto has the same fields as EntityProto.
      const entity = decodeEntity(change as unknown as EntityProto);
      if (entity) entities.set(entity.id, entity);
      continue;
    }

    // Build a partial EntityProto with only the changed properties and
    // decode its property values, then merge into the existing entity.
    const m = propMap(change.properties);
    const updated = { ...existing } as Record<string, unknown>;

    // Properties common to most entities
    if (m.has(PropertyURN.X)) updated.x = intProp(m, PropertyURN.X);
    if (m.has(PropertyURN.Y)) updated.y = intProp(m, PropertyURN.Y);
    if (m.has(PropertyURN.POSITION))
      updated.position = intProp(m, PropertyURN.POSITION);
    if (m.has(PropertyURN.HP)) updated.hp = intProp(m, PropertyURN.HP);
    if (m.has(PropertyURN.DAMAGE))
      updated.damage = intProp(m, PropertyURN.DAMAGE);
    if (m.has(PropertyURN.BURIEDNESS))
      updated.buriedness = intProp(m, PropertyURN.BURIEDNESS);
    if (m.has(PropertyURN.STAMINA))
      updated.stamina = intProp(m, PropertyURN.STAMINA);
    if (m.has(PropertyURN.WATER_QUANTITY))
      updated.waterQuantity = intProp(m, PropertyURN.WATER_QUANTITY);
    if (m.has(PropertyURN.FIERYNESS))
      updated.fieryness = intProp(m, PropertyURN.FIERYNESS);
    if (m.has(PropertyURN.BROKENNESS))
      updated.brokenness = intProp(m, PropertyURN.BROKENNESS);
    if (m.has(PropertyURN.TEMPERATURE))
      updated.temperature = intProp(m, PropertyURN.TEMPERATURE);
    if (m.has(PropertyURN.IGNITION))
      updated.ignition = boolProp(m, PropertyURN.IGNITION);
    if (m.has(PropertyURN.BLOCKADES))
      updated.blockades = intListProp(m, PropertyURN.BLOCKADES);
    if (m.has(PropertyURN.REPAIR_COST))
      updated.repairCost = intProp(m, PropertyURN.REPAIR_COST);
    if (m.has(PropertyURN.POSITION_HISTORY))
      updated.positionHistory = intListProp(m, PropertyURN.POSITION_HISTORY);
    if (m.has(PropertyURN.DIRECTION))
      updated.direction = intProp(m, PropertyURN.DIRECTION);
    if (m.has(PropertyURN.APEXES)) updated.apexes = apexesProp(m);
    if (m.has(PropertyURN.BED_CAPACITY))
      updated.bedCapacity = intProp(m, PropertyURN.BED_CAPACITY);
    if (m.has(PropertyURN.OCCUPIED_BEDS))
      updated.occupiedBeds = intProp(m, PropertyURN.OCCUPIED_BEDS);
    if (m.has(PropertyURN.WAITING_LIST_SIZE))
      updated.waitingListSize = intProp(m, PropertyURN.WAITING_LIST_SIZE);
    entities.set(change.entityID, updated as unknown as SimEntity);
  }

  for (const id of changes.deletes) {
    entities.delete(id);
  }

  return entities;
}

/**
 * Peek at a raw LogProto frame (Uint8Array) and return the entityID if it is a
 * PerceptionLogProto frame, or null otherwise.  This avoids a full protobuf
 * decode and is used to filter out unwanted agents before the expensive parse.
 *
 * Wire layout used:
 *   LogProto.perception = field 4, wire type 2 → tag byte 0x22
 *   PerceptionLogProto.entityID = field 2, wire type 0 → tag byte 0x10
 */
export function peekPerceptionEntityId(bytes: Uint8Array): number | null {
  // First byte of a perception frame must be the field-4 LEN tag (0x22)
  if (bytes.length < 2 || bytes[0] !== 0x22) return null;

  // Skip the varint sub-message length
  let pos = 1;
  while (pos < bytes.length && (bytes[pos] & 0x80) !== 0) pos++;
  pos++; // consume last varint byte

  // Scan PerceptionLogProto bytes for entityID (field 2, tag 0x10)
  while (pos < bytes.length) {
    const tag = bytes[pos++];
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNum === 2 && wireType === 0) {
      // Read varint int32 value
      let val = 0, shift = 0;
      while (pos < bytes.length) {
        const b = bytes[pos++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if ((b & 0x80) === 0) break;
      }
      return val;
    }

    // Skip this field according to its wire type
    switch (wireType) {
      case 0: // varint
        while (pos < bytes.length && (bytes[pos++] & 0x80) !== 0); break;
      case 1: pos += 8; break; // 64-bit
      case 2: { // LEN-delimited
        let len = 0, shift = 0;
        while (pos < bytes.length) {
          const b = bytes[pos++];
          len |= (b & 0x7f) << shift;
          shift += 7;
          if ((b & 0x80) === 0) break;
        }
        pos += len;
        break;
      }
      case 5: pos += 4; break; // 32-bit
      default: return null;
    }
  }
  return null;
}

/**
 * Parse a sequence of length-delimited LogProto frames from a binary buffer.
 *
 * Format auto-detection:
 *   - First byte 0x00 → Java DataOutputStream.writeInt() style:
 *       4-byte big-endian uint32 length prefix (used by RCRS log writer)
 *   - Otherwise → protobuf writeDelimitedTo() style:
 *       varint length prefix
 */
export function* readDelimitedFrames(
  buffer: ArrayBuffer,
): Generator<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return;

  const int4Format = bytes[0] === 0x00;

  let pos = 0;
  while (pos < bytes.length) {
    let len: number;

    if (int4Format) {
      if (pos + 4 > bytes.length) break;
      len =
        ((bytes[pos] << 24) |
          (bytes[pos + 1] << 16) |
          (bytes[pos + 2] << 8) |
          bytes[pos + 3]) >>>
        0;
      pos += 4;
    } else {
      len = 0;
      let shift = 0;
      while (pos < bytes.length) {
        const byte = bytes[pos++];
        len |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }
    }

    if (len === 0) continue;
    if (pos + len > bytes.length) break;

    yield bytes.slice(pos, pos + len);
    pos += len;
  }
}
