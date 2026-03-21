<script lang="ts">
  import {
    connected,
    connectWS,
    currentStep,
    disconnectWS,
    errorMsg,
    followMode,
    kernelConfig,
    loadFile,
    loading,
    loadUrl,
    maxStep,
    mode,
    perceptionViewMode,
    seekToStep
  } from '$lib/stores/simulation';
  import { onMount } from 'svelte';

  // /proxy?host=<tcp-host>&port=<tcp-port> → Vite の tcpWsProxyPlugin が中継
  const _q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  let tcpHost = $state(_q.get('host') ?? 'localhost')
  let tcpPort = $state(_q.get('port') ?? '27931')
  const wsUrl = $derived(
    `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:5173'}/proxy?host=${tcpHost}&port=${tcpPort}`
  )
  let fileInput: HTMLInputElement
  let logUrl = $state(_q.get('url') ?? '')

  onMount(async () => {
    const initialUrl = _q.get('url')
    const hasServer = _q.has('host') || _q.has('port')
    if (initialUrl) {
      const result = await loadUrl(initialUrl)
      if (result === 'not_found' && hasServer) connectWS(wsUrl)
    } else if (hasServer) {
      connectWS(wsUrl)
    }
  })
  let playing = $state(false)
  let playInterval: ReturnType<typeof setInterval> | null = null
  let showConfig = $state(false)
  let openGroups = $state<Set<string>>(new Set())

  const configGroups = $derived.by(() => {
    const map = new Map<string, { subkey: string; value: string }[]>()
    for (const [k, v] of Object.entries($kernelConfig).sort()) {
      const dot = k.indexOf('.')
      const prefix = dot >= 0 ? k.slice(0, dot) : k
      const sub    = dot >= 0 ? k.slice(dot + 1) : ''
      if (!map.has(prefix)) map.set(prefix, [])
      map.get(prefix)!.push({ subkey: sub, value: v })
    }
    return map
  })

  function toggleGroup(g: string) {
    openGroups = new Set(
      openGroups.has(g)
        ? [...openGroups].filter(x => x !== g)
        : [...openGroups, g]
    )
  }

  function handleConnect() {
    connectWS(wsUrl)
  }

  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) loadFile(file)
  }

  function handleSeek(e: Event) {
    seekToStep(Number((e.target as HTMLInputElement).value))
  }

  function stepBack() {
    seekToStep(Math.max(0, $currentStep - 1))
  }

  function stepForward() {
    seekToStep(Math.min($maxStep, $currentStep + 1))
  }

  function togglePlay() {
    if (playing) {
      clearInterval(playInterval!)
      playInterval = null
      playing = false
    } else {
      playing = true
      playInterval = setInterval(() => {
        if ($currentStep >= $maxStep) {
          clearInterval(playInterval!)
          playInterval = null
          playing = false
          return
        }
        seekToStep($currentStep + 1)
      }, 200)
    }
  }

  $effect(() => {
    // モードが変わったら自動再生を停止
    if ($mode !== 'file') {
      clearInterval(playInterval!)
      playInterval = null
      playing = false
    }
  })
</script>

