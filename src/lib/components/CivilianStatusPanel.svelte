<script lang="ts">
  import { t } from "$lib/i18n";
  import type { HumanEntity, SimEntity } from "$lib/rcrs/types";
  import { CommandURN, EntityURN, entityColor, isAgent } from "$lib/rcrs/urns";
  import {
    agentActions,
    currentStep,
    entities,
    focusPoint,
    inspectedId,
    maxStep,
    mode,
    perceivedEntities,
    perceptionViewMode,
    pinnedAgentId,
    selectedId,
  } from "$lib/stores/simulation";
  import { get } from "svelte/store";

  type CarryPair = { civilian: HumanEntity; carrier: HumanEntity };
  type MergedHuman = {
    id: number;
    p: HumanEntity | null;
    a: HumanEntity | null;
  };
  type MergedCarry = { id: number; p: CarryPair | null; a: CarryPair | null };

  function calcRescued(map: Map<number, SimEntity>) {
    const seen = new Map<number, HumanEntity>();
    for (const action of $agentActions.values()) {
      if (action.urn === CommandURN.AK_RESCUE && action.target !== undefined) {
        const e = map.get(action.target);
        if (e && !seen.has(e.id)) seen.set(e.id, e as HumanEntity);
      }
    }
    return [...seen.values()];
  }

  function calcCarried(map: Map<number, SimEntity>): CarryPair[] {
    const result: CarryPair[] = [];
    for (const e of map.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity;
        const carrier = map.get(h.position);
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM)
          result.push({ civilian: h, carrier: carrier as HumanEntity });
      }
    }
    return result;
  }

  function calcInjured(map: Map<number, SimEntity>) {
    const result: HumanEntity[] = [];
    for (const e of map.values()) {
      if (e.urn !== EntityURN.CIVILIAN) continue;
      const h = e as HumanEntity;
      if (h.buriedness > 0 || h.damage === 0) continue;
      const pos = map.get(h.position);
      if (pos?.urn === EntityURN.REFUGE || pos?.urn === EntityURN.AMBULANCE_TEAM)
        continue;
      result.push(h);
    }
    return result.sort((a, b) => a.hp - b.hp);
  }

  function calcBuried(map: Map<number, SimEntity>, rescuedIds: Set<number>) {
    const result: HumanEntity[] = [];
    for (const e of map.values()) {
      if (!isAgent(e.urn)) continue;
      const h = e as HumanEntity;
      if (h.buriedness === 0 || rescuedIds.has(h.id)) continue;
      result.push(h);
    }
    const urnOrder: Record<number, number> = {
      [EntityURN.FIRE_BRIGADE]: 0,
      [EntityURN.AMBULANCE_TEAM]: 1,
      [EntityURN.POLICE_FORCE]: 2,
      [EntityURN.CIVILIAN]: 3,
    };
    return result.sort((a, b) => {
      const ro = (urnOrder[a.urn] ?? 9) - (urnOrder[b.urn] ?? 9);
      return ro !== 0 ? ro : a.id - b.id;
    });
  }

  function mergeHumans(p: HumanEntity[], a: HumanEntity[]): MergedHuman[] {
    const map = new Map<number, MergedHuman>();
    for (const h of p) map.set(h.id, { id: h.id, p: h, a: null });
    for (const h of a) {
      const e = map.get(h.id);
      if (e) e.a = h;
      else map.set(h.id, { id: h.id, p: null, a: h });
    }
    return [...map.values()].sort((x, y) => {
      const pd = (x.p ? 0 : 1) - (y.p ? 0 : 1);
      return pd !== 0 ? pd : x.id - y.id;
    });
  }

  function mergeCarried(p: CarryPair[], a: CarryPair[]): MergedCarry[] {
    const map = new Map<number, MergedCarry>();
    for (const pair of p)
      map.set(pair.civilian.id, { id: pair.civilian.id, p: pair, a: null });
    for (const pair of a) {
      const e = map.get(pair.civilian.id);
      if (e) e.a = pair;
      else
        map.set(pair.civilian.id, { id: pair.civilian.id, p: null, a: pair });
    }
    return [...map.values()].sort((x, y) => {
      const pd = (x.p ? 0 : 1) - (y.p ? 0 : 1);
      return pd !== 0 ? pd : x.id - y.id;
    });
  }

  const rescuedActual = $derived(calcRescued($entities));
  const carriedActual = $derived(calcCarried($entities));
  const injuredActual = $derived(calcInjured($entities));
  const buriedActual = $derived(
    calcBuried($entities, new Set(rescuedActual.map((c) => c.id))),
  );

  const rescuedPerceived = $derived(
    $perceptionViewMode ? calcRescued($perceivedEntities) : [],
  );
  const carriedPerceived = $derived(
    $perceptionViewMode ? calcCarried($perceivedEntities) : [],
  );
  const injuredPerceived = $derived(
    $perceptionViewMode ? calcInjured($perceivedEntities) : [],
  );
  const buriedPerceived = $derived(
    $perceptionViewMode
      ? calcBuried(
          $perceivedEntities,
          new Set(rescuedPerceived.map((c) => c.id)),
        )
      : [],
  );

  const mergedCarried = $derived(
    $perceptionViewMode ? mergeCarried(carriedPerceived, carriedActual) : null,
  );
  const mergedRescued = $derived(
    $perceptionViewMode ? mergeHumans(rescuedPerceived, rescuedActual) : null,
  );
  const mergedInjured = $derived(
    $perceptionViewMode ? mergeHumans(injuredPerceived, injuredActual) : null,
  );
  const mergedBuried = $derived(
    $perceptionViewMode ? mergeHumans(buriedPerceived, buriedActual) : null,
  );

  const hasAny = $derived(
    buriedActual.length > 0 ||
      rescuedActual.length > 0 ||
      carriedActual.length > 0 ||
      injuredActual.length > 0 ||
      buriedPerceived.length > 0 ||
      rescuedPerceived.length > 0 ||
      carriedPerceived.length > 0 ||
      injuredPerceived.length > 0,
  );

  const hasPlaybackBar = $derived(
    ($mode === "file" && $maxStep > 0) || ($mode === "ws" && $currentStep > 0),
  );

  function focusOn(h: HumanEntity) {
    if (get(pinnedAgentId) !== null) {
      inspectedId.set(h.id);
    } else {
      selectedId.set(h.id);
    }
    focusPoint.set({ x: h.x, y: h.y });
  }

  let collapsed = $state(false);
