import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { createProfileScopedStore } from "./profileScopedStore.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import {
  createDefaultPluginState,
  createLegacySource,
  normalizePluginState
} from "../../core/player/pluginModels.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

const PLUGIN_STATE_KEY = "pluginState";
const LEGACY_SOURCES_KEY = "pluginSources";
const LEGACY_ENABLED_KEY = "pluginsEnabled";
const PLUGIN_SYNC_DEBOUNCE_MS = 500;

const pluginSyncTimers = new Map();
const pluginSyncInFlight = new Map();
const pluginStateRevisions = new Map();
const pluginRemoteSyncDepth = new Map();
let pluginSyncGeneration = 0;

function readProfiles() {
  const profiles = LocalStore.get("profiles", []);
  return Array.isArray(profiles) ? profiles : [];
}

function readBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

export function getEffectivePluginProfileId(profileId = ProfileManager.getActiveProfileId()) {
  const normalized = String(
    profileId == null ? ProfileManager.getActiveProfileId() : profileId || "1"
  );
  const profile = readProfiles().find(
    (entry) => String(entry?.id || entry?.profileIndex || "") === normalized
  );
  const usesPrimaryPlugins = readBooleanFlag(
    profile?.usesPrimaryPlugins ?? profile?.uses_primary_plugins
  );
  return usesPrimaryPlugins && normalized !== "1" ? "1" : normalized;
}

function normalizedPluginProfileId(profileId = ProfileManager.getActiveProfileId()) {
  return String(getEffectivePluginProfileId(profileId) || "1");
}

function areTizenPluginsSupported() {
  return TizenCapabilities.canUsePlugins();
}

function isRemoteSyncActive(profileId) {
  return Number(pluginRemoteSyncDepth.get(normalizedPluginProfileId(profileId)) || 0) > 0;
}

function cancelPluginCloudSync(profileId) {
  const normalizedProfileId = normalizedPluginProfileId(profileId);
  const timer = pluginSyncTimers.get(normalizedProfileId);
  if (timer) clearTimeout(timer);
  pluginSyncTimers.delete(normalizedProfileId);
}

const scopedStore = createProfileScopedStore({
  key: PLUGIN_STATE_KEY,
  normalize: normalizePluginState,
  // Android keeps an independent profile's plugin DataStore empty until that
  // profile receives its own remote repositories. Sharing is enabled only by
  // the explicit usesPrimaryPlugins profile flag.
  seedFromPrimary: false,
  // pluginState and pluginSources were global before profile scoping was
  // introduced. Migrate that legacy state to the primary profile only; an
  // independent secondary profile must not inherit it implicitly.
  legacyProfileIds: ["1"]
});

function migrateLegacyIfNeeded(profileId) {
  const effectiveProfileId = getEffectivePluginProfileId(profileId);
  const existing = scopedStore.getForProfile(effectiveProfileId);
  const hasState =
    existing.repositories.length || existing.scrapers.length || existing.legacySources.length;
  // The legacy plugin keys were global. They belong to the primary profile
  // when migrating, never to an independent secondary profile.
  if (String(effectiveProfileId) !== "1") {
    return existing;
  }
  if (hasState || LocalStore.get(`${PLUGIN_STATE_KEY}:migrationComplete`, false)) {
    return existing;
  }

  const legacySources = LocalStore.get(LEGACY_SOURCES_KEY, []);
  const migrated = normalizePluginState({
    ...createDefaultPluginState(),
    legacySources: Array.isArray(legacySources) ? legacySources : [],
    settings: {
      pluginsEnabled: LocalStore.get(LEGACY_ENABLED_KEY, true) !== false,
      groupStreamsByRepository: false,
      scraperSettings: {}
    },
    // Legacy URL-template sources have no Android/cloud repository row. Keep
    // them locally without blocking synchronization of modern repositories.
    syncDirty: false
  });
  scopedStore.replaceForProfile(effectiveProfileId, migrated, { silentSync: true });
  LocalStore.set(`${PLUGIN_STATE_KEY}:migrationComplete`, true);
  return migrated;
}

function readState(profileId = ProfileManager.getActiveProfileId()) {
  return migrateLegacyIfNeeded(profileId);
}

