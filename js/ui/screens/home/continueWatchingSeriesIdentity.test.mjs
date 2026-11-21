import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeContinueWatchingInProgress,
  isServerContentId,
  resolveContinueWatchingSeriesContentId
} from "./continueWatchingSeriesIdentity.js";

test("recognizes media-server content ids", () => {
  assert.equal(isServerContentId("server:conn-1:70312"), true);
  assert.equal(isServerContentId("tt1234"), false);
  assert.equal(isServerContentId(""), false);
});

test("an episode id resolved by its series metadata becomes the series id", () => {
  assert.equal(
    resolveContinueWatchingSeriesContentId("server:conn-1:70848", { id: "server:conn-1:70312" }),
    "server:conn-1:70312"
  );
});

test("other identities are left untouched", () => {
  assert.equal(resolveContinueWatchingSeriesContentId("tt1234", { id: "tt1234" }), "tt1234");
  assert.equal(
    resolveContinueWatchingSeriesContentId("tt1234", { id: "server:conn-1:70312" }),
    "tt1234"
  );
  assert.equal(
    resolveContinueWatchingSeriesContentId("server:conn-1:70312", { id: "server:conn-1:70312" }),
    "server:conn-1:70312"
  );
  assert.equal(
    resolveContinueWatchingSeriesContentId("server:conn-1:70312", {}),
    "server:conn-1:70312"
  );
});

test("one in-progress card per series keeps the newest episode", () => {
  const items = [
    {
      contentId: "server:conn-1:70312",
      contentType: "series",
      season: 5,
      episode: 23,
      updatedAt: 20
    },
    {
      contentId: "server:conn-1:70312",
      contentType: "series",
      season: 5,
      episode: 24,
      updatedAt: 40
    },
    { contentId: "server:conn-1:900", contentType: "movie", updatedAt: 10 }
  ];
  assert.deepEqual(
    dedupeContinueWatchingInProgress(items).map((item) => [
      item.contentId,
      item.season,
      item.episode
    ]),
    [
      ["server:conn-1:900", undefined, undefined],
      ["server:conn-1:70312", 5, 24]
    ]
  );
});

test("different series and non-series cards are not merged", () => {
  const items = [
    { contentId: "server:conn-1:S1", contentType: "series", updatedAt: 30 },
    { contentId: "server:conn-1:S2", contentType: "series", updatedAt: 20 },
    { contentId: "server:conn-1:M1", contentType: "movie", updatedAt: 10 }
  ];
  assert.equal(dedupeContinueWatchingInProgress(items).length, 3);
});
