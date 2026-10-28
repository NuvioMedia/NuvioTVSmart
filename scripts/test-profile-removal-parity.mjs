import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const entries = new Map();
globalThis.localStorage = {
  get length() {
    return entries.size;
  },
  key: (i) => [...entries.keys()][i] ?? null,
  getItem: (k) => entries.get(k) ?? null,
  setItem: (k, v) => entries.set(k, String(v)),
  removeItem: (k) => entries.delete(k),
  clear: () => entries.clear()
};
let rpc;
globalThis.__removalHttp = (url, options = {}) =>
  rpc(
    new URL(url, "https://fixture.invalid").pathname.split("/").pop(),
    options.body ? JSON.parse(options.body) : {},
    options
  );
globalThis.__removalAuth = { isAuthenticated: true, getEffectiveUserId: async () => "owner-a" };
const bundle = await build({
  stdin: {
    contents: `
    export { HomeCatalogSettingsSyncService, mergedSharedPayload } from "./js/core/profile/homeCatalogSettingsSyncService.js";
    export { SimklSyncService } from "./js/data/repository/simklSyncService.js";
    export { beginManualWatched, captureManualWatched, finishManualWatched, manualWatchedCurrent, hasPendingManualWatched } from "./js/data/mediaserver/manualServerWatched.js";
    export { SupabaseApi } from "./js/data/remote/supabase/supabaseApi.js";
    export { downloadCode } from "./js/core/player/pluginManager.js";
    export { PluginServiceClient } from "./js/platform/pluginServiceClient.js";
    export { ProfileManager } from "./js/core/profile/profileManager.js";
    export { ProfileSyncService } from "./js/core/profile/profileSyncService.js";
    export { PluginCodeStore } from "./js/data/local/pluginCodeStore.js";
    export { PluginStore } from "./js/data/local/pluginStore.js";
    export { queueProfileSettingsCloudSync, stopProfileSettingsCloudSync } from "./js/data/local/profileScopedStore.js";
    export { pullProfileSettingsUnlocked } from "./js/core/profile/profileSettingsSyncServiceHelpers-05-supported-feature-names.js";
    export { WatchProgressStore } from "./js/data/local/watchProgressStore.js";
  `,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "fixtures",
      setup(b) {
        b.onLoad({ filter: /\/repository\/simklAuthService\.js$/ }, () => ({
          contents:
            "export const SimklAuthService = { isAuthenticated: () => true }; export const simklRequest = (...args) => globalThis.__removalSimklRequest(...args);"
        }));
        b.onLoad({ filter: /\/core\/auth\/authManager\.js$/ }, () => ({
          contents: "export const AuthManager = globalThis.__removalAuth;"
        }));
        b.onLoad({ filter: /\/core\/network\/httpClient\.js$/ }, () => ({
          contents: "export const httpRequest = (...args) => globalThis.__removalHttp(...args);"
        }));
        b.onLoad({ filter: /\/core\/player\/pluginManager\.js$/ }, async ({ path }) => ({
          contents: (await readFile(path, "utf8")) + "\nexport { downloadCode };"
        }));
      }
    }
  ]
});
const directory = await mkdtemp(join(tmpdir(), "profile-removal-"));
const modulePath = join(directory, "fixture.mjs");
await writeFile(modulePath, bundle.outputFiles[0].text);
const {
  HomeCatalogSettingsSyncService,
  mergedSharedPayload,
  SimklSyncService,
  hasPendingManualWatched,
  beginManualWatched,
  captureManualWatched,
  finishManualWatched,
  manualWatchedCurrent,
  SupabaseApi,
  downloadCode,
  PluginServiceClient,
  ProfileManager: manager,
  ProfileSyncService: sync,
  PluginCodeStore: code,
  PluginStore: plugins,
  queueProfileSettingsCloudSync,
  stopProfileSettingsCloudSync,
  pullProfileSettingsUnlocked,
  WatchProgressStore
} = await import(pathToFileURL(modulePath).href);
await rm(directory, { recursive: true });
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const read = (k) => JSON.parse(localStorage.getItem(k));
const profiles = [
  { id: "1", name: "Main" },
  { id: "2", name: "Old" },
  { id: "3", name: "Other" }
];
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await stopProfileSettingsCloudSync();
  await code.clearAll();
  entries.clear();
  put("profiles", profiles);
  localStorage.setItem("access_token", "owner-a-token");
  globalThis.__removalAuth.isAuthenticated = true;
  rpc = async () => {
    throw new Error("Unexpected network request");
  };
});
afterEach(() => stopProfileSettingsCloudSync());

