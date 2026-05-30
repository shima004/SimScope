<script lang="ts">
  import { base } from "$app/paths";
  import type { SimEntity } from "$lib/rcrs/types";
  import ChannelFilterPanel from "$lib/components/ChannelFilterPanel.svelte";
  import CivilianStatusPanel from "$lib/components/CivilianStatusPanel.svelte";
  import ControlPanel from "$lib/components/ControlPanel.svelte";
  import IdleAgentsPanel from "$lib/components/IdleAgentsPanel.svelte";
  import InfoPanel from "$lib/components/InfoPanel.svelte";
  import ScorePanel from "$lib/components/ScorePanel.svelte";
  import SimMap from "$lib/components/SimMap.svelte";
  import TeamNamePanel from "$lib/components/TeamNamePanel.svelte";
  import TimelinePanel from "$lib/components/TimelinePanel.svelte";
  import { interpolateEntities } from "$lib/stores/simulation/interpolation";
  import {
    agentActions,
    agentDisplayMode,
    animatedEntities,
    computeNextSnapshot,
    currentStep,
    downloadProgress,
    downloadSize,
    entities,
    extractProgress,
    getCommandsAtStep,
    loading,
    loadUrl,
    maxStep,
    mode,
    parseProgress,
    seekToStep,
  } from "$lib/stores/simulation";
  import { onMount } from "svelte";
  import { get } from "svelte/store";

  type SimCamera = {
    target: [number, number, number];
    zoom: number;
  };

  function fmtBytes(b: number): string {
    if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  }

  let timelineOpen = $state(false);
  let screenshotMode = $state(false);
  let embedMode = $state(false);
  let paneMode = $state(false);
  let dataLoaded = $state(false);
  let compareUrls = $state<string[]>([]);
  let compareFrames = $state<HTMLIFrameElement[]>([]);
  let compareStep = $state(0);
  let compareMaxStep = $state(0);
  let comparePlaying = $state(false);
  let compareSpeed = $state(1);
  let compareRafId: number | null = null;
  let compareStepStart = 0;
  let singlePlaying = $state(false);
  let singleLoopMode = $state(false);
  let singleLoopCountdown = $state<number | null>(null);
  let singleLoopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let singleLoopIntervalId: ReturnType<typeof setInterval> | null = null;
  let singleRafId: number | null = null;
  let singleStepStart = 0;
  let singleNextSnapshot: Map<number, SimEntity> | null = null;
  let singleSpeed = $state(1);

  const COMPARE_SPEEDS = [0.5, 1, 2, 4, 8];
  const LOOP_WAIT_MS = 15000;

  function appPath(params: URLSearchParams) {
    return `${base || "/"}?${params.toString()}`;
  }

  function compareSrc(url: string) {
    const params = new URLSearchParams();
    params.set("autoload", url);
    params.set("embed", "1");
    return appPath(params);
  }

  function emptyPaneSrc() {
    const params = new URLSearchParams();
    params.set("pane", "1");
    return appPath(params);
  }

  function currentPaneSrc() {
    const params = new URLSearchParams(window.location.search);
    params.delete("compare");
    params.delete("embed");
    params.delete("screenshot");
    params.delete("panes");
    params.set("pane", "1");
    return appPath(params);
  }

  function getFrameApi(frame: HTMLIFrameElement | undefined) {
    return frame?.contentWindow as
      | (Window & {
          __simscope_seekTo?: (step: number) => void;
          __simscope_maxStep?: () => number;
          __simscope_previewStep?: (nextStep: number, progress: number) => void;
          __simscope_setAgentDisplayMode?: (mode: "circle" | "emoji") => void;
          __simscope_getCamera?: () => SimCamera | null;
          __simscope_setCamera?: (camera: SimCamera) => void;
        })
      | undefined;
  }

  function activeFrames() {
    return paneSources.length > 0 ? paneFrames : compareFrames;
  }

  function seekCompare(step: number) {
    compareStep = Math.max(0, Math.min(step, compareMaxStep));
    for (const frame of activeFrames()) {
      getFrameApi(frame)?.__simscope_seekTo?.(compareStep);
    }
  }

  function previewCompare(nextStep: number, progress: number) {
    for (const frame of activeFrames()) {
      getFrameApi(frame)?.__simscope_previewStep?.(nextStep, progress);
    }
  }

  let compareLoopMode = $state(false);
  let compareLoopCountdown = $state<number | null>(null);
  let compareLoopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let compareLoopIntervalId: ReturnType<typeof setInterval> | null = null;
  let compareAgentDisplayMode = $state<"circle" | "emoji">("circle");
  let compareCameraSync = $state(true);

  function setCompareAgentDisplayMode(mode: "circle" | "emoji") {
    compareAgentDisplayMode = mode;
    for (const frame of activeFrames()) {
      getFrameApi(frame)?.__simscope_setAgentDisplayMode?.(mode);
    }
  }

  function syncCameraToFrame(targetFrame: HTMLIFrameElement) {
    if (!compareCameraSync) return;
    const sourceFrame = activeFrames().find((frame) => frame !== targetFrame);
    const camera = sourceFrame ? getFrameApi(sourceFrame)?.__simscope_getCamera?.() : null;
    if (camera) getFrameApi(targetFrame)?.__simscope_setCamera?.(camera);
  }

  function syncCameraToAllFrames() {
    const frames = activeFrames();
    const sourceFrame = frames.find((frame) => getFrameApi(frame)?.__simscope_getCamera?.());
    const camera = sourceFrame ? getFrameApi(sourceFrame)?.__simscope_getCamera?.() : null;
    if (!camera) return;
    for (const frame of frames) {
      if (frame !== sourceFrame) getFrameApi(frame)?.__simscope_setCamera?.(camera);
    }
  }

  function toggleCompareCameraSync() {
    compareCameraSync = !compareCameraSync;
    if (compareCameraSync) requestAnimationFrame(syncCameraToAllFrames);
  }

  function syncCameraFromWindow(sourceWindow: Window | null, camera: SimCamera) {
    if (!compareCameraSync) return;
    const sourceFrame = activeFrames().find(
      (frame) => frame.contentWindow === sourceWindow,
    );
    if (!sourceFrame) return;
    for (const frame of activeFrames()) {
      if (frame !== sourceFrame) getFrameApi(frame)?.__simscope_setCamera?.(camera);
    }
  }

  function toggleCompareAgentDisplayMode() {
    setCompareAgentDisplayMode(compareAgentDisplayMode === "emoji" ? "circle" : "emoji");
  }

  function resetCompareLoopTimers() {
    if (compareLoopTimeoutId !== null) {
      clearTimeout(compareLoopTimeoutId);
      compareLoopTimeoutId = null;
    }
    if (compareLoopIntervalId !== null) {
      clearInterval(compareLoopIntervalId);
      compareLoopIntervalId = null;
    }
    compareLoopCountdown = null;
  }

  function updateCompareMaxStep() {
    const steps = activeFrames()
      .map((frame) => getFrameApi(frame)?.__simscope_maxStep?.() ?? 0)
      .filter((step) => step > 0);
    compareMaxStep = steps.length > 0 ? Math.min(...steps) : 0;
    if (compareStep > compareMaxStep) seekCompare(compareMaxStep);
  }

  function startComparePlayback() {
    if (compareMaxStep <= 0) return;
    comparePlaying = true;
    compareStepStart = performance.now();

    function tick(now: number) {
      if (!comparePlaying) return;
      const duration = 400 / compareSpeed;
      const elapsed = now - compareStepStart;
      if (elapsed >= duration) {
        if (compareStep >= compareMaxStep) {
          comparePlaying = false;
          compareRafId = null;
          if (compareLoopMode) {
            compareLoopCountdown = LOOP_WAIT_MS / 1000;
            compareLoopIntervalId = setInterval(() => {
              compareLoopCountdown = (compareLoopCountdown ?? 1) - 1;
            }, 1000);
            compareLoopTimeoutId = setTimeout(() => {
              resetCompareLoopTimers();
              seekCompare(0);
              startComparePlayback();
            }, LOOP_WAIT_MS);
          }
          return;
        }
        seekCompare(compareStep + 1);
        compareStepStart = now - (elapsed % duration);
        if (compareStep < compareMaxStep) {
          previewCompare(compareStep + 1, (now - compareStepStart) / duration);
        }
      } else if (compareStep < compareMaxStep) {
        previewCompare(compareStep + 1, elapsed / duration);
      }
      compareRafId = requestAnimationFrame(tick);
    }

    compareRafId = requestAnimationFrame(tick);
  }

  function stopComparePlayback() {
    comparePlaying = false;
    resetCompareLoopTimers();
    if (compareRafId !== null) {
      cancelAnimationFrame(compareRafId);
      compareRafId = null;
    }
  }

  function toggleComparePlayback() {
    if (comparePlaying) stopComparePlayback();
    else startComparePlayback();
  }

  function setCompareSpeed(speed: number) {
    if (comparePlaying) {
      const elapsed = performance.now() - compareStepStart;
      const progress = Math.min(elapsed / (400 / compareSpeed), 1);
      compareSpeed = speed;
      compareStepStart = performance.now() - progress * (400 / speed);
    } else {
      compareSpeed = speed;
    }
  }

  function preAdvanceSingleActions() {
    if ($currentStep < $maxStep) {
      agentActions.set(getCommandsAtStep($currentStep + 1));
    }
  }

  function startSinglePlayback() {
    if ($maxStep <= 0) return;
    singlePlaying = true;
    singleStepStart = performance.now();
    singleNextSnapshot =
      $currentStep < $maxStep ? computeNextSnapshot($currentStep + 1) : null;
    preAdvanceSingleActions();

    function tick(now: number) {
      if (!singlePlaying) return;
      const duration = 400 / singleSpeed;
      const elapsed = now - singleStepStart;

      if (elapsed >= duration) {
        if ($currentStep >= $maxStep) {
          singlePlaying = false;
          singleRafId = null;
          if (singleLoopMode) {
            singleLoopCountdown = LOOP_WAIT_MS / 1000;
            singleLoopIntervalId = setInterval(() => {
              singleLoopCountdown = (singleLoopCountdown ?? 1) - 1;
            }, 1000);
            singleLoopTimeoutId = setTimeout(() => {
              if (singleLoopIntervalId !== null) clearInterval(singleLoopIntervalId);
              singleLoopIntervalId = null;
              singleLoopCountdown = null;
              singleLoopTimeoutId = null;
              seekToStep(0);
              startSinglePlayback();
            }, LOOP_WAIT_MS);
          }
          return;
        }

        seekToStep($currentStep + 1);
        singleStepStart = now - (elapsed % duration);
        singleNextSnapshot =
          $currentStep < $maxStep ? computeNextSnapshot($currentStep + 1) : null;
        preAdvanceSingleActions();
      } else if (singleNextSnapshot) {
        animatedEntities.set(
          interpolateEntities(get(entities), singleNextSnapshot, elapsed / duration),
        );
      }

      singleRafId = requestAnimationFrame(tick);
    }

    singleRafId = requestAnimationFrame(tick);
  }

  function stopSinglePlayback() {
    singlePlaying = false;
    if (singleRafId !== null) {
      cancelAnimationFrame(singleRafId);
      singleRafId = null;
    }
    if (singleLoopTimeoutId !== null) {
      clearTimeout(singleLoopTimeoutId);
      singleLoopTimeoutId = null;
    }
    if (singleLoopIntervalId !== null) {
      clearInterval(singleLoopIntervalId);
      singleLoopIntervalId = null;
    }
    singleLoopCountdown = null;
    singleNextSnapshot = null;
    if (get(mode) === "file") {
      agentActions.set(getCommandsAtStep(get(currentStep)));
    }
  }

  function toggleSinglePlayback() {
    if (singlePlaying) stopSinglePlayback();
    else startSinglePlayback();
  }

  function seekSingle(step: number) {
    stopSinglePlayback();
    seekToStep(Math.max(0, Math.min(step, $maxStep)));
  }

  function setSingleSpeed(speed: number) {
    if (singlePlaying) {
      const elapsed = performance.now() - singleStepStart;
      const progress = Math.min(elapsed / (400 / singleSpeed), 1);
      singleSpeed = speed;
      singleStepStart = performance.now() - progress * (400 / speed);
    } else {
      singleSpeed = speed;
    }
  }

  let paneSources = $state<string[]>([]);
  let paneFrames = $state<HTMLIFrameElement[]>([]);
  const showingPaneGrid = $derived(paneSources.length > 0 && !embedMode && !paneMode);

  function enterPaneMode() {
    paneSources = [currentPaneSrc(), emptyPaneSrc()];
    stopComparePlayback();
    compareStep = 0;
    compareMaxStep = 0;
    setCompareAgentDisplayMode(compareAgentDisplayMode);
  }

  function addPane() {
    paneSources = [...paneSources, emptyPaneSrc()];
    updateCompareMaxStep();
    requestAnimationFrame(() => setCompareAgentDisplayMode(compareAgentDisplayMode));
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    screenshotMode = params.has("screenshot");
    embedMode = params.has("embed");
    paneMode = params.has("pane");
    compareUrls = params.getAll("compare").filter(Boolean);
    const panes = Math.max(0, parseInt(params.get("panes") ?? "0", 10));
    if (!embedMode && !paneMode) {
      if (compareUrls.length === 0 && panes > 0) {
        paneSources = [currentPaneSrc(), ...Array.from({ length: panes - 1 }, emptyPaneSrc)];
      } else if (compareUrls.length === 0) {
        paneSources = [currentPaneSrc()];
      }
    }

    const timer =
      !embedMode && !paneMode ? setInterval(updateCompareMaxStep, 500) : null;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (embedMode || paneMode) return;
      const data = event.data as { type?: string; camera?: SimCamera };
      if (data?.type !== "simscope:camera" || !data.camera) return;
      syncCameraFromWindow(event.source as Window | null, data.camera);
    }

    window.addEventListener("message", handleMessage);

    const autoUrl = params.get("autoload");
    const autoStep = params.get("step");
    void (async () => {
      if (!autoUrl) {
        dataLoaded = true;
        return;
      }

      const result = await loadUrl(autoUrl);
      if (result === "ok" && autoStep !== null) {
        seekToStep(parseInt(autoStep, 10));
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          dataLoaded = true;
          window.parent.postMessage({ type: "simscope:loaded" }, window.location.origin);
        }),
      );
    })();

    // CLI スナップショット用
    (window as unknown as Record<string, unknown>).__simscope_seekTo = (step: number) => seekToStep(step);
    (window as unknown as Record<string, unknown>).__simscope_maxStep = () => get(maxStep);
    (window as unknown as Record<string, unknown>).__simscope_previewStep = (
      nextStep: number,
      progress: number,
    ) => {
      if (get(currentStep) + 1 !== nextStep || nextStep > get(maxStep)) return;
      const nextSnapshot = computeNextSnapshot(nextStep);
      agentActions.set(getCommandsAtStep(nextStep));
      animatedEntities.set(
        interpolateEntities(
          get(entities),
          nextSnapshot,
          Math.max(0, Math.min(progress, 1)),
        ),
      );
    };
    (window as unknown as Record<string, unknown>).__simscope_setAgentDisplayMode = (
      mode: "circle" | "emoji",
    ) => agentDisplayMode.set(mode);
    (
      window as unknown as Record<string, unknown>
    ).__simscope_syncCameraFromChild = (camera: SimCamera, sourceWindow: Window) =>
      syncCameraFromWindow(sourceWindow, camera);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("message", handleMessage);
      delete (
        window as unknown as Record<string, unknown>
      ).__simscope_syncCameraFromChild;
      stopComparePlayback();
      stopSinglePlayback();
    };
  });

  $effect(() => {
    if ($mode !== "file") stopSinglePlayback();
  });

  const TIMELINE_WIDTH = 300;
  const PANEL_GAP = 12;
  const leftOffset = $derived(timelineOpen ? TIMELINE_WIDTH + PANEL_GAP : 0);
