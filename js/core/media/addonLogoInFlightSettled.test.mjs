import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("requestAddonLogo notifies onSettled for in-flight loading entries", async () => {
  const source = (await readFile(new URL("./addonLogoCache.js", import.meta.url), "utf8"))
    .replace(/^import [\s\S]*?from "[^"]+";\r?\n/gm, "")
    .replace(/^export /gm, "");

  const images = [];
  let isTizen = true;

  class FakeImage {
    constructor() {
      this.naturalWidth = 144;
      this.naturalHeight = 72;
      images.push(this);
    }
    decode() {
      return Promise.resolve();
    }
  }

  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    URL,
    LocalStore: { get: (_k, fallback) => fallback, set() {}, remove() {} },
    normalizeImageUrl: (value) => String(value || "").trim(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Environment: { isWebOS: () => false },
    Platform: { isTizen: () => isTizen },
    isWebOsImageProxyUrl: () => false,
    getTvRuntimePerformanceProfile: () => ({ isPerformanceConstrained: true }),
    Image: FakeImage,
    fetch: () => new Promise(() => {}),
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ clearRect() {}, drawImage() {} }),
        toDataURL: () => "data:image/png;base64,OK"
      })
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.api = { warmAddonLogoPreview, requestAddonLogo, getCachedAddonLogoDisplayUrl, resetAddonLogoCache };`,
    context
  );

  // TV direct path for requestAddonLogo still stores direct URL without Image fetch.
  const directOk = await context.api.requestAddonLogo("https://cdn.example.com/tv-logo.png");
  assert.equal(directOk, true);
  assert.equal(images.length, 0);
  assert.equal(
    context.api.getCachedAddonLogoDisplayUrl("https://cdn.example.com/tv-logo.png"),
    "https://cdn.example.com/tv-logo.png"
  );

  // In-flight loading entry: second caller's onSettled callback must run when loading settles.
  isTizen = false;
  let firstSettled = 0;
  let secondSettled = 0;
  const p1 = context.api.requestAddonLogo("https://cdn.example.com/inflight.png", () => {
    firstSettled += 1;
  });
  const p2 = context.api.requestAddonLogo("https://cdn.example.com/inflight.png", () => {
    secondSettled += 1;
  });
  assert.equal(images.length, 1);
  images[0].onload();
  assert.equal(await p1, true);
  assert.equal(await p2, true);
  assert.equal(firstSettled, 1);
  assert.equal(secondSettled, 1);
  context.api.resetAddonLogoCache();
});
