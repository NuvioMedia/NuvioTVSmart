import assert from "node:assert/strict";
import test from "node:test";
import {
  createFramePaceMonitor,
  readForcedTvTier,
  readMeasuredTvTier,
  storeMeasuredTvTier
} from "./tvAdaptiveTier.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value))
  };
}

// Drives the monitor with a fake clock: every frame takes frameMs.
function run({ frameMs, keys, startAt = 60000 }) {
  let clock = startAt;
  const queue = [];
  let slow = null;
  const monitor = createFramePaceMonitor({
    onSlow: (typical) => {
      slow = typical;
    },
    now: () => clock,
    requestFrame: (callback) => queue.push(callback)
  });
  clock += 30000;
  for (let key = 0; key < keys; key += 1) {
    monitor.noteKey();
    while (queue.length) {
      clock += typeof frameMs === "function" ? frameMs(key) : frameMs;
      queue.shift()();
    }
  }
  return { slow, monitor };
}

test("a TV that holds its frame rate is left on the full profile", () => {
  assert.equal(run({ frameMs: 17, keys: 40 }).slow, null);
});

test("a TV that stalls through its animations is reported once, after twelve keys", () => {
  assert.equal(run({ frameMs: 45, keys: 11 }).slow, null);
  const { slow } = run({ frameMs: 45, keys: 30 });
  assert.ok(slow > 60);
});

test("occasional hitches on a fast TV do not demote it", () => {
  const { slow } = run({ frameMs: (key) => (key % 4 === 0 ? 120 : 17), keys: 40 });
  assert.equal(slow, null);
});

test("keys during the warm-up are ignored", () => {
  let clock = 0;
  const queue = [];
  const monitor = createFramePaceMonitor({
    now: () => clock,
    requestFrame: (callback) => queue.push(callback)
  });
  monitor.noteKey();
  assert.equal(queue.length, 0);
  clock = 25000;
  monitor.noteKey();
  assert.equal(queue.length, 1);
});

test("a measured tier only applies to the build that measured it", () => {
  const storage = memoryStorage();
  assert.equal(readMeasuredTvTier("1.0.0", storage), null);
  storeMeasuredTvTier({ tier: "constrained", appVersion: "1.0.0", lostMs: 119 }, storage);
  assert.equal(readMeasuredTvTier("1.0.0", storage), "constrained");
  assert.equal(readMeasuredTvTier("1.0.1", storage), null);
});

test("the forced tier accepts only known values and survives broken storage", () => {
  const storage = memoryStorage();
  storage.setItem("nuvio.debug.forceTvTier", "fast");
  assert.equal(readForcedTvTier(storage), null);
  storage.setItem("nuvio.debug.forceTvTier", "full");
  assert.equal(readForcedTvTier(storage), "full");
  const broken = {
    getItem() {
      throw new Error("denied");
    }
  };
  assert.equal(readForcedTvTier(broken), null);
  assert.equal(readMeasuredTvTier("1.0.0", broken), null);
});
