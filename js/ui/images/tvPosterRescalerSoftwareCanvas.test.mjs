import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { WORKER_SOURCE } from "./tvPosterRescaler.js";

function jpegBytes(width = 800, height = 1200) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

function webpVp8lBytes(width = 600, height = 900, alpha = true) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28);
  const payload = [
    0x2f,
    bits & 0xff,
    (bits >>> 8) & 0xff,
    (bits >>> 16) & 0xff,
    (bits >>> 24) & 0xff
  ];
  const riffSize = 4 + 8 + payload.length + (payload.length & 1);
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    riffSize & 0xff,
    (riffSize >>> 8) & 0xff,
    (riffSize >>> 16) & 0xff,
    (riffSize >>> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x4c,
    payload.length & 0xff,
    (payload.length >>> 8) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 24) & 0xff,
    ...payload,
    0x00
  ]);
}

function pngBytes(width = 1200, height = 400) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  const chunk = (type, data) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) head[4 + i] = type.charCodeAt(i);
    return [...head, ...data, 0, 0, 0, 0];
  };
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", new Uint8Array(4)),
    ...chunk("IEND", [])
  ]);
}

function createWorkerHarness(fetchHandler) {
  const messages = [];
  const contextCalls = [];
  let activeDecodes = 0;
  let maxActiveDecodes = 0;
  let activeFetches = 0;
  let maxActiveFetches = 0;
  let closedBitmaps = 0;

  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext(type, options) {
      contextCalls.push({ width: this.width, height: this.height, type, options });
      return { drawImage: () => {} };
    }
    async convertToBlob(options) {
      await new Promise((r) => setTimeout(r, 5));
      return { type: options?.type || "image/jpeg", size: 123 };
    }
  }

  const context = vm.createContext({
    AbortController,
    Blob,
    Uint8Array,
    Promise,
    Number,
    String,
    Boolean,
    Math,
    Error,
    setTimeout,
    clearTimeout,
    OffscreenCanvas: FakeOffscreenCanvas,
    async fetch(url, opts) {
      activeFetches += 1;
      if (activeFetches > maxActiveFetches) maxActiveFetches = activeFetches;
      try {
        return await fetchHandler(url, opts);
      } finally {
        activeFetches -= 1;
      }
    },
    async createImageBitmap(blob, opts) {
      activeDecodes += 1;
      if (activeDecodes > maxActiveDecodes) maxActiveDecodes = activeDecodes;
      try {
        await new Promise((r) => setTimeout(r, 15));
        const sizeHint = Number(opts?.resizeWidth || 0);
        if (blob?.type === "fail") {
          throw new Error("decode failed");
        }
        return {
          width: sizeHint > 0 ? sizeHint : 800,
          height: 1200,
          close() {
            closedBitmaps += 1;
          }
        };
      } finally {
        activeDecodes -= 1;
      }
    }
  });
  context.self = context;
  context.postMessage = (msg) => messages.push(msg);
  vm.runInContext(WORKER_SOURCE, context);

  return {
    send: (data) => context.onmessage({ data }),
    messages,
    contextCalls,
    getMaxActiveDecodes: () => maxActiveDecodes,
    getMaxActiveFetches: () => maxActiveFetches,
    getClosedBitmaps: () => closedBitmaps
  };
}

