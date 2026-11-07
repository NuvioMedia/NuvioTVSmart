import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  buildAutoSyncReferenceTimeline,
  findAutoSyncTimeline
} from "../js/core/player/subtitleAutoSyncEngine.js";
import {
  alignSubtitleAutoSync,
  handleSubtitleAutoSyncWorkerMessage
} from "../js/core/player/subtitleAutoSyncWorker.js";
import {
  alignSubtitleAutoSyncAsync,
  isSubtitleAutoSyncWorkerActive,
  resetSubtitleAutoSyncWorkerForTests
} from "../js/core/player/subtitleAutoSyncWorkerClient.js";

// Subtitle AutoSync runs its alignment in a Web Worker when the runtime has
// one, and otherwise on the main thread exactly as before.

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

test("the worker handler returns the same alignment as the direct engine call", () => {
  const fixture = makeFixture();
  const direct = expected(fixture);
  assert.ok(direct?.confident, "fixture aligns confidently");
  const posted = [];
  handleSubtitleAutoSyncWorkerMessage({ id: 7, ...fixture }, (message) => posted.push(message));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].id, 7);
  assert.equal(posted[0].ok, true);
  assert.deepEqual(posted[0].result, direct);
  assert.deepEqual(alignSubtitleAutoSync(fixture), direct);
});

test("the worker handler reports an engine failure instead of dying", () => {
  const posted = [];
  const throwing = new Proxy([], {
    get(target, key) {
      if (key === "length") throw new Error("boom");
      return Reflect.get(target, key);
    }
  });
  handleSubtitleAutoSyncWorkerMessage(
    { id: 3, referenceCues: throwing, targetCues: [] },
    (message) => posted.push(message)
  );
  assert.deepEqual(posted, [{ id: 3, ok: false, error: "boom" }]);
});

test("without a Worker the client aligns on the main thread after yielding", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  assert.equal(typeof globalThis.Worker, "undefined");
  const fixture = makeFixture();
  const result = await alignSubtitleAutoSyncAsync(fixture);
  assert.deepEqual(result, expected(fixture));
  assert.equal(isSubtitleAutoSyncWorkerActive(), false);
});

class FakeWorker {
  static created = [];
  constructor(url) {
    this.url = url;
    this.posted = [];
    this.terminated = false;
    FakeWorker.created.push(this);
  }
  postMessage(message) {
    this.posted.push(message);
    Promise.resolve().then(() => {
      if (this.terminated) return;
      handleSubtitleAutoSyncWorkerMessage(message, (reply) => this.onmessage?.({ data: reply }));
    });
  }
  terminate() {
    this.terminated = true;
  }
}

test("with a Worker the client offloads the alignment, reuses the worker and terminates it when idle", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  FakeWorker.created = [];
  globalThis.Worker = FakeWorker;
  globalThis.__NUVIO_SUBTITLE_AUTOSYNC_WORKER_URL__ = "worker://autosync";
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const fixture = makeFixture();
    const first = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(first, expected(fixture));
    assert.equal(FakeWorker.created.length, 1);
    assert.equal(FakeWorker.created[0].url, "worker://autosync");
    assert.equal(FakeWorker.created[0].posted.length, 1);
    assert.equal(FakeWorker.created[0].posted[0].id, 1);
    assert.equal(isSubtitleAutoSyncWorkerActive(), true);

    const shifted = makeFixture({ offsetMs: -2200 });
    const second = await alignSubtitleAutoSyncAsync(shifted);
    assert.deepEqual(second, expected(shifted));
    assert.equal(FakeWorker.created.length, 1, "the worker is reused");
    assert.equal(FakeWorker.created[0].posted.length, 2);

    mock.timers.tick(29_999);
    assert.equal(isSubtitleAutoSyncWorkerActive(), true);
    mock.timers.tick(1);
    assert.equal(isSubtitleAutoSyncWorkerActive(), false, "idle worker terminated");
    assert.equal(FakeWorker.created[0].terminated, true);

    const third = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(third, first);
    assert.equal(FakeWorker.created.length, 2, "a new worker after idle termination");
  } finally {
    mock.timers.reset();
    delete globalThis.Worker;
    delete globalThis.__NUVIO_SUBTITLE_AUTOSYNC_WORKER_URL__;
    resetSubtitleAutoSyncWorkerForTests();
  }
});

test("a worker that fails to start falls back to the main thread and is not retried", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  let constructed = 0;
  globalThis.Worker = class BrokenWorker {
    constructor() {
      constructed += 1;
    }
    postMessage() {
      // Simulate a script load failure reported through onerror.
      Promise.resolve().then(() => this.onerror?.({ message: "Failed to load worker script" }));
    }
    terminate() {}
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const fixture = makeFixture();
    const result = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(result, expected(fixture));
    assert.equal(constructed, 1);
    assert.equal(warnings.length, 1);
    const again = await alignSubtitleAutoSyncAsync(fixture);
    assert.deepEqual(again, result);
    assert.equal(constructed, 1, "a broken worker is not constructed again");
    assert.equal(isSubtitleAutoSyncWorkerActive(), false);
  } finally {
    console.warn = originalWarn;
    delete globalThis.Worker;
    resetSubtitleAutoSyncWorkerForTests();
  }
});

test("a worker whose constructor throws falls back to the main thread", async () => {
  resetSubtitleAutoSyncWorkerForTests();
  globalThis.Worker = class ThrowingWorker {
    constructor() {
      throw new Error("SecurityError");
    }
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const fixture = makeFixture();
    assert.deepEqual(await alignSubtitleAutoSyncAsync(fixture), expected(fixture));
  } finally {
    console.warn = originalWarn;
    delete globalThis.Worker;
    resetSubtitleAutoSyncWorkerForTests();
  }
});
