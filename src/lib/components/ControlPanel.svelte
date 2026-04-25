<script lang="ts">
  import type { SimEntity } from "$lib/rcrs/types";
  import { EntityURN, isAgent, isCommandCenter } from "$lib/rcrs/urns";
  import {
    agentActions,
    animatedEntities,
    computeNextSnapshot,
    connected,
    connectWS,
    currentStep,
    disconnectWS,
    entities,
    errorMsg,
    followMode,
    getCommandsAtStep,
    kernelConfig,
    loadFile,
    loading,
    loadUrl,
    maxStep,
    mode,
    perceptionViewMode,
    pinnedAgentId,
    seekToStep,
    selectedEntity,
  } from "$lib/stores/simulation";
  import { onMount } from "svelte";
  import { get } from "svelte/store";

  // /proxy?host=<tcp-host>&port=<tcp-port> → Vite の tcpWsProxyPlugin が中継
  const _q =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  let tcpHost = $state(_q.get("host") ?? "localhost");
  let tcpPort = $state(_q.get("port") ?? "27931");
  const wsScheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = $derived(
    `${wsScheme}://${typeof window !== "undefined" ? window.location.host : "localhost:5173"}/proxy?host=${tcpHost}&port=${tcpPort}`,
  );
  let fileInput = $state<HTMLInputElement>();
  let logUrl = $state(_q.get("url") ?? "");

  onMount(async () => {
    const initialUrl = _q.get("url");
    const hasServer = _q.has("host") || _q.has("port");
    if (initialUrl) {
      const result = await loadUrl(initialUrl);
      if (result !== "ok" && hasServer) connectWS(wsUrl);
    } else if (hasServer) {
      connectWS(wsUrl);
    }
  });
  let playing = $state(false);
  let loopMode = $state(false);
  let loopCountdown = $state<number | null>(null);
  let loopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let loopIntervalId: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;
  let stepStartTime = 0;
  let nextSnapshot: Map<number, SimEntity> | null = null;
  let playSpeed = $state(1); // steps/sec multiplier
  const SPEEDS = [0.5, 1, 2, 4, 8];
  const LOOP_WAIT_MS = 15000;

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }

  // Catmull-Rom スプライン: p1→p2 間を t (0→1) で補間
  function catmullRom(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    t: number,
  ): [number, number] {
    const t2 = t * t,
      t3 = t2 * t;
    return [
      0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
  }

  // positionHistory = [x0,y0, x1,y1, ...] の経路上を t (0→1) でスプライン補間
  function posOnPath(hist: number[], t: number): [number, number] {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < hist.length; i += 2)
      pts.push([hist[i], hist[i + 1]]);
    if (pts.length === 0) return [0, 0];
    if (pts.length === 1) return pts[0];

    // ease-in-out を適用
    const et = easeInOut(t);

    if (pts.length === 2) {
      // 2点のみは線形 + easing
      return [
        pts[0][0] + (pts[1][0] - pts[0][0]) * et,
        pts[0][1] + (pts[1][1] - pts[0][1]) * et,
      ];
    }

    // セグメント長に基づいて進行位置を求める
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(
        pts[i + 1][0] - pts[i][0],
        pts[i + 1][1] - pts[i][1],
      );
      lens.push(d);
      total += d;
    }
    if (total === 0) return pts[pts.length - 1];

    let rem = et * total;
    for (let i = 0; i < lens.length; i++) {
      if (rem <= lens[i] || i === lens.length - 1) {
        const s = lens[i] === 0 ? 0 : Math.min(rem / lens[i], 1);
        // ファントム点（端点を繰り返す）を使って Catmull-Rom 適用
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[Math.min(pts.length - 1, i + 1)];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        return catmullRom(p0, p1, p2, p3, s);
      }
      rem -= lens[i];
    }
    return pts[pts.length - 1];
  }

  function interpolateEntities(
    current: Map<number, SimEntity>,
    next: Map<number, SimEntity>,
    t: number,
  ): Map<number, SimEntity> {
    const result = new Map(current);
    for (const [id, nextE] of next) {
      const curE = current.get(id);
      if (!curE || !("x" in curE) || !("x" in nextE)) continue;
      // Skip interpolation when the entity is being carried (x/y reset to 0).
      // Keep it at the current position; buildAgentLayers will hide it at step N+1.
      if ((nextE as { x: number }).x === 0 && (nextE as { y: number }).y === 0) continue;
      const hist = (nextE as { positionHistory?: number[] }).positionHistory;
      let nx: number, ny: number;
      if (hist && hist.length >= 4) {
        [nx, ny] = posOnPath(hist, t);
      } else {
        nx =
          (curE as { x: number }).x +
          ((nextE as { x: number }).x - (curE as { x: number }).x) * t;
        ny =
          (curE as { y: number }).y +
          ((nextE as { y: number }).y - (curE as { y: number }).y) * t;
      }
      result.set(id, { ...curE, x: nx, y: ny });
    }
    return result;
  }

  function preAdvanceActions() {
    if ($currentStep < $maxStep) {
      agentActions.set(getCommandsAtStep($currentStep + 1));
    }
  }

  function startPlayback() {
    playing = true;
    stepStartTime = performance.now();
    nextSnapshot =
      $currentStep < $maxStep ? computeNextSnapshot($currentStep + 1) : null;
    preAdvanceActions();

    function tick(now: number) {
      if (!playing) return;
      const duration = 400 / playSpeed;
      const elapsed = now - stepStartTime;

      if (elapsed >= duration) {
        if ($currentStep >= $maxStep) {
          playing = false;
          rafId = null;
          if (loopMode) {
            loopCountdown = LOOP_WAIT_MS / 1000;
            loopIntervalId = setInterval(() => {
              loopCountdown = (loopCountdown ?? 1) - 1;
            }, 1000);
            loopTimeoutId = setTimeout(() => {
              clearInterval(loopIntervalId!);
              loopIntervalId = null;
              loopCountdown = null;
              loopTimeoutId = null;
              seekToStep(0);
              startPlayback();
            }, LOOP_WAIT_MS);
          }
          return;
        }
        seekToStep($currentStep + 1);
        stepStartTime = now - (elapsed % duration);
        nextSnapshot =
          $currentStep < $maxStep
            ? computeNextSnapshot($currentStep + 1)
            : null;
        preAdvanceActions();
      } else if (nextSnapshot) {
        animatedEntities.set(
          interpolateEntities(get(entities), nextSnapshot, elapsed / duration),
        );
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
  }

  function stopPlayback() {
    playing = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (loopTimeoutId !== null) {
      clearTimeout(loopTimeoutId);
      loopTimeoutId = null;
    }
    if (loopIntervalId !== null) {
      clearInterval(loopIntervalId);
      loopIntervalId = null;
    }
    loopCountdown = null;
    nextSnapshot = null;
    if (get(mode) === "file") {
      agentActions.set(getCommandsAtStep(get(currentStep)));
    }
  }
  let showConfig = $state(false);
  let openGroups = $state<Set<string>>(new Set());
  let inputsCollapsed = $state(false);

  const configGroups = $derived.by(() => {
    const map = new Map<string, { subkey: string; value: string }[]>();
    for (const [k, v] of Object.entries($kernelConfig).sort()) {
      const dot = k.indexOf(".");
      const prefix = dot >= 0 ? k.slice(0, dot) : k;
      const sub = dot >= 0 ? k.slice(dot + 1) : "";
      if (!map.has(prefix)) map.set(prefix, []);
      map.get(prefix)!.push({ subkey: sub, value: v });
    }
    return map;
  });

  function toggleGroup(g: string) {
    openGroups = new Set(
      openGroups.has(g)
        ? [...openGroups].filter((x) => x !== g)
        : [...openGroups, g],
    );
  }

  function handleConnect() {
    connectWS(wsUrl);
  }

  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) loadFile(file);
  }

  function handleSeek(e: Event) {
    seekToStep(Number((e.target as HTMLInputElement).value));
  }

  function stepBack() {
    seekToStep(Math.max(0, $currentStep - 1));
  }

  function stepForward() {
    seekToStep(Math.min($maxStep, $currentStep + 1));
  }

  function togglePlay() {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function setSpeed(s: number) {
    if (playing) {
      const elapsed = performance.now() - stepStartTime;
      const progress = Math.min(elapsed / (400 / playSpeed), 1);
      playSpeed = s;
      stepStartTime = performance.now() - progress * (400 / s);
    } else {
      playSpeed = s;
    }
  }

  $effect(() => {
    // モードが変わったら自動再生を停止
    if ($mode !== "file") {
      stopPlayback();
    }
    // 再生開始時にConnectionを折りたたむ
    if ($mode !== "idle") {
      inputsCollapsed = true;
    }
  });

  $effect(() => {
    if ($errorMsg) inputsCollapsed = false;
  });
</script>

<div class="ctrl-panel">
  <div
    class="inputs-header"
    role="button"
    tabindex="0"
    onclick={() => (inputsCollapsed = !inputsCollapsed)}
    onkeydown={(e) => e.key === "Enter" && (inputsCollapsed = !inputsCollapsed)}
  >
    <span class="section-label">Connection</span>
    <span class="collapse-arrow">{inputsCollapsed ? "▸" : "▾"}</span>
  </div>

  {#if !inputsCollapsed}
    <!-- WebSocket section -->
    <section>
      <span class="section-label">TCP Server</span>
      <div class="row">
        <input
          class="url-input"
          bind:value={tcpHost}
          placeholder="host"
          disabled={$mode === "ws"}
        />
        <input
          class="port-input"
          bind:value={tcpPort}
          placeholder="port"
          disabled={$mode === "ws"}
        />
        {#if $connected || $mode === "ws"}
          <button class="btn danger" onclick={disconnectWS}>Cut</button>
        {:else}
          <button
            class="btn primary"
            onclick={handleConnect}
            disabled={$loading}>Connect</button
          >
        {/if}
      </div>
      {#if $connected || $mode === "ws"}
        <div
          class="status"
          class:online={$mode === "ws"}
          class:offline={$mode !== "ws"}
        >
          {$mode === "ws" ? "● Connected" : "○ Connecting…"}
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
          onclick={() => fileInput?.click()}
          disabled={$loading}
        >
          {$loading ? "Loading…" : "Open 7z tgz tar.gz xz log file"}
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".7z,.tgz,.tar.gz,.xz,.lzma"
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
          disabled={$loading || !logUrl}>Load</button
        >
      </div>
    </section>

    {#if $errorMsg}
      <div class="error">{$errorMsg}</div>
    {/if}
  {/if}

  <!-- Timeline (file mode) -->
  {#if $mode === "file" && $maxStep > 0}
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
        <button
          class="btn icon"
          onclick={stepBack}
          disabled={$currentStep <= 0}
          aria-label="1ステップ戻る">⏮</button
        >
        <button
          class="btn icon play"
          onclick={togglePlay}
          aria-label={playing ? "一時停止" : "自動再生"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          class="btn icon"
          onclick={stepForward}
          disabled={$currentStep >= $maxStep}
          aria-label="1ステップ進む">⏭</button
        >
        <button
          class="btn icon loop"
          class:active={loopMode}
          onclick={() => { loopMode = !loopMode; if (!loopMode) stopPlayback(); }}
          title={loopMode ? "ループ再生オフ" : "ループ再生オン"}
          aria-label="ループ再生">🔁</button
        >
        <div class="speed-btns">
          {#each SPEEDS as s}
            <button
              class="btn speed"
              class:active={playSpeed === s}
              onclick={() => setSpeed(s)}>{s}x</button
            >
          {/each}
        </div>
      </div>
      {#if loopCountdown !== null}
        <div class="loop-countdown">{loopCountdown}s でループ再開</div>
      {/if}
    </section>
  {/if}

  <!-- Live step counter (WS mode) -->
  {#if $mode === "ws" && $currentStep > 0}
    {@const wsMaxStep = $kernelConfig["kernel.timesteps"]
      ? Number($kernelConfig["kernel.timesteps"])
      : null}
    <section class="timeline">
      <div class="timeline-header">
        <span class="section-label">Step</span>
        <span class="step-counter"
          >{$currentStep}{wsMaxStep ? ` / ${wsMaxStep}` : ""}</span
        >
      </div>
    </section>
  {/if}

  {#if $mode !== "idle" && $maxStep > 0}
    <div class="btn-row">
      {#if Object.keys($kernelConfig).length > 0}
        <button
          class="btn follow icon-btn"
          onclick={() => (showConfig = true)}
          title="Kernel Config">⚙️</button
        >
      {/if}
      <button
        class="btn follow"
        class:active={$followMode}
        onclick={() => followMode.update((v) => !v)}
        title="選択中のエージェントに追従">Follow</button
      >
      {#if $mode === "file"}
        <button
          class="btn follow"
          class:active={$perceptionViewMode}
          disabled={$pinnedAgentId === null &&
            (!isAgent($selectedEntity?.urn ?? 0) ||
              $selectedEntity?.urn === EntityURN.CIVILIAN) &&
            !isCommandCenter($selectedEntity?.urn ?? 0)}
          onclick={() => perceptionViewMode.update((v) => !v)}
          title="選択エージェントの知覚世界を表示">Perception</button
        >
      {/if}
    </div>
  {/if}

  <a
    class="github-link"
    href="https://github.com/shima004/SimScope"
    target="_blank"
    rel="noopener noreferrer"
  >
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
        -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
        .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
        -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
        .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
        .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
        0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
    GitHub
  </a>
</div>

<!-- Kernel config overlay -->
{#if showConfig}
  <div
    class="overlay-backdrop"
    role="presentation"
    onclick={() => (showConfig = false)}
    onkeydown={(e) => e.key === "Escape" && (showConfig = false)}
  >
    <div
      class="overlay-panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="overlay-header">
        <span class="section-label">Kernel Config</span>
        <button class="close-btn" onclick={() => (showConfig = false)}>✕</button
        >
      </div>
      <div class="config-table">
        {#each configGroups as [group, entries]}
          {@const open = openGroups.has(group)}
          <div class="config-group">
            <button class="group-header" onclick={() => toggleGroup(group)}>
              <span class="group-arrow">{open ? "▾" : "▸"}</span>
              <span class="group-name">{group}</span>
              <span class="group-count">{entries.length}</span>
            </button>
            {#if open}
              <div class="group-body">
                {#each entries as { subkey, value }}
                  <div class="config-row">
                    <span class="config-key" title={subkey}
                      >{subkey || "(value)"}</span
                    >
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

  .inputs-header {
    display: flex;
    align-items: center;
    padding: 4px 2px;
    cursor: pointer;
    user-select: none;
    border-radius: 4px;
  }
  .inputs-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .inputs-header .section-label {
    flex: 1;
    margin-bottom: 0;
  }
  .inputs-header .collapse-arrow {
    font-size: 13px;
    color: #607080;
  }
  .inputs-header:hover .collapse-arrow {
    color: #c8d8e8;
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
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #c8d8e8;
    font-size: 12px;
    padding: 5px 8px;
    min-width: 0;
  }
  .url-input:disabled {
    opacity: 0.5;
  }

  .port-input {
    width: 52px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #c8d8e8;
    font-size: 12px;
    padding: 5px 6px;
  }
  .port-input:disabled {
    opacity: 0.5;
  }

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
  .btn.primary:hover {
    background: rgba(0, 180, 255, 0.25);
  }
  .btn-row {
    display: flex;
    gap: 6px;
  }

  .btn-row .btn {
    flex: 1;
  }

  .btn.icon-btn {
    flex: 0;
    padding: 6px 10px;
  }

  .btn.follow {
    border: 1px solid rgba(0, 200, 255, 0.6);
    color: #00c8ff;
    background: rgba(0, 180, 255, 0.12);
  }
  .btn.follow:hover {
    border-color: rgba(0, 200, 255, 0.4);
    color: #a8c8d8;
  }
  .btn.follow.active {
    border: 1px solid rgba(255, 200, 60, 0.5);
    color: #ffc840;
    background: rgba(255, 200, 60, 0.1);
  }
  .btn.danger {
    background: rgba(255, 60, 60, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.3);
    color: #ff6060;
  }
  .btn.danger:hover {
    background: rgba(255, 60, 60, 0.22);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .status {
    font-size: 11px;
    margin-top: 4px;
  }
  .status.online {
    color: #40c870;
  }
  .status.offline {
    color: #c08040;
  }

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
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .speed-btns {
    display: flex;
    gap: 3px;
    margin-left: 4px;
  }

  .btn.speed {
    font-size: 10px;
    padding: 3px 5px;
    border: 1px solid rgba(0, 200, 255, 0.3);
    color: #607080;
    background: none;
  }
  .btn.speed:hover {
    color: #a8c8d8;
    border-color: rgba(0, 200, 255, 0.5);
  }
  .btn.speed.active {
    color: #00c8ff;
    border-color: rgba(0, 200, 255, 0.7);
    background: rgba(0, 200, 255, 0.08);
  }

  .btn.icon {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #a8c8d8;
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 4px;
  }

  .btn.icon.loop.active {
    color: #00c8ff;
    border-color: rgba(0, 200, 255, 0.6);
    background: rgba(0, 200, 255, 0.1);
  }

  .loop-countdown {
    font-size: 10px;
    color: #607080;
    text-align: center;
    padding: 3px 0 0;
    font-variant-numeric: tabular-nums;
  }
  .btn.icon:hover:not(:disabled) {
    background: rgba(0, 180, 255, 0.15);
    color: #00c8ff;
  }
  .btn.icon.play {
    background: rgba(0, 180, 255, 0.12);
    border-color: rgba(0, 200, 255, 0.3);
    color: #00c8ff;
    min-width: 36px;
  }
  .btn.icon.play:hover {
    background: rgba(0, 180, 255, 0.25);
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
  .close-btn:hover {
    color: #a8c8d8;
    background: rgba(255, 255, 255, 0.05);
  }

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
  .group-header:hover {
    background: rgba(0, 180, 255, 0.12);
  }

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
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
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

  .github-link {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 2px;
    color: #8b949e;
    font-size: 11px;
    font-family: monospace;
    text-decoration: none;
    transition: color 0.15s;
  }

  .github-link:hover {
    color: #e6edf3;
  }
</style>
