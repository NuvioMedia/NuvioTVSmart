import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Load the actual method factories with controlled repository/DOM dependencies.
function methods(file, name, internals = {}, timers = {}) {
  const source = readFileSync(
    new URL(`../js/ui/screens/collection/${file}.js`, import.meta.url),
    "utf8"
  )
    .replace(/^import \* as internals from .*;$/m, "")
    .replace("export function ", "function ");
  return new Function("internals", "setTimeout", "clearTimeout", `${source}\nreturn ${name}();`)(
    internals,
    timers.setTimeout || setTimeout,
    timers.clearTimeout || clearTimeout
  );
}
const navigation = methods(
  "folderDetailScreenMethods-05-on-key-down",
  "createFolderDetailScreenMethods05",
  {
    isBackEvent: () => false
  }
);
function screen({ row = 1, selected = 0, rows = 10 } = {}) {
  const cards = Array.from({ length: rows }, (_, i) => [
    {
      dataset: { navRow: String(i), navCol: "0" },
      matches: () => false,
      closest: () => (i === 0 ? null : {})
    }
  ]);
  let focused = cards[row][0];
  return {
    ...navigation,
    viewMode: "TABBED_GRID",
    selectedTabIndex: selected,
    tabs: [{ isAllTab: true, hasMore: true }, { hasMore: true }, { hasMore: true }],
    navModel: { rows: cards },
    container: { querySelector: () => focused },
    focusNode(target) {
      focused = target;
    },
    getSelectedTab() {
      return this.tabs[this.selectedTabIndex];
    },
    calls: [],
    async loadTab(index, options) {
      this.calls.push({ index, options });
    },
    get focused() {
      return focused;
    }
  };
}
const press = (s, keyCode) => s.onKeyDown({ keyCode, preventDefault() {} });

test("Down near the top moves focus without fetching any source", async () => {
  const s = screen();
  await press(s, 40);
  assert.equal(s.focused.dataset.navRow, "2");
  assert.equal(s.calls.length, 0);
});
test("All prefetches eligible sources near the end", async () => {
  const s = screen({ row: 7 });
  await press(s, 40);
  assert.equal(s.focused.dataset.navRow, "8");
  assert.deepEqual(
    s.calls.map((c) => c.index),
    [1, 2]
  );
  assert.ok(s.calls.every((c) => c.options.append));
});
test("individual source tab only fetches that source", async () => {
  const s = screen({ row: 7, selected: 2 });
  await press(s, 40);
  assert.deepEqual(
    s.calls.map((c) => c.index),
    [2]
  );
});
test("loading and exhausted sources are skipped", async () => {
  const s = screen({ row: 7 });
  s.tabs[1].loading = true;
  s.tabs[2].hasMore = false;
  await press(s, 40);
  assert.equal(s.calls.length, 0);
});
test("Down on the last loaded row can request another page without losing focus", async () => {
  const s = screen({ row: 9 });
  const before = s.focused;
  await press(s, 40);
  assert.equal(s.focused, before);
  assert.equal(s.calls.length, 2);
});
test("Up and horizontal moves never paginate", async () => {
  for (const code of [37, 38, 39]) {
    const s = screen({ row: 8 });
    await press(s, code);
    assert.equal(s.calls.length, 0);
  }
});
test("exhausted grid and tab-header navigation do not request pages", async () => {
  const s = screen({ row: 9 });
  s.tabs[0].hasMore = false;
  await press(s, 40);
  assert.equal(s.calls.length, 0);
  const short = screen({ row: 0, rows: 2 });
  await press(short, 40);
  assert.equal(short.calls.length, 0);
});

function loadingScreen() {
  let route = "folderDetail";
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const Router = { getCurrent: () => route };
  const scheduled = methods(
    "folderDetailScreenMethods-01-get-route-state-key",
    "createFolderDetailScreenMethods01",
    { Router, FOLDER_SOURCE_RENDER_BATCH_MS: 10 },
    {
      setTimeout(fn) {
        const id = ++timerId;
        timers.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    }
  );
  const loading = methods(
    "folderDetailScreenMethods-02-load-tab",
    "createFolderDetailScreenMethods02",
    {
      Router,
      fetchSourceItems: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
    }
  );
  const s = {
    ...scheduled,
    ...loading,
    folderLoadToken: 1,
    container: {},
    renders: 0,
    tabs: [
      { isAllTab: true },
      ...[1, 2].map((id) => ({
        source: {},
        items: [{ id: `old${id}`, type: "movie" }],
        hasMore: true
      }))
    ],
    rebuildAllTab() {},
    refreshWatchedTitleIds: () => Promise.resolve(),
    render() {
      this.cancelScheduledRender();
      this.renders++;
    }
  };
  return {
    s,
    requests,
    timers,
    leave() {
      route = "home";
      s.cancelScheduledRender();
    },
    flush() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    }
  };
}
test("concurrent append loads and watched-state updates share one scheduled render", async () => {
  const f = loadingScreen();
  const first = f.s.loadTab(1, { append: true });
  const second = f.s.loadTab(2, { append: true });
  assert.equal(f.s.renders, 0);
  assert.equal(f.timers.size, 1);
  await f.s.loadTab(1, { append: true });
  assert.equal(f.requests.length, 2);
  f.requests.forEach((r, i) =>
    r.resolve({ items: [{ id: `new${i}`, type: "movie" }], hasMore: true })
  );
  await Promise.all([first, second]);
  await Promise.resolve();
  assert.equal(f.timers.size, 1);
  assert.equal(f.s.renders, 0);
  assert.equal(f.s.tabs[1].items.length, 2);
  assert.equal(f.s.tabs[1].loading, false);
  f.flush();
  assert.equal(f.s.renders, 1);
});
test("failed append preserves existing results and clears loading for retry", async () => {
  const f = loadingScreen();
  const pending = f.s.loadTab(1, { append: true });
  f.requests[0].reject(new Error("offline"));
  await pending;
  assert.equal(f.s.tabs[1].items[0].id, "old1");
  assert.equal(f.s.tabs[1].loading, false);
  assert.equal(f.s.tabs[1].hasMore, true);
  assert.equal(f.s.tabs[1].error, "offline");
});
test("leaving the folder prevents stale completion from rendering", async () => {
  const f = loadingScreen();
  const pending = f.s.loadTab(1, { append: true });
  const rendersBeforeLeave = f.s.renders;
  f.leave();
  f.requests[0].resolve({ items: [{ id: "new", type: "movie" }] });
  await pending;
  assert.equal(f.timers.size, 0);
  assert.equal(f.s.renders, rendersBeforeLeave);
  assert.equal(f.s.tabs[1].items.length, 1);
});
test("initial foreground load retains immediate rendering", async () => {
  const f = loadingScreen();
  const pending = f.s.loadTab(1);
  assert.equal(f.s.renders, 1);
  f.requests[0].resolve({ items: [], hasMore: false });
  await pending;
  assert.ok(f.s.renders >= 2);
});
