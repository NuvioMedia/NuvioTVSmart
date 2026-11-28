import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const helpers02Source = await readFile(
  new URL("./homeScreenHelpers-02-extract-release-date-text.js", import.meta.url),
  "utf8"
);
const backdropSwapSource = await readFile(
  new URL("./homeScreenHelpers-03-animate-hero-backdrop-swap.js", import.meta.url),
  "utf8"
);
const logoSwapSource = await readFile(
  new URL("./homeScreenHelpers-04-animate-hero-logo-swap.js", import.meta.url),
  "utf8"
);

const strip = (src) => src.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

function createDomMocks() {
  let offsetWidthReads = 0;
  const rafQueue = [];
  const nextRaf = (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  const flushRafs = async () => {
    const batch = rafQueue.splice(0);
    batch.forEach((cb) => cb?.());
    await new Promise((r) => setTimeout(r, 0));
  };

  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.attributes = {};
      const tokens = new Set();
      this.classList = {
        add: (...names) => names.forEach((n) => tokens.add(n)),
        remove: (...names) => names.forEach((n) => tokens.delete(n)),
        contains: (n) => tokens.has(n),
        has: (n) => tokens.has(n)
      };
      const props = {};
      const prios = {};
      this.style = {
        getPropertyValue: (name) => props[name] || "",
        getPropertyPriority: (name) => prios[name] || "",
        setProperty: (name, value, prio = "") => {
          props[name] = String(value);
          prios[name] = String(prio || "");
        },
        removeProperty: (name) => {
          delete props[name];
          delete prios[name];
        },
        props,
        prios
      };
      this.children = [];
      this.parentElement = null;
      Object.defineProperty(this, "offsetWidth", {
        get() {
          offsetWidthReads += 1;
          return 1920;
        }
      });
    }
    set className(value) {
      const next = new Set(
        String(value || "")
          .split(/\s+/)
          .filter(Boolean)
      );
      const existing = [
        "home-hero-backdrop",
        "home-hero-backdrop-canvas",
        "home-hero-backdrop-transition-enter",
        "is-visible",
        "home-hero-backdrop-transition-ghost"
      ];
      existing.forEach((n) => this.classList.remove(n));
      next.forEach((n) => this.classList.add(n));
    }
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    cloneNode() {
      const clone = new this.constructor(this.tagName);
      Object.assign(clone.attributes, this.attributes);
      return clone;
    }
    getContext() {
      return { drawImage: () => {} };
    }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    }
    insertBefore(child, ref) {
      child.parentElement = this;
      this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, child);
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
        this.parentElement = null;
      }
    }
    querySelectorAll(selector) {
      const ghostsOnly =
        selector === ".home-hero-backdrop-transition-ghost" ||
        selector === ".home-hero-logo-transition-ghost";
      return this.children.filter((node) =>
        ghostsOnly
          ? node.classList.has(selector.slice(1))
          : node.classList.has("home-hero-backdrop-canvas") &&
            !node.classList.has("home-hero-backdrop-transition-ghost")
      );
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }
  class FakeImage extends FakeElement {}

  const prepareStart = helpers02Source.indexOf("export function prepareHeroImageEnter");
  const helperCode = strip(helpers02Source.slice(prepareStart));

  const preloadResults = new Map();
  const context = vm.createContext({
    HTMLImageElement: FakeImage,
    HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS: 20,
    document: { createElement: (tag) => new FakeElement(tag) },
    requestAnimationFrame: nextRaf,
    setTimeout,
    clearTimeout,
    preloadHeroBackdrop: async (src) => preloadResults.get(src) || { loaded: true, bitmap: null },
    preloadHeroLogo: async (src) => preloadResults.get(src) || { loaded: true, src },
    shouldRescaleHeroLogo: () => false
  });
  context.globalThis = context;
  vm.runInContext(
    [
      helperCode,
      strip(
        backdropSwapSource.slice(
          backdropSwapSource.indexOf("export function animateHeroBackdropSwap")
        )
      ),
      strip(logoSwapSource.slice(logoSwapSource.indexOf("export function animateHeroLogoSwap")))
    ].join("\n"),
    context
  );

  return {
    FakeElement,
    FakeImage,
    context,
    preloadResults,
    flushRafs,
    getOffsetWidthReads: () => offsetWidthReads
  };
}

