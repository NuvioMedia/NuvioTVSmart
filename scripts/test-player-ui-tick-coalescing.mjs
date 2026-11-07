import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// The player UI tick is driven by native timeupdate (~4 Hz), the AVPlay time
// callback plus its 1 s poll, progress events and the 1 s heartbeat. These
// tests pin the coalescing contract of requestUiTick(): one tick per interval,
// trailing edge never dropped, direct updateUiTick() calls unaffected.

async function loadTickMethods(clock) {
  const source = await readFile(
    new URL("../js/ui/screens/player/playerScreenMethods-32-update-ui-tick.js", import.meta.url),
    "utf8"
  );
  const timers = [];
  const context = vm.createContext({
    internals: {
      deltaMsForKeyRepeat: () => 0,
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      formatTime: () => "",
      PlayerController: {},
      t: (key, params, fallback) => fallback
    },
    syncHtmlSubtitleClearance: () => {},
    performance: { now: () => clock.now },
    setTimeout: (callback, delay) => {
      const timer = { callback, at: clock.now + Number(delay || 0), cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true;
    }
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.methods = createPlayerScreenMethods32();",
    context
  );
  const advance = (ms) => {
    clock.now += ms;
    timers
      .filter((timer) => !timer.cleared && !timer.fired && timer.at <= clock.now)
      .sort((left, right) => left.at - right.at)
      .forEach((timer) => {
        timer.fired = true;
        timer.callback();
      });
  };
  const pending = () => timers.filter((timer) => !timer.cleared && !timer.fired).length;
  return { methods: context.methods, advance, pending };
}

function createScreen(methods) {
  const screen = {
    ...methods,
    ticks: 0,
    uiTickPendingTimer: null,
    lastUiTickAt: 0,
    // External frame mode returns right after the tick is stamped, which keeps
    // the fixture free of the player DOM while exercising the real method.
    isExternalFrameMode: () => true
  };
  const realUpdate = screen.updateUiTick;
  screen.updateUiTick = function updateUiTick() {
    this.ticks += 1;
    return realUpdate.call(this);
  };
  return screen;
}

test("an idle screen ticks synchronously on the first request", async () => {
  const clock = { now: 10_000 };
  const { methods, pending } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  assert.equal(screen.ticks, 1);
  assert.equal(pending(), 0, "no trailing timer when the tick ran immediately");
  assert.equal(screen.lastUiTickAt, 10_000);
});

test("a burst of progress events collapses into one trailing tick", async () => {
  const clock = { now: 5_000 };
  const { methods, advance, pending } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  assert.equal(screen.ticks, 1);
  // timeupdate at 4 Hz plus an AVPlay callback and a progress event inside 250 ms.
  [40, 60, 80, 110, 150].forEach((at) => {
    clock.now = 5_000 + at;
    screen.requestUiTick();
  });
  assert.equal(screen.ticks, 1, "burst did not run extra ticks");
  assert.equal(pending(), 1, "exactly one trailing timer is armed");
  advance(99);
  assert.equal(screen.ticks, 1, "trailing tick waits for the interval boundary");
  advance(1);
  assert.equal(screen.ticks, 2, "trailing tick fires once at the boundary");
  assert.equal(pending(), 0);
  assert.equal(screen.uiTickPendingTimer, null);
});

test("a direct updateUiTick() cancels a pending trailing tick", async () => {
  const clock = { now: 1_000 };
  const { methods, advance, pending } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  clock.now = 1_100;
  screen.requestUiTick();
  assert.equal(pending(), 1);
  // Pause/seeked handlers call updateUiTick() directly for immediate feedback.
  screen.updateUiTick();
  assert.equal(screen.ticks, 2);
  assert.equal(pending(), 0, "the direct tick cleared the trailing timer");
  advance(1_000);
  assert.equal(screen.ticks, 2, "nothing fires later");
});

test("requests after the interval tick immediately again", async () => {
  const clock = { now: 20_000 };
  const { methods } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  clock.now = 20_250;
  screen.requestUiTick();
  clock.now = 21_250;
  screen.requestUiTick();
  assert.equal(screen.ticks, 3);
});

test("a screen whose clock reads zero still ticks on the first request", async () => {
  const clock = { now: 0 };
  const { methods, pending } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  assert.equal(screen.ticks, 1);
  assert.equal(pending(), 0);
});

test("cancelPendingUiTick() drops the trailing timer on cleanup", async () => {
  const clock = { now: 30_000 };
  const { methods, advance, pending } = await loadTickMethods(clock);
  const screen = createScreen(methods);
  screen.requestUiTick();
  clock.now = 30_050;
  screen.requestUiTick();
  assert.equal(pending(), 1);
  screen.cancelPendingUiTick();
  assert.equal(pending(), 0);
  assert.equal(screen.uiTickPendingTimer, null);
  advance(1_000);
  assert.equal(screen.ticks, 1);
});
