// Tizen AVPlay seek sequencing.
//
// Samsung documents seekTo()/prepareAsync() as asynchronous: no other AVPlay
// API may be called until their callbacks fire. Field logs (Tizen 6.0) showed
// the resume seek issued while AVPlay was still IDLE (preparing), followed by
// every later seekTo() failing with PLAYER_ERROR_INVALID_STATE while PLAYING.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};
let timers = [];
globalThis.setTimeout = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};
globalThis.clearTimeout = () => {};

const { PlayerController } = await import("../js/core/player/playerController.js");

function createFakeAvPlay() {
  const avplay = {
    state: "PLAYING",
    currentMs: 10_000,
    calls: [],
    pendingSeek: null,
    pendingJump: null,
    seekToBehavior: "async-success",
    jumpBehavior: "async-success",
    getState() {
      return this.state;
    },
    getCurrentTime() {
      return this.currentMs;
    },
    getDuration() {
      return 7_200_000;
    },
    seekTo(ms, ok, err) {
      this.calls.push(["seekTo", ms]);
      if (this.seekToBehavior === "invalid-state") {
        err("PLAYER_ERROR_INVALID_STATE");
        return;
      }
      if (this.seekToBehavior === "other-error") {
        err("PLAYER_ERROR_SEEK_FAILED");
        return;
      }
      this.pendingSeek = { ms, ok, err };
    },
    jumpForward(ms, ok, err) {
      this.calls.push(["jumpForward", ms]);
      if (this.jumpBehavior === "error") {
        err("PLAYER_ERROR_INVALID_STATE");
        return;
      }
      this.currentMs += ms;
      ok();
    },
    jumpBackward(ms, ok, _err) {
      this.calls.push(["jumpBackward", ms]);
      this.currentMs = Math.max(0, this.currentMs - ms);
      ok();
    },
    play() {
      this.calls.push(["play"]);
      this.state = "PLAYING";
    },
    completeSeek() {
      const pending = this.pendingSeek;
      this.pendingSeek = null;
      this.currentMs = pending.ms;
      pending.ok();
    }
  };
  return avplay;
}

let avplay;
const events = [];
Object.assign(PlayerController, {
  isUsingAvPlay: () => true,
  getAvPlay: () => avplay,
  emitVideoEvent: (name) => events.push(name),
  stopAvPlayTickTimer() {},
  startAvPlayTickTimer() {},
  reapplyAvPlayPlaybackRate() {},
  retryPendingAvPlayStartupAudioTrackSelection() {},
  applyPendingAvPlayAudioTrackSelection() {},
  applyPendingAvPlaySubtitleTrackSelection() {},
  applyAvPlayExternalSubtitleDelay() {},
  reapplyTizenAvPlayDisplayRect() {},
  syncWebOsPlaybackKeepAwake() {},
  syncAvPlayTrackInfo() {}
});

function reset({ state = "PLAYING", currentMs = 10_000 } = {}) {
  avplay = createFakeAvPlay();
  avplay.state = state;
  avplay.currentMs = currentMs;
  events.length = 0;
  timers = [];
  PlayerController.avplaySeekInFlight = false;
  PlayerController.avplaySeekRequestToken = 0;
  PlayerController.avplayDeferredSeekMs = 0;
  PlayerController.avplayStartAfterSeek = null;
  PlayerController.avplayLastSeekOutcome = null;
  PlayerController.isPlaying = state === "PLAYING";
}

const calls = (name) => avplay.calls.filter(([n]) => n === name);

// 1. Seek requested while prepareAsync() runs (IDLE) is deferred, not sent.
{
  reset({ state: "IDLE", currentMs: 0 });
  assert.equal(PlayerController.seekAvPlayTo(61_015), true);
  assert.equal(calls("seekTo").length, 0, "never call seekTo while AVPlay is preparing");
  assert.equal(PlayerController.avplayDeferredSeekMs, 61_015);
  assert.equal(PlayerController.avplaySeekInFlight, false);
}

// 2. play() requested while a seek is in flight waits for the seek to settle.
{
  reset({ state: "READY", currentMs: 0 });
  PlayerController.isPlaying = false;
  PlayerController.seekAvPlayTo(61_015);
  assert.equal(PlayerController.avplaySeekInFlight, true);
  PlayerController.startPreparedAvPlayPlayback({ syncTracks: true });
  assert.equal(calls("play").length, 0, "play() must not be called while seekTo is pending");
  avplay.completeSeek();
  assert.equal(calls("play").length, 1, "playback starts once the seek has settled");
  assert.ok(
    avplay.calls.findIndex(([n]) => n === "seekTo") < avplay.calls.findIndex(([n]) => n === "play")
  );
  assert.equal(PlayerController.avplayLastSeekOutcome.success, true);
  assert.ok(events.includes("seeked"));
  assert.ok(events.includes("playing"));
}

