import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [m03Source, m08Source, m12Source, m13Source] = await Promise.all([
  readFile(
    new URL("./playerControllerMethods-03-start-av-play-tick-timer.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerControllerMethods-08-set-av-play-display-rect.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerControllerMethods-12-get-playback-engine-candidates.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerControllerMethods-13-resolve-remote-media-source-type.js", import.meta.url),
    "utf8"
  )
]);

test("PlayerController guards AVPlay rate/rect timers by playRequestToken, times out HEAD probe without AbortController, and destroys partial dash.js instance on attach error", async () => {
  const scheduledTimeouts = [];
  let dashResetCalls = 0;
  let dashDestroyCalls = 0;
  let avPlayRateApplyCalls = 0;
  let avPlayDisplayRectCalls = 0;

  const ctx = vm.createContext({
    AbortController: undefined,
    fetch: () => new Promise(() => {}),
    setTimeout: (fn, delay) => {
      scheduledTimeouts.push({ fn, delay });
      return scheduledTimeouts.length;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (cb) => {
      scheduledTimeouts.push({ fn: cb, delay: 0 });
      return scheduledTimeouts.length;
    },
    console,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    Error,
    createStreamRedirectReporter: () => () => {},
    internals: {
      Platform: { isTizen: () => true, isWebOS: () => false },
      nativeVideoEngine: {},
      WEBOS_MEDIA_TYPE_PROBE_TIMEOUT_MS: 250,
      TIZEN_AVPLAY_SYNC_RETRY_INTERVAL_MS: 50,
      createStreamRedirectReporter: () => () => {},
      dashJsEngine: {
        createPlayer: () => ({
          updateSettings() {},
          extend() {},
          addResponseInterceptor() {},
          initialize() {
            throw new Error("dash init failure");
          },
          reset() {
            dashResetCalls += 1;
          },
          destroy() {
            dashDestroyCalls += 1;
          }
        }),
        getEvents: () => ({})
      },
      getTizenAvPlay: () => ({
        play() {}
      }),
      isTizenAvPlayIdleOrPreparing: () => false,
      logTizenAvPlayDebug: () => {},
      hlsJsEngine: {}
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${stripModule(m03Source)}\n${stripModule(m08Source)}\n${stripModule(m12Source)}\n${stripModule(m13Source)}\nglobalThis.api = { ...createPlayerControllerMethods03(), ...createPlayerControllerMethods08(), ...createPlayerControllerMethods12(), ...createPlayerControllerMethods13() };`,
    ctx
  );

  const controller = Object.assign(Object.create(ctx.api), {
    playRequestToken: 10,
    video: {},
    currentPlaybackHeaders: {},
    isUsingAvPlay: () => true,
    getAvPlay: () => ({ play() {} }),
    isAvPlaySeekInFlight: () => false,
    selectPendingAvPlayAudioTrackBeforeStart() {},
    applyPendingAvPlayAudioTrackSelection() {},
    applyPendingAvPlaySubtitleTrackSelection() {},
    syncAvPlayTrackInfo() {},
    syncWebOsPlaybackKeepAwake() {},
    syncAvPlayAudioTracks() {},
    scheduleAvPlayAudioTrackSync() {},
    startAvPlayTickTimer() {},
    getAvPlayState: () => "PLAYING",
    flushPendingAvPlaySeek() {},
    emitVideoEvent() {},
    reapplyAvPlayPlaybackRate() {
      avPlayRateApplyCalls += 1;
    },
    setAvPlayDisplayRect() {
      avPlayDisplayRectCalls += 1;
    },
    canUseDashJs: () => true,
    isRemoteDirectHttpSource: () => true,
    isPlaybackRequestActive: () => true,
    teardownDashInstance() {},
    teardownHlsInstance() {},
    normalizePlaybackHeaders: (h) => h || {}
  });

  // 1. Stale AVPlay playback-rate & display-rect timers must skip after playRequestToken advances.
  controller.startPreparedAvPlayPlayback();
  avPlayRateApplyCalls = 0;
  avPlayDisplayRectCalls = 0;
  controller.reapplyTizenAvPlayDisplayRect(50);
  controller.playRequestToken = 11;
  scheduledTimeouts.splice(0).forEach((entry) => entry.fn());
  assert.equal(
    avPlayRateApplyCalls,
    0,
    "stale playback rate timer must not run after token change"
  );
  assert.equal(
    avPlayDisplayRectCalls,
    0,
    "stale display rect sync must not run after token change"
  );

  // 2. playWithDashJs attach failure must call destroy() as well as reset().
  assert.equal(controller.playWithDashJs("https://example.com/manifest.mpd", 11), false);
  assert.equal(dashResetCalls, 1);
  assert.equal(dashDestroyCalls, 1, "playWithDashJs catch must call player?.destroy?.()");

  // 3. webOS media-type HEAD probe must time out via Promise.race even when AbortController is missing.
  ctx.internals.Platform.isWebOS = () => true;
  const probePromise = controller.probeRemoteMediaSourceType("https://example.com/stream", {});
  const raceTimeoutEntry = scheduledTimeouts.find((entry) => entry.delay === 250);
  assert.ok(
    raceTimeoutEntry,
    "probeRemoteMediaSourceType must schedule timeout promise even without AbortController"
  );
  raceTimeoutEntry.fn();
  const probed = await probePromise;
  assert.equal(probed, null);
});
