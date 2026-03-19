<script lang="ts">
  import type { BlockadeEntity, BuildingEntity, HumanEntity, RoadEntity, SimEntity } from '$lib/rcrs/types';
  import { CommandURN, EntityURN, isAgent, isBuilding } from '$lib/rcrs/urns';
  import type { AgentAction, CommMessage } from '$lib/stores/simulation';
  import { agentActions, agentReceivedComms, agentVisibleIds, entities, focusPoint, followMode, kernelConfig, selectedId } from '$lib/stores/simulation';
  import type { OrthographicViewState, PickingInfo } from '@deck.gl/core';
  import { Deck, OrthographicView } from '@deck.gl/core';
  import { LineLayer, PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
  import { onDestroy, onMount } from 'svelte';

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

    // Regular building: brokenness が 1 以上で茶色
    return e.brokenness > 0 ? [180, 120, 60, 220] : [80, 100, 140, 220]
  }

  function agentColor(urn: number, action?: AgentAction, carrying = false, hp = 10000): [number, number, number, number] {
    if (urn === EntityURN.FIRE_BRIGADE && action?.urn === CommandURN.AK_RESCUE) {
      return [255, 140, 0,   255]  // rescue中: オレンジ
    }
    if (urn === EntityURN.AMBULANCE_TEAM && carrying) {
      return [255, 200, 60,  255]  // 市民搬送中: 黄色
    }
    if (urn === EntityURN.CIVILIAN) {
      const t = Math.max(0, Math.min(1, hp / 10000))
      return [Math.round(60 * t), Math.round(200 * t), Math.round(80 * t), 255]
    }
    switch (urn) {
      case EntityURN.FIRE_BRIGADE:   return [220, 30,  30,  255]  // 赤
      case EntityURN.AMBULANCE_TEAM: return [240, 240, 240, 255]  // 白
      case EntityURN.POLICE_FORCE:   return [60,  140, 255, 255]
      default:                       return [200, 200, 200, 255]
    }
  }

  // ── Layer builders ────────────────────────────────────────────────────────

  function buildLayers(
    emap: Map<number, SimEntity>,
    selId: number | null,
    actions: Map<number, AgentAction>,
    cfg: Record<string, string>,
    perceivedIds: Set<number> | null,
    comms: CommMessage[] | null,
  ) {
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

    // 搬送中マップ: ambulanceId → civilian
    const carrierMap = new Map<number, HumanEntity>()
    const carriedIds = new Set<number>()
    for (const e of emap.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity
        const carrier = emap.get(h.position)
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          carrierMap.set(carrier.id, h)
          carriedIds.add(h.id)
        }
      }
    }

    // 搬送中の市民はメインリストから除外
    const visibleAgents = agents.filter(a => !carriedIds.has(a.id))

    // AK_CLEAR: ハイライト対象のブロッケード ID
    const clearingTargets = new Set<number>()
    // AK_CLEAR_AREA: 矩形ポリゴン
    const clearDist = parseInt(cfg['clear.repair.distance'] ?? '10000', 10)
    const clearRad  = parseInt(cfg['clear.repair.rad']      ?? '2000',  10)
    const clearAreaPolygons: [number, number][][] = []

    for (const [agentId, action] of actions) {
      if (action.urn === CommandURN.AK_CLEAR && action.target !== undefined) {
        clearingTargets.add(action.target)
      } else if (action.urn === CommandURN.AK_CLEAR_AREA &&
                 action.destX !== undefined && action.destY !== undefined) {
        const agent = emap.get(agentId) as HumanEntity | undefined
        if (!agent) continue
        const dx = action.destX - agent.x
        const dy = action.destY - agent.y
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len === 0) continue
        // 進行方向の単位ベクトルと直角ベクトル
        const nx = dx / len,  ny = dy / len   // 進行方向
        const px = -ny,       py = nx          // 直角（左）
        // 矩形の4頂点: 起点=エージェント、終点=進行方向にclearDist
        const ex = agent.x + nx * clearDist
        const ey = agent.y + ny * clearDist
        clearAreaPolygons.push([
          [agent.x + px * clearRad, agent.y + py * clearRad],
          [agent.x - px * clearRad, agent.y - py * clearRad],
          [ex     - px * clearRad, ey     - py * clearRad],
          [ex     + px * clearRad, ey     + py * clearRad],
        ])
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
        getFillColor: (d: BuildingEntity) => {
          const [r, g, b, a] = buildingColor(d)
          if (perceivedIds && !perceivedIds.has(d.id)) return [r, g, b, Math.round(a * 0.2)]
          return [r, g, b, a]
        },
        getLineColor: (d: BuildingEntity) =>
          d.id === selId              ? [0, 220, 255, 255] :
          perceivedIds?.has(d.id)     ? [0, 200, 180, 200] :
          perceivedIds                ? [100, 120, 160, 50] :
                                        [100, 120, 160, 180],
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as BuildingEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: [buildings.map(b => b.fieryness * 100 + b.brokenness), perceivedIds],
          getLineColor: [selId, perceivedIds],
        },
      }),

      new PolygonLayer({
        id: 'blockades',
        data: blockades,
        getPolygon: (d: BlockadeEntity) => d.apexes,
        getFillColor: (d: BlockadeEntity) =>
          perceivedIds && !perceivedIds.has(d.id) ? [200, 160, 40, 40] : [200, 160, 40, 200],
        getLineColor: (d: BlockadeEntity) =>
          d.id === selId              ? [0,   220, 255, 255] :
          perceivedIds?.has(d.id)     ? [0,   200, 180, 220] :
          clearingTargets.has(d.id)   ? [255, 80,  200, 255] :
          perceivedIds                ? [240, 200, 60,  60] :
                                        [240, 200, 60,  255],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 4,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as BlockadeEntity)?.id ?? null),
        updateTriggers: { getFillColor: [perceivedIds], getLineColor: [selId, clearingTargets, perceivedIds] },
      }),

      new ScatterplotLayer({
        id: 'agents',
        data: visibleAgents,
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: (d: HumanEntity) => {
          const [r, g, b, a] = agentColor(d.urn, actions.get(d.id), carrierMap.has(d.id), d.hp)
          if (perceivedIds && !perceivedIds.has(d.id) && d.id !== selId) return [r, g, b, 40]
          return [r, g, b, a]
        },
        getRadius: (d: HumanEntity) => d.id === selId ? 800 : 500,
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: (info: PickingInfo) => selectedId.set((info.object as HumanEntity)?.id ?? null),
        updateTriggers: { getRadius: [selId], getFillColor: [actions, perceivedIds] },
      }),

      // 搬送中の市民インジケータ（救急隊の上に重ねる小さな緑ドット）
      new ScatterplotLayer({
        id: 'passengers',
        data: visibleAgents.filter(a => carrierMap.has(a.id)),
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: [60, 200, 80, 220],
        getLineColor: [255, 255, 255, 180],
        getRadius: (d: HumanEntity) => d.id === selId ? 400 : 250,
        radiusMinPixels: 2,
        radiusMaxPixels: 7,
        stroked: true,
        lineWidthMinPixels: 1,
        pickable: false,
        updateTriggers: { getRadius: [selId] },
      }),

      // POSITION_HISTORY のエンティティ ID → X,Y でパスを構築
      new PathLayer({
        id: 'agent-trails',
        data: visibleAgents.filter(a => a.positionHistory.length >= 2),
        getPath: (d: HumanEntity) => {
          const pts: [number, number][] = []
          for (let i = 0; i + 1 < d.positionHistory.length; i += 2) {
            pts.push([d.positionHistory[i], d.positionHistory[i + 1]])
          }
          return pts
        },
        getColor: (d: HumanEntity) => {
          const [r, g, b] = agentColor(d.urn, actions.get(d.id), carrierMap.has(d.id), d.hp)
          return [r, g, b, d.id === selId ? 220 : 60] as [number, number, number, number]
        },
        getWidth: (d: HumanEntity) => d.id === selId ? 400 : 200,
        widthMinPixels: 1,
        widthMaxPixels: 4,
        updateTriggers: { getColor: [selId], getWidth: [selId] },
      }),

      // 通信: 選択エージェント → 送信元エージェントへの線
      ...((): (LineLayer<unknown> | ScatterplotLayer<unknown>)[] => {
        if (!comms || !selId) return []
        const sel = emap.get(selId) as HumanEntity | undefined
        if (!sel || !isAgent(sel.urn)) return []

        // 送信元エージェントのIDセット（重複除去）
        const senderIds = new Set(comms.map(c => c.senderId))

        // ライン data: {source, target} のみ有効な座標を持つエントリ
        type LineEntry = { source: [number, number]; target: [number, number] }
        const lineData: LineEntry[] = []
        for (const sid of senderIds) {
          const sender = emap.get(sid) as HumanEntity | undefined
          if (!sender || !isAgent(sender.urn)) continue
          if (sender.x === 0 && sender.y === 0) continue
          lineData.push({ source: [sel.x, sel.y], target: [sender.x, sender.y] })
        }

        // 送信元エージェントのスキャッタープロット（リングハイライト）
        const senderAgents = Array.from(senderIds)
          .map(id => emap.get(id))
          .filter((e): e is HumanEntity => !!e && isAgent(e.urn) && (e.x !== 0 || e.y !== 0))

        return [
          new LineLayer<LineEntry>({
            id: 'comm-lines',
            data: lineData,
            getSourcePosition: d => d.source,
            getTargetPosition: d => d.target,
            getColor: [255, 220, 50, 180],
            getWidth: 300,
            widthMinPixels: 1,
            widthMaxPixels: 3,
          }),
          new ScatterplotLayer<HumanEntity>({
            id: 'comm-senders',
            data: senderAgents,
            getPosition: d => [d.x, d.y],
            getFillColor: [0, 0, 0, 0],
            getLineColor: [255, 220, 50, 255],
            getRadius: 900,
            radiusMinPixels: 5,
            radiusMaxPixels: 16,
            stroked: true,
            filled: false,
            lineWidthMinPixels: 2,
            lineWidthMaxPixels: 4,
            pickable: false,
          }),
        ]
      })(),

      // AK_CLEAR_AREA: 矩形範囲
      new PolygonLayer({
        id: 'clear-area',
        data: clearAreaPolygons,
        getPolygon: (d: [number, number][]) => d,
        getFillColor: [255, 80, 200, 30],
        getLineColor: [255, 80, 200, 220],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 3,
        pickable: false,
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

    fitZoom = zoom
    const target: [number, number, number] = [cx, cy, 0]
    const viewState: OrthographicViewState = { target, zoom, minZoom: zoom - 5, maxZoom: zoom + 10 }
    deck.setProps({ initialViewState: viewState })
  }

  // ── Follow mode ───────────────────────────────────────────────────────────

  let currentZoom = 0
  let fitZoom = 0

  function followAgent(emap: Map<number, SimEntity>, selId: number | null) {
    if (!$followMode || selId === null || !deck) return
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
    deck.setProps({ layers: buildLayers(emap, selId, $agentActions, $kernelConfig, $agentVisibleIds, $agentReceivedComms) })
    if (prevSize === 0 && emap.size > 0) fitViewport(emap)
    prevSize = emap.size
    followAgent(emap, selId)
  })

  const unsubSel = selectedId.subscribe((selId) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, selId, $agentActions, $kernelConfig, $agentVisibleIds, $agentReceivedComms) })
    followAgent($entities, selId)
  })

  const unsubActions = agentActions.subscribe((actions) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, $selectedId, actions, $kernelConfig, $agentVisibleIds, $agentReceivedComms) })
  })

  const unsubPerception = agentVisibleIds.subscribe((perceivedIds) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, $selectedId, $agentActions, $kernelConfig, perceivedIds, $agentReceivedComms) })
  })

  const unsubComms = agentReceivedComms.subscribe((comms) => {
    if (!deck) return
    deck.setProps({ layers: buildLayers($entities, $selectedId, $agentActions, $kernelConfig, $agentVisibleIds, comms) })
  })

  const unsubFocus = focusPoint.subscribe((pt) => {
    if (!pt || !deck) return
    const closeZoom = Math.max(currentZoom, fitZoom + 5)
    deck.setProps({
      initialViewState: {
        target: [pt.x, pt.y, 0] as [number, number, number],
        zoom: closeZoom,
        minZoom: fitZoom - 5,
        maxZoom: fitZoom + 10,
      },
    })
    focusPoint.set(null)
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
    unsubFocus()
    unsubPerception()
    unsubComms()
    deck?.finalize()
  })
</script>

<canvas bind:this={canvas} class="sim-canvas"></canvas>


<style>
  .sim-canvas {
    width: 100%;
    height: 100%;
    display: block;
    background: #0d1117;
  }

</style>
