import assert from "node:assert/strict";
import { test } from "node:test";

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

const { deduplicateInProgress } = await import("./watchProgressRepository.js");

test("deduplicateInProgress keeps only the newest entry for an unfinished movie appearing multiple times (#1815)", () => {
  const movieItems = [
    {
      contentId: "tt1234567",
      contentType: "movie",
      positionMs: 3000,
      durationMs: 6000,
      updatedAt: 1000,
      source: "trakt_local"
    },
    {
      contentId: "tt1234567",
      contentType: "movie",
      positionMs: 4500,
      durationMs: 6000,
      updatedAt: 2000,
      source: "trakt_playback"
    }
  ];

  const result = deduplicateInProgress(movieItems);
  assert.equal(result.length, 1, "Movie should appear only once in Continue Watching");
  assert.equal(result[0].updatedAt, 2000, "Newest in-progress state should be preserved");
  assert.equal(result[0].source, "trakt_playback");
});

test("deduplicateInProgress deduplicates movies across cross-referenced identifiers (IMDb vs TMDB)", () => {
  const items = [
    {
      contentId: "tt9999999",
      contentType: "movie",
      imdbId: "tt9999999",
      tmdbId: 88888,
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 300,
      source: "trakt_local"
    },
    {
      contentId: "tmdb:88888",
      contentType: "movie",
      tmdbId: 88888,
      positionMs: 1500,
      durationMs: 5000,
      updatedAt: 150,
      source: "trakt_playback"
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].contentId, "tt9999999");
  assert.equal(result[0].updatedAt, 300);
});

test("deduplicateInProgress keeps different unfinished movies as separate cards", () => {
  const items = [
    {
      contentId: "tt1111111",
      contentType: "movie",
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 200
    },
    {
      contentId: "tt2222222",
      contentType: "movie",
      positionMs: 1000,
      durationMs: 5000,
      updatedAt: 100
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((item) => item.contentId),
    ["tt1111111", "tt2222222"]
  );
});

test("deduplicateInProgress isolates movie identities from series identities", () => {
  const items = [
    {
      contentId: "shared-id-123",
      contentType: "series",
      season: 1,
      episode: 1,
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 200
    },
    {
      contentId: "shared-id-123",
      contentType: "movie",
      positionMs: 1500,
      durationMs: 5000,
      updatedAt: 100
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 2, "Series and movie with shared contentId should both survive");
  assert.equal(result[0].contentType, "series");
  assert.equal(result[1].contentType, "movie");
});

test("deduplicateInProgress still deduplicates series to the newest episode", () => {
  const items = [
    {
      contentId: "tt3333333",
      contentType: "series",
      season: 1,
      episode: 1,
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 100
    },
    {
      contentId: "tt3333333",
      contentType: "series",
      season: 1,
      episode: 2,
      positionMs: 1000,
      durationMs: 5000,
      updatedAt: 300
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].episode, 2);
  assert.equal(result[0].updatedAt, 300);
});

test("deduplicateInProgress keeps one card per Cloud Library file", () => {
  const items = [
    {
      contentId: "realdebrid:torrent:pack-1",
      videoId: "realdebrid:torrent:pack-1:episode-1.mkv",
      contentType: "cloud",
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 200,
      source: "cloud_local"
    },
    {
      contentId: "realdebrid:torrent:pack-1",
      videoId: "realdebrid:torrent:pack-1:episode-2.mkv",
      contentType: "cloud",
      positionMs: 1500,
      durationMs: 5000,
      updatedAt: 100,
      source: "cloud_local"
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 2);
});

test("deduplicateInProgress keeps the newest movie state so a completed record hides a stale paused one", () => {
  const items = [
    {
      contentId: "tt4444444",
      contentType: "movie",
      positionMs: 2000,
      durationMs: 5000,
      updatedAt: 100,
      source: "trakt_playback"
    },
    {
      contentId: "tt4444444",
      contentType: "movie",
      positionMs: 5000,
      durationMs: 5000,
      updatedAt: 200,
      source: "trakt_local"
    }
  ];

  const result = deduplicateInProgress(items);
  assert.equal(result.length, 0);
});
