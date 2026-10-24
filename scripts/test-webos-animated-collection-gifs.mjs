import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

// LG webOS decodes and uploads native <img> GIF frames in the compositor commit
// path, so always-on collection GIFs delayed every D-pad move by ~600ms. These
// fixtures cover the worker player, its page controller, and the card markup.

const GIF = "https://cdn.example/platform.gif";
const COVER = "https://cdn.example/platform-cover.webp";

function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const clock = {
    now: () => now,
    setTimeout: (fn, ms = 0) => {
      const id = ++nextId;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    delay: (ms) => new Promise((resolve) => clock.setTimeout(resolve, ms)),
    flush,
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const [id, timer] =
          [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0] || [];
        if (!timer) break;
        now = Math.max(now, timer.at);
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      now = end;
      await flush();
    }
  };
  return clock;
}

// ---------------------------------------------------------------------------
// Worker: ImageDecoder -> ImageBitmap -> transferred OffscreenCanvas
// ---------------------------------------------------------------------------

const workerSource = await readFile(
  new URL("../js/core/media/animatedImageWorker.js", import.meta.url),
  "utf8"
);

function loadWorker({
  frames,
  repetitionCount = Infinity,
  ok = true,
  supported = true,
  drawCostMs = 0,
  size = [480, 270]
}) {
  const clock = createClock();
  const posted = [];
  const draws = [];
  const clears = [];
  const fetches = [];
  const decoders = [];
  const bitmaps = [];
  class FakeImageDecoder {
    static async isTypeSupported(type) {
      return supported && type === "image/gif";
    }
    constructor({ type }) {
      this.type = type;
      this.closed = false;
      this.decoded = [];
      this.tracks = {
        ready: Promise.resolve(),
        selectedTrack: { frameCount: frames.length, repetitionCount }
      };
      this.completed = Promise.resolve();
      decoders.push(this);
    }
    async decode({ frameIndex }) {
      this.decoded.push(frameIndex);
      await clock.delay(0);
      const frame = {
        index: frameIndex,
        duration: frames[frameIndex] * 1000,
        displayWidth: size[0],
        displayHeight: size[1],
        closed: false,
        close() {
          this.closed = true;
        }
      };
      return { image: frame };
    }
    close() {
      this.closed = true;
    }
  }
  const context = vm.createContext({
    self: {},
    console,
    // Copy out of the vm realm so deepStrictEqual compares values, not prototypes.
    postMessage: (message) => posted.push({ ...message }),
    fetch: async (url) => {
      fetches.push(url);
      return {
        ok,
        status: ok ? 200 : 404,
        headers: { get: () => "image/gif" },
        arrayBuffer: async () => new ArrayBuffer(8)
      };
    },
    ImageDecoder: FakeImageDecoder,
    createImageBitmap: async (source) => {
      await clock.delay(drawCostMs);
      const bitmap = {
        frame: source.index,
        closed: false,
        close() {
          this.closed = true;
        }
      };
      bitmaps.push(bitmap);
      return bitmap;
    },
    performance: { now: clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  vm.runInContext(workerSource, context);
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => ({
      drawImage: (bitmap, x, y, width, height) =>
        draws.push({ frame: bitmap.frame, at: clock.now(), width, height, bitmap }),
      clearRect: () => clears.push(clock.now())
    })
  };
  const send = (data) => context.self.onmessage({ data });
  const attach = (extra = {}) =>
    send({ type: "attach", id: 1, url: GIF, canvas, maxWidth: 822, maxHeight: 466, ...extra });
  const drawn = (since = 0) =>
    draws.filter((d) => d.at >= since).map((d) => [d.frame, d.at - since]);
  return { clock, posted, draws, clears, fetches, decoders, bitmaps, canvas, send, attach, drawn };
}

test("worker plays visible GIFs at GIF timing through GPU-scaled ImageBitmaps", async () => {
  const w = loadWorker({ frames: [40, 40, 80] });
  w.attach();
  await w.clock.advance(500);
  assert.equal(w.fetches.length, 0, "off-screen cards must not download or decode");

  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(199);
  assert.deepEqual(w.drawn(500), [
    [0, 0],
    [1, 40],
    [2, 80],
    [0, 160]
  ]);
  assert.deepEqual(
    [w.canvas.width, w.canvas.height],
    [480, 270],
    "never upscale the backing store"
  );
  // drawImage(VideoFrame) scales on the CPU (~130ms for 1280x720 on LG).
  assert.ok(w.draws.every((d) => w.bitmaps.includes(d.bitmap)));
  assert.ok(w.bitmaps.every((bitmap) => bitmap.closed));
});

test("worker pauses while hidden or held for navigation and resumes on the next frame", async () => {
  const w = loadWorker({ frames: [40, 40, 40, 40] });
  w.attach();
  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(100);
  assert.deepEqual(w.drawn(), [
    [0, 0],
    [1, 40],
    [2, 80]
  ]);

  w.send({ type: "visible", id: 1, visible: false });
  await w.clock.advance(200);
  assert.equal(w.draws.length, 3);
  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(1);
  assert.deepEqual(w.drawn(300), [[3, 0]]);

  w.send({ type: "hold", held: true });
  await w.clock.advance(100);
  assert.equal(w.draws.length, 4, "remote input holds every player");
  w.send({ type: "hold", held: false });
  await w.clock.advance(1);
  assert.deepEqual(w.drawn(401), [[0, 0]]);
});

test("worker keeps wall-clock timing by skipping draws when drawing falls behind", async () => {
  const w = loadWorker({ frames: Array(50).fill(20), drawCostMs: 50 });
  w.attach();
  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(1000);
  const decoded = w.decoders[0].decoded;
  assert.deepEqual(decoded, [...decoded.keys()], "GIF frames are decoded in order");
  assert.ok(decoded.length >= 48 && decoded.length <= 52, `decoded ${decoded.length} frames in 1s`);
  assert.ok(w.draws.length >= 18 && w.draws.length <= 21, `drew ${w.draws.length} frames in 1s`);
  // Each draw starts 50ms before drawImage; the drawn frame tracks that start time.
  w.draws.forEach(({ frame, at }) =>
    assert.ok(Math.abs(frame - (at - 50) / 20) <= 2, `frame ${frame} at ${at}ms`)
  );
});

test("worker clamps 0-10ms GIF delays to 100ms and honours finite loop counts", async () => {
  const clamped = loadWorker({ frames: [0, 10, 50] });
  clamped.attach();
  clamped.send({ type: "visible", id: 1, visible: true });
  await clamped.clock.advance(260);
  assert.deepEqual(clamped.drawn(), [
    [0, 0],
    [1, 100],
    [2, 200],
    [0, 250]
  ]);

  const once = loadWorker({ frames: [40, 40], repetitionCount: 1 });
  once.attach();
  once.send({ type: "visible", id: 1, visible: true });
  await once.clock.advance(1000);
  assert.deepEqual(once.drawn(), [
    [0, 0],
    [1, 40],
    [0, 80],
    [1, 120]
  ]);
});

test("worker plays focus-only overlays while focused and rewinds when focus leaves", async () => {
  const w = loadWorker({ frames: [40, 40, 40] });
  w.attach({ focusOnly: true });
  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(100);
  assert.equal(w.fetches.length, 0);

  w.send({ type: "active", id: 1, active: true });
  await w.clock.advance(50);
  assert.deepEqual(w.drawn(100), [
    [0, 0],
    [1, 40]
  ]);
  w.send({ type: "active", id: 1, active: false });
  await w.clock.advance(100);
  assert.deepEqual(w.clears, [150]);
  assert.equal(w.draws.length, 2);
  w.send({ type: "active", id: 1, active: true });
  await w.clock.advance(1);
  assert.deepEqual(w.drawn(250), [[0, 0]]);
});

test("worker sizes large GIFs down to the card and releases decoders", async () => {
  const w = loadWorker({ frames: [40, 40], size: [1280, 720] });
  w.attach();
  w.send({ type: "visible", id: 1, visible: true });
  await w.clock.advance(50);
  assert.deepEqual([w.canvas.width, w.canvas.height], [822, 462]);
  assert.deepEqual([w.draws[0].width, w.draws[0].height], [822, 462]);

  w.send({ type: "detach", id: 1 });
  await w.clock.advance(200);
  assert.equal(w.decoders[0].closed, true);
  assert.equal(w.draws.length, 2);
});

test("worker reports load failures so the page can fall back to <img>", async () => {
  const missing = loadWorker({ frames: [40], ok: false });
  missing.attach();
  missing.send({ type: "visible", id: 1, visible: true });
  await missing.clock.advance(10);
  assert.deepEqual(missing.posted, [{ type: "error", id: 1, message: "HTTP 404" }]);
  missing.send({ type: "visible", id: 1, visible: true });
  await missing.clock.advance(10);
  assert.equal(missing.fetches.length, 1, "a failed player is released");

  const unsupported = loadWorker({ frames: [40], supported: false });
  unsupported.attach();
  unsupported.send({ type: "visible", id: 1, visible: true });
  await unsupported.clock.advance(10);
  assert.match(unsupported.posted[0]?.message || "", /Unsupported image type/);
});

// ---------------------------------------------------------------------------
// Page controller and card markup
// ---------------------------------------------------------------------------

const kebab = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

class FakeElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.detached = false;
    this.className = attributes.class || "";
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    const element = this;
    this.dataset = new Proxy(
      {},
      {
        get: (_, key) => element.getAttribute(`data-${kebab(String(key))}`) ?? undefined,
        set: (_, key, value) => {
          element.setAttribute(`data-${kebab(String(key))}`, value);
          return true;
        }
      }
    );
  }
  get isConnected() {
    return !this.detached && (!this.parentElement || this.parentElement.isConnected);
  }
  get src() {
    return this.getAttribute("src") || "";
  }
  set src(value) {
    this.setAttribute("src", value);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
    return this;
  }
  insertAdjacentElement(position, node) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
    node.parentElement = this.parentElement;
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
    }
    this.parentElement = null;
    this.detached = true;
  }
  closest(selector) {
    const className = selector.replace(/^\./, "");
    for (let node = this; node; node = node.parentElement) {
      if (node.className.split(/\s+/).includes(className)) return node;
    }
    return null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  querySelectorAll(selector) {
    assert.equal(selector, "img[data-animated-src]");
    const found = [];
    const walk = (node) =>
      node.children.forEach((child) => {
        if (child.tagName === "IMG" && child.getAttribute("data-animated-src") !== null)
          found.push(child);
        walk(child);
      });
    walk(this);
    return found;
  }
}

