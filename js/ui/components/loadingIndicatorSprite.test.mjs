import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("css pauses the hidden SVG arc animation after switching to the loader sprite", async () => {
  const cssSource = await readFile(
    new URL("../../../css/components-06.css", import.meta.url),
    "utf8"
  );
  assert.match(
    cssSource,
    /\.home-loading-spinner\.has-loader-sprite\s+\.nuvio-loading-indicator-arc\s*\{[^}]*animation:\s*none;/
  );
});

test("loader sprite caps DPR via getTvArtworkPixelRatio and captures SVG delay before pausing the arc", async () => {
  const source = await readFile(new URL("./loadingIndicator.js", import.meta.url), "utf8");
  let createdCanvas = null;
  const classes = new Set();
  const styles = new Map();
  const mountedNode = {
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name))
    },
    style: {
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name)
    },
    querySelector: (selector) =>
      selector === ".nuvio-loading-indicator-arc"
        ? {
            // Simulates animation: none clearing active animations once has-loader-sprite is added.
            getAnimations: () => (classes.has("has-loader-sprite") ? [] : [{ currentTime: 420 }])
          }
        : null
  };

  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    devicePixelRatio: 2,
    URL: {
      createObjectURL: () => "blob:loader-sprite",
      revokeObjectURL: () => {}
    },
    renderBrandWordmarkImage: () => "",
    isModernTvProfile: () => false,
    getTvArtworkPixelRatio: () => 1,
    getTvRuntimePerformanceProfile: () => ({
      isTvRuntime: true,
      isPerformanceConstrained: true,
      isLegacyTvRuntime: true
    }),
    window: {},
    requestIdleCallback: (cb) => cb(),
    document: {
      querySelectorAll: (selector) => (selector === ".home-loading-spinner" ? [mountedNode] : [])
    }
  });
  context.document.createElement = (tag) => {
    assert.equal(tag, "canvas");
    createdCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        scale() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        save() {},
        translate() {},
        beginPath() {},
        arc() {},
        stroke() {},
        restore() {}
      }),
      toBlob: (cb) => cb({ size: 1 })
    };
    return createdCanvas;
  };
  context.globalThis = context;

  vm.runInContext(
    `${source.replace(/^import [\s\S]*?from "[^"]+";\s*$/gm, "").replace(/^export /gm, "")}
globalThis.__loaderApi = { scheduleLoaderSprite };`,
    context
  );

  context.__loaderApi.scheduleLoaderSprite();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(createdCanvas.width, 96 * 60 * 1);
  assert.equal(createdCanvas.height, 96 * 1);
  assert.equal(classes.has("has-loader-sprite"), true);
  assert.equal(styles.get("--loader-sprite"), "url(blob:loader-sprite)");
  assert.equal(styles.get("--loader-sprite-delay"), "-420ms");

  // Re-applying the cached strip must not move the paused strip back to frame 0.
  context.__loaderApi.scheduleLoaderSprite();
  assert.equal(styles.get("--loader-sprite-delay"), "-420ms");
});
