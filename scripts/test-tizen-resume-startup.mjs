// Tizen resume startup.
//
// AVPlay applies the resume position with seekTo(), but getCurrentTime() only
// reports the playback clock. If a firmware keeps that clock at 0 until play,
// or the source rejects the seek, the restore used to stay pending forever and
// the startup audio gate never started playback (black screen, no error).
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { Environment } = await import("../js/platform/environment.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");
const { createPlayerScreenMethods31 } =
  await import("../js/ui/screens/player/playerScreenMethods-31-seek-playback-seconds.js");

Environment.isWebOS = () => false;

function createScreen({ isTizen = true, usingAvPlay = true } = {}) {
  Environment.isTizen = () => isTizen;
  const screen = {
    ...createPlayerScreenMethods30(),
    ...createPlayerScreenMethods31(),
    pendingPlaybackRestore: { timeSeconds: 900, paused: false, attempts: 0, lastAttemptAt: 0 },
    startupAudioGateActive: true,
    startupAudioGateAllowsNativePlayback: false,
    startupAudioGateDeadline: 0,
    startupAudioPreferenceApplied: true,
    pendingWebOsAudioSelection: null,
    hasPresentedPlaybackFrame: false,
    startupPlaybackBaselineSeconds: null,
    startupPlaybackHasAdvanced: false,
    paused: false,
    loadingVisible: true,
    currentSeconds: 0,
    readyState: 4,
    seeks: [],
    getPlaybackDurationSeconds: () => 0,
    getPlaybackCurrentSeconds: () => screen.currentSeconds,
    hasAudioTracksAvailable: () => true,
    seekPlaybackSeconds(seconds) {
      screen.seeks.push(seconds);
      PlayerController.avplaySeekInFlight = true;
      screen.readyState = 1;
      return true;
    }
  };
  Object.assign(PlayerController, {
    isUsingAvPlay: () => usingAvPlay,
    getPlaybackReadyState: () => screen.readyState,
    avplaySeekInFlight: false,
    avplaySeekSettledAt: 0,
    avplayLastSeekOutcome: null
  });
  return screen;
}

function settleSeek({ success }) {
  PlayerController.avplaySeekInFlight = false;
  PlayerController.avplaySeekSettledAt = Date.now();
  PlayerController.avplayLastSeekOutcome = { success, targetMs: 900_000 };
}

test("a settled resume seek releases the restart even when the clock stays at 0", () => {
  const screen = createScreen();
  screen.attemptPendingPlaybackRestore({ force: true });
  assert.deepEqual(screen.seeks, [900]);
  assert.equal(
    screen.isStartupGateReleaseReady(),
    false,
    "never start playback while seekTo is pending"
  );

  // The native seek succeeded, but this firmware only moves getCurrentTime()
  // once playback starts, so the cached clock cannot confirm the restore.
  settleSeek({ success: true });
  screen.readyState = 4;
  screen.attemptPendingPlaybackRestore();

  assert.equal(
    screen.pendingPlaybackRestore,
    null,
    "the settled native seek is the restore result"
  );
  assert.equal(
    screen.isStartupGateReleaseReady(),
    true,
    "the gate starts playback at the seek position"
  );
});

test("a rejected resume seek starts playback instead of hanging", () => {
  const screen = createScreen();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  try {
    screen.attemptPendingPlaybackRestore({ force: true });
    settleSeek({ success: false });
    screen.readyState = 4;
    screen.attemptPendingPlaybackRestore();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(
    screen.pendingPlaybackRestore,
    null,
    "a non-seekable source must not keep the restore queued"
  );
  assert.equal(screen.isStartupGateReleaseReady(), true);
  assert.equal(screen.seeks.length, 1, "no repeated seek storm after the failure");
  assert.equal(warnings.filter((line) => line.includes("resume position")).length, 1);
});

test("a deferred seek that never settles is dropped after a bounded number of attempts", () => {
  const screen = createScreen();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // AVPlay keeps deferring the seek (state IDLE): no settle is recorded.
    screen.seekPlaybackSeconds = (seconds) => {
      screen.seeks.push(seconds);
      PlayerController.avplaySeekInFlight = false;
      screen.readyState = 4;
      return true;
    };
    screen.attemptPendingPlaybackRestore({ force: true });
  }
  assert.equal(screen.seeks.length, 8);
  assert.equal(screen.pendingPlaybackRestore, null);
  assert.equal(screen.isStartupGateReleaseReady(), true);
});

test("webOS and Tizen native playback still wait for the resume seek", () => {
  const screen = createScreen({ isTizen: false, usingAvPlay: false });
  screen.seekPlaybackSeconds = (seconds) => {
    screen.seeks.push(seconds);
    return true;
  };
  assert.equal(screen.isStartupGateReleaseReady(), false);

  screen.attemptPendingPlaybackRestore({ force: true });
  settleSeek({ success: true });
  screen.attemptPendingPlaybackRestore();
  assert.ok(screen.pendingPlaybackRestore, "the media element clock confirms this restore itself");
  assert.equal(screen.isStartupGateReleaseReady(), false);
});
