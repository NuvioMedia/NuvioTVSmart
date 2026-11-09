import assert from "node:assert/strict";
import test from "node:test";

import {
  flushTmdbNegativeCacheForTests,
  isTmdbHostBackedOff,
  isTmdbRequestBlocked,
  noteTmdbRequestResult,
  resetTmdbNegativeCacheForTests
} from "./tmdbNegativeCache.js";

const BASE = "https://api.themoviedb.org/3/movie/550?api_key=SECRET&language=en-US";

function fakeStorage() {
  const rows = new Map();
  return {
    rows,
    getItem: (key) => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
    clear: () => rows.clear()
  };
}

function reset() {
  globalThis.localStorage = fakeStorage();
  resetTmdbNegativeCacheForTests();
}

test("an empty endpoint is remembered without its API key", () => {
  reset();
  const now = 1_000_000;
  noteTmdbRequestResult(BASE, { status: 404 }, now);

  assert.equal(isTmdbRequestBlocked(BASE, now + 1), true);
  assert.equal(
    isTmdbRequestBlocked(
      "https://api.themoviedb.org/3/movie/550?language=en-US&api_key=OTHER",
      now + 1
    ),
    true,
    "the same path with another key must hit the same entry"
  );
  assert.equal(
    isTmdbRequestBlocked("https://api.themoviedb.org/3/movie/551?api_key=SECRET", now + 1),
    false
  );
  assert.equal(isTmdbRequestBlocked("https://example.com/movie/550", now + 1), false);
});

test("only 400, 404 and 410 are treated as permanent", () => {
  reset();
  const now = 2_000_000;
  for (const status of [401, 403, 429, 500, 503]) {
    noteTmdbRequestResult(BASE, { status }, now);
    assert.equal(isTmdbRequestBlocked(BASE, now + 1), false, `${status} must not block`);
  }
  for (const status of [400, 404, 410]) {
    reset();
    noteTmdbRequestResult(BASE, { status }, now);
    assert.equal(isTmdbRequestBlocked(BASE, now + 1), true, `${status} must block`);
  }
});

test("a successful response clears the entry", () => {
  reset();
  const now = 3_000_000;
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + 1), true);
  noteTmdbRequestResult(BASE, { status: 200 }, now + 2);
  assert.equal(isTmdbRequestBlocked(BASE, now + 3), false);
});

test("a first miss blocks for one hour only", () => {
  reset();
  const now = 4_000_000;
  const hour = 60 * 60 * 1000;
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + hour - 1), true);
  assert.equal(isTmdbRequestBlocked(BASE, now + hour + 1), false);
});

test("a repeated miss doubles the window up to the one-day cap", () => {
  reset();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  let now = 5_000_000;

  noteTmdbRequestResult(BASE, { status: 404 }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + 2 * hour), false, "first window is one hour");

  now += hour + 1;
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + 2 * hour - 1), true, "second window is two hours");
  assert.equal(isTmdbRequestBlocked(BASE, now + 2 * hour + 1), false);

  // Four more misses: 4h, 8h, 16h, then the 24h cap.
  for (let index = 0; index < 4; index += 1) {
    now += hour;
    noteTmdbRequestResult(BASE, { status: 404 }, now);
  }
  assert.equal(isTmdbRequestBlocked(BASE, now + day - 1), true);
  assert.equal(isTmdbRequestBlocked(BASE, now + day + 1), false);
});

test("a success resets the strike count", () => {
  reset();
  const hour = 60 * 60 * 1000;
  let now = 6_000_000;
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  noteTmdbRequestResult(BASE, { status: 200 }, now + 1);
  now += 2;
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + hour - 1), true);
  assert.equal(isTmdbRequestBlocked(BASE, now + hour + 1), false, "the window must start over");
});

test("connection failures back the host off and double, a response resets it", () => {
  reset();
  const now = 5_000_000;
  noteTmdbRequestResult(BASE, { networkError: true }, now);
  assert.equal(isTmdbHostBackedOff(BASE, now + 1), true);
  assert.equal(isTmdbHostBackedOff(BASE, now + 30_001), false);

  noteTmdbRequestResult(BASE, { networkError: true }, now);
  noteTmdbRequestResult(BASE, { networkError: true }, now);
  assert.equal(isTmdbHostBackedOff(BASE, now + 60_000), true);

  noteTmdbRequestResult(BASE, { status: 404 }, now + 60_001);
  assert.equal(isTmdbHostBackedOff(BASE, now + 60_002), false);
});

test("an aborted request is never recorded", () => {
  reset();
  const now = 6_000_000;
  noteTmdbRequestResult(BASE, { aborted: true, status: 404, networkError: true }, now);
  assert.equal(isTmdbRequestBlocked(BASE, now + 1), false);
  assert.equal(isTmdbHostBackedOff(BASE, now + 1), false);
});

test("entries survive a reload through storage", () => {
  reset();
  const now = Date.now();
  noteTmdbRequestResult(BASE, { status: 404 }, now);
  flushTmdbNegativeCacheForTests();
  assert.equal(globalThis.localStorage.rows.size, 1);

  resetTmdbNegativeCacheForTests();
  assert.equal(isTmdbRequestBlocked(BASE, now + 1), true);
});
