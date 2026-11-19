import assert from "node:assert/strict";
import { test } from "node:test";

import { BoundedCache } from "./boundedCache.js";

test("a bounded cache evicts the least recently used entry", () => {
  const cache = new BoundedCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);

  assert.equal(cache.size, 2);
  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("c"), true);
  assert.equal(cache.has("b"), false);
});

test("rewriting a key keeps the cache size and the newest value", () => {
  const cache = new BoundedCache(1);
  cache.set("a", 1);
  cache.set("a", 2);

  assert.equal(cache.size, 1);
  assert.equal(cache.get("a"), 2);
});
