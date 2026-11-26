import assert from "node:assert/strict";
import test from "node:test";

const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: (key) => storageMap.delete(String(key)),
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  }
};

globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const { AuthManager } = await import("../auth/authManager.js");
const { AuthState } = await import("../auth/authState.js");
const { ProfileManager } = await import("./profileManager.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { LocalStore } = await import("../storage/localStore.js");
const { ProviderCredentialSyncService } = await import("./providerCredentialSyncService.js");

test("ProviderCredentialSyncService scopes foreground pull cooldown per profile and skips stale overwrite when pending", async () => {
  const originalAuthState = AuthManager.state;
  const originalGetEffectiveUserId = AuthManager.getEffectiveUserId;
  const originalGetActiveProfileId = ProfileManager.getActiveProfileId;
  const originalGetProfileDataVersion = ProfileManager.getProfileDataVersion;
  const originalRpc = SupabaseApi.rpc;

  let activeProfileId = 1;
  let injectedPendingMidPull = false;

  try {
    AuthManager.state = AuthState.AUTHENTICATED;
    AuthManager.getEffectiveUserId = async () => "user-1";
    ProfileManager.getActiveProfileId = () => activeProfileId;
    ProfileManager.getProfileDataVersion = () => 1;

    await ProviderCredentialSyncService.stop({ waitForInFlight: false });

    SupabaseApi.rpc = async (fn, params) => {
      if (fn === "sync_pull_provider_credentials") {
        if (injectedPendingMidPull) {
          LocalStore.set("providerCredentialSyncPendingProfiles", { "user-1:1": Date.now() });
        }
        return [{ provider: "mdblist", credential_json: { api_key: "remote-key" } }];
      }
      return [];
    };

    // 1. Pull completed for profile 1 should NOT block foreground pull immediately after switching to profile 2.
    await ProviderCredentialSyncService.syncFromRemote(1);
    activeProfileId = 2;
    const queuedForProfile2 = ProviderCredentialSyncService.requestForegroundPull(false);
    ProviderCredentialSyncService.cancelForegroundPull();
    assert.equal(
      queuedForProfile2,
      true,
      "Profile 1 pull cooldown must not suppress Profile 2 foreground pull"
    );

    // 2. If profile becomes dirty while pull is in flight, syncFromRemote must return false without applying remote row.
    activeProfileId = 1;
    injectedPendingMidPull = true;
    const appliedWhenDirty = await ProviderCredentialSyncService.syncFromRemote(1);
    assert.equal(
      appliedWhenDirty,
      false,
      "syncFromRemote must skip applying remote rows when pending became set mid-flight"
    );
  } finally {
    await ProviderCredentialSyncService.stop({ waitForInFlight: false });
    LocalStore.remove("providerCredentialSyncPendingProfiles");
    AuthManager.state = originalAuthState;
    AuthManager.getEffectiveUserId = originalGetEffectiveUserId;
    ProfileManager.getActiveProfileId = originalGetActiveProfileId;
    ProfileManager.getProfileDataVersion = originalGetProfileDataVersion;
    SupabaseApi.rpc = originalRpc;
  }
});
