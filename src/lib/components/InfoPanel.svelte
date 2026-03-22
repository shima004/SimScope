<script lang="ts">
  import { channelColorCSS } from "$lib/rcrs/channelColors";
  import type {
    AreaEntity,
    BlockadeEntity,
    BuildingEntity,
    FireBrigadeEntity,
    HumanEntity,
    RefugeEntity,
  } from "$lib/rcrs/types";
  import {
    CommandURNLabel,
    EntityURN,
    EntityURNLabel,
    FIERYNESS_LABEL,
    entityColor,
    isAgent,
    isCommandCenter,
  } from "$lib/rcrs/urns";
  import {
    agentActions,
    agentCommStats,
    agentReceivedComms,
    agentSubscriptions,
    entities,
    inspectedEntity,
    inspectedId,
    pinnedAgentId,
    selectedEntity,
    selectedId,
  } from "$lib/stores/simulation";

  function typeLabel(urn: number) {
    return EntityURNLabel[urn] ?? `URN:${urn}`;
  }

  function findCarriedCivilian(ambulanceId: number): HumanEntity | null {
    for (const e of $entities.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity;
        if (h.position === ambulanceId) return h;
      }
    }
    return null;
  }

  function togglePin(id: number) {
    pinnedAgentId.update((v) => (v === id ? null : id));
  }

  // ピン止め中かつ別エンティティを参照している状態
  const showDual = $derived(
    $pinnedAgentId !== null && $inspectedEntity !== null,
  );

  // 展開中のチャンネル番号セット
  let openChannels = $state<Set<number>>(new Set());
  function toggleChannel(ch: number) {
    openChannels = new Set(
      openChannels.has(ch)
        ? [...openChannels].filter((x) => x !== ch)
        : [...openChannels, ch],
    );
  }
</script>

