import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
const storage = new Map();

function resetStorage() {
  storage.clear();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => Array.from(storage.keys())[index] ?? null,
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
    clear: () => storage.clear()
  };
}

function setupDom() {
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node" },
      configurable: true
    });
  }
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: "" },
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  };
  globalThis.document = {
    body: { classList: { contains: () => false, add() {}, remove() {} } },
    documentElement: { style: {}, classList: { contains: () => false, add() {}, remove() {} } },
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: () => true
  };
}

resetStorage();
setupDom();

const { Router } = await import("../../navigation/routerState.js");
const { FocusEngine } = await import("../../navigation/focusEngine.js");
const { Platform } = await import("../../../platform/index.js");
const { I18n } = await import("../../../i18n/index.js");
const { MDBLIST_RATING_ORDER, MdbListSettingsStore } =
  await import("../../../data/local/mdbListSettingsStore.js");
const { beginReorder, createReorderSession } = await import("../../components/reorderSession.js");
const { renderMdblistIntegrationDetail } = await import("./settingsIntegrationDetailMdblist.js");
const { SettingsScreen } = await import("./settingsScreen.js");

const originalRouterGetCurrentScreen = Router.getCurrentScreen;
const originalRouterBack = Router.back;
const originalRouterSuppress = Router.suppressNextPopstate;
const originalRouterConsumeGuard = Router.consumeRouteReturnBackGuard;
const originalExitApp = Platform.exitApp;
const originalI18nT = I18n.t;
const originalRender = SettingsScreen.render;
const originalOpenSidebar = SettingsScreen.openSidebar;

let renderCalls = 0;
let openSidebarCalls = 0;
let exitAppCalls = 0;
let routerBackCalls = 0;

function makeKeyEvent(keyCode, extra = {}) {
  return {
    keyCode,
    which: keyCode,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...extra
  };
}

function createFakeContainer() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

function renderMdblistMarkup() {
  SettingsScreen.actionMap = new Map();
  return renderMdblistIntegrationDetail.call(SettingsScreen, {
    mdbList: MdbListSettingsStore.get()
  });
}

beforeEach(() => {
  resetStorage();
  setupDom();
  renderCalls = 0;
  openSidebarCalls = 0;
  exitAppCalls = 0;
  routerBackCalls = 0;

  FocusEngine.lastBackHandledAt = 0;
  FocusEngine.resetActiveKeys();

  Router.getCurrentScreen = () => SettingsScreen;
  Router.back = async () => {
    routerBackCalls += 1;
  };
  Router.suppressNextPopstate = () => {};
  Router.consumeRouteReturnBackGuard = () => false;
  Platform.exitApp = () => {
    exitAppCalls += 1;
  };
  I18n.t = (_key, _params, options) =>
    typeof options === "string" ? options : options?.fallback || _key;

  SettingsScreen.container = createFakeContainer();
  SettingsScreen.actionMap = new Map();
  SettingsScreen.focusZone = "content";
  SettingsScreen.activeSection = "integrations";
  SettingsScreen.integrationView = "mdblist";
  SettingsScreen.textDialog = null;
  SettingsScreen.optionDialog = null;
  SettingsScreen.mediaServersView = null;
  SettingsScreen.mdbReorderSession = null;
  SettingsScreen.contentFocusKey = null;
  SettingsScreen.render = async () => {
    renderCalls += 1;
  };
  SettingsScreen.openSidebar = async () => {
    openSidebarCalls += 1;
    SettingsScreen.focusZone = "sidebar";
  };

  MdbListSettingsStore.set({
    enabled: true,
    ratingOrder: [...MDBLIST_RATING_ORDER]
  });
});

after(() => {
  SettingsScreen.render = originalRender;
  SettingsScreen.openSidebar = originalOpenSidebar;
  SettingsScreen.mdbReorderSession = null;
  Router.getCurrentScreen = originalRouterGetCurrentScreen;
  Router.back = originalRouterBack;
  Router.suppressNextPopstate = originalRouterSuppress;
  Router.consumeRouteReturnBackGuard = originalRouterConsumeGuard;
  Platform.exitApp = originalExitApp;
  I18n.t = originalI18nT;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
  if (originalNavigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true
    });
  }
});

