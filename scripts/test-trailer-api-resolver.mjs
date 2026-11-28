import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = { TRAILER_API_URL: "https://trailer.example.test/api" };

const requests = [];
let responseBody = { url: "https://cdn.example.test/trailer.mp4" };
let responseStatus = 200;
globalThis.fetch = async (url) => {
  requests.push(String(url));
  return {
    ok: responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    headers: { get: () => null },
    text: async () => JSON.stringify(responseBody)
  };
};

const { resolveTrailerVideoUrl, withResolvedTrailerSource } =
  await import("../js/core/media/trailerApi.js");

const resolved = await resolveTrailerVideoUrl("abc12345678", { title: "Example", year: "2024" });
assert.equal(resolved, "https://cdn.example.test/trailer.mp4");

const requested = new URL(requests[0]);
assert.equal(requested.origin + requested.pathname, "https://trailer.example.test/api/trailer");
assert.equal(
  requested.searchParams.get("youtube_url"),
  "https://www.youtube.com/watch?v=abc12345678"
);
assert.equal(requested.searchParams.get("title"), "Example");
assert.equal(requested.searchParams.get("year"), "2024");

await resolveTrailerVideoUrl("abc12345678", { title: "Changed" });
assert.equal(requests.length, 1, "a resolved source is reused instead of re-queried");

const source = await withResolvedTrailerSource(
  { kind: "youtube", ytId: "def12345678", embedUrl: "https://proxy.example.test/embed" },
  { title: "Example", year: "2024" }
);
assert.deepEqual(source, {
  kind: "video",
  url: "https://cdn.example.test/trailer.mp4",
  ytId: "def12345678"
});

const nonYoutube = { kind: "video", url: "https://cdn.example.test/existing.mp4" };
assert.equal(await withResolvedTrailerSource(nonYoutube), nonYoutube);
assert.equal(await withResolvedTrailerSource(null), null);

responseStatus = 503;
assert.equal(
  await resolveTrailerVideoUrl("ghi12345678"),
  "",
  "a failed request falls back to the embed"
);
const failedRequests = requests.length;
assert.equal(await resolveTrailerVideoUrl("ghi12345678"), "", "failures are not cached");
assert.equal(requests.length, failedRequests + 1);

responseStatus = 200;
responseBody = { url: "javascript:alert(1)" };
assert.equal(
  await resolveTrailerVideoUrl("jkl12345678"),
  "",
  "only absolute http(s) URLs are accepted"
);

responseBody = {};
assert.equal(
  await resolveTrailerVideoUrl("mno12345678"),
  "",
  "a missing url falls back to the embed"
);

console.log("test-trailer-api-resolver: ok");
