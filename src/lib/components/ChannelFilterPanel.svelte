<script lang="ts">
  import { channelColorCSS } from "$lib/rcrs/channelColors";
  import {
    currentSpeakStats,
    hiddenChannels,
    kernelConfig,
  } from "$lib/stores/simulation";

  interface ChannelInfo {
    index: number;
    type: "voice" | "radio" | string;
    bandwidth?: number;
    range?: number;
  }

  const channels = $derived.by((): ChannelInfo[] => {
    const cfg = $kernelConfig;
    const result: ChannelInfo[] = [];
    for (let i = 0; ; i++) {
      const type = cfg[`comms.channels.${i}.type`];
      if (!type) break;
      result.push({
        index: i,
        type,
        bandwidth: cfg[`comms.channels.${i}.bandwidth`]
          ? Number(cfg[`comms.channels.${i}.bandwidth`])
          : undefined,
        range: cfg[`comms.channels.${i}.range`]
          ? Number(cfg[`comms.channels.${i}.range`])
          : undefined,
      });
    }
    return result;
  });

  function toggle(ch: number) {
    hiddenChannels.update((s) => {
      const next = new Set(s);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  }
</script>

{#if channels.length > 0}
  <div class="panel">
    <div class="title">Channels</div>
    <div class="ch-list">
      {#each channels as ch}
        {@const hidden = $hiddenChannels.has(ch.index)}
        {@const color = channelColorCSS(ch.index)}
        {@const stats = $currentSpeakStats.get(ch.index)}
        {@const sizeLabel = ch.bandwidth
          ? (ch.bandwidth / 1000).toFixed(0) + " kbps"
          : "—"}
        <div class="ch-row">
          <button
            class="ch-btn"
            class:hidden
            style="--c:{color}"
            onclick={() => toggle(ch.index)}
          >
            <span class="ch-icon"
              >{ch.type === "voice"
                ? "🔊"
                : ch.type === "radio"
                  ? "📡"
                  : "●"}</span
            >
            <span class="ch-label">ch.{ch.index}</span>
          </button>
          <span
            class="ch-meta"
            style="color:color-mix(in srgb, {color} 55%, #607080)"
            >{sizeLabel}</span
          >
          <span class="ch-count" class:zero={!stats} style="color:{color}">
            {stats ? `${stats.count} msg · ${stats.bytes} B` : "—"}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .panel {
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    padding: 6px 10px 8px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
  }

  .title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    margin-bottom: 6px;
  }

  .ch-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ch-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ch-btn {
    --c: #60c8ff;
    display: flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--c) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
    border-radius: 4px;
    padding: 3px 7px;
    cursor: pointer;
    transition:
      opacity 0.15s,
      background 0.15s;
  }
  .ch-btn:hover {
    background: color-mix(in srgb, var(--c) 20%, transparent);
  }
  .ch-btn.hidden {
    opacity: 0.3;
    background: transparent;
  }

  .ch-icon {
    font-size: 11px;
    line-height: 1;
    flex-shrink: 0;
  }

  .ch-meta {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .ch-count {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .ch-count.zero {
    opacity: 0.3;
  }

  .ch-label {
    font-size: 11px;
    color: var(--c);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