class FakeImage extends FakeElement {
  constructor(attributes) {
    super("img", attributes);
  }
}

class FakeCanvas extends FakeElement {
  constructor() {
    super("canvas");
  }
  transferControlToOffscreen() {
    assert.ok(!this.transferred, "a canvas can only be transferred once");
    this.transferred = true;
    return { offscreenFor: this };
  }
}

function listenerSet() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => listeners.get(type) === fn && listeners.delete(type),
    dispatch: (type) => listeners.get(type)?.({ type })
  };
}

const replaceEnvironment = {
  name: "environment-fixture",
  setup(b) {
    b.onLoad({ filter: /\/platform\/environment\.js$/ }, () => ({
      contents: "export const Environment = fixtures.Environment;",
      loader: "js"
    }));
  }
};

async function bundle(contents, plugins = []) {
  const result = await build({
    stdin: { resolveDir: process.cwd(), contents },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "subject",
    plugins: [replaceEnvironment, ...plugins]
  });
  return result.outputFiles[0].text;
}

const controllerBundle = await bundle('export * from "./js/core/media/animatedImageCanvas.js";');

function runtimeGlobals({ platform = "webos", imageDecoder = true, workerThrows = false } = {}) {
  const clock = createClock();
  const workers = [];
  const observers = [];
  const win = listenerSet();
  const doc = listenerSet();
  class FakeWorker {
    constructor(url) {
      if (workerThrows) throw new Error("worker blocked");
      this.url = url;
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
  }
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      observers.push(this);
    }
    observe(node) {
      this.observed.add(node);
    }
    unobserve(node) {
      this.observed.delete(node);
    }
    disconnect() {
      this.observed.clear();
    }
  }
  const globals = {
    fixtures: { Environment: { isWebOS: () => platform === "webos" } },
    console,
    URL,
    Worker: FakeWorker,
    ImageDecoder: imageDecoder ? function ImageDecoder() {} : undefined,
    OffscreenCanvas: function OffscreenCanvas() {},
    createImageBitmap: () => {},
    IntersectionObserver: FakeIntersectionObserver,
    HTMLCanvasElement: FakeCanvas,
    HTMLImageElement: FakeImage,
    devicePixelRatio: 2,
    location: { href: "file:///apps/nuvio/index.html" },
    window: win,
    document: {
      ...doc,
      hidden: false,
      baseURI: "file:///apps/nuvio/index.html",
      createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : new FakeElement(tag))
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval
  };
  return { globals, clock, workers, observers, win, doc };
}

