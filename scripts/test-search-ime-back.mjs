import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Samsung's IME reports Done (65376) and Cancel (65385) instead of the remote
// Enter/Back. Search used to ignore both: the editor stayed attached to the
// platform keyboard and every Back was swallowed as another Cancel, so several
// presses were needed before one reached the app. Results updates also called
// input.focus() again, reopening the IME after the user had dismissed it.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadFactory(relPath, factoryName, internals, globals = {}) {
  const source = readFileSync(path.join(ROOT, relPath), "utf8")
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
    Promise,
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    ...globals
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__factory = ${factoryName};`, sandbox);
  return sandbox.__factory;
}

const baseInternals01 = {
  Router: { getCurrent: () => "search" },
  ScreenUtils: { indexFocusables() {} },
  watchedItemsRepository: { getAll: async () => [] },
  watchedTitleStateRepository: { getTitleWatchedItems: async () => [] },
  LayoutPreferences: { get: () => ({}) },
  SearchHistoryStore: { list: () => [] },
  Platform: {},
  getSidebarProfileState: async () => null,
  renderRootSidebar: () => "",
  buildWatchedTitleIdSet: () => new Set(),
  renderLoadingIndicator: () => "",
  escapeHtml: String,
  t: (_key, _params, fallback) => fallback,
  getInputSelectionSnapshot: () => null,
  restoreInputSelection() {},
  buildRowStateKey: () => ""
};

test("Samsung IME Cancel ends editing and Done submits the query", async () => {
  const platform = { isTizen: () => true, isBackEvent: () => false };
  const router = { back: async () => assert.fail("Back must not navigate while closing the IME") };
  const screenMethods = loadFactory(
    "js/ui/screens/search/searchScreenMethods-06-activate-action-node.js",
    "createSearchScreenMethods06",
    {
      Router: router,
      ScreenUtils: { handleDpadNavigation: () => false },
      Platform: platform,
      resetDpadRepeat() {},
      activateLegacySidebarAction() {},
      getRootSidebarNodes: () => [],
      isSelectedSidebarAction: () => false,
      isRootSidebarNode: () => false,
      setModernSidebarPillIconOnly() {},
      clamp: (value, min, max) => Math.max(min, Math.min(max, value))
    }
  )();

  const input = {
    value: "alien",
    blurred: 0,
    blur() {
      this.blurred += 1;
    }
  };
  const container = {
    querySelector: (selector) =>
      selector === "#searchInput" || selector === ".focusable.focused" ? input : null
  };
  let cancelled = 0;
  let submitted = null;
  const screen = {
    ...screenMethods,
    container,
    focusZone: "content",
    layoutPrefs: {},
    suppressHoldMenuEnterUntilKeyUp: false,
    imeDismissed: false,
    isSearchInputEditingActive: () => true,
    keepSearchInputEditingKey: () => false,
    cancelScheduledInputSearch: () => {
      cancelled += 1;
    },
    cancelPendingPosterHold() {},
    isPosterHoldTarget: () => false,
    handleSearchDpad: () => false,
    runSearchFromInput: async (target, options) => {
      submitted = { target, options };
    }
  };

  await screen.onKeyDown({ keyCode: 65385, originalKeyCode: 65385, target: input });
  assert.equal(input.blurred, 1, "Cancel must end the IME editing session");
  assert.equal(screen.imeDismissed, true);
  assert.equal(submitted, null, "Cancel must not submit a search");
  assert.equal(cancelled, 0, "Cancel must let the debounced live search finish");

  await screen.onKeyDown({ keyCode: 65376, originalKeyCode: 65376, target: input });
  assert.equal(cancelled, 1);
  assert.equal(submitted?.target, input);
  assert.equal(submitted?.options?.autoFocusResults, true);
  assert.equal(submitted?.options?.rememberToHistory, true);
});

test("A results patch does not reopen the IME the user dismissed", () => {
  const document = { activeElement: {} };
  const methods = loadFactory(
    "js/ui/screens/search/searchScreenMethods-01-get-route-state-key.js",
    "createSearchScreenMethods01",
    baseInternals01,
    { document }
  )();
  const input = {
    focusCalls: 0,
    focus() {
      this.focusCalls += 1;
    }
  };
  const header = { nextSibling: null };
  const content = {
    querySelector: (selector) => (selector === ".search-header" ? header : null),
    insertAdjacentHTML() {}
  };
  const container = {
    querySelector: (selector) => {
      if (selector === ".search-content") return content;
      if (selector === "#searchInput") return input;
      if (selector === ".focusable.focused") return input;
      return null;
    }
  };
  const screen = {
    ...methods,
    container,
    imeDismissed: true,
    renderRows: () => "",
    buildNavigationModel() {},
    bindActionEvents() {},
    focusNode() {},
    pendingAutoFocusResults: false
  };

  screen.renderResultsOnly();
  assert.equal(input.focusCalls, 0, "a results patch must not reopen the dismissed IME");

  screen.imeDismissed = false;
  screen.renderResultsOnly();
  assert.equal(input.focusCalls, 1, "editing focus still follows the input when the IME is open");
});

console.log("Search IME Back checks passed");
