import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {}
  };
}

const badges = await import("./playerPlaybackBadges.js");
const { PlayerController } = await import("../../../core/player/playerController.js");
const { Environment } = await import("../../../platform/environment.js");
const { hdrBrightnessFactor } = await import("../../../core/player/hdrSubtitleStyle.js");
const { createPlayerScreenMethods75 } =
  await import("./playerScreenMethods-75-hdr-presentation.js");
const { createPlayerScreenMethods73 } = await import("./playerScreenMethods-73-cleanup.js");
const { createPlayerScreenMethods27 } =
  await import("./playerScreenMethods-27-bind-video-events.js");
const { initializePlayerMountState } = await import("./playerMountStateInitialization.js");

function createFakeEventTarget() {
  const listeners = new Map();
  return {
    videoWidth: 0,
    videoHeight: 0,
    readyState: 0,
    ended: false,
    paused: false,
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() {
        return "";
      }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type;
      const payload = typeof event === "string" ? { type } : event;
      for (const handler of Array.from(listeners.get(type) || [])) {
        handler(payload);
      }
    }
  };
}

function createFakeUiRoot() {
  const props = new Map();
  const classes = new Set();
  return {
    props,
    classes,
    style: {
      setProperty(k, v) {
        props.set(k, String(v));
      },
      removeProperty(k) {
        props.delete(k);
      },
      getPropertyValue(k) {
        return props.get(k) || "";
      }
    },
    classList: {
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

function createPlayerHarness({
  streamFilename = "Movie.2160p.HDR10.HEVC.mkv",
  streamUrl = "https://cdn.example.invalid/movie-hdr.mkv",
  hdrDimPlayerControls = true,
  hdrStyleEnabled = true,
  hdrBrightness = 40
} = {}) {
  const video = createFakeEventTarget();
  const uiRoot = createFakeUiRoot();
  const originals = {
    video: PlayerController.video,
    playbackEngine: PlayerController.playbackEngine,
    avplayUrl: PlayerController.avplayUrl,
    avplayActive: PlayerController.avplayActive,
    avplayReady: PlayerController.avplayReady,
    hlsInstance: PlayerController.hlsInstance,
    dashInstance: PlayerController.dashInstance,
    isUsingAvPlay: PlayerController.isUsingAvPlay,
    getAvPlay: PlayerController.getAvPlay,
    getAvPlayVideoDimensions: PlayerController.getAvPlayVideoDimensions,
    parseAvPlayExtraInfo: PlayerController.parseAvPlayExtraInfo,
    pickAvPlayExtraValue: PlayerController.pickAvPlayExtraValue,
    stop: PlayerController.stop,
    isTizen: Environment.isTizen,
    isWebOS: Environment.isWebOS
  };

  let avplayStreamInfo = [];
  let avplayDimensions = { width: 0, height: 0 };

  PlayerController.video = video;
  PlayerController.playbackEngine = "tizen-avplay";
  PlayerController.avplayUrl = streamUrl;
  PlayerController.avplayActive = false;
  PlayerController.avplayReady = false;
  PlayerController.hlsInstance = null;
  PlayerController.dashInstance = null;
  PlayerController.isUsingAvPlay = () =>
    String(PlayerController.playbackEngine || "").endsWith("avplay") &&
    Boolean(PlayerController.avplayActive);
  PlayerController.getAvPlay = () => ({
    getCurrentStreamInfo: () =>
      typeof avplayStreamInfo === "function" ? avplayStreamInfo() : avplayStreamInfo
  });
  PlayerController.getAvPlayVideoDimensions = () => avplayDimensions;
  PlayerController.parseAvPlayExtraInfo = (value) => value;
  PlayerController.pickAvPlayExtraValue = (source, keys) =>
    keys.map((key) => source?.[key]).find((value) => value !== undefined && value !== null);
  PlayerController.stop = () => {};
  Environment.isTizen = () => true;
  Environment.isWebOS = () => false;

  const eventsObserved = [];
  let applySubtitleCalls = 0;

  const screen = Object.assign(
    createPlayerScreenMethods75(),
    createPlayerScreenMethods73(),
    createPlayerScreenMethods27(),
    {
      playerMountToken: 1,
      activePlaybackUrl: streamUrl,
      currentStreamIndex: 0,
      streamCandidates: [{ id: "stream-1", url: streamUrl, filename: streamFilename }],
      manifestVariants: [],
      manifestMasterUrl: "",
      params: { filename: streamFilename },
      subtitleDialogVisible: false,
      subtitleStyleSettings: {
        hdrStyleEnabled,
        hdrTextColor: "#FFD700",
        hdrBrightness,
        hdrDimPlayerControls
      },
      videoListeners: [],
      embeddedAudioTracks: [],
      uiRefs: {
        root: uiRoot,
        htmlSubtitles: { classList: { toggle() {} } }
      },
      getCurrentStreamCandidate() {
        return this.streamCandidates[this.currentStreamIndex] || null;
      },
      isExternalFrameMode: () => false,
      isStartupErrorVisible: () => false,
      isSeekOverlaySuppressingControls: () => false,
      getPlaybackCurrentSeconds: () => 0,
      getPlaybackDurationSeconds: () => 3600,
      dismissPauseOverlay() {},
      updateLoadingVisibility() {},
      scheduleBufferingSpinnerRefresh() {},
      clearBufferingSpinnerTimer() {},
      setControlsVisible() {},
      schedulePlaybackStallGuard() {},
      clearPlaybackStallGuard() {},
      resetPlaybackEngineValidation() {},
      resetPostValidationRecoveryValidationWindow() {},
      beginPlaybackEngineValidation() {},
      completeSeekLoadingIfReady() {},
      markPlaybackProgress() {},
      refreshTrackDialogs() {},
      applyAudioAmplification() {},
      applySubtitlePresentationSettings() {
        applySubtitleCalls += 1;
        eventsObserved.push({
          event: "applySubtitlePresentationSettings",
          isHdr: this.isCurrentPlaybackHdr(),
          hasDimClass: uiRoot.classList.contains("player-hdr-dim")
        });
      },
      applyAspectMode() {},
      attemptPendingPlaybackRestore() {},
      setLoadingLogoFillTarget() {},
      markPlaybackPresentedAfterAdvance() {
        return false;
      },
      scheduleLoadingCompletionCheck() {},
      resetControlsAutoHide() {},
      maybeShowParentalGuideOverlay() {},
      updateMediaSessionPlaybackState() {},
      updateMediaSessionPositionState() {},
      loadEmbeddedSubtitleTracks() {
        return Promise.resolve();
      },
      ensureTrackDataWarmup() {},
      schedulePauseOverlay() {},
      startTrackDiscoveryWindow() {},
      attemptSilentAudioRecovery() {},
      refreshSubtitleCueStyles: () => false,
      canDiscoverEmbeddedAudioTracks: () => false,
      hasAudioTracksAvailable: () => true,
      hasSubtitleTracksAvailable: () => true,
      isWebOsEngineFsEmbeddedTrackDiscoveryPending: () => false,
      clearTrackDiscoveryTimer() {},
      renderControlButtons() {},
      updateUiTick() {
        this.syncHdrPresentation();
      },
      closeStreamInfo() {},
      stopTrackingBeforeTeardown() {},
      leavePartyPlayback() {},
      unbindParty() {},
      cancelSourceLoad() {},
      resetNextEpisodeLaunchPresentation() {},
      resetStillWatchingPromptState() {},
      cancelTizenAvPlayConnectionRetryBudgetReset() {},
      clearPostPlayFocusTimer() {},
      clearPostPlayLongPressTimer() {},
      clearPostPlaySynopsisScrollAnimation() {},
      cancelPostPlayPlayerSurfaceAnimation() {},
      stopPostPlayTrailer() {},
      onPostPlayRecommendationStateChange() {},
      startPostPlayTrailer() {},
      clearPostPlaySummaryTransition() {},
      unbindVideoEvents() {
        for (const item of this.videoListeners || []) {
          item.target.removeEventListener(item.eventName, item.handler);
        }
        this.videoListeners = [];
      },
      unbindPlayerExitCleanup() {},
      releaseCurrentEngineFsStreamBestEffort() {},
      cancelSeekPreview() {},
      clearSubtitleDelayOverlayTimer() {},
      resetSubtitleAutoSyncState() {},
      resetAutomaticSubtitleSyncState() {},
      clearStartupAudioPreferenceRetry() {},
      clearWebOsEmbeddedTextSubtitleOverlay() {},
      clearHtmlSubtitleOverlay() {},
      destroyAssSubtitleRenderer() {},
      clearBitmapSubtitleOverlay() {},
      cancelScheduledSourcesPanelRender() {},
      stopLoadingLogoFillAnimation() {},
      stopSeekLoadingWatchdog() {},
      clearSubtitleCueStyleBindings() {},
      clearEmbeddedSubtitleCueRefreshTimers() {},
      clearMountedExternalSubtitleTracks() {},
      clearControlsAutoHide() {},
      stopSkipIntroCountdownAnimation() {},
      stopSkipIntervalCheckTimer() {},
      stopParentalGuideLineAnimation() {},
      clearMediaSessionHandlers() {},
      releaseStartupAudioGate() {},
      getVideoTextTrackList: () => null,
      getVideoAudioTrackList: () => null
    }
  );

  screen.bindVideoEvents();

  return {
    screen,
    video,
    uiRoot,
    eventsObserved,
    getApplySubtitleCalls: () => applySubtitleCalls,
    setAvPlayStreamInfo: (next) => {
      avplayStreamInfo = next;
    },
    setAvPlayDimensions: (next) => {
      avplayDimensions = next;
    },
    restore() {
      screen.unbindVideoEvents();
      Object.assign(PlayerController, {
        video: originals.video,
        playbackEngine: originals.playbackEngine,
        avplayUrl: originals.avplayUrl,
        avplayActive: originals.avplayActive,
        avplayReady: originals.avplayReady,
        hlsInstance: originals.hlsInstance,
        dashInstance: originals.dashInstance,
        isUsingAvPlay: originals.isUsingAvPlay,
        getAvPlay: originals.getAvPlay,
        getAvPlayVideoDimensions: originals.getAvPlayVideoDimensions,
        parseAvPlayExtraInfo: originals.parseAvPlayExtraInfo,
        pickAvPlayExtraValue: originals.pickAvPlayExtraValue,
        stop: originals.stop
      });
      Environment.isTizen = originals.isTizen;
      Environment.isWebOS = originals.isWebOS;
    }
  };
}

function withMockedNow(initialNow, fn) {
  let currentNow = initialNow;
  const originalNow = Date.now;
  Date.now = () => currentNow;
  const advance = (ms) => {
    currentNow += ms;
  };
  try {
    return fn({ advance, getNow: () => currentNow });
  } finally {
    Date.now = originalNow;
  }
}

test("(a) early waiting before avplayReady === true does not block HDR detection on loadedmetadata/canplay/playing/avplaytrackschanged", () => {
  for (const recoveryEvent of ["loadedmetadata", "canplay", "playing", "avplaytrackschanged"]) {
    withMockedNow(10000, ({ advance }) => {
      const harness = createPlayerHarness();
      try {
        // playWithAvPlay() emits waiting BEFORE avplayActive = true and BEFORE avplayReady = true.
        PlayerController.avplayActive = false;
        PlayerController.avplayReady = false;
        harness.video.dispatchEvent("waiting");
        assert.equal(
          harness.uiRoot.classList.contains("player-hdr-dim"),
          false,
          `${recoveryEvent}: not dimmed during pre-ready waiting`
        );
        assert.equal(
          Number(harness.screen.hdrPlaybackCheckedAt || 0),
          0,
          `${recoveryEvent}: waiting must not stamp hdrPlaybackCheckedAt`
        );

        // 10 ms later (well below 250 ms), AVPlay becomes active & ready with HDR stream info.
        advance(10);
        PlayerController.avplayActive = true;
        PlayerController.avplayReady = true;
        harness.setAvPlayDimensions({ width: 3840, height: 2160 });
        harness.setAvPlayStreamInfo([
          { type: "VIDEO", extra_info: { codec: "HEVC", hdr_type: "HDR10" } }
        ]);

        harness.video.dispatchEvent(recoveryEvent);
        assert.equal(
          harness.uiRoot.classList.contains("player-hdr-dim"),
          true,
          `${recoveryEvent}: .player-hdr-dim must apply immediately after early waiting`
        );
        assert.equal(
          harness.uiRoot.style.getPropertyValue("--player-controls-brightness"),
          String(hdrBrightnessFactor(40)),
          `${recoveryEvent}: brightness factor must equal 0.58`
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test("(a2) startup recheck cadence retries within ~250 ms (not locked out for 2500 ms) when HDR metadata arrives late", () => {
  withMockedNow(20000, ({ advance }) => {
    const harness = createPlayerHarness({
      streamFilename: "Movie.2160p.HEVC.mkv"
    });
    try {
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.setAvPlayDimensions({ width: 3840, height: 2160 });
      // Initial stream info has HEVC without hdr_type yet (and filename has no HDR tag).
      harness.setAvPlayStreamInfo([{ type: "VIDEO", extra_info: { codec: "HEVC" } }]);
      harness.screen.updateUiTick();
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), false);

      // 260 ms later, decoder populates hdr_type: "HDR10"; updateUiTick must detect it without waiting 2500 ms.
      advance(260);
      harness.setAvPlayStreamInfo([
        { type: "VIDEO", extra_info: { codec: "HEVC", hdr_type: "HDR10" } }
      ]);
      harness.screen.updateUiTick();
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);
    } finally {
      harness.restore();
    }
  });
});

test("(b) .player-hdr-dim is applied synchronously on loadedmetadata before playback starts", () => {
  withMockedNow(30000, ({ advance }) => {
    const harness = createPlayerHarness({
      streamFilename: "Sample.2160p.DV.HEVC.mkv"
    });
    try {
      // Simulate playWithAvPlay: waiting before avplayActive/avplayReady.
      PlayerController.avplayActive = false;
      PlayerController.avplayReady = false;
      harness.video.dispatchEvent("waiting");
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), false);

      // onPrepared sets avplayActive/avplayReady, syncs track info, and emits loadedmetadata BEFORE playing.
      advance(20);
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.setAvPlayDimensions({ width: 3840, height: 2160 });
      harness.setAvPlayStreamInfo([{ type: "VIDEO", extra_info: { fourCC: "HEVC" } }]);
      harness.eventsObserved.length = 0;

      harness.video.dispatchEvent("loadedmetadata");
      // Before any `playing` event or `avplay.play()`, dimming and subtitle style must already be active.
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);
      assert.equal(
        harness.uiRoot.style.getPropertyValue("--player-controls-brightness"),
        String(hdrBrightnessFactor(40))
      );
      const subtitleApply = harness.eventsObserved.find(
        (item) => item.event === "applySubtitlePresentationSettings"
      );
      assert.ok(subtitleApply, "applySubtitlePresentationSettings should run on loadedmetadata");
      assert.equal(subtitleApply.isHdr, true);
      assert.equal(subtitleApply.hasDimClass, true);
    } finally {
      harness.restore();
    }
  });
});

test("(c) transient avplayUrl/proxy/variant reloads and missing stream info preserve .player-hdr-dim, while explicit SDR or source change removes it", () => {
  withMockedNow(40000, ({ advance }) => {
    const harness = createPlayerHarness();
    try {
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.setAvPlayDimensions({ width: 3840, height: 2160 });
      harness.setAvPlayStreamInfo([
        { type: "VIDEO", extra_info: { codec: "HEVC", hdr_type: "HDR10" } }
      ]);
      harness.video.dispatchEvent("loadedmetadata");
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);

      // (c1) Tizen DTS/TrueHD conversion reload: avplayUrl changes and avplayReady flips false + waiting.
      advance(50);
      PlayerController.avplayUrl = "http://127.0.0.1:2715/audio-transcode/media.mkv";
      PlayerController.avplayReady = false;
      harness.setAvPlayStreamInfo([]);
      harness.video.dispatchEvent("waiting");
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        "DTS transcode reload must keep .player-hdr-dim"
      );

      // (c2) Tizen local proxy switch with avplayActive = false transiently.
      advance(50);
      PlayerController.avplayUrl = "http://127.0.0.1:2710/proxy/stream.mkv";
      PlayerController.avplayActive = false;
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        "local proxy reload must keep .player-hdr-dim"
      );

      // (c3) Transient empty or throwing getCurrentStreamInfo() even when avplayReady is true.
      advance(50);
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.setAvPlayStreamInfo([]);
      harness.video.dispatchEvent("avplaytrackschanged");
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        "empty stream info must not drop .player-hdr-dim"
      );

      harness.setAvPlayStreamInfo(() => {
        throw new Error("transient avplay ipc error");
      });
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        "throwing stream info must not drop .player-hdr-dim"
      );

      // (c4) HLS variant & ABR level switches: transient currentLevel === -1 keeps dim; explicit videoRange: "SDR" removes dim.
      PlayerController.playbackEngine = "hls.js";
      PlayerController.avplayActive = false;
      PlayerController.hlsInstance = {
        currentLevel: 0,
        levels: [
          { videoCodec: "hev1.2.4", videoRange: "PQ" },
          { videoCodec: "hev1.2.4", videoRange: "SDR" }
        ]
      };
      harness.screen.manifestMasterUrl = "https://cdn.example.invalid/master.m3u8";
      harness.screen.manifestVariants = [
        { uri: "https://cdn.example.invalid/variant-a.m3u8" },
        { uri: "https://cdn.example.invalid/variant-b.m3u8" }
      ];
      harness.screen.activePlaybackUrl = "https://cdn.example.invalid/master.m3u8";
      harness.screen.syncHdrPresentation({ recheck: true });
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);

      // Variant URI switch + transient currentLevel = -1
      advance(50);
      harness.screen.activePlaybackUrl = "https://cdn.example.invalid/variant-a.m3u8";
      PlayerController.hlsInstance.currentLevel = -1;
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        "HLS variant reload must keep .player-hdr-dim"
      );

      // Explicit SDR level removes dim
      advance(50);
      PlayerController.hlsInstance.currentLevel = 1;
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        false,
        "explicit HLS SDR level must remove .player-hdr-dim"
      );

      // (c5) Genuine source switch from HDR to a different SDR stream removes dim.
      PlayerController.hlsInstance.currentLevel = 0;
      harness.screen.syncHdrPresentation({ recheck: true });
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);

      advance(50);
      PlayerController.hlsInstance = null;
      PlayerController.playbackEngine = "tizen-avplay";
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.screen.currentStreamIndex = 1;
      harness.screen.streamCandidates.push({
        id: "stream-2",
        url: "https://cdn.example.invalid/movie-sdr.mkv",
        filename: "Movie.1080p.AVC.mkv"
      });
      harness.screen.activePlaybackUrl = "https://cdn.example.invalid/movie-sdr.mkv";
      PlayerController.avplayUrl = "https://cdn.example.invalid/movie-sdr.mkv";
      harness.setAvPlayStreamInfo([
        { type: "VIDEO", extra_info: { codec: "H264", hdr_type: "SDR" } }
      ]);
      harness.screen.updateUiTick();
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        false,
        "genuine SDR source switch must remove .player-hdr-dim"
      );
    } finally {
      harness.restore();
    }
  });
});

