import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

const PROFILE_SCOPED_VERSION = 1;
const PROFILES_KEY = "profiles";
const SETTINGS_SYNC_DEBOUNCE_MS = 1500;
const SETTINGS_SYNC_PENDING_KEY = "profileSettingsSyncPendingProfiles";

const scheduledSettingsSyncTimers = new Map();
const settingsSyncInFlightByProfile = new Map();
let settingsSyncGeneration = 0;
// Normalized envelopes keyed by storage key and memoized on the raw localStorage
// string. Hot-path readers (Home card render, player and ambient ticks) call
// readEnvelope every second on single-core TVs; reparsing, re-normalizing and
// re-serializing an unchanged envelope each time dominated that cost.
const normalizedEnvelopeCache = new Map();

function normalizeProfileId(profileId) {
  const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return raw || "1";
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isProfileScopedEnvelope(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.__profileScoped === true &&
    Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
    value.profiles &&
    typeof value.profiles === "object"
  );
}

function getKnownProfileIds() {
  const storedProfiles = LocalStore.get(PROFILES_KEY, null);
  const ids = Array.isArray(storedProfiles)
    ? storedProfiles
        .map((profile) => String(profile?.id || profile?.profileIndex || "").trim())
        .filter(Boolean)
    : [];
  if (!ids.includes("1")) {
    ids.unshift("1");
  }
  return Array.from(new Set(ids));
}

function createEmptyEnvelope() {
  return {
    __profileScoped: true,
    version: PROFILE_SCOPED_VERSION,
    profiles: {}
  };
}

function normalizeEnvelopeProfiles(profiles = {}, normalize) {
  const normalized = {};
  Object.entries(profiles || {}).forEach(([profileId, value]) => {
    const normalizedProfileId = normalizeProfileId(profileId);
    normalized[normalizedProfileId] = normalize(cloneValue(value) || {});
  });
  return normalized;
}

function readRawStorageText(key) {
  try {
    const text = localStorage.getItem(key);
    return typeof text === "string" || text === null ? text : undefined;
  } catch (_error) {
    return undefined;
  }
}

function invalidateEnvelopeCache(key) {
  normalizedEnvelopeCache.delete(key);
}

function readEnvelope(key, normalize, legacyProfileIds = null) {
  // The memo is keyed on the exact stored string, so any write that bypasses this
  // module (cloud sync, profile cleanup, tests) is picked up on the next read.
  const rawText = readRawStorageText(key);
  const cached = rawText === undefined ? null : normalizedEnvelopeCache.get(key);
  if (cached && cached.rawText === rawText) {
    return cached.envelope;
  }
  invalidateEnvelopeCache(key);

  const raw = LocalStore.get(key, null);
  if (isProfileScopedEnvelope(raw)) {
    const next = {
      ...raw,
      profiles: normalizeEnvelopeProfiles(raw.profiles, normalize)
    };
    const nextText = JSON.stringify(next);
    if (nextText !== (typeof rawText === "string" ? rawText : JSON.stringify(raw))) {
      LocalStore.set(key, next);
    }
    if (rawText !== undefined) {
      // nextText is exactly what LocalStore.set serializes, so a failed write
      // simply misses the memo on the next read instead of returning stale data.
      normalizedEnvelopeCache.set(key, { rawText: nextText, envelope: next });
    }
    return next;
  }

  if (raw == null) {
    return createEmptyEnvelope();
  }

  const profileIds = Array.isArray(legacyProfileIds)
    ? Array.from(new Set(legacyProfileIds.map((profileId) => normalizeProfileId(profileId))))
    : getKnownProfileIds();
  const normalizedLegacy = normalize(cloneValue(raw) || {});
  const migrated = createEmptyEnvelope();
  profileIds.forEach((profileId) => {
    migrated.profiles[profileId] = cloneValue(normalizedLegacy);
  });
  LocalStore.set(key, migrated);
  return migrated;
}

function persistEnvelope(key, envelope) {
  // The envelope may be the memoized instance; drop it so the next read
  // re-reads whatever the write actually left in storage.
  invalidateEnvelopeCache(key);
  LocalStore.set(key, envelope);
}

function readPendingSettingsSyncProfiles() {
  const value = LocalStore.get(SETTINGS_SYNC_PENDING_KEY, {}) || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function markProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  pending[normalizedProfileId] = Math.max(
    Date.now(),
    Number(pending[normalizedProfileId] || 0) + 1
  );
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function getProfileSettingsCloudSyncPendingVersion(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  return pending[normalizedProfileId] == null ? null : pending[normalizedProfileId];
}

export function clearProfileSettingsCloudSyncPending(profileId = null, expectedVersion = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  if (!Object.prototype.hasOwnProperty.call(pending, normalizedProfileId)) {
    return;
  }
  if (expectedVersion != null && pending[normalizedProfileId] !== expectedVersion) {
    return;
  }
  delete pending[normalizedProfileId];
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function hasProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  return Object.prototype.hasOwnProperty.call(pending, normalizedProfileId);
}

function ensureProfileValue(key, envelope, normalize, profileId, seedFromPrimary = true) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)) {
    return envelope.profiles[normalizedProfileId];
  }

  const primaryValue = envelope.profiles["1"];
  const seed = seedFromPrimary && primaryValue != null ? cloneValue(primaryValue) : normalize({});
  envelope.profiles[normalizedProfileId] = normalize(seed || {});
  persistEnvelope(key, envelope);
  return envelope.profiles[normalizedProfileId];
}

