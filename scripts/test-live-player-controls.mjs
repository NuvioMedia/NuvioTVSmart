import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import {
  LiveDurationGrowth,
  isLivePlayback,
  nextLiveDurationGrowth,
  LivePlaybackWatchClock
} from "../js/ui/screens/player/livePlaybackUi.js";

test("Android live policy: channel or runtime evidence, never URL, tv, stream or unknown duration", () => {
  for (const itemType of ["movie", "series", "tv", "stream", "live", ""]) {
    assert.equal(
      isLivePlayback(
        { params: { itemType }, hasPresentedPlaybackFrame: true },
        { video: { duration: NaN, src: "live.m3u8" } }
      ),
      false
    );
  }
  assert.equal(isLivePlayback({ params: { itemType: "CHANNEL" } }, {}), true);
  for (const controller of [
    { hlsInstance: { latestLevelDetails: { live: true } } },
    { dashInstance: { isDynamic: () => true } },
    { video: { duration: Infinity } },
    {
      isUsingAvPlay: () => true,
      avplayReady: true,
      getAvPlay: () => ({
        getStreamingProperty: (property) => {
          assert.equal(property, "IS_LIVE");
          return "TRUE";
        }
      })
    }
  ]) {
    const screen = { params: { itemType: "movie" }, hasPresentedPlaybackFrame: true };
    assert.equal(isLivePlayback(screen, controller), true);
    assert.equal(
      isLivePlayback(screen, {}),
      true,
      "live remains latched when metadata temporarily regresses"
    );
    assert.equal(
      isLivePlayback({ params: {}, hasPresentedPlaybackFrame: false }, controller),
      false,
      "ignore previous route metadata"
    );
  }
  assert.equal(
    isLivePlayback(
      { params: {}, hasPresentedPlaybackFrame: true },
      {
        dashInstance: {
          isDynamic() {
            throw Error("not initialized");
          }
        }
      }
    ),
    false
  );
});

test("watch clock counts playing wall time, excludes pauses/buffering, resets for VOD", () => {
  const clock = new LivePlaybackWatchClock();
  assert.equal(clock.update(true, true, 1000), 0);
  assert.equal(clock.update(true, true, 3500), 2500);
  assert.equal(clock.update(true, false, 4000), 3000);
  assert.equal(clock.update(true, false, 14000), 3000);
  assert.equal(clock.update(true, true, 14000), 3000);
  assert.equal(clock.update(true, true, 16000), 5000);
  assert.equal(clock.update(false, true, 17000), 0);
  assert.equal(clock.update(true, true, 20000), 0);
  assert.equal(clock.update(true, true, 19000), 0, "never count negative time");
});

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods29 } =
  await import("../js/ui/screens/player/playerScreenMethods-29-sync-post-play-player-surface.js");
const { createPlayerScreenMethods31 } =
  await import("../js/ui/screens/player/playerScreenMethods-31-seek-playback-seconds.js");
const { createPlayerScreenMethods32 } =
  await import("../js/ui/screens/player/playerScreenMethods-32-update-ui-tick.js");
const { createPlayerScreenMethods69 } =
  await import("../js/ui/screens/player/playerScreenMethods-69-sync-pointer-focus.js");
const { createPlayerScreenMethods71 } =
  await import("../js/ui/screens/player/playerScreenMethods-71-on-key-down.js");

