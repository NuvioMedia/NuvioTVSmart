import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  buildAutoSyncReferenceTimeline,
  findAutoSyncTimeline
} from "../js/core/player/subtitleAutoSyncEngine.js";
import {
  alignSubtitleAutoSyncAsync,
  isSubtitleAutoSyncWorkerActive,
  resetSubtitleAutoSyncWorkerForTests
} from "../js/core/player/subtitleAutoSyncWorkerClient.js";

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function makeFixture({ offsetMs = 1500, count = 120 } = {}) {
  const random = createRandom(11);
  let timeMs = 1200;
  const referenceCues = [];
  const targetCues = [];
  for (let index = 0; index < count; index += 1) {
    timeMs += 800 + Math.floor(random() * 9000);
    const durationMs = 1500 + Math.floor(random() * 2500);
    referenceCues.push({ startMs: timeMs + offsetMs, durationMs });
    targetCues.push({
      start: timeMs / 1000,
      end: (timeMs + durationMs) / 1000,
      text: `line ${index}`
    });
  }
  return { referenceCues, targetCues };
}

const expected = (fixture) =>
  findAutoSyncTimeline(buildAutoSyncReferenceTimeline(fixture.referenceCues), fixture.targetCues);

test("synchronous postMessage error rejects pending worker promise and falls back to main thread", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  let constructed = 0;
  let terminated = 0;
  globalThis.Worker = class ThrowingPostMessageWorker {
    constructor() {
      constructed += 1;
    }
    postMessage() {
      throw new Error("DataCloneError");
    }
    terminate() {
      terminated += 1;
    }
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const fixture = makeFixture();
    const result = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(result, expected(fixture));
    assert.equal(constructed, 1);
    assert.equal(terminated, 1);
    assert.equal(warnings.length, 1);
    assert.equal(isSubtitleAutoSyncWorkerActive(), false);

    const nextResult = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(nextResult, result);
    assert.equal(constructed, 1);
  } finally {
    console.warn = originalWarn;
    delete globalThis.Worker;
    resetSubtitleAutoSyncWorkerForTests();
  }
});

test("unresponsive worker timeout rejects pending worker promise and falls back to main thread", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  let constructed = 0;
  let terminated = 0;
  globalThis.Worker = class HungWorker {
    constructor() {
      constructed += 1;
    }
    postMessage() {}
    terminate() {
      terminated += 1;
    }
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const fixture = makeFixture();
    let settled = false;
    const resultPromise = alignSubtitleAutoSyncAsync(fixture).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    assert.equal(settled, false);
    mock.timers.tick(45_000);
    await Promise.resolve();
    await Promise.resolve();
    mock.timers.tick(0);

    const result = await resultPromise;
    assert.equal(settled, true);
    assert.deepEqual(result, expected(fixture));
    assert.equal(constructed, 1);
    assert.equal(terminated, 1);
    assert.equal(warnings.length, 1);
    assert.equal(isSubtitleAutoSyncWorkerActive(), false);
  } finally {
    mock.timers.reset();
    console.warn = originalWarn;
    delete globalThis.Worker;
    resetSubtitleAutoSyncWorkerForTests();
  }
});
