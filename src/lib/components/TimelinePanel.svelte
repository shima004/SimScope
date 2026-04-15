<script lang="ts">
  import type { SimEventType } from "$lib/stores/simulation";
  import {
    currentStep,
    entities,
    focusPoint,
    inspectedId,
    pinnedAgentId,
    seekToStep,
    selectedId,
    simEvents,
  } from "$lib/stores/simulation";
  import { get } from "svelte/store";

  const EVENT_LABELS: Record<SimEventType, string> = {
    rescue_start: "Rescue Start",
    rescue_end: "Rescue End",
    carry_start: "Carry Start",
    carry_end: "Carry End",
  };

  const EVENT_COLORS: Record<SimEventType, string> = {
    rescue_start: "#40c870",
    rescue_end: "#a0e0b0",
    carry_start: "#00c8ff",
    carry_end: "#80d8ff",
  };

  let activeFilters = $state<Set<SimEventType>>(
    new Set(["rescue_start", "rescue_end", "carry_start", "carry_end"])
  );

  const ALL_TYPES: SimEventType[] = ["rescue_start", "rescue_end", "carry_start", "carry_end"];

  let selectedTargetId = $state<number | null>(null);

  const filtered = $derived(
    $simEvents.filter((e) => activeFilters.has(e.type))
  );

  // Index of the first event whose step is strictly after the current step.
  // -1 means all events are past/current (no future events visible).
  const nowLineIndex = $derived(
    filtered.findIndex((ev) => ev.step > $currentStep)
  );

  interface RowMeta {
    inGroup: boolean;
    lineTop: boolean;
    lineBottom: boolean;
  }

  const groupMeta = $derived.by((): RowMeta[] => {
    if (selectedTargetId === null) {
      return filtered.map(() => ({ inGroup: false, lineTop: false, lineBottom: false }));
    }
    const groupIndices = filtered
      .map((ev, i) => (ev.targetId === selectedTargetId ? i : -1))
      .filter((i) => i !== -1);
    if (groupIndices.length === 0) {
      return filtered.map(() => ({ inGroup: false, lineTop: false, lineBottom: false }));
    }
    const firstIdx = groupIndices[0];
    const lastIdx = groupIndices[groupIndices.length - 1];
    return filtered.map((ev, i) => ({
      inGroup: ev.targetId === selectedTargetId,
      lineTop: i > firstIdx && i <= lastIdx,
      lineBottom: i >= firstIdx && i < lastIdx,
    }));
  });

  function toggleFilter(type: SimEventType) {
    const next = new Set(activeFilters);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    activeFilters = next;
  }

  function selectEvent(step: number, agentId: number, targetId: number) {
    selectedTargetId = targetId;
    if (get(pinnedAgentId) !== null) {
      inspectedId.set(agentId);
    } else {
      selectedId.set(agentId);
    }
    seekToStep(step);
    const e = get(entities).get(agentId);
    if (e && "x" in e) {
      focusPoint.set({ x: (e as { x: number; y: number }).x, y: (e as { x: number; y: number }).y });
    }
  }
</script>

<div class="timeline-panel">
  <div class="panel-header">
    <span class="panel-label">Event Timeline</span>
    <span class="event-count">{filtered.length}</span>
  </div>

  <div class="filters">
    {#each ALL_TYPES as type}
      <button
        class="filter-btn"
        class:active={activeFilters.has(type)}
        style="--color:{EVENT_COLORS[type]}"
        onclick={() => toggleFilter(type)}
      >
        {EVENT_LABELS[type]}
      </button>
    {/each}
  </div>

  <div class="event-list">
    {#if filtered.length === 0}
      <div class="empty">No events</div>
    {:else}
      {#each filtered as ev, i (ev.step + "-" + ev.type + "-" + ev.agentId + "-" + ev.targetId)}
        {@const meta = groupMeta[i]}
        {#if i === nowLineIndex && nowLineIndex !== -1}
          <div class="now-divider">
            <span class="now-label">NOW</span>
          </div>
        {/if}
        <button
          class="event-row"
          class:current={$currentStep === ev.step}
          class:in-group={meta.inGroup}
          onclick={() => selectEvent(ev.step, ev.agentId, ev.targetId)}
          title="Step {ev.step} — Agent {ev.agentId} → Target {ev.targetId}"
        >
          <!-- connector column -->
          <span
            class="connector"
            class:line-top={meta.lineTop}
            class:line-bottom={meta.lineBottom}
          >
            {#if meta.inGroup}<span class="dot"></span>{/if}
          </span>

          <span class="step-num">#{ev.step}</span>
          <span
            class="type-badge"
            style="color:{EVENT_COLORS[ev.type]};border-color:{EVENT_COLORS[ev.type]}22"
          >
            {EVENT_LABELS[ev.type]}
          </span>
          <span class="agent-id">A:{ev.agentId}</span>
          <span class="target-id" class:highlighted={meta.inGroup}>T:{ev.targetId}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .timeline-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: #c8d8e8;
    font-size: 12px;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 8px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.15);
    flex-shrink: 0;
  }

  .panel-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    flex: 1;
  }

  .event-count {
    font-size: 10px;
    color: #607080;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 8px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(0, 200, 255, 0.1);
    flex-shrink: 0;
  }

  .filter-btn {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: #607080;
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-btn.active {
    border-color: var(--color);
    color: var(--color);
    background: color-mix(in srgb, var(--color) 12%, transparent);
  }

  .filter-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .event-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 8px;
  }

  .empty {
    padding: 24px 12px;
    text-align: center;
    color: #405060;
    font-size: 11px;
  }

  .event-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 4px;
    border-radius: 3px;
    transition: background 0.1s;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }

  .event-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .event-row.current {
    background: rgba(0, 200, 255, 0.07);
  }

  .event-row:hover.current {
    background: rgba(0, 200, 255, 0.12);
  }

  .event-row.in-group {
    background: rgba(192, 96, 200, 0.06);
  }

  .event-row.in-group:hover {
    background: rgba(192, 96, 200, 0.12);
  }

  /* ── connector column ── */
  .connector {
    position: relative;
    width: 12px;
    flex-shrink: 0;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* line through top half of the row */
  .connector.line-top::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 50%;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: rgba(192, 96, 200, 0.6);
  }

  /* line through bottom half of the row */
  .connector.line-bottom::after {
    content: "";
    position: absolute;
    top: 50%;
    bottom: 0;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: rgba(192, 96, 200, 0.6);
  }

  /* dot at the midpoint for group events */
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c060c8;
    box-shadow: 0 0 4px rgba(192, 96, 200, 0.8);
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }

  /* ── data columns ── */
  .step-num {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: #607080;
    flex-shrink: 0;
    min-width: 30px;
  }

  .type-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 4px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-id {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: #c8a040;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 72px;
  }

  .target-id {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: #a060c8;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 72px;
  }

  .target-id.highlighted {
    color: #d080e0;
    font-weight: 600;
  }

  /* ── now divider ── */
  .now-divider {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    pointer-events: none;
  }

  .now-divider::before,
  .now-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(255, 200, 64, 0.45);
  }

  .now-label {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #ffc840;
    flex-shrink: 0;
  }

  /* scrollbar */
  .event-list::-webkit-scrollbar {
    width: 4px;
  }
  .event-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .event-list::-webkit-scrollbar-thumb {
    background: rgba(0, 200, 255, 0.2);
    border-radius: 2px;
  }
</style>