function node() {
  const classes = new Set();
  return {
    textContent: "",
    style: {},
    setAttribute() {},
    classList: {
      toggle(name, enabled) {
        enabled ? classes.add(name) : classes.delete(name);
      },
      contains: (name) => classes.has(name)
    }
  };
}
function screen(itemType = "channel") {
  const result = {
    ...createPlayerScreenMethods29(),
    ...createPlayerScreenMethods31(),
    ...createPlayerScreenMethods32(),
    ...createPlayerScreenMethods69(),
    ...createPlayerScreenMethods71(),
    params: { itemType },
    liveWatchClock: new LivePlaybackWatchClock(),
    controlsVisible: true,
    controlFocusZone: "buttons",
    hasPresentedPlaybackFrame: true,
    uiRefs: {
      timeLabel: node(),
      progressShell: node(),
      progressFill: node(),
      endsAt: node(),
      clock: node(),
      seekOverlay: node(),
      seekDirection: node(),
      seekPreview: node(),
      seekFill: node()
    },
    getPlaybackCurrentSeconds: () => 90,
    getPlaybackDisplayCurrentSeconds: () => 90,
    getPlaybackDisplayDurationSeconds: () => 120,
    getPlaybackDurationSeconds: () => 120,
    getPlaybackSpeed: () => 1,
    isBufferingForPauseOverlay: () => false,
    isExternalFrameMode: () => false,
    focusFirstControl() {
      this.controlFocusZone = "buttons";
      this.focused = true;
    }
  };
  for (const method of [
    "ensureNextEpisodeStreamsPrefetch",
    "shouldShowNextEpisodeCard",
    "refreshLoadingOverlayProgress",
    "updateActiveSkipInterval",
    "updateSkipIntroCountdown",
    "evaluatePostPlayRecommendation",
    "syncSkipIntroButtonProgress",
    "renderSkipIntroButton",
    "syncPlayerOverlayLayoutState",
    "renderBitmapSubtitleAtCurrentTime",
    "maybeAutoplayNextEpisode",
    "syncPauseOverlayState",
    "renderNextEpisodeCard"
  ])
    result[method] = () => {};
  return result;
}
Object.assign(PlayerController, {
  isPlaying: true,
  video: { duration: 120 },
  hlsInstance: null,
  dashInstance: null,
  isUsingAvPlay: () => false
});

test("live UI hides progress/end time, repairs focus, and shows watched time rather than window position", () => {
  const s = screen();
  s.liveWatchClock.update = (live, playing) => {
    assert.equal(live, true);
    assert.equal(playing, true);
    return 34000;
  };
  s.controlFocusZone = "progress";
  s.updateUiTick();
  assert.equal(s.uiRefs.timeLabel.textContent, "LIVE  0:34");
  assert.equal(s.uiRefs.progressShell.classList.contains("hidden"), true);
  assert.equal(s.uiRefs.endsAt.classList.contains("hidden"), true);
  assert.equal(s.controlFocusZone, "buttons");
  assert.equal(s.isSeekBarAvailable(), false);
  assert.equal(s.seekPlaybackSeconds(60), false);
  assert.equal(s.seekProgressFromPointer({}, {}), false);
  s.beginSeekPreview(1);
  assert.equal(s.seekPreviewSeconds, undefined);
  s.seekOverlayVisible = true;
  s.controlsVisible = false;
  s.renderSeekOverlay();
  assert.equal(s.uiRefs.seekOverlay.classList.contains("hidden"), true);
});

test("VOD retains seek bar and position/duration, including HLS and tv series", () => {
  for (const type of ["movie", "tv", "series"]) {
    const s = screen(type);
    s.updateUiTick();
    assert.equal(s.uiRefs.timeLabel.textContent, "1:30 / 2:00");
    assert.equal(s.uiRefs.progressShell.classList.contains("hidden"), false);
    assert.equal(s.isSeekBarAvailable(), true);
  }
});

const { createPlayerScreenMethods20 } =
  await import("../js/ui/screens/player/playerScreenMethods-20-sync-native-paused-state-for-pause-overlay.js");
test("pause overlay suppresses its clock only for live, preserves title and cast", () => {
  for (const type of ["channel", "movie"]) {
    const s = screen(type);
    Object.assign(s, createPlayerScreenMethods20(), {
      isBufferingForPauseOverlay: () => false,
      pauseOverlayVisible: true,
      pauseOverlayMeta: { title: "A title", cast: [{ name: "A cast member" }] }
    });
    s.uiRefs.pauseOverlay = node();
    s.renderPauseOverlay();
    assert.equal(
      s.uiRefs.pauseOverlay.innerHTML.includes("player-pause-overlay-clock"),
      type === "movie"
    );
    assert.ok(s.uiRefs.pauseOverlay.innerHTML.includes("A title"));
    assert.ok(s.uiRefs.pauseOverlay.innerHTML.includes("A cast member"));
  }
});

