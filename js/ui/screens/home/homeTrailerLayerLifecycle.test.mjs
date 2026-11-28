import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { applyTrailerCaptionParams } from "../../../core/detail/trailerCaptions.js";

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

test("later focus moves never slide a scheduled trailer cleanup deadline", () => {
  const screen = makeScreen(buildContext());
  const container = makeContainer("https://www.youtube.com/embed/abc");
  screen.clearTrailerLayer = () => {};

  screen.scheduleTrailerLayerCleanup(container);
  const firstTimer = screen.homeTrailerLayerCleanupTimers.get(container).timeoutId;

  // collapseFocusedPoster calls this on every D-pad move.
  screen.scheduleTrailerLayerCleanup(container);
  screen.scheduleTrailerLayerCleanup(container);

  assert.equal(
    screen.homeTrailerLayerCleanupTimers.get(container).timeoutId,
    firstTimer,
    "a pending cleanup must keep its original deadline"
  );
  screen.cancelTrailerLayerCleanup(container);
});

test("empty inactive trailer layers do not schedule a cleanup", () => {
  const screen = makeScreen(buildContext());
  const classes = new Set();
  const emptyLayer = {
    classList: {
      add: (name) => classes.add(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    firstElementChild: null,
    querySelector: () => null
  };

  screen.scheduleTrailerLayerCleanup(emptyLayer);

  assert.equal(screen.homeTrailerLayerCleanupTimers.has(emptyLayer), false);
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

test("buildYoutubeEmbedUrl produces deterministic proxy URLs so mounted trailer iframes can be reused", async () => {
  const helperSource = await readFile(
    new URL("./homeScreenHelpers-05-normalize-collection-folder-item.js", import.meta.url),
    "utf8"
  );
  const startIndex = helperSource.indexOf("export function resolveYoutubeId");
  assert.notEqual(startIndex, -1);

  const helperContext = vm.createContext({
    URL,
    URLSearchParams,
    applyTrailerCaptionParams,
    YOUTUBE_PROXY_URL: "https://proxy.example.test/embed",
    location: { href: "https://app.example.test/", origin: "https://app.example.test" }
  });
  helperContext.globalThis = helperContext;
  vm.runInContext(
    `${helperSource.slice(startIndex).replace(/^export /gm, "")}
globalThis.buildYoutubeEmbedUrl = buildYoutubeEmbedUrl;`,
    helperContext
  );

  const firstUrl = helperContext.buildYoutubeEmbedUrl("dQw4w9WgXcQ", { muted: true });
  const secondUrl = helperContext.buildYoutubeEmbedUrl("dQw4w9WgXcQ", { muted: true });
  assert.equal(firstUrl, secondUrl);
  assert.equal(new URL(firstUrl).searchParams.has("_cb"), false);

  const captionedUrl = new URL(
    helperContext.buildYoutubeEmbedUrl("dQw4w9WgXcQ", {
      muted: true,
      captionsEnabled: true,
      captionsLanguage: "it"
    })
  );
  assert.equal(captionedUrl.searchParams.get("cc_load_policy"), "1");
  assert.equal(captionedUrl.searchParams.get("cc_lang_pref"), "it");
  assert.equal(
    new URL(helperContext.buildYoutubeEmbedUrl("dQw4w9WgXcQ", { muted: true })).searchParams.get(
      "cc_load_policy"
    ),
    "0"
  );

  const context = buildContext();
  const screen = makeScreen(context);
  const container = makeContainer(firstUrl);
  let ready = false;
  screen.mountTrailerLayer(container, { kind: "youtube", embedUrl: secondUrl }, () => {
    ready = true;
  });

  assert.equal(ready, true);
  assert.equal(container.posted.length, 1);
});

test("a fresh YouTube trailer stays covered until its startup chrome is gone", async () => {
  const listeners = {};
  const timers = [];
  const frames = [];
  const context = vm.createContext({
    console,
    setTimeout: (fn, ms) => {
      timers.push(Number(ms) || 0);
      return setTimeout(fn, Math.min(Number(ms) || 0, 30));
    },
    clearTimeout,
    window: {
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      removeEventListener: (name) => {
        delete listeners[name];
      }
    },
    document: {
      createElement: () => {
        const frame = {
          dataset: {},
          contentWindow: {},
          listeners: {},
          isConnected: true,
          parentElement: null,
          addEventListener: (name, fn) => {
            frame.listeners[name] = fn;
          },
          setAttribute: () => {},
          removeAttribute: () => {},
          blur: () => {}
        };
        frames.push(frame);
        return frame;
      }
    },
    internals: {
      metaRepository: {},
      isCollectionFolderItem: () => false,
      resolveTrailerSource: () => null,
      withTimeout: (promise) => promise,
      resolveTrailerMetaWithTmdbFallback: async () => null,
      LayoutPreferences: { get: () => ({}) }
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.api = Object.assign(createHomeScreenMethods12(), createHomeScreenMethods13());`,
    context
  );

  const classes = new Set();
  const container = {
    classList: {
      add: (name) => classes.add(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    firstElementChild: null,
    querySelector: () => null,
    appendChild: (frame) => {
      container.firstElementChild = frame;
      frame.parentElement = container;
    }
  };
  const screen = Object.assign(Object.create(context.api), {
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap()
  });

  let ready = false;
  screen.mountTrailerLayer(
    container,
    {
      kind: "youtube",
      ytId: "dQw4w9WgXcQ",
      embedUrl: "https://proxy.example.test/embed?v=dQw4w9WgXcQ"
    },
    () => {
      ready = true;
    }
  );

  const frame = frames[0];
  assert.ok(frame, "the trailer iframe must be mounted");
  listeners.message?.({
    source: frame.contentWindow,
    data: { source: "nuvio-youtube-proxy", type: "firstFrame" }
  });

  assert.equal(
    classes.has("is-active"),
    false,
    "the layer must stay hidden while YouTube shows its chrome"
  );
  assert.ok(
    timers.some((ms) => ms >= 4000),
    "the reveal must wait for YouTube's startup chrome to disappear"
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(classes.has("is-active"), true);
  assert.equal(ready, true, "the preview must still report ready once it is visible");
});
