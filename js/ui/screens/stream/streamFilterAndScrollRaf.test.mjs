import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("streamScreen updates every [data-card-action] button on addon filter and cancels stale visibility rAF", async () => {
  const [src06, src07] = await Promise.all(
    [
      "./streamScreenMethods-06-apply-addon-filter-dom-state.js",
      "./streamScreenMethods-07-restore-stream-virtual-scroll-position.js"
    ].map(async (rel) =>
      (await readFile(new URL(rel, import.meta.url), "utf8"))
        .replace(/^import [\s\S]*?;$/gm, "")
        .replace(/^export /gm, "")
    )
  );

  let nextRaf = 1;
  const scheduledRafs = new Map();
  const cancelledRafs = [];
  const docNode = { contains: () => true };

  const context = vm.createContext({
    document: { documentElement: docNode, body: docNode },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => {
      const id = nextRaf++;
      scheduledRafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelledRafs.push(id);
      scheduledRafs.delete(id);
    },
    focusWithoutScroll() {},
    startStreamBadgeMarquee() {},
    stopStreamBadgeMarquee() {},
    internals: {
      ScreenUtils: {},
      Environment: {},
      isStreamEmptyStateVisible: () => false,
      clamp: (v, min, max) => Math.max(min, Math.min(max, v))
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${src06}\n${src07}\nglobalThis.api = { ...createStreamScreenMethods06(), ...createStreamScreenMethods07() };`,
    context
  );

  const makeBtn = () => ({ hidden: false, style: { display: "" }, dataset: { streamRow: "0" } });
  const row0 = {
    hidden: false,
    style: { display: "" },
    dataset: { streamKey: "0", streamRow: "0" },
    buttons: [makeBtn(), makeBtn()],
    querySelector(sel) {
      return sel === "[data-card-action]" ? this.buttons[0] : null;
    },
    querySelectorAll(sel) {
      return sel === "[data-card-action]" ? this.buttons : [];
    }
  };
  const row1 = {
    hidden: false,
    style: { display: "" },
    dataset: { streamKey: "1", streamRow: "1" },
    buttons: [makeBtn(), makeBtn()],
    querySelector(sel) {
      return sel === "[data-card-action]" ? this.buttons[0] : null;
    },
    querySelectorAll(sel) {
      return sel === "[data-card-action]" ? this.buttons : [];
    }
  };

  const listNode = {
    querySelector: () => null,
    querySelectorAll(sel) {
      return sel.includes("stream-route-card-row") ? [row0, row1] : [];
    }
  };

  let visibleCalls = 0;
  let badgeCalls = 0;
  const screen = Object.assign(Object.create(context.api), {
    addonFilter: "torrentio",
    container: {
      querySelector: (sel) => (sel === ".stream-route-list" ? listNode : null),
      querySelectorAll: () => []
    },
    hasPendingSourceLoads: () => false,
    updateEmptyState() {},
    ensureListItemVisible() {
      visibleCalls += 1;
    },
    requestStreamBadgeHydration() {
      badgeCalls += 1;
    }
  });

  const streamA = { addonName: "other", url: "https://1" };
  const streamB = { addonName: "torrentio", url: "https://2" };
  assert.equal(screen.applyAddonFilterDomState([streamB], [streamA, streamB]), true);

  assert.equal(row0.buttons[0].hidden, true);
  assert.equal(row0.buttons[1].hidden, true);
  assert.equal(row0.buttons[0].style.display, "none");
  assert.equal(row0.buttons[1].style.display, "none");
  assert.equal(row0.buttons[0].dataset.streamRow, "-1");
  assert.equal(row0.buttons[1].dataset.streamRow, "-1");
  assert.equal(row1.buttons[0].hidden, false);
  assert.equal(row1.buttons[1].hidden, false);
  assert.equal(row1.buttons[0].style.display, "");
  assert.equal(row1.buttons[1].style.display, "");
  assert.equal(row1.buttons[0].dataset.streamRow, "0");
  assert.equal(row1.buttons[1].dataset.streamRow, "0");

  screen.scheduleFocusedListItemVisibilityCheck(listNode, row1);
  screen.scheduleFocusedListItemVisibilityCheck(listNode, row1);
  screen.scheduleFocusedListItemVisibilityCheck(listNode, row1);
  assert.equal(cancelledRafs.length, 2);
  assert.equal(scheduledRafs.size, 1);
  Array.from(scheduledRafs.values()).forEach((fn) => fn());
  assert.equal(visibleCalls, 1);
  assert.equal(badgeCalls, 1);
});
