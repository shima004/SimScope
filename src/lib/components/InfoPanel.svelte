<script lang="ts">
  import { entities, selectedEntity, selectedId } from '$lib/stores/simulation'
  import { EntityURNLabel, FIERYNESS_LABEL, EntityURN, entityColor } from '$lib/rcrs/urns'
  import type { BuildingEntity, RefugeEntity, HumanEntity, BlockadeEntity, FireBrigadeEntity, AreaEntity } from '$lib/rcrs/types'

  function close() {
    selectedId.set(null)
  }

  function typeLabel(urn: number) {
    return EntityURNLabel[urn] ?? `URN:${urn}`
  }

  // 搬送中の市民を探す（市民の position が救急隊の ID と一致）
  function findCarriedCivilian(ambulanceId: number): HumanEntity | null {
    for (const e of $entities.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity
        if (h.position === ambulanceId) return h
      }
    }
    return null
  }
</script>

{#if $selectedEntity}
  {@const e = $selectedEntity}
  <aside class="panel">
    <header>
      <span class="type-badge">{typeLabel(e.urn)}</span>
      <span class="entity-id" style="color:{entityColor(e.urn, 'hp' in e ? (e as HumanEntity).hp : 10000)}">#{e.id}</span>
      <button class="close-btn" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="props">
      <!-- Position -->
      {#if 'x' in e && 'y' in e}
        <div class="row">
          <span class="key">Position</span>
          <span class="val">{(e as AreaEntity).x.toLocaleString()}, {(e as AreaEntity).y.toLocaleString()}</span>
        </div>
      {/if}

      <!-- Building-specific -->
      {#if 'fieryness' in e}
        {@const b = e as BuildingEntity}
        <div class="row">
          <span class="key">Fieryness</span>
          <span class="val fiery-{b.fieryness}">{FIERYNESS_LABEL[b.fieryness] ?? b.fieryness}</span>
        </div>
        <div class="row">
          <span class="key">Brokenness</span>
          <span class="val">
            <span class="bar-wrap">
              <span class="bar" style="width:{b.brokenness}%"></span>
            </span>
            {b.brokenness}%
          </span>
        </div>
        <div class="row">
          <span class="key">Temperature</span>
          <span class="val">{b.temperature} °C</span>
        </div>
        <div class="row">
          <span class="key">Floors</span>
          <span class="val">{b.floors}</span>
        </div>
      {/if}

      <!-- Agent-specific -->
      {#if 'hp' in e}
        {@const h = e as HumanEntity}
        <div class="row">
          <span class="key">HP</span>
          <span class="val">
            <span class="bar-wrap">
              <span class="bar hp" style="width:{Math.min(100, h.hp / 100)}%"></span>
            </span>
            {h.hp.toLocaleString()}
          </span>
        </div>
        <div class="row">
          <span class="key">Damage</span>
          <span class="val">{h.damage.toLocaleString()}</span>
        </div>
        <div class="row">
          <span class="key">Buriedness</span>
          <span class="val">{h.buriedness}</span>
        </div>
        <div class="row">
          <span class="key">Stamina</span>
          <span class="val">{h.stamina.toLocaleString()}</span>
        </div>
        <div class="row">
          <span class="key">In Area</span>
          <span class="val">#{h.position}</span>
        </div>
      {/if}

      <!-- Refuge capacity -->
      {#if 'bedCapacity' in e}
        {@const r = e as RefugeEntity}
        {@const pct = r.bedCapacity > 0 ? Math.min(100, r.occupiedBeds / r.bedCapacity * 100) : 0}
        <div class="row">
          <span class="key">Beds</span>
          <span class="val">
            <span class="bar-wrap">
              <span class="bar refuge" style="width:{pct}%"></span>
            </span>
            {r.occupiedBeds} / {r.bedCapacity}
          </span>
        </div>
        <div class="row">
          <span class="key">Waiting</span>
          <span class="val">{r.waitingListSize}</span>
        </div>
      {/if}

      <!-- Carried civilian (Ambulance Team) -->
      {#if e.urn === EntityURN.AMBULANCE_TEAM}
        {@const carried = findCarriedCivilian(e.id)}
        {#if carried}
          <div class="section-label">Carrying #{ carried.id}</div>
          <div class="row">
            <span class="key">HP</span>
            <span class="val">
              <span class="bar-wrap">
                <span class="bar hp" style="width:{Math.min(100, carried.hp / 100)}%"></span>
              </span>
              {carried.hp.toLocaleString()}
            </span>
          </div>
          <div class="row">
            <span class="key">Damage</span>
            <span class="val">{carried.damage.toLocaleString()}</span>
          </div>
          <div class="row">
            <span class="key">Buriedness</span>
            <span class="val">{carried.buriedness}</span>
          </div>
          <button class="select-btn" onclick={() => selectedId.set(carried.id)}>
            Select civilian →
          </button>
        {:else}
          <div class="section-label">No passenger</div>
        {/if}
      {/if}

      <!-- Fire Brigade water -->
      {#if 'waterQuantity' in e}
        <div class="row">
          <span class="key">Water</span>
          <span class="val">{(e as FireBrigadeEntity).waterQuantity.toLocaleString()} L</span>
        </div>
      {/if}

      <!-- Blockade -->
      {#if e.urn === EntityURN.BLOCKADE}
        {@const bl = e as BlockadeEntity}
        <div class="row">
          <span class="key">Repair Cost</span>
          <span class="val">{bl.repairCost.toLocaleString()}</span>
        </div>
        <div class="row">
          <span class="key">On Road</span>
          <span class="val">#{bl.position}</span>
        </div>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .panel {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 260px;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 13px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
  }

  .type-badge {
    font-size: 11px;
    font-weight: 600;
    color: #00c8ff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .entity-id {
    flex: 1;
    color: #607080;
    font-size: 11px;
  }

  .close-btn {
    background: none;
    border: none;
    color: #607080;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
    line-height: 1;
  }
  .close-btn:hover { color: #c8d8e8; }

  .props {
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .key { color: #607080; flex-shrink: 0; }

  .val {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: right;
    color: #a8c8d8;
  }

  .bar-wrap {
    display: inline-block;
    width: 60px;
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    background: #c84040;
    border-radius: 2px;
  }
  .bar.hp     { background: #40c870; }
  .bar.refuge { background: #40c898; }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #ffc840;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 200, 60, 0.2);
  }

  .select-btn {
    margin-top: 2px;
    background: none;
    border: 1px solid rgba(255, 200, 60, 0.3);
    border-radius: 4px;
    color: #ffc840;
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    align-self: flex-start;
  }
  .select-btn:hover { background: rgba(255, 200, 60, 0.1); }

  .fiery-0 { color: #80c0a0; }
  .fiery-1 { color: #ffc040; }
  .fiery-2 { color: #ff8020; }
  .fiery-3 { color: #ff4000; }
  .fiery-4, .fiery-5, .fiery-6, .fiery-7 { color: #c08060; }
  .fiery-8 { color: #606060; }
</style>
