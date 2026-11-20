import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

const storage = new Map();
const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;

globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { Platform } = await import("../../platform/index.js");
const { PlayerController } = await import("./playerController.js");
const { WebOsPlaybackProxy } = await import("../../platform/webos/webosPlaybackProxy.js");

const originalIsTizen = Platform.isTizen;
const originalIsWebOS = Platform.isWebOS;
const originalProxyRequires = WebOsPlaybackProxy.requiresProxy;
const originalProxyResolve = WebOsPlaybackProxy.resolve;

afterEach(() => {
  Platform.isTizen = originalIsTizen;
  Platform.isWebOS = originalIsWebOS;
  WebOsPlaybackProxy.requiresProxy = originalProxyRequires;
  WebOsPlaybackProxy.resolve = originalProxyResolve;
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.localStorage = originalLocalStorage;
});

test("webOS staged native playback validates playbackUrl after proxy rewrites currentPlaybackUrl", async () => {
  const requestedUrl = "https://addon.example/stream/movie.mkv";
  const proxiedUrl = "http://127.0.0.1:2710/proxy/proxied.mkv";
  const stagedCalls = [];
  let attemptPlayArgs = null;

  Platform.isTizen = () => false;
  Platform.isWebOS = () => true;
  WebOsPlaybackProxy.requiresProxy = () => true;
  WebOsPlaybackProxy.resolve = async () => ({
    proxied: true,
    status: "ready",
    baseUrl: "http://127.0.0.1:2710",
    headerNames: ["Referer"],
    url: proxiedUrl
  });
  globalThis.fetch = async () => {
    throw new TypeError("direct head failed");
  };

  const controller = Object.create(PlayerController);
  Object.assign(controller, {
    video: {
      canPlayType: () => "probably",
      pause() {},
      removeAttribute() {},
      load() {},
      querySelectorAll: () => [],
      addEventListener() {},
      dispatchEvent() {}
    },
    flushCurrentProgress: async () => {},
    stopWebOsDtsAudioTranscode() {},
    applyStartupAudioGateToVideo() {},
    stopWebOsServiceKeepAlive() {},
    stopWebOsPlaybackKeepAlive() {},
    startWebOsPlaybackKeepAlive() {},
    startWebOsServiceKeepAlive() {},
    syncWebOsPlaybackKeepAwake() {},
    clearWebOsTrackSelections() {},
    choosePlaybackEngine: () => "native-file",
    ensureAdaptiveLibrariesForSource: async () => {},
    canUseAvPlay: () => false,
    isLivePlaybackItemType: () => false,
    rememberPlaybackEngineAttempt() {},
    teardownAdaptiveInstances() {},
    teardownAvPlay() {},
    resetNativeMediaState() {},
    startProgressSaving() {},
    normalizeMimeType: (type) => String(type || "").toLowerCase(),
    isEngineFsPlaybackUrl: () => false,
    applyWebOsStagedNativeSource(url, engine) {
      stagedCalls.push({ url, engine });
    },
    prepareWebOsStagedNativePlayback: async () => {},
    attemptVideoPlay(args) {
      attemptPlayArgs = args;
    }
  });

  await controller.play(requestedUrl, {
    itemType: "movie",
    mediaSourceType: "video/x-matroska",
    requestHeaders: { Referer: "https://addon.example/" }
  });

  assert.equal(controller.currentPlaybackUrl, proxiedUrl);
  assert.deepEqual(stagedCalls, [{ url: proxiedUrl, engine: "native-file" }]);
  assert.ok(
    attemptPlayArgs,
    "attemptVideoPlay must run when playbackUrl matches currentPlaybackUrl"
  );
  assert.equal(controller.isPlaying, true);
});
