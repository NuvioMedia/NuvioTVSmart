import assert from "node:assert/strict";

const QUOTA = 3 * 1024 * 1024;
const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (index) => [...storage.keys()][index],
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    let total = value.length;
    for (const [existingKey, existingValue] of storage)
      if (existingKey !== key) total += existingValue.length;
    if (total > QUOTA) {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    }
    storage.set(key, value);
  },
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = { MDBLIST_CLIENT_ID: "fixture" };

const { LocalStore } = await import("../js/core/storage/localStore.js");
const { MdbListAccount: account } = await import("../js/data/repository/mdbListAccount.js");
const { MdbListTracking: tracking } = await import("../js/data/repository/mdbListTracking.js");
const now = "2026-11-09T18:12:24.806Z";
LocalStore.set("mdbListAccounts", {
  1: {
    generation: "g",
    user: { id: 7 },
    tokens: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600000 }
  }
});

// A large imported history: 400 shows with 30 watched episodes each.
const shows = [];
for (let show = 1; show <= 400; show++) {
  const episodes = [];
  for (let episode = 1; episode <= 30; episode++)
    episodes.push({ number: episode, watched_at: now });
  shows.push({
    show: {
      title: `Show number ${show} with a reasonably long title`,
      year: 2020,
      ids: {
        imdb: `tt${100000 + show}`,
        tmdb: 100000 + show,
        tvdb: 200000 + show,
        trakt: 300000 + show,
        mdblist: `mdb-${show}`
      },
      poster: `https://image.tmdb.org/t/p/w500/abcdefghijklmnopqrstuvwxyz${show}.jpg`,
      backdrop: `https://image.tmdb.org/t/p/w1280/abcdefghijklmnopqrstuvwxyz${show}.jpg`,
      runtime: 45
    },
    watched_at: now,
    seasons: [{ number: 1, episodes }]
  });
}
account.api = async (scope, path) => {
  account.check(scope);
  if (path === "/sync/last_activities")
    return {
      payload: {
        server_time: now,
        watched_at: now,
        episode_watched_at: now,
        journal_at: now,
        paused_at: null,
        dropped_at: null
      },
      headers: new Headers()
    };
  if (path === "/sync/watched")
    return {
      payload: {
        movies: [],
        shows,
        seasons: [],
        episodes: [],
        pagination: { limit: 1000, next_cursor: null }
      },
      headers: new Headers()
    };
  if (path === "/sync/playback") return { payload: [], headers: new Headers() };
  if (path === "/sync/dropped") return { payload: { shows: [] }, headers: new Headers() };
  if (path === "/sync/seasons/dropped") return { payload: { seasons: [] }, headers: new Headers() };
  throw new Error(path);
};

assert.equal(await tracking.refresh({ force: true, strict: true }), true);
const raw = localStorage.getItem("mdbListTracking");
assert(raw.length < QUOTA, `snapshot is ${raw.length} bytes`);
const packed = JSON.parse(raw)["1"];
assert.equal(packed.schemaVersion, 2);
assert.equal(packed.watched.length, 12400);
assert.equal(Object.keys(packed.media).length, 400);
assert.equal(packed.watched[0].media, undefined);
assert.equal(packed.watched[0].mediaKey, "show:tt100001");
assert.equal(packed.media["show:tt100001"].ids.imdb, "tt100001");

const { MdbListTracking: reloadedTracking } =
  await import("../js/data/repository/mdbListTracking.js?storage-compaction=1");
const snapshot = reloadedTracking.getSnapshot();
assert.equal(snapshot.watched.length, 12400);
assert.equal(snapshot.watched[0].media.ids.imdb, "tt100001");
assert.equal(snapshot.watched[1].media, snapshot.watched[0].media);

const scope = account.scope();
LocalStore.set("mdbListTracking", {
  1: {
    schemaVersion: 1,
    generation: scope.generation,
    accountId: 7,
    watched: [{ type: "movie", media: { ids: { imdb: "tt999999" } }, updatedAt: 1 }],
    playback: [],
    dropped: [],
    checkedAt: 1,
    initialized: true,
    invalidated: false
  }
});
const { MdbListTracking: legacyTracking } =
  await import("../js/data/repository/mdbListTracking.js?storage-migration=1");
assert.equal(legacyTracking.getSnapshot().watched[0].media.ids.imdb, "tt999999");
console.log(
  `MDBList storage compaction passed: 12,400 watched rows packed into ${raw.length} bytes under a 3 MB quota.`
);
