import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const autoScrollSource = strip(
  await readFile(new URL("./heroDescriptionAutoScroll.js", import.meta.url), "utf8")
);

test("heroDescriptionAutoScroll uses single setTimeout for delay/endPause, avoids doubled delay, and caches identical mask writes", () => {
  let currentNow = 1000;
  let nextTimerId = 1;
  let nextFrameId = 1;
  const timers = new Map();
  const frames = new Map();
  const clearedTimers = [];
  const cancelledFrames = [];

  const context = vm.createContext({
    performance: { now: () => currentNow },
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      clearedTimers.push(id);
      timers.delete(id);
    },
    requestAnimationFrame: (fn) => {
      const id = nextFrameId++;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelledFrames.push(id);
      frames.delete(id);
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${autoScrollSource}\nglobalThis.createHeroDescriptionAutoScroller = createHeroDescriptionAutoScroller;`,
    context
  );

  const track = {
    classList: { contains: (cls) => cls === "hero-description-track" },
    scrollHeight: 400,
    style: { transform: "", willChange: "" },
    textContent: "Long synopsis",
    parentNode: null
  };
  let maskWrites = 0;
  let currentMaskImage = "";
  const nodeStyle = {
    height: "",
    webkitMaskImage: "",
    get maskImage() {
      return currentMaskImage;
    },
    set maskImage(value) {
      maskWrites += 1;
      currentMaskImage = value;
    }
  };
  const node = {
    textContent: "Long synopsis",
    clientHeight: 100,
    childNodes: [track],
    firstElementChild: track,
    classList: { add() {}, remove() {} },
    style: nodeStyle,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ lineHeight: "25px", fontSize: "20px" })
      }
    }
  };
  track.parentNode = node;

  const holdChanges = [];
  const scroller = context.createHeroDescriptionAutoScroller({
    isPaused: () => false,
    onHoldChange: (held) => holdChanges.push(held)
  });

  assert.equal(scroller.apply(node, true), true);
  assert.equal(frames.size, 0, "delay phase must not poll requestAnimationFrame at 60 FPS");
  assert.equal(timers.size, 1, "delay phase must schedule a single setTimeout");
  const [[delayTimerId, delayTimer]] = Array.from(timers.entries());
  assert.equal(delayTimer.ms, 3000);
  const writesAfterInitialMask = maskWrites;
  assert.equal(writesAfterInitialMask, 1);

  currentNow += 3000;
  timers.delete(delayTimerId);
  delayTimer.fn();
  assert.deepEqual(
    holdChanges,
    [false, true],
    "delay timer transitions directly to scroll after 3000 ms (not 6000 ms)"
  );
  assert.equal(frames.size, 1);

  // First scroll frame at elapsed = 0 matches the initial mask and should be skipped.
  const runNextFrame = (ts) => {
    const entries = Array.from(frames.entries());
    frames.clear();
    entries.forEach(([, fn]) => fn(ts));
  };
  runNextFrame(currentNow);
  assert.equal(maskWrites, writesAfterInitialMask);

  // Middle of scroll (fade = 18, distance = 300, duration = 30000): offset 100 and 110 share the same mask.
  currentNow += 10000;
  runNextFrame(currentNow);
  assert.equal(maskWrites, writesAfterInitialMask + 1);
  currentNow += 1000;
  runNextFrame(currentNow);
  assert.equal(
    maskWrites,
    writesAfterInitialMask + 1,
    "identical maskImage must not be rewritten each frame"
  );

  // Complete scroll: enters endPause via a single 3000 ms timer and 0 rAF loops.
  currentNow += 19000;
  runNextFrame(currentNow);
  assert.deepEqual(holdChanges, [false, true, false]);
  assert.equal(frames.size, 0, "endPause must not run idle rAF frames");
  assert.equal(timers.size, 1);
  const [[endTimerId, endTimer]] = Array.from(timers.entries());
  assert.equal(endTimer.ms, 3000);

  // Stopping during endPause clears the pending timer without throwing.
  scroller.stop();
  assert.equal(timers.size, 0);
  assert.equal(clearedTimers.includes(endTimerId), true);
  assert.equal(cancelledFrames.length >= 0, true);
});