test("remote removal clears all persisted shapes, preserves other profiles and permits clean slot reuse", async () => {
  const maps = [
    "streamLinkCache",
    "streamPreferences",
    "trackPreferences",
    "trackPreferenceSyncPayload",
    "subtitleDelayPreferences",
    "continueWatchingPreferences",
    "libraryPreferences",
    "searchHistory",
    "mdbListAccounts",
    "mdbListLibraries",
    "episodeShuffle",
    "watchProgressSyncState",
    "watchedItemsSyncState",
    "profileSettingsSyncCache",
    "profileSettingsSyncPendingProfiles"
  ];
  const envelopes = [
    "playerSettings",
    "themeSettings",
    "debridSettings",
    "mediaServerConnections",
    "installedAddonUrls",
    "torrentSettings",
    "futureProfileStore"
  ];
  const values = { 1: { keep: "main" }, 2: { secret: "old" }, 3: { keep: "other" } };
  for (const k of maps) put(k, values);
  for (const k of envelopes) put(k, { __profileScoped: true, version: 1, profiles: values });
  for (const k of ["traktAuthState", "simklAuthState", "simklSyncState"])
    put(k, { version: 1, profiles: values });
  for (const k of ["watchProgressItems", "watchedItems", "savedLibraryItems"])
    put(
      k,
      profiles.map(({ id }) => ({ profileId: id, contentId: "tt1" }))
    );
  WatchProgressStore.listAll();
  put("homeContinueWatchingDisplaySnapshot", {
    "1:TRAKT": "main",
    "2:TRAKT": "old",
    "2:NUVIO_SYNC": "old",
    "3:SIMKL": "other",
    "12:TRAKT": "keep"
  });
  put("startupSyncState", { "owner:p1": "main", "owner:p2": "old", "owner:p3": "other" });
  for (const k of ["homeCatalogSettingsPendingPushTokens", "providerCredentialSyncPendingProfiles"])
    put(k, { "owner:1": "main", "owner:2": "old", 2: "legacy", "owner:12": "keep" });
  const prefixes = [
    "cloudLibraryPlaybackSessions",
    "cloudLibraryPlaybackProgress",
    "libraryTraktState:owner"
  ];
  for (const p of prefixes) for (const id of ["1", "2", "3", "12"]) put(`${p}:${id}`, { id });
  const shared = {
    deviceLocalPlayerPreferences: { aspectMode: "FIT" },
    mediaServerDeviceId: "device",
    homeContinueWatchingEnrichmentCache: { "movie:tt1::": { title: "Shared metadata" } },
    unrelated: { 2: "keep" }
  };
  for (const [k, v] of Object.entries(shared)) put(k, v);
  await manager.setActiveProfile("2");
  assert.equal(await manager.replaceProfiles([profiles[0], profiles[2]]), true);
  assert.equal(manager.getActiveProfileId(), "1");
  for (const k of maps) assert.deepEqual(read(k), { 1: values[1], 3: values[3] }, k);
  for (const k of [...envelopes, "traktAuthState", "simklAuthState", "simklSyncState"])
    assert.deepEqual(read(k).profiles, { 1: values[1], 3: values[3] }, k);
  for (const k of ["watchProgressItems", "watchedItems", "savedLibraryItems"])
    assert.deepEqual(
      read(k).map((i) => i.profileId),
      ["1", "3"],
      k
    );
  assert.equal(WatchProgressStore.listForProfile("2").length, 0);
  assert.deepEqual(Object.keys(read("homeContinueWatchingDisplaySnapshot")), [
    "1:TRAKT",
    "3:SIMKL",
    "12:TRAKT"
  ]);
  assert.deepEqual(read("startupSyncState"), { "owner:p1": "main", "owner:p3": "other" });
  for (const k of ["homeCatalogSettingsPendingPushTokens", "providerCredentialSyncPendingProfiles"])
    assert.deepEqual(read(k), { "owner:1": "main", "owner:12": "keep" });
  for (const p of prefixes) {
    assert.equal(localStorage.getItem(`${p}:2`), null);
    for (const id of ["1", "3", "12"]) assert.deepEqual(read(`${p}:${id}`), { id });
  }
  for (const [k, v] of Object.entries(shared)) assert.deepEqual(read(k), v, k);
  assert.equal(await manager.createProfile({ name: "New" }), true);
  assert.equal((await manager.getProfiles()).find((p) => p.name === "New").id, "2");
  assert.equal(read("streamLinkCache")[2], undefined);
});