function setupController(options) {
  const runtime = runtimeGlobals(options);
  const context = vm.createContext(runtime.globals);
  vm.runInContext(controllerBundle, context);
  const content = new FakeImage({ class: "content-poster", src: COVER, "data-animated-src": GIF });
  const overlay = new FakeImage({
    class: "home-poster-focus-gif",
    "data-animated-src": GIF,
    "data-animated-focus-only": "true"
  });
  const frame = new FakeElement("div", { class: "home-poster-frame" }).append(content, overlay);
  frame.offsetWidth = 411;
  frame.offsetHeight = 233;
  const card = new FakeElement("article", { class: "home-collection-card" }).append(frame);
  const root = new FakeElement("div").append(card);
  const messages = () =>
    runtime.workers.flatMap((worker) => worker.messages.map((message) => ({ ...message })));
  const canvases = () => frame.children.filter((node) => node instanceof FakeCanvas);
  const emit = (data) => runtime.workers.at(-1).onmessage({ data });
  return {
    ...runtime,
    api: context.subject,
    content,
    overlay,
    frame,
    card,
    root,
    messages,
    canvases,
    emit
  };
}

test("controller is limited to webOS runtimes with ImageDecoder and OffscreenCanvas", () => {
  assert.equal(
    setupController({ platform: "browser" }).api.shouldUseAnimatedImageCanvas(GIF),
    false
  );
  assert.equal(setupController({ platform: "tizen" }).api.shouldUseAnimatedImageCanvas(GIF), false);
  assert.equal(
    setupController({ imageDecoder: false }).api.shouldUseAnimatedImageCanvas(GIF),
    false
  );
  const webos = setupController();
  assert.equal(webos.api.shouldUseAnimatedImageCanvas(GIF), true);
  assert.equal(webos.api.shouldUseAnimatedImageCanvas(""), false);

  const browser = setupController({ platform: "browser" });
  browser.api.attachAnimatedImageCanvases(browser.root);
  assert.equal(browser.workers.length, 0);
});

