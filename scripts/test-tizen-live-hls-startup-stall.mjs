// Tizen live HLS direct AVPlay startup.
//
// Add-on live HLS links can stay unopened in AVPlay (readyState 1,
// networkState 0) until the 20 s direct stall fires, and only then does the
// player retry through the local proxy, which starts the same link (#1614).
// Live HLS gets a shorter direct budget so that retry is not delayed; VOD and
// the paths without a proxy retry keep the previous policy.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { Environment } = await import("../js/platform/environment.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods37 } =
  await import("../js/ui/screens/player/playerScreenMethods-37-should-defer-engine-fs-startup-stall.js");

Environment.isWebOS = () => false;
Environment.isTizen = () => true;

function screen({ directAvPlay = true } = {}) {
  return {
    ...createPlayerScreenMethods37(),
    canRetryTizenAvPlayThroughLocalProxy: () => directAvPlay
  };
}

function configure({ live = true, hls = true } = {}) {
  PlayerController.playbackEngine = "tizen-avplay";
  PlayerController.isLivePlaybackItemType = () => live;
  PlayerController.isLikelyHlsMimeType = () => hls;
  PlayerController.currentPlaybackMediaSourceType = hls
    ? "application/vnd.apple.mpegurl"
    : "video/mp4";
}

test("a live HLS direct AVPlay start hands over to the proxy sooner", () => {
  configure({ live: true, hls: true });
  assert.equal(screen().getPlaybackStallTimeoutMs({ startup: true }), 8000);
});

test("a VOD direct AVPlay start keeps the existing budget", () => {
  configure({ live: false, hls: true });
  assert.equal(screen().getPlaybackStallTimeoutMs({ startup: true }), 20000);
});

test("a live source that is not HLS keeps the existing budget", () => {
  configure({ live: true, hls: false });
  assert.equal(screen().getPlaybackStallTimeoutMs({ startup: true }), 20000);
});

test("without the local proxy retry the native policy is unchanged", () => {
  configure({ live: true, hls: true });
  assert.equal(screen({ directAvPlay: false }).getPlaybackStallTimeoutMs({ startup: true }), 60000);
});