function writeState(profileId, state) {
  const effectiveProfileId = normalizedPluginProfileId(profileId);
  const normalized = normalizePluginState(state);
  scopedStore.replaceForProfile(effectiveProfileId, normalized, { silentSync: true });
  pluginStateRevisions.set(
    effectiveProfileId,
    Number(pluginStateRevisions.get(effectiveProfileId) || 0) + 1
  );
  if (
    normalized.syncDirty &&
    areTizenPluginsSupported() &&
    !isRemoteSyncActive(effectiveProfileId)
  ) {
    queuePluginCloudSync(effectiveProfileId);
  } else if (!normalized.syncDirty || !areTizenPluginsSupported()) {
    cancelPluginCloudSync(effectiveProfileId);
  }
  return normalized;
}

async function runPluginCloudSync(profileId, generation = pluginSyncGeneration) {
  if (generation !== pluginSyncGeneration) {
    return false;
  }
  const normalizedProfileId = normalizedPluginProfileId(profileId);
  if (!areTizenPluginsSupported()) {
    cancelPluginCloudSync(normalizedProfileId);
    return false;
  }
  if (isRemoteSyncActive(normalizedProfileId)) {
    queuePluginCloudSync(normalizedProfileId, PLUGIN_SYNC_DEBOUNCE_MS);
    return false;
  }

  while (true) {
    if (generation !== pluginSyncGeneration) {
      return false;
    }
    const activePush = pluginSyncInFlight.get(normalizedProfileId);
    if (!activePush) break;
    await activePush.catch(() => false);
    if (generation !== pluginSyncGeneration) {
      return false;
    }
    if (isRemoteSyncActive(normalizedProfileId)) {
      queuePluginCloudSync(normalizedProfileId, PLUGIN_SYNC_DEBOUNCE_MS);
      return false;
    }
  }
  if (!readState(normalizedProfileId).syncDirty) {
    return false;
  }

  let pushPromise = null;
  pushPromise = import("../../core/profile/pluginSyncService.js")
    .then(({ PluginSyncService }) => PluginSyncService.push(normalizedProfileId))
    .catch((error) => {
      console.warn("Plugin cloud sync enqueue failed", error);
      return false;
    })
    .finally(() => {
      if (pluginSyncInFlight.get(normalizedProfileId) === pushPromise) {
        pluginSyncInFlight.delete(normalizedProfileId);
      }
    });
  pluginSyncInFlight.set(normalizedProfileId, pushPromise);
  const didPush = await pushPromise;
  if (generation !== pluginSyncGeneration) {
    return false;
  }
  if (!didPush) {
    const retryDelayMs = getSyncBackoffRemainingMs();
    if (retryDelayMs > 0) {
      queuePluginCloudSync(normalizedProfileId, Math.max(5000, retryDelayMs));
    }
  }
  return didPush;
}

function queuePluginCloudSync(profileId, delayMs = PLUGIN_SYNC_DEBOUNCE_MS) {
  const normalizedProfileId = normalizedPluginProfileId(profileId);
  if (!areTizenPluginsSupported()) {
    cancelPluginCloudSync(normalizedProfileId);
    return;
  }
  const previousTimer = pluginSyncTimers.get(normalizedProfileId);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }
  const generation = pluginSyncGeneration;
  const timer = setTimeout(
    () => {
      if (generation !== pluginSyncGeneration) {
        return;
      }
      pluginSyncTimers.delete(normalizedProfileId);
      void runPluginCloudSync(normalizedProfileId, generation);
    },
    Math.max(0, Number(delayMs) || 0)
  );
  pluginSyncTimers.set(normalizedProfileId, timer);
}

function stopPluginCloudSync({ waitForInFlight = true } = {}) {
  const pending = waitForInFlight ? [...pluginSyncInFlight.values()] : [];
  pluginSyncGeneration += 1;
  pluginSyncTimers.forEach((timerId) => clearTimeout(timerId));
  pluginSyncTimers.clear();
  pluginSyncInFlight.clear();
  pluginRemoteSyncDepth.clear();
  if (!waitForInFlight || pending.length === 0) {
    return Promise.resolve(true);
  }
  return Promise.allSettled(pending).then(() => true);
}

registerSessionTeardownHandler?.(({ waitForInFlight = true } = {}) =>
  stopPluginCloudSync({ waitForInFlight })
);

