import test from "node:test";
import assert from "node:assert/strict";

import { moviePostPlayTriggerSeconds } from "../js/core/player/skipIntervalRules.js";

const base = { durationSeconds: 6000, movieThresholdPercent: 90 };

test("an End Credits chapter in the second half times the movie recommendation", () => {
  const trigger = moviePostPlayTriggerSeconds({
    ...base,
    skipIntervals: [{ type: "outro", startTime: 5700, endTime: 6000 }]
  });
  assert.equal(trigger, 5700);
});

test("an opening Credits chapter is not taken for the end credits", () => {
  const trigger = moviePostPlayTriggerSeconds({
    ...base,
    skipIntervals: [{ type: "outro", startTime: 60, endTime: 180 }]
  });
  assert.equal(trigger, 5400);
});

test("IntroDB movie-credits keep counting anywhere", () => {
  const trigger = moviePostPlayTriggerSeconds({
    ...base,
    skipIntervals: [{ type: "movie-credits", startTime: 5650, endTime: 6000 }]
  });
  assert.equal(trigger, 5650);
});
