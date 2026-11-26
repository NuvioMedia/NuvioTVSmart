import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [methods01Source, methods02Source, methods03Source, home12Source, detail20Source] =
  await Promise.all(
    [
      "./routerMethods-01-get-route-state-key.js",
      "./routerMethods-02-complete-route-return-back-guard.js",
      "./routerMethods-03-back.js",
      "../screens/home/homeScreenMethods-12-sync-collection-hero-media.js",
      "../screens/detail/metaDetailsScreenMethods-20-stop-trailer-playback.js"
    ].map(async (relPath) => stripModule(await readFile(new URL(relPath, import.meta.url), "utf8")))
  );

function loadFactory(source, factoryName, internals, globals = {}) {
  const sandbox = {
    internals,
    console,
    Date,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Set,
    Map,
    WeakMap,
    Promise,
    setTimeout,
    clearTimeout,
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

function createMockHistory({ mode = "async", popstateDelayMs = 10, onBack = null } = {}) {
  const entries = [];
  const listeners = [];
  let index = -1;
  const history = {
    entries,
    listeners,
    replaceCalls: [],
    backCalls: 0,
    get index() {
      return index;
    },
    get state() {
      return index >= 0 ? entries[index] : null;
    },
    replaceState(state) {
      this.replaceCalls.push(state);
      if (index < 0) {
        entries.push(state);
        index = 0;
      } else {
        entries[index] = state;
      }
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index = entries.length - 1;
    },
    back() {
      this.backCalls += 1;
      onBack?.();
      if (mode === "swallow") {
        // Simulates Chromium unwinding a child iframe's joint-session-history
        // entry: top-window history.state stays on the current route and no
        // popstate event fires.
        return;
      }
      if (index <= 0) {
        return;
      }
      index -= 1;
      const nextState = entries[index];
      const dispatch = () => {
        listeners.slice().forEach((listener) => {
          void listener({ state: nextState });
        });
      };
      if (mode === "sync") {
        dispatch();
      } else {
        setTimeout(dispatch, popstateDelayMs);
      }
    }
  };
  return history;
}

async function createRouterHarness({
  isTizen = true,
  historyOptions = {},
  routes = null,
  guardMs = 40
} = {}) {
  const history = createMockHistory(historyOptions);
  const window = {
    history,
    addEventListener: (name, listener) => {
      if (name === "popstate") history.listeners.push(listener);
    }
  };
  const internals = {
    Platform: { isWebOS: () => false, isTizen: () => isTizen, exitApp: () => {} },
    TizenCapabilities: { canUsePlugins: () => true },
    LocalStore: { get: (_key, fallback) => fallback, set: () => {}, remove: () => {} },
    RouteStateStore: { clear: () => {}, get: () => null, set: () => {} },
    ROUTER_PERF_DEBUG: false,
    routerPerfNow: () => 0,
    logRouterPerf: () => {},
    markBootTiming: () => {},
    NON_BACKSTACK_ROUTES: new Set(),
    openPendingLaunchDeepLink: async () => {},
    WEBOS_RESUME_ROUTE_KEY: "k",
    WEBOS_RESUME_ROUTE_TTL_MS: 1000,
    TIZEN_ROUTE_RETURN_BACK_GUARD_MS: guardMs,
    WEBOS_NON_RESTORABLE_ROUTES: new Set(),
    getStackEntryRoute: (entry) => (typeof entry === "string" ? entry : String(entry?.route || "")),
    getStackEntryParams: (entry) => (typeof entry === "string" ? {} : entry?.params || {}),
    resolvePendingHistoryReturnParams: (pending, state, entry) =>
      entry?.params || pending.params || {}
  };
  const makeScreen = () => ({
    mountCalls: [],
    cleanupCalls: 0,
    mount: async function (params, context) {
      this.mountCalls.push({ params, context });
    },
    cleanup: function () {
      this.cleanupCalls += 1;
    },
    consumeBackRequest: () => false
  });
  const router = {
    current: null,
    currentParams: {},
    stack: [],
    historyInitialized: false,
    webOsHomeBackGuardInitialized: false,
    popstateBound: false,
    suppressPopstateUntil: 0,
    skipConsumeNextPopstate: false,
    ignoreNextPopstate: false,
    routeReturnBackGuardActive: false,
    routeReturnBackGuardUntil: 0,
    routeReturnBackGuardNavigationId: 0,
    pendingHistoryReturn: null,
    pendingPostPlayNavigation: null,
    routes: routes || {
      home: makeScreen(),
      folderDetail: makeScreen(),
      detail: makeScreen()
    },
    ...loadFactory(methods01Source, "createRouterMethods01", internals, { window })(),
    ...loadFactory(methods02Source, "createRouterMethods02", internals, { window })(),
    ...loadFactory(methods03Source, "createRouterMethods03", internals, { window })()
  };
  router.init();
  return { router, history, window };
}

test("Router.navigate completes Tizen route-return back guard when mount rejects or cleanup throws", async () => {
  const { router } = await createRouterHarness({ isTizen: true, guardMs: 25 });
  await router.navigate("home", {});
  await router.navigate("folderDetail", { folderId: "f1" });

  // 1. Async mount failure during Back navigation must not leave guardUntil = Infinity.
  const originalHomeMount = router.routes.home.mount;
  router.routes.home.mount = async () => {
    throw new Error("simulated mount error");
  };
  await assert.rejects(
    () =>
      router.navigate(
        "home",
        {},
        { fromHistory: true, skipStackPush: true, isBackNavigation: true }
      ),
    /simulated mount error/
  );
  assert.equal(router.pendingMountParams, null);
  assert.equal(
    Number.isFinite(router.routeReturnBackGuardUntil),
    true,
    "mount rejection must complete the route-return back guard instead of leaving Infinity"
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(
    router.consumeRouteReturnBackGuard(),
    false,
    "Back and Exit must remain unlocked after the short guard window expires"
  );

  // 2. Synchronous cleanup failure during Back navigation must not leave guardUntil = Infinity.
  router.routes.home.mount = originalHomeMount;
  await router.navigate("folderDetail", { folderId: "f2" });
  router.routes.folderDetail.cleanup = () => {
    throw new Error("simulated cleanup error");
  };
  await assert.rejects(
    () =>
      router.navigate(
        "home",
        {},
        { fromHistory: true, skipStackPush: true, isBackNavigation: true }
      ),
    /simulated cleanup error/
  );
  assert.equal(
    Number.isFinite(router.routeReturnBackGuardUntil),
    true,
    "cleanup throw must complete the route-return back guard instead of leaving Infinity"
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(router.consumeRouteReturnBackGuard(), false);

  // 3. Unknown route with isBackNavigation must never arm an infinite guard.
  const prevError = console.error;
  console.error = () => {};
  try {
    await router.navigate("doesNotExist", {}, { isBackNavigation: true });
  } finally {
    console.error = prevError;
  }
  assert.equal(router.routeReturnBackGuardActive, false);
  assert.equal(router.routeReturnBackGuardUntil, 0);
});

test("Router.back detaches trailer iframes before history.back and falls back when an iframe swallows popstate", async () => {
  const order = [];
  const { router, history } = await createRouterHarness({
    isTizen: true,
    historyOptions: {
      mode: "swallow",
      onBack: () => order.push("history.back")
    }
  });
  router.routes.folderDetail.clearHomeTrailerLayers = () => {
    order.push("clearHomeTrailerLayers");
  };
  router.routes.detail.stopTrailerPlaybackForNavigation = () => {
    order.push("stopTrailerPlaybackForNavigation");
  };

  await router.navigate("home", {});
  await router.navigate("folderDetail", { folderId: "recommended" });
  const homeMountsBeforeBack = router.routes.home.mountCalls.length;

  await router.back();

  assert.deepEqual(
    order,
    ["clearHomeTrailerLayers", "history.back"],
    "active trailer iframes must be torn down before window.history.back()"
  );

  // Wait for the joint-session-history fallback to recover from the missing popstate.
  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.equal(
    router.current,
    "home",
    "Router.back() must recover to Home when a child iframe swallows window.history.back()"
  );
  assert.equal(router.routes.home.mountCalls.length, homeMountsBeforeBack + 1);
  assert.equal(router.routes.home.mountCalls.at(-1).context.isBackNavigation, true);
  assert.equal(router.routes.home.mountCalls.at(-1).context.previousRoute, "folderDetail");
  assert.equal(
    history.state?.route,
    "home",
    "fallback must sync window.history.state via replaceState"
  );

  // A late popstate arriving after the fallback must be suppressed without double-mounting Home.
  for (const listener of history.listeners) {
    await listener({ state: { route: "home", params: {} } });
  }
  assert.equal(router.routes.home.mountCalls.length, homeMountsBeforeBack + 1);

  // Verify MetaDetailsScreen also stops trailers before history.back().
  order.length = 0;
  await router.navigate("detail", { itemId: "tt123" });
  await router.back();
  assert.deepEqual(order, ["stopTrailerPlaybackForNavigation", "history.back"]);
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(router.current, "home");
});

test("Router.back does not double-navigate when normal async popstate fires while Home mount is still running", async () => {
  const { router } = await createRouterHarness({
    isTizen: true,
    historyOptions: { mode: "async", popstateDelayMs: 15 }
  });

  await router.navigate("home", {});
  await router.navigate("folderDetail", { folderId: "recommended" });

  let homeMountCount = 0;
  router.routes.home.mount = async () => {
    homeMountCount += 1;
    // Deliberately slower than the fallback timeout to verify navigate() cancels it immediately.
    await new Promise((resolve) => setTimeout(resolve, 280));
  };

  await router.back();
  await new Promise((resolve) => setTimeout(resolve, 420));

  assert.equal(router.current, "home");
  assert.equal(homeMountCount, 1, "normal popstate must cancel the fallback and mount Home once");
});

test("HomeScreen.clearTrailerLayer and MetaDetailsScreen.stopTrailerPlayback detach iframe before writing about:blank", () => {
  const homeEvents = [];
  const homeIframe = {
    dataset: {},
    contentWindow: { postMessage() {} },
    remove() {
      homeEvents.push("remove");
    },
    set src(value) {
      homeEvents.push(`src:${value}`);
    },
    removeAttribute(name) {
      homeEvents.push(`removeAttribute:${name}`);
    }
  };
  const homeApi = loadFactory(
    home12Source,
    "createHomeScreenMethods12",
    {
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      firstNonEmpty: (...values) => values.find(Boolean) || "",
      isCollectionFolderItem: () => false,
      normalizeCollectionFolderItem: (item) => item
    },
    { getTrailerCleanupDelayMs: () => 5000 }
  )();
  const homeScreen = Object.assign(Object.create(homeApi), {
    mountedHomeTrailerLayers: new Set(),
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap(),
    homeTrailerFrameCleanup: new WeakMap()
  });
  const homeLayer = {
    classList: { contains: () => true, remove() {} },
    firstElementChild: homeIframe,
    querySelector: (selector) => (selector === "iframe" ? homeIframe : null),
    innerHTML: "<iframe></iframe>"
  };
  homeScreen.clearTrailerLayer(homeLayer);
  assert.deepEqual(
    homeEvents,
    ["remove", "src:about:blank", "removeAttribute:src"],
    "HomeScreen.clearTrailerLayer must detach the iframe before assigning about:blank"
  );

  const detailEvents = [];
  let detailAttached = true;
  const detailIframe = {
    remove() {
      detailAttached = false;
      detailEvents.push("remove");
    },
    set src(value) {
      detailEvents.push(`src:${value}`);
    },
    removeAttribute(name) {
      detailEvents.push(`removeAttribute:${name}`);
    }
  };
  const detailApi = loadFactory(detail20Source, "createMetaDetailsScreenMethods20", {
    ScreenUtils: { indexFocusables() {} },
    localizedGenreLabel: (g) => g,
    contentTextDirection: () => "ltr",
    renderLoadingIndicator: () => "",
    detectQuality: () => "",
    renderStreamAddonIcon: () => ""
  })();
  const detailLayer = {
    querySelector: (selector) => (selector === "iframe" && detailAttached ? detailIframe : null),
    innerHTML: "<iframe></iframe>"
  };
  const detailScreen = Object.assign(Object.create(detailApi), {
    container: {
      querySelector: (selector) => (selector === ".detail-trailer-layer" ? detailLayer : null)
    },
    trailerSource: { kind: "youtube" },
    trailerVisualReady: false,
    postTrailerProxyCommand() {},
    stopTrailerProgressTimer() {},
    stopTrailerControlsTimer() {},
    stopTrailerProxyLoadingTimer() {},
    detachTrailerMediaListeners() {},
    destroyYoutubeTrailerPlayer() {},
    restartTrailerAutoplayTimer() {}
  });
  detailScreen.stopTrailerPlaybackForNavigation();
  assert.deepEqual(
    detailEvents,
    ["remove", "src:about:blank", "removeAttribute:src"],
    "MetaDetailsScreen.stopTrailerPlayback must detach the iframe before assigning about:blank"
  );
});
