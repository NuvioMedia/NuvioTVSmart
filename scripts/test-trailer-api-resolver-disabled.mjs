import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_ENV__ = {};
globalThis.fetch = async () => {
  throw new Error("the trailer resolver must stay disabled when TRAILER_API_URL is unset");
};

const { resolveTrailerVideoUrl, withResolvedTrailerSource } =
  await import("../js/core/media/trailerApi.js");

assert.equal(await resolveTrailerVideoUrl("abc12345678"), "");

const source = {
  kind: "youtube",
  ytId: "abc12345678",
  embedUrl: "https://proxy.example.test/embed"
};
assert.equal(await withResolvedTrailerSource(source, { title: "Example" }), source);

console.log("test-trailer-api-resolver-disabled: ok");
