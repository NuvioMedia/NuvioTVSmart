import test from "node:test";
import assert from "node:assert/strict";

import {
  continueWatchingCardsAwaitingNextUp,
  isNoNextUpStillConfirmed,
  nextContinueWatchingReleaseMs,
  noNextUpRecheckAt,
  NO_NEXT_UP_RECHECK_MS,
  stabilizeImmediateContinueWatchingItems,
  withSeriesFieldsFrom
} from "../js/ui/screens/home/continueWatchingStability.js";

test("a card that moves on keeps its series fields, not its episode fields", () => {
  const shown = {
    contentId: "tt1",
    title: "The Show",
    poster: "p.jpg",
    logo: "l.png",
    genres: ["Drama"],
    episodeTitle: "Old"
  };
  const raw = {
    contentId: "tt1",
    title: "the-show-simkl",
    episodeTitle: "New",
    season: 1,
    episode: 3
  };
  const result = withSeriesFieldsFrom(raw, shown);
  assert.equal(result.title, "The Show");
  assert.equal(result.poster, "p.jpg");
  assert.deepEqual(result.genres, ["Drama"]);
  assert.equal(result.episodeTitle, "New");
  assert.equal(result.episode, 3);
});

test("a series just finished stays while its next-up is rebuilt", () => {
  const shown = [{ contentId: "a" }, { contentId: "b" }, { contentId: "c" }];
  const awaiting = continueWatchingCardsAwaitingNextUp(
    shown,
    new Set(["a"]),
    new Set(["b", "c"]),
    new Set(["c"])
  );
  assert.deepEqual(
    awaiting.map((item) => item.contentId),
    ["b"]
  );
});

test("the first render keeps series fields and awaiting cards from the row on screen", () => {
  const items = stabilizeImmediateContinueWatchingItems({
    rawItems: [{ contentId: "a", title: "raw-a" }],
    shownItems: [
      { contentId: "a", title: "Show A" },
      { contentId: "b", title: "Show B", isNextUp: true }
    ],
    seededContentIds: new Set(["b"])
  });
  assert.deepEqual(
    items.map((item) => item.title),
    ["Show A", "Show B"]
  );
});

test("a series without a next episode is looked up again at its next release, at the latest after a day", () => {
  const now = 1_000_000;
  assert.equal(noNextUpRecheckAt(now + 3600_000, now), now + 3600_000);
  assert.equal(
    noNextUpRecheckAt(now + 5 * NO_NEXT_UP_RECHECK_MS, now),
    now + NO_NEXT_UP_RECHECK_MS
  );
  assert.equal(noNextUpRecheckAt(null, now), now + NO_NEXT_UP_RECHECK_MS);
  assert.equal(isNoNextUpStillConfirmed(now + 1, now), true);
  assert.equal(isNoNextUpStillConfirmed(now, now), false);
  assert.equal(isNoNextUpStillConfirmed(undefined, now), false);
});

test("the next refresh is the earliest upcoming release or recheck still ahead", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const items = [
    { isNextUp: true, hasAired: false, released: "2026-11-20T00:00:00Z" },
    { isNextUp: true, hasAired: true, released: "2026-11-01T00:00:00Z" },
    { isNextUp: false, released: "2026-11-16T00:00:00Z" }
  ];
  assert.equal(nextContinueWatchingReleaseMs(items, [now + 1000, now - 5], now), now + 1000);
  assert.equal(nextContinueWatchingReleaseMs(items, [], now), Date.parse("2026-11-20T00:00:00Z"));
  assert.equal(nextContinueWatchingReleaseMs([], [], now), null);
});
