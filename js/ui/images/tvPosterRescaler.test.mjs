import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  WORKER_SOURCE,
  artworkResizeTarget,
  artworkWorkerCount,
  computeSourceRect,
  isArtworkTooLarge,
  isJpegHeader,
  isRescalableArtworkFit,
  jpegDimensions,
  pngStillDimensions,
  rescaleArtwork,
  rescaleHomeArtwork,
  shouldQueueRescale,
  webpArtworkInfo
} from "./tvPosterRescaler.js";
import { getTvArtworkPixelRatio } from "../../platform/tvRuntimePerformance.js";

// Every existing crop case is a cover crop; fill has its own cases below.
const computeCoverRect = (nw, nh, bw, bh) => computeSourceRect(nw, nh, bw, bh, "cover");

function withScreen({ innerWidth, screenWidth, devicePixelRatio }) {
  const previous = {
    innerWidth: globalThis.innerWidth,
    screen: globalThis.screen,
    devicePixelRatio: globalThis.devicePixelRatio
  };
  Object.assign(globalThis, { innerWidth, screen: { width: screenWidth }, devicePixelRatio });
  try {
    return getTvArtworkPixelRatio();
  } finally {
    Object.assign(globalThis, previous);
  }
}

test("a wide addon thumbnail is cropped on its sides for a poster slot", () => {
  // The sports addons hand back 800x450 artwork for a 220x338 card, which is
  // the case that dominates decoded memory on the home screen.
  const rect = computeCoverRect(800, 450, 220, 338);
  assert.equal(rect.sy, 0);
  assert.equal(rect.sh, 450);
  assert.equal(rect.sw, 293);
  assert.equal(rect.sx, 254);
  assert.ok(rect.sx + rect.sw <= 800);
});

test("a tall source is cropped top and bottom instead", () => {
  const rect = computeCoverRect(300, 900, 220, 338);
  assert.equal(rect.sx, 0);
  assert.equal(rect.sw, 300);
  assert.equal(rect.sh, 461);
  assert.ok(rect.sy + rect.sh <= 900);
});

test("the crop keeps the box aspect ratio so nothing is stretched", () => {
  const boxAspect = 220 / 338;
  [
    [800, 450],
    [1024, 576],
    [1280, 720],
    [500, 750],
    [342, 513]
  ].forEach(([nw, nh]) => {
    const rect = computeCoverRect(nw, nh, 220, 338);
    assert.ok(Math.abs(rect.sw / rect.sh - boxAspect) < 0.01, `${nw}x${nh} kept its aspect`);
  });
});

test("a source already matching the box is taken whole", () => {
  const rect = computeCoverRect(220, 338, 220, 338);
  assert.deepEqual(rect, { sx: 0, sy: 0, sw: 220, sh: 338 });
});

test("a landscape backdrop slot crops a landscape source only slightly", () => {
  const rect = computeCoverRect(1280, 720, 428, 243);
  assert.equal(rect.sh, 720);
  assert.ok(rect.sw > 1200 && rect.sw <= 1280);
});

test("the crop never collapses to zero on extreme sources", () => {
  const rect = computeCoverRect(2000, 10, 220, 338);
  assert.ok(rect.sw >= 1);
  assert.ok(rect.sh >= 1);
});

test("a 1080p webOS panel is treated as one device pixel per css pixel", () => {
  // webOS reports 2 here even though the viewport is already the panel width.
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 1920, devicePixelRatio: 2 });
  assert.equal(ratio, 1);
});

test("a 4K panel laid out at 1920 still decodes at two device pixels", () => {
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 3840, devicePixelRatio: 2 });
  assert.equal(ratio, 2);
});

test("a browser that understates the ratio is not scaled below one", () => {
  const ratio = withScreen({ innerWidth: 1920, screenWidth: 960, devicePixelRatio: 1 });
  assert.equal(ratio, 1);
});

test("missing screen metrics fall back to one rather than throwing", () => {
  const ratio = withScreen({ innerWidth: 0, screenWidth: 0, devicePixelRatio: 0 });
  assert.equal(ratio, 1);
});

test("a stretched poster keeps the whole source, because fill never crops", () => {
  // Collection cards use object-fit: fill. Cropping one would change the
  // picture, so the source rectangle has to stay the whole image and only the
  // destination box shrinks.
  const rect = computeSourceRect(800, 450, 220, 338, "fill");
  assert.deepEqual(rect, { sx: 0, sy: 0, sw: 800, sh: 450 });
});

