<script lang="ts">
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const teamName = params.get("team") ?? "";
  const mapName  = params.get("map")  ?? "";
</script>

{#if teamName || mapName}
  <div class="panel">
    {#if teamName}<div class="team">{teamName}</div>{/if}
    {#if mapName}<div class="map">{mapName}</div>{/if}
  </div>
{/if}

<style>
  .panel {
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 12px;
    font-family: monospace;
    text-align: center;
  }

  .team {
    color: #e6edf3;
    font-size: 14px;
  }

  .map {
    color: #8b949e;
    font-size: 12px;
    margin-top: 2px;
  }
</style>