// 3. INVALID_STATE from seekTo() while PLAYING falls back to jumpForward.
{
  reset({ state: "PLAYING", currentMs: 12_136 });
  avplay.seekToBehavior = "invalid-state";
  PlayerController.seekAvPlayTo(199_869);
  assert.deepEqual(calls("jumpForward")[0], ["jumpForward", 199_869 - 12_136]);
  assert.equal(PlayerController.avplaySeekInFlight, false);
  assert.equal(PlayerController.avplayLastSeekOutcome.success, true);
  assert.equal(avplay.currentMs, 199_869);
  assert.ok(events.includes("seeked"));
}

// 4. Backward seek uses jumpBackward.
{
  reset({ state: "PLAYING", currentMs: 300_000 });
  avplay.seekToBehavior = "invalid-state";
  PlayerController.seekAvPlayTo(120_000);
  assert.deepEqual(calls("jumpBackward")[0], ["jumpBackward", 180_000]);
  assert.equal(PlayerController.avplayLastSeekOutcome.success, true);
}

// 5. Jump fallback also rejected -> seek reported as failed, not stuck.
{
  reset({ state: "PLAYING", currentMs: 12_136 });
  avplay.seekToBehavior = "invalid-state";
  avplay.jumpBehavior = "error";
  PlayerController.seekAvPlayTo(199_869);
  assert.equal(calls("jumpForward").length, 1, "only one fallback attempt");
  assert.equal(PlayerController.avplaySeekInFlight, false);
  assert.equal(PlayerController.avplayLastSeekOutcome.success, false);
  assert.ok(!events.includes("seeked"));
}

// 6. Other seek errors do not trigger the jump fallback.
{
  reset({ state: "PLAYING", currentMs: 12_136 });
  avplay.seekToBehavior = "other-error";
  PlayerController.seekAvPlayTo(199_869);
  assert.equal(calls("jumpForward").length, 0);
  assert.equal(PlayerController.avplayLastSeekOutcome.success, false);
}

// 7. Normal seek while PLAYING is unchanged and play() is not called again.
{
  reset({ state: "PLAYING", currentMs: 50_000 });
  PlayerController.seekAvPlayTo(80_000);
  avplay.completeSeek();
  assert.equal(calls("seekTo").length, 1);
  assert.equal(calls("play").length, 0);
  assert.equal(PlayerController.avplayLastSeekOutcome.success, true);
}

// 8. Teardown drops deferred seeks and queued starts.
{
  reset({ state: "IDLE", currentMs: 0 });
  PlayerController.seekAvPlayTo(5_000);
  PlayerController.avplayStartAfterSeek = { syncTracks: true };
  avplay.setSilentSubtitle = () => {};
  avplay.setListener = () => {};
  avplay.close = () => {};
  PlayerController.teardownAvPlay();
  assert.equal(PlayerController.avplayDeferredSeekMs, 0);
  assert.equal(PlayerController.avplayStartAfterSeek, null);
}

