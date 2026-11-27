import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: (key) => storageMap.delete(String(key))
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  navigator: { language: "en-US", languages: ["en-US"] }
};

const { measureLatencyMs, runNetworkSpeedTest, runStreamSpeedTest } =
  await import("./networkSpeedTestService.js");

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [cleanupSource, networkTestsSource] = await Promise.all([
  readFile(
    new URL("../../ui/screens/settings/settingsScreenMethods-15-cleanup.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../../ui/screens/settings/settingsScreenMethods-17-network-tests.js", import.meta.url),
    "utf8"
  )
]);

function withTestTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} did not abort`)), 150))
  ]);
}

test("networkSpeedTestService aborts in-flight latency and stream tests immediately when signal fires", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = (_url, options = {}) => {
      fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        if (options.signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        options.signal?.addEventListener?.(
          "abort",
          () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true }
        );
      });
    };

    const controller1 = new AbortController();
    controller1.abort();
    assert.equal(
      await withTestTimeout(
        measureLatencyMs({ signal: controller1.signal, rounds: 3 }),
        "measureLatencyMs"
      ),
      0
    );
    assert.equal(fetchCalls, 0);

    const netResult = await withTestTimeout(
      runNetworkSpeedTest({ signal: controller1.signal }),
      "runNetworkSpeedTest"
    );
    assert.equal(netResult.error, "aborted");

    const streamResult = await withTestTimeout(
      runStreamSpeedTest("https://example.com/video.mp4", {}, { signal: controller1.signal }),
      "runStreamSpeedTest(pre-aborted)"
    );
    assert.equal(streamResult.error, "aborted");

    const controller2 = new AbortController();
    setTimeout(() => controller2.abort(), 15);
    const activeResult = await withTestTimeout(
      runStreamSpeedTest("https://example.com/video.mp4", {}, { signal: controller2.signal }),
      "runStreamSpeedTest(mid-flight)"
    );
    assert.equal(activeResult.error, "aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SettingsScreen cleanup aborts running network speed tests and ignores late resolution", async () => {
  let capturedSignal = null;
  let resolveTest = null;
  let renderCount = 0;

  const ctx = vm.createContext({
    AbortController,
    clearTimeout,
    cancelAnimationFrame: () => {},
    stopMdbListAuthorization: () => {},
    internals: {
      ScreenUtils: { hide() {} },
      LastPlaybackStore: { get: () => null },
      runStreamSpeedTest: () => Promise.resolve({ error: "aborted" }),
      runNetworkSpeedTest: ({ signal } = {}) => {
        capturedSignal = signal || null;
        return new Promise((resolve) => {
          resolveTest = resolve;
        });
      }
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${stripModule(cleanupSource)}\n${stripModule(networkTestsSource)}\nglobalThis.api = { ...createSettingsScreenMethods15(), ...createSettingsScreenMethods17() };`,
    ctx
  );

  const screen = Object.assign(Object.create(ctx.api), {
    isMounted: true,
    settingsMountToken: 1,
    container: null,
    persistUiState() {},
    stopDebridDeviceAuth() {},
    render() {
      renderCount += 1;
    }
  });

  screen.startNetworkSpeedTest();
  assert.ok(capturedSignal, "startNetworkSpeedTest must forward an AbortSignal");
  assert.equal(capturedSignal.aborted, false);
  const rendersBeforeCleanup = renderCount;

  screen.cleanup();
  assert.equal(capturedSignal.aborted, true, "cleanup must abort in-flight network speed test");

  resolveTest({ latencyMs: 12, downloadMbps: 95, error: "" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(screen.networkDownloadMbps, null);
  assert.equal(renderCount, rendersBeforeCleanup);
});
