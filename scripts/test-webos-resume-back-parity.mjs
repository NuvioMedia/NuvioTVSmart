import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A webOS relaunch can restore the screen the user left. Android roots its nav
// graph at Home (MainActivity's startDestination), so Back from any restored
// destination returns into the app. These tests drive the real router methods
// to check the web app keeps that same root.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The routes webOS is allowed to restore, from WEBOS_NON_RESTORABLE_ROUTES.
const RESTORABLE_ROUTES = [
  "folderDetail",
  "library",
  "search",
  "settings",
  "catalogSeeAll",
  "tmdbEntityBrowse",
  "account",
  "trakt",
  "discover",
  "supportersContributors",
  "licensesAttributions",
  "castDetail"
];

function createHistory() {
  const entries = [];
  const listeners = [];
  let index = -1;
  return {
    entries,
    listeners,
    leftApp: false,
    get state() {
      return index >= 0 ? entries[index] : null;
    },
    get index() {
      return index;
    },
    routes() {
      return entries.map((entry) => String(entry?.route || ""));
    },
    replaceState(state) {
      if (index < 0) {
        entries.push(state);
        index = 0;
        return;
      }
      entries[index] = state;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index = entries.length - 1;
    },
    back() {
      if (index <= 0) {
        // Nothing left to pop. No popstate is emitted, and webOS hands the key
        // to the platform, which offers to close the app.
        this.leftApp = true;
        return;
      }
      index -= 1;
      return Promise.all(listeners.slice().map((listener) => listener({ state: entries[index] })));
    }
  };
}