test("starting and moving MDBList rating reorder keeps contentFocusKey on the rendered done button, and confirm/Back return focus to reorder", async () => {
  const initialOrder = [...MDBLIST_RATING_ORDER];
  renderMdblistMarkup();

  const startAction = SettingsScreen.actionMap.get("integration:mdblist:reorder:trakt");
  assert.equal(typeof startAction, "function");
  startAction();

  assert.equal(
    SettingsScreen.contentFocusKey,
    "integration:mdblist:done:trakt",
    "starting reorder must point contentFocusKey at the active done button"
  );
  const movingMarkup = renderMdblistMarkup();
  assert.ok(
    movingMarkup.includes('data-focus-key="integration:mdblist:done:trakt"'),
    "active reorder markup renders the moving button with the matching done focus key"
  );

  await SettingsScreen.onKeyDown(makeKeyEvent(40));
  assert.equal(MdbListSettingsStore.get().ratingOrder[2], "trakt");
  assert.equal(
    SettingsScreen.contentFocusKey,
    "integration:mdblist:done:trakt",
    "moving down during reorder must keep contentFocusKey on integration:mdblist:done:<provider>"
  );

  await SettingsScreen.onKeyDown(makeKeyEvent(38));
  assert.equal(MdbListSettingsStore.get().ratingOrder[1], "trakt");
  assert.equal(
    SettingsScreen.contentFocusKey,
    "integration:mdblist:done:trakt",
    "moving up during reorder must keep contentFocusKey on integration:mdblist:done:<provider>"
  );

  await SettingsScreen.onKeyDown(makeKeyEvent(40));
  assert.equal(MdbListSettingsStore.get().ratingOrder[2], "trakt");
  const rendersBeforeBack = renderCalls;

  FocusEngine.handleBack(makeKeyEvent(10009, { key: "Escape" }));

  assert.equal(openSidebarCalls, 0, "Back during active reorder must not open the sidebar");
  assert.equal(exitAppCalls, 0, "Back during active reorder must not exit the app");
  assert.equal(routerBackCalls, 0, "Back during active reorder must be consumed inside Settings");
  assert.equal(SettingsScreen.mdbReorderSession, null, "Back must clear active mdbReorderSession");
  assert.deepEqual(
    MdbListSettingsStore.get().ratingOrder,
    initialOrder,
    "Back must restore the original MDBList ratingOrder in store"
  );
  assert.equal(
    SettingsScreen.contentFocusKey,
    "integration:mdblist:reorder:trakt",
    "canceling reorder must return focus to the cancelled rating provider's reorder button"
  );
  assert.equal(renderCalls, rendersBeforeBack + 1, "canceling reorder must trigger a re-render");

  renderMdblistMarkup();
  SettingsScreen.actionMap.get("integration:mdblist:reorder:trakt")();
  await SettingsScreen.onKeyDown(makeKeyEvent(40));
  await SettingsScreen.onKeyDown(makeKeyEvent(13));
  assert.equal(SettingsScreen.mdbReorderSession, null);
  assert.equal(MdbListSettingsStore.get().ratingOrder[2], "trakt");
  assert.equal(
    SettingsScreen.contentFocusKey,
    "integration:mdblist:reorder:trakt",
    "confirming reorder must return focus to the provider's reorder button"
  );
});

test("Back after reorder is cancelled opens sidebar normally", () => {
  assert.equal(SettingsScreen.mdbReorderSession, null);
  const consumed = SettingsScreen.consumeBackRequest();
  assert.equal(consumed, true);
  assert.equal(openSidebarCalls, 1, "idle Back in Settings content opens sidebar");
  assert.equal(exitAppCalls, 0);
});

test("SettingsScreen.cleanup clears any active mdbReorderSession", () => {
  const session = createReorderSession({ keys: [...MDBLIST_RATING_ORDER] });
  beginReorder(session, "imdb");
  SettingsScreen.mdbReorderSession = session;

  SettingsScreen.cleanup();

  assert.equal(SettingsScreen.mdbReorderSession, null, "cleanup must clear mdbReorderSession");
});
