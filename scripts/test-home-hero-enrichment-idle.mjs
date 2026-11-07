import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

// On Tizen the modern hero commit waits until the D-pad has been idle for
// 800 ms, so a steady browsing pace does not pay a backdrop swap, a logo
// swap, innerHTML rewrites and the enrichment fetches on every card passed.
// The hero follows focus once the user pauses; other runtimes are unchanged
// (#1250).

function setup({ tizen = false, nowMs = 10_000 } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const clock = { now: nowMs };
  const classList = { contains: (name) => name === "legacy-tizen" && tizen };
  const context = vm.createContext({
    internals: {
      MODERN_HOME_CONSTANTS: { heroRapidNavThresholdMs: 130, verticalScrollSettlePollMs: 60 },
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      shouldEnrichModernHero: () => false,
      preloadHeroAssets: () => Promise.resolve([]),
      buildHeroIdentity: (hero) => String(hero?.id || "")
    },
    document: { body: { classList }, documentElement: { classList } },
    Date: { now: () => clock.now },
    setTimeout: (fn, delay) => {
      timers.set(++nextTimer, { fn, delay });
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => fn(),
    Number,
    Boolean,
    String,
    Math
  });
  const source = readFileSync(
    new URL(
      "../js/ui/screens/home/homeScreenMethods-10-schedule-modern-hero-update.js",
      import.meta.url
    ),
    "utf8"
  )
    .replace(/^import .*;\r?\n/m, "")
    .replace("export function", "function");
  const methods = vm.runInContext(`${source}\ncreateHomeScreenMethods10()`, context);
  const hero = { id: "tt2" };
  const node = { isConnected: true, classList: { contains: (name) => name === "focused" } };
  const applied = [];
  const screen = Object.assign({}, methods, {
    layoutMode: "modern",
    heroItem: { id: "tt1" },
    heroCandidates: [],
    container: null,
    lastHomeInputAt: nowMs,
    getNodeHeroSource: () => hero,
    getCurrentFocusedNode: () => node,
    getHeroFocusDelay: () => 450,
    isPerformanceConstrained: () => false,
    isModernVerticalScrollActive: () => false,
    cancelPendingHeroFocus() {},
    applyHeroToDom() {
      applied.push(this.heroItem?.id);
    },
    enrichCurrentHeroAsync: () => Promise.resolve()
  });
  // Fires the most recently armed pending timer with the given delay (the hero
  // commit timer; the earlier backdrop preload timer shares the 120 ms delay).
  const fireDelay = (delay) => {
    const entry = Array.from(timers.entries())
      .reverse()
      .find(([, timer]) => timer.delay === delay);
    if (!entry) {
      return false;
    }
    timers.delete(entry[0]);
    clock.now += delay;
    entry[1].fn();
    return true;
  };
  return { screen, node, applied, timers, clock, fireDelay };
}

test("the hero commits on the normal delay when the runtime is not Tizen", () => {
  const { screen, node, applied, fireDelay } = setup({ tizen: false });
  screen.scheduleModernHeroUpdate(node);
  assert.equal(fireDelay(450), true);
  assert.deepEqual(applied, ["tt2"]);
});

test("on Tizen the commit waits until the D-pad has been idle for 800 ms", () => {
  const { screen, node, applied, clock, fireDelay } = setup({ tizen: true });
  screen.scheduleModernHeroUpdate(node);
  // 450 ms after the press: still inside the idle window, re-armed on the poll.
  assert.equal(fireDelay(450), true);
  assert.deepEqual(applied, []);
  // The user keeps pressing at a steady pace: each press refreshes the window.
  screen.lastHomeInputAt = clock.now;
  assert.equal(fireDelay(120), true);
  assert.deepEqual(applied, []);
  // Now the user pauses.
  clock.now = screen.lastHomeInputAt + 790;
  assert.equal(fireDelay(120), true);
  assert.deepEqual(applied, ["tt2"]);
});

test("an immediate update (route restore) is never held on Tizen", () => {
  const { screen, node, applied, fireDelay } = setup({ tizen: true });
  screen.scheduleModernHeroUpdate(node, { immediate: true });
  assert.equal(fireDelay(0), true);
  assert.deepEqual(applied, ["tt2"]);
});

test("the backdrop preload still runs on the normal delay while the commit waits", () => {
  const { screen, node, timers } = setup({ tizen: true });
  screen.scheduleModernHeroUpdate(node);
  const delays = Array.from(timers.values())
    .map((timer) => timer.delay)
    .sort((a, b) => a - b);
  // preload at min(120, 450 - 80) and the commit at 450
  assert.deepEqual(delays, [120, 450]);
});
