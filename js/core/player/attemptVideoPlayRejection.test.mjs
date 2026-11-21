import assert from "node:assert/strict";
import { after, test } from "node:test";

const storage = new Map();
const originalLocalStorage = globalThis.localStorage;

globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { PlayerController } = await import("./playerController.js");

after(() => {
  globalThis.localStorage = originalLocalStorage;
});

function createAttemptPlayHarness({ playResult, isUnsupported = true } = {}) {
  let stopProgressCalls = 0;
  let rejectedErrors = [];
  const harness = {
    playRequestToken: 5,
    isPlaying: true,
    startupAudioGateActive: false,
    startupAudioGatePausesNativePlayback: false,
    video: {
      play: () => playResult
    },
    applyStartupAudioGateToVideo() {},
    handleNativePlayStartedUnderStartupGate: (promise) => promise,
    isExpectedPlayInterruption: (error) => error?.name === "AbortError",
    isUnsupportedSourceError: () => isUnsupported,
    stopProgressSaving: () => {
      stopProgressCalls += 1;
    },
    attemptVideoPlay: PlayerController.attemptVideoPlay
  };
  return {
    harness,
    getStopProgressCalls: () => stopProgressCalls,
    rejectedErrors
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

test("attemptVideoPlay invokes onRejected when video.play() returns a rejected Promise", async () => {
  const mediaError = Object.assign(new Error("Format not supported"), {
    name: "NotSupportedError"
  });
  const rejectedPromise = Promise.reject(mediaError);
  rejectedPromise.catch(() => {});

  const { harness, getStopProgressCalls, rejectedErrors } = createAttemptPlayHarness({
    playResult: rejectedPromise
  });

  harness.attemptVideoPlay({
    playToken: 5,
    onRejected: (error) => {
      rejectedErrors.push(error);
      return true;
    }
  });

  await flushMicrotasks();

  assert.equal(rejectedErrors.length, 1);
  assert.equal(rejectedErrors[0], mediaError);
  assert.equal(harness.isPlaying, true);
  assert.equal(getStopProgressCalls(), 0);
});

test("attemptVideoPlay stops playback and clears isPlaying when onRejected does not handle the error", async () => {
  const mediaError = Object.assign(new Error("Decode failed"), { name: "NotSupportedError" });
  const rejectedPromise = Promise.reject(mediaError);
  rejectedPromise.catch(() => {});

  const { harness, getStopProgressCalls, rejectedErrors } = createAttemptPlayHarness({
    playResult: rejectedPromise
  });

  const warnMessages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args);
  try {
    harness.attemptVideoPlay({
      warningLabel: "Fallback test",
      playToken: 5,
      onRejected: (error) => {
        rejectedErrors.push(error);
        return false;
      }
    });
    await flushMicrotasks();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(rejectedErrors.length, 1);
  assert.equal(harness.isPlaying, false);
  assert.equal(getStopProgressCalls(), 1);
  assert.equal(warnMessages.length, 1);
});

test("attemptVideoPlay ignores stale beforePlay and video.play rejections after playToken changes", async () => {
  let rejectBeforePlay = null;
  let beforePlayCalls = 0;
  let onRejectedCalls = 0;
  const { harness, getStopProgressCalls } = createAttemptPlayHarness({
    playResult: Promise.resolve()
  });

  harness.attemptVideoPlay({
    playToken: 5,
    beforePlay: () =>
      new Promise((_, reject) => {
        beforePlayCalls += 1;
        rejectBeforePlay = reject;
      }),
    onRejected: () => {
      onRejectedCalls += 1;
      return false;
    }
  });

  await flushMicrotasks();
  assert.equal(beforePlayCalls, 1);
  harness.playRequestToken = 6;
  rejectBeforePlay(new Error("Stale startup rejection"));
  await flushMicrotasks();

  assert.equal(onRejectedCalls, 0);
  assert.equal(harness.isPlaying, true);
  assert.equal(getStopProgressCalls(), 0);
});

test("attemptVideoPlay ignores a stale video.play rejection after playToken changes", async () => {
  let rejectPlay = null;
  let onRejectedCalls = 0;
  const { harness, getStopProgressCalls } = createAttemptPlayHarness({
    playResult: new Promise((_, reject) => {
      rejectPlay = reject;
    })
  });

  harness.attemptVideoPlay({
    playToken: 5,
    onRejected: () => {
      onRejectedCalls += 1;
      return false;
    }
  });

  await flushMicrotasks();
  harness.playRequestToken = 6;
  rejectPlay(new Error("Stale play rejection"));
  await flushMicrotasks();

  assert.equal(onRejectedCalls, 0);
  assert.equal(harness.isPlaying, true);
  assert.equal(getStopProgressCalls(), 0);
});
