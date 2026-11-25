import test from "node:test";
import assert from "node:assert/strict";

import {
  isSourceFallbackActive,
  nextSourceFallbackCandidate,
  sourceFallbackKey
} from "../js/core/player/sourceFallback.js";

const HASH = "0123456789abcdef0123456789abcdef01234567";
const settings = {
  streamAutoPlayMode: "FIRST_STREAM",
  streamAutoPlaySource: "ALL_SOURCES",
  streamAutoPlayRegex: "",
  streamAutoPlaySelectedAddons: [],
  streamAutoPlaySelectedPlugins: [],
  streamAutoPlayFallbackOnFailure: true,
  streamAutoPlayFallbackMaxSources: 3,
  streamAutoPlayFallbackStartupTimeoutSeconds: 15
};
const stream = ({
  name = "Source",
  url = null,
  infoHash = null,
  addonName = "Addon",
  debridResolved = false
} = {}) => ({
  id: `${addonName}:${name}:${url || infoHash}`,
  name,
  url,
  infoHash,
  addonName,
  debridResolved
});
const candidates = [1, 2, 3, 4, 5].map((index) =>
  stream({ name: `Source ${index}`, url: `https://example.com/source-${index}.mkv` })
);
const next = ({
  streams = candidates,
  triedKeys = new Set(),
  failedInfoHash = "",
  currentSettings = settings
} = {}) =>
  nextSourceFallbackCandidate({
    streams,
    settings: currentSettings,
    installedAddonNames: new Set(["Addon"]),
    triedKeys,
    failedAddonName: "Addon",
    failedInfoHash
  });

test("a resolved debrid copy has the same key as the torrent", () => {
  const torrent = stream({ infoHash: "ABC" });
  const resolved = stream({
    url: "https://cdn.example.com/dld/file?token=1",
    infoHash: "abc",
    debridResolved: true
  });
  assert.equal(sourceFallbackKey(torrent), sourceFallbackKey(resolved));
});

test("different links have different keys", () => {
  assert.notEqual(
    sourceFallbackKey(stream({ url: "https://example.com/a.mkv" })),
    sourceFallbackKey(stream({ url: "https://example.com/b.mkv" }))
  );
});

test("fallback applies only with auto selection turned on", () => {
  assert.equal(isSourceFallbackActive(settings), true);
  assert.equal(isSourceFallbackActive({ ...settings, streamAutoPlayMode: "MANUAL" }), false);
  assert.equal(
    isSourceFallbackActive({ ...settings, streamAutoPlayFallbackOnFailure: false }),
    false
  );
});

test("the next candidate is the first match not tried yet", () => {
  assert.equal(next({ triedKeys: new Set([sourceFallbackKey(candidates[0])]) }), candidates[1]);
});

test("other copies of the failed torrent are skipped", () => {
  const sameTorrent = stream({ name: "Same", url: "https://example.com/same.mkv", infoHash: HASH });
  assert.equal(
    next({ streams: [sameTorrent, candidates[0]], failedInfoHash: HASH }),
    candidates[0]
  );
});

test("no candidate when every source was tried", () => {
  assert.equal(next({ triedKeys: new Set(candidates.map(sourceFallbackKey)) }), null);
});

test("regex mode only falls back to matching sources", () => {
  const regexSettings = {
    ...settings,
    streamAutoPlayMode: "REGEX_MATCH",
    streamAutoPlayRegex: "Source 3"
  };
  assert.equal(next({ currentSettings: regexSettings }), candidates[2]);
});

function installPlayerScreenGlobals() {
  const storage = new Map();
  globalThis.localStorage = globalThis.localStorage || {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.window = globalThis.window || {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: "" },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    history: { state: null },
    setTimeout,
    clearTimeout
  };
  const container = {
    style: { display: "" },
    classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null
  };
  globalThis.document = globalThis.document || {
    hidden: false,
    getElementById: () => container,
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {} },
      addEventListener() {}
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { style: {} },
    body: {}
  };
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node" },
      configurable: true
    });
  }
  return container;
}

installPlayerScreenGlobals();

