import test from "node:test";
import assert from "node:assert/strict";

// Emby does not spell provider keys consistently: the same server can return
// "Imdb" for movies and "IMDB" for series. Provider identity must be read
// without regard to case, otherwise those titles lose their catalog id and
// never get the media-server source.

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
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

const { mapServerItem, MediaServerRepository } =
  await import("../js/data/mediaserver/mediaServerRepository.js");

const connection = {
  id: "conn-1",
  providerId: "emby",
  address: "http://emby.local:8096",
  name: "Emby",
  remoteUserId: "user-1",
  token: "token",
  useCatalogMetadata: true,
  enabled: true,
  libraries: [{ id: "lib-shows", name: "TV shows", kind: "series", selected: true }]
};

const series = (providerIds) => ({
  Id: "70312",
  Name: "My Hero Academia",
  Type: "Series",
  ProviderIds: providerIds
});

test("mapServerItem reads an upper-case IMDB key", () => {
  const meta = mapServerItem(connection, series({ IMDB: "tt5626028", Tmdb: "65930" }));
  assert.equal(meta.id, "tt5626028");
  assert.equal(meta.imdbId, "tt5626028");
  assert.equal(meta.tmdbId, "65930");
});

test("mapServerItem still reads the Imdb and imdb keys", () => {
  assert.equal(mapServerItem(connection, series({ Imdb: "tt1" })).id, "tt1");
  assert.equal(mapServerItem(connection, series({ imdb: "tt2" })).id, "tt2");
});

test("mapServerItem reads an upper-case TMDB key when no IMDb id exists", () => {
  const meta = mapServerItem(connection, series({ TMDB: "65930" }));
  assert.equal(meta.id, "tmdb:65930");
  assert.equal(meta.tmdbId, "65930");
});

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

async function listEpisodeStreams(providerIds) {
  const originalFetch = globalThis.fetch;
  const originalConnection = MediaServerRepository.connection;
  const requests = [];
  MediaServerRepository.connection = () => connection;
  globalThis.fetch = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href.includes("/Shows/70312/Episodes"))
      return jsonResponse({
        Items: [{ Id: "70838", ParentIndexNumber: 5, IndexNumber: 17, Type: "Episode" }]
      });
    if (href.includes("/Items/70838"))
      return jsonResponse({
        Id: "70838",
        Name: "Episode 17",
        MediaSources: [{ Id: "src-1", Container: "mkv", Path: "/media/ep17.mkv", MediaStreams: [] }]
      });
    if (href.includes("/Items")) return jsonResponse({ Items: [series(providerIds)] });
    return jsonResponse({});
  };
  try {
    const result = await MediaServerRepository.streams(
      "nuvio-server://conn-1",
      "series",
      "tt5626028:5:17"
    );
    return { result, requests };
  } finally {
    globalThis.fetch = originalFetch;
    MediaServerRepository.connection = originalConnection;
  }
}

test("streams accepts a series whose provider key is IMDB", async () => {
  const { result, requests } = await listEpisodeStreams({ IMDB: "tt5626028", Tmdb: "65930" });
  assert.equal(result.status, "success");
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0].clientResolve.mediaServer, {
    connectionId: "conn-1",
    itemId: "70838",
    mediaSourceId: "src-1"
  });
  assert.ok(requests.some((url) => url.includes("anyProviderIdEquals=Imdb.tt5626028")));
});

test("streams still rejects a series whose IMDb id differs", async () => {
  const { result } = await listEpisodeStreams({ IMDB: "tt0000001" });
  assert.equal(result.status, "success");
  assert.equal(result.data.length, 0);
});
