// Tizen AVPlay prepared-state poll.
//
// Some firmware reaches READY without ever calling prepareAsync's success
// callback: the field log for #1609 shows `AVPlay state: READY`,
// `AVPlay current time ms: 0` and no playback start at all, on a source that
// had already published its tracks. Without the callback the app never set
// avplayReady and never called play(), so the loading screen stayed forever.
// The state is now polled after prepareAsync, and the same handler runs once.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};
globalThis.__NUVIO_PLATFORM__ = "tizen";

function createFakeAvPlay({ callsBackPrepare = false } = {}) {
  const avplay = {
    state: "IDLE",
    calls: [],
    getState() {
      return this.state;
    },
    getCurrentTime() {
      return 0;
    },
    getDuration() {
      return 7_200_000;
    },
    open() {
      this.calls.push("open");
      this.state = "IDLE";
    },
    setListener() {},
    setDisplayRect() {
      this.calls.push("setDisplayRect");
    },
    setDisplayMethod() {},
    setStreamingProperty() {},
    prepareAsync(onPrepared) {
      this.calls.push("prepareAsync");
      if (callsBackPrepare) {
        this.state = "READY";
        onPrepared();
      }
    },
    play() {
      this.calls.push("play");
      this.state = "PLAYING";
    },
    pause() {},
    stop() {
      this.calls.push("stop");
      this.state = "IDLE";
    },
    close() {
      this.calls.push("close");
      this.state = "NONE";
    }
  };
  return avplay;
}

async function startPlayback({ callsBackPrepare }) {
  const avplay = createFakeAvPlay({ callsBackPrepare });
  globalThis.webapis = { avplay };
  const { PlayerController } = await import("../js/core/player/playerController.js");

  // Keep the test on the prepared-state poll: the rest of the startup path is
  // covered by its own suites.
  const noop = () => {};
  PlayerController.syncAvPlayTrackInfo = noop;
  PlayerController.refreshAvPlayTimeline = noop;
  PlayerController.emitVideoEvent = noop;
  PlayerController.configureAvPlayForSource = noop;
  PlayerController.configureAvPlayBuffering = noop;
  PlayerController.setAvPlayDisplayRect = noop;
  PlayerController.reapplyTizenAvPlayDisplayRect = noop;
  PlayerController.startAvPlayTickTimer = noop;
  PlayerController.startPreparedAvPlayPlayback = () => {
    avplay.play();
  };

  PlayerController.playbackEngine = "tizen-avplay";
  PlayerController.avplayReady = false;
  PlayerController.avplayPreparedHandled = false;
  PlayerController.avplaySeekInFlight = false;
  PlayerController.startupAudioGateActive = false;
  PlayerController.playRequestToken = 7;
  PlayerController.currentPlaybackUrl = "http://127.0.0.1:2710/hash/0";
  PlayerController.video = { paused: true };

  assert.equal(
    PlayerController.playWithAvPlay(PlayerController.currentPlaybackUrl, {}, null, 7),
    true
  );
  return { avplay, controller: PlayerController };
}

test("a READY player starts even when prepareAsync never calls back", async () => {
  const { avplay } = await startPlayback({ callsBackPrepare: false });
  assert.equal(avplay.calls.includes("play"), false, "nothing starts before the state is polled");

  avplay.state = "READY";
  await new Promise((resolve) => setTimeout(resolve, 1200));

  assert.deepEqual(
    avplay.calls.filter((call) => call === "play"),
    ["play"],
    "the poll starts playback once the firmware reports READY"
  );
});

test("the prepare callback still starts playback and the poll does not repeat it", async () => {
  const { avplay } = await startPlayback({ callsBackPrepare: true });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  assert.deepEqual(
    avplay.calls.filter((call) => call === "play"),
    ["play"],
    "one start, whichever reports first"
  );
});

test("a superseded play token still starts the session it is preparing", async () => {
  const { avplay, controller } = await startPlayback({ callsBackPrepare: false });
  // A second request replaced the token while AVPlay kept preparing this URL.
  controller.playRequestToken = 8;
  controller.avplayActive = true;
  avplay.state = "READY";

  await new Promise((resolve) => setTimeout(resolve, 1200));

  assert.deepEqual(
    avplay.calls.filter((call) => call === "play"),
    ["play"],
    "the native session that is READY is the one that must start"
  );
});
