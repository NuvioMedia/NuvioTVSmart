import test from "node:test";
import assert from "node:assert/strict";

// The server's "Continue watching" row returns Episode items. Opening one as a
// series asks /Shows/<episodeId>/Episodes, which is not a series, so the detail
// screen shows "No episodes found". Like the Android app, an episode in that row
// has to stand for its series: one card per series, with the series id.

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true
  });
}
globalThis.window = globalThis.window || {
  addEventListener: () => {},
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener: () => {} })
};
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  addEventListener: () => {},
  documentElement: { style: {} },
  body: {}
};

const { MediaServerRepository } = await import("../js/data/mediaserver/mediaServerRepository.js");
const { WatchProgressStore } = await import("../js/data/local/watchProgressStore.js");
const { WatchedItemsStore } = await import("../js/data/local/watchedItemsStore.js");

const connection = {
  id: "conn-1",
  providerId: "emby",
  address: "http://emby.local:8096",
  name: "Emby",
  remoteUserId: "user-1",
  token: "token",
  enabled: true,
  importWatchState: false,
  libraries: [
    { id: "lib-shows", name: "TV shows", kind: "series", selected: true },
    { id: "lib-movies", name: "Movies", kind: "movie", selected: true }
  ]
};

const episode = (id, seriesId, seriesName, season, number, extra = {}) => ({
  Id: id,
  Name: `Episode ${number}`,
  Type: "Episode",
  SeriesId: seriesId,
  SeriesName: seriesName,
  SeriesPrimaryImageTag: `tag-${seriesId}`,
  ParentIndexNumber: season,
  IndexNumber: number,
  ProviderIds: { IMDB: `tt-episode-${id}` },
  UserData: { PlaybackPositionTicks: 600000000, Played: false },
  ...extra
});
const seriesItem = (id, name) => ({
  Id: id,
  Name: name,
  Type: "Series",
  ProviderIds: { Imdb: `tt-series-${id}` },
  ImageTags: { Primary: `tag-${id}` },
  UserData: {}
});

const resumeItems = [
  episode("E24", "S1", "My Hero Academia", 5, 24, {
    Overview: "The final battle.",
    ParentLogoImageTag: "logo-S1",
    ParentBackdropImageTags: ["backdrop-S1"],
    ParentBackdropItemId: "S1"
  }),
  episode("E23", "S1", "My Hero Academia", 5, 23),
  episode("E8", "S2", "Malcolm", 2, 8),
  { Id: "M1", Name: "Oceania", Type: "Movie", ProviderIds: { Imdb: "tt-movie-M1" }, UserData: {} },
  { Id: "ORPHAN", Name: "No series", Type: "Episode", ProviderIds: {}, UserData: {} }
];

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

async function withServer(handler, run) {
  const originalFetch = globalThis.fetch;
  const originalConnection = MediaServerRepository.connection;
  const requests = [];
  MediaServerRepository.connection = () => connection;
  globalThis.fetch = async (url) => {
    const href = String(url);
    requests.push(href);
    return handler(href);
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    MediaServerRepository.connection = originalConnection;
  }
}

const resumeCatalog = (useCatalogMetadata) =>
  withServer(
    (href) => (href.includes("/Items/Resume") ? json({ Items: resumeItems }) : json({}, 404)),
    async () => {
      connection.useCatalogMetadata = useCatalogMetadata;
      return MediaServerRepository.catalog({
        addonBaseUrl: "nuvio-server://conn-1",
        catalogId: "resume",
        type: "movie"
      });
    }
  );

for (const useCatalogMetadata of [false, true]) {
  test(`resume row shows each series once with its series id (catalog metadata ${useCatalogMetadata})`, async () => {
    const result = await resumeCatalog(useCatalogMetadata);
    assert.equal(result.status, "success");
    const movieId = useCatalogMetadata ? "tt-movie-M1" : "server:conn-1:M1";
    assert.deepEqual(
      result.data.items.map((item) => [item.id, item.type, item.name]),
      [
        ["server:conn-1:S1", "series", "My Hero Academia"],
        ["server:conn-1:S2", "series", "Malcolm"],
        [movieId, "movie", "Oceania"]
      ]
    );
  });
}

test("resume card of an episode uses the series artwork and keeps the episode overview", async () => {
  const result = await resumeCatalog(false);
  const card = result.data.items[0];
  assert.match(card.poster, /\/Items\/S1\/Images\/Primary/);
  assert.match(card.poster, /tag=tag-S1/);
  assert.match(card.logo, /\/Items\/S1\/Images\/Logo/);
  assert.match(card.logo, /tag=logo-S1/);
  assert.match(card.background, /\/Items\/S1\/Images\/Backdrop/);
  assert.match(card.background, /tag=backdrop-S1/);
  assert.equal(card.description, "The final battle.");
  assert.equal(card.imdbId, null);
  assert.deepEqual(card.userData, {});
  assert.equal(card.releaseInfo, "");
});

test("resume request asks for the same image types as Android", async () => {
  await withServer(
    (href) => (href.includes("/Items/Resume") ? json({ Items: [] }) : json({}, 404)),
    async (requests) => {
      connection.useCatalogMetadata = false;
      await MediaServerRepository.catalog({
        addonBaseUrl: "nuvio-server://conn-1",
        catalogId: "resume",
        type: "movie"
      });
      assert.ok(
        requests.some((url) => url.includes("enableImageTypes=Primary%2CBackdrop%2CLogo%2CThumb"))
      );
      assert.ok(requests.some((url) => url.includes("imageTypeLimit=1")));
    }
  );
});

test("an episode without a series id is not shown", async () => {
  const result = await resumeCatalog(false);
  assert.ok(!result.data.items.some((item) => /ORPHAN/.test(item.id)));
});

