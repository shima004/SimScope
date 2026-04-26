<script lang="ts">
  import { channelColorRGB } from "$lib/rcrs/channelColors";
  import type {
    BlockadeEntity,
    BuildingEntity,
    HumanEntity,
    RoadEntity,
    SimEntity,
  } from "$lib/rcrs/types";
  import { CommandURN, EntityURN, isAgent, isBuilding } from "$lib/rcrs/urns";
  import type { AgentAction, CommMessage } from "$lib/stores/simulation";
  import {
    agentActions,
    agentDisplayMode,
    agentReceivedComms,
    agentVisibleIds,
    animatedEntities,
    entities,
    focusPoint,
    followMode,
    hiddenChannels,
    inspectedId,
    kernelConfig,
    perceivedEntities,
    perceptionViewMode,
    pinnedAgentId,
    selectedId,
  } from "$lib/stores/simulation";
  import type { OrthographicViewState, PickingInfo } from "@deck.gl/core";
  import { Deck, OrthographicView } from "@deck.gl/core";
  import {
    IconLayer,
    LineLayer,
    PathLayer,
    PolygonLayer,
    ScatterplotLayer,
  } from "@deck.gl/layers";
  import { onDestroy, onMount } from "svelte";
  import { derived, get } from "svelte/store";

  function selectEntity(id: number | null) {
    if (get(pinnedAgentId) !== null) inspectedId.set(id);
    else selectedId.set(id);
  }

  let canvas: HTMLCanvasElement;
  let deck: Deck<OrthographicView> | null = null;

  // ── Color helpers ─────────────────────────────────────────────────────────

  // Base color per facility type (used when not on fire)
  const FACILITY_COLOR: Partial<Record<number, [number, number, number]>> = {
    [EntityURN.REFUGE]: [20, 140, 60], // 避難所: 濃い緑
    [EntityURN.FIRE_STATION]: [220, 60, 60], // 消防署: 赤
    [EntityURN.AMBULANCE_CENTRE]: [60, 160, 220], // 救急センター: 水色
    [EntityURN.POLICE_OFFICE]: [80, 80, 220], // 警察署: 青
    [EntityURN.GAS_STATION]: [220, 180, 40], // ガスステーション: 黄
    [EntityURN.HYDRANT]: [30, 100, 140], // 消火栓: 暗い水色
  };

  function buildingColor(e: BuildingEntity): [number, number, number, number] {
    const f = e.fieryness;
    // Burning / burned state overrides facility color
    if (f >= 1 && f <= 3) return [255, Math.max(0, 180 - f * 50), 0, 230];
    if (f === 8) return [60, 40, 40, 200];
    if (f >= 4 && f <= 7) return [160, 80, 40, 200];

    const base = FACILITY_COLOR[e.urn];
    if (base) return [...base, 240] as [number, number, number, number];

    // Regular building: brokenness が 1 以上で茶色
    return e.brokenness > 0 ? [180, 120, 60, 220] : [80, 100, 140, 220];
  }

  const AGENT_EMOJI: Record<number, string> = {
    [EntityURN.FIRE_BRIGADE]: "🚒",
    [EntityURN.AMBULANCE_TEAM]: "🚑",
    [EntityURN.POLICE_FORCE]: "🚜",
    [EntityURN.CIVILIAN]: "🧍",
  };
  const EMOJI_FONT =
    '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  type IconMapping = Record<
    string,
    { x: number; y: number; width: number; height: number; mask: boolean }
  >;
  interface EmojiAtlas {
    atlas: string;
    mapping: IconMapping;
  }
  let _emojiAtlas: EmojiAtlas | null = null;

  function getEmojiAtlas(): EmojiAtlas {
    if (_emojiAtlas) return _emojiAtlas;
    const SIZE = 64;
    const emojis = [...new Set(Object.values(AGENT_EMOJI))];
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * emojis.length;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${SIZE * 0.82}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mapping: IconMapping = {};
    emojis.forEach((emoji, i) => {
      ctx.fillText(emoji, SIZE * i + SIZE / 2, SIZE / 2);
      mapping[emoji] = {
        x: SIZE * i,
        y: 0,
        width: SIZE,
        height: SIZE,
        mask: false,
      };
    });
    _emojiAtlas = { atlas: canvas.toDataURL(), mapping };
    return _emojiAtlas;
  }

  function agentColor(
    urn: number,
    action?: AgentAction,
    carrying = false,
    hp = 10000,
  ): [number, number, number, number] {
    if (
      urn === EntityURN.FIRE_BRIGADE &&
      action?.urn === CommandURN.AK_RESCUE
    ) {
      return [255, 140, 0, 255]; // rescue中: オレンジ
    }
    if (urn === EntityURN.AMBULANCE_TEAM && carrying) {
      return [255, 200, 60, 255]; // 市民搬送中: 黄色
    }
    if (urn === EntityURN.CIVILIAN) {
      const t = Math.max(0, Math.min(1, hp / 10000));
      return [Math.round(60 * t), Math.round(200 * t), Math.round(80 * t), 255];
    }
    switch (urn) {
      case EntityURN.FIRE_BRIGADE:
        return [220, 30, 30, 255]; // 赤
      case EntityURN.AMBULANCE_TEAM:
        return [240, 240, 240, 255]; // 白
      case EntityURN.POLICE_FORCE:
        return [60, 140, 255, 255];
      default:
        return [200, 200, 200, 255];
    }
  }

  // ── Layer builders ────────────────────────────────────────────────────────
  // 静的レイヤー（道路・建物・瓦礫・通信・軌跡）: ステップ切替時のみ再構築
  // 動的レイヤー（エージェントドット）: 毎フレーム再構築（補間位置）

  function buildStaticLayers(
    emap: Map<number, SimEntity>,
    selId: number | null,
    actions: Map<number, AgentAction>,
    cfg: Record<string, string>,
    perceivedIds: Set<number> | null,
    comms: CommMessage[] | null,
    hiddenChs: Set<number>,
  ) {
    const filteredComms =
      hiddenChs.size > 0 && comms
        ? comms.filter((c) => !hiddenChs.has(c.channel))
        : comms;

    const roads: RoadEntity[] = [];
    const buildings: BuildingEntity[] = [];
    const blockades: BlockadeEntity[] = [];
    const agents: HumanEntity[] = [];

    for (const e of emap.values()) {
      if (e.urn === EntityURN.ROAD || e.urn === EntityURN.HYDRANT)
        roads.push(e as RoadEntity);
      else if (isBuilding(e.urn)) buildings.push(e as BuildingEntity);
      else if (e.urn === EntityURN.BLOCKADE)
        blockades.push(e as BlockadeEntity);
      else if (isAgent(e.urn)) agents.push(e as HumanEntity);
    }

    // 搬送中マップ（軌跡・色計算用）
    const carrierMap = new Map<number, HumanEntity>();
    const carriedIds = new Set<number>();
    for (const e of emap.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity;
        const carrier = emap.get(h.position);
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          carrierMap.set(carrier.id, h);
          carriedIds.add(h.id);
        }
      }
    }
    const visibleAgents = agents.filter((a) => !carriedIds.has(a.id));

    // AK_CLEAR / AK_CLEAR_AREA
    const clearingTargets = new Set<number>();
    const clearDist = parseInt(cfg["clear.repair.distance"] ?? "10000", 10);
    const clearRad = parseInt(cfg["clear.repair.rad"] ?? "2000", 10);
    const clearAreaPolygons: [number, number][][] = [];

    for (const [agentId, action] of actions) {
      if (perceivedIds ? !perceivedIds.has(agentId) : !emap.has(agentId))
        continue;
      if (action.urn === CommandURN.AK_CLEAR && action.target !== undefined) {
        clearingTargets.add(action.target);
      } else if (
        action.urn === CommandURN.AK_CLEAR_AREA &&
        action.destX !== undefined &&
        action.destY !== undefined
      ) {
        const agent = emap.get(agentId) as HumanEntity | undefined;
        if (!agent) continue;
        const dx = action.destX - agent.x;
        const dy = action.destY - agent.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;
        const nx = dx / len,
          ny = dy / len;
        const px = -ny,
          py = nx;
        const ex = agent.x + nx * clearDist;
        const ey = agent.y + ny * clearDist;
        clearAreaPolygons.push([
          [agent.x + px * clearRad, agent.y + py * clearRad],
          [agent.x - px * clearRad, agent.y - py * clearRad],
          [ex - px * clearRad, ey - py * clearRad],
          [ex + px * clearRad, ey + py * clearRad],
        ]);
      }
    }

    // AK_MOVE パス
    const moveLayers = ((): (
      | PathLayer<unknown>
      | ScatterplotLayer<unknown>
    )[] => {
      if (!selId) return [];
      const sel = emap.get(selId) as HumanEntity | undefined;
      if (!sel || !isAgent(sel.urn)) return [];
      const action = actions.get(selId);
      if (action?.urn !== CommandURN.AK_MOVE || !action.path?.length) return [];
      const pts: [number, number][] = [];
      for (const id of action.path) {
        const e = emap.get(id);
        if (e && "x" in e && "y" in e)
          pts.push([
            (e as { x: number; y: number }).x,
            (e as { x: number; y: number }).y,
          ]);
      }
      if (pts.length < 2) return [];
      const dest = pts[pts.length - 1];
      return [
        new PathLayer<[number, number][]>({
          id: "move-path",
          data: [pts],
          getPath: (d) => d,
          getColor: [80, 220, 255, 200],
          getWidth: 300,
          widthMinPixels: 2,
          widthMaxPixels: 5,
          pickable: false,
        }) as unknown as PathLayer<unknown>,
        new ScatterplotLayer<{ pos: [number, number] }>({
          id: "move-dest",
          data: [{ pos: dest }],
          getPosition: (d) => d.pos,
          getFillColor: [80, 220, 255, 240],
          getLineColor: [255, 255, 255, 200],
          getRadius: 800,
          radiusMinPixels: 5,
          radiusMaxPixels: 14,
          stroked: true,
          lineWidthMinPixels: 2,
          pickable: false,
        }) as unknown as ScatterplotLayer<unknown>,
      ];
    })();

    // 通信レイヤー
    const commLayers = ((): (
      | LineLayer<unknown>
      | ScatterplotLayer<unknown>
    )[] => {
      if (!filteredComms?.length || !selId) return [];
      const sel = emap.get(selId) as HumanEntity | undefined;
      if (!sel || !isAgent(sel.urn)) return [];
      const senderChMap = new Map<number, number>();
      for (const c of filteredComms) {
        const cur = senderChMap.get(c.senderId);
        if (cur === undefined || c.channel < cur)
          senderChMap.set(c.senderId, c.channel);
      }
      type LineEntry = {
        source: [number, number];
        target: [number, number];
        ch: number;
      };
      type SenderEntry = { x: number; y: number; ch: number };
      const lineData: LineEntry[] = [];
      const senderData: SenderEntry[] = [];
      for (const [sid, ch] of senderChMap) {
        const sender = emap.get(sid) as HumanEntity | undefined;
        if (!sender || !isAgent(sender.urn)) continue;
        if (sender.x === 0 && sender.y === 0) continue;
        lineData.push({
          source: [sel.x, sel.y],
          target: [sender.x, sender.y],
          ch,
        });
        senderData.push({ x: sender.x, y: sender.y, ch });
      }
      return [
        new LineLayer<LineEntry>({
          id: "comm-lines",
          data: lineData,
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getColor: (d) =>
            [...channelColorRGB(d.ch), 180] as [number, number, number, number],
          getWidth: 300,
          widthMinPixels: 1,
          widthMaxPixels: 3,
          updateTriggers: { getColor: [filteredComms] },
        }) as unknown as LineLayer<unknown>,
        new ScatterplotLayer<SenderEntry>({
          id: "comm-senders",
          data: senderData,
          getPosition: (d) => [d.x, d.y],
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d) =>
            [...channelColorRGB(d.ch), 255] as [number, number, number, number],
          getRadius: 900,
          radiusMinPixels: 5,
          radiusMaxPixels: 16,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          lineWidthMaxPixels: 4,
          pickable: false,
          updateTriggers: { getLineColor: [filteredComms] },
        }) as unknown as ScatterplotLayer<unknown>,
      ];
    })();

    return [
      new PolygonLayer({
        id: "roads",
        data: roads,
        getPolygon: (d: RoadEntity) => d.apexes,
        getFillColor: (d: RoadEntity) =>
          d.urn === EntityURN.HYDRANT ? [30, 100, 140, 220] : [45, 55, 70, 200],
        getLineColor: [70, 85, 105, 255],
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as RoadEntity)?.id ?? null),
      }),

      new PolygonLayer({
        id: "buildings",
        data: buildings,
        getPolygon: (d: BuildingEntity) => d.apexes,
        getFillColor: (d: BuildingEntity) => {
          const [r, g, b, a] = buildingColor(d);
          if (perceivedIds && !perceivedIds.has(d.id))
            return [r, g, b, Math.round(a * 0.2)];
          return [r, g, b, a];
        },
        getLineColor: (d: BuildingEntity) =>
          d.id === selId
            ? [0, 220, 255, 255]
            : perceivedIds?.has(d.id)
              ? [0, 200, 180, 200]
              : perceivedIds
                ? [100, 120, 160, 50]
                : [100, 120, 160, 180],
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as BuildingEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: [
            buildings.map((b) => b.fieryness * 100 + b.brokenness),
            perceivedIds,
          ],
          getLineColor: [selId, perceivedIds],
        },
      }),

      new PolygonLayer({
        id: "blockades",
        data: blockades,
        getPolygon: (d: BlockadeEntity) => d.apexes,
        getFillColor: (d: BlockadeEntity) =>
          perceivedIds && !perceivedIds.has(d.id)
            ? [200, 160, 40, 40]
            : [200, 160, 40, 200],
        getLineColor: (d: BlockadeEntity) =>
          d.id === selId
            ? [0, 220, 255, 255]
            : perceivedIds?.has(d.id)
              ? [0, 200, 180, 220]
              : clearingTargets.has(d.id)
                ? [255, 80, 200, 255]
                : perceivedIds
                  ? [240, 200, 60, 60]
                  : [240, 200, 60, 255],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 4,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as BlockadeEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: [perceivedIds],
          getLineColor: [selId, clearingTargets, perceivedIds],
        },
      }),

      new PathLayer({
        id: "agent-trails",
        data: visibleAgents.filter((a) => a.positionHistory.length >= 2),
        getPath: (d: HumanEntity) => {
          const pts: [number, number][] = [];
          for (let i = 0; i + 1 < d.positionHistory.length; i += 2)
            pts.push([d.positionHistory[i], d.positionHistory[i + 1]]);
          return pts;
        },
        getColor: (d: HumanEntity) => {
          const [r, g, b] = agentColor(
            d.urn,
            actions.get(d.id),
            carrierMap.has(d.id),
            d.hp,
          );
          return [r, g, b, d.id === selId ? 220 : 60] as [
            number,
            number,
            number,
            number,
          ];
        },
        getWidth: (d: HumanEntity) => (d.id === selId ? 400 : 200),
        widthMinPixels: 1,
        widthMaxPixels: 4,
        updateTriggers: { getColor: [selId], getWidth: [selId] },
      }),

      ...commLayers,

      new PolygonLayer({
        id: "clear-area",
        data: clearAreaPolygons,
        getPolygon: (d: [number, number][]) => d,
        getFillColor: [255, 80, 200, 30],
        getLineColor: [255, 80, 200, 220],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 3,
        pickable: false,
      }),

      ...moveLayers,
    ];
  }

  // 動的レイヤー: animatedEntities の補間位置でエージェントドットのみ再構築
  function buildAgentLayers(
    emap: Map<number, SimEntity>,
    selId: number | null,
    perceivedIds: Set<number> | null,
    displayMode: "circle" | "emoji" = "emoji",
  ) {
    const agents: HumanEntity[] = [];
    const carrierMap = new Map<number, HumanEntity>();
    const carriedIds = new Set<number>();

    for (const e of emap.values()) {
      if (!isAgent(e.urn)) continue;
      const h = e as HumanEntity;
      if (h.urn === EntityURN.CIVILIAN) {
        const carrier = emap.get(h.position);
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          carrierMap.set(carrier.id, h);
          carriedIds.add(h.id);
        }
      }
      agents.push(h);
    }
    const visibleAgents = agents.filter((a) => !carriedIds.has(a.id));
    const civilians = visibleAgents.filter((a) => a.urn === EntityURN.CIVILIAN);
    const rescueAgents = visibleAgents.filter(
      (a) => a.urn !== EntityURN.CIVILIAN,
    );

    if (displayMode === "emoji") {
      const { atlas, mapping } = getEmojiAtlas();
      const emojiLayer = (id: string, data: HumanEntity[]) =>
        new IconLayer({
          id,
          data,
          getPosition: (d: HumanEntity) => [d.x, d.y],
          getIcon: (d: HumanEntity) => AGENT_EMOJI[d.urn] ?? "🧑",
          getSize: (d: HumanEntity) => (d.id === selId ? 28 : 20),
          getColor: (d: HumanEntity) => {
            const dim =
              perceivedIds && !perceivedIds.has(d.id) && d.id !== selId;
            return [255, 255, 255, dim ? 60 : 255];
          },
          sizeMinPixels: 10,
          sizeMaxPixels: 32,
          iconAtlas: atlas,
          iconMapping: mapping,
          pickable: true,
          onClick: (info: PickingInfo) =>
            selectEntity((info.object as HumanEntity)?.id ?? null),
          updateTriggers: { getSize: [selId], getColor: [perceivedIds] },
        });
      return [
        emojiLayer("civilians-emoji", civilians),
        emojiLayer("rescue-agents-emoji", rescueAgents),
        new IconLayer({
          id: "passengers-emoji",
          data: visibleAgents.filter((a) => carrierMap.has(a.id)),
          getPosition: (d: HumanEntity) => [d.x, d.y],
          getIcon: () => "🧑",
          getSize: (d: HumanEntity) => (d.id === selId ? 18 : 13),
          getColor: [255, 255, 255, 220],
          sizeMinPixels: 6,
          sizeMaxPixels: 20,
          iconAtlas: atlas,
          iconMapping: mapping,
          pickable: false,
          updateTriggers: { getSize: [selId] },
        }),
      ];
    }

    // circle モード（従来）
    const circleLayer = (id: string, data: HumanEntity[]) =>
      new ScatterplotLayer({
        id,
        data,
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: (d: HumanEntity) => {
          const [r, g, b, a] = agentColor(
            d.urn,
            undefined,
            carrierMap.has(d.id),
            d.hp,
          );
          if (perceivedIds && !perceivedIds.has(d.id) && d.id !== selId)
            return [r, g, b, 40];
          return [r, g, b, a];
        },
        getRadius: (d: HumanEntity) => (d.id === selId ? 800 : 500),
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as HumanEntity)?.id ?? null),
        updateTriggers: { getRadius: [selId], getFillColor: [perceivedIds] },
      });
    return [
      circleLayer("civilians-circle", civilians),
      circleLayer("rescue-agents-circle", rescueAgents),
      new ScatterplotLayer({
        id: "passengers-circle",
        data: visibleAgents.filter((a) => carrierMap.has(a.id)),
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: [60, 200, 80, 220],
        getLineColor: [255, 255, 255, 180],
        getRadius: (d: HumanEntity) => (d.id === selId ? 400 : 250),
        radiusMinPixels: 2,
        radiusMaxPixels: 7,
        stroked: true,
        lineWidthMinPixels: 1,
        pickable: false,
        updateTriggers: { getRadius: [selId] },
      }),
    ];
  }

  // ── Viewport fit ──────────────────────────────────────────────────────────

  function fitViewport(emap: Map<number, SimEntity>) {
    if (emap.size === 0 || !deck) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of emap.values()) {
      if ("apexes" in e) {
        for (const [x, y] of (e as { apexes: [number, number][] }).apexes) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!isFinite(minX)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY);
    const viewSize = Math.min(canvas.clientWidth, canvas.clientHeight);
    const zoom = Math.log2(viewSize / span) - 0.2;

    fitZoom = zoom;
    const target: [number, number, number] = [cx, cy, 0];
    const viewState: OrthographicViewState = {
      target,
      zoom,
      minZoom: zoom - 5,
      maxZoom: zoom + 10,
    };
    deck.setProps({ initialViewState: viewState });
  }

  // ── Follow mode ───────────────────────────────────────────────────────────

  let currentZoom = 0;
  let fitZoom = 0;

  function followAgent(emap: Map<number, SimEntity>, selId: number | null) {
    if (!$followMode || selId === null || !deck) return;
    const e = emap.get(selId);
    if (!e || !isAgent(e.urn)) return;
    const h = e as HumanEntity;
    deck.setProps({
      initialViewState: {
        target: [h.x, h.y, 0] as [number, number, number],
        zoom: currentZoom,
        minZoom: currentZoom - 5,
        maxZoom: currentZoom + 10,
      },
    });
  }

  // ── Store subscriptions ───────────────────────────────────────────────────

  let prevSize = 0;

  // キャッシュ: 静的レイヤーは毎フレーム再構築しない
  let cachedStaticLayers: ReturnType<typeof buildStaticLayers> = [];
  let cachedAgentLayers: ReturnType<typeof buildAgentLayers> = [];

  function flushLayers() {
    if (!deck) return;
    deck.setProps({ layers: [...cachedStaticLayers, ...cachedAgentLayers] });
  }

  // 静的レイヤー: ステップ切替・選択変更・設定変更時のみ再構築
  const staticArgs = derived(
    [
      entities,
      perceivedEntities,
      perceptionViewMode,
      selectedId,
      agentActions,
      kernelConfig,
      agentVisibleIds,
      agentReceivedComms,
      hiddenChannels,
    ],
    ([$e, $pe, $pvm, $sel, $aa, $kc, $avi, $arc, $hc]) => ({
      emap: $pvm ? $pe : $e,
      selId: $sel,
      actions: $aa,
      cfg: $kc,
      perceivedIds: $avi,
      comms: $arc,
      hiddenChs: $hc,
    }),
  );

  const unsubStatic = staticArgs.subscribe(
    ({ emap, selId, actions, cfg, perceivedIds, comms, hiddenChs }) => {
      cachedStaticLayers = buildStaticLayers(
        emap,
        selId,
        actions,
        cfg,
        perceivedIds,
        comms,
        hiddenChs,
      );
      flushLayers();
      followAgent(emap, selId);
    },
  );

  // 動的レイヤー: animatedEntities が更新されるたびに再構築（補間フレーム含む）
  const agentArgs = derived(
    [
      animatedEntities,
      selectedId,
      agentActions,
      agentVisibleIds,
      perceptionViewMode,
      perceivedEntities,
      agentDisplayMode,
    ],
    ([$ae, $sel, $aa, $avi, $pvm, $pe, $adm]) => ({
      emap: $pvm ? $pe : $ae,
      selId: $sel,
      actions: $aa,
      perceivedIds: $avi,
      displayMode: $adm,
    }),
  );

  const unsubAgents = agentArgs.subscribe(
    ({ emap, selId, perceivedIds, displayMode }) => {
      cachedAgentLayers = buildAgentLayers(
        emap,
        selId,
        perceivedIds,
        displayMode,
      );
      flushLayers();
    },
  );

  // 実世界エンティティが初めてロードされたときにビューポートをフィット
  const unsubFit = entities.subscribe((emap) => {
    if (!deck || $perceptionViewMode) return;
    if (prevSize === 0 && emap.size > 0) fitViewport(emap);
    prevSize = emap.size;
  });

  const unsubFocus = focusPoint.subscribe((pt) => {
    if (!pt || !deck) return;
    const closeZoom = Math.max(currentZoom, fitZoom + 5);
    deck.setProps({
      initialViewState: {
        target: [pt.x, pt.y, 0] as [number, number, number],
        zoom: closeZoom,
        minZoom: fitZoom - 5,
        maxZoom: fitZoom + 10,
      },
    });
    focusPoint.set(null);
  });

  // ── Deck.gl lifecycle ─────────────────────────────────────────────────────

  onMount(() => {
    const initialViewState: OrthographicViewState = {
      target: [0, 0, 0],
      zoom: 0,
    };
    deck = new Deck<OrthographicView>({
      canvas,
      views: new OrthographicView({ id: "ortho", flipY: false }),
      initialViewState,
      controller: true,
      layers: [],
      getCursor: ({ isDragging }) => (isDragging ? "grabbing" : "crosshair"),
      onClick: (info) => {
        if (!info.picked) {
          if (get(pinnedAgentId) === null) selectedId.set(null);
          inspectedId.set(null);
        }
      },
      onViewStateChange: ({ viewState }) => {
        const z = (viewState as OrthographicViewState).zoom;
        if (typeof z === "number") currentZoom = z;
      },
    });
  });

  onDestroy(() => {
    unsubStatic();
    unsubAgents();
    unsubFit();
    unsubFocus();
    deck?.finalize();
  });
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
