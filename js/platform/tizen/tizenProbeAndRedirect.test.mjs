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

test("probeBaseUrl bounds a stalled settings json() and aborts the request", async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal = null;
  try {
    globalThis.fetch = (_url, options = {}) => {
      capturedSignal = options.signal || null;
      return Promise.resolve({
        ok: true,
        status: 200,
        clone() {
          return { json: () => new Promise(() => {}) };
        },
        json: () => new Promise(() => {})
      });
    };
    await assert.rejects(
      () =>
        Promise.race([
          TizenEngineFsService.probeBaseUrl("http://127.0.0.1:2710", 25),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("hanging json did not timeout")), 200)
          )
        ]),
      /timed out/i
    );
    assert.ok(capturedSignal, "probeBaseUrl must pass an AbortSignal to fetch");
    assert.equal(capturedSignal.aborted, true, "timeout must abort the fetch controller");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveTizenDirectRedirect ignores a rejecting body.cancel()", async () => {
  let unhandledCount = 0;
  const onUnhandled = () => {
    unhandledCount += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const result = await resolveTizenDirectRedirect(
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
    assert.equal(result.redirected, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandledCount, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
