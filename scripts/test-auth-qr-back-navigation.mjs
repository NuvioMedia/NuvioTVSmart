import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TVAPPQA-66432: on the signed-out QR screen opened from Settings, the Back
// button hid the screen and then asked the Router to go back. That request
// reached the still-current auth screen again, which consumed it as an overlay
// dismissal and never navigated: a black screen. The Router must skip the
// screen's own Back handler for this explicit "return to the previous screen"
// navigation.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function createHistory(entries) {
  const listeners = [];
  let index = entries.length - 1;
  return {
    entries,
    listeners,
    get state() {
      return entries[index];
    },
    get index() {
      return index;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index = entries.length - 1;
    },
    replaceState(state) {
      entries[index] = state;
    },
    back() {
      if (index <= 0) return;
      index -= 1;
      listeners.slice().forEach((listener) => listener({ state: entries[index] }));
    }
  };
}

test("Back on the QR sign-in screen opened from Settings returns to Settings", async () => {
  const settingsEntry = { route: "settings", params: {} };
  const history = createHistory([settingsEntry, { route: "authQrSignIn", params: {} }]);
  const window = {
    history,
    addEventListener: (name, listener) => {
      if (name === "popstate") history.listeners.push(listener);
    }
  };

  const internals = {
    Platform: { isWebOS: () => false, isTizen: () => false, exitApp: () => {} },
    RouteStateStore: { get: () => null, set: () => {}, clear: () => {} },
    NON_BACKSTACK_ROUTES: new Set(),
    getStackEntryRoute: (entry) => (typeof entry === "string" ? entry : String(entry?.route || "")),
    getStackEntryParams: (entry) => (typeof entry === "string" ? {} : entry?.params || {})
  };

  const methods01 = loadFactory(
    "js/ui/navigation/routerMethods-01-get-route-state-key.js",
    "createRouterMethods01",
    internals,
    { window }
  )();
  const methods03 = loadFactory(
    "js/ui/navigation/routerMethods-03-back.js",
    "createRouterMethods03",
    internals,
    { window }
  )();

  const router = {
    current: "authQrSignIn",
    currentParams: {},
    stack: [{ route: "settings", params: {} }],
    historyInitialized: true,
    suppressPopstateUntil: 0,
    skipConsumeNextPopstate: false,
    routeReturnBackGuardActive: false,
    routeReturnBackGuardUntil: 0,
    pendingHistoryReturn: null,
    pendingPostPlayNavigation: null,
    routes: {},
    navigate: async function (route) {
      this.current = route;
    },
    consumePendingPostPlayNavigation: () => false,
    consumeRouteReturnBackGuard: () => false,
    ...methods01,
    ...methods03
  };

  const screenInternals = {
    Router: router,
    Platform: internals.Platform,
    LocalStore: { get: () => false, set: () => {}, remove: () => {} },
    ScreenUtils: { hide: () => {} },
    AuthManager: { clearAnonymousSession: () => {} },
    I18n: { t: (key) => key },
    GUEST_QR_BYPASS_KEY: "skipAuthQrGate",
    focusNode: () => {}
  };
  const screenMethods = loadFactory(
    "js/ui/screens/account/authQrSignInScreenMethods-03-to-friendly-email-error.js",
    "createAuthQrSignInScreenMethods03",
    screenInternals,
    { HTMLButtonElement: class HTMLButtonElement {} }
  )();

  const container = { querySelector: () => null };
  const screen = {
    ...screenMethods,
    container,
    isMounted: true,
    isLeaving: false,
    isSignedIn: false,
    onboardingMode: false,
    hasBackDestination: true,
    showSignOutConfirmation: false,
    isServerMenuOpen: false,
    qrStatusText: ""
  };
  router.routes = { authQrSignIn: screen, settings: { mount: async () => {} } };
  router.init();

  await screen.handleContinueAction();

  assert.equal(screen.container, null, "the QR screen hides itself before navigating");
  assert.equal(
    router.current,
    "settings",
    "Back must land on the previous screen, not a black screen"
  );
  assert.equal(history.index, 0, "one history step back was requested");
});
