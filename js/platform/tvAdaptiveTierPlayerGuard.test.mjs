import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFramePaceMonitor, TV_FRAME_PACE_POLICY } from "./tvAdaptiveTier.js";

test("createFramePaceMonitor skips key samples and in-flight slow frames when shouldSample returns false", () => {
  let timeMs = 30000;
  let allowSample = false;
  let slowCalls = 0;
  const rafQueue = [];

  const monitor = createFramePaceMonitor({
    now: () => timeMs,
    requestFrame: (cb) => rafQueue.push(cb),
    shouldSample: () => allowSample,
    onSlow: () => {
      slowCalls += 1;
    },
    policy: {
      ...TV_FRAME_PACE_POLICY,
      warmupMs: 20000,
      windowMs: 300,
      lateFrameMs: 25,
      slowLostMs: 60,
      sampleKeys: 3
    }
  });

  // Advance past warmup, then while on player route (shouldSample === false), noteKey does not schedule rAF.
  timeMs += 25000;
  monitor.noteKey();
  assert.equal(rafQueue.length, 0);

  // Start sampling on Home, then navigate into player before window settles.
  allowSample = true;
  monitor.noteKey();
  assert.equal(rafQueue.length, 1);

  allowSample = false;
  timeMs += 150;
  rafQueue.shift()(timeMs);
  timeMs += 200;
  rafQueue.shift()(timeMs);
  assert.equal(slowCalls, 0, "player-route transition discards pending sample");

  // Two more slow samples on Home are still needed to reach sampleKeys = 3.
  allowSample = true;
  for (let i = 0; i < 2; i += 1) {
    monitor.noteKey();
    timeMs += 150;
    rafQueue.shift()(timeMs);
    timeMs += 200;
    rafQueue.shift()(timeMs);
  }
  assert.equal(slowCalls, 0, "discarded player sample did not count toward demotion");

  monitor.noteKey();
  timeMs += 150;
  rafQueue.shift()(timeMs);
  timeMs += 200;
  rafQueue.shift()(timeMs);
  assert.equal(slowCalls, 1, "demotes only after 3 valid non-player slow samples");
});

test("watchTvFramePace in js/app.js guards non-home routes, suppresses fast-scroll repeats/bursts, and detaches keydown listener on demotion", () => {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /const shouldSampleHomeRoute = \(\) => Router\.getCurrent\(\) === "home"/);
  assert.match(
    source,
    /const shouldSampleFramePace = \(\) => shouldSampleHomeRoute\(\) && nowMs\(\) >= burstSuppressUntil/
  );
  assert.match(source, /shouldSample:\s*shouldSampleFramePace/);
  assert.match(source, /if \(!shouldSampleHomeRoute\(\)\) \{\s*return;\s*\}/);
  assert.match(source, /Boolean\(event\?\.repeat\)/);
  assert.match(source, /FAST_BURST_KEY_GAP_MS/);
  const burstGapMatch = source.match(/const FAST_BURST_KEY_GAP_MS = (\d+)/);
  assert.ok(burstGapMatch, "FAST_BURST_KEY_GAP_MS constant should exist");
  assert.ok(
    Number(burstGapMatch[1]) >= TV_FRAME_PACE_POLICY.windowMs,
    "FAST_BURST_KEY_GAP_MS must cover the full 350ms frame-pace sample window"
  );
  assert.match(
    source,
    /const isModernTizen = profile\.platform === "tizen" && !profile\.isLegacyTvRuntime/
  );
  assert.match(source, /slowLostMs:\s*isModernTizen \? 90 : TV_FRAME_PACE_POLICY\.slowLostMs/);
  assert.match(source, /consecutiveSlowWindows:\s*2/);
  assert.match(source, /burstSuppressUntil = now \+ FAST_BURST_SUPPRESS_MS/);
  assert.match(source, /removeEventListener\("keydown",\s*onKeyDown,\s*true\)/);
});

test("createFramePaceMonitor consecutiveSlowWindows hysteresis resets on a smooth window and fires after two consecutive slow windows", () => {
  let timeMs = 30000;
  const slowCalls = [];
  const rafQueue = [];
  const monitor = createFramePaceMonitor({
    now: () => timeMs,
    requestFrame: (cb) => rafQueue.push(cb),
    onSlow: (lostMs) => slowCalls.push(lostMs),
    policy: {
      ...TV_FRAME_PACE_POLICY,
      warmupMs: 20000,
      windowMs: 300,
      lateFrameMs: 25,
      slowLostMs: 90,
      sampleKeys: 3,
      consecutiveSlowWindows: 2
    }
  });

  const runWindow = (slow) => {
    for (let i = 0; i < 3; i += 1) {
      monitor.noteKey();
      if (slow) {
        timeMs += 150;
        rafQueue.shift()(timeMs);
        timeMs += 200;
        rafQueue.shift()(timeMs);
      } else {
        while (rafQueue.length) {
          timeMs += 16.7;
          rafQueue.shift()(timeMs);
        }
      }
    }
  };

  timeMs += 25000;
  // Window 1 slow -> streak = 1, not demoted yet.
  runWindow(true);
  assert.equal(slowCalls.length, 0);
  assert.equal(monitor.getStats().windowsCompleted, 1);
  assert.equal(monitor.getStats().slowWindowStreak, 1);

  // Window 2 smooth -> streak resets to 0.
  runWindow(false);
  assert.equal(slowCalls.length, 0);
  assert.equal(monitor.getStats().windowsCompleted, 2);
  assert.equal(monitor.getStats().slowWindowStreak, 0);

  // Window 3 slow -> streak = 1 again, still not demoted.
  runWindow(true);
  assert.equal(slowCalls.length, 0);
  assert.equal(monitor.getStats().slowWindowStreak, 1);

  // Window 4 slow -> second consecutive slow window demotes.
  runWindow(true);
  assert.equal(slowCalls.length, 1);
  assert.equal(monitor.getStats().slowWindowStreak, 2);
});
