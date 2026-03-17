import { writable, derived, get } from 'svelte/store'
import { LogProto as LogProtoCodec } from '$lib/proto/RCRSLogProto'
import type { ChangeSetProto } from '$lib/proto/RCRSProto'
import { decodeEntity, applyChanges } from '$lib/rcrs/decoder'
import { extract7zAllFiles } from '$lib/sevenzip'
import type { SimEntity } from '$lib/rcrs/types'

type LogProtoMsg = ReturnType<(typeof LogProtoCodec)['decode']>

// ── Source state ─────────────────────────────────────────────────────────────

export type Mode = 'idle' | 'ws' | 'file'

export const mode        = writable<Mode>('idle')
export const connected   = writable(false)
export const loading     = writable(false)
export const errorMsg    = writable<string | null>(null)

// ── Simulation data ──────────────────────────────────────────────────────────

/**
 * Base (initial conditions) entity map — never mutated after load.
 * Used as the snapshot to replay from when scrubbing.
 */
let baseEntities = new Map<number, SimEntity>()

/**
 * Per-timestep changes — only populated in file mode.
 */
let timeline: Map<number, ChangeSetProto> = new Map()

export const entities       = writable<Map<number, SimEntity>>(new Map())
export const currentStep    = writable(0)
export const maxStep        = writable(0)
export const selectedId     = writable<number | null>(null)

export const selectedEntity = derived(
  [entities, selectedId],
  ([$entities, $selectedId]) => ($selectedId !== null ? $entities.get($selectedId) ?? null : null),
)

// ── WebSocket ─────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null

export function connectWS(url: string) {
  if (ws) disconnectWS()
  errorMsg.set(null)
  mode.set('ws')

  try {
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
  } catch (e) {
    errorMsg.set(`WebSocket error: ${e}`)
    mode.set('idle')
    return
  }

  ws.onopen = () => connected.set(true)

  ws.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
    try {
      const frame = LogProtoCodec.decode(new Uint8Array(data))
      handleLogFrame(frame)
    } catch (e) {
      console.error('Failed to decode LogProto frame', e)
    }
  }

  ws.onerror = () => errorMsg.set('WebSocket connection error')

  ws.onclose = () => {
    connected.set(false)
    // Auto-reconnect after 3 s
    setTimeout(() => {
      if (get(mode) === 'ws') connectWS(url)
    }, 3000)
  }
}

export function disconnectWS() {
  if (!ws) return
  ws.onclose = null
  ws.close()
  ws = null
  connected.set(false)
  mode.set('idle')
}

// ── File loading ──────────────────────────────────────────────────────────────

export async function loadFile(file: File) {
  loading.set(true)
  errorMsg.set(null)
  mode.set('file')
  reset()

  try {
    const raw = await file.arrayBuffer()
    const files = await extract7zAllFiles(raw)

    // INITIAL_CONDITIONS may be at top level or inside a subdirectory (e.g. rescue.log/)
    const initialKey = Array.from(files.keys()).find(k => k.endsWith('INITIAL_CONDITIONS'))
    if (initialKey) {
      handleLogFrame(LogProtoCodec.decode(files.get(initialKey)!))
    }

    // Collect all N/UPDATES entries and process in numeric order
    const updates = Array.from(files.keys())
      .filter(k => k.endsWith('/UPDATES'))
      .map(k => {
        const parts = k.split('/')
        const step = parseInt(parts[parts.length - 2], 10)
        return { step, key: k }
      })
      .filter(({ step }) => !isNaN(step))
      .sort((a, b) => a.step - b.step)

    for (const { key } of updates) {
      handleLogFrame(LogProtoCodec.decode(files.get(key)!))
    }

    currentStep.set(0)
    rebuildState(0)
  } catch (e) {
    errorMsg.set(`Failed to parse log file: ${e}`)
    mode.set('idle')
  } finally {
    loading.set(false)
  }
}

// ── Timeline scrubbing (file mode only) ───────────────────────────────────────

export function seekToStep(step: number) {
  if (get(mode) !== 'file') return
  rebuildState(step)
  currentStep.set(step)
}

function rebuildState(targetStep: number) {
  const snapshot = new Map<number, SimEntity>(
    Array.from(baseEntities.entries()).map(([k, v]) => [k, { ...v }]),
  )

  for (let s = 1; s <= targetStep; s++) {
    const changes = timeline.get(s)
    if (changes) applyChanges(snapshot, changes)
  }

  entities.set(snapshot)
}

// ── Frame handling (shared by WS + file) ─────────────────────────────────────

function handleLogFrame(frame: LogProtoMsg) {
  if (frame.initialCondition) {
    const map = new Map<number, SimEntity>()
    for (const proto of frame.initialCondition.entities) {
      const entity = decodeEntity(proto)
      if (entity) map.set(entity.id, entity)
    }
    baseEntities = new Map(map)
    entities.set(map)
  }

  if (frame.update) {
    const { time, changes } = frame.update

    if (get(mode) === 'file') {
      if (changes) {
        timeline.set(time, changes)
        if (time > get(maxStep)) maxStep.set(time)
      }
    } else {
      // WS: apply immediately
      if (changes) {
        entities.update(map => applyChanges(map, changes))
        currentStep.set(time)
      }
    }
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function reset() {
  baseEntities = new Map()
  timeline = new Map()
  entities.set(new Map())
  currentStep.set(0)
  maxStep.set(0)
  selectedId.set(null)
}