test("fill keeps the whole source whatever the box shape", () => {
  for (const [nw, nh] of [
    [200, 300],
    [1280, 720],
    [500, 500]
  ]) {
    assert.deepEqual(computeSourceRect(nw, nh, 220, 338, "fill"), { sx: 0, sy: 0, sw: nw, sh: nh });
  }
});

test("only the object-fit values the home cards use are rescalable", () => {
  assert.equal(isRescalableArtworkFit("cover"), true);
  assert.equal(isRescalableArtworkFit("fill"), true);
  for (const fit of ["contain", "none", "scale-down", "", undefined, null]) {
    assert.equal(isRescalableArtworkFit(fit), false, `${fit} must load untouched`);
  }
});

test("only JPEG bytes are accepted for re-encoding", () => {
  assert.equal(isJpegHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  // PNG can carry transparency a JPEG would paint black.
  assert.equal(isJpegHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  // GIF and animated WebP would lose every frame but the first.
  assert.equal(isJpegHeader(new Uint8Array([0x47, 0x49, 0x46, 0x38])), false);
  assert.equal(isJpegHeader(new Uint8Array([0x52, 0x49, 0x46, 0x46])), false);
  assert.equal(
    isJpegHeader(new Uint8Array([0xff, 0xd8])),
    false,
    "a truncated header is not a jpeg"
  );
  assert.equal(isJpegHeader(null), false);
});

const asciiBytes = (text) => [...text].map((char) => char.charCodeAt(0));

function webpFile(chunk, payload) {
  const riffSize = 4 + 8 + payload.length + (payload.length & 1);
  return new Uint8Array([
    ...asciiBytes("RIFF"),
    riffSize & 0xff,
    (riffSize >>> 8) & 0xff,
    (riffSize >>> 16) & 0xff,
    (riffSize >>> 24) & 0xff,
    ...asciiBytes("WEBP"),
    ...asciiBytes(chunk),
    payload.length & 0xff,
    (payload.length >>> 8) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 24) & 0xff,
    ...payload
  ]);
}

function vp8Payload(width, height) {
  // Frame tag, start code, then the two 14-bit sizes.
  return [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, width >>> 8, height & 0xff, height >>> 8];
}

function vp8lPayload(width, height, alpha) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28);
  return [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff];
}

function vp8xPayload(width, height, { alpha = false, animated = false } = {}) {
  const flags = (alpha ? 0x10 : 0) | (animated ? 0x02 : 0);
  return [
    flags,
    0,
    0,
    0,
    (width - 1) & 0xff,
    ((width - 1) >>> 8) & 0xff,
    ((width - 1) >>> 16) & 0xff,
    (height - 1) & 0xff,
    ((height - 1) >>> 8) & 0xff,
    ((height - 1) >>> 16) & 0xff
  ];
}

test("a still WebP header gives the size and alpha the rescaler needs", () => {
  assert.deepEqual(webpArtworkInfo(webpFile("VP8 ", vp8Payload(1536, 864))), {
    animated: false,
    alpha: false,
    width: 1536,
    height: 864
  });
  assert.deepEqual(webpArtworkInfo(webpFile("VP8L", vp8lPayload(411, 233, true))), {
    animated: false,
    alpha: true,
    width: 411,
    height: 233
  });
  assert.deepEqual(webpArtworkInfo(webpFile("VP8X", vp8xPayload(220, 338))), {
    animated: false,
    alpha: false,
    width: 220,
    height: 338
  });
  assert.equal(
    webpArtworkInfo(webpFile("VP8X", vp8xPayload(411, 233, { alpha: true }))).alpha,
    true
  );
});

test("an animated WebP is refused before the canvas can drop its frames", () => {
  assert.deepEqual(webpArtworkInfo(webpFile("VP8X", vp8xPayload(1536, 864, { animated: true }))), {
    animated: true
  });
});

test("a malformed or non-WebP header is left to the img tag", () => {
  assert.equal(webpArtworkInfo(null), null);
  assert.equal(webpArtworkInfo(new Uint8Array([0x52, 0x49, 0x46, 0x46])), null);
  assert.equal(
    webpArtworkInfo(
      new Uint8Array([...asciiBytes("RIFF"), 0, 0, 0, 0, ...asciiBytes("WAVE"), 0, 0, 0, 0])
    ),
    null
  );
  assert.equal(webpArtworkInfo(webpFile("XXXX", [0, 0, 0, 0])), null);
  const badStartCode = vp8Payload(100, 100);
  badStartCode[3] = 0;
  assert.equal(webpArtworkInfo(webpFile("VP8 ", badStartCode)), null);
});

