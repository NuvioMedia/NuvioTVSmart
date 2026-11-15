import test from "node:test";
import assert from "node:assert/strict";

import { continueWatchingClickOpensDetails } from "../js/ui/screens/home/continueWatchingClickAction.js";

const inProgress = { contentId: "tt1", isNextUp: false };
const airedNextUp = { contentId: "tt2", isNextUp: true, hasAired: true };
const upcomingNextUp = { contentId: "tt3", isNextUp: true, hasAired: false };

test("Open Stream keeps the stream for every card", () => {
  for (const item of [inProgress, airedNextUp, upcomingNextUp]) {
    assert.equal(continueWatchingClickOpensDetails("STREAM", item), false);
  }
});

test("Open Details opens details for every card", () => {
  for (const item of [inProgress, airedNextUp, upcomingNextUp]) {
    assert.equal(continueWatchingClickOpensDetails("DETAILS", item), true);
  }
});

test("Details for Upcoming Only opens details only for unaired next-up episodes", () => {
  assert.equal(continueWatchingClickOpensDetails("DETAILS_FOR_UPCOMING", inProgress), false);
  assert.equal(continueWatchingClickOpensDetails("DETAILS_FOR_UPCOMING", airedNextUp), false);
  assert.equal(continueWatchingClickOpensDetails("DETAILS_FOR_UPCOMING", upcomingNextUp), true);
});

test("an unknown stored value falls back to the stream, as on Android", () => {
  assert.equal(continueWatchingClickOpensDetails("bogus", upcomingNextUp), false);
  assert.equal(continueWatchingClickOpensDetails(undefined, upcomingNextUp), false);
});
