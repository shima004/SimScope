<script lang="ts">
  import SimMap from '$lib/components/SimMap.svelte'
  import InfoPanel from '$lib/components/InfoPanel.svelte'
  import ControlPanel from '$lib/components/ControlPanel.svelte'
  import CivilianStatusPanel from '$lib/components/CivilianStatusPanel.svelte'
  import InjuredCivilianPanel from '$lib/components/InjuredCivilianPanel.svelte'
  import ScorePanel from '$lib/components/ScorePanel.svelte'
</script>

<div class="app">
  <SimMap />
  <div class="left-col">
    <ControlPanel />
    <ScorePanel />
  </div>
  <InfoPanel />
  <CivilianStatusPanel />
  <InjuredCivilianPanel />
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
</style>
