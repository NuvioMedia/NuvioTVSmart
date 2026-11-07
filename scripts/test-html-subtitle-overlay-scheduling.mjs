import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import {
  buildHtmlSubtitleCueIndex,
  findActiveHtmlSubtitleCues
} from "../js/ui/screens/player/htmlSubtitleCueIndex.js";

// The HTML subtitle overlay (add-on SRT/VTT on Tizen AVPlay and webOS) wakes at
// cue boundaries instead of polling every 120 ms. These tests drive the real
// render + plan methods with a fake clock and timers.

async function loadMethods(number, name, context) {
  const files = await import("node:fs/promises").then((fs) =>
    fs.readdir(new URL("../js/ui/screens/player/", import.meta.url))
  );
  const file = files.find((entry) => entry.startsWith(`playerScreenMethods-${number}-`));
  const source = await readFile(
    new URL(`../js/ui/screens/player/${file}`, import.meta.url),
    "utf8"
  );
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") + `\nthis.loaded = ${name}();`,
    context
  );
  return context.loaded;
}

async function createHarness({ cues, rate = 1 }) {
  const clock = { now: 0 };
  const timers = [];
  const context = vm.createContext({
    internals: {
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      PlayerController: {},
      Environment: { isTizen: () => false, isWebOS: () => false }
    },
    buildHtmlSubtitleCueIndex,
    findActiveHtmlSubtitleCues,
    setTimeout: (callback, delay) => {
      const timer = { callback, at: clock.now + Number(delay || 0), delay: Number(delay || 0) };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true;
    }
  });
  const methods45 = await loadMethods("45", "createPlayerScreenMethods45", context);
  const methods46 = await loadMethods("46", "createPlayerScreenMethods46", context);
  const renders = [];
  const screen = {
    ...methods45,
    ...methods46,
    htmlSubtitleCues: cues,
    htmlSubtitleCueIndex: null,
    htmlSubtitleRenderTimer: null,
    htmlSubtitleRenderLoopActive: false,
    subtitleDelayMs: 0,
    getPlaybackSpeed: () => rate,
    getPlaybackCurrentSeconds: () => clock.now / 1000,
    renderHtmlSubtitleOverlayCue(activeCues) {
      renders.push({ at: clock.now, texts: activeCues.map((cue) => cue.text) });
    }
  };
  const runUntil = (untilMs) => {
    for (;;) {
      const next = timers
        .filter((timer) => !timer.cleared && !timer.fired && timer.at <= untilMs)
        .sort((left, right) => left.at - right.at)[0];
      if (!next) break;
      clock.now = next.at;
      next.fired = true;
      next.callback();
    }
    clock.now = untilMs;
  };
  const armed = () => timers.filter((timer) => !timer.cleared && !timer.fired);
  return { screen, clock, timers, renders, runUntil, armed };
}

const CUES = [
  { start: 1, end: 3, text: "first" },
  { start: 5, end: 6.2, text: "second" },
  { start: 9.5, end: 11, text: "third" }
];

test("the overlay wakes at cue boundaries and never polls faster than the idle rate", async () => {
  const { screen, renders, runUntil, armed } = await createHarness({ cues: CUES });
  screen.scheduleHtmlSubtitleOverlayRender();
  assert.equal(screen.htmlSubtitleRenderLoopActive, true);
  assert.equal(armed().length, 1, "a single pending timer");
  runUntil(12_000);
  const shown = renders
    .filter((render) => render.texts.length)
    .map((render) => `${render.at}:${render.texts.join(",")}`);
  // Each cue appears within slack+1 ms of its start and disappears within slack+1 ms of its end.
  const firstShown = renders.find((render) => render.texts.includes("first"));
  const firstHidden = renders.find(
    (render) => render.at > firstShown.at && !render.texts.includes("first")
  );
  assert.ok(firstShown.at >= 1000 && firstShown.at <= 1012, `first shown at ${firstShown.at}`);
  assert.ok(firstHidden.at >= 3000 && firstHidden.at <= 3012, `first hidden at ${firstHidden.at}`);
  const secondShown = renders.find((render) => render.texts.includes("second"));
  const secondHidden = renders.find(
    (render) => render.at > secondShown.at && !render.texts.includes("second")
  );
  assert.ok(secondShown.at >= 5000 && secondShown.at <= 5012, `second shown at ${secondShown.at}`);
  assert.ok(
    secondHidden.at >= 6200 && secondHidden.at <= 6212,
    `second hidden at ${secondHidden.at}`
  );
  const thirdShown = renders.find((render) => render.texts.includes("third"));
  assert.ok(thirdShown.at >= 9500 && thirdShown.at <= 9512, `third shown at ${thirdShown.at}`);
  assert.ok(shown.length > 0);
  // 12 s at the old 120 ms poll was 100 renders; boundary scheduling needs far fewer.
  assert.ok(renders.length <= 32, `renders: ${renders.length}`);
  const gaps = renders.slice(1).map((render, index) => render.at - renders[index].at);
  assert.ok(
    gaps.every((gap) => gap >= 40),
    "no wake-up closer than the minimum delay"
  );
  assert.ok(
    gaps.every((gap) => gap <= 500),
    "no sleep longer than the idle poll"
  );
});

