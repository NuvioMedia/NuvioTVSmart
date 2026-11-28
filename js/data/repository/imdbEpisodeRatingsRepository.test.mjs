import test from "node:test";
import assert from "node:assert/strict";

// The repository reads the runtime env when it is imported, so the base URL has
// to be in place first. The retired IMDb host is intentionally not configured.
globalThis.__NUVIO_ENV__ = {
  IMDB_RATINGS_API_BASE_URL: "https://seriesgraph.com/"
};

const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  return {
    ok: true,
    json: async () => [
      {
        season_number: 1,
        episodes: [
          {
            season_number: 1,
            episode_number: 1,
            vote_average: 8.9,
            air_date: "2011-04-17"
          }
        ]
      }
    ]
  };
};

const { imdbEpisodeRatingsRepository } = await import("./imdbEpisodeRatingsRepository.js");
const addonEpisodes = [{ season: 1, episode: 1, released: "2011-04-17T00:00:00.000Z" }];

test("episode ratings come from the configured provider and are cached", async () => {
  const ratings = await imdbEpisodeRatingsRepository.getEpisodeRatings({
    imdbId: "tt0944947",
    tmdbId: 1399,
    addonEpisodes
  });
  assert.deepEqual(requests, ["https://seriesgraph.com/api/shows/1399/season-ratings"]);
  assert.deepEqual(ratings, { 1: [{ episode: 1, rating: 8.9 }] });

  await imdbEpisodeRatingsRepository.getEpisodeRatings({ tmdbId: 1399, addonEpisodes });
  assert.equal(requests.length, 1);
});

test("an IMDb id alone does not trigger a request", async () => {
  requests.length = 0;
  const ratings = await imdbEpisodeRatingsRepository.getEpisodeRatings({ imdbId: "tt0944948" });
  assert.deepEqual(requests, []);
  assert.deepEqual(ratings, {});
});
