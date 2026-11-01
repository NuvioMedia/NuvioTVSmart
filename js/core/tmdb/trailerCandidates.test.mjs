import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const { resolveTrailerCandidates } =
  await import("./tmdbMetadataServiceHelpers-03-fetch-tmdb-images.js");

function mockTmdb(localizedByMovie) {
  const languages = [];
  globalThis.fetch = async (url) => {
    const language = new URL(url).searchParams.get("language");
    const movieId = url.match(/movie\/(\d+)/)[1];
    languages.push(language);
    const results =
      language === "en-US"
        ? [{ site: "YouTube", key: "EN", type: "Trailer", iso_639_1: "en" }]
        : localizedByMovie[movieId] || [];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results }),
      text: async () => JSON.stringify({ results })
    };
  };
  return languages;
}

test("Hero and detail trailer lookups prefer the TMDB language, like Android", async () => {
  const languages = mockTmdb({
    1: [{ site: "YouTube", key: "IT", type: "Trailer", iso_639_1: "it" }]
  });
  const candidates = await resolveTrailerCandidates({
    type: "movie",
    tmdbId: "1",
    apiKey: "key",
    language: "it-IT"
  });
  assert.equal(candidates[0].key, "IT");
  assert.deepEqual(languages, ["it-IT"]);
});

test("Trailer lookups fall back to English only when the language has none", async () => {
  const languages = mockTmdb({});
  const candidates = await resolveTrailerCandidates({
    type: "movie",
    tmdbId: "2",
    apiKey: "key",
    language: "it-IT"
  });
  assert.equal(candidates[0].key, "EN");
  assert.deepEqual(languages, ["it-IT", "en-US"]);
});
