import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countFullscreenLayers,
  createFrameBudgetSampler,
  installFrameBudgetSampler,
  resetFrameBudgetSamplerForTests
} from "./frameBudget.js";

function fakeFrames(intervals) {
  const callbacks = new Map();
  let nextId = 1;
  let time = 0;
  const requestFrame = (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  const cancelFrame = (id) => callbacks.delete(id);
  const step = () => {
    const entry = callbacks.entries().next().value;
    if (!entry) return false;
    const [id, callback] = entry;
    callbacks.delete(id);
    time += intervals.shift() ?? 16;
    callback(time);
    return true;
  };
  return { requestFrame, cancelFrame, step, now: () => time };
}

test("frame sampler reports percentiles and slow-frame counts without behaviour changes", () => {
  const frames = fakeFrames([16, 16, 40, 16, 70]);
  const sampler = createFrameBudgetSampler({
    now: frames.now,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    sampleLimit: 20
  });
  sampler.start();
  for (let index = 0; index < 6; index += 1) frames.step();
  const snapshot = sampler.snapshot();
  assert.equal(snapshot.frames, 5);
  assert.equal(snapshot.over33ms, 2);
  assert.equal(snapshot.over50ms, 1);
  assert.equal(snapshot.max, 70);
  assert.ok(snapshot.p50 >= 16 && snapshot.p50 <= 40);
  assert.equal(sampler.stop(), true);
  assert.equal(frames.step(), false, "stop cancels the pending frame");
});

test("frame sampler keeps only the bounded recent window", () => {
  const frames = fakeFrames([10, 10, 10, 10, 10]);
  const sampler = createFrameBudgetSampler({
    now: frames.now,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    sampleLimit: 3
  });
  sampler.start();
  for (let index = 0; index < 5; index += 1) frames.step();
  assert.equal(sampler.snapshot().frames, 3);
  assert.equal(sampler.snapshot().over33ms, 0);
  sampler.stop();
});

test("full-screen layer count ignores hidden, transparent and small elements", () => {
  const element = (name, width, height, style) => ({
    name,
    getBoundingClientRect: () => ({ width, height })
  });
  const styles = {
    full: { display: "block", visibility: "visible", opacity: "1" },
    hidden: { display: "none", visibility: "visible", opacity: "1" },
    transparent: { display: "block", visibility: "visible", opacity: "0" },
    small: { display: "block", visibility: "visible", opacity: "1" }
  };
  const elements = [
    { ...element("full", 1920, 1080), style: styles.full },
    { ...element("hidden", 1920, 1080), style: styles.hidden },
    { ...element("transparent", 1920, 1080), style: styles.transparent },
    { ...element("small", 400, 300), style: styles.small }
  ];
  const count = countFullscreenLayers({
    documentRef: { querySelectorAll: () => elements },
    innerWidth: 1920,
    innerHeight: 1080,
    getStyle: (node) => node.style
  });
  assert.equal(count, 1);
});

test("full-screen layer count is zero without a viewport", () => {
  assert.equal(
    countFullscreenLayers({
      documentRef: { querySelectorAll: () => [] },
      innerWidth: 0,
      innerHeight: 0
    }),
    0
  );
});

test("the global sampler is inert unless the performance flag is on", () => {
  resetFrameBudgetSamplerForTests();
  delete globalThis.__NUVIO_PERF_SAMPLE__;
  assert.equal(installFrameBudgetSampler(), null);
  assert.equal(globalThis.__NUVIO_PERF__, undefined);

  globalThis.__NUVIO_PERF_SAMPLE__ = true;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const sampler = installFrameBudgetSampler();
  assert.ok(sampler);
  assert.equal(typeof globalThis.__NUVIO_PERF__?.snapshot, "function");
  resetFrameBudgetSamplerForTests();
  delete globalThis.__NUVIO_PERF_SAMPLE__;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});
