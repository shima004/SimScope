export interface RcrsEdge {
  startX: number
  startY: number
  endX: number
  endY: number
  neighbour: number // entity ID of neighbouring area (0 = wall)
}

export type Polygon = [number, number][] // [[x, y], ...]

export interface BaseEntity {
  id: number
  urn: number
}

export interface AreaEntity extends BaseEntity {
  x: number
  y: number
  apexes: Polygon
  edges: RcrsEdge[]
  blockades: number[] // entity IDs of blockades on this area
}

export interface BuildingEntity extends AreaEntity {
  fieryness: number    // 0=unburned … 8=completely burned
  brokenness: number   // 0–100
  floors: number
  temperature: number
  ignition: boolean
  importance: number
  buildingAreaGround: number  // m²
}

export interface RefugeEntity extends BuildingEntity {
  bedCapacity: number
  occupiedBeds: number
  waitingListSize: number
}

export interface RoadEntity extends AreaEntity {}

export interface BlockadeEntity extends BaseEntity {
  x: number
  y: number
  apexes: Polygon
  repairCost: number
  position: number // road entity ID
}

export interface HumanEntity extends BaseEntity {
  x: number
  y: number
  position: number      // area entity ID
  hp: number
  damage: number
  buriedness: number
  stamina: number
  positionHistory: number[]
  direction: number
}

export interface FireBrigadeEntity extends HumanEntity {
  waterQuantity: number
}

export type SimEntity =
  | AreaEntity
  | BuildingEntity
  | RefugeEntity
  | RoadEntity
  | BlockadeEntity
  | HumanEntity
  | FireBrigadeEntity
