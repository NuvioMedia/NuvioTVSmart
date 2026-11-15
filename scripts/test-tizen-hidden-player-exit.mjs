import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tizen exits the player when the app is hidden. If the TV freezes the page
// before that history traversal commits, the return stays pending and blocks
// every later Back. Resuming must finish the exit instead.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createHistory({ dropTraversal }) {
  const entries = [];
  const listeners = [];
  let index = -1;
  let drop = dropTraversal;
  const history = {
    listeners,
    get state() {
      return index >= 0 ? entries[index] : null;
    },
    replaceState(state) {
      if (index < 0) {
        entries.push(state);
        index = 0;
      } else entries[index] = state;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index = entries.length - 1;
    },
    go(delta) {
      if (drop === "all") {
        drop = false;
        return undefined;
      }
      index += delta;
      if (drop === "event") {
        drop = false;
        return undefined;
      }
      return Promise.all(listeners.slice().map((listener) => listener({ state: entries[index] })));
    },
    back() {
      return history.go(-1);
    }
  };
  return history;
}

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
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

async function createRouter(dropTraversal) {
  const history = createHistory({ dropTraversal });
  const window = {
    history,
    addEventListener: (name, listener) => {
      if (name === "popstate") history.listeners.push(listener);
    }
  };
  const internals = {
    Platform: { isWebOS: () => false, isTizen: () => true, exitApp: () => {} },
    TizenCapabilities: { canUsePlugins: () => true },
    LocalStore: { get: (key, fallback) => fallback, set: () => {}, remove: () => {} },
    RouteStateStore: { clear: () => {}, get: () => null },
    ROUTER_PERF_DEBUG: false,
    routerPerfNow: () => 0,
    logRouterPerf: () => {},
    NON_BACKSTACK_ROUTES: new Set(),
    openPendingLaunchDeepLink: async () => {},
    WEBOS_RESUME_ROUTE_KEY: "k",
    WEBOS_RESUME_ROUTE_TTL_MS: 1,
    TIZEN_ROUTE_RETURN_BACK_GUARD_MS: 700,
    WEBOS_NON_RESTORABLE_ROUTES: new Set(),
    getStackEntryRoute: (entry) => (typeof entry === "string" ? entry : String(entry?.route || "")),
    getStackEntryParams: (entry) => (typeof entry === "string" ? {} : entry?.params || {}),
    resolvePendingHistoryReturnParams: (pending, state, entry) =>
      entry?.params || pending.params || {}
  };
  const load = (file, name) =>
    loadFactory(`js/ui/navigation/${file}`, name, internals, { window })();
  const screen = () => ({
    mount: async () => {},
    cleanup: () => {},
    consumeBackRequest: () => false
  });
  const router = {
    current: null,
    currentParams: {},
    stack: [],
    historyInitialized: false,
    suppressPopstateUntil: 0,
    routeReturnBackGuardNavigationId: 0,
    pendingHistoryReturn: null,
    pendingPostPlayNavigation: null,
    routes: { home: screen(), detail: screen(), player: screen() },
    captureCurrentRouteState() {},
    resolveNavigationContext: (route, params, options) => ({ ...options }),
    suppressNextPopstate() {},
    ...load("routerMethods-01-get-route-state-key.js", "createRouterMethods01"),
    ...load("routerMethods-02-complete-route-return-back-guard.js", "createRouterMethods02"),
    ...load("routerMethods-03-back.js", "createRouterMethods03")
  };
  router.getCurrentScreen = () => router.routes[router.current] || null;
  router.init();
  await router.navigate("home", {});
  await router.navigate("detail", { itemId: "tt1", itemType: "movie" });
  await router.navigate("player", { itemId: "tt1" });
  return { router, history };
}

for (const drop of ["all", "event"]) {
  test(`resume finishes a hidden player exit (${drop === "all" ? "traversal lost" : "popstate lost"})`, async () => {
    const { router, history } = await createRouter(drop);

    assert.equal(router.popToExistingRoute("detail", { itemId: "tt1", itemType: "movie" }), true);
    assert.equal(router.current, "player");
    assert.ok(router.pendingHistoryReturn);

    await router.resumePendingHistoryReturn();

    assert.equal(router.current, "detail");
    assert.equal(router.pendingHistoryReturn, null);
    assert.equal(history.state.route, "detail");
    assert.deepEqual(
      router.stack.map((entry) => entry.route),
      ["home"]
    );
  });
}

test("resume without a pending return is a no-op", async () => {
  const { router, history } = await createRouter(false);
  assert.equal(await router.resumePendingHistoryReturn(), false);
  assert.equal(router.current, "player");
  assert.equal(history.state.route, "player");
});
