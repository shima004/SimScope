<script lang="ts">
  const teamName = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("team") ?? ""
    : "";
</script>

{#if teamName}
  <div class="team-name">{teamName}</div>
{/if}

<style>
  .team-name {
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 12px;
    color: #e6edf3;
    font-size: 14px;
    font-family: monospace;
    text-align: center;
  }
</style>