test("poster and logo OffscreenCanvas contexts request willReadFrequently software rasterization", async () => {
  const files = new Map([
    ["https://art/poster.jpg", jpegBytes(800, 1200)],
    ["https://art/poster-alpha.webp", webpVp8lBytes(600, 900, true)],
    ["https://art/logo.png", pngBytes(1200, 400)]
  ]);
  const h = createWorkerHarness(async (url) => {
    const bytes = files.get(url);
    return {
      ok: true,
      headers: { get: () => String(bytes.byteLength) },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  });

  await h.send({ id: 1, url: "https://art/poster.jpg", width: 220, height: 338, fit: "cover" });
  await h.send({
    id: 2,
    url: "https://art/poster-alpha.webp",
    width: 220,
    height: 338,
    fit: "cover"
  });
  await h.send({
    id: 3,
    url: "https://art/logo.png",
    width: 440,
    height: 200,
    fit: "contain",
    kind: "logo"
  });

  assert.equal(h.messages.length, 3);
  assert.ok(h.messages.every((m) => m.ok === true));
  assert.equal(h.contextCalls.length, 3);
  assert.deepEqual({ ...h.contextCalls[0].options }, { alpha: false, willReadFrequently: true });
  assert.deepEqual({ ...h.contextCalls[1].options }, { alpha: true, willReadFrequently: true });
  assert.deepEqual({ ...h.contextCalls[2].options }, { alpha: true, willReadFrequently: true });
});

test("worker overlaps network fetches while serializing decode/encode and recovers after errors", async () => {
  const bytes = jpegBytes(800, 1200);
  const h = createWorkerHarness(async (url) => {
    await new Promise((r) => setTimeout(r, 10));
    const data = url.includes("small") ? jpegBytes(100, 150) : bytes;
    return {
      ok: true,
      headers: { get: () => String(data.byteLength) },
      async arrayBuffer() {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    };
  });

  await Promise.all([
    h.send({ id: 10, url: "https://art/small.jpg", width: 900, height: 1400, fit: "cover" }),
    h.send({ id: 11, url: "https://art/p1.jpg", width: 220, height: 338, fit: "cover" }),
    h.send({ id: 12, url: "https://art/p2.jpg", width: 220, height: 338, fit: "cover" })
  ]);

  assert.equal(h.getMaxActiveFetches(), 3, "network fetches must still overlap concurrently");
  assert.equal(h.getMaxActiveDecodes(), 1, "decode/encode must run exclusively per worker");
  const byId = new Map(h.messages.map((m) => [m.id, m]));
  assert.equal(byId.get(10)?.ok, false);
  assert.equal(byId.get(10)?.reason, "already small");
  assert.equal(byId.get(11)?.ok, true);
  assert.equal(byId.get(12)?.ok, true);
  assert.equal(
    h.getClosedBitmaps(),
    2,
    "pre-decode header skip avoids creating bitmap for small.jpg while closing remaining decoded bitmaps"
  );
});

test("rescaleHomeArtwork skips URL.createObjectURL when a single-waiter job becomes stale mid-flight, while shared jobs still resolve", async () => {
  const posterBlobUrls = [];
  const origWorker = globalThis.Worker;
  const origOffscreenCanvas = globalThis.OffscreenCanvas;
  const origCreateImageBitmap = globalThis.createImageBitmap;
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const origUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const origDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const origTizen = globalThis.tizen;
  const origWebapis = globalThis.webapis;
  const origBlob = globalThis.Blob;

  const createdWorkers = [];
  class FakePoolWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      createdWorkers.push(this);
    }
    postMessage(msg) {
      this.lastMsg = msg;
    }
    terminate() {}
  }

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      value: 2,
      configurable: true
    });
    globalThis.tizen = {};
    globalThis.webapis = {};
    globalThis.Worker = FakePoolWorker;
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.Blob = class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts?.type || "";
        this.isWorkerSource =
          Array.isArray(parts) &&
          typeof parts[0] === "string" &&
          parts[0].includes("self.onmessage");
      }
    };
    globalThis.URL.createObjectURL = (blob) => {
      if (blob?.isWorkerSource) return "blob:worker/1";
      const id = `blob:poster/${posterBlobUrls.length + 1}`;
      posterBlobUrls.push(id);
      return id;
    };
    globalThis.URL.revokeObjectURL = () => {};

    const rescaler = await import(`./tvPosterRescaler.js?stale=${Date.now()}`);
    rescaler.resetHomeArtworkRescaler();

    let staleFlag = false;
    const stalePromise = rescaler.rescaleHomeArtwork("https://art/stale-midflight.jpg", {
      width: 220,
      height: 338,
      fit: "cover",
      isStale: () => staleFlag
    });
    const w1 = createdWorkers.find((w) => w.lastMsg?.url === "https://art/stale-midflight.jpg");
    assert.ok(w1, "expected worker to receive single-waiter job");
    staleFlag = true;
    w1.onmessage({
      data: { id: w1.lastMsg.id, ok: true, blob: { isPosterBlob: true } }
    });
    const staleResult = await stalePromise;
    assert.equal(staleResult, null, "stale single-waiter job must resolve null");
    assert.equal(posterBlobUrls.length, 0, "stale single-waiter job must skip URL.createObjectURL");

    let waiter1Stale = false;
    const p1 = rescaler.rescaleHomeArtwork("https://art/shared-midflight.jpg", {
      width: 220,
      height: 338,
      fit: "cover",
      isStale: () => waiter1Stale
    });
    const p2 = rescaler.rescaleHomeArtwork("https://art/shared-midflight.jpg", {
      width: 220,
      height: 338,
      fit: "cover",
      isStale: () => false
    });
    waiter1Stale = true;
    const w2 = createdWorkers.find((w) => w.lastMsg?.url === "https://art/shared-midflight.jpg");
    assert.ok(w2, "expected worker to receive shared job");
    w2.onmessage({
      data: { id: w2.lastMsg.id, ok: true, blob: { isPosterBlob: true } }
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, "blob:poster/1");
    assert.equal(r2, "blob:poster/1");
    assert.equal(
      posterBlobUrls.length,
      1,
      "multi-waiter shared job must still create one object URL"
    );

    rescaler.resetHomeArtworkRescaler();
  } finally {
    globalThis.Worker = origWorker;
    globalThis.OffscreenCanvas = origOffscreenCanvas;
    globalThis.createImageBitmap = origCreateImageBitmap;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    globalThis.Blob = origBlob;
    if (origUserAgent) Object.defineProperty(globalThis.navigator, "userAgent", origUserAgent);
    if (origDeviceMemory)
      Object.defineProperty(globalThis.navigator, "deviceMemory", origDeviceMemory);
    if (origTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = origTizen;
    if (origWebapis === undefined) delete globalThis.webapis;
    else globalThis.webapis = origWebapis;
  }
});

