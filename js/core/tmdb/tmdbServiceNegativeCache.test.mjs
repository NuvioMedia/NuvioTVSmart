import assert from "node:assert/strict";
import test from "node:test";

import { fetchTmdbJson } from "./tmdbService.js";
import {
  flushTmdbNegativeCacheForTests,
  resetTmdbNegativeCacheForTests
} from "../network/tmdbNegativeCache.js";

// The direct path is the one this test can drive on Node (Platform.isWebOS is
// false), so it also proves the cache is consulted before the network call.
const URL_404 = "https://api.themoviedb.org/3/movie/999999?api_key=x";
const URL_OK = "https://api.themoviedb.org/3/movie/550?api_key=x";

function fakeStorage() {
  const rows = new Map();
  return {
    getItem: (key) => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key)
  };
}

function installFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  return calls;
}

test("a 404 is answered from the negative cache on the next call", async () => {
  globalThis.localStorage = fakeStorage();
  resetTmdbNegativeCacheForTests();
  const calls = installFetch(404, {});

  assert.equal(await fetchTmdbJson(URL_404), null);
  assert.equal(calls.length, 1);

  assert.equal(await fetchTmdbJson(URL_404), null);
  assert.equal(calls.length, 1, "the second call must not reach the network");

  resetTmdbNegativeCacheForTests();
});

test("a successful request is parsed and never blocked", async () => {
  globalThis.localStorage = fakeStorage();
  resetTmdbNegativeCacheForTests();
  const calls = installFetch(200, { id: 550 });

  assert.deepEqual(await fetchTmdbJson(URL_OK), { id: 550 });
  assert.deepEqual(await fetchTmdbJson(URL_OK), { id: 550 });
  assert.equal(calls.length, 2);

  resetTmdbNegativeCacheForTests();
});

test("a server error is retried, not remembered", async () => {
  globalThis.localStorage = fakeStorage();
  resetTmdbNegativeCacheForTests();
  const calls = installFetch(500, {});

  assert.equal(await fetchTmdbJson(URL_OK), null);
  assert.equal(await fetchTmdbJson(URL_OK), null);
  assert.equal(calls.length, 2);

  resetTmdbNegativeCacheForTests();
  flushTmdbNegativeCacheForTests();
});
