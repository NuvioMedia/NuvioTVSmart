import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("profileBackgroundRepository retains matching asset blob URLs and revokes removed ones", async () => {
  const source = stripModule(
    await readFile(new URL("./profileBackgroundRepository.js", import.meta.url), "utf8")
  );
  const revoked = [];
  let rpcRows = [
    { id: "bg1", storage_path: "bg1.jpg", asset_version: 1 },
    { id: "bg2", storage_path: "bg2.jpg", asset_version: 1 }
  ];
  let blobCounter = 1;
  const context = vm.createContext({
    console,
    MemberCatalogStorage: {
      loadProfileBackgroundCatalog: () => null,
      saveProfileBackgroundCatalog() {},
      loadAsset: async (_k, id) => ({ id }),
      saveAsset: async () => {}
    },
    SupabaseApi: {
      rpc: async () => rpcRows,
      downloadStorageObject: async () => null
    },
    createStorageAssetUrl: async (blob) => `blob:${blob.id}:${blobCounter++}`,
    revokeStorageAssetUrl: (url) => revoked.push(url)
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.ProfileBackgroundRepository = ProfileBackgroundRepository;\nglobalThis.resetLoadFlag = () => { remoteCatalogLoaded = false; };`,
    context
  );

  await context.ProfileBackgroundRepository.loadSelectedAndPreload("bg1");
  const firstCatalog = context.ProfileBackgroundRepository.getCatalog();
  const bg1Url = firstCatalog.find((x) => x.id === "bg1").imageUrl;
  const bg2Url = firstCatalog.find((x) => x.id === "bg2").imageUrl;
  assert.ok(bg1Url && bg2Url);

  // Force a catalog reload without bg2 (and bg1 unchanged): bg1 keeps URL, bg2 is revoked.
  context.resetLoadFlag();
  rpcRows = [{ id: "bg1", storage_path: "bg1.jpg", asset_version: 1 }];
  await context.ProfileBackgroundRepository.ensureLoaded();
  const updated = context.ProfileBackgroundRepository.getCatalog();
  assert.equal(updated.find((x) => x.id === "bg1").imageUrl, bg1Url);
  assert.deepEqual(revoked, [bg2Url]);
});