const { PlayerSettingsStore } = await import("../js/data/local/playerSettingsStore.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { addonRepository } = await import("../js/data/repository/addonRepository.js");
const { createPlayerScreenMethods01 } =
  await import("../js/ui/screens/player/playerScreenMethods-01-mount.js");
const { createPlayerScreenMethods34 } =
  await import("../js/ui/screens/player/playerScreenMethods-34-play-stream-by-url.js");
const { createPlayerScreenMethods35 } =
  await import("../js/ui/screens/player/playerScreenMethods-35-play-stream-candidate.js");
const { createPlayerScreenMethods73 } =
  await import("../js/ui/screens/player/playerScreenMethods-73-cleanup.js");

function createTestPlayerScreen({ streamCandidates = [], autoPlayNav = true } = {}) {
  const firstCandidate = streamCandidates[0] || null;
  const startedUrls = [];
  const startupErrors = [];
  const screen = {
    ...createPlayerScreenMethods01(),
    ...createPlayerScreenMethods34(),
    ...createPlayerScreenMethods35(),
    ...createPlayerScreenMethods73(),
    params: {
      itemId: "tt1234567",
      itemType: "movie",
      autoPlayNav,
      streamCandidates
    },
    playerMountToken: 1,
    streamCandidates: streamCandidates.map((entry) => ({ ...entry })),
    currentStreamIndex: 0,
    activePlaybackUrl: null,
    autoSelectedSourceKey: autoPlayNav && firstCandidate ? sourceFallbackKey(firstCandidate) : null,
    sourceFallbackAttempts: 0,
    sourceFallbackTriedKeys: new Set(),
    sourceFallbackInFlight: false,
    sourceFallbackExhausted: false,
    sourceStartupTimeoutTimer: null,
    aspectToastTimer: null,
    silentAudioFallbackAttempts: new Set(),
    silentAudioFallbackCount: 0,
    hasPresentedPlaybackFrame: false,
    loadingVisible: true,
    paused: false,
    completedSourceRequestKey: "req-1",
    startedUrls,
    startupErrors,
    getSourceRequestKey: () => "req-1",
    isActiveMountToken(token = null) {
      return token == null || token === this.playerMountToken;
    },
    isExternalFrameMode: () => false,
    isLivePlayback: () => false,
    isStartupErrorVisible() {
      return this.startupErrors.length > 0;
    },
    getCurrentStreamCandidate() {
      return this.streamCandidates[this.currentStreamIndex] || null;
    },
    getStreamCandidateByUrl(url) {
      return this.streamCandidates.find((entry) => entry.url === url) || null;
    },
    normalizeStreamCandidates: (list) => list.map((entry) => ({ ...entry })),
    selectBestStreamCandidate: (list) => list[0] || null,
    getPlaybackSourceContext: () => null,
    normalizePlaybackSourceContext: () => null,
    rememberSelectedStreamPreference() {},
    getTrackPreferenceContentId: () => "tt1234567",
    getSubtitleDelayPreferenceVideoId: () => "tt1234567",
    shouldPreserveWebOsTrackSelections: () => false,
    getEngineFsStateForStream: () => null,
    isCurrentSourceLikelyMkv: () => false,
    isCurrentSourceLikelyHls: () => false,
    isSameEngineFsState: () => true,
    resetPlaybackEngineValidation() {},
    clearStartupError() {},
    updateLoadingVisibility() {},
    clearBufferingSpinnerTimer() {},
    enableStartupAudioGate() {},
    releaseStartupAudioGate() {},
    cancelSeekPreview() {},
    getPlaybackCurrentSeconds: () => 0,
    markPlaybackProgress() {},
    clearPlaybackStallGuard() {},
    clearSubtitleCueStyleBindings() {},
    clearEmbeddedSubtitleCueRefreshTimers() {},
    clearMountedExternalSubtitleTracks() {},
    closeSourcesPanel() {},
    clearSubtitleDelayOverlayTimer() {},
    resetSubtitleAutoSyncState() {},
    resetAutomaticSubtitleSyncState() {},
    clearStartupAudioPreferenceRetry() {},
    clearBitmapSubtitleOverlay() {},
    destroyAssSubtitleRenderer() {},
    clearTrackDiscoveryTimer() {},
    stopEngineFsKeepAlive() {},
    prefetchTizenEmbeddedAudioTracks() {},
    fetchSkipIntervals: () => Promise.resolve(),
    fetchParentalGuide: () => Promise.resolve(),
    hydratePauseOverlayMeta: () => Promise.resolve(),
    loadPostPlayEpisodeMetadata: () => Promise.resolve(),
    buildPauseOverlayMeta: () => ({}),
    buildPlaybackContext: () => ({ requestHeaders: {} }),
    startPlayerControllerPlayback(url) {
      startedUrls.push(url);
      return Promise.resolve();
    },
    loadSubtitles() {},
    startTrackDiscoveryWindow() {},
    loadEmbeddedSubtitleTracks: () => Promise.resolve(),
    waitForInitialEmbeddedTrackBootstrap: () => Promise.resolve(),
    updateModalBackdrop() {},
    renderSubtitleDialog() {},
    renderAudioDialog() {},
    renderSpeedDialog() {},
    loadManifestTrackDataForCurrentStream() {},
    refreshTrackDialogs() {},
    updateUiTick() {},
    setControlsVisible() {},
    schedulePlaybackStallGuard() {},
    renderPlayerUi() {},
    bindPlayerExitCleanup() {},
    unbindPlayerExitCleanup() {},
    bindParty() {},
    unbindParty() {},
    leavePartyPlayback() {},
    loadPartyProfile() {},
    bindVideoEvents() {},
    unbindVideoEvents() {},
    bindMediaSessionHandlers() {},
    clearMediaSessionHandlers() {},
    applyAudioAmplification() {},
    applySubtitlePresentationSettings() {},
    renderEpisodePanel() {},
    applyAspectMode() {},
    syncTrackState() {},
    startSkipIntervalCheckTimer() {},
    stopSkipIntervalCheckTimer() {},
    closeStreamInfo() {},
    cancelSourceLoad() {},
    cancelTizenAvPlayConnectionRetryBudgetReset() {},
    resetNextEpisodeLaunchPresentation() {},
    resetStillWatchingPromptState() {},
    clearPostPlayFocusTimer() {},
    clearPostPlayLongPressTimer() {},
    clearPostPlaySynopsisScrollAnimation() {},
    cancelPostPlayPlayerSurfaceAnimation() {},
    stopPostPlayTrailer() {},
    clearPostPlaySummaryTransition() {},
    onPostPlayRecommendationStateChange() {},
    startPostPlayTrailer() {},
    stopSeekLoadingWatchdog() {},
    dismissPauseOverlay() {},
    clearWebOsEmbeddedTextSubtitleOverlay() {},
    clearHtmlSubtitleOverlay() {},
    cancelScheduledSourcesPanelRender() {},
    stopLoadingLogoFillAnimation() {},
    clearControlsAutoHide() {},
    stopSkipIntroCountdownAnimation() {},
    stopParentalGuideLineAnimation() {},
    releaseCurrentEngineFsStreamBestEffort() {},
    refreshLoadingOverlayPresentation() {},
    showStartupError(message) {
      startupErrors.push(message);
    }
  };
  return screen;
}

test("playStreamByUrl arms scheduleSourceStartupTimeout against the new activePlaybackUrl and falls back on timeout", async (t) => {
  const originalSettingsGet = PlayerSettingsStore.get;
  const originalGetInstalledAddons = addonRepository.getInstalledAddons;
  PlayerSettingsStore.get = () => ({ ...settings });
  addonRepository.getInstalledAddons = async () => [{ displayName: "Addon" }];
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const twoCandidates = [
    stream({ name: "Source 1", url: "https://example.com/source-1.mkv" }),
    stream({ name: "Source 2", url: "https://example.com/source-2.mkv" })
  ];
  const screen = createTestPlayerScreen({ streamCandidates: twoCandidates, autoPlayNav: true });
  // Simulate transitioning from a prior/stale URL before playStreamByUrl sets the new candidate URL.
  screen.activePlaybackUrl = "https://example.com/previous.mkv";

  try {
    await screen.playStreamByUrl(twoCandidates[0].url, {
      mountToken: screen.playerMountToken,
      sourceCandidate: twoCandidates[0]
    });

    assert.equal(screen.activePlaybackUrl, twoCandidates[0].url);
    assert.ok(screen.sourceStartupTimeoutTimer, "startup timeout timer should be armed");
    assert.deepEqual(screen.startedUrls, [twoCandidates[0].url]);

    t.mock.timers.tick(15000);
    // Allow async fallback resolution microtasks to settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(screen.sourceFallbackAttempts, 1);
    assert.equal(screen.activePlaybackUrl, twoCandidates[1].url);
    assert.deepEqual(screen.startedUrls, [twoCandidates[0].url, twoCandidates[1].url]);
    assert.ok(
      screen.sourceStartupTimeoutTimer,
      "next fallback candidate should re-arm startup timeout"
    );

    // Once a frame renders on the fallback stream, later timeout ticks must not fall back again.
    screen.hasPresentedPlaybackFrame = true;
    t.mock.timers.tick(15000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(screen.sourceFallbackAttempts, 1);
  } finally {
    clearTimeout(screen.sourceStartupTimeoutTimer);
    PlayerSettingsStore.get = originalSettingsGet;
    addonRepository.getInstalledAddons = originalGetInstalledAddons;
  }
});

test("mount arms scheduleSourceStartupTimeout when playing initialStreamUrl directly for auto-selected sources", async (t) => {
  const originalSettingsGet = PlayerSettingsStore.get;
  const originalPlayerStop = PlayerController.stop;
  PlayerSettingsStore.get = () => ({ ...settings });
  PlayerController.stop = () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const twoCandidates = [
    stream({ name: "Source 1", url: "https://example.com/mount-1.mkv" }),
    stream({ name: "Source 2", url: "https://example.com/mount-2.mkv" })
  ];
  const autoScreen = createTestPlayerScreen({ streamCandidates: twoCandidates, autoPlayNav: true });
  const fallbackMessages = [];
  autoScreen.tryFallbackToNextSourceAfterError = (message) => {
    fallbackMessages.push(message);
    return true;
  };

  try {
    await autoScreen.mount({
      streamUrl: twoCandidates[0].url,
      streamCandidates: twoCandidates,
      preferredStreamId: twoCandidates[0].id,
      autoPlayNav: true,
      itemId: "tt1234567",
      itemType: "movie"
    });

    assert.equal(autoScreen.activePlaybackUrl, twoCandidates[0].url);
    assert.ok(
      autoScreen.sourceStartupTimeoutTimer,
      "mount should arm startup timeout on initialStreamUrl"
    );

    t.mock.timers.tick(15000);
    assert.equal(fallbackMessages.length, 1);
    assert.match(fallbackMessages[0], /15 seconds/);

    const manualScreen = createTestPlayerScreen({
      streamCandidates: twoCandidates,
      autoPlayNav: false
    });
    await manualScreen.mount({
      streamUrl: twoCandidates[0].url,
      streamCandidates: twoCandidates,
      preferredStreamId: twoCandidates[0].id,
      autoPlayNav: false,
      itemId: "tt1234567",
      itemType: "movie"
    });
    assert.equal(manualScreen.sourceStartupTimeoutTimer, null);

    autoScreen.cleanup();
    manualScreen.cleanup();
  } finally {
    PlayerSettingsStore.get = originalSettingsGet;
    PlayerController.stop = originalPlayerStop;
  }
});

test("cleanup always clears sourceStartupTimeoutTimer even when aspectToastTimer is null", async (t) => {
  const originalSettingsGet = PlayerSettingsStore.get;
  const originalPlayerStop = PlayerController.stop;
  PlayerSettingsStore.get = () => ({ ...settings });
  PlayerController.stop = () => {};
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const twoCandidates = [
    stream({ name: "Source 1", url: "https://example.com/cleanup-1.mkv" }),
    stream({ name: "Source 2", url: "https://example.com/cleanup-2.mkv" })
  ];
  const screen = createTestPlayerScreen({ streamCandidates: twoCandidates, autoPlayNav: true });
  let fallbackTriggered = false;
  screen.tryFallbackToNextSourceAfterError = () => {
    fallbackTriggered = true;
    return true;
  };

  try {
    await screen.playStreamByUrl(twoCandidates[0].url, {
      mountToken: screen.playerMountToken,
      sourceCandidate: twoCandidates[0]
    });
    assert.equal(screen.aspectToastTimer, null);
    assert.ok(screen.sourceStartupTimeoutTimer);
    screen.sourceFallbackInFlight = true;

    screen.cleanup();

    assert.equal(screen.sourceStartupTimeoutTimer, null);
    assert.equal(screen.sourceFallbackInFlight, false);

    t.mock.timers.tick(15000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fallbackTriggered, false);
  } finally {
    PlayerSettingsStore.get = originalSettingsGet;
    PlayerController.stop = originalPlayerStop;
  }
});

test("fallback reports the search status and the exhausted message", async () => {
  const originalSettingsGet = PlayerSettingsStore.get;
  const originalGetInstalledAddons = addonRepository.getInstalledAddons;
  PlayerSettingsStore.get = () => ({ ...settings, streamAutoPlayFallbackMaxSources: 1 });
  addonRepository.getInstalledAddons = async () => [{ displayName: "Addon" }];
  const screen = createTestPlayerScreen({
    streamCandidates: [stream({ name: "Source 1", url: "https://example.com/only.mkv" })],
    autoPlayNav: true
  });

  try {
    assert.equal(screen.tryFallbackToNextSourceAfterError("boom"), true);
    assert.equal(screen.loadingTorrentStatus, "Finding the next stream…");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(screen.sourceFallbackExhausted, true);
    assert.equal(screen.loadingTorrentStatus, "");
    assert.match(screen.startupErrors.at(-1), /No more working streams/);
  } finally {
    PlayerSettingsStore.get = originalSettingsGet;
    addonRepository.getInstalledAddons = originalGetInstalledAddons;
  }
});
