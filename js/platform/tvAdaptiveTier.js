// The model year says which engine a TV has, not how fast its board is: a 2023
// entry-level set gets the full effect set and cannot hold it. This measures
// what the TV actually delivers after each D-pad press and, when it falls
// behind, moves it to the constrained profile for good.
const STORAGE_KEY = "nuvio.tvMeasuredTier";
// Test hook: "full" or "constrained" pins the tier whatever the TV reports.
const FORCED_TIER_KEY = "nuvio.debug.forceTvTier";

export const TV_FRAME_PACE_POLICY = Object.freeze({
  // One sample is the time lost to late frames in this window after a key.
  windowMs: 350,
  sampleKeys: 12,
  frameMs: 16.7,
  lateFrameMs: 25,
  // Measured with every effect on: a 2025 OLED loses about 33 ms of each
  // window, a 2019 entry-level set 75 to 120 ms (up to a third of every
  // animation). The limit sits between the two.
  slowLostMs: 60,
  // Startup renders and first-run network work are not the steady state.
  warmupMs: 20000
});

function readStorage(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (_error) {
    return null;
  }
}

export function readForcedTvTier(storage = globalThis.localStorage) {
  const value = readStorage(storage, FORCED_TIER_KEY);
  return value === "full" || value === "constrained" ? value : null;
}

/** "constrained" when this TV was measured slow on this app version, else null. */
export function readMeasuredTvTier(appVersion = "", storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(readStorage(storage, STORAGE_KEY) || "null");
    // A new build may be lighter: let it be measured again.
    return stored?.tier === "constrained" && stored.appVersion === String(appVersion)
      ? "constrained"
      : null;
  } catch (_error) {
    return null;
  }
}

export function storeMeasuredTvTier(
  { tier, appVersion = "", lostMs = 0 },
  storage = globalThis.localStorage
) {
  try {
    storage?.setItem?.(
      STORAGE_KEY,
      JSON.stringify({ tier, appVersion: String(appVersion), lostMs, at: Date.now() })
    );
  } catch (_error) {
    // Without storage the TV is simply measured again next launch.
  }
}

export function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

export function createFramePaceMonitor({
  onSlow,
  policy = TV_FRAME_PACE_POLICY,
  now = () => globalThis.performance.now(),
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback)
} = {}) {
  const startedAt = now();
  const samples = [];
  let sampling = false;
  let reported = false;

  return {
    samples,
    // Call on every key press. Presses that arrive while a window is open
    // (held keys) are covered by that window.
    noteKey() {
      if (reported || sampling || now() - startedAt < policy.warmupMs) {
        return;
      }
      sampling = true;
      const keyAt = now();
      let lastFrameAt = keyAt;
      let lostMs = 0;
      const onFrame = () => {
        const frameAt = now();
        const interval = frameAt - lastFrameAt;
        lastFrameAt = frameAt;
        if (interval > policy.lateFrameMs) {
          lostMs += interval - policy.frameMs;
        }
        if (frameAt - keyAt < policy.windowMs) {
          requestFrame(onFrame);
          return;
        }
        sampling = false;
        samples.push(lostMs);
        if (samples.length > policy.sampleKeys) {
          samples.shift();
        }
        const typical = median(samples);
        if (samples.length >= policy.sampleKeys && typical > policy.slowLostMs) {
          reported = true;
          onSlow?.(typical);
        }
      };
      requestFrame(onFrame);
    }
  };
}
