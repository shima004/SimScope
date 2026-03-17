<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Deck, OrthographicView } from '@deck.gl/core'
  import type { PickingInfo, OrthographicViewState } from '@deck.gl/core'
  import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
  import { entities, selectedId, agentActions } from '$lib/stores/simulation'
  import { CommandURN, EntityURN, isBuilding, isAgent } from '$lib/rcrs/urns'
  import type { SimEntity, BuildingEntity, RoadEntity, BlockadeEntity, HumanEntity } from '$lib/rcrs/types'

  let canvas: HTMLCanvasElement
  let deck: Deck<OrthographicView> | null = null

  // ── Color helpers ─────────────────────────────────────────────────────────

  // Base color per facility type (used when not on fire)
  const FACILITY_COLOR: Partial<Record<number, [number, number, number]>> = {
    [EntityURN.REFUGE]:           [40,  200, 100],  // 避難所: 緑
    [EntityURN.FIRE_STATION]:     [220, 60,  60 ],  // 消防署: 赤
    [EntityURN.AMBULANCE_CENTRE]: [60,  160, 220],  // 救急センター: 水色
    [EntityURN.POLICE_OFFICE]:    [80,  80,  220],  // 警察署: 青
    [EntityURN.GAS_STATION]:      [220, 180, 40 ],  // ガスステーション: 黄
    [EntityURN.HYDRANT]:          [40,  220, 220],  // 消火栓: シアン
  }

  function buildingColor(e: BuildingEntity): [number, number, number, number] {
    const f = e.fieryness
    // Burning / burned state overrides facility color
    if (f >= 1 && f <= 3) return [255, Math.max(0, 180 - f * 50), 0, 230]
    if (f === 8)          return [60,  40,  40,  200]
    if (f >= 4 && f <= 7) return [160, 80,  40,  200]

    const base = FACILITY_COLOR[e.urn]
    if (base) return [...base, 240] as [number, number, number, number]

    // Regular building: darken with brokenness
    return e.brokenness > 50 ? [180, 120, 60, 220] : [80, 100, 140, 220]
  }

  function agentColor(urn: number, action?: number, carrying = false): [number, number, number, number] {
    if (urn === EntityURN.FIRE_BRIGADE && action === CommandURN.AK_RESCUE) {
      return [255, 140, 0,   255]  // rescue中: オレンジ
    }
    if (urn === EntityURN.AMBULANCE_TEAM && carrying) {
      return [255, 200, 60,  255]  // 市民搬送中: 黄色
    }
    switch (urn) {
      case EntityURN.FIRE_BRIGADE:   return [220, 30,  30,  255]  // 赤
      case EntityURN.AMBULANCE_TEAM: return [240, 240, 240, 255]  // 白
      case EntityURN.POLICE_FORCE:   return [60,  140, 255, 255]
      case EntityURN.CIVILIAN:       return [60,  200, 80,  255]  // 緑
      default:                       return [200, 200, 200, 255]
    }
  }

  // ── Layer builders ────────────────────────────────────────────────────────

  function buildLayers(emap: Map<number, SimEntity>, selId: number | null, actions: Map<number, number>) {
    const roads:     RoadEntity[]     = []
    const buildings: BuildingEntity[] = []
    const blockades: BlockadeEntity[] = []
    const agents:    HumanEntity[]    = []

    for (const e of emap.values()) {
      if (e.urn === EntityURN.ROAD)          roads.push(e as RoadEntity)
      else if (isBuilding(e.urn))            buildings.push(e as BuildingEntity)
      else if (e.urn === EntityURN.BLOCKADE) blockades.push(e as BlockadeEntity)
      else if (isAgent(e.urn))               agents.push(e as HumanEntity)
    }

    // 市民の position が救急隊の ID になっていれば「搬送中」
    const carryingAmbulances = new Set<number>()
    for (const e of emap.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const carrier = emap.get((e as HumanEntity).position)
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) carryingAmbulances.add(carrier.id)
      }
    }

    return [
      new PolygonLayer({
        id: 'roads',
        data: roads,
        getPolygon: (d: RoadEntity) => d.apexes,
        getFillColor: [45, 55, 70, 200],
        getLineColor: [70, 85, 105, 255],
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as RoadEntity)?.id ?? null),
      }),

      new PolygonLayer({
        id: 'buildings',
        data: buildings,
        getPolygon: (d: BuildingEntity) => d.apexes,
        getFillColor: (d: BuildingEntity) => buildingColor(d),
        getLineColor: (d: BuildingEntity) =>
          d.id === selId ? [0, 220, 255, 255] : [100, 120, 160, 180],
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as BuildingEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: buildings.map(b => b.fieryness * 100 + b.brokenness),
          getLineColor: [selId],
        },
      }),

      new PolygonLayer({
        id: 'blockades',
        data: blockades,
        getPolygon: (d: BlockadeEntity) => d.apexes,
        getFillColor: [200, 160, 40, 200],
        getLineColor: (d: BlockadeEntity) =>
          d.id === selId ? [0, 220, 255, 255] : [240, 200, 60, 255],
        lineWidthMinPixels: 1,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as BlockadeEntity)?.id ?? null),
        updateTriggers: { getLineColor: [selId] },
      }),

      new ScatterplotLayer({
        id: 'agents',
        data: agents,
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: (d: HumanEntity) => agentColor(d.urn, actions.get(d.id), carryingAmbulances.has(d.id)),
        getRadius: (d: HumanEntity) => d.id === selId ? 800 : 500,
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as HumanEntity)?.id ?? null),
        updateTriggers: { getRadius: [selId], getFillColor: [actions] },
      }),

      // POSITION_HISTORY のエンティティ ID → X,Y でパスを構築
      new PathLayer({
        id: 'agent-trails',
        data: agents.filter(a => a.positionHistory.length >= 2),
        getPath: (d: HumanEntity) => {
          const pts: [number, number][] = []
          for (let i = 0; i + 1 < d.positionHistory.length; i += 2) {
            pts.push([d.positionHistory[i], d.positionHistory[i + 1]])
          }
          return pts
        },
        getColor: (d: HumanEntity) => {
          const [r, g, b] = agentColor(d.urn, actions.get(d.id), carryingAmbulances.has(d.id))
          return [r, g, b, d.id === selId ? 220 : 60] as [number, number, number, number]
        },
        getWidth: (d: HumanEntity) => d.id === selId ? 400 : 200,
        widthMinPixels: 1,
        widthMaxPixels: 4,
        updateTriggers: { getColor: [selId], getWidth: [selId] },
      }),
    ]
  }

  // ── Viewport fit ──────────────────────────────────────────────────────────

  function fitViewport(emap: Map<number, SimEntity>) {
    if (emap.size === 0 || !deck) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const e of emap.values()) {
      if ('apexes' in e) {
        for (const [x, y] of (e as { apexes: [number, number][] }).apexes) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (!isFinite(minX)) return

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const span = Math.max(maxX - minX, maxY - minY)
    const viewSize = Math.min(canvas.clientWidth, canvas.clientHeight)
    const zoom = Math.log2(viewSize / span) - 0.2

    const target: [number, number, number] = [cx, cy, 0]
    const viewState: OrthographicViewState = { target, zoom, minZoom: zoom - 5, maxZoom: zoom + 10 }
    deck.setProps({ initialViewState: viewState })
  }

  // ── Follow mode ───────────────────────────────────────────────────────────

  let followMode = $state(false)
  let currentZoom = 0

  function followAgent(emap: Map<number, SimEntity>, selId: number | null) {
    if (!followMode || selId === null || !deck) return
    const e = emap.get(selId)
    if (!e || !isAgent(e.urn)) return
    const h = e as HumanEntity
    deck.setProps({
      initialViewState: {
        target: [h.x, h.y, 0] as [number, number, number],
        zoom: currentZoom,
        minZoom: currentZoom - 5,
        maxZoom: currentZoom + 10,
      },
    })
  }

  // ── Store subscriptions ───────────────────────────────────────────────────

  let prevSize = 0

  const unsubEntities = entities.subscribe((emap) => {
    if (!deck) return
    const selId = $selectedId
    deck.setProps({ layers: buildLayers(emap, selId, $agentActions) })
    if (prevSize === 0 && emap.size > 0) fitViewport(emap)
    prevSize = emap.size
    followAgent(emap, selId)
  })

  const unsubSel = selectedId.subscribe((selId) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, selId, $agentActions) })
    followAgent($entities, selId)
  })

  const unsubActions = agentActions.subscribe((actions) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, $selectedId, actions) })
  })

  // ── Deck.gl lifecycle ─────────────────────────────────────────────────────

  onMount(() => {
    const initialViewState: OrthographicViewState = { target: [0, 0, 0], zoom: 0 }
    deck = new Deck<OrthographicView>({
      canvas,
      views: new OrthographicView({ id: 'ortho', flipY: false }),
      initialViewState,
      controller: true,
      layers: [],
      getCursor: ({ isDragging }) => isDragging ? 'grabbing' : 'crosshair',
      onViewStateChange: ({ viewState }) => {
        const z = (viewState as OrthographicViewState).zoom
        if (typeof z === 'number') currentZoom = z
      },
    })
  })

  onDestroy(() => {
    unsubEntities()
    unsubSel()
    unsubActions()
    deck?.finalize()
  })
</script>

<canvas bind:this={canvas} class="sim-canvas"></canvas>

<button
  class="follow-btn"
  class:active={followMode}
  onclick={() => followMode = !followMode}
  title="選択中のエージェントに追従"
>
  {followMode ? '⊙ Follow ON' : '⊙ Follow'}
</button>

<style>
  .sim-canvas {
    width: 100%;
    height: 100%;
    display: block;
    background: #0d1117;
  }

  .follow-btn {
    position: absolute;
    bottom: 16px;
    right: 16px;
    background: rgba(13, 20, 30, 0.88);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 4px;
    color: #607080;
    font-size: 12px;
    padding: 5px 10px;
    cursor: pointer;
    backdrop-filter: blur(4px);
    z-index: 10;
  }
  .follow-btn:hover { border-color: rgba(0, 200, 255, 0.4); color: #a8c8d8; }
  .follow-btn.active {
    border-color: rgba(0, 200, 255, 0.6);
    color: #00c8ff;
    background: rgba(0, 180, 255, 0.12);
  }
</style>
