import assert from "node:assert/strict";

if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(String(key)) ? storage.get(String(key)) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    key(index) {
      return Array.from(storage.keys())[index] ?? null;
    },
    get length() {
      return storage.size;
    }
  };
}

const { PluginManager } = await import("../js/core/player/pluginManager.js");
const { PluginStore } = await import("../js/data/local/pluginStore.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { AuthManager } = await import("../js/core/auth/authManager.js");
const { SupabaseApi } = await import("../js/data/remote/supabase/supabaseApi.js");
const { plugin_settings } =
  await import("../js/core/profile/profileSettingsSyncFeature-plugin-settings.js");
const { buildOutgoingBlob, pullProfileSettingsUnlocked } =
  await import("../js/core/profile/profileSettingsSyncServiceHelpers-05-supported-feature-names.js");
const { cancelProfileSettingsCloudSync, hasProfileSettingsCloudSyncPending } =
  await import("../js/data/local/profileScopedStore.js");
const { PLUGIN_REPOSITORY_TYPES, normalizePluginState } =
  await import("../js/core/player/pluginModels.js");

const repository = {
  id: "settings-sync-repository",
  url: "https://sync.example/repository/manifest.json",
  name: "Sync repository",
  type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
  enabled: true,
  scraperCount: 1
};
const scraper = {
  id: "settings-sync-provider",
  repositoryId: repository.id,
  type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
  name: "Sync provider",
  filename: "sync.js",
  codeUrl: "https://sync.example/sync.js",
  codeAvailable: true,
  enabled: false
};

const previousProfileId = ProfileManager.getActiveProfileId();
const previousState = PluginStore.get("1");
const previousProfiles = localStorage.getItem("profiles");
const previousAuthState = AuthManager.state;
const previousRpc = SupabaseApi.rpc;
try {
  await ProfileManager.setActiveProfile("1");
  PluginStore.replace(
    normalizePluginState({
      repositories: [repository],
      scrapers: [scraper],
      settings: {
        pluginsEnabled: true,
        groupStreamsByRepository: false,
        scraperSettings: { [scraper.id]: { option: "local" } }
      },
      syncDirty: false
    }),
    "1"
  );

  assert.deepEqual(plugin_settings.export("1"), { group_streams_by_repository: false });
  assert.deepEqual(plugin_settings.project({ group_streams_by_repository: true }), {
    group_streams_by_repository: true
  });
  assert.deepEqual(plugin_settings.project({ group_streams_by_repository: "false" }), {});
  assert.deepEqual(plugin_settings.project({}), {});

  // The Android profile-settings blob is allowed to carry only the grouping
  // key. Repository and provider state must stay device-local.
  assert.equal(
    plugin_settings.import("1", {
      group_streams_by_repository: true,
      repositories: '[{"remote":true}]',
      scrapers: '[{"remote":true}]',
      plugins_enabled: false
    }),
    true
  );
  const state = PluginStore.get("1");
  assert.equal(state.settings.groupStreamsByRepository, true);
  assert.equal(state.settings.pluginsEnabled, true);
  assert.equal(state.repositories.length, 1);
  assert.deepEqual(
    state.scrapers[0],
    normalizePluginState({ repositories: [repository], scrapers: [scraper] }).scrapers[0]
  );
  assert.deepEqual(state.settings.scraperSettings[scraper.id], { option: "local" });

  assert.equal(plugin_settings.import("1", {}), false);
  assert.equal(plugin_settings.import("1", { group_streams_by_repository: "false" }), false);
  assert.equal(PluginStore.get("1").settings.groupStreamsByRepository, true);

  assert.deepEqual(
    buildOutgoingBlob("1", {}).features.plugin_settings.group_streams_by_repository,
    { type: "boolean", value: true }
  );

  // Android restores a shared profile's grouping from the primary settings
  // blob, never from the alias's own payload, and keeps its provider toggles.
  const groupingBlob = (grouping) => ({
    version: 1,
    features: {
      plugin_settings: {
        group_streams_by_repository: { type: "boolean", value: grouping }
      }
    }
  });
  localStorage.setItem(
    "profiles",
    JSON.stringify([
      { id: "1", name: "Primary", isPrimary: true },
      { id: "2", name: "Shared", usesPrimaryPlugins: true }
    ])
  );
  AuthManager.state = "authenticated";
  cancelProfileSettingsCloudSync("1");
  cancelProfileSettingsCloudSync("2");
  PluginStore.replace(
    {
      ...PluginStore.get("1"),
      settings: { ...PluginStore.get("1").settings, groupStreamsByRepository: false }
    },
    "1"
  );
  SupabaseApi.rpc = async (_name, params) => [
    { settings_json: groupingBlob(params.p_profile_id === 1) }
  ];
  await ProfileManager.setActiveProfile("2");
  assert.equal(await pullProfileSettingsUnlocked("2"), true);
  const sharedState = PluginStore.get("1");
  assert.equal(sharedState.settings.groupStreamsByRepository, true);
  assert.equal(sharedState.scrapers[0].enabled, false);

  await ProfileManager.setActiveProfile("1");
  cancelProfileSettingsCloudSync("1");
  PluginManager.setGroupStreamsByRepository(false);
  assert.equal(hasProfileSettingsCloudSyncPending("1"), true);
  console.log("plugin settings sync tests passed");
} finally {
  cancelProfileSettingsCloudSync("1");
  cancelProfileSettingsCloudSync("2");
  PluginStore.replace(previousState, "1");
  if (previousProfiles == null) localStorage.removeItem("profiles");
  else localStorage.setItem("profiles", previousProfiles);
  AuthManager.state = previousAuthState;
  SupabaseApi.rpc = previousRpc;
  await ProfileManager.setActiveProfile(previousProfileId);
}
