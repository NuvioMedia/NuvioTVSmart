import { LocalStore } from "../storage/localStore.js";

import { AuthManager } from "../auth/authManager.js";

import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";

import { accentColorForTheme, ThemeStore } from "../../data/local/themeStore.js";

import { LayoutPreferences } from "../../data/local/layoutPreferences.js";

import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";

import { TrackPreferencesStore } from "../../data/local/trackPreferencesStore.js";

import { ContinueWatchingPreferences } from "../../data/local/continueWatchingPreferences.js";

import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";

import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

import { MdbListSettingsStore } from "../../data/local/mdbListSettingsStore.js";

import { TraktSettingsStore, normalizeTraktContinueWatchingDaysCap } from "../../data/local/traktSettingsStore.js";

import { AnimeSkipSettingsStore } from "../../data/local/animeSkipSettingsStore.js";

import { StreamBadgeSettingsStore } from "../../data/local/streamBadgeSettingsStore.js";

import {
  ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE,
  DebridSettingsStore,
  normalizeDebridStreamPreferences
} from "../../data/local/debridSettingsStore.js";

import { parseStreamBadgeRulesFromPayload, normalizeStreamBadgeRules } from "../../core/streams/streamBadgeRules.js";

import { ProfileManager } from "./profileManager.js";

import {
  clearProfileSettingsCloudSyncPending,
  getProfileSettingsCloudSyncPendingVersion,
  hasProfileSettingsCloudSyncPending
} from "../../data/local/profileScopedStore.js";

import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";

import { normalizeSubtitleVerticalOffset } from "../player/subtitleVerticalOffset.js";

import { androidColorIntToSubtitleTextOpacity, normalizeSubtitleTextOpacity } from "../player/subtitleTextOpacity.js";

import { isFastHorizontalNavigationEnabled } from "../../platform/sharedKeys.js";

import { FEATURE_ADAPTERS } from "./profileSettingsSyncServiceHelpers-04-feature-adapters.js";
import { getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import {
  withoutExcludedProfileSettingsKeys,
  stableStringify,
  normalizeBlob,
  encodeFeaturePayload,
  EXCLUDED_PROFILE_KEYS,
  isPlainObject,
  resolveProfileId,
  PULL_RPC,
  SETTINGS_SYNC_PLATFORM,
  setCachedBlob,
  shouldTreatAsMissingResource,
  PUSH_RPC
} from "./profileSettingsSyncServiceHelpers-01-pull-rpc.js";

export const SUPPORTED_FEATURE_NAMES = Object.keys(FEATURE_ADAPTERS);

export function buildComparableFeaturesFromBlob(blob = {}) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    const featurePayload = withoutExcludedProfileSettingsKeys(featureName, blob?.features?.[featureName] || {});
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(featurePayload);
    return accumulator;
  }, {});
}

export function buildComparableFeaturesFromLocal(profileId) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    const exported = FEATURE_ADAPTERS[featureName].export(profileId);
    const featurePayload = withoutExcludedProfileSettingsKeys(featureName, exported);
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(featurePayload);
    return accumulator;
  }, {});
}

export function buildComparableSignatureFromBlob(blob = {}) {
  return stableStringify(buildComparableFeaturesFromBlob(blob));
}

export function buildComparableSignatureFromLocal(profileId) {
  return stableStringify(buildComparableFeaturesFromLocal(profileId));
}

export function buildOutgoingBlob(profileId, baseBlob = null) {
  const normalizedBase = normalizeBlob(baseBlob || {});
  const nextFeatures = Object.entries(normalizedBase.features).reduce((accumulator, [featureName, featurePayload]) => {
    if (!SUPPORTED_FEATURE_NAMES.includes(featureName)) return accumulator;
    const encodedPayload = encodeFeaturePayload(featurePayload, featureName);
    EXCLUDED_PROFILE_KEYS[featureName]?.forEach((key) => delete encodedPayload[key]);
    accumulator[featureName] = encodedPayload;
    return accumulator;
  }, {});

  SUPPORTED_FEATURE_NAMES.forEach((featureName) => {
    nextFeatures[featureName] = {
      ...(nextFeatures[featureName] || {}),
      ...encodeFeaturePayload(FEATURE_ADAPTERS[featureName].export(profileId), featureName)
    };
    EXCLUDED_PROFILE_KEYS[featureName]?.forEach((key) => delete nextFeatures[featureName][key]);
  });

  return normalizeBlob({
    version: 1,
    features: nextFeatures
  });
}

export function extractBlobFromResponse(response) {
  const payload = Array.isArray(response) ? response[0] || null : response;
  const blob = payload?.settings_json ?? payload?.settingsJson ?? null;
  if (!isPlainObject(blob)) {
    return null;
  }
  return normalizeBlob(blob);
}

