export const ENTITY_URN_PREFIX = 0x1100 // 4352
export const PROPERTY_URN_PREFIX = 0x1200 // 4608

export const EntityURN = {
  WORLD:            ENTITY_URN_PREFIX | 1,  // 4353
  ROAD:             ENTITY_URN_PREFIX | 2,  // 4354
  BLOCKADE:         ENTITY_URN_PREFIX | 3,  // 4355
  BUILDING:         ENTITY_URN_PREFIX | 4,  // 4356
  REFUGE:           ENTITY_URN_PREFIX | 5,  // 4357
  HYDRANT:          ENTITY_URN_PREFIX | 6,  // 4358
  GAS_STATION:      ENTITY_URN_PREFIX | 7,  // 4359
  FIRE_STATION:     ENTITY_URN_PREFIX | 8,  // 4360
  AMBULANCE_CENTRE: ENTITY_URN_PREFIX | 9,  // 4361
  POLICE_OFFICE:    ENTITY_URN_PREFIX | 10, // 4362
  CIVILIAN:         ENTITY_URN_PREFIX | 11, // 4363
  FIRE_BRIGADE:     ENTITY_URN_PREFIX | 12, // 4364
  AMBULANCE_TEAM:   ENTITY_URN_PREFIX | 13, // 4365
  POLICE_FORCE:     ENTITY_URN_PREFIX | 14, // 4366
} as const

export const PropertyURN = {
  START_TIME:           PROPERTY_URN_PREFIX | 1,  // 4609
  LONGITUDE:            PROPERTY_URN_PREFIX | 2,  // 4610
  LATITUDE:             PROPERTY_URN_PREFIX | 3,  // 4611
  WIND_FORCE:           PROPERTY_URN_PREFIX | 4,  // 4612
  WIND_DIRECTION:       PROPERTY_URN_PREFIX | 5,  // 4613
  X:                    PROPERTY_URN_PREFIX | 6,  // 4614
  Y:                    PROPERTY_URN_PREFIX | 7,  // 4615
  BLOCKADES:            PROPERTY_URN_PREFIX | 8,  // 4616
  REPAIR_COST:          PROPERTY_URN_PREFIX | 9,  // 4617
  FLOORS:               PROPERTY_URN_PREFIX | 10, // 4618
  BUILDING_ATTRIBUTES:  PROPERTY_URN_PREFIX | 11, // 4619
  IGNITION:             PROPERTY_URN_PREFIX | 12, // 4620
  FIERYNESS:            PROPERTY_URN_PREFIX | 13, // 4621
  BROKENNESS:           PROPERTY_URN_PREFIX | 14, // 4622
  BUILDING_CODE:        PROPERTY_URN_PREFIX | 15, // 4623
  BUILDING_AREA_GROUND: PROPERTY_URN_PREFIX | 16, // 4624
  BUILDING_AREA_TOTAL:  PROPERTY_URN_PREFIX | 17, // 4625
  APEXES:               PROPERTY_URN_PREFIX | 18, // 4626
  EDGES:                PROPERTY_URN_PREFIX | 19, // 4627
  POSITION:             PROPERTY_URN_PREFIX | 20, // 4628
  DIRECTION:            PROPERTY_URN_PREFIX | 21, // 4629
  POSITION_HISTORY:     PROPERTY_URN_PREFIX | 22, // 4630
  STAMINA:              PROPERTY_URN_PREFIX | 23, // 4631
  HP:                   PROPERTY_URN_PREFIX | 24, // 4632
  DAMAGE:               PROPERTY_URN_PREFIX | 25, // 4633
  BURIEDNESS:           PROPERTY_URN_PREFIX | 26, // 4634
  TRAVEL_DISTANCE:      PROPERTY_URN_PREFIX | 27, // 4635
  WATER_QUANTITY:       PROPERTY_URN_PREFIX | 28, // 4636
  TEMPERATURE:          PROPERTY_URN_PREFIX | 29, // 4637
  IMPORTANCE:           PROPERTY_URN_PREFIX | 30, // 4638
  CAPACITY:             PROPERTY_URN_PREFIX | 31, // 4639
  BED_CAPACITY:         PROPERTY_URN_PREFIX | 32, // 4640
  OCCUPIED_BEDS:        PROPERTY_URN_PREFIX | 33, // 4641
  REFILL_CAPACITY:      PROPERTY_URN_PREFIX | 34, // 4642
  WAITING_LIST_SIZE:    PROPERTY_URN_PREFIX | 35, // 4643
} as const

