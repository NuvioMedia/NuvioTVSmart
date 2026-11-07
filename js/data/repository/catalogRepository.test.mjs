import assert from "node:assert/strict";
import { test } from "node:test";

if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
}

const [{ catalogRepository }, { CatalogApi }] = await Promise.all([
  import("./catalogRepository.js"),
  import("../remote/api/catalogApi.js")
]);

function descriptor(catalogId) {
  return {
    addonBaseUrl: "https://example.test/addon",
    addonId: "example",
    addonName: "Example",
    catalogId,
    catalogName: "Example Catalog",
    type: "movie",
    skip: 0,
    skipStep: 100,
    supportsSkip: false
  };
}

function stubCatalogResponse(metas) {
  const original = CatalogApi.getCatalog;
  const calls = [];
  CatalogApi.getCatalog = async (url) => {
    calls.push(url);
    return { metas };
  };
  return {
    calls,
    restore() {
      CatalogApi.getCatalog = original;
    }
  };
}

test("a transient empty catalog response is retried on the next request", async (t) => {
  catalogRepository.clearCache();
  const stub = stubCatalogResponse([]);
  t.after(() => stub.restore());

  const query = descriptor("empty");
  const first = await catalogRepository.getCatalog(query);
  const second = await catalogRepository.getCatalog(query);

  assert.equal(first.status, "success");
  assert.equal(second.status, "success");
  assert.equal(stub.calls.length, 2);
});

test("the response cache keeps only the most recently used pages", async (t) => {
  catalogRepository.clearCache();
  const stub = stubCatalogResponse([
    { id: "tt1", name: "One", type: "movie", poster: "https://example.test/1.jpg" }
  ]);
  t.after(() => stub.restore());

  // Fill the cache, then keep touching the very first page so it stays hot.
  const first = descriptor("page-0");
  await catalogRepository.getCatalog(first);
  for (let index = 1; index < 96; index += 1) {
    await catalogRepository.getCatalog(descriptor(`page-${index}`));
  }
  assert.equal(catalogRepository.catalogCache.size, 96);
  await catalogRepository.getCatalog(first);
  assert.equal(stub.calls.length, 96, "the hot page is still served from the cache");

  // One more distinct page evicts the least recently used one (page-1), not page-0.
  await catalogRepository.getCatalog(descriptor("page-96"));
  assert.equal(catalogRepository.catalogCache.size, 96);
  await catalogRepository.getCatalog(first);
  assert.equal(stub.calls.length, 97, "page-0 was kept");
  await catalogRepository.getCatalog(descriptor("page-1"));
  assert.equal(stub.calls.length, 98, "page-1 was evicted and fetched again");
});

test("a catalog page with items is still served from the response cache", async (t) => {
  catalogRepository.clearCache();
  const stub = stubCatalogResponse([
    { id: "tt1", name: "One", type: "movie", poster: "https://example.test/1.jpg" }
  ]);
  t.after(() => stub.restore());

  const query = descriptor("filled");
  const first = await catalogRepository.getCatalog(query);
  const second = await catalogRepository.getCatalog(query);

  assert.equal(first.status, "success");
  assert.equal(second.data.items.length, 1);
  assert.equal(stub.calls.length, 1);
});
