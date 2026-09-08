const PROFILE_SCOPED_VERSION = 1;

const ACCOUNT_LOCAL_STORAGE_KEYS = new Set([
  "profiles",
  "activeProfileId",
  "rememberLastProfile",
  "hasEverSelectedProfile",
  "installedAddonUrls",
  "installedAddonDisplayNames",
  "installedAddonEnabledStates",
  "watchedItems",
  "savedLibraryItems",
  "watchProgressItems",
  "streamPreferences",
  "trackPreferences",
  "trackPreferenceSyncPayload",
  "continueWatchingPreferences",
  "libraryPreferences",
  "traktAuthState",
  "simklAuthState",
  "simklSyncState",
  "startupSyncState",
  "watchProgressSyncState",
  "watchedItemsSyncState",
  "profileSettingsSyncCache",
  "profileSettingsSyncPendingProfiles",
  "homeCatalogSettingsPendingPushTokens",
  "providerCredentialSyncPendingProfiles",
  "homeContinueWatchingDisplaySnapshot",
  "homeContinueWatchingEnrichmentCache",
  "memberAccessCache",
  "manualSyncCode",
  "pluginSources",
  "pluginsEnabled",
  "pluginState:migrationComplete",
  "nuvioSyncBackoffState",
  "webos_last_resume_route"
]);

const ACCOUNT_LOCAL_STORAGE_PREFIXES = [
  "cloudLibraryPlaybackSessions:",
  "cloudLibraryPlaybackProgress:",
  "libraryTraktState:",
  "traktCachedStats:"
];

// Android TV keeps torrent settings in a standalone device store when the
// account is cleared. Web currently serializes them as a profile envelope, so
// retain that one key explicitly to preserve the same device-level behavior.
const PRESERVED_PROFILE_SCOPED_KEYS = new Set(["torrentSettings"]);

function isProfileScopedEnvelope(rawValue) {
  if (typeof rawValue !== "string" || !rawValue) {
    return false;
  }

  try {
    const value = JSON.parse(rawValue);
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.__profileScoped === true &&
      Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
      value.profiles &&
      typeof value.profiles === "object" &&
      !Array.isArray(value.profiles)
    );
  } catch (_) {
    return false;
  }
}

function shouldRemoveLocalStorageKey(key, rawValue) {
  if (PRESERVED_PROFILE_SCOPED_KEYS.has(key)) {
    return false;
  }

  return (
    ACCOUNT_LOCAL_STORAGE_KEYS.has(key) ||
    ACCOUNT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    isProfileScopedEnvelope(rawValue)
  );
}

function removeStorageKey(storage, key) {
  try {
    storage.removeItem(key);
  } catch (error) {
    // A TV may temporarily expose a read-only or quota-limited storage area.
    // Keep clearing the remaining account keys and avoid logging their values.
    console.warn("[accountLocalDataReset] Failed to remove local key", key, error);
  }
}

function clearSessionAccountData(storage) {
  try {
    storage?.removeItem?.("homeReturnFocusState");
  } catch (error) {
    console.warn("[accountLocalDataReset] Failed to remove session key", error);
  }
}

export function clearAccountLocalData(
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
) {
  if (!storage) {
    clearSessionAccountData(sessionStorage);
    return;
  }

  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        keys.push(key);
      }
    }
  } catch (error) {
    console.warn("[accountLocalDataReset] Failed to enumerate local storage", error);
    clearSessionAccountData(sessionStorage);
    return;
  }

  keys.forEach((key) => {
    let rawValue = null;
    if (
      !ACCOUNT_LOCAL_STORAGE_KEYS.has(key) &&
      !ACCOUNT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      try {
        rawValue = storage.getItem(key);
      } catch (error) {
        console.warn("[accountLocalDataReset] Failed to inspect local key", key, error);
      }
    }

    if (shouldRemoveLocalStorageKey(key, rawValue)) {
      removeStorageKey(storage, key);
    }
  });

  clearSessionAccountData(sessionStorage);
}

export function hasAccountLocalData(storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const rawValue = storage.getItem(key);
      if (shouldRemoveLocalStorageKey(key, rawValue)) return true;
    }
    return false;
  } catch (error) {
    console.warn("[accountLocalDataReset] Failed to verify local account cleanup", error);
    return true;
  }
}
