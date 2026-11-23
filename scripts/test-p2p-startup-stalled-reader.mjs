// #1609: before the first frame, a paused torrent swarm with no new data means the
// player stopped reading while preparing; the startup stall guard must stop
// extending instead of waiting about three minutes. The P2P service also starts
// as soon as the source list shows a playable torrent.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
  getItem: (key) => (key === "torrentSettings" ? JSON.stringify({ p2pEnabled: true }) : null),
  setItem() {},
  removeItem() {}
};

const { createPlayerScreenMethods36 } =
  await import("../js/ui/screens/player/playerScreenMethods-36-reset-playback-engine-validation.js");
const { createPlayerScreenMethods37 } =
  await import("../js/ui/screens/player/playerScreenMethods-37-should-defer-engine-fs-startup-stall.js");

function screen() {
  return {
    ...createPlayerScreenMethods36(),
    ...createPlayerScreenMethods37(),
    lastEngineFsStallStats: null,
    engineFsStallExtensions: 0
  };
}

const MB = 1024 * 1024;
const stats = (downloaded, swarmPaused, downloadSpeed = 0) => ({
  downloaded,
  swarmPaused,
  downloadSpeed,
  peers: 8,
  unique: 200
});

test("a paused swarm with no new data stops the extensions", () => {
  const s = screen();
  assert.equal(
    s.shouldDeferEngineFsStartupStall(stats(59 * MB, true, 10240)),
    true,
    "first check has nothing to compare"
  );
  assert.equal(
    s.shouldDeferEngineFsStartupStall(stats(59 * MB + 120000, false, 10240)),
    false,
    "pause seen on the previous check"
  );
});

test("a paused swarm that keeps feeding a reader is still extended", () => {
  const s = screen();
  assert.equal(s.shouldDeferEngineFsStartupStall(stats(40 * MB, true)), true);
  assert.equal(s.shouldDeferEngineFsStartupStall(stats(70 * MB, true, 2 * MB)), true);
});

test("without a pause the existing extension rules are unchanged", () => {
  const s = screen();
  assert.equal(s.shouldDeferEngineFsStartupStall(stats(10 * MB, false)), true);
  assert.equal(
    s.shouldDeferEngineFsStartupStall(stats(10 * MB, false)),
    true,
    "alive swarm, under ten extensions"
  );
});

test("the source list warms the P2P service only for playable torrents", async () => {
  const { TizenStreamingServerResolver } =
    await import("../js/core/p2p/tizenStreamingServerResolver.js");
  const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");
  const calls = [];
  const original = TizenEngineFsService.ensureStarted;
  const originalCanResolve = TizenStreamingServerResolver.canResolveStream;
  TizenEngineFsService.ensureStarted = async (options) => calls.push(options);
  TizenStreamingServerResolver.canResolveStream = (stream) => Boolean(stream.infoHash);
  try {
    assert.equal(
      TizenStreamingServerResolver.warmUpForStreams([{ url: "https://cdn.example/a.mkv" }]),
      false
    );
    assert.equal(
      TizenStreamingServerResolver.warmUpForStreams([
        { url: "https://cdn.example/a.mkv" },
        { infoHash: "a".repeat(40) }
      ]),
      true
    );
    assert.deepEqual(calls, [{ purpose: "p2p" }]);
  } finally {
    TizenEngineFsService.ensureStarted = original;
    TizenStreamingServerResolver.canResolveStream = originalCanResolve;
  }
});