<div class="ctrl-panel">
  <!-- WebSocket section -->
  <section>
    <span class="section-label">TCP Server</span>
    <div class="row">
      <input
        class="url-input"
        bind:value={tcpHost}
        placeholder="host"
        disabled={$mode === 'ws'}
      />
      <input
        class="port-input"
        bind:value={tcpPort}
        placeholder="port"
        disabled={$mode === 'ws'}
      />
      {#if $mode === 'ws'}
        <button class="btn danger" onclick={disconnectWS}>Cut</button>
      {:else}
        <button class="btn primary" onclick={handleConnect} disabled={$loading}>Connect</button>
      {/if}
    </div>
    {#if $mode === 'ws'}
      <div class="status" class:online={$connected} class:offline={!$connected}>
        {$connected ? '● Connected' : '○ Reconnecting…'}
      </div>
    {/if}
  </section>

  <div class="divider">or</div>

  <!-- File section -->
  <section>
    <span class="section-label">Log File</span>
    <div class="row">
      <button
        class="btn primary"
        onclick={() => fileInput.click()}
        disabled={$loading}
      >
        {$loading ? 'Loading…' : 'Open 7z tgz tar.gz log file'}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".7z,.tgz,.tar.gz"
        style="display:none"
        onchange={handleFileChange}
      />
    </div>
    <div class="row" style="margin-top: 8px;">
      <input
        class="url-input"
        bind:value={logUrl}
        placeholder="https://example.com/log.7z"
        disabled={$loading}
      />
      <button
        class="btn primary"
        onclick={() => loadUrl(logUrl)}
        disabled={$loading || !logUrl}
      >Load</button>
    </div>
  </section>

  {#if $errorMsg}
    <div class="error">{$errorMsg}</div>
  {/if}

  <!-- Timeline (file mode) -->
  {#if $mode === 'file' && $maxStep > 0}
    <section class="timeline">
      <div class="timeline-header">
        <span class="section-label">Step</span>
        <span class="step-counter">{$currentStep} / {$maxStep}</span>
      </div>
      <input
        type="range"
        min="0"
        max={$maxStep}
        value={$currentStep}
        oninput={handleSeek}
      />
      <div class="playback-row">
        <button class="btn icon" onclick={stepBack}     disabled={$currentStep <= 0}        aria-label="1ステップ戻る">⏮</button>
        <button class="btn icon play" onclick={togglePlay} aria-label={playing ? '一時停止' : '自動再生'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button class="btn icon" onclick={stepForward} disabled={$currentStep >= $maxStep} aria-label="1ステップ進む">⏭</button>
      </div>
    </section>
  {/if}

  <!-- Live step counter (WS mode) -->
  {#if $mode === 'ws' && $currentStep > 0}
    <div class="live-step">Step {$currentStep}</div>
  {/if}

  <!-- Kernel config button (WS mode) -->
  {#if Object.keys($kernelConfig).length > 0}
    <button class="btn primary" onclick={() => showConfig = true}>Kernel Config</button>
  {/if}

  {#if $mode !== 'idle' && $maxStep > 0}
    <button
      class="btn follow"
      class:active={$followMode}
      onclick={() => followMode.update(v => !v)}
      title="選択中のエージェントに追従"
    >{$followMode ? '⊙ Follow ON' : '⊙ Follow OFF'}</button>
  {/if}

  {#if $mode === 'file' && $maxStep > 0}
    <button
      class="btn follow"
      class:active={$perceptionViewMode}
      onclick={() => perceptionViewMode.update(v => !v)}
      title="選択エージェントの知覚世界を表示"
    >{$perceptionViewMode ? '👁 Perception ON' : '👁 Perception OFF'}</button>
  {/if}
</div>

<!-- Kernel config overlay -->
{#if showConfig}
  <div class="overlay-backdrop" role="presentation" onclick={() => showConfig = false} onkeydown={(e) => e.key === 'Escape' && (showConfig = false)}>
    <div class="overlay-panel" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="overlay-header">
        <span class="section-label">Kernel Config</span>
        <button class="close-btn" onclick={() => showConfig = false}>✕</button>
      </div>
      <div class="config-table">
        {#each configGroups as [group, entries]}
          {@const open = openGroups.has(group)}
          <div class="config-group">
            <button class="group-header" onclick={() => toggleGroup(group)}>
              <span class="group-arrow">{open ? '▾' : '▸'}</span>
              <span class="group-name">{group}</span>
              <span class="group-count">{entries.length}</span>
            </button>
            {#if open}
              <div class="group-body">
                {#each entries as { subkey, value }}
                  <div class="config-row">
                    <span class="config-key" title={subkey}>{subkey || '(value)'}</span>
                    <span class="config-val">{value}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .ctrl-panel {
    width: 240px;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    color: #c8d8e8;
    font-size: 13px;
    padding: 12px;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
    margin-bottom: 6px;
  }

  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .url-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: #c8d8e8;
    font-size: 12px;
    padding: 5px 8px;
    min-width: 0;
  }
  .url-input:disabled { opacity: 0.5; }

  .port-input {
    width: 52px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: #c8d8e8;
    font-size: 12px;
    padding: 5px 6px;
  }
  .port-input:disabled { opacity: 0.5; }

  .btn {
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    padding: 5px 10px;
    white-space: nowrap;
  }
  .btn.primary {
    background: rgba(0, 180, 255, 0.15);
    border: 1px solid rgba(0, 200, 255, 0.3);
    color: #00c8ff;
  }
  .btn.primary:hover { background: rgba(0, 180, 255, 0.25); }
  .btn.follow { border: 1px solid rgba(0, 200, 255, 0.6); color: #00c8ff; background: rgba(0, 180, 255, 0.12); }
  .btn.follow:hover { border-color: rgba(0, 200, 255, 0.4); color: #a8c8d8; }
  .btn.follow.active { border: 1px solid rgba(255, 200, 60, 0.5); color: #ffc840; background: rgba(255, 200, 60, 0.1); }
  .btn.danger {
    background: rgba(255, 60, 60, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.3);
    color: #ff6060;
  }
  .btn.danger:hover { background: rgba(255, 60, 60, 0.22); }
  .btn:disabled { opacity: 0.4; cursor: default; }

  .status {
    font-size: 11px;
    margin-top: 4px;
  }
  .status.online  { color: #40c870; }
  .status.offline { color: #c08040; }

  .divider {
    text-align: center;
    color: #405060;
    font-size: 11px;
    position: relative;
  }

  .error {
    font-size: 11px;
    color: #ff6060;
    background: rgba(255, 60, 60, 0.08);
    border: 1px solid rgba(255, 80, 80, 0.2);
    border-radius: 4px;
    padding: 6px 8px;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .step-counter {
    font-size: 11px;
    color: #a8c8d8;
    font-variant-numeric: tabular-nums;
  }

  input[type="range"] {
    width: 100%;
    accent-color: #00c8ff;
  }

  .playback-row {
    display: flex;
    justify-content: center;
    gap: 6px;
  }

  .btn.icon {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: #a8c8d8;
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 4px;
  }
  .btn.icon:hover:not(:disabled) { background: rgba(0, 180, 255, 0.15); color: #00c8ff; }
  .btn.icon.play {
    background: rgba(0, 180, 255, 0.12);
    border-color: rgba(0, 200, 255, 0.3);
    color: #00c8ff;
    min-width: 36px;
  }
  .btn.icon.play:hover { background: rgba(0, 180, 255, 0.25); }

  .live-step {
    font-size: 11px;
    color: #a8c8d8;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .overlay-panel {
    background: rgba(13, 20, 30, 0.97);
    border: 1px solid rgba(0, 200, 255, 0.25);
    border-radius: 8px;
    padding: 16px;
    width: 720px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    backdrop-filter: blur(8px);
    box-shadow: 0 0 40px rgba(0, 180, 255, 0.12);
  }

  .overlay-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .close-btn {
    background: none;
    border: none;
    color: #607080;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .close-btn:hover { color: #a8c8d8; background: rgba(255,255,255,0.05); }

  .config-table {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .config-group {
    display: flex;
    flex-direction: column;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 180, 255, 0.06);
    border: none;
    border-radius: 4px;
    padding: 5px 8px;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .group-header:hover { background: rgba(0, 180, 255, 0.12); }

  .group-arrow {
    font-size: 10px;
    color: #00c8ff;
    width: 10px;
    flex-shrink: 0;
  }

  .group-name {
    font-size: 11px;
    font-weight: 600;
    color: #00c8ff;
    flex: 1;
  }

  .group-count {
    font-size: 10px;
    color: #405060;
    font-variant-numeric: tabular-nums;
  }

  .group-body {
    display: flex;
    flex-direction: column;
    padding: 2px 0 4px 16px;
    border-left: 1px solid rgba(0, 200, 255, 0.1);
    margin-left: 12px;
  }

  .config-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 11px;
    padding: 2px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    line-height: 1.4;
  }

  .config-key {
    color: #7090a8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .config-val {
    color: #a8c8d8;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
