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

const [{ metaRepository }, { MetaApi }, { addonRepository }] = await Promise.all([
  import("./metaRepository.js"),
  import("../remote/api/metaApi.js"),
  import("./addonRepository.js")
]);

test("the meta cache keeps only the most recently used entries", async (t) => {
  metaRepository.clearCache();
  const originalGetInstalledAddons = addonRepository.getInstalledAddons;
  const originalGetMeta = MetaApi.getMeta;
  addonRepository.getInstalledAddons = async () => [];
  MetaApi.getMeta = async (url) => ({
    meta: {
      id: String(url).split("/").at(-1).replace(".json", ""),
      type: "movie",
      name: "Test"
    }
  });
  t.after(() => {
    addonRepository.getInstalledAddons = originalGetInstalledAddons;
    MetaApi.getMeta = originalGetMeta;
    metaRepository.clearCache();
  });

  for (let index = 0; index < 201; index += 1) {
    const result = await metaRepository.getMeta(
      "https://example.test/addon",
      "movie",
      `tt${index}`
    );
    assert.equal(result.status, "success");
  }

  const cacheKey = (id) =>
    `${addonRepository.canonicalizeUrl("https://example.test/addon")}:movie:${id}`;
  assert.equal(metaRepository.metaCache.size, 200);
  assert.equal(metaRepository.metaCache.has(cacheKey("tt0")), false);
  assert.equal(metaRepository.metaCache.has(cacheKey("tt200")), true);
});