test("remote Up bypasses absent live bar; VOD still focuses progress", async () => {
  globalThis.document = { activeElement: null };
  for (const type of ["channel", "movie"]) {
    const s = screen(type);
    Object.assign(s, {
      isStartupErrorVisible: () => false,
      isPostPlayVisible: () => false,
      resolveMediaAction: () => null,
      isSkipIntroButtonFocusable: () => false,
      isNextEpisodeCardFocusable: () => false,
      focusSkipIntroButton: () => false,
      isNextEpisodeCardVisible: () => false,
      focusProgressBar() {
        this.controlFocusZone = "progress";
      },
      setControlsVisible(visible) {
        this.controlsVisible = visible;
      }
    });
    await s.onKeyDown({ keyCode: 38 });
    assert.equal(s.controlsVisible, type !== "channel");
    assert.equal(s.controlFocusZone, type === "channel" ? "buttons" : "progress");
  }
});

const { createPlayerScreenMethods28 } =
  await import("../js/ui/screens/player/playerScreenMethods-28-unbind-video-events.js");
test("control row shows available audio/subtitles and reports the actual play/pause action", () => {
  const s = {
    ...createPlayerScreenMethods28(),
    getPlaybackControlPaused: () => false,
    getPlayerUiState: () => ({}),
    resolveNextEpisodeInfo: () => null,
    hasSubtitleTracksAvailable: () => false,
    hasAudioTracksAvailable: () => false
  };
  assert.deepEqual(
    s.getControlDefinitions().map((c) => c.action),
    ["playPause", "source", "more"]
  );
  assert.equal(s.getControlDefinitions()[0].title, "Pause");
  s.hasSubtitleTracksAvailable = () => true;
  s.hasAudioTracksAvailable = () => true;
  assert.deepEqual(
    s.getControlDefinitions().map((c) => c.action),
    ["playPause", "subtitleDialog", "audioTrack", "source", "more"]
  );
  s.getPlaybackControlPaused = () => true;
  assert.equal(s.getControlDefinitions()[0].title, "Play");
});

const { createPlayerScreenMethods68 } =
  await import("../js/ui/screens/player/playerScreenMethods-68-load-subtitles.js");
test("More opens the first supported extra action and closes onto Play/Pause", () => {
  for (const speeds of [[1], [1, 2]]) {
    const s = {
      ...createPlayerScreenMethods28(),
      ...createPlayerScreenMethods68(),
      getPlaybackControlPaused: () => false,
      getPlayerUiState: () => ({}),
      resolveNextEpisodeInfo: () => null,
      hasSubtitleTracksAvailable: () => false,
      hasAudioTracksAvailable: () => false,
      getPlaybackSpeed: () => 1,
      getPlaybackSpeedOptions: () => speeds,
      renderControlButtons() {}
    };
    s.performControlAction("more");
    assert.equal(
      s.getControlDefinitions()[s.controlFocusIndex].action,
      speeds.length > 1 ? "speed" : "aspect"
    );
    s.performControlAction("backFromMore");
    assert.equal(s.getControlDefinitions()[s.controlFocusIndex].action, "playPause");
  }
});

const { createPlayerScreenMethods36 } =
  await import("../js/ui/screens/player/playerScreenMethods-36-reset-playback-engine-validation.js");
test("HTTP 416 retries the current source from the start once, clearing resume", () => {
  const previousEngine = PlayerController.playbackEngine;
  PlayerController.playbackEngine = "hls.js";
  const calls = [];
  const source = { id: "src", url: "https://live.example/master.m3u8" };
  const s = {
    ...createPlayerScreenMethods36(),
    activePlaybackUrl: source.url,
    hasRetriedCurrentStreamAfter416: false,
    pendingPlaybackRestore: { timeSeconds: 1800 },
    lastPlaybackErrorAt: Date.now(),
    loadingVisible: false,
    paused: true,
    sourcesError: "old",
    updateLoadingVisibility() {},
    getStreamCandidateByUrl: (url) => (url === source.url ? source : null),
    getCurrentStreamCandidate: () => source,
    playStreamByUrl(url, options) {
      calls.push({ url, options });
    }
  };
  try {
    assert.equal(s.retryCurrentStreamFromStartAfter416(), true);
    assert.equal(
      s.pendingPlaybackRestore,
      null,
      "the stale resume position must not survive the restart"
    );
    assert.equal(s.hasRetriedCurrentStreamAfter416, true);
    assert.equal(s.loadingVisible, true);
    assert.equal(s.lastPlaybackErrorAt, 0);
    assert.deepEqual(
      calls.map((call) => call.url),
      [source.url]
    );
    assert.equal(calls[0].options.forceEngine, "hls.js");
    assert.equal(calls[0].options.preservePendingRestore, undefined);
    assert.equal(calls[0].options.preservePlaybackState, undefined);
    assert.equal(
      s.retryCurrentStreamFromStartAfter416(),
      false,
      "only one full-restart retry is allowed"
    );
    assert.equal(calls.length, 1);
  } finally {
    PlayerController.playbackEngine = previousEngine;
  }
});

