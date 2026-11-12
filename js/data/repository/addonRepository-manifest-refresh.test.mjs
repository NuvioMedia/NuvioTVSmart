import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
const { addonRepository } = await import("./addonRepository.js");
const TTL = 6 * 60 * 60 * 1000;
const URL = "https://example.test/addon";
const BACKGROUND = { staleWhileRevalidate: true };

function manifest(catalogId = "old") {
  return {
    id: "example",
    name: "Example",
    baseUrl: URL,
    catalogs: [{ id: catalogId, apiType: "movie", extra: [] }],
    resources: []
  };
}

function repositoryFromDisk() {
  storage.set(
    "addonManifestCacheV2",
    JSON.stringify({
      version: 2,
      entries: { [URL]: { addon: manifest(), cachedAtMs: Date.now() } }
    })
  );
  const repository = new addonRepository.constructor();
  repository.getInstalledAddonUrls = () => [URL];
  repository.isAddonEnabled = () => true;
  repository.getAddonEnabledStates = () => ({});
  repository.getAddonDisplayNameOverrides = () => ({});
  repository.getAddonDisplayNameOverride = () => "";
  repository.getActiveStorageProfileId = () => 1;
  return repository;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("a new process revalidates a recent disk manifest without blocking cached data", async () => {
  const repository = repositoryFromDisk();
  let finishFetch;
  let notifications = 0;
  const calls = [];
  repository.installedAddonsCache = [manifest()];
  repository.onManifestCacheChanged(() => notifications++);
  repository.fetchAddon = async (url, options) => {
    calls.push({ url, force: options.force });
    await new Promise((resolve) => {
      finishFetch = resolve;
    });
    repository.manifestCache.set(url, manifest("updated"));
    return { status: "success", data: manifest("updated") };
  };

  const cached = await repository.getInstalledAddons(BACKGROUND);
  assert.equal(cached[0].catalogs[0].id, "old");
  assert.deepEqual(calls, [{ url: URL, force: true }]);
  const request = repository.backgroundManifestRefreshRequest;
  finishFetch();
  await request;
  await settle();
  assert.equal(repository.getCachedInstalledAddons()[0].catalogs[0].id, "updated");
  assert.equal(notifications, 1);
  assert.equal(repository.installedAddonsCache, null);
  assert.equal(repository.backgroundManifestRefreshRequest, null);

  const restarted = repositoryFromDisk();
  let restartedFetches = 0;
  restarted.fetchAddon = async () => {
    restartedFetches++;
    return { status: "error" };
  };
  await restarted.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(restartedFetches, 1);
});

test("failed cached refresh attempts are spaced by the session TTL", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const repository = repositoryFromDisk();
  let fetches = 0;
  repository.fetchAddon = async () => {
    fetches++;
    return { status: "error" };
  };

  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(fetches, 1);
  assert.equal(repository.getCachedInstalledAddons()[0].catalogs[0].id, "old");
  now += TTL;
  await repository.getInstalledAddons(BACKGROUND);
  assert.equal(fetches, 1);
  now++;
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(fetches, 2);
});

test("an active sweep prevents overlapping sweeps even if it outlives the TTL", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const repository = repositoryFromDisk();
  let finishFetch;
  let fetches = 0;
  repository.fetchAddon = async () => {
    fetches++;
    await new Promise((resolve) => {
      finishFetch = resolve;
    });
    return { status: "error" };
  };
  await repository.getInstalledAddons(BACKGROUND);
  const request = repository.backgroundManifestRefreshRequest;
  now += TTL + 1;
  await repository.getInstalledAddons(BACKGROUND);
  assert.equal(fetches, 1);
  finishFetch();
  await request;
  await settle();
  repository.fetchAddon = async () => {
    fetches++;
    return { status: "error" };
  };
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(fetches, 2);
});

test("an unexpected refresh rejection releases the in-flight guard without immediate retry", async (t) => {
  const repository = repositoryFromDisk();
  let fetches = 0;
  const warn = t.mock.method(console, "warn", () => {});
  repository.fetchAddon = async () => {
    fetches++;
    throw new Error("invalid manifest");
  };
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(repository.backgroundManifestRefreshRequest, null);
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(fetches, 1);
  assert.equal(warn.mock.callCount(), 1);
});

test("missing manifests can recover while cached manifests remain within the retry interval", async () => {
  const repository = repositoryFromDisk();
  const calls = [];
  repository.fetchAddon = async (url) => {
    calls.push(url);
    return { status: "error" };
  };
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  const missingUrl = "https://example.test/new-addon";
  repository.getInstalledAddonUrls = () => [URL, missingUrl];
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.deepEqual(calls, [URL, missingUrl]);
});

test("no enabled addons consumes no attempt and enabling one starts revalidation", async () => {
  const repository = repositoryFromDisk();
  repository.isAddonEnabled = () => false;
  let fetches = 0;
  repository.fetchAddon = async () => {
    fetches++;
    return { status: "error" };
  };
  await repository.getInstalledAddons(BACKGROUND);
  assert.equal(repository.lastManifestRefreshAttemptAt, 0);
  assert.equal(fetches, 0);
  repository.isAddonEnabled = () => true;
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  assert.equal(fetches, 1);
});

test("cache-only reads stay offline and explicit refresh bypasses the background interval", async () => {
  const repository = repositoryFromDisk();
  let fetches = 0;
  repository.fetchAddon = async () => {
    fetches++;
    return { status: "error" };
  };
  await repository.getInstalledAddons({ cacheOnly: true });
  assert.equal(fetches, 0);
  await repository.getInstalledAddons(BACKGROUND);
  await settle();
  await repository.refreshInstalledAddons();
  assert.equal(fetches, 2);
});

test("profile-scoped reads are reused until the key is written again", async () => {
  const { LocalStore } = await import("../../core/storage/localStore.js");
  const [url] = addonRepository.getInstalledAddonUrls();
  const states = addonRepository.getAddonEnabledStates();
  states.leaked = true;
  assert.equal(addonRepository.getAddonEnabledStates().leaked, undefined);
  assert.equal(addonRepository.isAddonEnabled(url), true);

  const reads = [];
  const getItem = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = (key) => (reads.push(key), getItem(key));
  try {
    addonRepository.isAddonEnabled(url);
    assert.equal(reads.includes("installedAddonEnabledStates"), false);
  } finally {
    globalThis.localStorage.getItem = getItem;
  }

  const envelope = LocalStore.get("installedAddonEnabledStates");
  envelope.profiles["1"] = { [url]: false };
  LocalStore.set("installedAddonEnabledStates", envelope);
  assert.equal(addonRepository.isAddonEnabled(url), false);
});