// 9-10. Full startup: resume seek requested while preparing, or from the
// prepared events. seekTo must run in READY and play() only after it settles.
function startPlayback({ seekDuringPrepare = false, seekOnLoadedMetadata = false } = {}) {
  reset({ state: "NONE", currentMs: 0 });
  PlayerController.isPlaying = false;
  let prepared = null;
  Object.assign(avplay, {
    open() {
      this.calls.push(["open"]);
      this.state = "IDLE";
    },
    close() {},
    stop() {},
    setListener() {},
    setSilentSubtitle() {},
    prepareAsync(ok) {
      this.calls.push(["prepareAsync"]);
      prepared = ok;
    }
  });
  Object.assign(PlayerController, {
    canUseAvPlay: () => true,
    isPlaybackRequestActive: () => true,
    getPlatformAvplayEngineName: () => "tizen-avplay",
    setAvPlayDisplayRect() {},
    configureAvPlayForSource() {},
    configureAvPlayBuffering() {},
    startupAudioGateActive: false,
    emitVideoEvent: (name) => {
      events.push(name);
      if (seekOnLoadedMetadata && name === "loadedmetadata") {
        PlayerController.seekAvPlayTo(61_015); // UI resume restore
      }
    }
  });
  assert.equal(
    PlayerController.playWithAvPlay("https://example.invalid/movie.mkv", {}, null, 1),
    true
  );
  if (seekDuringPrepare) {
    PlayerController.seekAvPlayTo(61_015); // UI resume restore while IDLE
    assert.equal(calls("seekTo").length, 0);
  }
  avplay.state = "READY";
  prepared();
  assert.equal(calls("seekTo").length, 1, "resume seek is sent once AVPlay is READY");
  assert.equal(calls("play").length, 0, "play() waits for the resume seek");
  avplay.completeSeek();
  assert.equal(calls("play").length, 1, "playback starts after the resume seek");
  assert.equal(avplay.currentMs, 61_015);
  const order = avplay.calls.map(([n]) => n).filter((n) => n === "seekTo" || n === "play");
  assert.deepEqual(order, ["seekTo", "play"]);
}
// 11. Display-rect updates wait for seekTo() to settle, then apply the latest
// geometry (the post-play mini window is resized while credits are seeking).
{
  reset({ state: "PLAYING", currentMs: 10_000 });
  const { Platform } = await import("../js/platform/index.js");
  const previousPlatform = Platform.current;
  Platform.current = { name: "tizen" };
  const displayCalls = [];
  avplay.setDisplayRect = (x, y, width, height) => displayCalls.push(["rect", x, y, width, height]);
  avplay.setDisplayMethod = (method) => displayCalls.push(["method", method]);
  PlayerController.avplayDisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };
  PlayerController.avplayDisplayMethod = "PLAYER_DISPLAY_MODE_LETTER_BOX";
  const previousReapply = PlayerController.reapplyTizenAvPlayDisplayRect;
  let reapplied = 0;
  PlayerController.reapplyTizenAvPlayDisplayRect = function () {
    reapplied += 1;
    this.setAvPlayDisplayRect();
  };
  try {
    PlayerController.seekAvPlayTo(80_000);
    PlayerController.setAvPlayDisplayRect(
      { x: 1280, y: 40, width: 600, height: 337 },
      "PLAYER_DISPLAY_MODE_FULL_SCREEN"
    );
    assert.equal(displayCalls.length, 0, "no AVPlay display call while seekTo is pending");
    assert.equal(PlayerController.avplayDisplayRectDeferred, true);
    assert.deepEqual(PlayerController.avplayDisplayRect, {
      x: 1280,
      y: 40,
      width: 600,
      height: 337
    });
    avplay.completeSeek();
    assert.equal(PlayerController.avplayDisplayRectDeferred, false);
    assert.equal(reapplied, 1, "the held display rect is applied when the seek settles");
    assert.deepEqual(displayCalls[0], ["rect", 1280, 40, 600, 337]);
    assert.deepEqual(displayCalls[1], ["method", "PLAYER_DISPLAY_MODE_FULL_SCREEN"]);
  } finally {
    PlayerController.reapplyTizenAvPlayDisplayRect = previousReapply;
    Platform.current = previousPlatform;
  }
}

// 12. The post-play mini rect keeps its own area with letterboxing; the
// existing full-viewport aspect calls still ignore an already letterboxed rect.
{
  reset({ state: "PLAYING", currentMs: 10_000 });
  const { Platform } = await import("../js/platform/index.js");
  const previousPlatform = Platform.current;
  Platform.current = { name: "tizen" };
  const displayCalls = [];
  avplay.setDisplayRect = (x, y, width, height) => displayCalls.push(["rect", x, y, width, height]);
  avplay.setDisplayMethod = (method) => displayCalls.push(["method", method]);
  PlayerController.avplayDisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };
  PlayerController.avplayDisplayMethod = "PLAYER_DISPLAY_MODE_LETTER_BOX";
  try {
    PlayerController.setAvPlayDisplayRect(
      { x: 1274, y: 32, width: 614, height: 345 },
      "PLAYER_DISPLAY_MODE_LETTER_BOX",
      { honorRect: true }
    );
    assert.deepEqual(displayCalls[0], ["rect", 1274, 32, 614, 345]);
    assert.deepEqual(displayCalls[1], ["method", "PLAYER_DISPLAY_MODE_LETTER_BOX"]);

    displayCalls.length = 0;
    PlayerController.setAvPlayDisplayRect(
      { x: 1274, y: 32, width: 614, height: 345 },
      "PLAYER_DISPLAY_MODE_LETTER_BOX"
    );
    assert.deepEqual(displayCalls[0], ["rect", 0, 0, 1920, 1080]);
  } finally {
    Platform.current = previousPlatform;
  }
}

startPlayback({ seekDuringPrepare: true });
startPlayback({ seekOnLoadedMetadata: true });

console.log("tizen avplay seek sequencing tests passed");
