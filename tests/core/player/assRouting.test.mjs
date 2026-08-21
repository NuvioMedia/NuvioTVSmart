import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { isAssSubtitle, convertAssBodyToVtt } from "../../../js/core/player/assSubtitle.js";
import { createAssRenderer } from "../../../js/core/player/assRenderer.js";
import { resetAssSubtitleLibCache } from "../../../js/core/player/assSubtitleLoader.js";

const ASS_BODY = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname",
  "Style: Default,Arial",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello {\\an8}world",
  "Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\pos(100,200)}Positioned"
].join("\n");

class FakeAss {
  constructor(content, video, options) {
    this.content = content;
    this.video = video;
    this.options = options;
    this.delayValue = 0;
    this.destroyed = false;
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

let lastFakeAss = null;

function installAssGlobal() {
  globalThis.ASS = class extends FakeAss {
    constructor(...args) {
      super(...args);
      lastFakeAss = this;
    }
  };
}

beforeEach(() => {
  lastFakeAss = null;
  delete globalThis.ASS;
  delete globalThis.document;
  globalThis.ResizeObserver = class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  resetAssSubtitleLibCache();
});

afterEach(() => {
  delete globalThis.ResizeObserver;
});

test("routing pipeline: detected ASS reaches the renderer, not a VTT track", async () => {
  const detection = isAssSubtitle(ASS_BODY, { sourceUrl: "http://x/sub.ass" });
  assert.equal(detection, true);

  installAssGlobal();
  const renderer = createAssRenderer({
    body: ASS_BODY,
    video: { addEventListener() {}, removeEventListener() {} },
    container: { classList: { add() {}, remove() {} }, setAttribute() {} },
    selectionToken: 1,
    isCurrentSelection: () => true
  });
  const result = await renderer.init();
  assert.equal(result.ok, true);
  assert.ok(lastFakeAss);
  renderer.destroy();
  assert.equal(lastFakeAss.destroyed, true);
});

test("routing pipeline: fallback converts to readable VTT when the renderer fails", async () => {
  // No ASS global and no document: the library cannot load.
  const result = await createAssRenderer({
    body: ASS_BODY,
    video: { addEventListener() {}, removeEventListener() {} },
    container: { classList: { add() {}, remove() {} }, setAttribute() {} },
    selectionToken: 1,
    isCurrentSelection: () => true
  }).init();
  assert.equal(result.ok, false);
  assert.equal(result.error, "ass-renderer-load-failed");

  const fallbackVtt = convertAssBodyToVtt(ASS_BODY);
  assert.match(fallbackVtt, /^WEBVTT/);
  assert.match(fallbackVtt, /00:00:01\.000 --> 00:00:03\.500/);
  assert.match(fallbackVtt, /Hello world/);
  // Positioning and alignment tags are discarded in the fallback.
  assert.equal(fallbackVtt.includes("\\pos"), false);
  assert.equal(fallbackVtt.includes("\\an"), false);
});

test("stale selection cannot supersede a newer token", async () => {
  installAssGlobal();
  const selectionState = { token: 1 };
  const renderer = createAssRenderer({
    body: ASS_BODY,
    video: { addEventListener() {}, removeEventListener() {} },
    container: { classList: { add() {}, remove() {} }, setAttribute() {} },
    selectionToken: 1,
    isCurrentSelection: () => selectionState.token === 1
  });
  // A newer selection wins before init completes.
  selectionState.token = 2;
  const result = await renderer.init();
  assert.equal(result.ok, false);
  assert.equal(result.error, "ass-renderer-stale");
  assert.equal(renderer.active, false);
  assert.equal(lastFakeAss, null);
});

test("delay is applied in seconds on the constructed instance", async () => {
  installAssGlobal();
  const renderer = createAssRenderer({
    body: ASS_BODY,
    video: { addEventListener() {}, removeEventListener() {} },
    container: { classList: { add() {}, remove() {} }, setAttribute() {} },
    selectionToken: 1,
    isCurrentSelection: () => true
  });
  const initResult = await renderer.init();
  assert.equal(initResult.ok, true);
  assert.equal(renderer.setDelay(2000), true);
  assert.equal(lastFakeAss.delay, 2);
  renderer.setDelay(-1500);
  assert.equal(lastFakeAss.delay, -1.5);
});

test("malformed ASS body still produces a fallback result", () => {
  const broken = "[Script Info]\n[Events]\nDialogue: garbage";
  assert.equal(convertAssBodyToVtt(broken), "");
});
