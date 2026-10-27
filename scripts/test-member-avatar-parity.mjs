import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(
  new URL("../js/data/remote/supabase/avatarRepository.js", import.meta.url),
  "utf8"
)
  .replace(/^import .*;\n/gm, "")
  .replace(/export /g, "");

function repository({
  rows = [],
  stored = null,
  download = async () => new Blob(["image"]),
  cached = null,
  imageUrl = "blob:avatar",
  configuration = { avatarPublicBaseUrl: "https://cdn.example/avatars/" }
} = {}) {
  const calls = [];
  const revoked = [];
  let payload = stored;
  const context = {
    Blob,
    console: { warn() {} },
    MemberCatalogStorage: {
      loadAvatarCatalog: () => payload,
      saveAvatarCatalog: (value) => {
        payload = value;
      },
      loadAsset: async () => cached,
      saveAsset: async () => {}
    },
    ServerConfigurationStore: { getActive: () => configuration },
    SupabaseApi: {
      rpc: async (name) => (name === "get_avatar_catalog" ? [] : rows),
      downloadStorageObject: async (...args) => {
        calls.push(args);
        return download(...args);
      }
    },
    createStorageAssetUrl: async () => imageUrl,
    revokeStorageAssetUrl: (url) => revoked.push(url)
  };
  const api = vm.runInNewContext(source + "; AvatarRepository", context);
  return { api, calls, revoked };
}
const sky = {
  id: "sky",
  storage_path: " /classic/sky.png ",
  display_name: "Sky",
  asset_version: 2
};

test("failed Classic asset retains Android public fallback and profile lookup", async () => {
  const { api } = repository({
    rows: [sky],
    download: async () => {
      throw Error("404");
    }
  });
  const catalog = await api.getAvatarCatalog(true);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].imageUrl, "https://cdn.example/avatars/classic/sky.png");
  assert.equal(catalog[0].memberOnly, true);
  assert.equal(api.getAvatarImageUrl("sky", catalog), catalog[0].imageUrl);
  assert.equal(api.getCachedAvatarCatalog(false).length, 0);
});

test("cache hit keeps local image and skips authenticated download", async () => {
  const { api, calls, revoked } = repository({ rows: [sky], cached: new Blob(["cached"]) });
  assert.equal((await api.getAvatarCatalog(true))[0].imageUrl, "blob:avatar");
  assert.equal(calls.length, 0);
  api.invalidateCache();
  assert.deepEqual(revoked, ["blob:avatar"]);
});

test("successful assets still download authenticated; no image URL uses fallback", async () => {
  const { api, calls } = repository({ rows: [sky] });
  assert.equal((await api.getAvatarCatalog(true))[0].imageUrl, "blob:avatar");
  assert.deepEqual(calls[0], ["membership-profile-avatars", "/classic/sky.png", true]);
  const failed = repository({ rows: [sky], imageUrl: null });
  assert.equal(
    (await failed.api.getAvatarCatalog(true))[0].imageUrl,
    "https://cdn.example/avatars/classic/sky.png"
  );
});

test("stored catalog restores fallback, including absolute URLs and custom servers", async () => {
  for (const [path, configuration, expected] of [
    ["https://cdn.example/sky.png", {}, "https://cdn.example/sky.png"],
    [
      "/classic/sky.png",
      { backendUrl: "https://custom.example/" },
      "https://custom.example/storage/v1/object/public/avatars/classic/sky.png"
    ]
  ]) {
    const { api } = repository({
      stored: {
        standardLoaded: true,
        standardItems: [],
        memberLoaded: true,
        memberItems: [{ ...sky, storage_path: path }]
      },
      configuration,
      download: async () => {
        throw Error("404");
      }
    });
    assert.equal((await api.getAvatarCatalog(true))[0].imageUrl, expected);
  }
});

test("six concurrent loads preserve ordering and isolate failures", async () => {
  let active = 0,
    maximum = 0;
  const rows = Array.from({ length: 19 }, (_, i) => ({
    id: String(i),
    storage_path: `classic/${i}.png`
  }));
  const { api } = repository({
    rows,
    download: async (_bucket, path) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, Number(path.match(/\d+/)[0]) % 3));
      active--;
      if (path === "classic/3.png") throw Error("404");
      return new Blob(["image"]);
    }
  });
  const catalog = await api.getAvatarCatalog(true);
  assert.equal(maximum, 6);
  assert.equal(catalog.map((item) => item.id).join(","), rows.map((item) => item.id).join(","));
  assert.equal(catalog[3].imageUrl, "https://cdn.example/avatars/classic/3.png");
});

test("logout invalidation discards pending failures and stops queued loads", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), storage_path: `${i}.png` }));
  const { api, calls } = repository({
    rows,
    download: async () => {
      await gate;
      throw Error("aborted");
    }
  });
  const pending = api.getAvatarCatalog(true);
  while (calls.length < 6) await new Promise((resolve) => setImmediate(resolve));
  api.invalidateCache();
  release();
  assert.equal((await pending).length, 0);
  assert.equal(calls.length, 6);
  assert.equal(api.getCachedAvatarCatalog(true).length, 0);
});

test("empty catalog and non-member access do not start asset loads", async () => {
  const empty = repository();
  assert.equal((await empty.api.getAvatarCatalog(true)).length, 0);
  const standard = repository({ rows: [sky] });
  assert.equal((await standard.api.getAvatarCatalog(false)).length, 0);
  assert.equal(standard.calls.length, 0);
});
