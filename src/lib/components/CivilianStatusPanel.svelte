<script lang="ts">
  import type { HumanEntity } from '$lib/rcrs/types';
  import { CommandURN, EntityURN, entityColor, isAgent } from '$lib/rcrs/urns';
  import { agentActions, entities, focusPoint, selectedId } from '$lib/stores/simulation';

  // 救助中の市民: AK_RESCUE アクションのターゲット（重複排除）
  const rescuedCivilians = $derived.by(() => {
    const seen = new Map<number, HumanEntity>()
    for (const action of $agentActions.values()) {
      if (action.urn === CommandURN.AK_RESCUE && action.target !== undefined) {
        const e = $entities.get(action.target)
        if (e && !seen.has(e.id)) seen.set(e.id, e as HumanEntity)
      }
    }
    return [...seen.values()]
  })

  // 搬送中の市民: position が救急隊の ID になっている市民
  const carriedCivilians = $derived.by(() => {
    const result: { civilian: HumanEntity; carrier: HumanEntity }[] = []
    for (const e of $entities.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity
        const carrier = $entities.get(h.position)
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          result.push({ civilian: h, carrier: carrier as HumanEntity })
        }
      }
    }
    return result
  })

  // 埋まっているエージェント（救助中は除外）、buriedness 降順
  const buriedCivilians = $derived.by(() => {
    const rescuedIds = new Set(rescuedCivilians.map(c => c.id))
    const result: HumanEntity[] = []
    for (const e of $entities.values()) {
      if (!isAgent(e.urn)) continue
      const h = e as HumanEntity
      if (h.buriedness === 0) continue
      if (rescuedIds.has(h.id)) continue
      result.push(h)
    }
    const urnOrder: Record<number, number> = {
      [EntityURN.FIRE_BRIGADE]: 0,
      [EntityURN.AMBULANCE_TEAM]: 1,
      [EntityURN.POLICE_FORCE]: 2,
      [EntityURN.CIVILIAN]: 3,
    }
    return result.sort((a, b) => {
      const ro = (urnOrder[a.urn] ?? 9) - (urnOrder[b.urn] ?? 9)
      if (ro !== 0) return ro
      return a.id - b.id
    })
  })

  function focusOn(x: number, y: number, id: number) {
    selectedId.set(id)
    focusPoint.set({ x, y })
  }

  const hasAny = $derived(buriedCivilians.length > 0 || rescuedCivilians.length > 0 || carriedCivilians.length > 0)
</script>

{#if hasAny}
  <div class="panel">
    {#if carriedCivilians.length > 0}
      <div class="section-label">Carrying ({carriedCivilians.length})</div>
      {#each carriedCivilians as { civilian: c, carrier } (c.id)}
        <button class="row" onclick={() => focusOn(carrier.x, carrier.y, c.id)} class:selected={$selectedId === c.id}>
          <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span>
          <span class="stat">
            <span class="bar-wrap"><span class="bar hp" style="width:{Math.min(100, c.hp / 100)}%"></span></span>
            <span class="num">{c.hp.toLocaleString()}</span>
          </span>
          <span class="badge dmg">{c.damage > 0 ? `D:${c.damage}` : ''}</span>
        </button>
      {/each}
    {/if}

    {#if rescuedCivilians.length > 0}
      <div class="section-label">Rescuing ({rescuedCivilians.length})</div>
      {#each rescuedCivilians as c (c.id)}
        <button class="row" onclick={() => focusOn(c.x, c.y, c.id)} class:selected={$selectedId === c.id}>
          <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span>
          <span class="stat">
            <span class="bar-wrap"><span class="bar hp" style="width:{Math.min(100, c.hp / 100)}%"></span></span>
            <span class="num">{c.hp.toLocaleString()}</span>
          </span>
          <span class="badge bury">{c.buriedness > 0 ? `B:${c.buriedness}` : ''}</span>
          <span class="badge dmg">{c.damage > 0 ? `D:${c.damage}` : ''}</span>
        </button>
      {/each}
    {/if}

    {#if buriedCivilians.length > 0}
      <div class="section-label">Buried ({buriedCivilians.length})</div>
      {#each buriedCivilians as c (c.id)}
        <button class="row" onclick={() => focusOn(c.x, c.y, c.id)} class:selected={$selectedId === c.id}>
          <span class="cid" style="color:{entityColor(c.urn)}">#{c.id}</span>
          <span class="stat">
            <span class="bar-wrap"><span class="bar hp" style="width:{Math.min(100, c.hp / 100)}%"></span></span>
            <span class="num">{c.hp.toLocaleString()}</span>
          </span>
          <span class="badge bury">B:{c.buriedness}</span>
          <span class="badge dmg">{c.damage > 0 ? `D:${c.damage}` : ''}</span>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 240px;
    max-height: 340px;
    overflow-y: auto;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 12px;
    padding: 8px 10px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    padding: 4px 0 2px;
  }
  .section-label:not(:first-child) {
    margin-top: 4px;
    border-top: 1px solid rgba(0, 200, 255, 0.1);
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
  .row:hover    { background: rgba(255,255,255,0.05); }
  .row.selected { background: rgba(0, 200, 255, 0.1); }

  .cid {
    color: #607080;
    font-size: 11px;
    min-width: 68px;
    flex-shrink: 0;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .bar-wrap {
    display: inline-block;
    width: 44px;
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .bar {
    display: block;
    height: 100%;
    border-radius: 2px;
  }
  .bar.hp { background: #40c870; }

  .num {
    font-size: 11px;
    color: #a8c8d8;
    font-variant-numeric: tabular-nums;
    width: 28px;
    flex-shrink: 0;
    text-align: right;
  }

  .badge {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    flex-shrink: 0;
    min-width: 28px;
    text-align: center;
  }
  .badge:empty { display: none; }
  .badge.bury { background: rgba(200, 100, 40, 0.25); color: #c08060; }
  .badge.dmg  { background: rgba(200, 60,  60, 0.2);  color: #c06060; }
</style>