test("(d) initializePlayerMountState() and cleanup() reset all HDR presentation state between sessions", () => {
  const harness = createPlayerHarness();
  try {
    PlayerController.avplayActive = true;
    PlayerController.avplayReady = true;
    harness.setAvPlayDimensions({ width: 3840, height: 2160 });
    harness.setAvPlayStreamInfo([
      { type: "VIDEO", extra_info: { codec: "HEVC", hdr_type: "HDR10" } }
    ]);
    harness.video.dispatchEvent("loadedmetadata");

    assert.equal(harness.screen.currentPlaybackIsHdr, true);
    assert.ok(harness.screen.hdrPlaybackKey);
    assert.ok(harness.screen.hdrPlaybackCheckedAt > 0);
    assert.ok(harness.screen.hdrPresentationSignature);

    initializePlayerMountState.call(
      harness.screen,
      { itemType: "movie", videoId: "tt123" },
      "https://cdn.example.invalid/next-sdr.mkv"
    );
    assert.equal(harness.screen.currentPlaybackIsHdr, undefined);
    assert.equal(harness.screen.hdrPlaybackSourceKey, "");
    assert.equal(harness.screen.hdrPlaybackSourceUrl, "");
    assert.equal(harness.screen.hdrPlaybackKey, "");
    assert.equal(harness.screen.hdrPlaybackFirstCheckedAt, 0);
    assert.equal(harness.screen.hdrPlaybackCheckedAt, 0);
    assert.equal(harness.screen.hdrPresentationSignature, "");

    // Re-establish HDR state then invoke cleanup()
    harness.screen.activePlaybackUrl = "https://cdn.example.invalid/movie-hdr.mkv";
    harness.video.dispatchEvent("loadedmetadata");
    assert.equal(harness.screen.currentPlaybackIsHdr, true);

    harness.screen.cleanup();
    assert.equal(harness.screen.currentPlaybackIsHdr, undefined);
    assert.equal(harness.screen.hdrPlaybackSourceKey, "");
    assert.equal(harness.screen.hdrPlaybackSourceUrl, "");
    assert.equal(harness.screen.hdrPlaybackKey, "");
    assert.equal(harness.screen.hdrPlaybackFirstCheckedAt, 0);
    assert.equal(harness.screen.hdrPlaybackCheckedAt, 0);
    assert.equal(harness.screen.hdrPresentationSignature, "");

    // Next session with an SDR stream (even reusing URL/index) must start un-dimmed.
    harness.screen.uiRefs = {
      root: createFakeUiRoot(),
      htmlSubtitles: { classList: { toggle() {} } }
    };
    harness.screen.activePlaybackUrl = "https://cdn.example.invalid/movie-hdr.mkv";
    harness.setAvPlayStreamInfo([
      { type: "VIDEO", extra_info: { codec: "H264", hdr_type: "SDR" } }
    ]);
    harness.screen.syncHdrPresentation({ recheck: true });
    assert.equal(harness.screen.currentPlaybackIsHdr, false);
    assert.equal(harness.screen.uiRefs.root.classList.contains("player-hdr-dim"), false);
  } finally {
    harness.restore();
  }
});

