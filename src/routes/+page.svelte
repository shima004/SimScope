<script lang="ts">
  import ChannelFilterPanel from "$lib/components/ChannelFilterPanel.svelte";
  import CivilianStatusPanel from "$lib/components/CivilianStatusPanel.svelte";
  import ControlPanel from "$lib/components/ControlPanel.svelte";
  import IdleAgentsPanel from "$lib/components/IdleAgentsPanel.svelte";
  import InfoPanel from "$lib/components/InfoPanel.svelte";
  import ScorePanel from "$lib/components/ScorePanel.svelte";
  import SimMap from "$lib/components/SimMap.svelte";
  import TeamNamePanel from "$lib/components/TeamNamePanel.svelte";
  import { downloadProgress, loading, parseProgress } from "$lib/stores/simulation";

</script>

<div class="app">
  <SimMap />
  <div class="left-col">
    <ControlPanel />
    <TeamNamePanel />
    <ScorePanel />
    <ChannelFilterPanel />
  </div>
  <IdleAgentsPanel />
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
              <div class="progress-bar" style="width:{$downloadProgress * 100}%"></div>
            {/if}
          </div>
          <span>
            {$downloadProgress < 0 ? "Downloading…" : `Downloading… ${Math.round($downloadProgress * 100)}%`}
          </span>
        {:else if $parseProgress !== null}
          <div class="progress-wrap">
            <div class="progress-bar" style="width:{$parseProgress * 100}%"></div>
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

  .left-col {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 10;
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
    0% { transform: translateX(-150%); }
    100% { transform: translateX(350%); }
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
