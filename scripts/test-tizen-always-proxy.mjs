// Offline routing checks. No TV, network, build, signing or install calls.
// Playback methods and EngineFS startup are mocked; these do not prove decoding.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { Platform } = await import("../js/platform/index.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { TizenPlaybackProxy } = await import("../js/platform/tizen/tizenPlaybackProxy.js");
const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");
const { TizenPlaybackSettingsStore } =
  await import("../js/data/local/tizenPlaybackSettingsStore.js");

const groups = {};
function check(group, label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  groups[group] = (groups[group] || 0) + 1;
}
function proxyCheck(group, url, expected, headers = {}, options = {}) {
  check(
    group,
    `${url} / ${JSON.stringify(options)}`,
    TizenPlaybackProxy.requiresProxy(url, headers, options),
    expected
  );
}
function setEnabled(enabled) {
  TizenPlaybackSettingsStore.set({ alwaysUsePlaybackProxy: enabled });
}

const CDN = "https://cdn.example.com/movie.mkv";
const AIO = "https://aiostreams.example.com/api/v1/playback/fixture/movie.mkv";
const RESOLVE = "https://addon.example.com/resolve/fixture/movie.mkv";
const PROXY_PREFIX = "http://127.0.0.1:2710/proxy/";
const AUTH = { Authorization: "Bearer fixture" };
let isTizen = true;
let avplayAvailable = true;
let selectedEngine = "tizen-avplay";
let servicePlan = "success";
let fetchPlan = "redirect";
let started = null;
const serviceCalls = [];
const fetchCalls = [];
Platform.isTizen = () => isTizen;
Platform.isWebOS = () => false;
TizenEngineFsService.ensureStarted = async (options) => {
  serviceCalls.push(options);
  if (servicePlan === "throw") throw new Error("Fixture startup rejected");
  if (servicePlan === "unsupported")
    return { status: "unsupported", detail: "Fixture service not packaged" };
  if (servicePlan === "error") return { status: "error", detail: "Fixture service startup failed" };
  if (servicePlan === "unavailable")
    return { status: "unavailable", detail: "Fixture service unavailable" };
  if (servicePlan === "missing-base") return { status: "success" };
  return { status: "success", baseUrl: "http://127.0.0.1:2710" };
};
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  if (fetchPlan === "fail") throw new TypeError("Fixture network failure");
  return {
    url: fetchPlan === "redirect" ? CDN : url,
    status: 206,
    headers: { get: () => null },
    body: { cancel() {} }
  };
};
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
  stopProgressSaving: noop,
  cancelProgressSyncAfterSeek: noop,
  stopWebOsDtsAudioTranscode: noop,
  applyStartupAudioGateToVideo: noop,
  stopWebOsServiceKeepAlive: noop,
  clearWebOsTrackSelections: noop,
  startWebOsPlaybackKeepAlive: noop,
  choosePlaybackEngine: () => selectedEngine,
  ensureAdaptiveLibrariesForSource: async () => {},
  canUseAvPlay: () => avplayAvailable,
  getPlatformAvplayEngineName: () => "tizen-avplay",
  isLivePlaybackItemType: (itemType) => itemType === "tv",
  rememberPlaybackEngineAttempt: noop,
  teardownAdaptiveInstances: noop,
  teardownAvPlay: noop,
  resetNativeMediaState: noop,
  startProgressSaving: noop,
  playWithAvPlay(url, headers) {
    started = { url, headers, engine: "tizen-avplay" };
    return true;
  },
  playWithHlsJs(url, headers) {
    started = { url, headers, engine: "hls.js" };
    return true;
  },
  playWithDashJs(url) {
    started = { url, engine: "dash.js" };
    return true;
  },
  applyNativeSource(url, _sourceType, engine) {
    started = { url, engine };
  },
  attemptVideoPlay: noop
});

