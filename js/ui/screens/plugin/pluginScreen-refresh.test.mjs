import assert from "node:assert/strict";
import { test } from "node:test";

if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return storage.get(String(key)) ?? null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    }
  };
}

const [
  { LibrarySyncService },
  { addonRepository },
  { catalogRepository },
  { Router },
  { DiscoverScreen },
  { PluginScreen }
] = await Promise.all([
  import("../../../core/profile/librarySyncService.js"),
  import("../../../data/repository/addonRepository.js"),
  import("../../../data/repository/catalogRepository.js"),
  import("../../navigation/routerState.js"),
  import("../search/discoverScreen.js"),
  import("./pluginScreen.js")
]);

const ADDON_URL = "https://example.test/addon";

function replaceProperty(target, key, value, restorers) {
  const hadOwnProperty = Object.hasOwn(target, key);
  const previousValue = target[key];
  target[key] = value;
  restorers.push(() => {
    if (hadOwnProperty) {
      target[key] = previousValue;
    } else {
      delete target[key];
    }
  });
}

function makeManifest(catalogId) {
  return {
    id: "test-addon",
    name: "Test Addon",
    displayName: "Test Addon",
    version: "1.0.0",
    baseUrl: ADDON_URL,
    types: ["movie"],
    catalogs: [
      {
        id: catalogId,
        name: "Test Catalog",
        apiType: "movie",
        extra: []
      }
    ],
    resources: []
  };
}

function prepareScreenHarness(restorers) {
  replaceProperty(PluginScreen, "syncing", false, restorers);
  replaceProperty(PluginScreen, "render", async () => {}, restorers);
  replaceProperty(Router, "getCurrent", () => "plugin", restorers);
  replaceProperty(LibrarySyncService, "pull", async () => {}, restorers);
}

test("manual addon refresh reloads manifest catalogs before Discover reads them", async () => {
  const restorers = [];
  const calls = [];
  const oldManifest = makeManifest("old-catalog");
  const newManifest = makeManifest("new-catalog");

  prepareScreenHarness(restorers);
  replaceProperty(LibrarySyncService, "pull", async () => calls.push("sync"), restorers);
  replaceProperty(addonRepository, "getInstalledAddonUrls", () => [ADDON_URL], restorers);
  replaceProperty(addonRepository, "isAddonEnabled", () => true, restorers);
  replaceProperty(
    addonRepository,
    "getAddonEnabledStates",
    () => ({ [ADDON_URL]: true }),
    restorers
  );
  replaceProperty(addonRepository, "getAddonDisplayNameOverrides", () => ({}), restorers);
  replaceProperty(addonRepository, "getAddonDisplayNameOverride", () => "", restorers);
  replaceProperty(addonRepository, "getActiveStorageProfileId", () => "test-profile", restorers);
  replaceProperty(addonRepository, "manifestCache", new Map([[ADDON_URL, oldManifest]]), restorers);
  replaceProperty(addonRepository, "manifestCacheTimestamps", new Map(), restorers);
  replaceProperty(addonRepository, "manifestErrorCache", new Map(), restorers);
  replaceProperty(addonRepository, "manifestRefreshRequests", new Map(), restorers);
  replaceProperty(addonRepository, "installedAddonsCache", null, restorers);
  replaceProperty(addonRepository, "installedAddonsCacheKey", "", restorers);
  replaceProperty(addonRepository, "installedAddonsPromise", null, restorers);
  replaceProperty(addonRepository, "installedAddonsPromiseKey", "", restorers);
  replaceProperty(
    addonRepository,
    "fetchAddon",
    async function fetchAddon(url, options = {}) {
      if (options.force) {
        calls.push("manifest-fetch");
        this.manifestCache.set(url, newManifest);
      }
      return { status: "success", data: this.manifestCache.get(url) };
    },
    restorers
  );
  const unsubscribe = addonRepository.onManifestCacheChanged(() => calls.push("manifest-notify"));
  restorers.push(unsubscribe);
  replaceProperty(
    catalogRepository,
    "clearCache",
    () => calls.push("catalog-cache-clear"),
    restorers
  );

  try {
    await PluginScreen.refreshAddons({ refreshCatalogs: true });

    const discover = {
      loadToken: 1,
      catalogs: [],
      updateCatalogOptions() {},
      async reloadItems() {}
    };
    await DiscoverScreen.loadCatalogsAndContent.call(discover);

    assert.deepEqual(calls, ["sync", "manifest-fetch", "manifest-notify", "catalog-cache-clear"]);
    assert.equal(discover.catalogs.length, 1);
    assert.equal(discover.catalogs[0].catalogId, "new-catalog");
  } finally {
    restorers.reverse().forEach((restore) => restore());
  }
});

test("automatic addon sync does not force-refresh manifests or catalog responses", async () => {
  const restorers = [];
  const calls = [];
  prepareScreenHarness(restorers);
  replaceProperty(LibrarySyncService, "pull", async () => calls.push("sync"), restorers);
  replaceProperty(
    addonRepository,
    "refreshInstalledAddons",
    async () => calls.push("manifest-refresh"),
    restorers
  );
  replaceProperty(
    catalogRepository,
    "clearCache",
    () => calls.push("catalog-cache-clear"),
    restorers
  );

  try {
    await PluginScreen.refreshAddons();
    assert.deepEqual(calls, ["sync"]);
  } finally {
    restorers.reverse().forEach((restore) => restore());
  }
});
