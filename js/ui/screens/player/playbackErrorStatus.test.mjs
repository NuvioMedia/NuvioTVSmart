import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { PlayerController } = await import("../../../core/player/playerController.js");
const { createPlayerScreenMethods16 } =
  await import("./playerScreenMethods-16-refresh-loading-overlay-presentation.js");
const { createPlayerScreenMethods17 } =
  await import("./playerScreenMethods-17-get-web-header-restricted-stream-message.js");
const { createPlayerScreenMethods18 } =
  await import("./playerScreenMethods-18-start-player-controller-playback.js");
const { createPlayerScreenMethods35 } =
  await import("./playerScreenMethods-35-play-stream-candidate.js");
const { createPlayerControllerMethods11 } =
  await import("../../../core/player/playerControllerMethods-11-get-av-play-diagnostic-snapshot.js");

const candidate = {
  behaviorHints: {
    notWebReady: true,
    proxyHeaders: { request: { Referer: "https://example.test" } }
  }
};
const screen = {
  ...createPlayerScreenMethods16(),
  ...createPlayerScreenMethods17(),
  ...createPlayerScreenMethods18(),
  ...createPlayerScreenMethods35(),
  getCurrentStreamCandidate: () => candidate,
  isDebridPlaybackCandidate: () => false
};
function hlsFailure(error, { fatal = true, active = false, engine = "hls.js" } = {}) {
  PlayerController.playbackEngine = engine;
  PlayerController.hlsInstance = active ? {} : null;
  PlayerController.lastHlsErrorDiagnostic = {
    type: "networkError",
    details: "manifestLoadError",
    error,
    fatal
  };
}
const HLS_404 = "A network error (status 404) occurred while loading manifest";
const HLS_403 = "HTTP Error 403 Forbidden";

test("reported webOS failures use HTTP messages in startup and ongoing playback", () => {
  for (const [detail, status, explanation] of [
    [HLS_404, 404, /expired or been removed/],
    [HLS_403, 403, /blocked or restricted/]
  ]) {
    hlsFailure(detail);
    for (const code of [0, 2, 4]) {
      for (const message of [screen.getStartupErrorMessage(code), screen.mediaErrorMessage(code)]) {
        assert.match(message, new RegExp(`HTTP ${status}`));
        assert.match(message, explanation);
        assert.doesNotMatch(message, /special request headers/);
      }
    }
  }
});

test("current event status takes precedence over cached HLS status", () => {
  hlsFailure(HLS_404);
  const detail = screen.getPlaybackEventErrorDetail({ hlsResponseCode: 503 });
  assert.match(screen.getStartupErrorMessage(2, detail), /HTTP 503/);
  assert.match(screen.mediaErrorMessage(2, "HTTP 500 upstream"), /HTTP 500/);
});

test("absent HTTP status preserves header and ordinary media errors", () => {
  hlsFailure("bufferSeekOverHole", { fatal: false });
  for (const code of [0, 2, 4]) {
    assert.match(screen.getStartupErrorMessage(code), /special request headers/);
    assert.match(screen.mediaErrorMessage(code), /special request headers/);
  }
  assert.equal(screen.mediaErrorMessage(2, "", {}), "Network error");
  assert.match(screen.mediaErrorMessage(3, "", {}), /Decoder error/);
  assert.equal(screen.mediaErrorMessage(1, "", {}), "Playback aborted");
});

test("recovered or other-engine errors cannot reuse a cached HTTP failure", () => {
  for (const options of [
    { fatal: false },
    { active: true },
    { engine: "native-hls" },
    { engine: "avplay" },
    { engine: "dash.js" }
  ]) {
    hlsFailure(HLS_404, options);
    assert.equal(screen.resolvePlaybackHttpStatus(), 0);
    assert.equal(screen.mediaErrorMessage(2, "", {}), "Network error");
    assert.match(screen.mediaErrorMessage(3, "", {}), /Decoder error/);
    assert.match(screen.getStartupErrorMessage(4), /special request headers/);
  }
});

test("new playback with a cleared diagnostic does not inherit a status", () => {
  hlsFailure(HLS_404);
  PlayerController.lastHlsErrorDiagnostic = null;
  assert.equal(screen.resolvePlaybackHttpStatus(), 0);
});

test("HTTP explanation ranges match Android TV, including uncommon 4xx and 5xx", () => {
  hlsFailure("");
  for (const [statuses, explanation] of [
    [[401, 410], /link has expired/],
    [[404], /expired or been removed/],
    [[429], /Too many requests/],
    [[400, 403, 405, 416, 451, 499], /blocked or restricted/],
    [[500, 501, 502, 503, 504, 507, 599], /server is currently unavailable/]
  ]) {
    for (const status of statuses) {
      const message = screen.getStartupErrorMessage(4, `HTTP ${status}`);
      assert.match(message, new RegExp(`HTTP ${status}`));
      assert.match(message, explanation);
    }
  }
  for (const status of [0, 200, 399, 600])
    assert.equal(screen.getHttpPlaybackErrorMessage(status), "");
});

test("production HLS diagnostic preserves captured text and structured response codes", () => {
  const controller = { lastHlsErrorDiagnostic: null, ...createPlayerControllerMethods11() };
  for (const [error, responseCode, expected] of [
    [HLS_404, null, 404],
    [HLS_403, null, 403],
    ["", 503, 503]
  ]) {
    controller.lastHlsErrorDiagnostic = { error, responseCode, fatal: true };
    hlsFailure("");
    PlayerController.lastHlsErrorDiagnostic = controller.lastHlsErrorDiagnostic;
    assert.equal(screen.resolvePlaybackHttpStatus(controller.getLastHlsErrorDetail()), expected);
    assert.equal(screen.resolvePlaybackHttpStatus(), expected);
  }
});
