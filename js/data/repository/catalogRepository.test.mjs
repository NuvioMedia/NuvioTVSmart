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
