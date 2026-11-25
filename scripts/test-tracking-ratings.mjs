import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { decodeMdbUserRatings, mdbRatingFailures } =
  await import("../js/data/repository/mdbListTrackingCodec.js");
const { mdbRatingPayload } = await import("../js/data/repository/mdbListTracking.js");
const { simklRatingBody, simklNotFoundCount } =
  await import("../js/data/repository/simklSyncService.js");
const { TraktSettingsStore, normalizeRatingSource } =
  await import("../js/data/local/traktSettingsStore.js");
const { trakt_settings } =
  await import("../js/core/profile/profileSettingsSyncFeature-trakt-settings.js");

// Android MdbListUserRatingsTest / decodeMdbListUserRatings (6055873d4).
test("MDBList ratings decode movies, shows, seasons and episodes and skip unreadable rows", () => {
  const records = decodeMdbUserRatings({
    movies: [
      {
        rating: 8,
        rated_at: "2026-11-10T10:00:00Z",
        movie: { ids: { imdb: "tt0111161", tmdb: 278 }, title: "Shawshank" }
      }
    ],
    shows: [
      { rating_precise: 7.5, rated_at: "2026-11-10T10:00:00Z", show: { ids: { tmdb: 1399 } } }
    ],
    seasons: [
      {
        rating: 6,
        rated_at: "2026-11-10T10:00:00Z",
        season: { number: 2 },
        show: { ids: { tmdb: 1399 } }
      }
    ],
    episodes: [
      {
        rating: 9,
        rated_at: "2026-11-10T10:00:00Z",
        episode: { season: 1, number: 3, ids: { tmdb: 63058 } },
        show: { ids: { tmdb: 1399 } }
      },
      {
        rating: 11,
        rated_at: "2026-11-10T10:00:00Z",
        episode: { season: 1, number: 4 },
        show: { ids: { tmdb: 1399 } }
      },
      { rating: 5, episode: { season: 1, number: 5 }, show: { ids: { tmdb: 1399 } } }
    ]
  });
  assert.deepEqual(
    records.map((row) => [row.type, row.rating, row.season, row.episode, row.episodeTmdbId]),
    [
      ["movie", 8, null, null, null],
      ["show", 7.5, null, null, null],
      ["season", 6, 2, null, null],
      ["episode", 9, 1, 3, 63058]
    ]
  );
  assert.throws(() => decodeMdbUserRatings({ pagination: {} }));
  assert.equal(mdbRatingFailures({ not_found: { movies: [{}], shows: 2 }, errors: [{}] }), 4);
  assert.equal(mdbRatingFailures({ added: { movies: 1 } }), 0);
});

test("MDBList rating payload follows Android's buckets", () => {
  const media = { ids: { imdb: "tt1", tmdb: 10 } };
  assert.deepEqual(mdbRatingPayload({ type: "movie", media }, 8), {
    movies: [{ ids: media.ids, rating: 8 }]
  });
  assert.deepEqual(mdbRatingPayload({ type: "show", media }, null), {
    shows: [{ ids: media.ids }]
  });
  assert.deepEqual(
    mdbRatingPayload({ type: "episode", media, season: 1, episode: 2, episodeTmdbId: 77 }, 6),
    {
      episodes: [{ ids: { tmdb: 77 }, rating: 6 }]
    }
  );
  assert.deepEqual(mdbRatingPayload({ type: "episode", media, season: 1, episode: 2 }, 6), {
    shows: [{ ids: media.ids, seasons: [{ number: 1, episodes: [{ number: 2, rating: 6 }] }] }]
  });
});

// Android SimklRatingsTest (6f9754b46).
test("Simkl rating body picks the bucket from the library entry, anime removals go to shows", () => {
  const item = { itemId: "tt123", itemType: "series", imdbId: "tt123", title: "Show", year: 2020 };
  assert.deepEqual(simklRatingBody(item, null, 8), {
    shows: [{ rating: 8, title: "Show", year: 2020, ids: { imdb: "tt123" } }]
  });
  const anime = { mediaType: "anime", show: { title: "Anime", ids: { simkl: 5, mal: 9 } } };
  assert.equal(Object.keys(simklRatingBody(item, anime, 9))[0], "anime");
  assert.equal(Object.keys(simklRatingBody(item, anime, null))[0], "shows");
  assert.equal(Object.keys(simklRatingBody({ ...item, itemType: "movie" }, null, 7))[0], "movies");
  assert.equal(simklNotFoundCount({ not_found: { movies: [{}], shows: [] } }), 1);
  assert.equal(simklNotFoundCount({ added: {} }), 0);
});

test("the rating source is per profile, Simkl or MDBList, and syncs as Android's rating_source", () => {
  assert.equal(normalizeRatingSource("SIMKL"), "simkl");
  assert.equal(normalizeRatingSource("trakt"), null);
  assert.equal(TraktSettingsStore.get().ratingSource, null);
  assert.equal("rating_source" in trakt_settings.export("1"), false);
  TraktSettingsStore.setRatingSource("mdblist");
  assert.equal(trakt_settings.export("1").rating_source, "mdblist");
  trakt_settings.import("1", { more_like_this_source: "TRAKT" });
  assert.equal(
    TraktSettingsStore.get().ratingSource,
    null,
    "a blob without rating_source turns it off"
  );
  trakt_settings.import("1", { more_like_this_source: "TRAKT", rating_source: "simkl" });
  assert.equal(TraktSettingsStore.get().ratingSource, "simkl");
});