async function playSource(url, headers = {}, { engine = "tizen-avplay", itemType = "movie" } = {}) {
  started = null;
  serviceCalls.length = 0;
  fetchCalls.length = 0;
  selectedEngine = engine;
  try {
    await PlayerController.play(url, {
      itemType,
      requestHeaders: headers,
      mediaSourceType: url.includes(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : url.includes(".mpd")
          ? "application/dash+xml"
          : "video/x-matroska"
    });
    return started;
  } finally {
    // Prevent optional redirect-observer timers from creating unrelated fetches.
    PlayerController.cancelProxyRedirectObservation?.();
    PlayerController.cancelProxyRedirectObservation = null;
  }
}

check(
  "default",
  "A fresh device defaults off",
  TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy,
  false
);
proxyCheck("automatic", CDN, false);
proxyCheck("automatic", AIO, true);
proxyCheck("automatic", CDN, true, AUTH);
proxyCheck("automatic", CDN, false, { Cookie: "fixture=1" }, { playbackEngine: "tizen-avplay" });
proxyCheck("automatic", CDN, true, { Cookie: "fixture=1" }, { playbackEngine: "hls.js" });
check(
  "automatic",
  "Default mode preserves the AIO direct bypass",
  (await playSource(AIO)).url,
  CDN
);
check("automatic", "Default AIO bypass probes once", fetchCalls.length, 1);
check("automatic", "Default AIO bypass does not start the proxy", serviceCalls.length, 0);
check(
  "automatic",
  "Default mode preserves non-AIO redirect resolution",
  (await playSource(RESOLVE)).url,
  CDN
);
fetchPlan = "fail";
check(
  "automatic",
  "A failed AIO direct probe keeps automatic proxy fallback",
  (await playSource(AIO)).url.startsWith(PROXY_PREFIX),
  true
);
fetchPlan = "redirect";

setEnabled(true);
for (const url of [
  CDN,
  AIO,
  RESOLVE,
  "http://cdn.example.com/movie.mp4",
  "HTTPS://CDN.EXAMPLE.COM/movie.mkv",
  "https://cdn.example.com/master.m3u8",
  "https://cdn.example.com/manifest.mpd",
  "https://1.1.1.1/movie.mp4",
  "https://[2606:4700:4700::1111]/movie.mp4",
  "https://[::ffff:1.1.1.1]/movie.mp4",
  "http://172.15.255.254/movie.mp4",
  "http://172.32.0.1/movie.mp4"
]) {
  proxyCheck("enabled-remote", url, true);
  check(
    "enabled-remote",
    `Forced predicate agrees: ${url}`,
    TizenPlaybackProxy.isForcedRemoteSource(url),
    true
  );
}

for (const url of [
  "http://127.0.0.1:2710/proxy/fixture",
  "http://127.0.0.1:2710/0123456789abcdef0123456789abcdef01234567/0",
  "http://127.255.255.254/movie.mp4",
  "http://127.1/movie.mp4",
  "http://2130706433/movie.mp4",
  "http://localhost/movie.mp4",
  "http://media.localhost/movie.mp4",
  "http://localhost./movie.mp4",
  "http://[::1]/movie.mp4",
  "http://[::ffff:127.0.0.1]/movie.mp4",
  "http://[::ffff:7f00:1]/movie.mp4"
]) {
  proxyCheck("loopback", url, false);
  proxyCheck("loopback", url, false, AUTH);
  check(
    "loopback",
    `Loopback is never forced: ${url}`,
    TizenPlaybackProxy.isForcedRemoteSource(url),
    false
  );
}
for (const url of [
  "http://10.0.0.1/movie.mp4",
  "http://172.16.0.1/movie.mp4",
  "http://172.31.255.254/movie.mp4",
  "http://192.168.7.164/movie.mp4",
  "http://169.254.1.1/movie.mp4",
  "http://100.64.0.1/movie.mp4",
  "http://[fc00::1]/movie.mp4",
  "http://[fd12:3456::1]/movie.mp4",
  "http://[fe80::1]/movie.mp4",
  "http://[::ffff:192.168.7.164]/movie.mp4",
  "http://nas/movie.mp4",
  "http://nas.local/movie.mp4",
  "http://nas.lan/movie.mp4",
  "http://nas.home.arpa/movie.mp4"
]) {
  proxyCheck("local", url, false);
  proxyCheck("local", url, true, AUTH);
  check(
    "local",
    `Local is not forced: ${url}`,
    TizenPlaybackProxy.isForcedRemoteSource(url),
    false
  );
}
for (const url of [
  "",
  "not a URL",
  "/movie.mp4",
  "magnet:?xt=urn:btih:fixture",
  "file:///movie.mp4",
  "blob:https://cdn.example/fixture",
  "rtsp://cdn.example/movie"
]) {
  proxyCheck("unsupported", url, false, AUTH);
  check(
    "unsupported",
    `Unsupported source is not forced: ${url}`,
    TizenPlaybackProxy.isForcedRemoteSource(url),
    false
  );
}
for (const url of [CDN, AIO]) {
  proxyCheck(
    "capability",
    url,
    false,
    {},
    { resolveRedirects: false, playbackEngine: "tizen-avplay" }
  );
  proxyCheck("capability", url, true, AUTH, {
    resolveRedirects: false,
    playbackEngine: "tizen-avplay"
  });
  proxyCheck(
    "capability",
    url,
    false,
    { Cookie: "fixture=1" },
    { resolveRedirects: false, playbackEngine: "tizen-avplay" }
  );
  proxyCheck(
    "capability",
    url,
    true,
    { Cookie: "fixture=1" },
    { resolveRedirects: false, playbackEngine: "hls.js" }
  );
}

for (const url of [CDN, AIO, RESOLVE]) {
  const result = await playSource(url);
  check("enabled-player", `Proxy selected for ${url}`, result.url.startsWith(PROXY_PREFIX), true);
  check("enabled-player", `No direct redirect probe for ${url}`, fetchCalls.length, 0);
  check("enabled-player", `EngineFS started once for ${url}`, serviceCalls.length, 1);
}
for (const [url, engine] of [
  ["https://cdn.example.com/master.m3u8", "hls.js"],
  ["https://cdn.example.com/manifest.mpd", "dash.js"]
]) {
  const result = await playSource(url, {}, { engine });
  check("adaptive", `${engine} entrypoint proxied`, result.url.startsWith(PROXY_PREFIX), true);
  check("adaptive", `${engine} engine retained`, result.engine, engine);
}

function proxyHeaders(proxyUrl) {
  const parsed = new URL(proxyUrl);
  return new URLSearchParams(parsed.pathname.slice("/proxy/".length).split("/")[0]).getAll("h");
}
const result = await playSource(CDN, {
  ...AUTH,
  Referer: "https://app.example.com/",
  "User-Agent": "fixture-agent"
});
check(
  "headers",
  "Authorization forwarded",
  proxyHeaders(result.url).includes("Authorization:Bearer%20fixture"),
  true
);
check(
  "headers",
  "Referer forwarded with reserved characters encoded",
  proxyHeaders(result.url).includes("Referer:https%3A%2F%2Fapp.example.com%2F"),
  true
);

for (const plan of ["unavailable", "unsupported", "error", "throw", "missing-base"]) {
  servicePlan = plan;
  await assert.rejects(
    () => playSource(CDN),
    /proxy could not start.*Advanced settings/i,
    `Clear failure for ${plan}`
  );
  groups["service-failure"] = (groups["service-failure"] || 0) + 1;
  check("service-failure", `No playback start after ${plan}`, started, null);
  check("service-failure", `No direct probe after ${plan}`, fetchCalls.length, 0);
}
servicePlan = "unavailable";
await assert.rejects(
  () =>
    playSource(
      "https://cdn.example.com/master.m3u8",
      { Cookie: "fixture=1" },
      { engine: "hls.js" }
    ),
  /proxy could not start.*Advanced settings/i
);
check("service-failure", "Forced HLS cannot silently fall back to direct AVPlay", started, null);
servicePlan = "success";
avplayAvailable = false;
check(
  "engine-capability",
  "Force setting selects proxy without AVPlay",
  (await playSource(CDN, {}, { engine: "native-file" })).url.startsWith(PROXY_PREFIX),
  true
);
avplayAvailable = true;
isTizen = false;
check(
  "other-platform",
  "Setting does not route a non-Tizen native source",
  (await playSource(CDN, {}, { engine: "native-file" })).url,
  CDN
);
check("other-platform", "No Tizen service requested on another platform", serviceCalls.length, 0);
isTizen = true;

setEnabled(false);
check(
  "toggle-off",
  "Turning off takes effect without restarting",
  (await playSource(AIO)).url,
  CDN
);
check("toggle-off", "Direct bypass restored after turning off", fetchCalls.length, 1);
check("toggle-off", "Proxy service no longer needed for successful bypass", serviceCalls.length, 0);
proxyCheck("toggle-off", CDN, false);
proxyCheck("toggle-off", CDN, true, AUTH);

console.log(
  JSON.stringify(
    {
      suite: "tizen-always-proxy",
      passed: Object.values(groups).reduce((total, value) => total + value, 0),
      groups,
      networkRequestsMade: false,
      tvContacted: false,
      scope:
        "Source routing, mocked service failure and playback entrypoints; no decoding or adaptive child-request coverage"
    },
    null,
    2
  )
);