{#snippet entityProps(
  e: AreaEntity | BlockadeEntity | HumanEntity | null,
  isPinned: boolean,
)}
  <div class="props">
    {#if e}
      <!-- Position -->
      {#if "x" in e && "y" in e}
        <div class="row">
          <span class="key">Position</span>
          <span class="val"
            >{(e as AreaEntity).x.toLocaleString()}, {(
              e as AreaEntity
            ).y.toLocaleString()}</span
          >
        </div>
      {/if}

      <!-- Building-specific -->
      {#if "fieryness" in e}
        {@const b = e as BuildingEntity}
        <div class="row">
          <span class="key">Fieryness</span>
          <span class="val fiery-{b.fieryness}"
            >{FIERYNESS_LABEL[b.fieryness] ?? b.fieryness}</span
          >
        </div>
        <div class="row">
          <span class="key">Brokenness</span>
          <span class="val">
            <span class="bar-wrap"
              ><span class="bar" style="width:{b.brokenness}%"></span></span
            >
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
      {#if "hp" in e}
        {@const h = e as HumanEntity}
        {@const action = $agentActions.get(e.id)}
        {#if action}
          <div class="row">
            <span class="key">Action</span>
            <span class="val action-label"
              >{CommandURNLabel[action.urn] ??
                `0x${action.urn.toString(16)}`}</span
            >
          </div>
        {/if}
        {@const commStat = $agentCommStats.get(e.id)}
        {#if commStat && commStat.speak > 0}
          <div class="row">
            <span class="key">Speak</span>
            <span class="val"
              >{commStat.speak}<span class="unit"> msg</span> · {commStat.bytes}<span
                class="unit"
              >
                B</span
              ></span
            >
          </div>
        {/if}
        {@const subChannels = [
          ...new Set([0, ...($agentSubscriptions.get(e.id) ?? [])]),
        ].sort((a, b) => a - b)}
        <div class="row">
          <span class="key">Subscribe</span>
          <span class="val">{subChannels.map((c) => `ch.${c}`).join(", ")}</span
          >
        </div>
        <div class="row">
          <span class="key">HP</span>
          <span class="val">
            <span class="bar-wrap"
              ><span class="bar hp" style="width:{Math.min(100, h.hp / 100)}%"
              ></span></span
            >
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
      {#if "bedCapacity" in e}
        {@const r = e as RefugeEntity}
        {@const pct =
          r.bedCapacity > 0
            ? Math.min(100, (r.occupiedBeds / r.bedCapacity) * 100)
            : 0}
        <div class="row">
          <span class="key">Beds</span>
          <span class="val">
            <span class="bar-wrap"
              ><span class="bar refuge" style="width:{pct}%"></span></span
            >
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
          <div class="section-label">Carrying #{carried.id}</div>
          <div class="row">
            <span class="key">HP</span>
            <span class="val">
              <span class="bar-wrap"
                ><span
                  class="bar hp"
                  style="width:{Math.min(100, carried.hp / 100)}%"
                ></span></span
              >
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
      {#if "waterQuantity" in e}
        <div class="row">
          <span class="key">Water</span>
          <span class="val"
            >{(e as FireBrigadeEntity).waterQuantity.toLocaleString()} L</span
          >
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

      <!-- Received communications — ピン止めパネル非表示、選択パネルのみ -->
      {#if !isPinned && isAgent(e.urn) && $agentReceivedComms}
        {@const subChs = [
          ...new Set([0, ...($agentSubscriptions.get(e.id) ?? [])]),
        ].sort((a, b) => a - b)}
        {@const byChannel = new Map(
          subChs.map((ch) => [
            ch,
            $agentReceivedComms!.filter((m) => m.channel === ch),
          ]),
        )}
        <div class="section-label">
          Communications ({$agentReceivedComms.length})
        </div>
        <div class="comm-ch-list">
          {#each subChs as ch}
            {@const msgs = byChannel.get(ch) ?? []}
            {@const chColor = channelColorCSS(ch)}
            {@const open = openChannels.has(ch)}
            <button
              class="ch-btn"
              style="--ch-color:{chColor}"
              onclick={(ev) => {
                ev.stopPropagation();
                toggleChannel(ch);
              }}
            >
              <span class="ch-label">ch.{ch}</span>
              <span class="ch-count">{msgs.length} msg</span>
              <span class="ch-arrow">{open ? "▾" : "▸"}</span>
            </button>
            {#if open && msgs.length > 0}
              {@const agentTypeOrder: Record<number, number> = {
                [EntityURN.FIRE_BRIGADE]: 0,
                [EntityURN.AMBULANCE_TEAM]: 1,
                [EntityURN.POLICE_FORCE]: 2,
                [EntityURN.CIVILIAN]: 3,
              }}
              {@const sortedMsgs = [...msgs].sort((a, b) => {
                const ua = $entities.get(a.senderId)?.urn ?? 9999;
                const ub = $entities.get(b.senderId)?.urn ?? 9999;
                const oa = agentTypeOrder[ua] ?? 4;
                const ob = agentTypeOrder[ub] ?? 4;
                return oa !== ob ? oa - ob : a.senderId - b.senderId;
              })}
              <div class="ch-senders">
                {#each sortedMsgs as msg, i}
                  {@const sender = $entities.get(msg.senderId)}
                  {@const prevSender =
                    i > 0 ? $entities.get(sortedMsgs[i - 1].senderId) : null}
                  {#if i > 0 && msg.senderId !== sortedMsgs[i - 1].senderId}
                    <div class="sender-divider"></div>
                  {/if}
                  <button
                    class="comm-id"
                    onclick={() =>
                      $pinnedAgentId !== null
                        ? inspectedId.set(msg.senderId)
                        : selectedId.set(msg.senderId)}
                  >
                    <span class="comm-type"
                      >{EntityURNLabel[sender?.urn ?? 0] ?? "?"}</span
                    >
                    #{msg.senderId}
                  </button>
                {/each}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<!-- ── Layout ─────────────────────────────────────────────────────────────── -->

{#if $selectedEntity || $pinnedAgentId}
  <div class="panel-group">
    <!-- 追加パネル（左側）— ピン止め中に別エンティティを参照中のみ -->
    {#if showDual && $inspectedEntity}
      {@const e = $inspectedEntity}
      <aside class="panel">
        <header>
          <span class="type-badge">{typeLabel(e.urn)}</span>
          <span
            class="entity-id"
            style="color:{entityColor(
              e.urn,
              'hp' in e ? (e as HumanEntity).hp : 10000,
            )}">#{e.id}</span
          >
          {#if isAgent(e.urn) || isCommandCenter(e.urn)}
            <button
              class="pin-btn"
              onclick={() => {
                pinnedAgentId.set(e.id);
              }}
              title="こちらをピン止めに切り替え">📌</button
            >
          {/if}
          <button
            class="close-btn"
            onclick={() => inspectedId.set(null)}
            aria-label="Close">✕</button
          >
        </header>
        {@render entityProps(e, false)}
      </aside>
    {/if}

    <!-- メインパネル（右側）— 常にピン止め or 選択中エージェントを表示 -->
    {#if $selectedEntity}
      {@const e = $selectedEntity}
      <aside class="panel" class:panel-pinned={$pinnedAgentId !== null}>
        <header>
          <span class="type-badge" class:pinned-label={$pinnedAgentId !== null}
            >{typeLabel(e.urn)}</span
          >
          <span
            class="entity-id"
            style="color:{entityColor(
              e.urn,
              'hp' in e ? (e as HumanEntity).hp : 10000,
            )}">#{e.id}</span
          >
          {#if isAgent(e.urn) || isCommandCenter(e.urn)}
            <button
              class="pin-btn"
              class:active={$pinnedAgentId === e.id}
              onclick={() => togglePin(e.id)}
              title={$pinnedAgentId === e.id ? "ピン止め解除" : "ピン止め"}
              >📌</button
            >
          {/if}
          <button
            class="close-btn"
            onclick={() => {
              pinnedAgentId.set(null);
              selectedId.set(null);
            }}
            aria-label="Close">✕</button
          >
        </header>
        {@render entityProps(e, false)}
      </aside>
    {/if}
  </div>
{/if}

<style>
  .panel-group {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: flex-start;
  }

  .panel {
    width: 260px;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 13px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
  }

  .panel-pinned {
    border-color: rgba(255, 200, 60, 0.3);
    box-shadow: 0 0 20px rgba(255, 200, 60, 0.06);
  }

  .pinned-label {
    color: #ffc840;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
  }

  .panel-pinned header {
    border-bottom-color: rgba(255, 200, 60, 0.15);
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

  .pin-btn {
    background: none;
    border: none;
    font-size: 13px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    opacity: 0.35;
    filter: grayscale(1);
    transition:
      opacity 0.15s,
      filter 0.15s;
  }
  .pin-btn:hover {
    opacity: 0.7;
    filter: grayscale(0.3);
  }
  .pin-btn.active {
    opacity: 1;
    filter: grayscale(0);
  }

  .pin-indicator {
    font-size: 13px;
    line-height: 1;
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
  .close-btn:hover {
    color: #c8d8e8;
  }

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

  .key {
    color: #607080;
    flex-shrink: 0;
  }

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
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    background: #c84040;
    border-radius: 2px;
  }
  .unit {
    font-size: 10px;
    color: #607080;
    font-weight: 400;
  }

  .action-label {
    color: #ffc840;
    font-weight: 600;
  }

  .bar.hp {
    background: #40c870;
  }
  .bar.refuge {
    background: #40c898;
  }

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
  .select-btn:hover {
    background: rgba(255, 200, 60, 0.1);
  }

  .comm-ch-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow-y: auto;
  }

  .ch-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid color-mix(in srgb, var(--ch-color) 30%, transparent);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .ch-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .ch-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ch-color);
    min-width: 32px;
  }

  .ch-count {
    font-size: 11px;
    color: #a8c8d8;
    flex: 1;
  }

  .ch-arrow {
    font-size: 10px;
    color: #607080;
  }

  .ch-senders {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 4px 12px;
    border-left: 2px solid rgba(0, 200, 255, 0.15);
    margin-left: 8px;
  }

  .sender-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 2px 0;
  }

  .comm-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 160px;
    overflow-y: auto;
  }

  .comm-entry {
    --ch-color: #60c8ff;
    background: color-mix(in srgb, var(--ch-color) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--ch-color) 30%, transparent);
    border-radius: 4px;
    padding: 5px 7px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .comm-header {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .comm-type {
    font-size: 10px;
    color: var(--ch-color);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .comm-id {
    background: none;
    border: none;
    color: #a8c8d8;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    flex: 1;
    text-align: left;
  }
  .comm-id:hover {
    color: #00c8ff;
    text-decoration: underline;
  }

  .comm-ch {
    font-size: 10px;
    color: color-mix(in srgb, var(--ch-color) 60%, #507080);
    flex-shrink: 0;
  }

  .comm-text {
    font-size: 11px;
    color: #c8d8e8;
    font-style: italic;
    padding-left: 2px;
  }

  .fiery-0 {
    color: #80c0a0;
  }
  .fiery-1 {
    color: #ffc040;
  }
  .fiery-2 {
    color: #ff8020;
  }
  .fiery-3 {
    color: #ff4000;
  }
  .fiery-4,
  .fiery-5,
  .fiery-6,
  .fiery-7 {
    color: #c08060;
  }
  .fiery-8 {
    color: #606060;
  }
</style>