export function queueProfileSettingsCloudSync(
  profileId = null,
  delayMs = SETTINGS_SYNC_DEBOUNCE_MS
) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const generation = settingsSyncGeneration;
  const profileVersion = ProfileManager.getProfileDataVersion(normalizedProfileId);
  const isCurrent = () =>
    generation === settingsSyncGeneration &&
    profileVersion === ProfileManager.getProfileDataVersion(normalizedProfileId);
  markProfileSettingsCloudSyncPending(normalizedProfileId);
  if (scheduledSettingsSyncTimers.has(normalizedProfileId)) {
    clearTimeout(scheduledSettingsSyncTimers.get(normalizedProfileId));
  }
  const timerId = setTimeout(() => {
    if (!isCurrent()) {
      return;
    }
    scheduledSettingsSyncTimers.delete(normalizedProfileId);
    const runPush = async () => {
      if (!isCurrent()) {
        return;
      }
      const activePush = settingsSyncInFlightByProfile.get(normalizedProfileId);
      if (activePush) {
        await activePush.catch(() => false);
      }
      if (!isCurrent()) {
        return;
      }
      const pushPromise = import("../../core/profile/profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) =>
          ProfileSettingsSyncService.push(normalizedProfileId)
        )
        .catch((error) => {
          console.warn("Profile settings sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (settingsSyncInFlightByProfile.get(normalizedProfileId) === pushPromise) {
            settingsSyncInFlightByProfile.delete(normalizedProfileId);
          }
        });
      settingsSyncInFlightByProfile.set(normalizedProfileId, pushPromise);
      const didPush = await pushPromise;
      if (isCurrent() && !didPush && hasProfileSettingsCloudSyncPending(normalizedProfileId)) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueProfileSettingsCloudSync(normalizedProfileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  scheduledSettingsSyncTimers.set(normalizedProfileId, timerId);
}

export function cancelProfileSettingsCloudSync(profileId) {
  const id = normalizeProfileId(profileId);
  clearTimeout(scheduledSettingsSyncTimers.get(id));
  scheduledSettingsSyncTimers.delete(id);
  clearProfileSettingsCloudSyncPending(id);
}

export function stopProfileSettingsCloudSync({ waitForInFlight = true } = {}) {
  const pending = waitForInFlight ? [...settingsSyncInFlightByProfile.values()] : [];
  settingsSyncGeneration += 1;
  scheduledSettingsSyncTimers.forEach((timerId) => clearTimeout(timerId));
  scheduledSettingsSyncTimers.clear();
  settingsSyncInFlightByProfile.clear();
  if (!waitForInFlight || pending.length === 0) {
    return Promise.resolve(true);
  }
  return Promise.allSettled(pending).then(() => true);
}

registerSessionTeardownHandler?.(({ waitForInFlight = true } = {}) =>
  stopProfileSettingsCloudSync({ waitForInFlight })
);

export function createProfileScopedStore({
  key,
  normalize,
  merge,
  seedFromPrimary = true,
  legacyProfileIds = null
}) {
  const mergeValues =
    typeof merge === "function"
      ? merge
      : (current, partial) => ({ ...(current || {}), ...(partial || {}) });

  return {
    getForProfile(profileId) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      return cloneValue(ensureProfileValue(key, envelope, normalize, profileId, seedFromPrimary));
    },

    get() {
      return this.getForProfile(normalizeProfileId());
    },

    replaceForProfile(profileId, nextValue, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      const normalizedProfileId = normalizeProfileId(profileId);
      envelope.profiles[normalizedProfileId] = normalize(cloneValue(nextValue) || {});
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
      return cloneValue(envelope.profiles[normalizedProfileId]);
    },

    setForProfile(profileId, partial, { silentSync = false } = {}) {
      const current = this.getForProfile(profileId);
      return this.replaceForProfile(profileId, mergeValues(current, partial), { silentSync });
    },

    set(partial, options = {}) {
      return this.setForProfile(normalizeProfileId(options.profileId), partial, options);
    },

    clearProfile(profileId, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      const normalizedProfileId = normalizeProfileId(profileId);
      delete envelope.profiles[normalizedProfileId];
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
    }
  };
}