test("controller layers one worker-drawn canvas above each always-on GIF's static cover", () => {
  const h = setupController();
  h.api.attachAnimatedImageCanvases(h.root);
  h.api.attachAnimatedImageCanvases(h.root);

  assert.equal(h.workers.length, 1);
  assert.match(h.workers[0].url, /\/assets\/runtime\/animated-image-worker\.js$/);
  const [canvas] = h.canvases();
  assert.deepEqual(
    h.frame.children,
    [h.content, canvas, h.overlay],
    "focus overlays wait for focus"
  );
  assert.equal(canvas.className, "home-poster-animated-canvas");
  assert.equal(canvas.getAttribute("aria-hidden"), "true");
  assert.equal(h.content.src, COVER, "the native <img> never loads the GIF");
  assert.deepEqual(h.messages(), [
    {
      type: "attach",
      id: 1,
      url: GIF,
      canvas: { offscreenFor: canvas },
      focusOnly: false,
      maxWidth: 822,
      maxHeight: 466
    }
  ]);
  assert.ok(h.observers[0].observed.has(canvas));

  h.observers[0].callback([{ target: canvas, isIntersecting: true }]);
  assert.deepEqual(h.messages().at(-1), { type: "visible", id: 1, visible: true });
});

test("controller pauses every GIF while the remote is in use or the app is hidden", async () => {
  const h = setupController();
  h.api.attachAnimatedImageCanvases(h.root);
  const holds = () => h.messages().filter((message) => message.type === "hold");

  h.win.dispatch("keydown");
  await h.clock.advance(600);
  h.win.dispatch("keydown");
  await h.clock.advance(999);
  assert.deepEqual(holds(), [{ type: "hold", held: true }]);
  await h.clock.advance(1);
  assert.deepEqual(holds().at(-1), { type: "hold", held: false });

  h.globals.document.hidden = true;
  h.doc.dispatch("visibilitychange");
  assert.deepEqual(holds().at(-1), { type: "hold", held: true });
});

