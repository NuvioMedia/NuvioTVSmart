import assert from "node:assert/strict";
import test from "node:test";

function createHarness() {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const idleCallbacks = [];
  const appendedScripts = [];
  const originalGlobals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestIdleCallback: globalThis.requestIdleCallback,
    document: globalThis.document,
    Hls: globalThis.Hls,
    dashjs: globalThis.dashjs
  };

  delete globalThis.Hls;
  delete globalThis.dashjs;
  delete globalThis.requestIdleCallback;

  globalThis.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    timers.set(id, {
      id,
      callback,
      delay: Number(delay || 0),
      runAt: now + Math.max(0, Number(delay || 0))
    });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "script");
      return {
        src: "",
        async: false,
        onload: null,
        onerror: null,
        remove() {
          this.removed = true;
        }
      };
    },
    head: {
      appendChild(script) {
        appendedScripts.push(script);
        if (script.src.includes("hls")) {
          globalThis.Hls = function MockHls() {};
        } else if (script.src.includes("dash")) {
          globalThis.dashjs = { MediaPlayer: () => ({}) };
        }
        queueMicrotask(() => script.onload?.());
      }
    }
  };

  return {
    appendedScripts,
    idleCallbacks,
    timers,
    advanceTime(ms) {
      now += ms;
      const due = Array.from(timers.values())
        .filter((entry) => entry.runAt <= now)
        .sort((left, right) => left.runAt - right.runAt || left.id - right.id);
      for (const entry of due) {
        if (timers.delete(entry.id)) {
          entry.callback();
        }
      }
    },
    runIdleCallbacks() {
      while (idleCallbacks.length) {
        const entry = idleCallbacks.shift();
        entry.callback({ didTimeout: false, timeRemaining: () => 50 });
      }
    },
    installRequestIdleCallback() {
      globalThis.requestIdleCallback = (callback, options) => {
        idleCallbacks.push({ callback, options });
        return idleCallbacks.length;
      };
    },
    async flushMicrotasks() {
      await new Promise((resolve) => originalGlobals.setTimeout(resolve, 0));
    },
    restore() {
      globalThis.setTimeout = originalGlobals.setTimeout;
      globalThis.clearTimeout = originalGlobals.clearTimeout;
      if (originalGlobals.requestIdleCallback === undefined) {
        delete globalThis.requestIdleCallback;
      } else {
        globalThis.requestIdleCallback = originalGlobals.requestIdleCallback;
      }
      if (originalGlobals.document === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = originalGlobals.document;
      }
      if (originalGlobals.Hls === undefined) {
        delete globalThis.Hls;
      } else {
        globalThis.Hls = originalGlobals.Hls;
      }
      if (originalGlobals.dashjs === undefined) {
        delete globalThis.dashjs;
      } else {
        globalThis.dashjs = originalGlobals.dashjs;
      }
    }
  };
}

test("warmStreamingLibs waits delayMs before scheduling requestIdleCallback and preloads hls.js + dash.js", async () => {
  const harness = createHarness();
  try {
    harness.installRequestIdleCallback();
    const { warmStreamingLibs } = await import("./loadStreamingLibs.js");

    warmStreamingLibs({ delayMs: 1400 });

    assert.equal(harness.timers.size, 1, "delay timer must be armed first");
    assert.equal(
      harness.idleCallbacks.length,
      0,
      "requestIdleCallback must NOT run before delayMs"
    );
    assert.equal(harness.appendedScripts.length, 0, "scripts must NOT start loading immediately");

    harness.advanceTime(1399);
    assert.equal(
      harness.idleCallbacks.length,
      0,
      "requestIdleCallback must still wait until full delayMs"
    );
    assert.equal(harness.appendedScripts.length, 0);

    harness.advanceTime(1);
    assert.equal(
      harness.idleCallbacks.length,
      1,
      "requestIdleCallback is scheduled once delayMs elapses"
    );
    assert.equal(
      harness.appendedScripts.length,
      0,
      "preload still waits for the idle callback slice"
    );

    harness.runIdleCallbacks();
    await harness.flushMicrotasks();

    assert.deepEqual(
      harness.appendedScripts.map((script) => script.src),
      ["assets/libs/hls.min.js", "assets/libs/dash.all.min.js"],
      "both hls.js and dash.js must preload sequentially once idle fires"
    );
  } finally {
    harness.restore();
  }
});

test("warmStreamingLibs falls back directly to warmup after delayMs when requestIdleCallback is absent", async () => {
  const harness = createHarness();
  try {
    const { warmStreamingLibs } = await import("./loadStreamingLibs.js?no-ric=1");

    warmStreamingLibs({ delayMs: 500 });

    assert.equal(harness.timers.size, 1);
    harness.advanceTime(499);
    assert.equal(
      harness.appendedScripts.length,
      0,
      "must honor delayMs even without requestIdleCallback"
    );

    harness.advanceTime(1);
    await harness.flushMicrotasks();

    assert.deepEqual(
      harness.appendedScripts.map((script) => script.src),
      ["assets/libs/hls.min.js", "assets/libs/dash.all.min.js"]
    );
  } finally {
    harness.restore();
  }
});

test("warmStreamingLibs deduplicates pending calls and honors zero delayMs", async () => {
  const harness = createHarness();
  try {
    harness.installRequestIdleCallback();
    const { warmStreamingLibs } = await import("./loadStreamingLibs.js?dedupe=1");

    warmStreamingLibs({ delayMs: 0 });
    warmStreamingLibs({ delayMs: 2500 });

    assert.equal(harness.timers.size, 1, "second call while pending must not arm another timer");
    const [timer] = Array.from(harness.timers.values());
    assert.equal(timer.delay, 0, "explicit delayMs: 0 must not fall back to default 1200ms");

    harness.advanceTime(0);
    assert.equal(harness.idleCallbacks.length, 1);

    globalThis.Hls = {};
    globalThis.dashjs = {};
    harness.runIdleCallbacks();
    await harness.flushMicrotasks();
    assert.equal(harness.appendedScripts.length, 0, "already-loaded globals need no script tags");
  } finally {
    harness.restore();
  }
});