test("worker completions defer URL.createObjectURL and pump while .is-camera-scrolling is active, batch-flushing after clear or max-wait cap", async () => {
  const posterBlobUrls = [];
  const origWorker = globalThis.Worker;
  const origOffscreenCanvas = globalThis.OffscreenCanvas;
  const origCreateImageBitmap = globalThis.createImageBitmap;
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const origDocument = globalThis.document;
  const origUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const origDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const origTizen = globalThis.tizen;
  const origWebapis = globalThis.webapis;
  const origBlob = globalThis.Blob;

  const createdWorkers = [];
  class FakePoolWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.posted = [];
      createdWorkers.push(this);
    }
    postMessage(msg) {
      this.posted.push(msg);
    }
    terminate() {}
  }

  let cameraScrolling = false;
  const querySelectors = [];

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      value: 2,
      configurable: true
    });
    globalThis.tizen = {};
    globalThis.webapis = {};
    globalThis.Worker = FakePoolWorker;
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.document = {
      querySelector(selector) {
        querySelectors.push(selector);
        return selector === ".is-camera-scrolling" && cameraScrolling ? {} : null;
      }
    };
    globalThis.Blob = class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts?.type || "";
        this.isWorkerSource =
          Array.isArray(parts) &&
          typeof parts[0] === "string" &&
          parts[0].includes("self.onmessage");
      }
    };
    globalThis.URL.createObjectURL = (blob) => {
      if (blob?.isWorkerSource) return "blob:worker/1";
      const id = `blob:poster/${posterBlobUrls.length + 1}`;
      posterBlobUrls.push(id);
      return id;
    };
    globalThis.URL.revokeObjectURL = () => {};

    const rescaler = await import(`./tvPosterRescaler.js?cameraScroll=${Date.now()}`);
    rescaler.resetHomeArtworkRescaler();

    // Queue 8 jobs while idle (3 workers x 2 slots = 6 active, 2 queued behind them).
    const promises = Array.from({ length: 8 }, (_, index) =>
      rescaler.rescaleHomeArtwork(`https://art/cam-${index}.jpg`, {
        width: 220,
        height: 338,
        fit: "cover"
      })
    );
    const activeMsgs = createdWorkers.flatMap((w) => w.posted.map((msg) => ({ w, msg })));
    assert.equal(activeMsgs.length, 6, "6 initial slots dispatched across 3 workers x 2 slots");

    // Enter .is-camera-scrolling and settle 2 worker replies.
    cameraScrolling = true;
    const settledEntries = activeMsgs.slice(0, 2);
    const settledPromiseIndices = settledEntries.map(({ msg }) =>
      Number(msg.url.match(/cam-(\d+)\.jpg/)[1])
    );
    settledEntries.forEach(({ w, msg }) => {
      w.onmessage({ data: { id: msg.id, ok: true, blob: { isPosterBlob: true } } });
    });

    assert.ok(querySelectors.includes(".is-camera-scrolling"));
    assert.equal(
      posterBlobUrls.length,
      0,
      "must not call URL.createObjectURL while .is-camera-scrolling is active"
    );
    assert.equal(
      createdWorkers.reduce((sum, w) => sum + w.posted.length, 0),
      8,
      "worker.onmessage must immediately release idle slot and pump queued jobs during .is-camera-scrolling"
    );

    // Clear .is-camera-scrolling and wait for deferred completions to flush.
    cameraScrolling = false;
    await new Promise((r) => setTimeout(r, 110));

    assert.equal(
      posterBlobUrls.length,
      2,
      "deferred completions must flush once after .is-camera-scrolling clears"
    );
    assert.equal(
      createdWorkers.reduce((sum, w) => sum + w.posted.length, 0),
      8
    );
    const firstTwo = await Promise.all(settledPromiseIndices.map((idx) => promises[idx]));
    assert.deepEqual(firstTwo, ["blob:poster/1", "blob:poster/2"]);

    // Verify ~450ms max-wait safety cap flushes even if .is-camera-scrolling stays stuck.
    cameraScrolling = true;
    const settledIds = new Set(settledEntries.map(({ msg }) => msg.id));
    const remainingMsgs = createdWorkers
      .flatMap((w) => w.posted.map((msg) => ({ w, msg })))
      .filter(({ msg }) => !settledIds.has(msg.id));
    assert.equal(remainingMsgs.length, 6);
    remainingMsgs.forEach(({ w, msg }) => {
      w.onmessage({ data: { id: msg.id, ok: true, blob: { isPosterBlob: true } } });
    });
    assert.equal(posterBlobUrls.length, 2, "must still defer initially while stuck scrolling");

    await new Promise((r) => setTimeout(r, 680));
    assert.equal(
      posterBlobUrls.length,
      8,
      "max-wait safety cap (~450ms) must flush stalled completions so jobs are never stranded"
    );
    const allResults = await Promise.all(promises);
    assert.equal(allResults.filter(Boolean).length, 8);

    rescaler.resetHomeArtworkRescaler();
  } finally {
    globalThis.Worker = origWorker;
    globalThis.OffscreenCanvas = origOffscreenCanvas;
    globalThis.createImageBitmap = origCreateImageBitmap;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    if (origDocument === undefined) delete globalThis.document;
    else globalThis.document = origDocument;
    globalThis.Blob = origBlob;
    if (origUserAgent) Object.defineProperty(globalThis.navigator, "userAgent", origUserAgent);
    if (origDeviceMemory)
      Object.defineProperty(globalThis.navigator, "deviceMemory", origDeviceMemory);
    if (origTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = origTizen;
    if (origWebapis === undefined) delete globalThis.webapis;
    else globalThis.webapis = origWebapis;
  }
});