test("controller plays focus-only overlays only while their card is focused", () => {
  const h = setupController();
  assert.equal(h.api.setAnimatedImageCanvasActive(h.overlay, true), true);
  const [canvas] = h.canvases();
  assert.equal(canvas.className, "home-poster-animated-canvas is-focus-gif");
  assert.deepEqual(
    h.messages().map(({ type, focusOnly, active }) => ({ type, focusOnly, active })),
    [
      { type: "attach", focusOnly: true, active: undefined },
      { type: "active", focusOnly: undefined, active: true }
    ]
  );
  assert.equal(h.api.setAnimatedImageCanvasActive(h.overlay, false), true);
  assert.deepEqual(h.messages().at(-1), { type: "active", id: 1, active: false });

  const native = new FakeImage({ class: "home-poster-focus-gif", "data-src": GIF });
  assert.equal(
    h.api.setAnimatedImageCanvasActive(native, true),
    false,
    "native overlays keep their path"
  );
});

test("controller falls back to native <img> GIFs when the worker cannot play them", () => {
  const h = setupController();
  h.api.attachAnimatedImageCanvases(h.root);
  h.card.className += " is-focus-gif-active";
  h.api.setAnimatedImageCanvasActive(h.overlay, true);
  h.emit({ type: "error", id: 1, message: "HTTP 403" });
  h.emit({ type: "error", id: 2, message: "HTTP 403" });

  assert.equal(h.canvases().length, 0);
  assert.equal(h.content.src, GIF);
  assert.equal(h.content.dataset.animatedSrc, undefined);
  assert.equal(h.overlay.dataset.src, GIF, "the focus overlay loads data-src natively");
  assert.equal(h.overlay.src, GIF, "the focused card keeps its GIF");
  assert.equal(h.workers[0].terminated, true);
  assert.equal(
    h.api.shouldUseAnimatedImageCanvas(GIF),
    false,
    "later renders use the native markup"
  );

  const blocked = setupController({ workerThrows: true });
  blocked.api.attachAnimatedImageCanvases(blocked.root);
  assert.equal(blocked.content.src, GIF);
  assert.equal(blocked.canvases().length, 0);
  assert.equal(blocked.api.shouldUseAnimatedImageCanvas(GIF), false);
});

test("controller releases decoders and listeners while Home is hidden", () => {
  const h = setupController();
  h.api.attachAnimatedImageCanvases(h.root);
  h.api.releaseAnimatedImageCanvases(h.root);
  assert.equal(h.canvases().length, 0);
  assert.deepEqual(h.messages().at(-1), { type: "detach", id: 1 });
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.win.listeners.size, 0);
  assert.equal(h.doc.listeners.size, 0);
  assert.equal(h.content.src, COVER);

  h.api.attachAnimatedImageCanvases(h.root);
  assert.equal(h.workers.length, 2, "returning to Home attaches a fresh player");
  assert.equal(h.canvases().length, 1);

  h.card.remove();
  h.api.attachAnimatedImageCanvases(h.root);
  assert.deepEqual(h.messages().at(-1), { type: "detach", id: 2 }, "removed cards are swept");
});