test("readPlaybackHdrStatus reports ready/confirmed flags accurately across AVPlay, HLS, DASH, and native video", () => {
  assert.equal(
    typeof badges.readPlaybackHdrStatus,
    "function",
    "readPlaybackHdrStatus must be exported"
  );

  assert.deepEqual(
    badges.readPlaybackHdrStatus(
      {},
      {
        playbackEngine: "tizen-avplay",
        isUsingAvPlay: () => false,
        avplayReady: false
      }
    ),
    { isHdr: false, confirmed: false, ready: false }
  );

  assert.deepEqual(
    badges.readPlaybackHdrStatus(
      {},
      {
        playbackEngine: "tizen-avplay",
        isUsingAvPlay: () => true,
        avplayReady: true,
        getAvPlay: () => ({
          getCurrentStreamInfo: () => [
            { type: "VIDEO", extra_info: { codec: "HEVC", hdr_type: "SDR" } }
          ]
        }),
        parseAvPlayExtraInfo: (v) => v,
        pickAvPlayExtraValue: (s, k) => k.map((x) => s[x]).find((v) => v != null)
      }
    ),
    { isHdr: false, confirmed: true, ready: true }
  );

  assert.deepEqual(
    badges.readPlaybackHdrStatus(
      {},
      {
        playbackEngine: "hls.js",
        hlsInstance: { currentLevel: -1, levels: [{ videoCodec: "hev1", videoRange: "PQ" }] }
      }
    ),
    { isHdr: false, confirmed: false, ready: false }
  );

  assert.deepEqual(
    badges.readPlaybackHdrStatus(
      {},
      {
        playbackEngine: "html5",
        video: { readyState: 4, videoWidth: 1920, videoHeight: 1080 }
      }
    ),
    { isHdr: false, confirmed: false, ready: true }
  );
});

