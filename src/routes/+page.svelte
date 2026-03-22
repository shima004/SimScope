<script lang="ts">
  import ChannelFilterPanel from "$lib/components/ChannelFilterPanel.svelte";
  import CivilianStatusPanel from "$lib/components/CivilianStatusPanel.svelte";
  import ControlPanel from "$lib/components/ControlPanel.svelte";
  import InfoPanel from "$lib/components/InfoPanel.svelte";
  import InjuredCivilianPanel from "$lib/components/InjuredCivilianPanel.svelte";
  import ScorePanel from "$lib/components/ScorePanel.svelte";
  import SimMap from "$lib/components/SimMap.svelte";
  import { loading } from "$lib/stores/simulation";
</script>

<div class="app">
  <SimMap />
  <div class="left-col">
    <ControlPanel />
    <ScorePanel />
    <ChannelFilterPanel />
  </div>
  <InfoPanel />
  <CivilianStatusPanel />
  <InjuredCivilianPanel />

  {#if $loading}
    <div class="loading-overlay">
      <div class="loading-box">
        <div class="spinner"></div>
        <span>Loading…</span>
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
    gap: 16px;
    color: #00c8ff;
    font-size: 14px;
    font-family: monospace;
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
    to { transform: rotate(360deg); }
  }
</style>
