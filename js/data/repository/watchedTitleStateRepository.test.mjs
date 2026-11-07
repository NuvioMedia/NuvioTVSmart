import assert from "node:assert/strict";
import { test } from "node:test";

// Keep the module graph on the same synthetic storage used by the app tests.
if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
}
globalThis.__NUVIO_ENV__ = {};

const [
  { watchedTitleStateRepository },
  { watchedItemsRepository },
  { metaRepository },
  { TraktAuthService }
] = await Promise.all([
  import("./watchedTitleStateRepository.js"),
  import("./watchedItemsRepository.js"),
  import("./metaRepository.js"),
  import("./traktAuthService.js")
]);
const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { watchedItemsShareIdentity } = await import("./watchedIdentity.js");

const SERIES = { id: "tt100", type: "series", name: "Fixture Show", imdbId: "tt100" };

function episode(season, episodeNumber) {
  return {
    contentId: "tt100",
    contentType: "series",
    ids: { imdb: "tt100", tmdb: 100 },
    imdbId: "tt100",
    tmdbId: 100,
    season,
    episode: episodeNumber
  };
}

const MAIN_EPISODES = [
  ...Array.from({ length: 6 }, (_, index) => episode(1, index + 1)),
  ...Array.from({ length: 5 }, (_, index) => episode(2, index + 1))
];

const META = {
  id: "tt100",
  type: "series",
  name: "Fixture Show",
  videos: [
    ...[1, 2, 3, 4, 5, 6].map((episodeNumber) => ({
      id: `tt100:1:${episodeNumber}`,
      season: 1,
      episode: episodeNumber,
      released: "2020-01-01"
    })),
    ...[1, 2, 3, 4, 5].map((episodeNumber) => ({
      id: `tt100:2:${episodeNumber}`,
      season: 2,
      episode: episodeNumber,
      released: "2021-01-01"
    })),
    { id: "tt100:0:1", season: 0, episode: 1, released: "2019-01-01" },
    { id: "tt100:0:2", season: 0, episode: 2, released: "2019-02-01" },
    // An unaired season must not keep the badge away.
    { id: "tt100:3:1", season: 3, episode: 1, released: "2999-01-01" }
  ]
};

function installFixtures(t, { watched, meta = META, remoteShows = null }) {
  TraktSettingsStore.setWatchProgressSource(
    remoteShows ? WatchProgressSource.TRAKT : WatchProgressSource.MDBLIST
  );
  const originalGetAll = watchedItemsRepository.getAll;
  const originalGetRemoteShows = watchedItemsRepository.getRemoteTraktWatchedShows;
  const originalGetMeta = metaRepository.getMetaFromAllAddons;
  const originalIsAuthenticated = TraktAuthService.isAuthenticated;
  watchedItemsRepository.getAll = async () => watched;
  watchedItemsRepository.getRemoteTraktWatchedShows = async () => remoteShows || [];
  metaRepository.getMetaFromAllAddons = async () =>
    meta ? { status: "success", data: meta } : { status: "error" };
  TraktAuthService.isAuthenticated = async () => Boolean(remoteShows);
  t.after(() => {
    watchedItemsRepository.getAll = originalGetAll;
    watchedItemsRepository.getRemoteTraktWatchedShows = originalGetRemoteShows;
    metaRepository.getMetaFromAllAddons = originalGetMeta;
    TraktAuthService.isAuthenticated = originalIsAuthenticated;
  });
}

function traktShow() {
  return {
    contentId: "tt100",
    title: "Fixture Show",
    imdbId: "tt100",
    tmdbId: 100,
    seasons: [
      { number: 0, episodes: [{ number: 1, plays: 0 }] },
      {
        number: 1,
        episodes: [1, 2, 3, 4, 5, 6].map((number) => ({ number, plays: 1 }))
      },
      {
        number: 2,
        episodes: [1, 2, 3, 4, 5].map((number) => ({ number, plays: 1 }))
      }
    ]
  };
}

test("a series whose main episodes are watched gets a badge without its specials", async (t) => {
  installFixtures(t, { watched: MAIN_EPISODES });

  const items = await watchedTitleStateRepository.getTitleWatchedItems([SERIES], {
    baseWatchedItems: MAIN_EPISODES
  });

  const marker = items.find(
    (item) => item.season == null && item.episode == null && watchedItemsShareIdentity(item, SERIES)
  );
  assert.ok(marker, "fully watched series should get a root marker");
});

test("an incomplete series drops a stale root marker", async (t) => {
  const watched = MAIN_EPISODES.filter((item) => !(item.season === 2 && item.episode === 5));
  const staleMarker = {
    contentId: "tt100",
    contentType: "series",
    title: "Fixture Show",
    imdbId: "tt100",
    season: null,
    episode: null
  };
  installFixtures(t, { watched: [...watched, staleMarker] });

  const items = await watchedTitleStateRepository.getTitleWatchedItems([SERIES], {
    baseWatchedItems: [...watched, staleMarker]
  });

  assert.equal(
    items.some(
      (item) =>
        item.season == null && item.episode == null && watchedItemsShareIdentity(item, SERIES)
    ),
    false,
    "a partially watched series must not keep the badge"
  );
});

test("the Trakt projection still ignores specials and unaired seasons", async (t) => {
  installFixtures(t, { watched: MAIN_EPISODES, remoteShows: [traktShow()] });

  const items = await watchedTitleStateRepository.getTitleWatchedItems([SERIES], {
    baseWatchedItems: MAIN_EPISODES
  });

  assert.ok(
    items.some(
      (item) =>
        item.season == null && item.episode == null && watchedItemsShareIdentity(item, SERIES)
    )
  );
});

test("specials alone never mark a series as watched", async (t) => {
  const specials = [episode(0, 1), episode(0, 2)];
  installFixtures(t, { watched: specials });

  const items = await watchedTitleStateRepository.getTitleWatchedItems([SERIES], {
    baseWatchedItems: specials
  });

  assert.equal(
    items.some(
      (item) =>
        item.season == null && item.episode == null && watchedItemsShareIdentity(item, SERIES)
    ),
    false
  );
});