const markupBundle = await bundle(
  'export { createPosterCardMarkup } from "./js/ui/screens/home/homeScreenHelpers-15-create-poster-card-markup.js";',
  [
    {
      name: "home-markup-boundaries",
      setup(b) {
        // Keep the real collection card path; replace unrelated repositories/UI imports.
        b.onLoad(
          { filter: /\/js\/ui\/screens\/home\/(?:homeScreenHelpers-\d+[^/]*|homeUtils)\.js$/ },
          async ({ path }) => ({
            contents: (await readFile(path, "utf8")).replace(
              /import\s+(\{[^}]+\})\s+from\s+["']([^"']+)["'];/g,
              (statement, bindings, source) =>
                /(?:homeScreenHelpers-(?:04|05|14|15)-[^/]+|homeUtils|animatedImageCanvas)\.js$/.test(
                  source
                )
                  ? statement
                  : `const ${bindings} = fixtures;`
            ),
            loader: "js"
          })
        );
      }
    }
  ]
);

function renderCollectionCard(folder, options) {
  const { globals } = runtimeGlobals(options);
  globals.fixtures.buildPosterSubtitle = () => "";
  globals.fixtures.buildModernRowKey = () => "platforms";
  const context = vm.createContext(globals);
  vm.runInContext(markupBundle, context);
  const row = {
    rowKind: "collection",
    collectionId: "platforms",
    collection: { id: "platforms", title: "Platforms" }
  };
  const item = { id: "netflix", title: "Netflix", tileShape: "LANDSCAPE", ...folder };
  return context.subject.createPosterCardMarkup(
    item,
    0,
    0,
    "collection_folder",
    row,
    true,
    "modern",
    false,
    false,
    false
  );
}

test("webOS collection cards render static covers and hand GIFs to the canvas player", () => {
  const alwaysOn = renderCollectionCard({
    focusGifUrl: GIF,
    focusGifEnabled: false,
    coverImageUrl: COVER
  });
  assert.match(
    alwaysOn,
    new RegExp(
      `<img class="content-poster" src="${COVER}"[^>]* data-animated-src="${GIF}" alt="Netflix"`
    )
  );
  assert.doesNotMatch(alwaysOn, new RegExp(`\\ssrc="${GIF}"`), "no native GIF src");

  const gifOnly = renderCollectionCard({ focusGifUrl: GIF, focusGifEnabled: false });
  assert.match(
    gifOnly,
    new RegExp(`<img class="content-poster"\\s+data-animated-src="${GIF}" alt="" />`)
  );

  const onFocus = renderCollectionCard({
    focusGifUrl: GIF,
    focusGifEnabled: true,
    coverImageUrl: COVER
  });
  assert.match(
    onFocus,
    new RegExp(`<img class="content-poster" src="${COVER}"[^>]* alt="Netflix"`)
  );
  assert.match(
    onFocus,
    new RegExp(
      `<img class="home-poster-focus-gif" data-animated-src="${GIF}" data-animated-focus-only="true"`
    )
  );
  assert.doesNotMatch(onFocus, /data-src=/);
});

test("other platforms keep the native <img> GIF markup unchanged", () => {
  for (const options of [{ platform: "tizen" }, { platform: "browser" }, { imageDecoder: false }]) {
    const alwaysOn = renderCollectionCard(
      { focusGifUrl: GIF, focusGifEnabled: false, coverImageUrl: COVER },
      options
    );
    assert.match(
      alwaysOn,
      new RegExp(`<img class="content-poster" src="${GIF}"[^>]* alt="Netflix" />`)
    );
    assert.doesNotMatch(alwaysOn, /data-animated-src/);

    const onFocus = renderCollectionCard(
      { focusGifUrl: GIF, focusGifEnabled: true, coverImageUrl: COVER },
      options
    );
    assert.match(
      onFocus,
      new RegExp(
        `<img class="home-poster-focus-gif" data-src="${GIF}" alt="" aria-hidden="true" />`
      )
    );
  }
});
