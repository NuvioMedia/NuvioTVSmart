import assert from "node:assert/strict";
import test from "node:test";

// Hero logos are the one Home artwork Android bounds to a fixed Coil request
// (220x100dp) while the web <img> decodes at natural size. These checks drive
// the real header reader and downscaler on the Tizen path.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
Object.defineProperties(globalThis.navigator, {
  userAgent: {
    value:
      "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.93 Safari/537.36",
    configurable: true
  },
  hardwareConcurrency: { value: 4, configurable: true }
});
globalThis.tizen = {};
globalThis.location = { search: "" };
globalThis.document = { querySelectorAll: () => [] };
globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob([]) });
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.OffscreenCanvas = class {
  getContext() {
    return { drawImage: () => {} };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
  }
};

let createdUrls = 0;
let revokedUrls = [];
globalThis.URL.createObjectURL = () => {
  createdUrls += 1;
  return `blob:test/${createdUrls}`;
};
globalThis.URL.revokeObjectURL = (url) => revokedUrls.push(url);

let imageLoads = true;
class FakeImage {
  constructor() {
    this.naturalWidth = 1;
    this.complete = false;
    this.decoding = "async";
  }
  set src(value) {
    this.currentSrc = value;
    queueMicrotask(() => {
      if (imageLoads && this.onload) this.onload();
      else if (!imageLoads && this.onerror) this.onerror();
    });
  }
  get src() {
    return this.currentSrc;
  }
  decode() {
    return Promise.resolve();
  }
}
globalThis.Image = FakeImage;

const mod = await import("./homeScreenHelpers-02-extract-release-date-text.js");

globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

class FakeLogo {
  constructor() {
    this.attributes = {};
    const tokens = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => tokens.add(name)),
      remove: (...names) => names.forEach((name) => tokens.delete(name)),
      contains: (name) => tokens.has(name),
      has: (name) => tokens.has(name)
    };
    const style = {};
    this.style = {
      getPropertyValue: (name) => style[name] || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => {
        style[name] = value;
      },
      removeProperty: (name) => {
        delete style[name];
      }
    };
    this.children = [];
    this.parentElement = null;
    this.offsetWidth = 0;
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
    const clone = new FakeLogo();
    clone.attributes = { ...this.attributes };
    return clone;
  }
  insertBefore(child) {
    child.parentElement = this;
    this.children.push(child);
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
  querySelectorAll() {
    return this.children.filter((child) => child.classList.has("home-hero-logo-transition-ghost"));
  }
}
globalThis.HTMLImageElement = FakeLogo;
const { animateHeroLogoSwap } = await import("./homeScreenHelpers-04-animate-hero-logo-swap.js");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function png(width, height, { apng = false } = {}) {
  const chunks = [];
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  header.set([0, 0, 0, 13], 8);
  header.set([0x49, 0x48, 0x44, 0x52], 12);
  header.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  header.set(
    [(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255],
    20
  );
  chunks.push(header);
  if (apng) {
    const actl = new Uint8Array(12);
    actl.set([0x61, 0x63, 0x54, 0x4c], 4);
    chunks.push(actl);
  }
  const idat = new Uint8Array(12);
  idat.set([0x49, 0x44, 0x41, 0x54], 4);
  chunks.push(idat);
  return new Uint8Array(chunks.flatMap((chunk) => Array.from(chunk)));
}

function webpVp8x(width, height, { animated = false } = {}) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes[16] = 10;
  bytes[20] = animated ? 0x02 : 0;
  bytes.set([(width - 1) & 255, ((width - 1) >> 8) & 255, ((width - 1) >> 16) & 255], 24);
  bytes.set([(height - 1) & 255, ((height - 1) >> 8) & 255, ((height - 1) >> 16) & 255], 27);
  return bytes;
}

function webpVp8l(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12);
  bytes[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  bytes.set([bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255], 21);
  return bytes;
}

function webpVp8(width, height) {
  const bytes = new Uint8Array(34);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x20], 12);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  bytes.set([width & 255, (width >> 8) & 255], 26);
  bytes.set([height & 255, (height >> 8) & 255], 28);
  return bytes;
}

function blobOf(bytes) {
  return new Blob([bytes], { type: "image/png" });
}

function reset() {
  mod.resetHeroLogoRescaleCache();
  revokedUrls = [];
  createdUrls = 0;
}

test("reads natural dimensions without decoding, and rejects animated formats", () => {
  assert.deepEqual(mod.heroLogoDimensions(png(1664, 437)), { width: 1664, height: 437 });
  assert.equal(mod.heroLogoDimensions(png(1664, 437, { apng: true })), null);
  assert.deepEqual(mod.heroLogoDimensions(webpVp8x(1976, 261)), { width: 1976, height: 261 });
  assert.equal(mod.heroLogoDimensions(webpVp8x(1976, 261, { animated: true })), null);
  assert.deepEqual(mod.heroLogoDimensions(webpVp8l(800, 200)), { width: 800, height: 200 });
  assert.deepEqual(mod.heroLogoDimensions(webpVp8(640, 160)), { width: 640, height: 160 });
  assert.equal(mod.heroLogoDimensions(new Uint8Array([1, 2, 3])), null);
});