test("worker completions and pump defer past 380ms keydown pace window and chunk flushes at 1 per frame even between keys", async () => {
  const posterBlobUrls = [];
  const origWorker = globalThis.Worker;
  const origOffscreenCanvas = globalThis.OffscreenCanvas;
  const origCreateImageBitmap = globalThis.createImageBitmap;
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const origDocument = globalThis.document;
  const origAddEventListener = globalThis.addEventListener;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;
  const origUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const origDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const origTizen = globalThis.tizen;
  const origWebapis = globalThis.webapis;
  const origBlob = globalThis.Blob;

  const createdWorkers = [];
  class FakePoolWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.posted = [];
      createdWorkers.push(this);
    }
    postMessage(msg) {
      this.posted.push(msg);
    }
    terminate() {}
  }

  let keydownHandler = null;
  let addKeydownListenerCalls = 0;
  const chunkRafCallbacks = [];

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      value: 2,
      configurable: true
    });
    globalThis.tizen = {};
    globalThis.webapis = {};
    globalThis.Worker = FakePoolWorker;
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.document = { querySelector: () => null };
    globalThis.addEventListener = (type, fn) => {
      if (type === "keydown") {
        addKeydownListenerCalls += 1;
        keydownHandler = fn;
      }
    };
    globalThis.requestAnimationFrame = (cb) => {
      chunkRafCallbacks.push(cb);
      return chunkRafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.Blob = class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts?.type || "";
        this.isWorkerSource =
          Array.isArray(parts) &&
          typeof parts[0] === "string" &&
          parts[0].includes("self.onmessage");
      }
    };
    globalThis.URL.createObjectURL = (blob) => {
      if (blob?.isWorkerSource) return "blob:worker/1";
      const id = `blob:poster/${posterBlobUrls.length + 1}`;
      posterBlobUrls.push(id);
      return id;
    };
    globalThis.URL.revokeObjectURL = () => {};

    const rescaler = await import(`./tvPosterRescaler.js?keydownChunk=${Date.now()}`);
    rescaler.resetHomeArtworkRescaler();

    const promises = Array.from({ length: 6 }, (_, index) =>
      rescaler.rescaleHomeArtwork(`https://art/chunk-${index}.jpg`, {
        width: 220,
        height: 338,
        fit: "cover"
      })
    );
    assert.equal(addKeydownListenerCalls, 1, "must bind passive keydown listener once");
    assert.equal(typeof keydownHandler, "function");

    // Recreate pool to verify idempotency of keydown listener registration.
    rescaler.resetHomeArtworkRescaler();
    const promises2 = Array.from({ length: 8 }, (_, index) =>
      rescaler.rescaleHomeArtwork(`https://art/chunk2-${index}.jpg`, {
        width: 220,
        height: 338,
        fit: "cover",
        priority: 0
      })
    );
    assert.equal(addKeydownListenerCalls, 1, "keydown listener registration must be idempotent");
    await Promise.all(promises);

    // Trigger keydown while .is-camera-scrolling is false:
    // - completions must defer 355ms before URL.createObjectURL
    // - worker slots (3 workers x 2 slots = 6) must release and pump remaining 2 jobs immediately
    // - after 355ms, all 8 priority-0 completions drain at 20ms spacing with no 3-poster cap.
    keydownHandler();
    const firstMsgs = createdWorkers.slice(-3).flatMap((w) => w.posted.map((msg) => ({ w, msg })));
    assert.equal(firstMsgs.length, 6);
    const seenIds = new Set(firstMsgs.map(({ msg }) => msg.id));
    firstMsgs.forEach(({ w, msg }) => {
      w.onmessage({ data: { id: msg.id, ok: true, blob: { isPosterBlob: true } } });
    });

    const nextMsgs = createdWorkers
      .slice(-3)
      .flatMap((w) => w.posted.map((msg) => ({ w, msg })))
      .filter(({ msg }) => !seenIds.has(msg.id));
    assert.equal(
      nextMsgs.length,
      2,
      "worker.onmessage must immediately free slots and pump remaining 2 jobs inside 355ms window"
    );
    nextMsgs.forEach(({ w, msg }) => {
      w.onmessage({ data: { id: msg.id, ok: true, blob: { isPosterBlob: true } } });
    });

    await new Promise((r) => setTimeout(r, 230));
    assert.equal(posterBlobUrls.length, 0, "must defer completions inside 355ms keydown window");

    // After 355ms clears, priority-0 completions drain one at a time spaced by 20ms setTimeout (not rAF).
    await new Promise((r) => setTimeout(r, 175));
    assert.ok(
      posterBlobUrls.length >= 1 && posterBlobUrls.length < 8,
      `expected incremental 20ms flush after 355ms, got ${posterBlobUrls.length}`
    );
    assert.equal(
      chunkRafCallbacks.length,
      0,
      "post-settle <1050ms window must space via 20ms setTimeout instead of 16ms rAF"
    );

    await new Promise((r) => setTimeout(r, 260));
    assert.equal(
      posterBlobUrls.length,
      8,
      "all 8 queued priority-0 posters must finish draining at 20ms spacing without starvation cap"
    );
    const settled = await Promise.all(promises2);
    assert.equal(settled.filter(Boolean).length, 8);

    // Verify pump() dispatches immediately inside 355ms keydown window while completion waits past 355ms,
    // and completions arriving at rest (>1150ms) fall back to 16ms rAF chunking.
    const countBeforeDefer = createdWorkers.reduce((sum, w) => sum + w.posted.length, 0);
    keydownHandler();
    const deferredPumpPromise = rescaler.rescaleHomeArtwork("https://art/pump-deferred.jpg", {
      width: 220,
      height: 338,
      fit: "cover",
      priority: 0
    });
    assert.equal(
      createdWorkers.reduce((sum, w) => sum + w.posted.length, 0),
      countBeforeDefer + 1,
      "pump() must dispatch worker work immediately even inside 355ms keydown window"
    );
    const deferredMsg = createdWorkers
      .slice(-3)
      .flatMap((w) => w.posted.map((msg) => ({ w, msg })))
      .find(({ msg }) => msg.url === "https://art/pump-deferred.jpg");
    assert.ok(deferredMsg);
    deferredMsg.w.onmessage({
      data: { id: deferredMsg.msg.id, ok: true, blob: { isPosterBlob: true } }
    });
    assert.equal(
      posterBlobUrls.length,
      8,
      "completion inside 355ms must wait before createObjectURL"
    );
    await new Promise((r) => setTimeout(r, 410));
    assert.equal(await deferredPumpPromise, "blob:poster/9");

    // Wait past 1150ms from last keydown; new completion at rest uses 16ms rAF chunking.
    await new Promise((r) => setTimeout(r, 780));
    const restPromise = rescaler.rescaleHomeArtwork("https://art/rest-raf.jpg", {
      width: 220,
      height: 338,
      fit: "cover"
    });
    const restMsg = createdWorkers
      .slice(-3)
      .flatMap((w) => w.posted.map((msg) => ({ w, msg })))
      .find(({ msg }) => msg.url === "https://art/rest-raf.jpg");
    assert.ok(restMsg);
    restMsg.w.onmessage({
      data: { id: restMsg.msg.id, ok: true, blob: { isPosterBlob: true } }
    });
    assert.equal(
      chunkRafCallbacks.length,
      1,
      "completions at rest (>1150ms) must use rAF chunking"
    );
    chunkRafCallbacks.shift()();
    assert.equal(await restPromise, "blob:poster/10");

    rescaler.resetHomeArtworkRescaler();
  } finally {
    globalThis.Worker = origWorker;
    globalThis.OffscreenCanvas = origOffscreenCanvas;
    globalThis.createImageBitmap = origCreateImageBitmap;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    if (origDocument === undefined) delete globalThis.document;
    else globalThis.document = origDocument;
    if (origAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = origAddEventListener;
    if (origRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = origRaf;
    if (origCancelRaf === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = origCancelRaf;
    globalThis.Blob = origBlob;
    if (origUserAgent) Object.defineProperty(globalThis.navigator, "userAgent", origUserAgent);
    if (origDeviceMemory)
      Object.defineProperty(globalThis.navigator, "deviceMemory", origDeviceMemory);
    if (origTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = origTizen;
    if (origWebapis === undefined) delete globalThis.webapis;
    else globalThis.webapis = origWebapis;
  }
});

test("WORKER_SOURCE readPosterBytes sniffs chunks[0] directly when >= 30 bytes", async () => {
  assert.ok(
    WORKER_SOURCE.includes("chunks[0]?.byteLength >= 30 ? chunks[0] : concatChunks(chunks, total)"),
    "readPosterBytes must reuse chunks[0] for 30-byte header sniff when available"
  );
  const fullJpeg = jpegBytes(800, 1200);
  const firstChunk = fullJpeg.slice(0, 32);
  const secondChunk = fullJpeg.slice(32);
  let cancelled = false;
  const posted = [];
  const workerCtx = vm.createContext({
    Uint8Array,
    Blob,
    Promise,
    Math,
    Number,
    Error,
    setTimeout,
    clearTimeout,
    AbortController,
    self: {
      postMessage: (msg) => posted.push(msg)
    },
    fetch: async (url) => {
      let idx = 0;
      const streamChunks = url.includes("png")
        ? [new Uint8Array(32).fill(0x89), new Uint8Array(16)]
        : [firstChunk, secondChunk];
      return {
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () =>
              idx < streamChunks.length
                ? { done: false, value: streamChunks[idx++] }
                : { done: true },
            cancel: async () => {
              cancelled = true;
            }
          })
        }
      };
    },
    createImageBitmap: async () => ({ width: 800, height: 1200, close() {} }),
    OffscreenCanvas: class {
      getContext() {
        return { drawImage() {} };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
      }
    }
  });
  vm.runInContext(WORKER_SOURCE, workerCtx);

  await workerCtx.self.onmessage({
    data: { id: 1, url: "https://art/multi-chunk.jpg", width: 220, height: 338, fit: "cover" }
  });
  assert.equal(posted[0].ok, true);
  assert.equal(cancelled, false);

  await workerCtx.self.onmessage({
    data: { id: 2, url: "https://art/bad-header.png", width: 220, height: 338, fit: "cover" }
  });
  assert.equal(posted[1].ok, false);
  assert.equal(posted[1].reason, "not jpeg");
  assert.equal(cancelled, true);
});

