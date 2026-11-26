import test from "node:test";
import assert from "node:assert/strict";

// Reproduces legacy Tizen/webOS Chromium builds without AbortController: a stalled
// request or body read must still settle instead of throwing ReferenceError or hanging.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const { mediaServerRequest } = await import("../js/data/mediaserver/mediaBrowserClient.js");
const { parentalGuideRepository } =
  await import("../js/data/repository/parentalGuideRepository.js");
const { getLatestAppUpdate } = await import("../js/core/update/appUpdateService.js");

function withoutAbortController(task) {
  const original = globalThis.AbortController;
  delete globalThis.AbortController;
  return Promise.resolve()
    .then(task)
    .finally(() => {
      globalThis.AbortController = original;
    });
}

function withoutConsoleWarn(task) {
  const original = console.warn;
  console.warn = () => {};
  return Promise.resolve()
    .then(task)
    .finally(() => {
      console.warn = original;
    });
}

test("media server request times out without AbortController", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    await withoutAbortController(async () => {
      const request = mediaServerRequest(
        { address: "http://192.168.1.10:8096", providerId: "jellyfin" },
        "/System/Info/Public"
      );
      t.mock.timers.tick(15000);
      await assert.rejects(request, (error) => error?.code === "REQUEST_TIMEOUT");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parental guide body read times out without AbortController", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
  try {
    await withoutAbortController(() =>
      withoutConsoleWarn(async () => {
        const request = parentalGuideRepository.getMovieGuide("tt0133093");
        t.mock.timers.tick(3500);
        assert.equal(await request, null);
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub release body read is covered by the update timeout", async () => {
  await assert.rejects(
    getLatestAppUpdate({
      currentVersion: "1.4.8",
      fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }),
      timeoutMs: 20
    }),
    (error) => error?.code === "REQUEST_TIMEOUT"
  );
});