async function loadVideoErrorHandlers(internals) {
  const source = await readFile(
    new URL("../js/ui/screens/player/playerVideoEventHandlers.js", import.meta.url),
    "utf8"
  );
  const context = vm.createContext({ internals, console });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.createVideoEventHandlers = createPlayerVideoEventHandlers;",
    context
  );
  return context.createVideoEventHandlers;
}

test("HTTP 416 reaches the one-shot restart before any engine failover", async () => {
  const retries = [];
  const createVideoEventHandlers = await loadVideoErrorHandlers({
    PlayerController: { getLastHlsErrorDiagnostic: () => ({ fatal: true, responseCode: 416 }) },
    isExpiredStreamUrl: () => false,
    isTerminalHlsHttpStatus: () => false,
    logEngineFsDebug() {},
    claimEngineFsPlayback() {}
  });
  const screen = {
    isStartupErrorVisible: () => false,
    getPlaybackEventErrorDetail: () => "HTTP 416",
    getStreamCandidateByUrl: () => ({}),
    getCurrentStreamCandidate: () => ({}),
    tryServerPlaybackFallback: () => false,
    activePlaybackUrl: "https://live.example/master.m3u8",
    currentEngineFsStream: null,
    hasPresentedPlaybackFrame: false,
    retryCurrentStreamFromStartAfter416() {
      retries.push("416");
      return true;
    }
  };
  const { onError } = createVideoEventHandlers.call(screen, {}, false);

  // The native video error event can arrive without a detail payload; the
  // cached hls.js diagnostic still identifies the 416.
  await onError({ detail: { mediaErrorCode: 2 } });
  assert.deepEqual(retries, ["416"]);
});

const { createPlayerScreenMethods15 } =
  await import("../js/ui/screens/player/playerScreenMethods-15-apply-manifest-track-selection.js");
test("initial live markup never flashes a VOD bar, end time or removed source line", () => {
  let root;
  globalThis.document = { createElement: () => (root = {}) };
  const s = {
    ...createPlayerScreenMethods15(),
    isExternalFrameMode: () => false,
    isLivePlayback: () => true,
    container: { querySelector: () => null, appendChild() {} },
    getPlayerHeaderData: () => ({ title: "Rai 1" }),
    getLoadingOverlayMeta: () => ({ title: "Rai 1" })
  };
  for (const method of [
    "cachePlayerUiRefs",
    "syncPlayerOverlayLayoutState",
    "bindLoadingLogoFallback",
    "renderControlButtons",
    "renderSubtitleDialog",
    "renderSubtitleDelayOverlay",
    "renderSubtitleTimingDialog",
    "renderAudioDialog",
    "renderSpeedDialog",
    "renderSourcesPanel",
    "renderParentalGuideOverlay",
    "renderSkipIntroButton",
    "renderSeekOverlay",
    "renderPauseOverlay",
    "renderNextEpisodeCard"
  ])
    s[method] = () => {};
  s.renderPlayerUi();
  assert.match(
    root.innerHTML,
    /id="playerProgressShell" class="player-progress-shell focusable hidden"/
  );
  assert.match(root.innerHTML, /id="playerEndsAt" class="player-ends-at hidden"/);
  assert.match(root.innerHTML, /LIVE  0:00/);
  assert.ok(!root.innerHTML.includes("playerStreamSource"));
});

test("AVPlay live signal accepts native 1/0 and skips unavailable or busy native state", () => {
  for (const value of ["1", "0", "true", "false"]) {
    const controller = {
      isUsingAvPlay: () => true,
      avplayReady: true,
      getAvPlay: () => ({ getStreamingProperty: () => value })
    };
    assert.equal(
      isLivePlayback({ params: {}, hasPresentedPlaybackFrame: true }, controller),
      ["1", "true"].includes(value)
    );
  }
  for (const state of [{ avplayReady: false }, { avplayReady: true, avplaySeekInFlight: true }]) {
    assert.equal(
      isLivePlayback(
        { params: {}, hasPresentedPlaybackFrame: true },
        {
          ...state,
          isUsingAvPlay: () => true,
          getAvPlay() {
            assert.fail("native API unavailable");
          }
        }
      ),
      false
    );
  }
});