</script>

<div class="app" data-loaded={dataLoaded ? "true" : undefined}>
  {#if showingPaneGrid}
    <div class="compare-app">
      <div class="compare-grid" style="--cols:{paneSources.length > 2 ? 2 : paneSources.length}">
        {#each paneSources as src, i}
          <section class="compare-cell">
            <div class="compare-label">Simulation {i + 1}</div>
            <iframe
              title="Simulation {i + 1}"
              src={src}
              bind:this={paneFrames[i]}
              onload={() => paneFrames[i] && syncCameraToFrame(paneFrames[i])}
            ></iframe>
          </section>
        {/each}
      </div>
      <div class="compare-controls">
        <button class="compare-btn add" onclick={addPane}>＋</button>
        <button class="compare-btn" onclick={() => seekCompare(Math.max(0, compareStep - 1))} disabled={compareStep <= 0}>⏮</button>
        <button class="compare-btn play" onclick={toggleComparePlayback} disabled={compareMaxStep <= 0}>{comparePlaying ? "⏸" : "▶"}</button>
        <button class="compare-btn" onclick={() => seekCompare(Math.min(compareMaxStep, compareStep + 1))} disabled={compareStep >= compareMaxStep}>⏭</button>
        <button
          class="compare-btn loop"
          class:active={compareLoopMode}
          onclick={() => {
            compareLoopMode = !compareLoopMode;
            if (!compareLoopMode) stopComparePlayback();
          }}
          title={compareLoopMode ? "ループ再生オフ" : "ループ再生オン"}
        >
          🔁
        </button>
        <button
          class="compare-btn display"
          class:active={compareAgentDisplayMode === "emoji"}
          onclick={toggleCompareAgentDisplayMode}
          title={compareAgentDisplayMode === "emoji" ? "絵文字モード（クリックで切替）" : "Circleモード（クリックで切替）"}
        >
          {compareAgentDisplayMode === "emoji" ? "🚒" : "⬤"}
        </button>
        <button
          class="compare-btn camera-sync"
          class:active={compareCameraSync}
          onclick={toggleCompareCameraSync}
          title={compareCameraSync ? "カメラ同期オン" : "カメラ同期オフ"}
        >
          {compareCameraSync ? "🔗" : "⛓"}
        </button>
        <span class="compare-step">{compareStep} / {compareMaxStep}</span>
        <input
          type="range"
          min="0"
          max={compareMaxStep}
          value={compareStep}
          oninput={(e) => seekCompare(Number((e.target as HTMLInputElement).value))}
          disabled={compareMaxStep <= 0}
        />
        <div class="compare-speeds">
          {#each COMPARE_SPEEDS as speed}
            <button
              class="compare-btn speed"
              class:active={compareSpeed === speed}
              onclick={() => setCompareSpeed(speed)}
            >
              {speed}x
            </button>
          {/each}
        </div>
        {#if compareLoopCountdown !== null}
          <span class="loop-countdown">{compareLoopCountdown}s</span>
        {/if}
      </div>
    </div>
  {:else if compareUrls.length > 1 && !embedMode && !paneMode}
    <div class="compare-app">
      <div class="compare-grid" style="--cols:{compareUrls.length > 2 ? 2 : compareUrls.length}">
        {#each compareUrls as url, i}
          <section class="compare-cell">
            <div class="compare-label" title={url}>{i + 1}. {url}</div>
            <iframe
              title="Simulation {i + 1}"
              src={compareSrc(url)}
              bind:this={compareFrames[i]}
              onload={() => compareFrames[i] && syncCameraToFrame(compareFrames[i])}
            ></iframe>
          </section>
        {/each}
      </div>
      <div class="compare-controls">
        <button class="compare-btn" onclick={() => seekCompare(Math.max(0, compareStep - 1))} disabled={compareStep <= 0}>⏮</button>
        <button class="compare-btn play" onclick={toggleComparePlayback} disabled={compareMaxStep <= 0}>{comparePlaying ? "⏸" : "▶"}</button>
        <button class="compare-btn" onclick={() => seekCompare(Math.min(compareMaxStep, compareStep + 1))} disabled={compareStep >= compareMaxStep}>⏭</button>
        <button
          class="compare-btn loop"
          class:active={compareLoopMode}
          onclick={() => {
            compareLoopMode = !compareLoopMode;
            if (!compareLoopMode) stopComparePlayback();
          }}
          title={compareLoopMode ? "ループ再生オフ" : "ループ再生オン"}
        >
          🔁
        </button>
        <button
          class="compare-btn display"
          class:active={compareAgentDisplayMode === "emoji"}
          onclick={toggleCompareAgentDisplayMode}
          title={compareAgentDisplayMode === "emoji" ? "絵文字モード（クリックで切替）" : "Circleモード（クリックで切替）"}
        >
          {compareAgentDisplayMode === "emoji" ? "🚒" : "⬤"}
        </button>
        <button
          class="compare-btn camera-sync"
          class:active={compareCameraSync}
          onclick={toggleCompareCameraSync}
          title={compareCameraSync ? "カメラ同期オン" : "カメラ同期オフ"}
        >
          {compareCameraSync ? "🔗" : "⛓"}
        </button>
        <span class="compare-step">{compareStep} / {compareMaxStep}</span>
        <input
          type="range"
          min="0"
          max={compareMaxStep}
          value={compareStep}
          oninput={(e) => seekCompare(Number((e.target as HTMLInputElement).value))}
          disabled={compareMaxStep <= 0}
        />
        <div class="compare-speeds">
          {#each COMPARE_SPEEDS as speed}
            <button
              class="compare-btn speed"
              class:active={compareSpeed === speed}
              onclick={() => setCompareSpeed(speed)}
            >
              {speed}x
            </button>
          {/each}
        </div>
        {#if compareLoopCountdown !== null}
          <span class="loop-countdown">{compareLoopCountdown}s</span>
        {/if}
      </div>
    </div>
  {:else}
    <SimMap />

  {#if !screenshotMode && !embedMode}
    {#if !paneMode}
      <button class="pane-add-btn" onclick={enterPaneMode} title="Add simulation pane">＋</button>
    {/if}

    {#if !paneMode}
      <!-- Sliding timeline panel -->
      <div
        class="timeline-drawer"
        class:open={timelineOpen}
      >
        <TimelinePanel />
      </div>

      <!-- Toggle tab -->
      <button
        class="timeline-toggle"
        class:open={timelineOpen}
        style="left:{timelineOpen ? TIMELINE_WIDTH : 0}px"
        onclick={() => (timelineOpen = !timelineOpen)}
        title={timelineOpen ? "Close timeline" : "Open timeline"}
      >
        {timelineOpen ? "◂" : "▸"}
      </button>
    {/if}

    <div class="left-col" style="left:{leftOffset + PANEL_GAP}px">
      <ControlPanel />
      <TeamNamePanel />
      <ScorePanel />
      <ChannelFilterPanel />
    </div>
    <IdleAgentsPanel leftOffset={leftOffset + PANEL_GAP} />
    <InfoPanel />
    <CivilianStatusPanel />
  {/if}

  {#if $loading}
    <div class="loading-overlay">
      <div class="loading-box">
        <div class="spinner"></div>
        {#if $downloadProgress !== null}
          <div class="progress-wrap">
            {#if $downloadProgress < 0}
              <div class="progress-bar indeterminate"></div>
            {:else}
              <div
                class="progress-bar"
                style="width:{$downloadProgress * 100}%"
              ></div>
            {/if}
          </div>
          <span>
            {#if $downloadProgress < 0}
              Downloading…{$downloadSize !== null ? ` (${fmtBytes($downloadSize)})` : ""}
            {:else}
              Downloading… {Math.round($downloadProgress * 100)}%{$downloadSize !== null ? ` / ${fmtBytes($downloadSize)}` : ""}
            {/if}
          </span>
        {:else if $extractProgress !== null}
          <div class="progress-wrap">
            <div class="progress-bar" style="width:{$extractProgress}%"></div>
          </div>
          <span>Extracting… {$extractProgress}%</span>
        {:else if $parseProgress !== null}
          <div class="progress-wrap">
            <div
              class="progress-bar"
              style="width:{$parseProgress * 100}%"
            ></div>
          </div>
          <span>Parsing… {Math.round($parseProgress * 100)}%</span>
        {:else}
          <span>Loading…</span>
        {/if}
      </div>
    </div>
  {/if}
  {#if !screenshotMode && !embedMode && !paneMode && $mode === "file" && $maxStep > 0}
    <div class="compare-controls single-controls">
      <button class="compare-btn" onclick={() => seekSingle($currentStep - 1)} disabled={$currentStep <= 0}>⏮</button>
      <button class="compare-btn play" onclick={toggleSinglePlayback}>{singlePlaying ? "⏸" : "▶"}</button>
      <button class="compare-btn" onclick={() => seekSingle($currentStep + 1)} disabled={$currentStep >= $maxStep}>⏭</button>
      <button
        class="compare-btn loop"
        class:active={singleLoopMode}
        onclick={() => {
          singleLoopMode = !singleLoopMode;
          if (!singleLoopMode) stopSinglePlayback();
        }}
        title={singleLoopMode ? "ループ再生オフ" : "ループ再生オン"}
      >
        🔁
      </button>
      <button
        class="compare-btn display"
        class:active={$agentDisplayMode === "emoji"}
        onclick={() => agentDisplayMode.update((v) => (v === "emoji" ? "circle" : "emoji"))}
        title={$agentDisplayMode === "emoji" ? "絵文字モード（クリックで切替）" : "Circleモード（クリックで切替）"}
      >
        {$agentDisplayMode === "emoji" ? "🚒" : "⬤"}
      </button>
      <span class="compare-step">{$currentStep} / {$maxStep}</span>
      <input
        type="range"
        min="0"
        max={$maxStep}
        value={$currentStep}
        oninput={(e) => seekSingle(Number((e.target as HTMLInputElement).value))}
      />
      <div class="compare-speeds">
        {#each COMPARE_SPEEDS as speed}
          <button
            class="compare-btn speed"
            class:active={singleSpeed === speed}
            onclick={() => setSingleSpeed(speed)}
          >
            {speed}x
          </button>
        {/each}
      </div>
      {#if singleLoopCountdown !== null}
        <span class="loop-countdown">{singleLoopCountdown}s</span>
      {/if}
    </div>
  {/if}
  {/if}
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #0d1117;
  }

  .compare-app {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #0d1117;
  }

  .compare-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 1px;
    background: rgba(0, 200, 255, 0.16);
  }

  .compare-cell {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: #0d1117;
  }

  .compare-cell iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }

  .compare-label {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 3;
    max-width: calc(100% - 16px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(13, 20, 30, 0.78);
    border: 1px solid rgba(0, 200, 255, 0.22);
    color: #a8c8d8;
    font-size: 11px;
    font-family: monospace;
    pointer-events: none;
  }

  .compare-controls {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(13, 20, 30, 0.98);
    border-top: 1px solid rgba(0, 200, 255, 0.2);
    color: #c8d8e8;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .compare-controls input[type="range"] {
    flex: 1;
    min-width: 160px;
  }

  .compare-btn {
    border: 1px solid rgba(0, 200, 255, 0.3);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: #a8c8d8;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
    flex: 0 0 auto;
  }

  .compare-btn:hover:not(:disabled) {
    background: rgba(0, 180, 255, 0.15);
    color: #00c8ff;
  }

  .compare-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .compare-btn.play {
    min-width: 40px;
    color: #00c8ff;
    background: rgba(0, 180, 255, 0.12);
  }

  .compare-btn.add {
    color: #00c8ff;
    border-color: rgba(0, 200, 255, 0.55);
    background: rgba(0, 180, 255, 0.14);
    font-size: 15px;
    line-height: 1;
  }

  .compare-btn.speed {
    font-size: 10px;
    padding: 4px 6px;
  }

  .compare-btn.speed.active {
    color: #00c8ff;
    border-color: rgba(0, 200, 255, 0.7);
    background: rgba(0, 200, 255, 0.08);
  }

  .compare-btn.loop.active,
  .compare-btn.display.active {
    color: #00c8ff;
    border-color: rgba(0, 200, 255, 0.65);
    background: rgba(0, 200, 255, 0.1);
  }

  .compare-step {
    min-width: 92px;
    flex: 0 0 auto;
    color: #a8c8d8;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .compare-speeds {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }

  .single-controls {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 24;
  }

  .single-controls .loop-countdown {
    min-width: 38px;
    color: #607080;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .pane-add-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 30;
    width: 34px;
    height: 34px;
    border-radius: 6px;
    border: 1px solid rgba(0, 200, 255, 0.45);
    background: rgba(13, 20, 30, 0.86);
    color: #00c8ff;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    box-shadow: 0 0 18px rgba(0, 180, 255, 0.18);
  }

  .pane-add-btn:hover {
    background: rgba(0, 180, 255, 0.2);
    border-color: rgba(0, 220, 255, 0.7);
  }

  .timeline-drawer {
    position: absolute;
    top: 0;
    left: 0;
    width: 300px;
    height: 100%;
    background: rgba(10, 16, 24, 0.96);
    border-right: 1px solid rgba(0, 200, 255, 0.18);
    backdrop-filter: blur(8px);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
    z-index: 20;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow: hidden;
  }

  .timeline-drawer.open {
    transform: translateX(0);
  }

  .timeline-toggle {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 21;
    width: 20px;
    height: 52px;
    background: rgba(0, 180, 255, 0.18);
    border: 1px solid rgba(0, 200, 255, 0.55);
    border-left: none;
    border-radius: 0 6px 6px 0;
    color: #00e0ff;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      left 0.25s ease,
      background 0.12s,
      box-shadow 0.12s;
    box-shadow: 2px 0 10px rgba(0, 180, 255, 0.3);
  }

  .timeline-toggle:hover {
    background: rgba(0, 200, 255, 0.32);
    box-shadow: 2px 0 14px rgba(0, 200, 255, 0.5);
  }

  .left-col {
    position: absolute;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 10;
    transition: left 0.25s ease;
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
    0% {
      transform: translateX(-150%);
    }
    100% {
      transform: translateX(350%);
    }
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
