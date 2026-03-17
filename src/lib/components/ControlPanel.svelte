<script lang="ts">
  import {
    mode, connected, loading, errorMsg,
    currentStep, maxStep,
    connectWS, disconnectWS, loadFile, seekToStep,
  } from '$lib/stores/simulation'

  let wsUrl = $state('ws://localhost:7000')
  let fileInput: HTMLInputElement

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
</script>

<div class="ctrl-panel">
  <!-- WebSocket section -->
  <section>
    <span class="section-label">WebSocket</span>
    <div class="row">
      <input
        class="url-input"
        bind:value={wsUrl}
        placeholder="ws://host:port"
        disabled={$mode === 'ws'}
      />
      {#if $mode === 'ws'}
        <button class="btn danger" onclick={disconnectWS}>Disconnect</button>
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
        {$loading ? 'Loading…' : 'Open .log'}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".7z"
        style="display:none"
        onchange={handleFileChange}
      />
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
    </section>
  {/if}

  <!-- Live step counter (WS mode) -->
  {#if $mode === 'ws' && $currentStep > 0}
    <div class="live-step">Step {$currentStep}</div>
  {/if}
</div>

<style>
  .ctrl-panel {
    position: absolute;
    top: 12px;
    left: 12px;
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

  .live-step {
    font-size: 11px;
    color: #a8c8d8;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
