import { LocalStore } from "../storage/localStore.js";

const PROFILE_MAP_KEYS = new Set([
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
  "mdbListTracking",
  "mdbListTrackingPlayback",
  "episodeShuffle",
  "watchProgressSyncState",
  "watchedItemsSyncState",
  "profileSettingsSyncCache",
  "profileSettingsSyncPendingProfiles"
]);
const PROFILE_ITEM_KEYS = new Set(["watchProgressItems", "watchedItems", "savedLibraryItems"]);
const OWNER_PROFILE_MAP_KEYS = new Set([
  "homeCatalogSettingsPendingPushTokens",
  "providerCredentialSyncPendingProfiles"
]);

// Shared artwork/enrichment caches and device preferences have no profile owner.
export function clearProfileLocalData(profileId) {
  const id = String(profileId);
  if (!/^[2-6]$/.test(id)) return;
  const storage = globalThis.localStorage;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (
      key === `cloudLibraryPlaybackSessions:${id}` ||
      key === `cloudLibraryPlaybackProgress:${id}` ||
      (key.startsWith("libraryTraktState:") && key.endsWith(`:${id}`))
    ) {
      LocalStore.remove(key);
      if (storage.getItem(key) !== null) throw new Error("Profile data removal failed");
      continue;
    }
    const raw = storage.getItem(key);
    let value;
    try {
      value = JSON.parse(raw);
    } catch (_) {
      continue;
    }
    let changed = false;
    if (PROFILE_ITEM_KEYS.has(key) && Array.isArray(value)) {
      const kept = value.filter((item) => String(item?.profileId || "1") !== id);
      changed = kept.length !== value.length;
      value = kept;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const profiles =
        value.__profileScoped === true ||
        ["traktAuthState", "simklAuthState", "simklSyncState"].includes(key)
          ? value.profiles
          : PROFILE_MAP_KEYS.has(key)
            ? value
            : null;
      if (
        profiles &&
        typeof profiles === "object" &&
        !Array.isArray(profiles) &&
        Object.prototype.hasOwnProperty.call(profiles, id)
      ) {
        delete profiles[id];
        changed = true;
      }
      for (const entry of Object.keys(value)) {
        if (
          (key === "homeContinueWatchingDisplaySnapshot" && entry.startsWith(`${id}:`)) ||
          (key === "startupSyncState" && entry.endsWith(`:p${id}`)) ||
          (OWNER_PROFILE_MAP_KEYS.has(key) && (entry === id || entry.endsWith(`:${id}`)))
        ) {
          delete value[entry];
          changed = true;
        }
      }
    }
    if (changed) {
      LocalStore.set(key, value);
      if (storage.getItem(key) !== JSON.stringify(value))
        throw new Error("Profile data removal failed");
    }
  }
}
