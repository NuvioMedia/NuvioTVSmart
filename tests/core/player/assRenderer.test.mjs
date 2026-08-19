import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { createAssRenderer } from "../../../js/core/player/assRenderer.js";

const originalLoad = globalThis.__loadAssStub;
let loadBehavior = "ok";

class FakeAss {
  constructor(body, video, options) {
    if (loadBehavior === "throw") {
      throw new Error("parse error");
    }
    this.body = body;
    this.video = video;
    this.options = options;
    this.destroyed = false;
    this.delayValue = 0;
    FakeAss.instances.push(this);
  }
  destroy() {
    this.destroyed = true;
  }
  show() {}
  hide() {}
  set delay(value) {
    this.delayValue = value;
  }
  get delay() {
    return this.delayValue;
  }
}
FakeAss.instances = [];

beforeEach(() => {
  FakeAss.instances = [];
  loadBehavior = "ok";
});

function installLoaderStub() {
  // createAssRenderer imports loadAssSubtitleLib by binding; patch via a
  // module-level seam is not available, so simulate through the loader's
  // global fast path: globalThis.ASS presence makes loadAssSubtitleLib
  // resolve without touching document.
  globalThis.ASS = FakeAss;
}

beforeEach(() => {
  installLoaderStub();
});
beforeEach(() => {
  return () => {
    delete globalThis.ASS;
  };
});

function makeBase({ token = 1, current = () => true } = {}) {
  const container = {
    children: [],
    replaceChildren() {
      this.children = [];
    }
  };
  const video = {};
  return {
    body: "[Script Info]",
    video,
    container,
    selectionToken: token,
    isCurrentSelection: current
  };
}

test("init creates an instance with body, video, container, resampling", async () => {
  const base = makeBase();
  const renderer = createAssRenderer(base);
  const result = await renderer.init();
  assert.equal(result.ok, true);
  assert.equal(FakeAss.instances.length, 1);
  const instance = FakeAss.instances[0];
  assert.equal(instance.body, "[Script Info]");
  assert.equal(instance.video, base.video);
  assert.equal(instance.options.container, base.container);
  assert.equal(instance.options.resampling, "video_height");
});

test("missing arguments return an error result", () => {
  assert.equal(createAssRenderer({ body: "", video: {}, container: {} }).ok, false);
  assert.equal(createAssRenderer({ body: "x", video: null, container: {} }).ok, false);
  assert.equal(createAssRenderer({ body: "x", video: {}, container: null }).ok, false);
});

test("parse failure clears the container and reports an error", async () => {
  loadBehavior = "throw";
  const base = makeBase();
  base.container.children.push("stale");
  const renderer = createAssRenderer(base);
  const result = await renderer.init();
  assert.equal(result.ok, false);
  assert.equal(result.error, "ass-renderer-parse-failed");
  assert.equal(base.container.children.length, 0);
});

test("stale activation is rejected", async () => {
  let current = false;
  const base = makeBase({ current: () => current });
  const renderer = createAssRenderer(base);
  const result = await renderer.init();
  assert.equal(result.ok, false);
  assert.equal(result.error, "ass-renderer-stale");
  assert.equal(FakeAss.instances.length, 0);
});

test("stale token surfacing after construction destroys the fresh instance", async () => {
  const selectionState = { token: 1 };
  // Flip the token inside the constructor: synchronous work overlaps a
  // newer selection winning.
  class RaceAss {
    constructor(body, video, options) {
      selectionState.token = 2;
      this.destroyed = false;
      FakeAss.instances.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
    show() {}
    hide() {}
    set delay(value) {}
  }
  const previousCtor = globalThis.ASS;
  globalThis.ASS = RaceAss;
  try {
    const base = makeBase({ current: () => selectionState.token === 1 });
    const renderer = createAssRenderer(base);
    const result = await renderer.init();
    assert.equal(result.ok, false);
    assert.equal(result.error, "ass-renderer-stale");
    // The instance created mid-race was destroyed, not left alive.
    assert.equal(FakeAss.instances[0].destroyed, true);
    assert.equal(renderer.active, false);
  } finally {
    globalThis.ASS = previousCtor;
  }
});

test("setDelay converts milliseconds to ass.js delay seconds", async () => {
  const base = makeBase();
  const renderer = createAssRenderer(base);
  await renderer.init();
  const instance = FakeAss.instances[0];
  assert.equal(renderer.setDelay(1500), true);
  assert.equal(instance.delay, 1.5);
  renderer.setDelay(-2500);
  assert.equal(instance.delay, -2.5);
});

test("destroy calls the library cleanup and clears the container", async () => {
  const base = makeBase();
  const renderer = createAssRenderer(base);
  await renderer.init();
  renderer.destroy();
  assert.equal(FakeAss.instances.length, 1);
  renderer.destroy();
  // Container is empty and second destroy is a no-op.
  assert.equal(base.container.children.length, 0);
});

test("destroy before init is safe", () => {
  const base = makeBase();
  const renderer = createAssRenderer(base);
  renderer.destroy();
  assert.equal(base.container.children.length, 0);
});

test("init after destroy reports destroyed", async () => {
  const base = makeBase();
  const renderer = createAssRenderer(base);
  renderer.destroy();
  const result = await renderer.init();
  assert.equal(result.ok, false);
  assert.equal(result.error, "ass-renderer-destroyed");
});
