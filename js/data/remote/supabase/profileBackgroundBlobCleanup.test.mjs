import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("profileBackgroundRepository reuses cached asset URLs and revokes dropped ones", async () => {
  const source = stripModule(
    await readFile(new URL("./profileBackgroundRepository.js", import.meta.url), "utf8")
  );
  const revoked = [];
  const created = [];
  let urlCount = 0;
  let resolveRemoteCatalog;
  const remoteCatalogResponse = new Promise((resolve) => {
    resolveRemoteCatalog = resolve;
  });
  const storedCatalog = {
    items: [
      { id: "bg1", storage_path: "bg1.jpg", asset_version: 1 },
      { id: "bg2", storage_path: "bg2.jpg", asset_version: 1 }
    ]
  };
  const context = vm.createContext({
    console,
    MemberCatalogStorage: {
      loadProfileBackgroundCatalog: () => storedCatalog,
      saveProfileBackgroundCatalog() {},
      loadAsset: async (_kind, id) => ({ id }),
      saveAsset: async () => {}
    },
    SupabaseApi: {
      rpc: () => remoteCatalogResponse,
      downloadStorageObject: async () => null
    },
    createStorageAssetUrl: async (blob) => {
      const url = `blob:${blob.id}:${++urlCount}`;
      created.push({ id: blob.id, url });
      return url;
    },
    revokeStorageAssetUrl: (url) => revoked.push(url)
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.ProfileBackgroundRepository = ProfileBackgroundRepository;`,
    context
  );

  // Launch with a persisted catalog: cached blobs are published while the RPC is still in flight.
  const loading = context.ProfileBackgroundRepository.loadSelectedAndPreload("bg1");
  await tick();
  const cachedCatalog = context.ProfileBackgroundRepository.getCatalog();
  const cachedBg1Url = cachedCatalog.find((item) => item.id === "bg1").imageUrl;
  const cachedBg2Url = cachedCatalog.find((item) => item.id === "bg2").imageUrl;
  assert.ok(cachedBg1Url && cachedBg2Url);

  // The refreshed catalog keeps bg1 (same asset version) and drops bg2.
  resolveRemoteCatalog([{ id: "bg1", storage_path: "bg1.jpg", asset_version: 1 }]);
  await loading;

  const catalog = context.ProfileBackgroundRepository.getCatalog();
  assert.equal(catalog.find((item) => item.id === "bg1").imageUrl, cachedBg1Url);
  assert.equal(
    catalog.some((item) => item.id === "bg2"),
    false
  );
  assert.deepEqual(revoked, [cachedBg2Url]);
  assert.equal(created.filter((item) => item.id === "bg1").length, 1);
});
