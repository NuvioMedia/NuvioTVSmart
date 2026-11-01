import test from "node:test";
import assert from "node:assert/strict";

import {
  chapterSkipIntervals,
  mergeSkipIntervals
} from "../js/core/player/chapterSkipIntervals.js";

const durationMs = 24 * 60_000;
const chapters = (...entries) => entries.map(([startMs, title]) => ({ startMs, title }));

test("OP chapter produces an intro interval", () => {
  const intervals = chapterSkipIntervals(
    chapters([0, "Prologue"], [90_000, "OP"], [180_000, "Episode"], [1_320_000, "ED"]),
    durationMs
  );
  const opening = intervals.find((interval) => interval.type === "intro");
  assert.equal(opening.startTime, 90);
  assert.equal(opening.endTime, 180);
  assert.equal(opening.provider, "chapters");
});

test("Opening, ED, recap, Intro promotion and demotion", () => {
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Cold Open"], [120_000, "Opening"], [210_000, "Part A"]),
      durationMs
    ).find((interval) => interval.type === "intro").startTime,
    120
  );
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Episode"], [1_300_000, "ED"], [1_390_000, "Preview"]),
      durationMs
    ).find((interval) => interval.type === "outro").startTime,
    1_300
  );
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Previously on..."], [60_000, "OP"], [150_000, "Episode"]),
      durationMs
    ).find((interval) => interval.type === "recap").startTime,
    0
  );
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Intro"], [90_000, "Episode"], [1_320_000, "Credits"]),
      durationMs
    ).find((interval) => interval.type === "intro").startTime,
    0
  );
  const demoted = chapterSkipIntervals(
    chapters([0, "Intro"], [60_000, "OP"], [150_000, "Episode"], [1_320_000, "ED"]),
    durationMs
  ).filter((interval) => interval.type === "intro");
  assert.equal(demoted.length, 1);
  assert.equal(demoted[0].startTime, 60);
});

test("unknown, short, long and scene-named chapters are ignored", () => {
  assert.deepEqual(
    chapterSkipIntervals(
      chapters([0, "Chapter 1"], [300_000, "Chapter 2"], [600_000, "Chapter 3"]),
      durationMs
    ),
    []
  );
  assert.deepEqual(chapterSkipIntervals(chapters([0, "OP"]), durationMs), []);
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Episode"], [1_300_000, "OP"], [1_302_000, "Part B"]),
      durationMs
    ).some((interval) => interval.type === "intro"),
    false
  );
  assert.equal(
    chapterSkipIntervals(chapters([0, "OP"], [300_000, "Episode"]), durationMs).some(
      (interval) => interval.type === "intro"
    ),
    false
  );
  assert.deepEqual(
    chapterSkipIntervals(
      chapters(
        [0, "The Opening"],
        [600_000, "The Journey"],
        [1_200_000, "The Ending"],
        [1_500_000, "Alternate Ending"]
      ),
      1_800_000
    ),
    []
  );
  assert.deepEqual(
    chapterSkipIntervals(chapters([0, "Ed arrives"], [300_000, "The battle"]), 600_000),
    []
  );
});

test("post-credits and mid-credits scenes are excluded", () => {
  const intervals = chapterSkipIntervals(
    chapters([0, "Movie"], [5_520_000, "Credits"], [5_700_000, "Post-Credits Scene"]),
    6_000_000
  );
  assert.equal(
    intervals.some((interval) => interval.startTime === 5_700),
    false
  );
  assert.equal(
    intervals.some((interval) => interval.type === "outro" && interval.startTime === 5_520),
    true
  );
  const mid = chapterSkipIntervals(
    chapters(
      [0, "Movie"],
      [5_520_000, "Credits"],
      [5_600_000, "Mid-Credits Scene"],
      [5_700_000, "More Credits"]
    ),
    6_000_000
  );
  assert.equal(
    mid.some((interval) => interval.startTime === 5_600),
    false
  );
});

test("case-insensitive labels, OP suffix and last chapter duration", () => {
  const intervals = chapterSkipIntervals(
    chapters(
      [0, "RECAP"],
      [60_000, "opening"],
      [150_000, "episode"],
      [1_300_000, "Ending Credits"]
    ),
    durationMs
  );
  assert.equal(intervals.length, 3);
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Prologue"], [90_000, "OP 2"], [180_000, "Episode"]),
      durationMs
    ).some((interval) => interval.type === "intro"),
    true
  );
  assert.equal(
    chapterSkipIntervals(
      chapters([0, "Cold Open"], [90_000, "Opening Theme"], [180_000, "Episode"]),
      durationMs
    ).some((interval) => interval.type === "intro"),
    true
  );
  const last = chapterSkipIntervals(chapters([0, "Episode"], [1_200_000, "ED"]), durationMs).find(
    (interval) => interval.type === "outro"
  );
  assert.equal(last.endTime, durationMs / 1000);
});

test("merge prefers chapters by category and keeps unknown API intervals", () => {
  const api = [
    { startTime: 10, endTime: 20, type: "intro", provider: "introdb" },
    { startTime: 30, endTime: 40, type: "outro", provider: "introdb" },
    { startTime: 50, endTime: 60, type: "post-credits", provider: "introdb" }
  ];
  const chapter = [
    { startTime: 12, endTime: 22, type: "intro", provider: "chapters" },
    { startTime: 32, endTime: 42, type: "recap", provider: "chapters" }
  ];
  assert.deepEqual(
    mergeSkipIntervals(api, chapter).map((interval) => interval.provider + ":" + interval.type),
    ["chapters:intro", "chapters:recap", "introdb:outro", "introdb:post-credits"]
  );
  assert.equal(mergeSkipIntervals(api, chapter, true), api);
  assert.deepEqual(mergeSkipIntervals(api, []), api);
  assert.deepEqual(mergeSkipIntervals([], chapter), chapter);
  assert.deepEqual(mergeSkipIntervals([], chapter, true), chapter);
});
