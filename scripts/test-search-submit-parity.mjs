import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const fixtures = {
  trimLeadingWhitespace: (value) => value.trimStart(),
  getInputSelectionSnapshot: () => null,
  ScreenUtils: { routeEnterClass: () => "", indexFocusables() {} },
  renderRootSidebar: () => "",
  bindRootSidebarEvents() {},
  escapeHtml: String,
  Router: { getCurrent: () => "search" },
  t: (_key, _params, fallback) => fallback
};
const context = vm.createContext({ fixtures, setTimeout, clearTimeout });
const methods = {};
for (const [number, name] of [
  [1, "get-route-state-key"],
  [3, "render-recent-searches"],
  [5, "ensure-header-visible"]
]) {
  const suffix = String(number).padStart(2, "0");
  const source = await readFile(
    new URL(`../js/ui/screens/search/searchScreenMethods-${suffix}-${name}.js`, import.meta.url),
    "utf8"
  );
  vm.runInContext(
    source
      .replace(/^import .*;$/m, "const internals = fixtures;")
      .replace("export function", "function")
      .replace("const internals = fixtures;", `var internals = fixtures;`),
    context
  );
  Object.assign(methods, vm.runInContext(`createSearchScreenMethods${suffix}()`, context));
}
function screen(query = "alien") {
  const input = {
    value: query,
    blur() {
      state.keyboardOpen = false;
    }
  };
  const state = {
    ...methods,
    query,
    mode: "search",
    lastSubmittedQuery: query,
    resultsQuery: query,
    loadToken: 1,
    rows: [],
    navModel: { rows: [] },
    focusZone: "content",
    container: { querySelector: () => input },
    input,
    keyboardOpen: true,
    renders: 0,
    history: 0,
    cancelScheduledRender() {},
    renderRows: () => "",
    buildNavigationModel() {},
    bindSearchInputEvents() {},
    bindActionEvents() {},
    restoreScrollState() {},
    restoreContentFocus(preferResults) {
      this.focused = preferResults ? "result" : this.focused || "input";
      this.keyboardOpen = this.focused === "input";
    },
    requestRender() {
      this.renders++;
      this.navModel.rows = this.rows.length ? [[{}]] : [];
      this.render();
    },
    rememberCurrentSearchIfValid() {
      this.history++;
    },
    captureLiveViewState() {},
    cancelActiveSearchRequests() {},
    refreshWatchedTitleIds: async () => {},
    isSearchInputEditingActive() {
      return this.keyboardOpen;
    }
  };
  return state;
}
const submit = (s) =>
  s.runSearchFromInput(s.input, { autoFocusResults: true, rememberToHistory: true });

// Completed live search: Done moves to the first result without another request.
const ready = screen();
ready.rows = [{ items: [{}] }];
await submit(ready);
assert.equal(ready.focused, "result");
assert.equal(ready.keyboardOpen, false);
assert.equal(ready.history, 1);
assert.equal(ready.loadToken, 1);

// Empty results, including subsequent background renders, never reopen the IME.
const empty = screen();
await submit(empty);
empty.requestRender();
assert.equal(empty.focused, "input");
assert.equal(empty.keyboardOpen, false);

// Done during a live request must not focus rows left over from an older query.
const waiting = screen();
waiting.resultsQuery = "old";
waiting.rows = [{ items: [{}] }];
let finish;
waiting.searchRows = (_query, { onFirstResults }) =>
  new Promise((resolve) => {
    finish = (rows) => {
      onFirstResults(rows);
      resolve(rows);
    };
  });
const loading = waiting.reloadRows();
await submit(waiting);
assert.equal(waiting.renders, 0);
assert.equal(waiting.keyboardOpen, false);
finish([{ items: [{}] }]);
await loading;
assert.equal(waiting.focused, "result");
assert.equal(waiting.pendingAutoFocusResults, false);

// A live request that finishes empty keeps Done dismissed on later refreshes.
const waitingEmpty = screen();
waitingEmpty.resultsQuery = null;
let finishEmpty;
waitingEmpty.searchRows = () =>
  new Promise((resolve) => {
    finishEmpty = resolve;
  });
const emptyLoading = waitingEmpty.reloadRows();
await submit(waitingEmpty);
finishEmpty([]);
await emptyLoading;
waitingEmpty.requestRender();
assert.equal(waitingEmpty.keyboardOpen, false);

// Early Done searches normally; too-short Done still dismisses the keyboard.
const early = screen();
early.lastSubmittedQuery = "old";
early.searchRows = async () => [];
await submit(early);
assert.equal(early.loadToken, 2);
assert.equal(early.keyboardOpen, false);
const short = screen("a");
short.mode = "idle";
await submit(short);
short.requestRender();
assert.equal(short.keyboardOpen, false);

// A real edit cancels the pending focus move, preserving live typing.
empty.cancelScheduledInputSearch = () => {};
empty.input.value = "aliens";
empty.scheduleSearchFromInput(empty.input);
assert.equal(empty.pendingAutoFocusResults, false);
clearTimeout(empty.inputSearchTimer);
console.log("Search submit parity checks passed");
