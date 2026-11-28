import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "navigator", {
  value: { hardwareConcurrency: 2, deviceMemory: 1 },
  configurable: true
});
if (typeof globalThis.OffscreenCanvas !== "function") {
  globalThis.OffscreenCanvas = class MockOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { drawImage() {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(["ok"], { type: "image/jpeg" }));
    }
  };
}
if (typeof globalThis.createImageBitmap !== "function") {
  globalThis.createImageBitmap = async () => ({ width: 800, height: 1200, close() {} });
}

const createdWorkers = [];
const createdUrls = [];
URL.createObjectURL = (blob) => {
  if (typeof blob?.parts?.[0] === "string" && blob.parts[0].includes("self.onmessage")) {
    return "blob:mock-worker";
  }
  const url = `blob:poster-${createdUrls.length + 1}`;
  createdUrls.push(url);
  return url;
};
URL.revokeObjectURL = () => {};

const OriginalBlob = globalThis.Blob;
globalThis.Blob = class MockBlob {
  constructor(parts, opts) {
    this.parts = parts;
    this.type = opts?.type || "";
    this.size = parts?.[0]?.length || 0;
  }
};

class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    createdWorkers.push(this);
  }
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;

const { rescaleHomeArtwork, resetHomeArtworkRescaler } = await import("./tvPosterRescaler.js");

function makeJpegHeaderBytes(width, height, padding = 64) {
  const bytes = new Uint8Array(24 + padding);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes[4] = 0x00;
  bytes[5] = 0x11;
  bytes[6] = 0x08;
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  bytes[11] = 0x03;
  return bytes;
}

test("worker short-circuits already small JPEG before calling createImageBitmap and sniffs chunks[0] directly", async () => {
  resetHomeArtworkRescaler();
  createdWorkers.length = 0;

  let capturedSource = "";
  const prevBlob = globalThis.Blob;
  globalThis.Blob = class CaptureBlob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = opts?.type || "";
      if (typeof parts?.[0] === "string" && parts[0].includes("self.onmessage")) {
        capturedSource = parts[0];
      }
    }
  };

  try {
    const smallJpeg = makeJpegHeaderBytes(280, 420);
    const pending = rescaleHomeArtwork("https://image.tmdb.org/t/p/w342/small.jpg", {
      width: 300,
      height: 450,
      fit: "cover"
    });
    const worker = createdWorkers[0];
    assert.ok(worker?.posted?.length === 1);
    assert.ok(capturedSource.includes("already small"));

    let decodeCalls = 0;
    const responses = [];
    const selfScope = {
      onmessage: null,
      fetch: async () => {
        let index = 0;
        const chunks = [smallJpeg];
        return {
          ok: true,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: async () =>
                index < chunks.length
                  ? { done: false, value: chunks[index++] }
                  : { done: true, value: undefined },
              cancel: async () => {}
            })
          }
        };
      },
      createImageBitmap: async () => {
        decodeCalls += 1;
        throw new Error("should not decode already-small image");
      },
      OffscreenCanvas: globalThis.OffscreenCanvas,
      postMessage: (msg) => {
        responses.push(msg);
        worker.onmessage({ data: msg });
      }
    };

    const fn = new Function(
      "self",
      "fetch",
      "createImageBitmap",
      "OffscreenCanvas",
      "Blob",
      "AbortController",
      capturedSource
    );
    fn(
      selfScope,
      selfScope.fetch,
      selfScope.createImageBitmap,
      selfScope.OffscreenCanvas,
      prevBlob,
      globalThis.AbortController
    );
    await selfScope.onmessage({ data: worker.posted.shift() });

    const settled = await pending;
    assert.equal(settled, null);
    assert.equal(decodeCalls, 0);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, false);
    assert.equal(responses[0].reason, "already small");
  } finally {
    globalThis.Blob = prevBlob;
    resetHomeArtworkRescaler();
  }
});

test("in-flight single-waiter job that becomes stale skips URL.createObjectURL and does not poison future requests", async () => {
  resetHomeArtworkRescaler();
  createdWorkers.length = 0;
  createdUrls.length = 0;

  let stale = false;
  const firstPromise = rescaleHomeArtwork("https://image.tmdb.org/t/p/w500/poster.jpg", {
    width: 240,
    height: 360,
    fit: "cover",
    isStale: () => stale
  });

  const worker = createdWorkers.find((w) => !w.terminated && w.posted.length);
  assert.ok(worker?.posted?.length);
  const firstJob = worker.posted.shift();

  // Card scrolls off-screen while the worker was rescaling.
  stale = true;
  worker.onmessage({
    data: { id: firstJob.id, ok: true, blob: new OriginalBlob(["scaled"]) }
  });
  const firstResult = await firstPromise;
  assert.equal(firstResult, null);
  assert.equal(createdUrls.length, 0, "stale single-waiter result must not allocate object URL");

  // Re-visiting the card must still rescale cleanly (not cached as a failure).
  stale = false;
  const secondPromise = rescaleHomeArtwork("https://image.tmdb.org/t/p/w500/poster.jpg", {
    width: 240,
    height: 360,
    fit: "cover",
    isStale: () => stale
  });
  const activeWorker = createdWorkers.find((w) => !w.terminated && w.posted.length);
  assert.ok(activeWorker?.posted?.length);
  const secondJob = activeWorker.posted.shift();
  activeWorker.onmessage({
    data: { id: secondJob.id, ok: true, blob: new OriginalBlob(["scaled"]) }
  });
  const secondResult = await secondPromise;
  assert.equal(secondResult, "blob:poster-1");

  resetHomeArtworkRescaler();
});
