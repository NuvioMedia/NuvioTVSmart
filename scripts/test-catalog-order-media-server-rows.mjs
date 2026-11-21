import test from "node:test";
import assert from "node:assert/strict";

// Media-server rows are part of Home, so "Reorder home catalogs" has to list them,
// "Disable" on them has to survive a server revision change, and a pulled order
// from the account (which never contains server rows) must not move them.

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true
  });
}
globalThis.window = globalThis.window || {
  addEventListener: () => {},
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener: () => {} })
};
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  addEventListener: () => {},
  getElementById: () => null,
  documentElement: { style: {} },
  body: {}
};

const { buildOrderedHomeCatalogItems, isMediaServerCatalogKey, withLocalMediaServerPrefs } =
  await import("../js/core/addons/homeCatalogs.js");
const { addonRepository } = await import("../js/data/repository/addonRepository.js");
const { MediaServerRepository } = await import("../js/data/mediaserver/mediaServerRepository.js");
const { CatalogOrderScreen } = await import("../js/ui/screens/plugin/catalogOrderScreen.js");
const { HomeCatalogSettingsSyncService } =
  await import("../js/core/profile/homeCatalogSettingsSyncService.js");
const { HomeCatalogStore } = await import("../js/data/local/homeCatalogStore.js");
const { AuthManager } = await import("../js/core/auth/authManager.js");
const { AuthState } = await import("../js/core/auth/authState.js");
const { SupabaseApi } = await import("../js/data/remote/supabase/supabaseApi.js");

const addon = {
  id: "org.addon.one",
  baseUrl: "https://addon.example/manifest.json",
  displayName: "Addon",
  catalogs: [{ id: "top", apiType: "movie", name: "Top" }]
};
const server = (revision) => ({
  id: "media-server-conn-1",
  baseUrl: `nuvio-server://conn-1?revision=${revision}`,
  displayName: "Emby",
  catalogs: [
    { id: "resume", apiType: "movie", name: "Continue watching" },
    { id: "lib-7", apiType: "series", name: "TV shows" }
  ]
});

const SERVER_RESUME = "media-server-conn-1_movie_resume";
const SERVER_SHOWS = "media-server-conn-1_series_lib-7";
const ADDON_TOP = "org.addon.one_movie_top";

test("server catalogs are recognised by their order key and base url", () => {
  assert.equal(isMediaServerCatalogKey(SERVER_RESUME), true);
  assert.equal(isMediaServerCatalogKey("nuvio-server://conn-1?revision=3_movie_resume_x"), true);
  assert.equal(isMediaServerCatalogKey(ADDON_TOP), false);
  assert.equal(isMediaServerCatalogKey(""), false);
  assert.equal(isMediaServerCatalogKey(undefined), false);
});

test("the Disable button of a server row stores a key that survives a revision change", () => {
  // The base url of a server carries ?revision=N, which changes whenever the
  // connection is edited, so a disable key built from it stops matching.
  const items = buildOrderedHomeCatalogItems([addon, server(3)], [], [], []);
  const shows = items.find((item) => item.key === SERVER_SHOWS);
  assert.equal(shows.isDisabled, false);
  assert.equal(shows.disableKey, SERVER_SHOWS);
  const afterRevision = buildOrderedHomeCatalogItems(
    [addon, server(4)],
    [],
    [],
    [shows.disableKey]
  );
  assert.equal(afterRevision.find((item) => item.key === SERVER_SHOWS).isDisabled, true);
  const top = items.find((item) => item.key === ADDON_TOP);
  assert.equal(top.disableKey, "https://addon.example/manifest.json_movie_top_Top");
});

test("withLocalMediaServerPrefs keeps server order, disabled rows and titles", () => {
  const remote = {
    order: [ADDON_TOP, "org.other_movie_x"],
    disabled: ["org.other_movie_x"],
    customTitles: { [ADDON_TOP]: "My top" }
  };
  const local = {
    order: [SERVER_RESUME, ADDON_TOP, SERVER_SHOWS, "org.other_movie_x"],
    disabled: [SERVER_SHOWS, ADDON_TOP],
    customTitles: { [SERVER_RESUME]: "Emby now", [ADDON_TOP]: "Local top" }
  };
  assert.deepEqual(withLocalMediaServerPrefs(remote, local), {
    order: [SERVER_RESUME, ADDON_TOP, SERVER_SHOWS, "org.other_movie_x"],
    disabled: ["org.other_movie_x", SERVER_SHOWS],
    customTitles: { [ADDON_TOP]: "My top", [SERVER_RESUME]: "Emby now" }
  });
});

test("withLocalMediaServerPrefs clamps a server position to the remote length and leaves the inputs alone", () => {
  const remote = { order: [ADDON_TOP], disabled: [], customTitles: {} };
  const local = { order: ["a", "b", "c", SERVER_SHOWS], disabled: [], customTitles: {} };
  const frozen = JSON.stringify([remote, local]);
  assert.deepEqual(withLocalMediaServerPrefs(remote, local).order, [ADDON_TOP, SERVER_SHOWS]);
  assert.equal(JSON.stringify([remote, local]), frozen);
});

