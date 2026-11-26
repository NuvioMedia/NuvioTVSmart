// EngineFS replaces its built-in tracker list with the app's peerSearch sources.
// Android always announces to its default trackers plus the addon's (#1388), so
// every source list the app builds must carry them too.
import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
  getItem: (key) =>
    key === "torrentSettings" ? JSON.stringify({ p2pEnabled: true, torrentProfile: "FAST" }) : null,
  setItem() {},
  removeItem() {}
};

const { DEFAULT_TORRENT_TRACKERS } = await import("../js/core/p2p/defaultTorrentTrackers.js");
const { buildPeerSearchSources } = await import("../js/core/p2p/tizenStreamingServerResolver.js");
const { buildNuvioPeerSearchSources, buildDirectCreateBody } =
  await import("../js/core/p2p/webOsEngineFsResolverHelpers-02-describe-error.js");

const infoHash = "a".repeat(40);
const defaults = DEFAULT_TORRENT_TRACKERS.map((tracker) => `tracker:${tracker}`);
const addonTracker = "udp://addon.example:1337/announce";

test("Tizen create sources keep DHT, the default trackers and the addon trackers", () => {
  assert.deepEqual(buildPeerSearchSources(infoHash), [`dht:${infoHash}`, ...defaults]);
  assert.deepEqual(
    buildPeerSearchSources(infoHash, [addonTracker, `tracker:${DEFAULT_TORRENT_TRACKERS[0]}`]),
    [`dht:${infoHash}`, ...defaults, `tracker:${addonTracker}`]
  );
});

test("webOS create sources keep the default trackers next to the addon trackers", () => {
  assert.deepEqual(buildNuvioPeerSearchSources(infoHash, [addonTracker]), [
    `dht:${infoHash}`,
    ...defaults,
    `tracker:${addonTracker}`
  ]);
});

test("a webOS profile override without addon trackers does not fall back to DHT only", () => {
  const body = buildDirectCreateBody({ infoHash, hasExplicitFileIdx: true });
  assert.deepEqual(body.peerSearch.sources, [`dht:${infoHash}`, ...defaults]);
  assert.equal(body.peerSearch.min, 60);
  assert.equal(body.peerSearch.max, 300);
});
