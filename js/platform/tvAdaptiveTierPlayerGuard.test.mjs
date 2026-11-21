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

test("watchTvFramePace in js/app.js guards player route and detaches keydown listener on demotion", () => {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /shouldSample:\s*\(\)\s*=>\s*Router\.getCurrent\(\)\s*!==\s*"player"/);
  assert.match(source, /removeEventListener\("keydown",\s*onKeyDown,\s*true\)/);
});