export async function pullRemoteBlob(profileId) {
  const resolvedProfileId = resolveProfileId(profileId);
  const response = await SupabaseApi.rpc(
    PULL_RPC,
    {
      p_profile_id: resolvedProfileId,
      p_platform: SETTINGS_SYNC_PLATFORM
    },
    true
  );
  return extractBlobFromResponse(response);
}

export function applyRemoteBlob(profileId, blob) {
  let applied = false;
  SUPPORTED_FEATURE_NAMES.forEach((featureName) => {
    const featurePayload = withoutExcludedProfileSettingsKeys(featureName, blob?.features?.[featureName] || {});
    const didApply = FEATURE_ADAPTERS[featureName].import(profileId, featurePayload, {
      isRemoteFeaturePresent:
        Object.prototype.hasOwnProperty.call(blob?.features || {}, featureName) && isPlainObject(blob.features[featureName])
    });
    if (didApply) {
      applied = true;
    }
  });
  return applied;
}

export async function pullProfileSettingsUnlocked(resolvedProfileId) {
  async function pullInheritedPluginGrouping(profileId) {
    // A profile that shares the primary plugin store has no plugin settings
    // blob of its own. Android restores the primary grouping explicitly.
    if (
      String(profileId) === "1" ||
      String(getEffectivePluginProfileId(profileId)) !== "1" ||
      !AuthManager.isAuthenticated ||
      isSyncBackoffActive()
    ) {
      return false;
    }
    const primaryBlob = await pullRemoteBlob(1);
    const feature = primaryBlob?.features?.plugin_settings;
    if (!isPlainObject(feature)) {
      return false;
    }
    return FEATURE_ADAPTERS.plugin_settings.import("1", feature, {
      isRemoteFeaturePresent: true
    });
  }
  const version = ProfileManager.getProfileDataVersion(resolvedProfileId);
  try {
    if (!AuthManager.isAuthenticated || isSyncBackoffActive()) {
      return false;
    }
    if (hasProfileSettingsCloudSyncPending(resolvedProfileId)) {
      // Android keeps a local change authoritative until its debounced push
      // succeeds. Never pull remote data over an unsynced local edit.
      return false;
    }
    const blob = await pullRemoteBlob(resolvedProfileId);
    if (
      version !== ProfileManager.getProfileDataVersion(resolvedProfileId) ||
      !AuthManager.isAuthenticated ||
      isSyncBackoffActive() ||
      hasProfileSettingsCloudSyncPending(resolvedProfileId)
    ) {
      return false;
    }
    if (!blob) {
      return pullInheritedPluginGrouping(resolvedProfileId);
    }

    setCachedBlob(resolvedProfileId, blob);

    const remoteSignature = buildComparableSignatureFromBlob(blob);
    const localSignature = buildComparableSignatureFromLocal(resolvedProfileId);
    if (remoteSignature === localSignature) {
      return pullInheritedPluginGrouping(resolvedProfileId);
    }

    const applied = applyRemoteBlob(String(resolvedProfileId), blob);
    const inheritedApplied = await pullInheritedPluginGrouping(resolvedProfileId);
    return applied || inheritedApplied;
  } catch (error) {
    if (shouldTreatAsMissingResource(error)) {
      return false;
    }
    console.warn("Profile settings sync pull failed", error);
    return false;
  }
}

export async function pushProfileSettingsUnlocked(resolvedProfileId) {
  const version = ProfileManager.getProfileDataVersion(resolvedProfileId);
  try {
    if (!AuthManager.isAuthenticated || isSyncBackoffActive()) {
      return false;
    }
    const pendingVersion = getProfileSettingsCloudSyncPendingVersion(resolvedProfileId);
    const remoteBlob = await pullRemoteBlob(resolvedProfileId);
    if (version !== ProfileManager.getProfileDataVersion(resolvedProfileId)) return false;
    const blob = buildOutgoingBlob(String(resolvedProfileId), remoteBlob);
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: resolvedProfileId,
        p_settings_json: blob,
        p_platform: SETTINGS_SYNC_PLATFORM
      },
      true
    );
    if (version !== ProfileManager.getProfileDataVersion(resolvedProfileId)) return false;
    setCachedBlob(resolvedProfileId, blob);
    if (pendingVersion != null) {
      clearProfileSettingsCloudSyncPending(resolvedProfileId, pendingVersion);
    }
    return true;
  } catch (error) {
    if (shouldTreatAsMissingResource(error)) {
      return false;
    }
    console.warn("Profile settings sync push failed", error);
    return false;
  }
}
