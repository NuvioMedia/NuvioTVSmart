import test from "node:test";
import assert from "node:assert/strict";
import {
  alignEpisodeRatings,
  addonEpisodeAirDates
} from "../js/data/repository/episodeRatingsAlignment.js";
import { mapExternalEpisodes } from "../js/data/repository/imdbEpisodeRatingsRepository.js";

// Port of Android EpisodeRatingsAlignmentTest (e2ecb1c5f).
const DAY_MS = 86400000;
const epochDay = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const plusWeeks = (date, weeks) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
const video = (season, episode, released) => ({
  season,
  episode,
  released: released ? `${released}T00:00:00.000Z` : null
});
const external = (season, episode, airDate, rating) => ({ season, episode, airDate, rating });
const weeklyVideos = (season, count, start) =>
  Array.from({ length: count }, (_, index) => video(season, index + 1, plusWeeks(start, index)));
const weeklyExternal = (season, count, start, ratings) =>
  Array.from({ length: count }, (_, index) =>
    external(season, index + 1, plusWeeks(start, index), ratings[index])
  );
const asObject = (map) => Object.fromEntries([...map.entries()].sort());
const expected = (entries) =>
  Object.fromEntries(
    entries.map(([season, episode, rating]) => [`${season}:${episode}`, rating]).sort()
  );
const FAR_FUTURE = epochDay("2100-01-01");

test("same seasons keep their numbers", () => {
  const videos = [video(1, 1, "2020-01-01"), video(1, 2, "2020-01-08"), video(2, 1, "2020-06-01")];
  const ext = [
    external(1, 1, "2020-01-01", 7.0),
    external(1, 2, "2020-01-08", 7.5),
    external(1, 3, "2020-01-15", 8.0),
    external(2, 1, "2020-06-01", 8.5)
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [1, 2, 7.5],
      [1, 3, 8.0],
      [2, 1, 8.5]
    ])
  );
});

test("different totals are matched by air date", () => {
  const videos = [...weeklyVideos(1, 4, "2020-01-01"), ...weeklyVideos(2, 3, "2021-01-01")];
  const ext = [
    ...weeklyExternal(1, 2, "2020-01-01", [7.0, null]),
    ...weeklyExternal(2, 2, "2020-01-15", [7.2, 7.3]),
    ...weeklyExternal(3, 2, "2021-01-01", [8.0, 8.1])
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [1, 3, 7.2],
      [1, 4, 7.3],
      [2, 1, 8.0],
      [2, 2, 8.1]
    ])
  );
});

test("single cour entry is matched by air date instead of position", () => {
  const videos = weeklyVideos(1, 3, "2020-04-01");
  const ext = [
    ...weeklyExternal(1, 3, "2020-01-01", [6.0, 6.1, 6.2]),
    ...weeklyExternal(2, 3, "2020-04-01", [9.0, 9.1, 9.2])
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 9.0],
      [1, 2, 9.1],
      [1, 3, 9.2]
    ])
  );
});

test("equal totals follow the airing order", () => {
  const videos = [1, 2, 3, 4].map((episode) => video(1, episode, null));
  const ext = [
    external(1, 1, null, 7.0),
    external(1, 2, null, 7.1),
    external(2, 1, null, 7.2),
    external(2, 2, null, 7.3)
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [1, 2, 7.1],
      [1, 3, 7.2],
      [1, 4, 7.3]
    ])
  );
});

test("different totals without air dates keep their numbers", () => {
  const videos = [1, 2, 3].map((episode) => video(1, episode, null));
  const ext = [
    external(1, 1, null, 7.0),
    external(1, 2, null, 7.1),
    external(2, 1, null, 7.2),
    external(2, 2, null, 7.3)
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [1, 2, 7.1],
      [2, 1, 7.2],
      [2, 2, 7.3]
    ])
  );
});

test("unaired episodes are left out when comparing totals", () => {
  const videos = [...weeklyVideos(1, 3, "2020-01-01"), ...weeklyVideos(2, 2, "2020-01-22")];
  const ext = [
    ...weeklyExternal(1, 2, "2020-01-01", [7.0, 7.1]),
    external(2, 1, "2020-01-15", 7.2),
    external(3, 1, null, 7.3)
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, epochDay("2020-01-23"))),
    expected([
      [1, 1, 7.0],
      [1, 2, 7.1],
      [1, 3, 7.2],
      [2, 1, 7.3]
    ])
  );
});

test("episodes sharing an air date are paired in order", () => {
  const videos = [video(1, 1, "2020-01-01"), video(1, 2, "2020-01-01"), video(1, 3, "2020-01-08")];
  const ext = [
    external(1, 1, "2020-01-01", 7.0),
    external(1, 2, "2020-01-01", 7.1),
    external(2, 1, "2020-01-09", 7.2),
    external(2, 2, "2020-01-16", 7.3)
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [1, 2, 7.1],
      [1, 3, 7.2]
    ])
  );
});

test("specials keep their numbers when regular seasons are remapped", () => {
  const videos = [video(0, 1, "2019-12-01"), ...weeklyVideos(1, 2, "2020-01-01")];
  const ext = [
    external(0, 1, "2019-12-01", 6.5),
    ...weeklyExternal(1, 1, "2020-01-01", [7.0]),
    ...weeklyExternal(2, 1, "2020-01-08", [7.5])
  ];
  assert.deepEqual(
    asObject(alignEpisodeRatings(videos, ext, FAR_FUTURE)),
    expected([
      [0, 1, 6.5],
      [1, 1, 7.0],
      [1, 2, 7.5]
    ])
  );
});

test("missing videos keep external numbering", () => {
  const ext = [external(1, 1, "2020-01-01", 7.0), external(2, 1, "2020-06-01", 8.0)];
  assert.deepEqual(
    asObject(alignEpisodeRatings([], ext, FAR_FUTURE)),
    expected([
      [1, 1, 7.0],
      [2, 1, 8.0]
    ])
  );
});

test("the provider payload keeps unrated episodes and air dates for the alignment", () => {
  const episodes = mapExternalEpisodes([
    {
      episodes: [
        { season_number: 1, episode_number: 1, vote_average: 7.04, air_date: "2020-01-01" },
        { season_number: 1, episode_number: 2, vote_average: null, air_date: "2020-01-08" }
      ]
    }
  ]);
  assert.deepEqual(episodes, [
    { season: 1, episode: 1, airDate: "2020-01-01", rating: 7.0 },
    { season: 1, episode: 2, airDate: "2020-01-08", rating: null }
  ]);
  assert.deepEqual(addonEpisodeAirDates([{ season: 2, number: 3, released: "2021-01-01" }]), [
    { season: 2, episode: 3, released: "2021-01-01" }
  ]);
});
