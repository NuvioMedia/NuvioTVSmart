import assert from "node:assert/strict";
import test from "node:test";

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

const { TizenEngineFsService } = await import("./tizenEngineFsService.js");
const { resolveTizenDirectRedirect } = await import("./tizenRedirectResolver.js");

test("TizenEngineFsService.probeBaseUrl aborts stalled response.json() on timeout without unhandled rejection", async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal = null;
  let unhandledCount = 0;
  const onUnhandled = () => {
    unhandledCount += 1;
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    globalThis.fetch = (_url, options = {}) => {
      capturedSignal = options.signal || null;
      return Promise.resolve({
        ok: true,
        status: 200,
        clone() {
          return {
            json: () => new Promise(() => {})
          };
        },
        json: () => new Promise(() => {})
      });
    };

    await assert.rejects(
      () =>
        Promise.race([
          TizenEngineFsService.probeBaseUrl("http://127.0.0.1:2710", 25),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("hanging json did not timeout")), 120)
          )
        ]),
      /timed out/i
    );
    assert.ok(capturedSignal, "probeBaseUrl must pass an AbortSignal to fetch");
    assert.equal(capturedSignal.aborted, true, "probeBaseUrl timeout must abort fetch controller");

    // Also ensure late rejection on stalled fetch after timeout causes zero unhandledRejection.
    globalThis.fetch = (_url, options = {}) => {
      capturedSignal = options.signal || null;
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("late fetch failure")), 40);
      });
    };
    await assert.rejects(
      () => TizenEngineFsService.probeBaseUrl("http://127.0.0.1:2710", 15),
      /timed out/i
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(unhandledCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.off("unhandledRejection", onUnhandled);
  }
});

test("resolveTizenDirectRedirect suppresses unhandled rejections from aborted request and body.cancel()", async () => {
  let unhandledCount = 0;
  const onUnhandled = () => {
    unhandledCount += 1;
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    // 1. Failing body.cancel() promise must not trigger unhandledRejection.
    const result1 = await resolveTizenDirectRedirect(
      "https://cdn.example.com/file.mp4",
      {},
      {
        timeoutMs: 100,
        fetchImpl: async () => ({
          url: "https://edge.example.com/file.mp4",
          status: 200,
          headers: { get: () => null },
          body: {
            cancel: () => Promise.reject(new Error("cancel failed"))
          }
        })
      }
    );
    assert.equal(result1.redirected, true);

    // 2. Late-rejecting request after timeout must not trigger unhandledRejection.
    const result2 = await resolveTizenDirectRedirect(
      "https://cdn.example.com/slow.mp4",
      {},
      {
        timeoutMs: 15,
        fetchImpl: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late abort failure")), 35);
          })
      }
    );
    assert.equal(result2.redirected, false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(unhandledCount, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