</script>

{#if hasAny}
  <div class="panel" class:dual={!!mergedCarried} class:collapsed class:with-playback-bar={hasPlaybackBar}>
    <div
      class="panel-header"
      role="button"
      tabindex="0"
      onclick={() => (collapsed = !collapsed)}
      onkeydown={(e) => e.key === "Enter" && (collapsed = !collapsed)}
    >
      <span class="panel-label">{$t("civilian.title")}</span>
      {#if mergedCarried && !collapsed}
        <span class="ch-col perceived">👁 {$t("civilian.perceived")}</span>
        <span class="ch-col actual">{$t("civilian.actual")}</span>
      {/if}
      <span class="collapse-arrow">{collapsed ? "▸" : "▾"}</span>
    </div>

    {#if !collapsed}
      {#if mergedCarried}
        <!-- Carrying -->
        {#if mergedCarried.length > 0}
          <div class="section-label">{$t("section.carrying")} ({mergedCarried.length})</div>
          {#each mergedCarried as row (row.id)}
            {@const rep = row.p?.civilian ?? row.a!.civilian}
            <button
              class="dual-row"
              onclick={() => focusOn(row.p?.carrier ?? row.a!.carrier)}
              class:selected={$selectedId === row.id}
            >
              <span class="cid" style="color:{entityColor(rep.urn)}"
                >#{row.id}</span
              >
              <span class="dual-cell">
                {#if row.p}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.p.civilian.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.p.civilian.hp.toLocaleString()}</span>
                  {#if row.p.civilian.damage > 0}<span class="badge dmg"
                      >D:{row.p.civilian.damage}</span
                    >{/if}
                {/if}
              </span>
              <span class="dual-cell">
                {#if row.a}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.a.civilian.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.a.civilian.hp.toLocaleString()}</span>
                  {#if row.a.civilian.damage > 0}<span class="badge dmg"
                      >D:{row.a.civilian.damage}</span
                    >{/if}
                {/if}
              </span>
            </button>
          {/each}
        {/if}

        <!-- Rescuing -->
        {#if mergedRescued && mergedRescued.length > 0}
          <div class="section-label">{$t("section.rescuing")} ({mergedRescued.length})</div>
          {#each mergedRescued as row (row.id)}
            {@const rep = row.p ?? row.a!}
            <button
              class="dual-row"
              onclick={() => focusOn(rep)}
              class:selected={$selectedId === row.id}
            >
              <span class="cid" style="color:{entityColor(rep.urn)}"
                >#{row.id}</span
              >
              <span class="dual-cell">
                {#if row.p}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.p.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.p.hp.toLocaleString()}</span>
                  {#if row.p.buriedness > 0}<span class="badge bury"
                      >B:{row.p.buriedness}</span
                    >{/if}
                {/if}
              </span>
              <span class="dual-cell">
                {#if row.a}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.a.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.a.hp.toLocaleString()}</span>
                  {#if row.a.buriedness > 0}<span class="badge bury"
                      >B:{row.a.buriedness}</span
                    >{/if}
                {/if}
              </span>
            </button>
          {/each}
        {/if}

        <!-- Injured Civilians (dual) -->
        {#if mergedInjured && mergedInjured.length > 0}
          <div class="section-label">{$t("section.injured")} ({mergedInjured.length})</div>
          {#each mergedInjured as row (row.id)}
            {@const rep = row.p ?? row.a!}
            <button
              class="dual-row"
              onclick={() => focusOn(rep)}
              class:selected={$selectedId === row.id}
            >
              <span class="cid" style="color:{entityColor(rep.urn)}"
                >#{row.id}</span
              >
              <span class="dual-cell">
                {#if row.p}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.p.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.p.hp.toLocaleString()}</span>
                  {#if row.p.damage > 0}<span class="badge dmg"
                      >D:{row.p.damage}</span
                    >{/if}
                {/if}
              </span>
              <span class="dual-cell">
                {#if row.a}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.a.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.a.hp.toLocaleString()}</span>
                  {#if row.a.damage > 0}<span class="badge dmg"
                      >D:{row.a.damage}</span
                    >{/if}
                {/if}
              </span>
            </button>
          {/each}
        {/if}

        <!-- Buried -->
        {#if mergedBuried && mergedBuried.length > 0}
          <div class="section-label">{$t("section.buried")} ({mergedBuried.length})</div>
          {#each mergedBuried as row (row.id)}
            {@const rep = row.p ?? row.a!}
            <button
              class="dual-row"
              onclick={() => focusOn(rep)}
              class:selected={$selectedId === row.id}
            >
              <span class="cid" style="color:{entityColor(rep.urn)}"
                >#{row.id}</span
              >
              <span class="dual-cell">
                {#if row.p}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.p.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.p.hp.toLocaleString()}</span>
                  <span class="badge bury">B:{row.p.buriedness}</span>
                {/if}
              </span>
              <span class="dual-cell">
                {#if row.a}
                  <span class="bar-wrap"
                    ><span
                      class="bar hp"
                      style="width:{Math.min(100, row.a.hp / 100)}%"
                    ></span></span
                  >
                  <span class="num">{row.a.hp.toLocaleString()}</span>
                  <span class="badge bury">B:{row.a.buriedness}</span>
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      {:else}
        <!-- ── single column (normal mode) ── -->
        {#if carriedActual.length > 0}
          <div class="section-label">{$t("section.carrying")} ({carriedActual.length})</div>
          {#each carriedActual as { civilian: c, carrier } (c.id)}
            <button
              class="row"
              onclick={() => focusOn(carrier)}
              class:selected={$selectedId === c.id}
            >
              <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span
              >
              <span class="stat">
                <span class="bar-wrap"
                  ><span
                    class="bar hp"
                    style="width:{Math.min(100, c.hp / 100)}%"
                  ></span></span
                >
                <span class="num">{c.hp.toLocaleString()}</span>
              </span>
              <span class="badge dmg"
                >{c.damage > 0 ? `D:${c.damage}` : ""}</span
              >
            </button>
          {/each}
        {/if}

        {#if rescuedActual.length > 0}
          <div class="section-label">{$t("section.rescuing")} ({rescuedActual.length})</div>
          {#each rescuedActual as c (c.id)}
            <button
              class="row"
              onclick={() => focusOn(c)}
              class:selected={$selectedId === c.id}
            >
              <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span
              >
              <span class="stat">
                <span class="bar-wrap"
                  ><span
                    class="bar hp"
                    style="width:{Math.min(100, c.hp / 100)}%"
                  ></span></span
                >
                <span class="num">{c.hp.toLocaleString()}</span>
              </span>
              <span class="badge bury"
                >{c.buriedness > 0 ? `B:${c.buriedness}` : ""}</span
              >
              <span class="badge dmg"
                >{c.damage > 0 ? `D:${c.damage}` : ""}</span
              >
            </button>
          {/each}
        {/if}

        {#if injuredActual.length > 0}
          <div class="section-label">{$t("section.injured")} ({injuredActual.length})</div>
          {#each injuredActual as c (c.id)}
            <button
              class="row"
              onclick={() => focusOn(c)}
              class:selected={$selectedId === c.id}
            >
              <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span
              >
              <span class="stat">
                <span class="bar-wrap"
                  ><span
                    class="bar hp"
                    style="width:{Math.min(100, c.hp / 100)}%"
                  ></span></span
                >
                <span class="num">{c.hp.toLocaleString()}</span>
              </span>
              <span class="badge dmg">D:{c.damage}</span>
            </button>
          {/each}
        {/if}

        {#if buriedActual.length > 0}
          <div class="section-label">{$t("section.buried")} ({buriedActual.length})</div>
          {#each buriedActual as c (c.id)}
            <button
              class="row"
              onclick={() => focusOn(c)}
              class:selected={$selectedId === c.id}
            >
              <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span
              >
              <span class="stat">
                <span class="bar-wrap"
                  ><span
                    class="bar hp"
                    style="width:{Math.min(100, c.hp / 100)}%"
                  ></span></span
                >
                <span class="num">{c.hp.toLocaleString()}</span>
              </span>
              <span class="badge bury">B:{c.buriedness}</span>
              <span class="badge dmg"
                >{c.damage > 0 ? `D:${c.damage}` : ""}</span
              >
            </button>
          {/each}
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .panel {
    --panel-bottom: 16px;
    position: absolute;
    bottom: var(--panel-bottom);
    right: 16px;
    width: 240px;
    max-height: min(
      340px,
      calc(100vh - var(--panel-bottom) - var(--info-panel-bottom, 0px) - 8px)
    );
    overflow-y: auto;
    background: var(--panel-bg);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 12px;
    line-height: 1.2;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: 5px;
  }

  .panel.with-playback-bar {
    --panel-bottom: 82px;
  }

  .panel.dual {
    width: 380px;
  }

  .panel.collapsed {
    padding-bottom: 0;
  }

  .panel.collapsed.with-playback-bar {
    --panel-bottom: 78px;
  }

  @media (max-width: 760px) {
    .panel.with-playback-bar {
      --panel-bottom: 132px;
    }

    .panel.collapsed.with-playback-bar {
      --panel-bottom: 112px;
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 6px 10px 5px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
  }
  .panel-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .panel-label {
    font-size: 10px;
    line-height: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    flex: 1;
  }

  .collapse-arrow {
    font-size: 13px;
    color: #607080;
    line-height: 1;
  }
  .panel-header:hover .collapse-arrow {
    color: #c8d8e8;
  }

  .ch-col {
    font-size: 9px;
    line-height: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    width: 110px;
    text-align: center;
    flex-shrink: 0;
  }
  .ch-col.perceived {
    color: #ffc840;
  }
  .ch-col.actual {
    color: #607080;
  }

  .section-label {
    font-size: 10px;
    line-height: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    padding: 2px 10px 0;
  }
  :is(.row, .dual-row) + .section-label {
    margin-top: 2px;
    border-top: 1px solid rgba(0, 200, 255, 0.1);
  }

  .row,
  .dual-row {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 19px;
    padding: 1px 10px;
    border-radius: 3px;
    cursor: pointer;
    background: none;
    border: none;
    color: inherit;
    width: 100%;
    text-align: left;
  }
  .row:hover,
  .dual-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .row.selected,
  .dual-row.selected {
    background: rgba(0, 200, 255, 0.1);
  }

  .dual-row {
    display: grid;
    grid-template-columns: 72px 1fr 1fr;
    gap: 3px;
    align-items: center;
  }

  .cid {
    color: #607080;
    font-size: 11px;
    line-height: 13px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dual-cell {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
  }

  .bar-wrap {
    display: inline-block;
    width: 40px;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .bar {
    display: block;
    height: 100%;
    border-radius: 2px;
  }
  .bar.hp {
    background: #40c870;
  }

  .num {
    font-size: 10px;
    line-height: 12px;
    color: #a8c8d8;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .badge {
    font-size: 10px;
    line-height: 12px;
    padding: 0 3px;
    border-radius: 3px;
    flex-shrink: 0;
    min-width: 24px;
    text-align: center;
  }
  .badge:empty {
    display: none;
  }
  .badge.bury {
    background: rgba(200, 100, 40, 0.25);
    color: #c08060;
  }
  .badge.dmg {
    background: rgba(200, 60, 60, 0.2);
    color: #c06060;
  }
</style>
