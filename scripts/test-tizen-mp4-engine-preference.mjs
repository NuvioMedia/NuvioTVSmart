// Tizen direct MP4: the browser player is preferred only when the persisted
// compatibility switch is on. Every other source -- and all local EngineFS
// playback -- must keep the existing AVPlay-first order.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { Platform } = await import("../js/platform/index.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { normalizePlayerSettings } = await import("../js/data/local/playerSettingsStore.js");
const { shouldAllowNativePlaybackDuringStartupAudioGate } =
  await import("../js/core/player/startupAudioGatePolicy.js");
const { TizenPlaybackProxy } = await import("../js/platform/tizen/tizenPlaybackProxy.js");
const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");

assert.equal(shouldAllowNativePlaybackDuringStartupAudioGate({}), false);
assert.equal(
  shouldAllowNativePlaybackDuringStartupAudioGate({ isTizenMp4NativeFilePlayback: true }),
  true
);

assert.equal(normalizePlayerSettings({}).tizenMp4NativeFile, true);
assert.equal(normalizePlayerSettings({ tizenMp4NativeFile: false }).tizenMp4NativeFile, false);

Platform.isTizen = () => true;
Platform.isWebOS = () => false;

Object.assign(PlayerController, {
  canUseAvPlay: () => true,
  getPlatformAvplayEngineName: () => "tizen-avplay",
  canUseHlsJs: () => false,
  canUseDashJs: () => false,
  canPlayNatively: () => false,
  isLivePlaybackItemType: () => false,
  shouldPreferTvNativePipeline: () => true,
  currentItemType: "movie"
});

const ant1Mp4 =
  "https://antennavodgcp.antenna.gr/prod-multimedia/videos/8_kairos_0211_7bb0648df0.mp4";
const engineFsUrl = `http://127.0.0.1:2710/${"a".repeat(40)}/1/`;

PlayerController.tizenMp4NativeFileEnabled = false;
assert.deepEqual(PlayerController.getPlaybackEngineCandidates(ant1Mp4, "video/mp4", "movie"), [
  "tizen-avplay"
]);
assert.equal(PlayerController.choosePlaybackEngine(ant1Mp4, "video/mp4"), "tizen-avplay");

PlayerController.tizenMp4NativeFileEnabled = true;
// Without MediaSource the compatibility path cannot run; stay on AVPlay.
delete globalThis.MediaSource;
assert.deepEqual(PlayerController.getPlaybackEngineCandidates(ant1Mp4, "video/mp4", "movie"), [
  "tizen-avplay"
]);
assert.equal(PlayerController.choosePlaybackEngine(ant1Mp4, "video/mp4"), "tizen-avplay");

globalThis.MediaSource = function MediaSource() {};
assert.deepEqual(PlayerController.getPlaybackEngineCandidates(ant1Mp4, "video/mp4", "movie"), [
  "mse-mp4",
  "tizen-avplay"
]);
assert.equal(PlayerController.choosePlaybackEngine(ant1Mp4, "video/mp4"), "mse-mp4");

// The switch is MP4-only: Matroska and other progressive sources keep AVPlay.
assert.deepEqual(
  PlayerController.getPlaybackEngineCandidates(
    "https://example.com/movie.mkv",
    "video/x-matroska",
    "movie"
  ),
  ["tizen-avplay"]
);
assert.equal(
  PlayerController.choosePlaybackEngine("https://example.com/movie.mkv", "video/x-matroska"),
  "tizen-avplay"
);

// Local EngineFS MP4 keeps its current AVPlay-first order.
assert.deepEqual(PlayerController.getPlaybackEngineCandidates(engineFsUrl, "video/mp4", "movie"), [
  "tizen-avplay",
  "native-file"
]);
assert.equal(PlayerController.choosePlaybackEngine(engineFsUrl, "video/mp4"), "tizen-avplay");

// The M4V extension resolves to video/mp4 and opts in as well.
assert.deepEqual(
  PlayerController.getPlaybackEngineCandidates(
    "https://cdn.example/stream/clip.m4v",
    null,
    "movie"
  ),
  ["mse-mp4", "tizen-avplay"]
);

// A declared MP4 type opts in even when the URL has no extension.
assert.deepEqual(
  PlayerController.getPlaybackEngineCandidates(
    "https://cdn.example/stream/12345",
    "video/mp4",
    "movie"
  ),
  ["mse-mp4", "tizen-avplay"]
);
assert.equal(
  PlayerController.choosePlaybackEngine("https://cdn.example/stream/12345", "video/mp4"),
  "mse-mp4"
);

// The MSE path reads the CDN directly; the TV-local proxy stalled long reads.
// Only declared headers that the browser cannot send route it through the proxy.
TizenEngineFsService.ensureStarted = async () => ({
  status: "success",
  baseUrl: "http://127.0.0.1:2710"
});
const directRoute = await TizenPlaybackProxy.resolve(ant1Mp4, {}, { playbackEngine: "mse-mp4" });
assert.equal(directRoute.status, "not-required");
assert.equal(directRoute.url, ant1Mp4);
const headerRoute = await TizenPlaybackProxy.resolve(
  ant1Mp4,
  { Authorization: "Bearer x" },
  { playbackEngine: "mse-mp4" }
);
assert.equal(headerRoute.proxied, true);
assert.match(headerRoute.url, /^http:\/\/127\.0\.0\.1:2710\/proxy\//);

console.log("tizen mp4 engine preference tests passed");