test("local deletion shares cleanup and cannot delete the primary", async () => {
  put("searchHistory", { 1: ["main"], 2: ["private"], 3: ["other"] });
  assert.equal(await manager.deleteProfile("1"), false);
  assert.equal(await manager.deleteProfile("5"), false);
  assert.equal(await manager.deleteProfile("2"), true);
  assert.deepEqual(read("searchHistory"), { 1: ["main"], 3: ["other"] });
});

test("plugin inheritance does not hide private leftovers or delete primary code", async () => {
  await code.save("provider", "main", {}, { profile: "1" });
  await code.save("provider", "private", {}, { profile: "2" });
  plugins.get("1");
  plugins.get("2");
  const primary = structuredClone(read("pluginState").profiles[1]);
  put(
    "profiles",
    profiles.map((p) =>
      p.id === "2" ? { ...p, usesPrimaryPlugins: true, usesPrimaryAddons: true } : p
    )
  );
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  assert.equal((await code.get("provider", "1")).code, "main");
  assert.equal(await code.get("provider", "2"), null);
  assert.deepEqual(read("pluginState").profiles[1], primary);
  assert.equal(read("pluginState").profiles[2], undefined);
});

test("invalid, empty, duplicate and primary-less snapshots leave all data intact", async () => {
  put("streamLinkCache", { 2: "private" });
  for (const snapshot of [
    null,
    {},
    [],
    [{ id: "1" }, {}],
    [{ id: "1" }, { id: "1" }],
    [{ id: "3" }],
    [{ id: "1" }, { id: "7" }],
    [{ id: true }],
    [{ id: [1] }]
  ]) {
    assert.equal(await manager.replaceProfiles(snapshot), false);
    assert.deepEqual(read("streamLinkCache"), { 2: "private" });
    assert.deepEqual(read("profiles"), profiles);
  }
});

test("failed persistent code cleanup does not free the profile slot", async () => {
  const clear = code.clearProfile;
  code.clearProfile = async () => false;
  try {
    await assert.rejects(manager.replaceProfiles([profiles[0], profiles[2]]), /removal failed/);
    assert.deepEqual(
      read("profiles").map((p) => p.id),
      ["1", "2", "3"]
    );
  } finally {
    code.clearProfile = clear;
  }
});

test("remote failures, invalid payloads and outgoing account responses cannot delete profiles", async (t) => {
  t.mock.method(console, "warn", () => {});
  put("streamLinkCache", { 2: "private" });
  for (const payload of [
    null,
    {},
    [{ profile_index: 1 }, {}],
    [{ profile_index: 3 }],
    [{ profile_index: 1 }, { profile_index: 1 }]
  ]) {
    rpc = async () => payload;
    assert.deepEqual(await sync.pull(true), []);
    assert.deepEqual(read("streamLinkCache"), { 2: "private" });
  }
  rpc = async () => {
    throw new Error("offline");
  };
  await sync.pull(true);
  assert.deepEqual(read("streamLinkCache"), { 2: "private" });
  const response = deferred();
  rpc = () => response.promise;
  const pending = sync.pull(true);
  localStorage.setItem("access_token", "owner-b-token");
  response.resolve([{ profile_index: 1 }]);
  await pending;
  assert.deepEqual(read("streamLinkCache"), { 2: "private" });
  rpc = async () => [{ profile_index: 1 }, { profile_index: 3 }];
  await sync.pull(true);
  assert.deepEqual(read("streamLinkCache"), {});
});

