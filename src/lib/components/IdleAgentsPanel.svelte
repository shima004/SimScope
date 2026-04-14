<script lang="ts">
  import type { HumanEntity } from "$lib/rcrs/types";
  import { EntityURN, EntityURNLabel, entityColor } from "$lib/rcrs/urns";
  import {
    agentActions,
    currentStep,
    entities,
    focusPoint,
    kernelConfig,
    selectedId,
  } from "$lib/stores/simulation";

  const RESCUE_AGENT_URNS = [
    EntityURN.FIRE_BRIGADE,
    EntityURN.AMBULANCE_TEAM,
    EntityURN.POLICE_FORCE,
  ] as const;

  interface IdleAgent {
    id: number;
    hp: number;
    damage: number;
    x: number;
    y: number;
    urn: number;
  }

  interface IdleGroup {
    urn: number;
    label: string;
    agents: IdleAgent[];
    total: number;
  }

  const ignoreUntil = $derived(Number($kernelConfig["kernel.agents.ignoreuntil"] ?? 0));

  const idleGroups = $derived.by((): IdleGroup[] => {
    if ($currentStep === 0 || $currentStep < ignoreUntil) return [];
    const groups: IdleGroup[] = [];
    for (const urn of RESCUE_AGENT_URNS) {
      const all: IdleAgent[] = [];
      const idle: IdleAgent[] = [];
      for (const e of $entities.values()) {
        if (e.urn !== urn) continue;
        const h = e as HumanEntity;
        if (h.buriedness !== 0) continue;
        const agent: IdleAgent = { id: e.id, hp: h.hp ?? 0, damage: h.damage ?? 0, x: h.x, y: h.y, urn: e.urn };
        all.push(agent);
        if (!$agentActions.has(e.id)) idle.push(agent);
      }
      if (idle.length > 0) {
        groups.push({
          urn,
          label: EntityURNLabel[urn] ?? `URN:${urn}`,
          agents: idle.sort((a, b) => a.id - b.id),
          total: all.length,
        });
      }
    }
    return groups;
  });

  const hasAny = $derived(idleGroups.length > 0);

  let collapsed = $state(false);

  function focusOn(agent: IdleAgent) {
    selectedId.set(agent.id);
    focusPoint.set({ x: agent.x, y: agent.y });
  }
</script>

{#if hasAny}
  <div class="panel" class:collapsed>
    <div
      class="panel-header"
      role="button"
      tabindex="0"
      onclick={() => (collapsed = !collapsed)}
      onkeydown={(e) => e.key === "Enter" && (collapsed = !collapsed)}
    >
      <span class="panel-label">Idle Agents</span>
      <span class="collapse-arrow">{collapsed ? "▸" : "▾"}</span>
    </div>

    {#if !collapsed}
      {#each idleGroups as group}
        <div class="section-label">{group.label} ({group.agents.length} / {group.total})</div>
        {#each group.agents as agent (agent.id)}
          <button
            class="row"
            class:selected={$selectedId === agent.id}
            onclick={() => focusOn(agent)}
          >
            <span class="cid" style="color:{entityColor(agent.urn, agent.hp)}">#{agent.id}</span>
            <span class="stat">
              <span class="bar-wrap"
                ><span class="bar hp" style="width:{Math.min(100, agent.hp / 100)}%"></span></span
              >
              <span class="num">{agent.hp.toLocaleString()}</span>
            </span>
            {#if agent.damage > 0}
              <span class="badge dmg">D:{agent.damage}</span>
            {/if}
          </button>
        {/each}
      {/each}
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    bottom: 16px;
    left: 12px;
    width: 230px;
    max-height: 170px;
    overflow-y: auto;
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
    gap: 3px;
    padding-bottom: 8px;
  }

  .panel.collapsed {
    padding-bottom: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px 6px;
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

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    padding: 4px 10px 2px;
  }

  :is(.row) + .section-label {
    margin-top: 4px;
    border-top: 1px solid rgba(0, 200, 255, 0.1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
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

  .cid {
    font-size: 11px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    border-radius: 2px;
  }
  .bar.hp {
    background: #40c870;
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
  }
  .badge.dmg {
    background: rgba(200, 60, 60, 0.2);
    color: #c06060;
  }
</style>
