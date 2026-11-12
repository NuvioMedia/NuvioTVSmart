import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The trailer methods reach the whole app through homeScreenContext, so they
// are evaluated against stubs the way the other home tests do it. The point is
// to drive the real mount/cleanup code, not a copy of it.
const source = (
  await Promise.all(
    [
      "./homeScreenMethods-12-sync-collection-hero-media.js",
      "./homeScreenMethods-13-mount-trailer-layer.js"
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8"))
  )
)
  .map((moduleSource) =>
    moduleSource
      .replace(/^import [\s\S]*?";$/m, "")
      .replace(/^import [^;]+;$/gm, "")
      .replace(/^export /gm, "")
  )
  .join("\n");

function buildContext() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    cancelIdleCallback: () => {},
    getTrailerCleanupDelayMs: () => 5000,
    internals: {
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      firstNonEmpty: (...values) => values.find((value) => value) || "",
      isCollectionFolderItem: () => false,
      normalizeCollectionFolderItem: (item) => item
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.api = Object.assign(createHomeScreenMethods12(), createHomeScreenMethods13());`,
    context
  );
  return context;
}

function makeContainer(embedUrl) {
  const classes = new Set();
  const posted = [];
  const iframe = {
    dataset: { trailerSrc: embedUrl },
    contentWindow: {
      postMessage: (message, target) => posted.push({ message, target })
    }
  };
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    querySelector: (selector) => (selector === "iframe" ? iframe : null),
    firstElementChild: iframe,
    posted
  };
}

function makeScreen(context) {
  const screen = Object.assign(Object.create(context.api), {
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap()
  });
  return screen;
}

test("reusing the mounted trailer cancels the scheduled cleanup", async () => {
  const context = buildContext();
  const screen = makeScreen(context);
  const embedUrl = "https://www.youtube.com/embed/abc";
  const container = makeContainer(embedUrl);
  let cleanedUp = false;
  const timeoutId = setTimeout(() => {
    cleanedUp = true;
  }, 25);
  screen.homeTrailerLayerCleanupTimers.set(container, {
    idleId: 0,
    timeoutId,
    completed: false
  });

  let ready = false;
  screen.mountTrailerLayer(container, { kind: "youtube", embedUrl }, () => {
    ready = true;
  });

  assert.equal(ready, true, "the reused layer must still report ready");
  assert.equal(container.classList.contains("is-active"), true);
  assert.equal(container.posted.length, 1, "the reused iframe must be told to play");
  assert.equal(
    screen.homeTrailerLayerCleanupTimers.has(container),
    false,
    "the pending cleanup must be dropped before the layer is reused"
  );

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cleanedUp, false, "the old cleanup timer must not fire on a reused trailer");
});

test("reusing the mounted trailer clears the pending idle hide too", async () => {
  const context = buildContext();
  const screen = makeScreen(context);
  const embedUrl = "https://www.youtube.com/embed/abc";
  const container = makeContainer(embedUrl);
  container.classList.add("is-trailer-layer-idle-hidden");
  let hidden = false;
  const timeoutId = setTimeout(() => {
    hidden = true;
    container.classList.add("is-trailer-layer-idle-hidden");
  }, 25);
  screen.homeTrailerLayerHideTimers.set(container, timeoutId);

  screen.mountTrailerLayer(container, { kind: "youtube", embedUrl });

  assert.equal(
    container.classList.contains("is-trailer-layer-idle-hidden"),
    false,
    "the reused layer must be visible again"
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(hidden, false, "the old hide timer must not run after the reuse");
  assert.equal(screen.homeTrailerLayerHideTimers.has(container), false);
});

test("a later key never postpones a pending trailer cleanup", () => {
  const context = buildContext();
  const screen = makeScreen(context);
  const pending = makeContainer("https://www.youtube.com/embed/abc");
  const mounted = makeContainer("https://www.youtube.com/embed/def");
  screen.homeTrailerLayerCleanupTimers.set(pending, { idleId: 0, timeoutId: 0, completed: false });
  // Both trailers already played: only the cleanup timing is under test.
  pending.firstElementChild.dataset.trailerRevealed = "true";
  mounted.querySelector = () => ({ dataset: { trailerRevealed: "true" } });
  screen.container = { querySelectorAll: () => [pending, mounted] };
  screen.shouldUseImmediateFocusScroll = () => true;
  const scheduled = [];
  screen.scheduleTrailerLayerCleanup = (layer) => scheduled.push(layer);

  screen.refreshPendingHomeTrailerCleanup();

  assert.deepEqual(scheduled, [mounted]);
});

test("a trailer that has not shown a frame is dropped when focus moves, on any TV", async () => {
  const context = buildContext();
  const screen = makeScreen(context);
  const booting = makeContainer("https://www.youtube.com/embed/abc");
  const playing = makeContainer("https://www.youtube.com/embed/def");
  playing.firstElementChild.dataset.trailerRevealed = "true";
  screen.container = { querySelectorAll: () => [booting, playing] };
  screen.shouldUseImmediateFocusScroll = () => false;
  const cleared = [];
  screen.clearTrailerLayer = (layer) => cleared.push(layer);

  screen.refreshPendingHomeTrailerCleanup();
  screen.refreshPendingHomeTrailerCleanup();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(cleared, [booting]);
});