test("meta of an episode id resolves to its series and its episode list", async () => {
  await withServer(
    (href) => {
      if (href.includes("/Shows/S1/Episodes"))
        return json({
          Items: [
            episode("E23", "S1", "My Hero Academia", 5, 23),
            episode("E24", "S1", "My Hero Academia", 5, 24)
          ]
        });
      if (href.includes("/Shows/E24/Episodes")) return json({}, 404);
      if (href.includes("/Items/E24")) return json(episode("E24", "S1", "My Hero Academia", 5, 24));
      if (href.includes("/Items/S1")) return json(seriesItem("S1", "My Hero Academia"));
      return json({}, 404);
    },
    async (requests) => {
      connection.useCatalogMetadata = false;
      const meta = await MediaServerRepository.meta("server:conn-1:E24");
      assert.equal(meta.id, "server:conn-1:S1");
      assert.equal(meta.type, "series");
      assert.equal(meta.name, "My Hero Academia");
      assert.deepEqual(
        meta.videos.map((video) => [video.season, video.episode]),
        [
          [5, 23],
          [5, 24]
        ]
      );
      assert.ok(!requests.some((url) => url.includes("/Shows/E24/Episodes")));
    }
  );
});

test("meta of a series id is unchanged", async () => {
  await withServer(
    (href) => {
      if (href.includes("/Shows/S1/Episodes"))
        return json({ Items: [episode("E24", "S1", "My Hero Academia", 5, 24)] });
      if (href.includes("/Items/S1")) return json(seriesItem("S1", "My Hero Academia"));
      return json({}, 404);
    },
    async () => {
      connection.useCatalogMetadata = false;
      const meta = await MediaServerRepository.meta("server:conn-1:S1");
      assert.equal(meta.id, "server:conn-1:S1");
      assert.equal(meta.videos.length, 1);
    }
  );
});

test("progress and watched rows saved under an episode id move to the series id", async () => {
  const now = Date.now();
  WatchProgressStore.upsertMany(
    [
      {
        contentId: "server:conn-1:E24",
        contentType: "series",
        videoId: "server:conn-1:E25",
        season: 5,
        episode: 24,
        positionMs: 675000,
        durationMs: 1437000,
        title: "Episode 24",
        updatedAt: now
      },
      {
        contentId: "server:conn-1:E24",
        contentType: "series",
        season: 5,
        episode: 23,
        positionMs: 1436000,
        durationMs: 1436000,
        title: "Episode 23",
        updatedAt: now - 1000
      }
    ],
    "1"
  );
  WatchedItemsStore.upsertMany(
    [
      {
        contentId: "server:conn-1:E24",
        contentType: "series",
        season: 5,
        episode: 23,
        title: "Episode 23",
        watchedAt: now - 2000
      }
    ],
    "1"
  );

  await withServer(
    (href) => {
      if (href.includes("/Shows/S1/Episodes"))
        return json({ Items: [episode("E24", "S1", "My Hero Academia", 5, 24)] });
      if (href.includes("/Items/E24")) return json(episode("E24", "S1", "My Hero Academia", 5, 24));
      if (href.includes("/Items/S1")) return json(seriesItem("S1", "My Hero Academia"));
      return json({}, 404);
    },
    async () => {
      connection.useCatalogMetadata = false;
      const meta = await MediaServerRepository.meta("server:conn-1:E24");
      assert.equal(meta.id, "server:conn-1:S1");

      const progress = WatchProgressStore.listForProfile("1");
      assert.deepEqual(
        progress.map((entry) => [entry.contentId, entry.season, entry.episode]).sort(),
        [
          ["server:conn-1:S1", 5, 23],
          ["server:conn-1:S1", 5, 24]
        ]
      );
      const latest = progress.find((entry) => entry.episode === 24);
      assert.equal(latest.title, "My Hero Academia");
      assert.match(latest.poster, /\/Items\/S1\/Images\/Primary/);
      assert.equal(latest.videoId, "server:conn-1:E25");

      const watched = WatchedItemsStore.listForProfile("1");
      assert.deepEqual(
        watched.map((entry) => [entry.contentId, entry.season, entry.episode]),
        [["server:conn-1:S1", 5, 23]]
      );
      assert.equal(watched[0].title, "My Hero Academia");
    }
  );
});

test("an existing newer series row wins over the migrated episode row", async () => {
  const now = Date.now();
  WatchProgressStore.replaceForProfile("1", [
    {
      contentId: "server:conn-1:E24",
      contentType: "series",
      season: 5,
      episode: 24,
      positionMs: 400000,
      durationMs: 1437000,
      updatedAt: now - 5000
    },
    {
      contentId: "server:conn-1:S1",
      contentType: "series",
      season: 5,
      episode: 24,
      positionMs: 900000,
      durationMs: 1437000,
      updatedAt: now
    }
  ]);

  await withServer(
    (href) => {
      if (href.includes("/Shows/S1/Episodes"))
        return json({ Items: [episode("E24", "S1", "My Hero Academia", 5, 24)] });
      if (href.includes("/Items/E24")) return json(episode("E24", "S1", "My Hero Academia", 5, 24));
      if (href.includes("/Items/S1")) return json(seriesItem("S1", "My Hero Academia"));
      return json({}, 404);
    },
    async () => {
      connection.useCatalogMetadata = false;
      await MediaServerRepository.meta("server:conn-1:E24");
      const progress = WatchProgressStore.listForProfile("1");
      assert.equal(progress.length, 1);
      assert.equal(progress[0].contentId, "server:conn-1:S1");
      assert.equal(progress[0].positionMs, 900000);
    }
  );
});
