<script lang="ts">
  import type { HumanEntity } from '$lib/rcrs/types';
  import { EntityURN, entityColor } from '$lib/rcrs/urns';
  import { entities, focusPoint, selectedId } from '$lib/stores/simulation';

  const injured = $derived.by(() => {
    const result: HumanEntity[] = []
    for (const e of $entities.values()) {
      if (e.urn !== EntityURN.CIVILIAN) continue
      const h = e as HumanEntity
      if (h.buriedness > 0) continue           // 埋まっている
      if (h.damage === 0) continue             // ダメージなし
      const pos = $entities.get(h.position)
      if (pos?.urn === EntityURN.REFUGE) continue          // 避難所にいる
      if (pos?.urn === EntityURN.AMBULANCE_TEAM) continue  // 搬送中
      result.push(h)
    }
    // HP 昇順（重傷者を先頭に）
    return result.sort((a, b) => a.hp - b.hp)
  })

  function focusOn(h: HumanEntity) {
    selectedId.set(h.id)
    focusPoint.set({ x: h.x, y: h.y })
  }
</script>

{#if injured.length > 0}
  <div class="panel">
    <div class="header">
      <span class="label">Injured Civilians（{injured.length}）</span>
    </div>
    <div class="list">
      {#each injured as h (h.id)}
        <button class="row" onclick={() => focusOn(h)} class:selected={$selectedId === h.id}>
          <span class="cid" style="color:{entityColor(h.urn)}">#{h.id}</span>
          <span class="stat">
            <span class="bar-wrap"><span class="bar" style="width:{Math.min(100, h.hp / 100)}%"></span></span>
            <span class="num">{h.hp.toLocaleString()}</span>
          </span>
          <span class="badge dmg">D:{h.damage}</span>
        </button>
      {/each}
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

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 10px 5px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
    flex-shrink: 0;
  }

  .label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
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
  .row:hover    { background: rgba(255,255,255,0.05); }
  .row.selected { background: rgba(0, 200, 255, 0.1); }

  .cid {
    color: #607080;
    font-size: 11px;
    min-width: 72px;
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
    background: #40c870;
    border-radius: 2px;
  }

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
    background: rgba(200, 60, 60, 0.2);
    color: #c06060;
  }
</style>
