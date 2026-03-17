export const ENTITY_URN_PREFIX    = 0x1100 // 4352
export const PROPERTY_URN_PREFIX  = 0x1200 // 4608
export const COMMAND_URN_PREFIX   = 0x1300 // 4864
export const COMP_CMD_URN_PREFIX  = 0x1400 // 5120

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

export const CommandURN = {
  AK_REST:       COMMAND_URN_PREFIX | 0x01, // 0x1301
  AK_MOVE:       COMMAND_URN_PREFIX | 0x02, // 0x1302
  AK_LOAD:       COMMAND_URN_PREFIX | 0x03, // 0x1303
  AK_UNLOAD:     COMMAND_URN_PREFIX | 0x04, // 0x1304
  AK_SAY:        COMMAND_URN_PREFIX | 0x05, // 0x1305
  AK_TELL:       COMMAND_URN_PREFIX | 0x06, // 0x1306
  AK_EXTINGUISH: COMMAND_URN_PREFIX | 0x07, // 0x1307
  AK_RESCUE:     COMMAND_URN_PREFIX | 0x08, // 0x1308
  AK_CLEAR:      COMMAND_URN_PREFIX | 0x09, // 0x1309
  AK_CLEAR_AREA: COMMAND_URN_PREFIX | 0x0a, // 0x130a
  AK_SUBSCRIBE:  COMMAND_URN_PREFIX | 0x0b, // 0x130b
  AK_SPEAK:      COMMAND_URN_PREFIX | 0x0c, // 0x130c
} as const

export const CommandURNLabel: Record<number, string> = {
  [CommandURN.AK_REST]:       'Rest',
  [CommandURN.AK_MOVE]:       'Move',
  [CommandURN.AK_LOAD]:       'Load',
  [CommandURN.AK_UNLOAD]:     'Unload',
  [CommandURN.AK_SAY]:        'Say',
  [CommandURN.AK_TELL]:       'Tell',
  [CommandURN.AK_EXTINGUISH]: 'Extinguish',
  [CommandURN.AK_RESCUE]:     'Rescue',
  [CommandURN.AK_CLEAR]:      'Clear',
  [CommandURN.AK_CLEAR_AREA]: 'Clear Area',
  [CommandURN.AK_SUBSCRIBE]:  'Subscribe',
  [CommandURN.AK_SPEAK]:      'Speak',
}

export const ComponentCommandURN = {
  Target:       COMP_CMD_URN_PREFIX | 0x01, // 0x1401
  DestinationX: COMP_CMD_URN_PREFIX | 0x02, // 0x1402
  DestinationY: COMP_CMD_URN_PREFIX | 0x03, // 0x1403
  Water:        COMP_CMD_URN_PREFIX | 0x04, // 0x1404
  Path:         COMP_CMD_URN_PREFIX | 0x05, // 0x1405
  Message:      COMP_CMD_URN_PREFIX | 0x06, // 0x1406
  Channel:      COMP_CMD_URN_PREFIX | 0x07, // 0x1407
  Channels:     COMP_CMD_URN_PREFIX | 0x08, // 0x1408
} as const

export const ControlMsgURN = {
  KG_CONNECT:          0x0101,
  KG_ACKNOWLEDGE:      0x0102,
  GK_CONNECT_OK:       0x0103,
  GK_CONNECT_ERROR:    0x0104,
  SK_CONNECT:          0x0105,
  SK_ACKNOWLEDGE:      0x0106,
  SK_UPDATE:           0x0107,
  KS_CONNECT_OK:       0x0108,
  KS_CONNECT_ERROR:    0x0109,
  KS_UPDATE:           0x010a,
  KS_COMMANDS:         0x010b,
  KS_AFTERSHOCKS_INFO: 0x010c,
  VK_CONNECT:          0x010d,
  VK_ACKNOWLEDGE:      0x010e,
  KV_CONNECT_OK:       0x010f,
  KV_CONNECT_ERROR:    0x0110,
  KV_TIMESTEP:         0x0111,
  AK_CONNECT:          0x0112,
  AK_ACKNOWLEDGE:      0x0113,
  KA_CONNECT_OK:       0x0114,
  KA_CONNECT_ERROR:    0x0115,
  KA_SENSE:            0x0116,
  SHUTDOWN:            0x0117,
  ENTITY_ID_REQUEST:   0x0118,
  ENTITY_ID_RESPONSE:  0x0119,
} as const

export const ComponentControlMsgURN = {
  RequestID:            0x0201,
  AgentID:              0x0202,
  Version:              0x0203,
  Name:                 0x0204,
  RequestedEntityTypes: 0x0205,
  SimulatorID:          0x0206,
  RequestNumber:        0x0207,
  NumberOfIDs:          0x0208,
  NewEntityIDs:         0x0209,
  Reason:               0x020a,
  Entities:             0x020b,
  ViewerID:             0x020c,
  AgentConfig:          0x020d,
  Time:                 0x020e,
  Updates:              0x020f,
  Hearing:              0x0210,
  INTENSITIES:          0x0211,
  TIMES:                0x0212,
  ID:                   0x0213,
  Commands:             0x0214,
  SimulatorConfig:      0x0215,
  Changes:              0x0216,
} as const

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