test("a pending settings pull cannot restore a removed and recreated slot", async (t) => {
  t.mock.method(console, "warn", () => {});
  const response = deferred();
  rpc = () => response.promise;
  const pending = pullProfileSettingsUnlocked(2);
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  await manager.createProfile({ name: "New" });
  response.resolve({
    settings_json: {
      version: 1,
      features: { player_settings: { subtitle_size: { type: "int", value: 199 } } }
    }
  });
  assert.equal(await pending, false);
  assert.equal(read("profileSettingsSyncCache")?.[2], undefined);
});

test("deletion cancels its settings timer and preserves another profile's pending edit", async () => {
  queueProfileSettingsCloudSync("2", 20);
  queueProfileSettingsCloudSync("3", 10000);
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  let requests = 0;
  rpc = async () => {
    requests++;
    return {};
  };
  await new Promise((done) => setTimeout(done, 40));
  assert.equal(requests, 0);
  assert.equal(read("profileSettingsSyncPendingProfiles")[2], undefined);
  assert.ok(read("profileSettingsSyncPendingProfiles")[3]);
});

test("newly discovered remote slots and locally reused slots discard orphan data", async () => {
  put("profiles", [profiles[0]]);
  put("streamLinkCache", { 2: "orphan", 3: "unrelated" });
  await manager.replaceProfiles([profiles[0], profiles[1]]);
  assert.deepEqual(read("streamLinkCache"), { 3: "unrelated" });
  put("streamLinkCache", { 2: "keep", 3: "orphan" });
  await manager.createProfile({ name: "New" });
  assert.deepEqual(read("streamLinkCache"), { 2: "keep" });
});

test("an unwritable store cannot free a slot while leaving its old data behind", async (t) => {
  put("streamLinkCache", { 1: "main", 2: "old" });
  const write = localStorage.setItem;
  t.mock.method(console, "error", () => {});
  t.mock.method(localStorage, "setItem", (key, value) => {
    if (key === "streamLinkCache") throw new Error("read only");
    return write(key, value);
  });
  await assert.rejects(manager.deleteProfile("2"), /removal failed/);
  assert.deepEqual(read("streamLinkCache"), { 1: "main", 2: "old" });
  assert.deepEqual(
    read("profiles").map((p) => p.id),
    ["1", "2", "3"]
  );
});

test("creation waits for deletion cleanup and then reuses the slot exactly once", async (t) => {
  const started = deferred(),
    release = deferred();
  const clear = code.clearProfile;
  t.mock.method(code, "clearProfile", async (id) => {
    if (id === "2") {
      started.resolve();
      await release.promise;
    }
    return clear.call(code, id);
  });
  const deletion = manager.deleteProfile("2");
  const creation = manager.createProfile({ name: "Replacement" });
  await started.promise;
  assert.equal(read("profiles").find((p) => p.id === "2").name, "Old");
  release.resolve();
  assert.equal(await deletion, true);
  assert.equal(await creation, true);
  const saved = read("profiles");
  assert.equal(new Set(saved.map((p) => p.id)).size, saved.length);
  assert.equal(saved.find((p) => p.id === "2").name, "Replacement");
  assert.equal(saved.find((p) => p.id === "3").name, "Other");
});

test("an account change during asynchronous cleanup cannot erase incoming account settings", async (t) => {
  const started = deferred(),
    release = deferred();
  const clear = code.clearProfile;
  t.mock.method(code, "clearProfile", async (id) => {
    started.resolve();
    await release.promise;
    return clear.call(code, id);
  });
  const removal = manager.deleteProfile("2");
  await started.promise;
  localStorage.setItem("access_token", "incoming-account");
  put("streamLinkCache", { 2: "incoming-account-data" });
  release.resolve();
  await assert.rejects(removal, /account changed/);
  assert.deepEqual(read("streamLinkCache"), { 2: "incoming-account-data" });
});

test("late scoped RPC and table responses are rejected, while another profile's response survives", async () => {
  const responses = [deferred(), deferred(), deferred()];
  let count = 0;
  rpc = () => responses[count++].promise;
  const settled = Promise.allSettled([
    SupabaseApi.rpc("sync_pull_library", { p_profile_id: 2 }),
    SupabaseApi.select("addons", "profile_id=eq.2&select=*"),
    SupabaseApi.rpc("sync_pull_library", { p_profile_id: 3 })
  ]);
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  await manager.createProfile({ name: "Replacement" });
  responses.forEach((response) => response.resolve([{ content_id: "tt1" }]));
  const results = await settled;
  for (const result of results.slice(0, 2)) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason.name, "AbortError");
  }
  assert.equal(results[2].status, "fulfilled");
});

