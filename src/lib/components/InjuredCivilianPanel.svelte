<script lang="ts">
  import type { HumanEntity, SimEntity } from "$lib/rcrs/types";
  import { EntityURN, entityColor } from "$lib/rcrs/urns";
  import {
    entities,
    focusPoint,
    perceivedEntities,
    perceptionViewMode,
    selectedId,
  } from "$lib/stores/simulation";

  type MergedRow = { id: number; p: HumanEntity | null; a: HumanEntity | null };

  function calcInjured(map: Map<number, SimEntity>) {
    const result: HumanEntity[] = [];
    for (const e of map.values()) {
      if (e.urn !== EntityURN.CIVILIAN) continue;
      const h = e as HumanEntity;
      if (h.buriedness > 0 || h.damage === 0) continue;
      const pos = map.get(h.position);
      if (
        pos?.urn === EntityURN.REFUGE ||
        pos?.urn === EntityURN.AMBULANCE_TEAM
      )
        continue;
      result.push(h);
    }
    return result.sort((a, b) => a.hp - b.hp);
  }

  function merge(perceived: HumanEntity[], actual: HumanEntity[]): MergedRow[] {
    const map = new Map<number, MergedRow>();
    for (const h of perceived) map.set(h.id, { id: h.id, p: h, a: null });
    for (const h of actual) {
      const e = map.get(h.id);
      if (e) e.a = h;
      else map.set(h.id, { id: h.id, p: null, a: h });
    }
    return [...map.values()].sort((x, y) => {
      const pd = (x.p ? 0 : 1) - (y.p ? 0 : 1);
      return pd !== 0 ? pd : (x.p ?? x.a)!.hp - (y.p ?? y.a)!.hp;
    });
  }

  const injured = $derived(calcInjured($entities));
  const injuredPerceived = $derived(
    $perceptionViewMode ? calcInjured($perceivedEntities) : [],
  );
  const merged = $derived(
    $perceptionViewMode ? merge(injuredPerceived, injured) : null,
  );

  function focusOn(row: MergedRow) {
    const h = row.p ?? row.a!;
    selectedId.set(h.id);
    focusPoint.set({ x: h.x, y: h.y });
  }
</script>

{#if merged ? merged.length > 0 : injured.length > 0}
  <div class="panel" class:dual={!!merged}>
    <div class="header">
      <span class="label">Injured Civilians</span>
      {#if merged}
        <span class="col-label perceived">👁 Perceived</span>
        <span class="col-label actual">Actual</span>
      {/if}
    </div>

    <div class="list">
      {#if merged}
        {#each merged as row (row.id)}
          {@const rep = row.p ?? row.a!}
          <button
            class="row dual-row"
            onclick={() => focusOn(row)}
            class:selected={$selectedId === row.id}
          >
            <span class="cid" style="color:{entityColor(rep.urn)}"
              >#{row.id}</span
            >
            <span class="dual-cell">
              {#if row.p}
                <span class="bar-wrap"
                  ><span
                    class="bar"
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
                    class="bar"
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
      {:else}
        {#each injured as h (h.id)}
          <button
            class="row"
            onclick={() => {
              selectedId.set(h.id);
              focusPoint.set({ x: h.x, y: h.y });
            }}
            class:selected={$selectedId === h.id}
          >
            <span class="cid" style="color:{entityColor(h.urn)}">#{h.id}</span>
            <span class="stat">
              <span class="bar-wrap"
                ><span class="bar" style="width:{Math.min(100, h.hp / 100)}%"
                ></span></span
              >
              <span class="num">{h.hp.toLocaleString()}</span>
            </span>
            <span class="badge dmg">D:{h.damage}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 16px;
    left: 12px;
    width: 230px;
    max-height: 320px;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 12px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
  }

  .panel.dual {
    width: 360px;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 7px 10px 5px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
    flex-shrink: 0;
    gap: 4px;
  }

  .label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    flex: 1;
  }

  .col-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    width: 110px;
    text-align: center;
    flex-shrink: 0;
  }
  .col-label.perceived {
    color: #ffc840;
  }
  .col-label.actual {
    color: #607080;
  }

  .list {
    overflow-y: auto;
    padding: 4px 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: 3px;
    cursor: pointer;
    background: none;
    border: none;
    color: inherit;
    width: 100%;
    text-align: left;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .row.selected {
    background: rgba(0, 200, 255, 0.1);
  }

  .dual-row {
    display: grid;
    grid-template-columns: 72px 1fr 1fr;
    gap: 4px;
    align-items: center;
  }

  .cid {
    color: #607080;
    font-size: 11px;
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
    gap: 4px;
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
    background: #40c870;
    border-radius: 2px;
  }

  .num {
    font-size: 10px;
    color: #a8c8d8;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .badge {
    font-size: 10px;
    padding: 1px 3px;
    border-radius: 3px;
    flex-shrink: 0;
    background: rgba(200, 60, 60, 0.2);
    color: #c06060;
  }
</style>
