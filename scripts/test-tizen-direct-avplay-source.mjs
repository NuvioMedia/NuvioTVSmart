// Tizen AVPlay: play addon sources directly instead of through the local
// EngineFS proxy whenever they work without it.
//
// Field trace (Tizen 6.0): open(url(127.0.0.1:2710)) -> prepareAsync OK ->
// seekTo ERR PLAYER_ERROR_INVALID_STATE. Stremio opens the CDN URL directly
// and seeks fine on the same TV.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

const { Platform } = await import("../js/platform/index.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");

Platform.isTizen = () => true;
Platform.isWebOS = () => false;
TizenEngineFsService.ensureStarted = async () => ({
  status: "success",
  baseUrl: "http://127.0.0.1:2710"
});

const CDN = "https://cdn7.debrid.example/dl/abc/movie.mkv";
let fetchPlan;
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  if (fetchPlan === "fail") throw new TypeError("network");
  return {
    url: fetchPlan === "redirect" || fetchPlan === "redirect-forbidden" ? CDN : url,
    status: fetchPlan === "forbidden" || fetchPlan === "redirect-forbidden" ? 403 : 206,
    headers: { get: (name) => ({ "accept-ranges": "bytes" })[name] ?? null },
    body: { cancel() {} }
  };
};

let avplayUrl = null;
const noop = () => {};
Object.assign(PlayerController, {
  video: {
    pause: noop,
    removeAttribute: noop,
    load: noop,
    querySelectorAll: () => [],
    addEventListener: noop,
    dispatchEvent: noop
  },
  flushCurrentProgress: async () => {},
  stopWebOsDtsAudioTranscode: noop,
  applyStartupAudioGateToVideo: noop,
  stopWebOsServiceKeepAlive: noop,
  clearWebOsTrackSelections: noop,
  startWebOsPlaybackKeepAlive: noop,
  choosePlaybackEngine: () => "tizen-avplay",
  ensureAdaptiveLibrariesForSource: async () => {},
  canUseAvPlay: () => true,
  getPlatformAvplayEngineName: () => "tizen-avplay",
  isLivePlaybackItemType: () => false,
  rememberPlaybackEngineAttempt: noop,
  teardownAdaptiveInstances: noop,
  teardownAvPlay: noop,
  resetNativeMediaState: noop,
  startProgressSaving: noop,
  playWithAvPlay(url) {
    avplayUrl = url;
    return true;
  }
});

async function playSource(url, headers = {}) {
  avplayUrl = null;
  fetchCalls.length = 0;
  await PlayerController.play(url, { itemType: "movie", requestHeaders: headers });
  return avplayUrl;
}

const AIO = "https://aiostreams.example.com/api/v1/playback/xyz/movie.mkv";

// 1. AIOStreams redirect without extra headers -> direct CDN URL, no proxy.
fetchPlan = "redirect";
assert.equal(await playSource(AIO), CDN);
assert.equal(fetchCalls.length, 1, "one ranged request to follow the redirect");
assert.equal(PlayerController.currentPlaybackUrl, CDN);

// 2. Redirect cannot be followed -> previous behaviour (local proxy).
fetchPlan = "fail";
assert.match(await playSource(AIO), /^http:\/\/127\.0\.0\.1:2710\/proxy\//);

// 3. Origin refuses the request -> keep the proxy path.
fetchPlan = "forbidden";
assert.match(await playSource(AIO), /^http:\/\/127\.0\.0\.1:2710\/proxy\//);

// 4. Headers AVPlay cannot send itself (Referer, Authorization, ...): the proxy
// is only a fallback. A header-less probe that returns media plays directly...
fetchPlan = "redirect";
assert.equal(await playSource(AIO, { Referer: "https://site.example/" }), CDN);
assert.equal(fetchCalls.length, 1, "one header-less probe");
assert.equal(
  fetchCalls[0].init.headers.Referer,
  undefined,
  "probe never forwards the addon headers"
);
// ...while a CDN that refuses requests without the headers keeps the proxy.
fetchPlan = "redirect-forbidden";
assert.match(
  await playSource(AIO, { Authorization: "Bearer x" }),
  /^http:\/\/127\.0\.0\.1:2710\/proxy\//
);

// 5. Non-AIOStreams redirect endpoint (e.g. debrid resolve link) -> direct CDN.
fetchPlan = "redirect";
assert.equal(await playSource("https://addon.example/resolve/rd/abc/1/movie.mkv"), CDN);

// 6. Redirect target refuses the request -> keep the original source URL.
const RESOLVE = "https://addon.example/resolve/rd/abc/1/movie.mkv";
fetchPlan = "redirect-forbidden";
assert.equal(await playSource(RESOLVE), RESOLVE);

// 7. A direct start is recorded as such so PlayerScreen can fall back...
fetchPlan = "redirect";
assert.equal(await playSource(CDN), CDN);
assert.deepEqual(PlayerController.lastTizenAvPlayRoute, { url: CDN, viaLocalProxy: false });

// 8. ...and the fallback routes even a header-less source through the local
// proxy (servers with lowercase Content-Range stall AVPlay), without probing.
avplayUrl = null;
fetchCalls.length = 0;
await PlayerController.play(CDN, { itemType: "movie", forceLocalProxy: true });
assert.match(avplayUrl, /^http:\/\/127\.0\.0\.1:2710\/proxy\//);
assert.equal(fetchCalls.length, 0);
assert.deepEqual(PlayerController.lastTizenAvPlayRoute, { url: CDN, viaLocalProxy: true });

console.log("tizen direct avplay source tests passed");
