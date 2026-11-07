import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHtmlSubtitleCueIndex, findActiveHtmlSubtitleCues } from "./htmlSubtitleCueIndex.js";

function filterActive(cues, time) {
  return cues.filter((cue) => time >= cue.start && time < cue.end);
}

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test("active cues match the linear filter, in original order, for overlapping and unsorted cues", () => {
  const random = createRandom(7);
  const cues = [];
  for (let index = 0; index < 400; index += 1) {
    const start = Math.round(random() * 3600 * 10) / 10;
    const duration = 0.2 + Math.round(random() * 90) / 10;
    cues.push({ start, end: start + duration, text: `cue ${index}` });
  }
  // Add exact-boundary and zero-length shapes the parser can emit.
  cues.push({ start: 100, end: 100.001, text: "blink" });
  cues.push({ start: 100, end: 104, text: "same start" });
  cues.push({ start: 100.001, end: 101, text: "adjacent" });
  const index = buildHtmlSubtitleCueIndex(cues);
  for (let query = 0; query < 3000; query += 1) {
    const time = Math.round(random() * 3700 * 1000) / 1000 - 20;
    assert.deepEqual(findActiveHtmlSubtitleCues(index, time).activeCues, filterActive(cues, time));
  }
  [99.999, 100, 100.0005, 100.001, 101, 103.999, 104].forEach((time) => {
    assert.deepEqual(
      findActiveHtmlSubtitleCues(index, time).activeCues,
      filterActive(cues, time),
      `t=${time}`
    );
  });
});

test("the next boundary is the earliest end of an active cue or the next cue start", () => {
  const cues = [
    { start: 1, end: 3, text: "a" },
    { start: 2, end: 6, text: "b" },
    { start: 5, end: 7, text: "c" },
    { start: 10, end: 12, text: "d" }
  ];
  const index = buildHtmlSubtitleCueIndex(cues);
  const at = (time) => findActiveHtmlSubtitleCues(index, time);
  assert.equal(at(0).nextBoundarySeconds, 1, "idle before the first cue: wake at its start");
  assert.equal(at(1).nextBoundarySeconds, 2, "a active: b starts before a ends");
  assert.equal(at(2.5).nextBoundarySeconds, 3, "a and b active: a ends first");
  assert.equal(at(3).nextBoundarySeconds, 5, "b active: c starts before b ends");
  assert.equal(at(6.5).nextBoundarySeconds, 7, "c active and nothing starts before it ends");
  assert.equal(at(8).nextBoundarySeconds, 10, "gap: wake at d");
  assert.equal(at(11).nextBoundarySeconds, 12);
  assert.equal(
    at(12).nextBoundarySeconds,
    Infinity,
    "after the last cue there is nothing to wait for"
  );
  assert.deepEqual(at(12).activeCues, []);
});

test("cues with non-numeric bounds are never active and empty input is safe", () => {
  const cues = [
    { start: NaN, end: 5, text: "bad start" },
    { start: 1, end: "x", text: "bad end" },
    null,
    { start: 1, end: 2, text: "ok" }
  ];
  const index = buildHtmlSubtitleCueIndex(cues);
  assert.deepEqual(findActiveHtmlSubtitleCues(index, 1.5).activeCues, [cues[3]]);
  assert.deepEqual(findActiveHtmlSubtitleCues(buildHtmlSubtitleCueIndex([]), 1), {
    activeCues: [],
    nextBoundarySeconds: Infinity
  });
  assert.deepEqual(findActiveHtmlSubtitleCues(null, 1), {
    activeCues: [],
    nextBoundarySeconds: Infinity
  });
  assert.deepEqual(findActiveHtmlSubtitleCues(index, NaN).activeCues, []);
});

test("the index keeps a reference to the array it was built from", () => {
  const cues = [{ start: 0, end: 1, text: "a" }];
  const index = buildHtmlSubtitleCueIndex(cues);
  assert.equal(index.cues, cues);
});