test("Android live progress guard: growing native duration marks live and live playback never saves resume", async () => {
  assert.equal(nextLiveDurationGrowth(new LiveDurationGrowth(), "a", 1_320_000, true).grew, false);
  const growing = nextLiveDurationGrowth(new LiveDurationGrowth(), "a", 8_000, true);
  nextLiveDurationGrowth(growing, "a", 18_000, true);
  nextLiveDurationGrowth(growing, "a", 32_000, true);
  assert.equal(growing.grew, true, "a live duration that grows past 10s is live");

  const skippedReadings = nextLiveDurationGrowth(new LiveDurationGrowth(), "a", 1_200_000, false);
  nextLiveDurationGrowth(skippedReadings, "a", 2_700_000, true);
  assert.equal(skippedReadings.grew, false, "readings from the previous media are ignored");
  assert.equal(
    nextLiveDurationGrowth(growing, "b", 2_700_000, true).grew,
    false,
    "a new media resets the growth"
  );

  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const { createPlayerControllerMethods20 } =
    await import("../js/core/player/playerControllerMethods-20-flush-progress.js");
  const { createPlayerControllerMethods17 } =
    await import("../js/core/player/playerControllerMethods-17-save-progress-if-needed.js");
  const { createPlayerControllerMethods19 } =
    await import("../js/core/player/playerControllerMethods-19-pause.js");
  assert.equal(
    await createPlayerControllerMethods20().flushProgress.call(
      { currentPlaybackIsLive: true },
      10_000,
      20_000
    ),
    false
  );
  assert.equal(
    createPlayerControllerMethods17().saveProgressIfNeeded.call({
      currentPlaybackIsLive: true,
      playbackSessionActive: true,
      isPlaying: true
    }),
    false
  );
  assert.equal(
    await createPlayerControllerMethods19().flushCurrentProgress.call({
      currentPlaybackIsLive: true
    }),
    false
  );
});

async function loadManifestTrackMethods(playerController, fetchStub) {
  const source = await readFile(
    new URL(
      "../js/ui/screens/player/playerScreenMethods-14-load-manifest-track-data-for-current-stream.js",
      import.meta.url
    ),
    "utf8"
  );
  const context = vm.createContext({
    internals: {
      PlayerController: playerController,
      Environment: { isWebOS: () => false },
      uniqueNonEmptyValues: (values) => [...new Set((values || []).filter(Boolean))]
    },
    AbortController,
    fetch: fetchStub,
    console
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.methods = createPlayerScreenMethods14();",
    context
  );
  return context.methods;
}

test("adaptive engine owns the manifest: the track probe does not issue a second request", async () => {
  let fetchCount = 0;
  const methods = await loadManifestTrackMethods({ hlsInstance: {}, video: null }, () => {
    fetchCount += 1;
    throw new Error("the probe must not run while hls.js owns the manifest");
  });
  const screen = {
    activePlaybackUrl: "https://live.example/master.m3u8",
    manifestAudioTracks: ["stale"],
    manifestSubtitleTracks: [],
    manifestVariants: [],
    manifestLoadToken: 0,
    manifestLoading: false,
    getCurrentStreamCandidate: () => ({ url: "https://live.example/master.m3u8" }),
    getCurrentStreamRequestHeaders: () => ({}),
    refreshTrackDialogs() {},
    parseManifestTracks: () => ({ audioTracks: [], subtitleTracks: [], variants: [] })
  };
  await methods.loadManifestTrackDataForCurrentStream.call(screen, screen.activePlaybackUrl);
  assert.equal(fetchCount, 0);
  assert.equal(screen.manifestLoading, false);
  assert.equal(screen.manifestAudioTracks.length, 0);
});

test("live progress bar is really hidden and playlist 5xx retries match Android", async () => {
  const css = await readFile(new URL("../css/components-35.css", import.meta.url), "utf8");
  assert.match(css, /\.player-progress-shell\.hidden\s*\{\s*display:\s*none;/);
  const retry = PlayerController.buildHlsConfig({}).playlistLoadPolicy.default.errorRetry;
  assert.equal(retry.maxNumRetry, 12);
  assert.equal(retry.maxRetryDelayMs, 5000);
});
