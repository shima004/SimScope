<script lang="ts">
  import SimMap from '$lib/components/SimMap.svelte'
  import InfoPanel from '$lib/components/InfoPanel.svelte'
  import ControlPanel from '$lib/components/ControlPanel.svelte'
</script>

<div class="app">
  <SimMap />
  <ControlPanel />
  <InfoPanel />
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #0d1117;
  }
</style>
