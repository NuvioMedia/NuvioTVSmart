import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

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

function pngWithDimensions(width, height, { apng = false } = {}) {
  const chunk = (type, data) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) head[4 + i] = type.charCodeAt(i);
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

function webpVp8x(width, height, { animated = false } = {}) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes[16] = 10;
  bytes[20] = animated ? 0x02 : 0;
  bytes.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff], 24);
  bytes.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 27);
  return bytes;
}

async function bundleAndExtractExport(entryRelative, exportName) {
  const result = await build({
    stdin: {
      contents: `import { ${exportName} } from "./${entryRelative}"; globalThis.__EXTRACTED__ = ${exportName};`,
      resolveDir: repoRoot,
      loader: "js"
    },
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    write: false,
    define: {
      __NUVIO_APP_VERSION__: '"1.5.0"'
    }
  });
  const code = result.outputFiles[0].text;
  const storage = new Map();
  const sandbox = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Blob,
    Uint8Array,
    DataView,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    navigator: { userAgent: "", hardwareConcurrency: 4, deviceMemory: 2 },
    location: { href: "http://localhost/", origin: "http://localhost", search: "" },
    document: {
      documentElement: { classList: { contains: () => false } },
      body: { classList: { contains: () => false } },
      createElement: () => ({}),
      querySelectorAll: () => []
    },
    window: {}
  });
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInContext(code, sandbox);
  assert.equal(typeof sandbox.__EXTRACTED__, "string", `${exportName} must bundle to a string`);
  return sandbox.__EXTRACTED__;
}

function makeBlobResponse(bytes) {
  const sliceBuf = (start = 0, end = bytes.byteLength) =>
    bytes.buffer.slice(
      bytes.byteOffset + start,
      bytes.byteOffset + Math.min(end, bytes.byteLength)
    );
  const fakeBlob = {
    size: bytes.byteLength,
    slice: (start, end) => ({ arrayBuffer: async () => sliceBuf(start, end) }),
    arrayBuffer: async () => sliceBuf()
  };
  return {
    ok: true,
    headers: { get: () => String(bytes.byteLength) },
    body: null,
    blob: async () => fakeBlob,
    arrayBuffer: async () => sliceBuf()
  };
}

test("minified HERO_BACKDROP_WORKER_SOURCE executes JPEG/PNG/WebP backdrop and logo jobs with zero ReferenceError", async () => {
  const workerSource = await bundleAndExtractExport(
    "js/ui/screens/home/homeScreenHelpers-02-extract-release-date-text.js",
    "HERO_BACKDROP_WORKER_SOURCE"
  );

  const files = new Map([
    ["https://cdn.example/backdrop-large.jpg", jpegWithDimensions(1920, 1080)],
    ["https://cdn.example/backdrop-small.webp", webpVp8x(1280, 720)],
    ["https://cdn.example/logo-large.png", pngWithDimensions(1600, 400)],
    ["https://cdn.example/logo-small.png", pngWithDimensions(400, 100)],
    ["https://cdn.example/logo-anim.webp", webpVp8x(1200, 300, { animated: true })]
  ]);

  const messages = [];
  const bitmapOptions = [];
  const workerContext = vm.createContext({
    Blob,
    Uint8Array,
    setTimeout,
    clearTimeout,
    self: { postMessage: (msg) => messages.push(msg) },
    fetch: async (url) => makeBlobResponse(files.get(url)),
    createImageBitmap: async (_blob, options) => {
      bitmapOptions.push(options || null);
      return { width: options?.resizeWidth || 1280, height: 720, close() {} };
    },
    OffscreenCanvas: class OffscreenCanvas {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        return { type: "image/webp", size: 12 };
      }
    }
  });
  vm.runInContext(workerSource, workerContext);

  await workerContext.self.onmessage({
    data: { id: 1, url: "https://cdn.example/backdrop-large.jpg", resizeWidth: 1280 }
  });
  await workerContext.self.onmessage({
    data: { id: 2, url: "https://cdn.example/backdrop-small.webp", resizeWidth: 1920 }
  });
  await workerContext.self.onmessage({
    data: {
      id: 3,
      kind: "logo",
      url: "https://cdn.example/logo-large.png",
      targetWidth: 440,
      targetHeight: 200,
      maxSmallWidth: 1000,
      maxSmallHeight: 500
    }
  });
  await workerContext.self.onmessage({
    data: {
      id: 4,
      kind: "logo",
      url: "https://cdn.example/logo-small.png",
      targetWidth: 440,
      targetHeight: 200,
      maxSmallWidth: 1000,
      maxSmallHeight: 500
    }
  });
  await workerContext.self.onmessage({
    data: {
      id: 5,
      kind: "logo",
      url: "https://cdn.example/logo-anim.webp",
      targetWidth: 440,
      targetHeight: 200,
      maxSmallWidth: 1000,
      maxSmallHeight: 500
    }
  });

  assert.equal(messages.length, 5);
  assert.equal(messages[0].ok, true, "large JPEG backdrop decoded in minified worker");
  assert.equal(bitmapOptions[0]?.resizeWidth, 1280, "oversized backdrop requests bounded decode");
  assert.equal(messages[1].ok, true, "small WebP backdrop decoded in minified worker");
  assert.equal(bitmapOptions[1], null, "already-small backdrop skips resizeWidth");
  assert.equal(messages[2].ok, true, "large PNG logo rescaled in minified worker");
  assert.ok(messages[2].blob, "rescaled logo returns WebP blob");
  assert.equal(messages[3].ok, true);
  assert.equal(messages[3].skippedSmall, true, "small PNG logo skipped before decode");
  assert.equal(messages[4].ok, true);
  assert.equal(messages[4].skippedSmall, true, "animated WebP logo skipped safely");
});
