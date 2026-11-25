import assert from "node:assert/strict";
import test from "node:test";

// The collection helpers build their storage-backed dependencies on import.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { normalizeItem, buildHeroDisplay, sourceType, buildFolderSourceRows } =
  await import("../js/ui/screens/collection/folderDetailScreenHelpers-01-tmdb-api-url.js");
const { mapTmdbListItem } =
  await import("../js/ui/screens/collection/folderDetailScreenHelpers-03-set-tmdb-discover-param.js");
const { mapTraktEntity } =
  await import("../js/ui/screens/collection/folderDetailScreenHelpers-04-map-trakt-entity.js");
const { formatContentTypeLabel } = await import("../js/ui/screens/home/homeUtils.js");
const { PlayerController } = await import("../js/core/player/playerController.js");

test("add-on collection items keep their tv type instead of becoming series", () => {
  const item = normalizeItem({ id: "tv-1", type: "tv", name: "Live TV Channel" });
  assert.equal(item.type, "tv");
  assert.equal(item.apiType, "tv");

  assert.equal(normalizeItem({ id: "s-1", type: "series", name: "Show" }).type, "series");
  assert.equal(normalizeItem({ id: "m-1", name: "Movie" }, "movie").type, "movie");
  assert.equal(normalizeItem({ id: "c-1", type: "channel", name: "Channel" }).type, "channel");
});

test("collection source type keeps an add-on's tv catalog while TMDB/Trakt shows stay series", () => {
  assert.equal(sourceType({ type: "tv" }), "tv");
  assert.equal(sourceType({ type: "TV" }), "tv");
  assert.equal(sourceType({ type: "series" }), "series");
  assert.equal(sourceType({ mediaType: "TV" }), "series");
  assert.equal(sourceType({ mediaType: "SERIES" }), "series");
  assert.equal(sourceType({}), "movie");

  const rows = buildFolderSourceRows([
    { key: "addon-tv", source: { type: "tv" }, items: [] },
    { key: "tmdb-tv", source: { provider: "tmdb", mediaType: "TV" }, items: [] }
  ]);
  assert.deepEqual(
    rows.map((row) => row.type),
    ["tv", "series"]
  );
});

test("collection hero and row labels show TV for tv items and Series for shows", () => {
  const tvHero = buildHeroDisplay({ id: "tv-1", type: "tv", name: "Live TV Channel" });
  assert.ok(tvHero.meta.includes("TV"));
  assert.ok(!tvHero.meta.includes("Series"));

  assert.ok(buildHeroDisplay({ id: "s-1", type: "series", name: "Show" }).meta.includes("Series"));
  assert.ok(buildHeroDisplay({ id: "m-1", type: "movie", name: "Movie" }).meta.includes("Movie"));
});

test("TMDB and Trakt collection mappers keep mapping their TV media to series", () => {
  assert.equal(mapTmdbListItem({ id: 42, name: "TMDB Show" }, "tv").type, "series");
  assert.equal(mapTraktEntity({ title: "Trakt Show", ids: { trakt: 99 } }, "show").type, "series");
});

test("content type labels expose TV without changing the series label", () => {
  assert.equal(formatContentTypeLabel("tv"), "TV");
  assert.equal(formatContentTypeLabel("show"), "Series");
  assert.equal(formatContentTypeLabel("series"), "Series");
  assert.equal(formatContentTypeLabel("movie"), "Movie");
});

test("a preserved tv item takes the live playback pipeline, a series item does not", () => {
  PlayerController.currentSeason = null;
  PlayerController.currentEpisode = null;
  assert.equal(PlayerController.isLivePlaybackItemType("tv"), true);
  assert.equal(PlayerController.isLivePlaybackItemType("series"), false);

  PlayerController.currentSeason = 1;
  PlayerController.currentEpisode = 2;
  assert.equal(
    PlayerController.isLivePlaybackItemType("tv"),
    false,
    "an episodic tv item is not a live channel"
  );
});