test("eligible only on non-constrained Tizen", () => {
  assert.equal(mod.shouldRescaleHeroLogo("https://cdn.example/logo.png"), true);
  assert.equal(mod.shouldRescaleHeroLogo("https://cdn.example/logo.svg"), false);
  assert.equal(mod.shouldRescaleHeroLogo("https://cdn.example/logo.gif"), false);
  assert.equal(mod.shouldRescaleHeroLogo("data:image/png;base64,AAAA"), false);
});

test("large logos become a bounded WebP blob and are cached", async () => {
  reset();
  let fetches = 0;
  let bitmapOptions = null;
  let canvasSize = null;
  let closed = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return { ok: true, blob: async () => blobOf(png(1664, 437)) };
  };
  globalThis.createImageBitmap = async (blob, options) => {
    bitmapOptions = options;
    return {
      width: 440,
      height: 116,
      close: () => {
        closed += 1;
      }
    };
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      canvasSize = { width, height };
    }
    getContext() {
      return { drawImage: () => {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
    }
  };

  const first = await mod.preloadHeroLogo("https://cdn.example/big.png");
  assert.deepEqual(first, { loaded: true, src: "blob:test/1" });
  assert.equal(fetches, 1);
  assert.equal(bitmapOptions.resizeWidth, 440, "Android's 220dp at TV density");
  assert.deepEqual(canvasSize, { width: 440, height: 116 });
  assert.equal(closed, 1, "the bitmap is released");
  assert.equal(mod.heroLogoRescaleCache.size, 1);

  const second = await mod.preloadHeroLogo("https://cdn.example/big.png");
  assert.equal(second.src, "blob:test/1");
  assert.equal(fetches, 1, "a cached logo is not fetched again");
});

test("small, animated and failed logos keep the original url", async () => {
  reset();
  const sizes = [png(400, 100), webpVp8x(1664, 437, { animated: true })];
  let index = 0;
  let bitmaps = 0;
  globalThis.fetch = async () => ({ ok: true, blob: async () => blobOf(sizes[index]) });
  globalThis.createImageBitmap = async () => {
    bitmaps += 1;
    return { width: 1, height: 1, close() {} };
  };
  globalThis.OffscreenCanvas = class {
    getContext() {
      return { drawImage: () => {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
    }
  };

  const small = await mod.preloadHeroLogo("https://cdn.example/small.png");
  assert.deepEqual(small, { loaded: true, src: "https://cdn.example/small.png" });
  index = 1;
  const animated = await mod.preloadHeroLogo("https://cdn.example/animated.webp");
  assert.deepEqual(animated, { loaded: true, src: "https://cdn.example/animated.webp" });
  assert.equal(bitmaps, 0, "skipped before any full decode");

  globalThis.fetch = async () => {
    throw new Error("CORS");
  };
  const failed = await mod.preloadHeroLogo("https://cdn.example/blocked.png");
  assert.deepEqual(failed, { loaded: true, src: "https://cdn.example/blocked.png" });
});

test("the LRU revokes evicted blobs but never one the hero paints", async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, blob: async () => blobOf(png(1664, 437)) });
  globalThis.createImageBitmap = async () => ({ width: 440, height: 116, close() {} });
  globalThis.OffscreenCanvas = class {
    getContext() {
      return { drawImage: () => {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
    }
  };

  const first = await mod.preloadHeroLogo("https://cdn.example/0.png");
  globalThis.document = {
    querySelectorAll: () => [{ getAttribute: () => first.src }]
  };
  for (let index = 1; index <= 16; index += 1) {
    await mod.preloadHeroLogo(`https://cdn.example/${index}.png`);
  }
  assert.ok(!revokedUrls.includes(first.src), "the painted hero logo stays valid");
  assert.equal(mod.heroLogoRescaleCache.size, 16);

  globalThis.document = { querySelectorAll: () => [] };
  await mod.preloadHeroLogo("https://cdn.example/17.png");
  assert.ok(revokedUrls.includes(first.src), "a replaced logo is released");
  assert.equal(mod.heroLogoRescaleCache.size, 16);

  const cached = [...mod.heroLogoRescaleCache.values()].map((entry) => entry.objectUrl);
  mod.resetHeroLogoRescaleCache();
  assert.equal(mod.heroLogoRescaleCache.size, 0);
  cached.forEach((url) => assert.ok(revokedUrls.includes(url), "cleanup revokes what it drops"));
});

test("the hero swap paints the bounded blob and keeps the original source", async () => {
  reset();
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return { ok: true, blob: async () => blobOf(png(1664, 437)) };
  };
  globalThis.createImageBitmap = async () => ({ width: 440, height: 116, close() {} });
  globalThis.OffscreenCanvas = class {
    getContext() {
      return { drawImage: () => {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(["webp"], { type: "image/webp" }));
    }
  };
  globalThis.document = { querySelectorAll: () => [] };

  const parent = new FakeLogo();
  const logo = new FakeLogo();
  logo.attributes.src = "https://cdn.example/old.png";
  parent.insertBefore(logo);

  animateHeroLogoSwap(logo, "https://cdn.example/new.png", "New", 0);
  await settle();
  assert.equal(logo.heroLogoSourceUrl, "https://cdn.example/new.png");
  assert.match(logo.getAttribute("src"), /^blob:test\//);
  assert.equal(fetches, 1);

  animateHeroLogoSwap(logo, "https://cdn.example/new.png", "New", 0);
  await settle();
  assert.equal(fetches, 1, "the processed logo is not fetched again");
  assert.equal(parent.children.length, 1, "the transition ghost is gone");
});
