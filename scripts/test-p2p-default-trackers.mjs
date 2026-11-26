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

test("a Tizen stream with its own file index still announces the default trackers", async () => {
  // Same firmware as the #1609 reports: Tizen 6 reports web.service as absent.
  globalThis.__NUVIO_PLATFORM__ = "tizen";
  globalThis.tizen = {
    systeminfo: {
      getCapability(name) {
        if (name.includes("platform.version")) return "6.0";
        return false;
      }
    },
    application: { getCurrentApplication: () => ({ appInfo: { packageId: "NuvioTV001" } }) }
  };
  const { TizenStreamingServerResolver } =
    await import("../js/core/p2p/tizenStreamingServerResolver.js");
  const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");
  TizenEngineFsService.ensureStarted = async () => ({
    status: "success",
    baseUrl: "http://127.0.0.1:2710"
  });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error("the create call is not expected for an explicit file index");
  };

  const result = await TizenStreamingServerResolver.resolve({ infoHash, fileIdx: 3 }, {});

  assert.equal(result.status, "success");
  assert.deepEqual(requests, []);
  assert.deepEqual(new URL(result.stream.url).searchParams.getAll("tr"), [
    `dht:${infoHash}`,
    ...defaults
  ]);
});