test("Home rescaler prefers worker dataUrl (0 poster createObjectURL/revokeObjectURL) while generic pool stays on blob URLs", async () => {
  // 1. Verify WORKER_SOURCE FileReaderSync dataUrl fast path in VM.
  const fullJpeg = jpegBytes(800, 1200);
  const workerPosted = [];
  const workerCtx = vm.createContext({
    Uint8Array,
    Blob,
    Promise,
    Math,
    Number,
    Error,
    setTimeout,
    clearTimeout,
    AbortController,
    FileReaderSync: class {
      readAsDataURL(blob) {
        return `data:${blob.type || "image/jpeg"};base64,MOCKDATA`;
      }
    },
    self: {
      postMessage: (msg) => workerPosted.push(msg)
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => String(fullJpeg.byteLength) },
      arrayBuffer: async () =>
        fullJpeg.buffer.slice(fullJpeg.byteOffset, fullJpeg.byteOffset + fullJpeg.byteLength)
    }),
    createImageBitmap: async () => ({ width: 800, height: 1200, close() {} }),
    OffscreenCanvas: class {
      getContext() {
        return { drawImage() {} };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" }));
      }
    }
  });
  vm.runInContext(WORKER_SOURCE, workerCtx);

  await workerCtx.self.onmessage({
    data: {
      id: 1,
      url: "https://art/poster.jpg",
      width: 220,
      height: 338,
      fit: "cover",
      preferDataUrl: true
    }
  });
  assert.equal(workerPosted[0].ok, true);
  assert.equal(workerPosted[0].dataUrl, "data:image/jpeg;base64,MOCKDATA");
  assert.equal(workerPosted[0].blob, undefined);

  // 2. Verify Home pool uses data: URLs with 0 poster createObjectURL/revokeObjectURL calls,
  // refcounts & LRU-evicts cleanly, while generic pool (rescaleArtwork) uses blob: URLs.
  const origWorker = globalThis.Worker;
  const origOffscreenCanvas = globalThis.OffscreenCanvas;
  const origCreateImageBitmap = globalThis.createImageBitmap;
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const origUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const origDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const origTizen = globalThis.tizen;
  const origWebapis = globalThis.webapis;
  const origBlob = globalThis.Blob;

  const createdWorkers = [];
  const posterBlobCreated = [];
  const posterBlobRevoked = [];

  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.posted = [];
      createdWorkers.push(this);
    }
    postMessage(msg) {
      this.posted.push(msg);
      queueMicrotask(() => {
        if (msg.preferDataUrl) {
          this.onmessage?.({
            data: { id: msg.id, ok: true, dataUrl: `data:image/jpeg;base64,CARD_${msg.id}` }
          });
        } else {
          this.onmessage?.({
            data: { id: msg.id, ok: true, blob: new FakeBlob(["jpeg"], { type: "image/jpeg" }) }
          });
        }
      });
    }
    terminate() {}
  }
  class FakeBlob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = opts?.type || "";
      this.isWorkerSource =
        Array.isArray(parts) && typeof parts[0] === "string" && parts[0].includes("self.onmessage");
    }
  }

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      value: 1,
      configurable: true
    });
    globalThis.tizen = {};
    globalThis.webapis = {};
    globalThis.Worker = FakeWorker;
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.Blob = FakeBlob;
    globalThis.URL.createObjectURL = (blob) => {
      if (blob?.isWorkerSource) return `blob:worker/${createdWorkers.length + 1}`;
      const url = `blob:generic/${posterBlobCreated.length + 1}`;
      posterBlobCreated.push(url);
      return url;
    };
    globalThis.URL.revokeObjectURL = (url) => {
      if (!String(url).startsWith("blob:worker/")) {
        posterBlobRevoked.push(url);
      }
    };

    const rescaler = await import(`./tvPosterRescaler.js?preferDataUrl=${Date.now()}`);
    rescaler.resetHomeArtworkRescaler();
    rescaler.resetArtworkRescaler();

    const homeUrl1 = await rescaler.rescaleHomeArtwork("https://art/home-1.jpg", {
      width: 220,
      height: 338,
      fit: "cover"
    });
    assert.ok(homeUrl1.startsWith("data:image/jpeg;base64,"), "Home pool must resolve data: URL");
    assert.equal(posterBlobCreated.length, 0, "Home pool must make 0 poster createObjectURL calls");

    // Releasing + filling cache past low-memory cap (200) must never call revokeObjectURL on data: URIs.
    rescaler.releaseHomeArtwork(homeUrl1);
    for (let i = 2; i <= 205; i += 1) {
      const u = await rescaler.rescaleHomeArtwork(`https://art/home-${i}.jpg`, {
        width: 220,
        height: 338,
        fit: "cover"
      });
      rescaler.releaseHomeArtwork(u);
    }
    assert.equal(posterBlobCreated.length, 0, "Home cache trim must keep 0 createObjectURL calls");
    assert.equal(
      posterBlobRevoked.length,
      0,
      "Home cache trim must never call revokeObjectURL on data: URIs"
    );

    // Non-Home generic pool keeps blob: URLs without preferDataUrl.
    const genericUrl = await rescaler.rescaleArtwork("https://art/generic-1.jpg", {
      width: 220,
      height: 338,
      fit: "cover"
    });
    assert.equal(genericUrl, "blob:generic/1");
    assert.equal(posterBlobCreated.length, 1);

    rescaler.resetHomeArtworkRescaler();
    rescaler.resetArtworkRescaler();
    assert.deepEqual(posterBlobRevoked, ["blob:generic/1"]);
  } finally {
    globalThis.Worker = origWorker;
    globalThis.OffscreenCanvas = origOffscreenCanvas;
    globalThis.createImageBitmap = origCreateImageBitmap;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    globalThis.Blob = origBlob;
    if (origUserAgent) Object.defineProperty(globalThis.navigator, "userAgent", origUserAgent);
    if (origDeviceMemory)
      Object.defineProperty(globalThis.navigator, "deviceMemory", origDeviceMemory);
    if (origTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = origTizen;
    if (origWebapis === undefined) delete globalThis.webapis;
    else globalThis.webapis = origWebapis;
  }
});

