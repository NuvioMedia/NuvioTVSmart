import assert from "node:assert/strict";

// The player timeline reads back as zero once PlayerController.stop() tears down
// the engine. Tracking must be committed before that, like Android's
// stopAndRelease(), otherwise Jellyfin/Emby receive a zero stop position and
// reset the server-side watch progress.

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
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
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
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

const { createPlayerScreenMethods21 } =
  await import("../js/ui/screens/player/playerScreenMethods-21-resolve-next-episode-info.js");
const { createPlayerScreenMethods73 } =
  await import("../js/ui/screens/player/playerScreenMethods-73-cleanup.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { TrackingScrobbleService } =
  await import("../js/data/repository/trackingScrobbleService.js");
const { Router } = await import("../js/ui/navigation/router.js");

const original = {
  playerStop: PlayerController.stop,
  trackingStop: TrackingScrobbleService.stop,
  trackingEnabled: TrackingScrobbleService.isEnabled,
  popToExistingRoute: Router.popToExistingRoute
};

function restore() {
  PlayerController.stop = original.playerStop;
  TrackingScrobbleService.stop = original.trackingStop;
  TrackingScrobbleService.isEnabled = original.trackingEnabled;
  Router.popToExistingRoute = original.popToExistingRoute;
}

function backFromPlayer({ prepared = false, presented = true } = {}) {
  const events = [];
  const screen = {
    ...createPlayerScreenMethods21(),
    ...createPlayerScreenMethods73(),
    playerBackNavigationInProgress: false,
    hasPresentedPlaybackFrame: presented,
    postPlayNaturalCompletionPrepared: prepared,
    params: {},
    positionMs: 1250000,
    releaseCurrentEngineFsStreamBestEffort() {},
    buildReturnStreamRouteParamsFromPlayer() {
      return {};
    },
    shouldReturnToStreamOnBack() {
      return true;
    },
    getPlaybackCurrentSeconds() {
      return this.positionMs / 1000;
    },
    buildScrobbleContext() {
      return { positionMs: this.positionMs };
    }
  };
  PlayerController.stop = () => {
    // Mirrors the real teardown: the engine timeline is no longer readable.
    screen.positionMs = 0;
    events.push("player-stop");
  };
  TrackingScrobbleService.isEnabled = () => true;
  TrackingScrobbleService.stop = (context) => events.push(`tracking-stop:${context.positionMs}`);
  Router.popToExistingRoute = () => true;

  screen.navigateBackToStreamScreen();
  return events;
}

try {
  assert.deepEqual(backFromPlayer(), ["tracking-stop:1250000", "player-stop"]);
  assert.deepEqual(
    backFromPlayer({ prepared: true }),
    ["player-stop"],
    "a naturally completed playback is already committed and must not report twice"
  );
  assert.deepEqual(
    backFromPlayer({ presented: false }),
    ["player-stop"],
    "playback that never presented a frame has no progress to report"
  );
  console.log("media server stop position: ok");
} finally {
  restore();
}