test("plugin code downloaded for the old slot is not cached after its removal", async (t) => {
  const started = deferred(),
    response = deferred();
  t.mock.method(PluginServiceClient, "fetch", () => {
    started.resolve();
    return response.promise;
  });
  const pending = downloadCode(
    {
      id: "late-provider",
      name: "Fixture",
      codeUrl: "https://fixture.invalid/code.js",
      version: "1"
    },
    { id: "fixture", url: "https://fixture.invalid" },
    { providerTimeoutMs: 1000, maxCodeBytes: 1000, maxCacheBytes: 1000 },
    "2"
  );
  await started.promise;
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  await manager.createProfile({ name: "Replacement" });
  response.resolve({ ok: true, body: "fixture-code", status: 200 });
  assert.equal(await pending, false);
  assert.equal(await code.get("late-provider", "2"), null);
});

test("Home catalog memory caches and initial-pull gates do not survive slot reuse", async () => {
  let requests = 0;
  rpc = async () => {
    requests++;
    return { settings_json: { catalog_label: "old" } };
  };
  const first = await mergedSharedPayload(2, { items: [] });
  assert.equal(first.catalog_label, "old");
  HomeCatalogSettingsSyncService.completedInitialPullTokens.add("owner:2");
  HomeCatalogSettingsSyncService.completedInitialPullTokens.add("owner:3");
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  assert.equal(HomeCatalogSettingsSyncService.completedInitialPullTokens.has("owner:2"), false);
  assert.equal(HomeCatalogSettingsSyncService.completedInitialPullTokens.has("owner:3"), true);
  await manager.createProfile({ name: "Replacement" });
  rpc = async () => {
    requests++;
    return { settings_json: { catalog_label: "new" } };
  };
  const next = await mergedSharedPayload(2, { items: [] });
  assert.equal(next.catalog_label, "new");
  assert.equal(requests, 2);
});

test("late Simkl refresh cannot restore a removed slot after that slot becomes active again", async () => {
  await manager.setActiveProfile("2");
  const started = deferred(),
    response = deferred();
  globalThis.__removalSimklRequest = () => {
    started.resolve();
    return response.promise;
  };
  const pending = SimklSyncService.refresh({ force: true });
  await started.promise;
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  await manager.createProfile({ name: "Replacement" });
  await manager.setActiveProfile("2");
  response.resolve({ payload: [] });
  assert.equal(await pending, false);
  assert.equal(read("simklSyncState")?.profiles?.[2], undefined);
});

test("a pending watched action cannot commit or roll back into a recreated profile", async () => {
  await manager.setActiveProfile("2");
  const item = { contentId: "tt1", profileId: "2", watchedAt: 100 };
  const operation = beginManualWatched([item], [item], "2");
  put("watchedItems", []);
  captureManualWatched(operation);
  assert.equal(manualWatchedCurrent(operation, item), true);
  await manager.replaceProfiles([profiles[0], profiles[2]]);
  await manager.createProfile({ name: "Replacement" });
  await manager.setActiveProfile("2");
  assert.equal(manualWatchedCurrent(operation, item), false);
  assert.equal(hasPendingManualWatched(item.contentId, "2"), false);
  finishManualWatched(operation, [item], [], false);
  assert.deepEqual(read("watchedItems"), []);
});

test("requests and profile selections made during cleanup cannot outlive the deleted slot", async (t) => {
  const started = deferred(),
    release = deferred(),
    response = deferred();
  const clear = code.clearProfile;
  t.mock.method(code, "clearProfile", async (id) => {
    started.resolve();
    await release.promise;
    return clear.call(code, id);
  });
  const deletion = manager.deleteProfile("2");
  await started.promise;
  rpc = () => response.promise;
  const request = SupabaseApi.rpc("sync_pull_library", { p_profile_id: 2 });
  const rejected = assert.rejects(request, { name: "AbortError" });
  await manager.setActiveProfile("2");
  release.resolve();
  await deletion;
  assert.equal(manager.getActiveProfileId(), "1");
  response.resolve([]);
  await rejected;
});
