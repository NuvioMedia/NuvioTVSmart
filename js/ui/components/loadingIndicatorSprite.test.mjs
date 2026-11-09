import assert from "node:assert/strict";
import test from "node:test";

const { resolveLoaderSpriteDelay, loaderSpriteFramesFor } = await import("./loadingIndicator.js");

test("a sprite that replaces a running arc keeps the current frame", () => {
  const node = {
    querySelector: (selector) =>
      selector === ".nuvio-loading-indicator-arc"
        ? { getAnimations: () => [{ currentTime: 500 }] }
        : null
  };

  assert.equal(resolveLoaderSpriteDelay(node), "-500ms");
});

test("a fresh loader starts the sprite at frame zero", () => {
  assert.equal(resolveLoaderSpriteDelay({ querySelector: () => null }), "0ms");
  assert.equal(
    resolveLoaderSpriteDelay({
      querySelector: () => ({ getAnimations: () => [] })
    }),
    "0ms"
  );
  assert.equal(resolveLoaderSpriteDelay(null), "0ms");
});

test("modern TVs keep 60 fps, constrained and legacy TVs get the smaller strip", () => {
  assert.equal(
    loaderSpriteFramesFor({
      isTvRuntime: true,
      isPerformanceConstrained: false,
      isLegacyTvRuntime: false
    }),
    120
  );
  assert.equal(
    loaderSpriteFramesFor({
      isTvRuntime: true,
      isPerformanceConstrained: true,
      isLegacyTvRuntime: false
    }),
    60
  );
  assert.equal(
    loaderSpriteFramesFor({
      isTvRuntime: true,
      isPerformanceConstrained: false,
      isLegacyTvRuntime: true
    }),
    60
  );
});