test("a source above the native 8 MiB body cap is refused", () => {
  assert.equal(isArtworkTooLarge({ byteLength: 8388608 }), false);
  assert.equal(isArtworkTooLarge({ byteLength: 8388609 }), true);
  assert.equal(isArtworkTooLarge(null), false);
});

test("a 1 GB TV keeps one artwork worker", () => {
  assert.equal(artworkWorkerCount(4, 1), 1);
  assert.equal(artworkWorkerCount(8, 0.5), 1);
  assert.equal(artworkWorkerCount(4, 2), 3);
  assert.equal(artworkWorkerCount(8, undefined), 3);
  assert.equal(artworkWorkerCount(1, undefined), 1);
});

function jpegWithDimensions(width, height) {
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
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

test("a bounded source size is read from the JPEG header", () => {
  assert.deepEqual(jpegDimensions(jpegWithDimensions(1920, 1080)), {
    width: 1920,
    height: 1080
  });
  assert.deepEqual(jpegDimensions(jpegWithDimensions(500, 750)), {
    width: 500,
    height: 750
  });
  assert.equal(jpegDimensions(null), null);
  assert.equal(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff])), null);
  assert.equal(jpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

function pngWithDimensions(width, height, { apng = false } = {}) {
  const chunk = (type, data) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let index = 0; index < 4; index += 1) head[4 + index] = type.charCodeAt(index);
    return [...head, ...data, 0, 0, 0, 0];
  };
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
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
    ...(apng ? chunk("acTL", new Uint8Array(8)) : []),
    ...chunk("IDAT", new Uint8Array(4)),
    ...chunk("IEND", [])
  ]);
}

test("a bounded source size is read from the PNG header, animation refused", () => {
  assert.deepEqual(pngStillDimensions(pngWithDimensions(1664, 437)), { width: 1664, height: 437 });
  assert.equal(pngStillDimensions(pngWithDimensions(1664, 437, { apng: true })), null);
  assert.equal(pngStillDimensions(null), null);
  assert.equal(pngStillDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(pngStillDimensions(new Uint8Array(24)), null);
});

test("only an oversized JPEG asks for a clamped decode", () => {
  assert.deepEqual(artworkResizeTarget(1920, 1080), { width: 1280 });
  assert.deepEqual(artworkResizeTarget(1000, 1500), { height: 1280 });
  assert.deepEqual(artworkResizeTarget(3000, 3000), { width: 1280 });
  assert.equal(artworkResizeTarget(1280, 720), null);
  assert.equal(artworkResizeTarget(640, 480), null);
  assert.equal(artworkResizeTarget(0, 0), null);
});

test("shouldQueueRescale fast-skips obvious non-rescalable URLs and non-JPEG data URIs", () => {
  const box = { width: 220, height: 338, fit: "cover" };
  for (const url of [
    "https://cdn.example.com/posters/collection.gif",
    "https://cdn.example.com/posters/collection.gifv?autoplay=1",
    "https://cdn.example.com/posters/logo.png?size=large",
    "https://cdn.example.com/posters/mark.svg#icon",
    "https://cdn.example.com/posters/hero.avif?q=85",
    "assets/images/local.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/gif;base64,R0lGODlhAQAB",
    "data:image/webp;base64,UklGRh4AAABXRUJQ",
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
    "data:image/avif;base64,AAAA"
  ]) {
    assert.equal(shouldQueueRescale(url, box), false, `${url} should skip worker queue`);
  }

  for (const url of [
    "https://image.tmdb.org/t/p/w500/poster.jpg",
    "https://image.tmdb.org/t/p/w500/poster.JPEG?lang=en#hero",
    "https://cdn.example.com/poster.jpg?fallback=placeholder.png",
    "https://cdn.example.com/posters/collection.webp?w=600#card",
    "https://cdn.example.com/posters/collection.WEBP",
    "https://images.metahub.space/poster/medium/tt1234567/img",
    "https://cdn.example.com/artwork?id=42",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/jpg;base64,/9j/4AAQ"
  ]) {
    assert.equal(
      shouldQueueRescale(url, box),
      true,
      `${url} should remain eligible for worker JPEG check`
    );
  }
});

test("rescaleHomeArtwork and rescaleArtwork resolve null without starting workers for skipped URLs", async () => {
  const box = { width: 220, height: 338, fit: "cover" };
  const originalWorker = globalThis.Worker;
  let workerSpawns = 0;
  globalThis.Worker = class RejectingWorker {
    constructor() {
      workerSpawns += 1;
    }
  };
  try {
    for (const url of [
      "https://cdn.example.com/focused/action.gif#loop",
      "https://cdn.example.com/focused/action.png",
      "data:image/webp;base64,UklGRh4AAABXRUJQ"
    ]) {
      assert.equal(await rescaleHomeArtwork(url, box), null);
      assert.equal(await rescaleArtwork(url, box), null);
    }
    assert.equal(workerSpawns, 0, "obvious non-JPEG URLs must not instantiate workers");
  } finally {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
  }
});

// The worker source is generated from the helpers above and normally only runs
// inside a real Worker. Exercising it in a VM keeps the network early-abort
// honest without spawning one.
function createPosterWorker(response) {
  const messages = [];
  const context = vm.createContext({
    self: { postMessage: (message) => messages.push(message) },
    fetch: async () => response,
    Blob: class Blob {
      constructor(parts) {
        this.parts = parts;
      }
    },
    createImageBitmap: async () => ({ width: 100, height: 100, close() {} }),
    OffscreenCanvas: class OffscreenCanvas {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        return { type: "image/jpeg" };
      }
    },
    setTimeout,
    clearTimeout
  });
  vm.runInContext(WORKER_SOURCE, context);
  return { context, messages };
}

