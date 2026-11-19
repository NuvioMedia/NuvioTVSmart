import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const rawSource = await readFile(new URL("./addonLogoCache.js", import.meta.url), "utf8");
const source = rawSource.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

function setup({
  fetchImpl,
  createImageBitmapImpl,
  isWebOsProxy = false,
  isWebOS = false,
  isTizen = true
} = {}) {
  const drawn = [];
  const imageRequests = [];
  let closedBitmaps = 0;

  class FakeImage {
    set src(value) {
      imageRequests.push({ src: value, crossOrigin: this.crossOrigin });
      this.naturalWidth = 288;
      this.naturalHeight = 144;
      queueMicrotask(() => {
        if (this.crossOrigin === "anonymous" && value.includes("no-cors")) {
          this.onerror?.();
          return;
        }
        this.onload?.();
      });
    }
    decode() {
      return Promise.resolve();
    }
  }

  const context = vm.createContext({
    LocalStore: { get: (_k, fallback) => fallback, set: () => {}, remove: () => {} },
    Environment: { isWebOS: () => isWebOS },
    Platform: { isTizen: () => isTizen },
    getTvRuntimePerformanceProfile: () => ({ isPerformanceConstrained: false }),
    isWebOsImageProxyUrl: (url) => isWebOsProxy && url.includes("/image-proxy"),
    normalizeImageUrl: (value) => String(value || "").trim(),
    document: {
      createElement: (tag) => {
        assert.equal(tag, "canvas");
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect: () => {},
            drawImage: (sourceNode, _x, _y, width, height) => {
              drawn.push({
                sourceNode,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                drawWidth: width,
                drawHeight: height
              });
            }
          }),
          toDataURL: (type) => `data:${type};base64,SCALED_${canvas.width}x${canvas.height}`
        };
        return canvas;
      }
    },
    Image: FakeImage,
    fetch: fetchImpl,
    createImageBitmap: createImageBitmapImpl,
    setTimeout,
    clearTimeout
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.api = { warmAddonLogoPreview, requestAddonLogo, getCachedAddonLogoDisplayUrl, resetAddonLogoCache };`,
    context
  );

  return {
    api: context.api,
    drawn,
    imageRequests,
    incrementClosed: () => {
      closedBitmaps += 1;
    },
    getClosedBitmaps: () => closedBitmaps
  };
}

test("warmAddonLogoPreview fetches, decodes via createImageBitmap, downscales to <=144px, and closes bitmap", async () => {
  const fetchCalls = [];
  let harness;
  const fullBitmap = {
    width: 512,
    height: 256,
    close: () => harness.incrementClosed()
  };
  harness = setup({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, blob: async () => ({ size: 1234 }) };
    },
    createImageBitmapImpl: async () => fullBitmap
  });

  const ok = await harness.api.warmAddonLogoPreview("https://cdn.example.com/badge.png");
  assert.equal(ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.mode, "cors");
  assert.equal(
    harness.imageRequests.length,
    0,
    "Image() should not run when bitmap fetch succeeds"
  );
  assert.equal(harness.drawn.length, 1);
  assert.equal(harness.drawn[0].canvasWidth, 144);
  assert.equal(harness.drawn[0].canvasHeight, 72);
  assert.equal(harness.getClosedBitmaps(), 1, "fullBitmap.close() must run in finally");
  assert.equal(
    harness.api.getCachedAddonLogoDisplayUrl("https://cdn.example.com/badge.png"),
    "data:image/png;base64,SCALED_144x72"
  );
});

test("warmAddonLogoPreview falls back cleanly to Image path when fetch fails or CORS rejects", async () => {
  const harness = setup({
    fetchImpl: async () => {
      throw new Error("CORS blocked");
    },
    createImageBitmapImpl: async () => {
      assert.fail("createImageBitmap must not be called for failed fetch");
    }
  });

  const ok = await harness.api.warmAddonLogoPreview("https://cdn.example.com/no-cors-badge.png");
  assert.equal(ok, true);
  assert.equal(
    harness.imageRequests.length,
    2,
    "crossOrigin anonymous fallback retries direct Image()"
  );
  assert.equal(
    harness.api.getCachedAddonLogoDisplayUrl("https://cdn.example.com/no-cors-badge.png"),
    "https://cdn.example.com/no-cors-badge.png"
  );
});

test("skips fetchScaledBadgeDataUrl when createImageBitmap is unavailable or URL uses webOS image proxy", async () => {
  let fetchCalls = 0;
  const noBitmap = setup({
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
    createImageBitmapImpl: undefined
  });
  await noBitmap.api.warmAddonLogoPreview("https://cdn.example.com/legacy.png");
  assert.equal(fetchCalls, 0);
  assert.equal(noBitmap.drawn.length, 1);
  assert.equal(noBitmap.drawn[0].canvasWidth, 144);
  assert.equal(noBitmap.drawn[0].canvasHeight, 72);

  const webosProxy = setup({
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
    createImageBitmapImpl: async () => ({ width: 200, height: 100 }),
    isWebOsProxy: true,
    isWebOS: true,
    isTizen: false
  });
  await webosProxy.api.warmAddonLogoPreview("http://127.0.0.1:2710/image-proxy?url=test");
  assert.equal(fetchCalls, 0);
  assert.equal(webosProxy.imageRequests.length, 1);
});

test("warmAddonLogoPreview keeps the Image canvas path when createImageBitmap rejects", async () => {
  const harness = setup({
    fetchImpl: async () => ({ ok: true, status: 200, blob: async () => ({ size: 1234 }) }),
    createImageBitmapImpl: async () => {
      throw new Error("bitmap unsupported");
    }
  });

  const ok = await harness.api.warmAddonLogoPreview("https://cdn.example.com/undecodable.png");
  assert.equal(ok, true);
  assert.equal(harness.imageRequests.length, 1);
  assert.equal(harness.getClosedBitmaps(), 0);
  assert.equal(harness.drawn.length, 1);
  assert.equal(harness.drawn[0].canvasWidth, 144);
  assert.equal(harness.drawn[0].canvasHeight, 72);
  assert.equal(
    harness.api.getCachedAddonLogoDisplayUrl("https://cdn.example.com/undecodable.png"),
    "data:image/png;base64,SCALED_144x72"
  );
});