test("(e) onLoadedMetadata applies .player-hdr-dim before attemptPendingPlaybackRestore triggers AVPlay resume seek", () => {
  withMockedNow(50000, () => {
    const harness = createPlayerHarness({
      streamFilename: "Mutiny.2160p.HDR10.HEVC.mkv"
    });
    let restoredCalled = false;
    let dimDuringRestore = false;
    harness.screen.attemptPendingPlaybackRestore = () => {
      restoredCalled = true;
      dimDuringRestore = harness.uiRoot.classList.contains("player-hdr-dim");
      // Simulate seekAvPlayTo() clearing avplayReady and emitting waiting synchronously
      PlayerController.avplayReady = false;
      harness.video.dispatchEvent("waiting");
    };
    try {
      PlayerController.avplayActive = true;
      PlayerController.avplayReady = true;
      harness.setAvPlayDimensions({ width: 3840, height: 2160 });
      harness.setAvPlayStreamInfo([
        {
          type: "VIDEO",
          extra_info: { fourCC: "video/x-h265", Width: "3840", Height: "2160", Bit_rate: "0" }
        }
      ]);

      harness.video.dispatchEvent("loadedmetadata");
      assert.equal(restoredCalled, true);
      assert.equal(
        dimDuringRestore,
        true,
        ".player-hdr-dim must be applied before attemptPendingPlaybackRestore seeks"
      );
      assert.equal(
        harness.uiRoot.classList.contains("player-hdr-dim"),
        true,
        ".player-hdr-dim must remain active across resume-seek waiting"
      );

      PlayerController.avplayReady = true;
      harness.video.dispatchEvent("playing");
      assert.equal(harness.uiRoot.classList.contains("player-hdr-dim"), true);
    } finally {
      harness.restore();
    }
  });
});