test("priority-0 onScreen completions flush at 20ms after 355ms while offscreen priority>0 wait until 1150ms rest unless promoted", async () => {
  const origWorker = globalThis.Worker;
  const origOffscreenCanvas = globalThis.OffscreenCanvas;
  const origCreateImageBitmap = globalThis.createImageBitmap;
  const origCreateObjectURL = globalThis.URL.createObjectURL;
  const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const origDocument = globalThis.document;
  const origAddEventListener = globalThis.addEventListener;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;
  const origBlob = globalThis.Blob;
  const origUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const origDeviceMemory = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const origTizen = globalThis.tizen;
  const origWebapis = globalThis.webapis;

  const createdWorkers = [];
  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.posted = [];
      createdWorkers.push(this);
    }
    postMessage(msg) {
      this.posted.push(msg);
    }
    terminate() {}
  }
  class FakeBlob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = opts?.type || "";
      this.isWorkerSource =
        Array.isArray(parts) && typeof parts[0] === "string" && parts[0].includes("self.onmessage");
    }
  }

  let keydownHandler = null;
  const rafQueue = [];

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      value: 2,
      configurable: true
    });
    globalThis.tizen = {};
    globalThis.webapis = {};
    globalThis.Worker = FakeWorker;
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.document = { querySelector: () => null };
    globalThis.addEventListener = (type, fn) => {
      if (type === "keydown") keydownHandler = fn;
    };
    globalThis.requestAnimationFrame = (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.Blob = FakeBlob;
    globalThis.URL.createObjectURL = () => "blob:worker/1";
    globalThis.URL.revokeObjectURL = () => {};

    const rescaler = await import(`./tvPosterRescaler.js?priorityGate=${Date.now()}`);
    rescaler.resetHomeArtworkRescaler();

    const settledFlags = { offA: false, offB: false, vis1: false, vis2: false };
    const offA = rescaler
      .rescaleHomeArtwork("https://art/offscreen-a.jpg", {
        width: 220,
        height: 338,
        fit: "cover",
        priority: 2
      })
      .then((u) => {
        settledFlags.offA = true;
        return u;
      });
    const offB = rescaler
      .rescaleHomeArtwork("https://art/offscreen-b.jpg", {
        width: 220,
        height: 338,
        fit: "cover",
        priority: 2
      })
      .then((u) => {
        settledFlags.offB = true;
        return u;
      });
    const vis1 = rescaler
      .rescaleHomeArtwork("https://art/visible-1.jpg", {
        width: 220,
        height: 338,
        fit: "cover",
        priority: 0
      })
      .then((u) => {
        settledFlags.vis1 = true;
        return u;
      });
    const vis2 = rescaler
      .rescaleHomeArtwork("https://art/visible-2.jpg", {
        width: 220,
        height: 338,
        fit: "cover",
        priority: 0
      })
      .then((u) => {
        settledFlags.vis2 = true;
        return u;
      });

    keydownHandler();
    const postedMsgs = createdWorkers.flatMap((w) => w.posted.map((msg) => ({ w, msg })));
    assert.equal(postedMsgs.length, 4);
    // Deliver offscreen completions FIRST, then visible completions.
    postedMsgs.forEach(({ w, msg }) => {
      w.onmessage({
        data: { id: msg.id, ok: true, dataUrl: `data:image/jpeg;base64,${msg.id}` }
      });
    });

    // Wait past 355ms + 20ms pacing (< 1150ms): visible priority-0 settle, offscreen priority-2 hold.
    await new Promise((r) => setTimeout(r, 430));
    assert.equal(settledFlags.vis1, true, "priority-0 visible-1 must drain after 355ms");
    assert.equal(settledFlags.vis2, true, "priority-0 visible-2 must drain at 20ms after vis1");
    assert.equal(settledFlags.offA, false, "priority-2 offscreen-a must wait until 1150ms rest");
    assert.equal(settledFlags.offB, false, "priority-2 offscreen-b must wait until 1150ms rest");

    // Promote offscreen-a via priority: 0 before 1150ms rest; must settle on next tick without re-fetch.
    const postCountBeforePromote = createdWorkers.reduce((sum, w) => sum + w.posted.length, 0);
    const promotedA = rescaler.rescaleHomeArtwork("https://art/offscreen-a.jpg", {
      width: 220,
      height: 338,
      fit: "cover",
      priority: 0
    });
    assert.equal(
      createdWorkers.reduce((sum, w) => sum + w.posted.length, 0),
      postCountBeforePromote,
      "promoting a waiting completion must not dispatch a duplicate worker job"
    );
    await new Promise((r) => setTimeout(r, 45));
    assert.equal(settledFlags.offA, true, "promoted offscreen-a must drain on the very next tick");
    assert.equal(await promotedA, await offA);
    assert.equal(
      settledFlags.offB,
      false,
      "unpromoted offscreen-b must still wait for 1150ms rest"
    );

    // Wait past 1150ms quiet; restDrainTimer hands offscreen-b to rAF and resolves it.
    await new Promise((r) => setTimeout(r, 760));
    assert.equal(rafQueue.length, 1, "remaining offscreen-b must schedule rAF once 1150ms clears");
    rafQueue.shift()();
    assert.ok((await offB).startsWith("data:image/jpeg;base64,"));
    assert.ok((await vis1).startsWith("data:image/jpeg;base64,"));
    assert.ok((await vis2).startsWith("data:image/jpeg;base64,"));

    rescaler.resetHomeArtworkRescaler();
  } finally {
    globalThis.Worker = origWorker;
    globalThis.OffscreenCanvas = origOffscreenCanvas;
    globalThis.createImageBitmap = origCreateImageBitmap;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    globalThis.Blob = origBlob;
    if (origDocument === undefined) delete globalThis.document;
    else globalThis.document = origDocument;
    if (origAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = origAddEventListener;
    if (origRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = origRaf;
    if (origCancelRaf === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = origCancelRaf;
    if (origUserAgent) Object.defineProperty(globalThis.navigator, "userAgent", origUserAgent);
    if (origDeviceMemory)
      Object.defineProperty(globalThis.navigator, "deviceMemory", origDeviceMemory);
    if (origTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = origTizen;
    if (origWebapis === undefined) delete globalThis.webapis;
    else globalThis.webapis = origWebapis;
  }
});