// Evaluates one router method factory with the module's internals stubbed out,
// so the real navigate/back/seed code runs without pulling in every screen.
function loadFactory(relPath, factoryName, internals, globals) {
  const source = fs
    .readFileSync(path.join(ROOT, relPath), "utf8")
    .replace(/^import \* as internals from .*$/m, "")
    .replace(/^export function/m, "function");
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
    URLSearchParams,
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

function createRouter({ isWebOS = true } = {}) {
  const history = createHistory();
  const exits = [];
  const mounted = [];
  const window = {
    history,
    addEventListener: (name, listener) => {
      if (name === "popstate") history.listeners.push(listener);
    }
  };

  const NON_BACKSTACK_ROUTES = new Set([
    "profileSelection",
    "authQrSignIn",
    "authSignIn",
    "serverConnection",
    "syncCode",
    "experienceModeSelection",
    "essentialAddonSetup"
  ]);

  const internals = {
    Platform: {
      isWebOS: () => isWebOS,
      isTizen: () => false,
      exitApp: () => exits.push(true)
    },
    TizenCapabilities: { canUsePlugins: () => true },
    LocalStore: { get: (key, fallback) => fallback, set: () => {}, remove: () => {} },
    RouteStateStore: { clear: () => {} },
    ROUTER_PERF_DEBUG: false,
    routerPerfNow: () => 0,
    logRouterPerf: () => {},
    NON_BACKSTACK_ROUTES,
    openPendingLaunchDeepLink: async () => {},
    WEBOS_RESUME_ROUTE_KEY: "webos_last_resume_route",
    WEBOS_RESUME_ROUTE_TTL_MS: 20 * 60 * 1000,
    TIZEN_ROUTE_RETURN_BACK_GUARD_MS: 700,
    WEBOS_NON_RESTORABLE_ROUTES: new Set([
      ...NON_BACKSTACK_ROUTES,
      "debugConsole",
      "plugin",
      "plugins",
      "catalogOrder",
      "detail",
      "player",
      "stream",
      "watchParty"
    ]),
    getStackEntryRoute: (entry) => (typeof entry === "string" ? entry : String(entry?.route || "")),
    getStackEntryParams: (entry) => (typeof entry === "string" ? {} : entry?.params || {})
  };

  const methods01 = loadFactory(
    "js/ui/navigation/routerMethods-01-get-route-state-key.js",
    "createRouterMethods01",
    internals,
    { window }
  )();
  const methods02 = loadFactory(
    "js/ui/navigation/routerMethods-02-complete-route-return-back-guard.js",
    "createRouterMethods02",
    internals,
    { window }
  )();
  const methods03 = loadFactory(
    "js/ui/navigation/routerMethods-03-back.js",
    "createRouterMethods03",
    internals,
    { window }
  )();

  const screen = (name) => ({
    mount: async () => mounted.push(name),
    cleanup: () => {},
    consumeBackRequest: () => false
  });

  const router = {
    current: null,
    currentParams: {},
    stack: [],
    historyInitialized: false,
    webOsHomeBackGuardInitialized: false,
    suppressPopstateUntil: 0,
    skipConsumeNextPopstate: false,
    routeReturnBackGuardActive: false,
    routeReturnBackGuardUntil: 0,
    routeReturnBackGuardNavigationId: 0,
    pendingHistoryReturn: null,
    pendingPostPlayNavigation: null,
    routes: Object.fromEntries(["home", ...RESTORABLE_ROUTES].map((name) => [name, screen(name)])),
    captureCurrentRouteState() {},
    resolveNavigationContext: (route, params, options) => ({ ...options }),
    beginRouteReturnBackGuard: () => 0,
    suppressNextPopstate() {},
    ...methods01,
    ...methods02,
    ...methods03
  };
  router.getCurrentScreen = () => (router.current ? router.routes[router.current] : null);

  router.init();

  return { router, history, exits, mounted };
}

// Mirrors js/app.js: restore the route webOS saved, seeding Home under it.
async function restoreResumeRoute(router, route, params = {}) {
  router.seedWebOsResumeBackStack?.();
  await router.navigate(route, params, { replaceHistory: true, skipStackPush: true });
}

test("a restored webOS route keeps Home underneath it", async () => {
  const { router, history } = createRouter();

  await restoreResumeRoute(router, "folderDetail", { collectionId: "c1", folderId: "f1" });

  assert.equal(router.current, "folderDetail");
  assert.deepEqual(
    history.routes(),
    ["home", "folderDetail"],
    "Home must remain reachable behind the restored route"
  );
  assert.deepEqual(
    router.stack.map((entry) => entry.route),
    ["home"],
    "the logical back stack needs Home as its root, like Android's nav graph"
  );
});

test("Back from a restored route returns to Home instead of leaving the app", async () => {
  const { router, history, exits } = createRouter();

  await restoreResumeRoute(router, "folderDetail", { collectionId: "c1", folderId: "f1" });
  await router.back();
  await new Promise(setImmediate);

  assert.equal(history.leftApp, false, "Back must not reach the platform and offer to quit");
  assert.equal(exits.length, 0, "Back must not exit the app");
  assert.equal(router.current, "home", "Back returns to Home");
});

test("every route webOS can restore keeps a way back", async () => {
  for (const route of RESTORABLE_ROUTES) {
    const { router, history, exits } = createRouter();

    await restoreResumeRoute(router, route);
    await router.back();
    await new Promise(setImmediate);

    assert.equal(history.leftApp, false, `${route} traps the user when restored`);
    assert.equal(exits.length, 0, `${route} exits the app on Back when restored`);
    assert.equal(router.current, "home", `${route} does not return to Home on Back`);
  }
});

test("opening a folder from Home is unchanged", async () => {
  const { router, history, exits } = createRouter();

  await router.navigate("home", {});
  await router.navigate("folderDetail", { collectionId: "c1", folderId: "f1" });

  // Home, the webOS overlay guard entry, then the folder.
  assert.deepEqual(history.routes(), ["home", "home", "folderDetail"]);

  await router.back();
  await new Promise(setImmediate);

  assert.equal(history.leftApp, false);
  assert.equal(exits.length, 0);
  assert.equal(router.current, "home");
});

test("seeding is skipped once history is already initialized", async () => {
  const { router, history } = createRouter();

  await router.navigate("home", {});
  const before = history.routes();

  assert.equal(
    router.seedWebOsResumeBackStack(),
    false,
    "a running app must not get a second Home root"
  );
  assert.deepEqual(history.routes(), before);
});

test("seeding does nothing off webOS", async () => {
  const { router, history } = createRouter({ isWebOS: false });

  assert.equal(router.seedWebOsResumeBackStack(), false);
  assert.deepEqual(history.routes(), [], "browsers and Tizen keep their own history untouched");
  assert.equal(router.historyInitialized, false);
});

test("native Back at Home still reaches overlays after a restored route returns", async () => {
  const { router, history, exits } = createRouter();
  await restoreResumeRoute(router, "folderDetail");
  await history.back();
  assert.equal(router.current, "home");
  let consumed = 0;
  router.routes.home.consumeBackRequest = () => {
    consumed += 1;
    return true;
  };
  await history.back();
  assert.equal(history.leftApp, false);
  assert.equal(consumed, 1);
  assert.equal(exits.length, 0);
  assert.equal(router.current, "home");
});

test("native Back dismisses a restored folder overlay before navigating Home", async () => {
  const { router, history } = createRouter();
  await restoreResumeRoute(router, "folderDetail");
  let overlayOpen = true;
  router.routes.folderDetail.consumeBackRequest = () => {
    if (!overlayOpen) return false;
    overlayOpen = false;
    return true;
  };
  await history.back();
  assert.equal(overlayOpen, false);
  assert.equal(router.current, "folderDetail");
  assert.equal(history.leftApp, false);
  await history.back();
  assert.equal(router.current, "home");
});