test("hero backdrop (<canvas> and <img>) and logo transitions never force synchronous offsetWidth reflow and restore inline transitions cleanly", async () => {
  const { FakeElement, FakeImage, context, preloadResults, flushRafs, getOffsetWidthReads } =
    createDomMocks();

  // 1. Fresh <canvas> backdrop swap
  const wrap = new FakeElement("div");
  const backdrop = new FakeImage("img");
  backdrop.classList.add("home-hero-backdrop");
  backdrop.setAttribute("src", "https://img/old.jpg");
  wrap.appendChild(backdrop);

  preloadResults.set("https://img/canvas.jpg", {
    loaded: true,
    bitmap: { width: 1280, height: 720 }
  });
  context.animateHeroBackdropSwap(backdrop, "https://img/canvas.jpg", "", 20, {
    transitionMode: "single-layer"
  });
  await new Promise((r) => setTimeout(r, 0));
  const canvas = wrap.children.at(-1);
  assert.equal(canvas.tagName, "CANVAS");
  assert.ok(canvas.classList.contains("home-hero-backdrop-transition-enter"));
  assert.equal(
    canvas.classList.contains("is-visible"),
    false,
    "canvas must remain invisible on frame 1"
  );
  await flushRafs();
  assert.equal(
    canvas.classList.contains("is-visible"),
    false,
    "single-layer canvas waits two rAF ticks for enter paint commit"
  );
  await flushRafs();
  assert.equal(canvas.classList.contains("is-visible"), true);

  // 2. Reused <img> backdrop fallback swap preserves caller transition
  backdrop.style.setProperty("transition", "opacity 120ms ease", "");
  preloadResults.set("https://img/fallback.jpg", { loaded: true, bitmap: null });
  context.animateHeroBackdropSwap(backdrop, "https://img/fallback.jpg", "", 20, {
    transitionMode: "crossfade"
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    backdrop.style.getPropertyValue("transition"),
    "none",
    "transition suppressed during enter reset"
  );
  assert.equal(backdrop.classList.contains("is-visible"), false);
  await flushRafs();
  assert.equal(backdrop.classList.contains("is-visible"), false);
  await flushRafs();
  assert.equal(backdrop.classList.contains("is-visible"), true);
  assert.equal(backdrop.style.getPropertyValue("transition"), "opacity 120ms ease");

  // 3. Reused logo swap with mid-flight rapid replacement does not overwrite original inline transition with "none"
  const logoWrap = new FakeElement("div");
  const logo = new FakeImage("img");
  logo.style.setProperty("transition", "opacity 150ms linear", "");
  logoWrap.appendChild(logo);

  context.animateHeroLogoSwap(logo, "https://img/logo1.png", "L1", 20, {
    transitionMode: "single-layer"
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(logo.style.getPropertyValue("transition"), "none");
  // Cancel mid-flight by immediately swapping to logo2 while logo is still suppressed
  context.animateHeroLogoSwap(logo, "https://img/logo2.png", "L2", 20, {
    transitionMode: "single-layer"
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(logo.style.getPropertyValue("transition"), "none");
  await flushRafs();
  await flushRafs();
  assert.equal(logo.classList.contains("is-visible"), true);
  assert.equal(
    logo.style.getPropertyValue("transition"),
    "opacity 150ms linear",
    "rapid mid-flight replacement must restore original inline transition rather than 'none'"
  );

  assert.equal(
    getOffsetWidthReads(),
    0,
    "hero transitions must perform 0 synchronous offsetWidth reads"
  );

  // 4. single-layer canvas swap reuses previousCanvas in place without creating/removing a new <canvas>
  let canvasCreates = 0;
  const origCreate = context.document.createElement;
  context.document.createElement = (tag) => {
    if (String(tag).toUpperCase() === "CANVAS") canvasCreates += 1;
    return origCreate(tag);
  };
  const singleWrap = new FakeElement("div");
  const singleBackdrop = new FakeImage("img");
  singleBackdrop.classList.add("home-hero-backdrop");
  singleWrap.appendChild(singleBackdrop);
  preloadResults.set("https://img/s1.jpg", {
    loaded: true,
    bitmap: { width: 1280, height: 720 }
  });
  preloadResults.set("https://img/s2.jpg", {
    loaded: true,
    bitmap: { width: 1920, height: 1080 }
  });
  context.animateHeroBackdropSwap(singleBackdrop, "https://img/s1.jpg", "", 20, {
    transitionMode: "single-layer"
  });
  await new Promise((r) => setTimeout(r, 0));
  await flushRafs();
  await flushRafs();
  assert.equal(canvasCreates, 1);
  const reusedCanvas = singleWrap.children.at(-1);

  context.animateHeroBackdropSwap(singleBackdrop, "https://img/s2.jpg", "", 20, {
    transitionMode: "single-layer"
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(canvasCreates, 1, "single-layer canvas swap must reuse existing canvas in place");
  assert.equal(singleWrap.children.at(-1), reusedCanvas);
  assert.equal(reusedCanvas.width, 1920);
  assert.equal(reusedCanvas.height, 1080);
  assert.equal(
    reusedCanvas.style.getPropertyValue("transition"),
    "none",
    "reused canvas must reset with its transition suppressed, so the new artwork does not fade the old one out first"
  );
  await flushRafs();
  await flushRafs();
  assert.equal(reusedCanvas.classList.contains("is-visible"), true);
  assert.equal(
    reusedCanvas.style.getPropertyValue("transition"),
    "",
    "reveal must restore the canvas transition"
  );
});

test("preloadHeroBackdrop bypasses CPU resizeWidth for <=1920px headers, uses transferable Worker when available, and falls back in-thread", async () => {
  const prevNavigatorUa = Object.getOwnPropertyDescriptor(globalThis.navigator, "userAgent");
  const prevNavigatorMem = Object.getOwnPropertyDescriptor(globalThis.navigator, "deviceMemory");
  const prevTizen = globalThis.tizen;
  const prevLocalStorage = globalThis.localStorage;
  const prevFetch = globalThis.fetch;
  const prevCreateImageBitmap = globalThis.createImageBitmap;
  const prevWorker = globalThis.Worker;
  const prevBlob = globalThis.Blob;
  const prevCreateObjectUrl = globalThis.URL.createObjectURL;
  const prevRevokeObjectUrl = globalThis.URL.revokeObjectURL;
  const prevInnerWidth = globalThis.innerWidth;
  const prevDpr = globalThis.devicePixelRatio;
  const prevImage = globalThis.Image;

  const makeJpegBytes = (width, height) => {
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
  };

  const makeByteBlob = (bytes) => ({
    size: bytes.byteLength,
    slice(start, end) {
      const sliced = bytes.slice(start, end);
      return {
        async arrayBuffer() {
          return sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength);
        }
      };
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  });

  try {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", { value: 2, configurable: true });
    globalThis.tizen = {};
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.innerWidth = 1920;
    globalThis.devicePixelRatio = 1;

    const createImageBitmapCalls = [];
    const jpeg1280 = makeJpegBytes(1280, 720);
    const jpeg3840 = makeJpegBytes(3840, 2160);

    globalThis.fetch = async (url) => ({
      ok: true,
      async blob() {
        return makeByteBlob(url.includes("4k") ? jpeg3840 : jpeg1280);
      }
    });
    globalThis.createImageBitmap = async (_blob, opts) => {
      createImageBitmapCalls.push(opts ?? null);
      return { width: opts?.resizeWidth || 1280, height: 720, close() {} };
    };

    // 1. In-thread path (no Worker): 1280x720 skips resizeWidth; 3840x2160 passes low-quality resizeWidth.
    delete globalThis.Worker;
    const modNoWorker = await import(
      `./homeScreenHelpers-02-extract-release-date-text.js?noworker=${Date.now()}`
    );
    const res1280 = await modNoWorker.preloadHeroBackdrop("https://art/w1280.jpg");
    assert.equal(res1280.loaded, true);
    assert.equal(res1280.bitmap.width, 1280);
    assert.equal(
      createImageBitmapCalls[0],
      null,
      "<=1920px header must call createImageBitmap(blob) with no resize options"
    );

    const res4k = await modNoWorker.preloadHeroBackdrop("https://art/4k.jpg");
    assert.equal(res4k.loaded, true);
    assert.deepEqual(
      createImageBitmapCalls[1],
      { resizeWidth: 1920, resizeQuality: "low" },
      ">1920px header must downscale with resizeWidth and low quality"
    );

    // 2. Worker transferable path + Worker-throw fallback path.
    const workerScripts = [];
    let failWorkerCtor = false;
    const fakeWorkerPosts = [];
    class FakeBackdropWorker {
      constructor(url) {
        if (failWorkerCtor) throw new Error("worker blocked");
        this.url = url;
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(msg) {
        fakeWorkerPosts.push(msg);
        const w = msg.url.includes("4k") ? 1920 : 1280;
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: msg.id, ok: true, bitmap: { width: w, height: 720, close() {} } }
          });
        });
      }
      terminate() {}
    }
    globalThis.Worker = FakeBackdropWorker;
    globalThis.Blob = class FakeBlob {
      constructor(parts) {
        this.parts = parts;
      }
    };
    globalThis.URL.createObjectURL = (blob) => {
      workerScripts.push(String(blob?.parts?.[0] || ""));
      return "blob:hero-worker/1";
    };
    globalThis.URL.revokeObjectURL = () => {};

    const modWorker = await import(
      `./homeScreenHelpers-02-extract-release-date-text.js?worker=${Date.now()}`
    );
    const workerRes = await modWorker.preloadHeroBackdrop("https://art/worker-1280.jpg");
    assert.equal(workerRes.loaded, true);
    assert.equal(workerRes.bitmap.width, 1280);
    assert.equal(fakeWorkerPosts.length, 1);
    assert.equal(fakeWorkerPosts[0].resizeWidth, 1920);
    assert.ok(
      workerScripts[0].includes("self.postMessage({ id, ok: true, bitmap }, [bitmap])"),
      "worker source must transfer ImageBitmap zero-copy"
    );
    assert.ok(
      workerScripts[0].includes('resizeQuality: "low"'),
      "worker source must use resizeQuality low when downscaling"
    );

    // Worker constructor failure falls back cleanly to in-thread decode.
    failWorkerCtor = true;
    const modFallback = await import(
      `./homeScreenHelpers-02-extract-release-date-text.js?fallback=${Date.now()}`
    );
    const fallbackRes = await modFallback.preloadHeroBackdrop("https://art/fallback-1280.jpg");
    assert.equal(fallbackRes.loaded, true);
    assert.equal(fallbackRes.bitmap.width, 1280);
    assert.equal(createImageBitmapCalls.length, 3);

    // 3. preloadHeroLogo skips <= 660px (1.5x HERO_LOGO_RESCALE_WIDTH_PX) logos with 0 createObjectURL calls.
    const makePngBytes = (width, height) => {
      const ihdr = new Uint8Array(33);
      ihdr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      ihdr.set([0, 0, 0, 13], 8);
      ihdr.set([0x49, 0x48, 0x44, 0x52], 12);
      ihdr.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
      ihdr.set(
        [(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255],
        20
      );
      return ihdr;
    };
    globalThis.OffscreenCanvas = class {
      getContext() {
        return { drawImage: () => {} };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
      }
    };
    globalThis.Image = class FakeLogoImg {
      set src(v) {
        this._src = v;
        this.naturalWidth = 500;
        queueMicrotask(() => this.onload?.());
      }
      decode() {
        return Promise.resolve();
      }
    };
    let logoBlobUrlCount = 0;
    globalThis.URL.createObjectURL = (blob) => {
      const part = String(blob?.parts?.[0] || "");
      if (part.includes("self.onmessage")) return "blob:hero-worker/logo";
      logoBlobUrlCount += 1;
      return `blob:logo/${logoBlobUrlCount}`;
    };

    // In-thread <=1000x500 logo (including 800x310 HD Clearlogo) skips OffscreenCanvas & createObjectURL.
    const png800 = makePngBytes(800, 310);
    const png1200 = makePngBytes(1200, 320);
    const pngTall = makePngBytes(900, 600);
    globalThis.fetch = async (url) => ({
      ok: true,
      async blob() {
        if (url.includes("big")) return makeByteBlob(png1200);
        if (url.includes("tall")) return makeByteBlob(pngTall);
        return makeByteBlob(png800);
      }
    });
    const smallLogoInThread = await modFallback.preloadHeroLogo("https://art/logo-800x310.png");
    assert.deepEqual(smallLogoInThread, { loaded: true, src: "https://art/logo-800x310.png" });
    assert.equal(logoBlobUrlCount, 0, "<=1000x500 logo must not allocate a blob URL");

    const bigLogoInThread = await modFallback.preloadHeroLogo("https://art/logo-big.png");
    assert.deepEqual(bigLogoInThread, { loaded: true, src: "blob:logo/1" });
    assert.equal(logoBlobUrlCount, 1, ">1000px wide logo still rescales to bounded WebP blob");

    const tallLogoInThread = await modFallback.preloadHeroLogo("https://art/logo-tall.png");
    assert.deepEqual(tallLogoInThread, { loaded: true, src: "blob:logo/2" });
    assert.equal(logoBlobUrlCount, 2, ">500px tall logo still rescales to bounded WebP blob");

    // Worker path: skippedSmall short-circuits before URL.createObjectURL; oversized logo encodes blob.
    failWorkerCtor = false;
    const workerPosts = [];
    let logoWorkerTerminations = 0;
    class FakeLogoWorker {
      constructor() {
        this.onmessage = null;
      }
      postMessage(msg) {
        workerPosts.push(msg);
        queueMicrotask(() => {
          if (msg.url.includes("800x310")) {
            this.onmessage?.({
              data: { id: msg.id, ok: true, skippedSmall: true, width: 800, height: 310 }
            });
          } else {
            this.onmessage?.({ data: { id: msg.id, ok: true, blob: new Blob(["webp"]) } });
          }
        });
      }
      terminate() {
        logoWorkerTerminations += 1;
      }
    }
    globalThis.Worker = FakeLogoWorker;
    const modWorkerLogo = await import(
      `./homeScreenHelpers-02-extract-release-date-text.js?workerlogo=${Date.now()}`
    );
    const smallWorkerLogo = await modWorkerLogo.preloadHeroLogo(
      "https://art/logo-worker-800x310.png"
    );
    assert.deepEqual(smallWorkerLogo, { loaded: true, src: "https://art/logo-worker-800x310.png" });
    assert.equal(workerPosts[0].maxSmallWidth, 1000);
    assert.equal(workerPosts[0].maxSmallHeight, 500);
    assert.equal(logoBlobUrlCount, 2, "worker skippedSmall must not call URL.createObjectURL");
    assert.ok(
      workerScripts[0].includes("skippedSmall: true"),
      "worker source must handle small-logo bypass before OffscreenCanvas/convertToBlob"
    );
    const bigWorkerLogo = await modWorkerLogo.preloadHeroLogo("https://art/logo-worker-big.png");
    assert.deepEqual(bigWorkerLogo, { loaded: true, src: "blob:logo/3" });
    assert.equal(logoBlobUrlCount, 3);

    // 4. Leaving Home terminates the dedicated worker and drops its bitmap cache.
    modWorkerLogo.resetHeroArtworkWorker();
    assert.equal(logoWorkerTerminations, 1, "reset must terminate the hero worker");
    assert.equal(modWorkerLogo.heroBackdropBitmapCache.size, 0);
  } finally {
    if (prevNavigatorUa) Object.defineProperty(globalThis.navigator, "userAgent", prevNavigatorUa);
    if (prevNavigatorMem)
      Object.defineProperty(globalThis.navigator, "deviceMemory", prevNavigatorMem);
    if (prevTizen === undefined) delete globalThis.tizen;
    else globalThis.tizen = prevTizen;
    if (prevLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLocalStorage;
    globalThis.fetch = prevFetch;
    globalThis.createImageBitmap = prevCreateImageBitmap;
    if (prevWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = prevWorker;
    globalThis.Blob = prevBlob;
    globalThis.URL.createObjectURL = prevCreateObjectUrl;
    globalThis.URL.revokeObjectURL = prevRevokeObjectUrl;
    globalThis.innerWidth = prevInnerWidth;
    globalThis.devicePixelRatio = prevDpr;
    if (prevImage === undefined) delete globalThis.Image;
    else globalThis.Image = prevImage;
  }
});