test("withLocalMediaServerPrefs without local server rows returns the remote prefs", () => {
  const remote = { order: [ADDON_TOP], disabled: ["x"], customTitles: { y: "Y" } };
  const local = { order: [ADDON_TOP, "z"], disabled: ["z"], customTitles: { z: "Z" } };
  assert.deepEqual(withLocalMediaServerPrefs(remote, local), remote);
  assert.deepEqual(withLocalMediaServerPrefs(remote, undefined), remote);
});

test("the reorder screen builds its list from the addons including the media servers", async () => {
  const originalAddons = addonRepository.getInstalledAddons;
  const originalServers = MediaServerRepository.addons;
  const calls = [];
  addonRepository.getInstalledAddons = async (options = {}) => {
    calls.push(options);
    return options.includeMediaServers ? [addon, server(1)] : [addon];
  };
  try {
    const model = await CatalogOrderScreen.collectModel();
    assert.ok(model.items.some((item) => item.key === SERVER_SHOWS));
    assert.ok(model.items.some((item) => item.key === ADDON_TOP));
    assert.ok(calls.some((options) => options.includeMediaServers === true));
  } finally {
    addonRepository.getInstalledAddons = originalAddons;
    MediaServerRepository.addons = originalServers;
  }
});

test("a pull from the account keeps this device's media-server rows in place", async () => {
  storage.clear();
  const originalState = AuthManager.state;
  const originalRpc = SupabaseApi.rpc;
  const originalAddons = addonRepository.getInstalledAddons;
  const other = {
    ...addon,
    id: "org.addon.two",
    baseUrl: "https://two.example/manifest.json",
    catalogs: [{ id: "new", apiType: "movie", name: "New" }]
  };
  const OTHER_NEW = "org.addon.two_movie_new";
  addonRepository.getInstalledAddons = async (options = {}) =>
    options.includeMediaServers ? [addon, other, server(1)] : [addon, other];
  // This device: Emby's resume row first, its library row last and hidden.
  HomeCatalogStore.setForProfile(
    1,
    {
      order: [SERVER_RESUME, ADDON_TOP, OTHER_NEW, SERVER_SHOWS],
      disabled: [SERVER_SHOWS],
      customTitles: { [SERVER_RESUME]: "Emby now" }
    },
    { silentSync: true }
  );
  // The account, written by another device that has no media server.
  AuthManager.state = AuthState.AUTHENTICATED;
  SupabaseApi.rpc = async () => [
    {
      settings_json: { order: [OTHER_NEW, ADDON_TOP], disabled: [] },
      updated_at: "2026-11-21T00:00:00Z"
    }
  ];
  try {
    await HomeCatalogSettingsSyncService.pull(1);
    const prefs = HomeCatalogStore.getForProfile(1);
    assert.deepEqual(prefs.order, [SERVER_RESUME, OTHER_NEW, ADDON_TOP, SERVER_SHOWS]);
    assert.deepEqual(prefs.disabled, [SERVER_SHOWS]);
    assert.equal(prefs.customTitles[SERVER_RESUME], "Emby now");
  } finally {
    AuthManager.state = originalState;
    SupabaseApi.rpc = originalRpc;
    addonRepository.getInstalledAddons = originalAddons;
  }
});

test("what this device pushes to the account does not change when media-server rows are in its prefs", async () => {
  const originalState = AuthManager.state;
  const originalRpc = SupabaseApi.rpc;
  const originalAddons = addonRepository.getInstalledAddons;
  addonRepository.getInstalledAddons = async (options = {}) =>
    options.includeMediaServers ? [addon, server(1)] : [addon];
  AuthManager.state = AuthState.AUTHENTICATED;
  const pushed = [];
  SupabaseApi.rpc = async (name, body) => {
    if (/push/.test(name)) pushed.push(JSON.parse(JSON.stringify(body)));
    return [];
  };
  const pushWith = async (prefs) => {
    storage.clear();
    HomeCatalogStore.setForProfile(1, prefs, { silentSync: true });
    await HomeCatalogSettingsSyncService.push(1);
    return pushed.pop();
  };
  try {
    const withoutServer = await pushWith({ order: [ADDON_TOP], disabled: [], customTitles: {} });
    const withServer = await pushWith({
      order: [SERVER_RESUME, ADDON_TOP, SERVER_SHOWS],
      disabled: [SERVER_SHOWS],
      customTitles: { [SERVER_RESUME]: "Emby now" }
    });
    assert.ok(withoutServer, "a push was captured");
    assert.deepEqual(withServer, withoutServer);
    assert.ok(!JSON.stringify(withServer).includes("media-server"));
    assert.ok(!JSON.stringify(withServer).includes("nuvio-server"));
  } finally {
    AuthManager.state = originalState;
    SupabaseApi.rpc = originalRpc;
    addonRepository.getInstalledAddons = originalAddons;
  }
});
