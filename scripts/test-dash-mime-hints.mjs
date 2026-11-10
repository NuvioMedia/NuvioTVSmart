import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createController() {
  const context = vm.createContext({
    URL,
    internals: { Platform: { isTizen: () => false } }
  });
  const methods = {};
  for (const [file, factory] of [
    [
      "playerControllerMethods-01-is-expected-play-interruption.js",
      "createPlayerControllerMethods01"
    ],
    [
      "playerControllerMethods-12-get-playback-engine-candidates.js",
      "createPlayerControllerMethods12"
    ]
  ]) {
    const source = readFileSync(new URL(`../js/core/player/${file}`, import.meta.url), "utf8")
      .replace(/^import \* as internals from .*;\r?\n/gm, "")
      .replace(/^export /gm, "");
    Object.assign(methods, vm.runInContext(`${source}\n${factory}()`, context));
  }
  return Object.assign(methods, {
    getPlatformAvplayEngineName: () => "avplay",
    isLivePlaybackItemType: () => false,
    canUseAvPlay: () => false,
    shouldPreferTvNativePipeline: () => false,
    canUseHlsJs: () => false,
    canUseDashJs: () => true,
    canPlayNatively: () => false
  });
}

test("extensionless DASH MIME query hints select the DASH playback engine", () => {
  const controller = createController();
  for (const key of ["format", "type", "mime", "output"]) {
    for (const mime of ["application/dash+xml", "Application/Dash+XML; charset=UTF-8"]) {
      const url = `https://example.com/playback?${key}=${encodeURIComponent(mime)}`;
      assert.equal(controller.guessMediaMimeType(url), "application/dash+xml", url);
      assert.deepEqual(Array.from(controller.getPlaybackEngineCandidates(url)), ["dash.js"], url);
    }
  }
});

test("DASH aliases and manifest extensions keep their existing detection", () => {
  const controller = createController();
  for (const url of [
    "https://example.com/manifest.mpd?token=test",
    "https://example.com/playback?format=dash",
    "https://example.com/playback?type=mpd",
    "https://example.com/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmanifest.mpd"
  ]) {
    assert.equal(controller.guessMediaMimeType(url), "application/dash+xml", url);
  }
});

test("explicit file extensions and unrelated query values retain their behavior", () => {
  const controller = createController();
  assert.equal(
    controller.guessMediaMimeType("https://example.com/master.m3u8?mime=application%2Fdash%2Bxml"),
    "application/vnd.apple.mpegurl"
  );
  assert.equal(controller.guessMediaMimeType("https://example.com/movie.mp4"), "video/mp4");
  assert.equal(controller.guessMediaMimeType("https://example.com/playback?format=unknown"), null);
});