function streamResponse(chunks, tracker) {
  let index = 0;
  return {
    ok: true,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true };
          const value = chunks[index];
          index += 1;
          tracker.reads += 1;
          return { done: false, value };
        },
        cancel: async () => {
          tracker.cancelled = true;
        }
      })
    },
    arrayBuffer: async () => {
      throw new Error("a streamed response must not be buffered");
    }
  };
}

async function runPosterJob(response) {
  const { context, messages } = createPosterWorker(response);
  await context.self.onmessage({
    data: { id: 1, url: "https://cdn.example.com/art.webp", width: 220, height: 338, fit: "cover" }
  });
  assert.equal(messages.length, 1);
  return messages[0];
}

test("the worker cancels an animated WebP once the 30-byte header arrives", async () => {
  const bytes = new Uint8Array(40);
  // RIFF, size, WEBP, then a VP8X chunk whose animation flag is set.
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  bytes[20] = 0x02;
  const tail = new Uint8Array(4 * 1024 * 1024);
  const tracker = { reads: 0, cancelled: false };
  const message = await runPosterJob(
    streamResponse([bytes.slice(0, 16), bytes.slice(16), tail], tracker)
  );

  assert.equal(message.reason, "animated webp");
  assert.equal(tracker.reads, 2, "the multi-MB tail is never pulled");
  assert.equal(tracker.cancelled, true);
});

test("the worker cancels a non-JPEG body after the leading header", async () => {
  const tracker = { reads: 0, cancelled: false };
  const message = await runPosterJob(
    streamResponse([new Uint8Array(32), new Uint8Array(4 * 1024 * 1024)], tracker)
  );

  assert.equal(message.reason, "not jpeg");
  assert.equal(tracker.reads, 1);
  assert.equal(tracker.cancelled, true);
});

test("the worker stops a streamed body that grows past 8 MiB", async () => {
  const first = new Uint8Array(5 * 1024 * 1024);
  first.set([0xff, 0xd8, 0xff]);
  const tracker = { reads: 0, cancelled: false };
  const message = await runPosterJob(
    streamResponse([first, new Uint8Array(4 * 1024 * 1024)], tracker)
  );

  assert.equal(message.reason, "too large");
  assert.equal(tracker.cancelled, true);
});

test("the worker reads a JPEG body to the end without cancelling", async () => {
  const jpeg = new Uint8Array(100);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]);
  const tracker = { reads: 0, cancelled: false };
  const message = await runPosterJob(streamResponse([jpeg], tracker));

  assert.equal(message.reason, "already small");
  assert.equal(tracker.reads, 1);
  assert.equal(tracker.cancelled, false);
});

test("the worker keeps the arrayBuffer path when the body has no reader", async () => {
  const jpeg = new Uint8Array(100);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]);
  let buffered = false;
  const message = await runPosterJob({
    ok: true,
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => {
      buffered = true;
      return jpeg.buffer;
    }
  });

  assert.equal(message.reason, "already small");
  assert.equal(buffered, true);
});