export const EntityURNLabel: Record<number, string> = {
  [EntityURN.WORLD]:            'World',
  [EntityURN.ROAD]:             'Road',
  [EntityURN.BLOCKADE]:         'Blockade',
  [EntityURN.BUILDING]:         'Building',
  [EntityURN.REFUGE]:           'Refuge',
  [EntityURN.HYDRANT]:          'Hydrant',
  [EntityURN.GAS_STATION]:      'Gas Station',
  [EntityURN.FIRE_STATION]:     'Fire Station',
  [EntityURN.AMBULANCE_CENTRE]: 'Ambulance Centre',
  [EntityURN.POLICE_OFFICE]:    'Police Office',
  [EntityURN.CIVILIAN]:         'Civilian',
  [EntityURN.FIRE_BRIGADE]:     'Fire Brigade',
  [EntityURN.AMBULANCE_TEAM]:   'Ambulance Team',
  [EntityURN.POLICE_FORCE]:     'Police Force',
}

// urn → human-readable label for InfoPanel
export const PropertyURNLabel: Record<number, string> = {
  [PropertyURN.X]:                    'X',
  [PropertyURN.Y]:                    'Y',
  [PropertyURN.BLOCKADES]:            'Blockades',
  [PropertyURN.REPAIR_COST]:          'Repair Cost',
  [PropertyURN.FLOORS]:               'Floors',
  [PropertyURN.IGNITION]:             'Ignition',
  [PropertyURN.FIERYNESS]:            'Fieryness',
  [PropertyURN.BROKENNESS]:           'Brokenness',
  [PropertyURN.APEXES]:               'Apexes',
  [PropertyURN.POSITION]:             'Position',
  [PropertyURN.DIRECTION]:            'Direction',
  [PropertyURN.STAMINA]:              'Stamina',
  [PropertyURN.HP]:                   'HP',
  [PropertyURN.DAMAGE]:               'Damage',
  [PropertyURN.BURIEDNESS]:           'Buriedness',
  [PropertyURN.WATER_QUANTITY]:       'Water Quantity',
  [PropertyURN.TEMPERATURE]:          'Temperature',
  [PropertyURN.IMPORTANCE]:           'Importance',
  [PropertyURN.CAPACITY]:             'Capacity',
  [PropertyURN.BED_CAPACITY]:         'Bed Capacity',
  [PropertyURN.OCCUPIED_BEDS]:        'Occupied Beds',
  [PropertyURN.REFILL_CAPACITY]:      'Refill Capacity',
  [PropertyURN.WAITING_LIST_SIZE]:    'Waiting List Size',
}

export const FIERYNESS_LABEL: Record<number, string> = {
  0: 'Unburned',
  1: 'Heating',
  2: 'Burning',
  3: 'Inferno',
  4: 'Water Damage',
  5: 'Minor Damage',
  6: 'Moderate Damage',
  7: 'Severe Damage',
  8: 'Completely Burned',
}

export function isAgent(urn: number): boolean {
  return urn === EntityURN.CIVILIAN ||
    urn === EntityURN.FIRE_BRIGADE ||
    urn === EntityURN.AMBULANCE_TEAM ||
    urn === EntityURN.POLICE_FORCE
}

export function isArea(urn: number): boolean {
  return urn === EntityURN.ROAD ||
    urn === EntityURN.BUILDING ||
    urn === EntityURN.REFUGE ||
    urn === EntityURN.HYDRANT ||
    urn === EntityURN.GAS_STATION ||
    urn === EntityURN.FIRE_STATION ||
    urn === EntityURN.AMBULANCE_CENTRE ||
    urn === EntityURN.POLICE_OFFICE
}

export function isBuilding(urn: number): boolean {
  return urn === EntityURN.BUILDING ||
    urn === EntityURN.REFUGE ||
    urn === EntityURN.GAS_STATION ||
    urn === EntityURN.FIRE_STATION ||
    urn === EntityURN.AMBULANCE_CENTRE ||
    urn === EntityURN.POLICE_OFFICE
}
