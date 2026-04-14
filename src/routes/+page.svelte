<script lang="ts">
  import ChannelFilterPanel from "$lib/components/ChannelFilterPanel.svelte";
  import CivilianStatusPanel from "$lib/components/CivilianStatusPanel.svelte";
  import ControlPanel from "$lib/components/ControlPanel.svelte";
  import IdleAgentsPanel from "$lib/components/IdleAgentsPanel.svelte";
  import InfoPanel from "$lib/components/InfoPanel.svelte";
  import ScorePanel from "$lib/components/ScorePanel.svelte";
  import SimMap from "$lib/components/SimMap.svelte";
  import TeamNamePanel from "$lib/components/TeamNamePanel.svelte";
  import TimelinePanel from "$lib/components/TimelinePanel.svelte";
  import {
    downloadProgress,
    extractProgress,
    loading,
    parseProgress,
  } from "$lib/stores/simulation";

  let timelineOpen = $state(false);
  let timelineWidth = $state(272);
  let resizingTimeline = $state(false);
  let viewportWidth = $state(0);

  const TIMELINE_MIN_WIDTH = 220;
  const TIMELINE_MAX_WIDTH = 520;
  const PANEL_GAP = 12;
  const clampedTimelineWidth = $derived(
    Math.min(TIMELINE_MAX_WIDTH, Math.max(TIMELINE_MIN_WIDTH, timelineWidth)),
  );
  const leftOffset = $derived(
    timelineOpen ? clampedTimelineWidth + PANEL_GAP : 0,
  );

  function clampTimelineWidth(width: number) {
    const viewportMax =
      viewportWidth > 0
        ? Math.max(TIMELINE_MIN_WIDTH, viewportWidth - 160)
        : TIMELINE_MAX_WIDTH;
    return Math.min(
      Math.min(TIMELINE_MAX_WIDTH, viewportMax),
      Math.max(TIMELINE_MIN_WIDTH, width),
    );
  }

  function startTimelineResize(event: PointerEvent) {
    resizingTimeline = true;
    timelineWidth = clampTimelineWidth(event.clientX);
    const handle = event.currentTarget as HTMLElement | null;
    handle?.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleTimelineResize(event: PointerEvent) {
    if (!resizingTimeline) return;
    timelineWidth = clampTimelineWidth(event.clientX);
  }

  function stopTimelineResize(event?: PointerEvent) {
    if (!resizingTimeline) return;
    resizingTimeline = false;
    if (event) {
      const handle = event.currentTarget as HTMLElement | null;
      if (handle?.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    }
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div class="app">
  <SimMap />

  <!-- Sliding timeline panel -->
  <div
    class="timeline-drawer"
    class:open={timelineOpen}
    class:resizing={resizingTimeline}
    style="width:{clampedTimelineWidth}px"
  >
    <TimelinePanel />
    <div
      class="timeline-resizer"
      role="separator"
      aria-label="Resize timeline"
      aria-orientation="vertical"
      tabindex="-1"
      onpointerdown={startTimelineResize}
      onpointermove={handleTimelineResize}
      onpointerup={stopTimelineResize}
      onpointercancel={stopTimelineResize}
    ></div>
  </div>

  <!-- Toggle tab -->
  <button
    class="timeline-toggle"
    class:open={timelineOpen}
    class:resizing={resizingTimeline}
    style="left:{timelineOpen ? clampedTimelineWidth : 0}px"
    onclick={() => (timelineOpen = !timelineOpen)}
    title={timelineOpen ? "Close timeline" : "Open timeline"}
  >
    {timelineOpen ? "◂" : "▸"}
  </button>

  <div class="left-col" style="left:{leftOffset + PANEL_GAP}px">
    <ControlPanel />
    <TeamNamePanel />
    <ScorePanel />
    <ChannelFilterPanel />
  </div>
  <IdleAgentsPanel leftOffset={leftOffset + PANEL_GAP} />
  <InfoPanel />
  <CivilianStatusPanel />

  {#if $loading}
    <div class="loading-overlay">
      <div class="loading-box">
        <div class="spinner"></div>
        {#if $downloadProgress !== null}
          <div class="progress-wrap">
            {#if $downloadProgress < 0}
              <div class="progress-bar indeterminate"></div>
            {:else}
              <div
                class="progress-bar"
                style="width:{$downloadProgress * 100}%"
              ></div>
            {/if}
          </div>
          <span>
            {$downloadProgress < 0
              ? "Downloading…"
              : `Downloading… ${Math.round($downloadProgress * 100)}%`}
          </span>
        {:else if $extractProgress !== null}
          <div class="progress-wrap">
            <div class="progress-bar" style="width:{$extractProgress}%"></div>
          </div>
          <span>Extracting… {$extractProgress}%</span>
        {:else if $parseProgress !== null}
          <div class="progress-wrap">
            <div
              class="progress-bar"
              style="width:{$parseProgress * 100}%"
            ></div>
          </div>
          <span>Parsing… {Math.round($parseProgress * 100)}%</span>
        {:else}
          <span>Loading…</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #0d1117;
  }

  .timeline-drawer {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: rgba(10, 16, 24, 0.96);
    border-right: 1px solid rgba(0, 200, 255, 0.18);
    backdrop-filter: blur(8px);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
    z-index: 20;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow: hidden;
  }

  .timeline-drawer.open {
    transform: translateX(0);
  }

  .timeline-drawer.resizing {
    transition: none;
  }

  .timeline-resizer {
    position: absolute;
    top: 0;
    right: 0;
    width: 10px;
    height: 100%;
    cursor: ew-resize;
    touch-action: none;
    background: linear-gradient(
      to right,
      rgba(0, 200, 255, 0),
      rgba(0, 200, 255, 0.08)
    );
  }

  .timeline-resizer::before {
    content: "";
    position: absolute;
    top: 50%;
    right: 2px;
    transform: translateY(-50%);
    width: 3px;
    height: 56px;
    border-radius: 999px;
    background: rgba(0, 200, 255, 0.35);
    box-shadow: 0 0 10px rgba(0, 200, 255, 0.18);
  }

  .timeline-resizer:hover::before,
  .timeline-drawer.resizing .timeline-resizer::before {
    background: rgba(0, 220, 255, 0.7);
  }

  .timeline-toggle {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 21;
    width: 20px;
    height: 52px;
    background: rgba(0, 180, 255, 0.18);
    border: 1px solid rgba(0, 200, 255, 0.55);
    border-left: none;
    border-radius: 0 6px 6px 0;
    color: #00e0ff;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      left 0.25s ease,
      background 0.12s,
      box-shadow 0.12s;
    box-shadow: 2px 0 10px rgba(0, 180, 255, 0.3);
  }

  .timeline-toggle.resizing {
    transition:
      background 0.12s,
      box-shadow 0.12s;
  }

  .timeline-toggle:hover {
    background: rgba(0, 200, 255, 0.32);
    box-shadow: 2px 0 14px rgba(0, 200, 255, 0.5);
  }

  .left-col {
    position: absolute;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 10;
    transition: left 0.25s ease;
  }

  .timeline-drawer.resizing ~ .left-col,
  .timeline-drawer.resizing + .timeline-toggle,
  .timeline-toggle.resizing ~ .left-col {
    transition: none;
  }

  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .loading-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #00c8ff;
    font-size: 14px;
    font-family: monospace;
    min-width: 200px;
  }

  .progress-wrap {
    width: 100%;
    height: 4px;
    background: rgba(0, 200, 255, 0.15);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: #00c8ff;
    border-radius: 2px;
  }

  .progress-bar.indeterminate {
    width: 40%;
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    0% {
      transform: translateX(-150%);
    }
    100% {
      transform: translateX(350%);
    }
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 200, 255, 0.2);
    border-top-color: #00c8ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