export const PluginStore = {
  get(profileId = ProfileManager.getActiveProfileId()) {
    return readState(profileId);
  },

  replace(nextState, profileId = ProfileManager.getActiveProfileId()) {
    return writeState(profileId, nextState);
  },

  update(mutator, profileId = ProfileManager.getActiveProfileId()) {
    const current = readState(profileId);
    const next = typeof mutator === "function" ? mutator(current) : current;
    return writeState(profileId, next || current);
  },

  canEdit(profileId = ProfileManager.getActiveProfileId()) {
    const normalized = String(profileId || "1");
    const profile = readProfiles().find(
      (entry) => String(entry?.id || entry?.profileIndex || "") === normalized
    );
    const usesPrimaryPlugins = readBooleanFlag(
      profile?.usesPrimaryPlugins ?? profile?.uses_primary_plugins
    );
    return normalized === "1" || !usesPrimaryPlugins;
  },

  markDirty(profileId = ProfileManager.getActiveProfileId()) {
    return this.update((state) => ({ ...state, syncDirty: true }), profileId);
  },

  getRevision(profileId = ProfileManager.getActiveProfileId()) {
    return Number(pluginStateRevisions.get(normalizedPluginProfileId(profileId)) || 0);
  },

  beginRemoteSync(profileId = ProfileManager.getActiveProfileId()) {
    const normalizedProfileId = normalizedPluginProfileId(profileId);
    pluginRemoteSyncDepth.set(
      normalizedProfileId,
      Number(pluginRemoteSyncDepth.get(normalizedProfileId) || 0) + 1
    );
  },

  endRemoteSync(profileId = ProfileManager.getActiveProfileId()) {
    const normalizedProfileId = normalizedPluginProfileId(profileId);
    const nextDepth = Math.max(0, Number(pluginRemoteSyncDepth.get(normalizedProfileId) || 0) - 1);
    if (nextDepth) {
      pluginRemoteSyncDepth.set(normalizedProfileId, nextDepth);
      return false;
    }
    pluginRemoteSyncDepth.delete(normalizedProfileId);
    if (!areTizenPluginsSupported()) {
      cancelPluginCloudSync(normalizedProfileId);
      return false;
    }
    if (!readState(normalizedProfileId).syncDirty) return false;
    queuePluginCloudSync(normalizedProfileId);
    return true;
  },

  async flushCloudSync(profileId = ProfileManager.getActiveProfileId()) {
    const normalizedProfileId = normalizedPluginProfileId(profileId);
    if (!areTizenPluginsSupported()) {
      cancelPluginCloudSync(normalizedProfileId);
      return false;
    }
    if (isRemoteSyncActive(normalizedProfileId) || !readState(normalizedProfileId).syncDirty) {
      return false;
    }
    cancelPluginCloudSync(normalizedProfileId);
    return runPluginCloudSync(normalizedProfileId, pluginSyncGeneration);
  },

  clearDirty(profileId = ProfileManager.getActiveProfileId(), expectedRevision = null) {
    const normalizedProfileId = normalizedPluginProfileId(profileId);
    if (
      expectedRevision != null &&
      this.getRevision(normalizedProfileId) !== Number(expectedRevision)
    ) {
      return false;
    }
    const state = readState(normalizedProfileId);
    if (!state.syncDirty) return false;
    writeState(normalizedProfileId, { ...state, syncDirty: false });
    return true;
  },

  clearProfile(profileId) {
    const normalizedProfileId = String(profileId || "").trim();
    if (!normalizedProfileId || normalizedProfileId === "1") return false;
    // Private leftovers may predate inheritance; never resolve this id to 1.
    clearTimeout(pluginSyncTimers.get(normalizedProfileId));
    pluginSyncTimers.delete(normalizedProfileId);
    pluginStateRevisions.set(
      normalizedProfileId,
      (pluginStateRevisions.get(normalizedProfileId) || 0) + 1
    );
    pluginRemoteSyncDepth.delete(normalizedProfileId);
    scopedStore.clearProfile(normalizedProfileId, { silentSync: true });
    return true;
  },

  migrateLegacySource(source, index = 0, profileId = ProfileManager.getActiveProfileId()) {
    return this.update(
      (state) => ({
        ...state,
        legacySources: [...state.legacySources, createLegacySource(source, index)],
        syncDirty: state.syncDirty
      }),
      profileId
    );
  },

  key: PLUGIN_STATE_KEY,
  legacyKeys: Object.freeze([LEGACY_SOURCES_KEY, LEGACY_ENABLED_KEY])
};
