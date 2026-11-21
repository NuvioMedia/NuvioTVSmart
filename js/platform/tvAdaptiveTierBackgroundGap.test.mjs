import assert from "node:assert/strict";
import test from "node:test";
import { createFramePaceMonitor } from "./tvAdaptiveTier.js";

test("tvAdaptiveTier discards long-gap (>1000ms) and backgrounded (document.hidden) frame samples", () => {
  const hasPrevDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const prevDocument = globalThis.document;
  try {
    globalThis.document = { hidden: false };
    let clock = 60000;
    let nextCb = null;
    const monitor = createFramePaceMonitor({
      now: () => clock,
      requestFrame: (cb) => {
        nextCb = cb;
      }
    });

    clock += 30000;
    monitor.noteKey();
    clock += 2000; // Simulate browser tab / TV background pause > 1000 ms
    nextCb();
    assert.equal(monitor.samples.length, 0);

    // Sampling flag was cleared by the discarded sample, so a hidden tab check starts fresh.
    globalThis.document = { hidden: true };
    nextCb = null;
    monitor.noteKey();
    assert.equal(typeof nextCb, "function");
    clock += 400; // >= policy.windowMs (350ms), would normally push a sample
    nextCb();
    assert.equal(monitor.samples.length, 0);

    // Once visible again and within <= 1000ms, sampling records normally.
    globalThis.document = { hidden: false };
    nextCb = null;
    monitor.noteKey();
    clock += 400;
    nextCb();
    assert.equal(monitor.samples.length, 1);
  } finally {
    if (hasPrevDocument) {
      globalThis.document = prevDocument;
    } else {
      delete globalThis.document;
    }
  }
});