test("after the last cue the loop keeps a slow idle poll only", async () => {
  const { screen, renders, runUntil } = await createHarness({ cues: CUES });
  screen.scheduleHtmlSubtitleOverlayRender();
  runUntil(11_010);
  const before = renders.length;
  runUntil(21_010);
  assert.equal(renders.length - before, 20, "one wake-up per idle interval");
  assert.equal(screen.htmlSubtitleRenderLoopActive, true);
});

test("a timeupdate re-arms the timer from the new position", async () => {
  const { screen, clock, renders, runUntil, armed } = await createHarness({ cues: CUES });
  screen.scheduleHtmlSubtitleOverlayRender();
  runUntil(400);
  // A seek lands just before the first cue ends; the pending 500 ms poll would
  // miss the boundary by far. timeupdate renders and re-plans.
  clock.now = 2_950;
  screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.deepEqual(renders[renders.length - 1].texts, ["first"]);
  const pending = armed();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].delay, 60, "50 ms to the boundary plus slack");
  runUntil(3_010);
  assert.deepEqual(renders[renders.length - 1].texts, []);
});

test("playback rate shortens the sleep and subtitle delay shifts the boundary", async () => {
  const fast = await createHarness({ cues: CUES, rate: 2 });
  fast.screen.scheduleHtmlSubtitleOverlayRender();
  fast.clock.now = 800;
  fast.screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.ok(
    fast.armed()[0].delay >= 110 && fast.armed()[0].delay <= 111,
    "200 ms of media at 2x is 100 ms plus slack"
  );

  const delayed = await createHarness({ cues: CUES });
  delayed.screen.subtitleDelayMs = 500;
  delayed.screen.scheduleHtmlSubtitleOverlayRender();
  delayed.clock.now = 1_400;
  delayed.screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.deepEqual(
    delayed.renders[delayed.renders.length - 1].texts,
    [],
    "cue shifted later by the delay"
  );
  assert.ok(
    delayed.armed()[0].delay >= 110 && delayed.armed()[0].delay <= 111,
    "subtitle time is 0.9 s; cue starts at 1 s"
  );
});

test("the index is rebuilt when a new cue array is assigned", async () => {
  const { screen, clock, renders } = await createHarness({ cues: CUES });
  screen.scheduleHtmlSubtitleOverlayRender();
  const firstIndex = screen.htmlSubtitleCueIndex;
  clock.now = 1_500;
  screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.equal(screen.htmlSubtitleCueIndex, firstIndex, "same array keeps the index");
  screen.htmlSubtitleCues = [{ start: 1, end: 2, text: "replaced" }];
  screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.notEqual(screen.htmlSubtitleCueIndex, firstIndex);
  assert.deepEqual(renders[renders.length - 1].texts, ["replaced"]);
});

test("planning is a no-op when the loop is not active, and an empty cue list stops it", async () => {
  const { screen, armed } = await createHarness({ cues: CUES });
  screen.planHtmlSubtitleOverlayRender(0.2);
  assert.equal(armed().length, 0);
  screen.renderHtmlSubtitleOverlayAtCurrentTime();
  assert.equal(armed().length, 0, "a render outside the loop does not start timers");
  screen.scheduleHtmlSubtitleOverlayRender();
  assert.equal(armed().length, 1);
  screen.htmlSubtitleCues = [];
  const [timer] = armed();
  timer.fired = true;
  timer.callback();
  assert.equal(screen.htmlSubtitleRenderLoopActive, false);
  assert.equal(armed().length, 0);
});
