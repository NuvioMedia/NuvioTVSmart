import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { BoundedCache } from "../../core/util/boundedCache.js";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("detailWatchedEnrichmentService bounds CACHE to <= 100 entries", async () => {
  const source = stripModule(
    await readFile(new URL("./detailWatchedEnrichmentService.js", import.meta.url), "utf8")
  );
  const context = vm.createContext({
    BoundedCache,
    watchedItemsRepository: {},
    watchProgressRepository: {},
    TraktAuthService: {},
    watchedItemsShareIdentity: () => false,
    LocalStore: {},
    WatchProgressSource: {},
    ProfileManager: {},
    episodeMappingEntries: () => [],
    TraktEpisodeMappingService: {},
    MdbListEpisodeMappingService: {}
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.setCachedEntry = setCachedEntry;\nglobalThis.getCachedEntry = getCachedEntry;\nglobalThis.getCacheSize = () => CACHE.size;`,
    context
  );

  for (let i = 0; i < 150; i += 1) {
    context.setCachedEntry(`k:${i}`, { i });
  }
  assert.equal(context.getCacheSize(), 100);
  assert.equal(context.getCachedEntry("k:0"), null);
  assert.equal(context.getCachedEntry("k:149")?.i, 149);
});
