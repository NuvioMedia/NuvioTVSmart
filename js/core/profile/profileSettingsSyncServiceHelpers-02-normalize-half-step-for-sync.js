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

export function normalizeHalfStepForSync(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, parsed)) * 2) / 2;
}

export function normalizeStillWatchingThresholdForSync(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.min(6, Math.max(2, parsed));
}

export function extractLanguageCode(value, fallback = "off") {
  if (value && typeof value === "object") {
    return extractLanguageCode(value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode, fallback);
  }
  const code = String(value ?? "").trim();
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

export function normalizeSubtitleLanguage(value, fallback = "off") {
  const code = extractLanguageCode(value, fallback).trim().toLowerCase();
  if (!code) {
    return fallback;
  }
  switch (code) {
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt_pt":
    case "por":
      return "pt";
    case "force":
    case "forc":
      return "forced";
    case "none":
      return "off";
    default:
      return code;
  }
}

export function normalizePreferredSubtitleLanguageForAndroid(settings = {}) {
  const normalized = normalizeSubtitleLanguage(settings.subtitleStyle?.preferredLanguage ?? settings.subtitleLanguage, "off");
  if (normalized === "forced") {
    const secondary = normalizeSubtitleLanguage(
      settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
      "off"
    );
    return secondary && secondary !== "off" && secondary !== "forced" ? secondary : "en";
  }
  return normalized === "off" ? "none" : normalized;
}

export function normalizeSecondarySubtitleLanguageForAndroid(settings = {}) {
  const normalized = normalizeSubtitleLanguage(
    settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
    "off"
  );
  return normalized === "forced" || normalized === "off" ? "none" : normalized;
}

export function shouldUseForcedSubtitlesForAndroid(settings = {}) {
  const preferred = normalizeSubtitleLanguage(settings.subtitleStyle?.preferredLanguage ?? settings.subtitleLanguage, "off");
  const secondary = normalizeSubtitleLanguage(
    settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
    "off"
  );
  return (
    Boolean(settings.subtitleStyle?.useForcedSubtitles || settings.useForcedSubtitles) || preferred === "forced" || secondary === "forced"
  );
}

export function normalizeAudioLanguageForAndroid(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "system") {
    return "DEVICE";
  }
  // Web "none" (never auto-select a track) corresponds to the Android apps'
  // AudioLanguageOption.DEFAULT ("use media file default"). "off" is accepted
  // as an alias because the player's startup logic has always treated
  // "off"/"none" interchangeably as "no preference"
  // (getStartupPreferredAudioLanguageTargets), so an "off" value persisted by
  // an older build maps to the same Android semantics.
  if (normalized.toLowerCase() === "none" || normalized.toLowerCase() === "off") {
    return "DEFAULT";
  }
  if (normalized.toUpperCase() === "ORIGINAL") {
    return "ORIGINAL";
  }
  if (normalized.toUpperCase() === "DEFAULT") {
    return "DEFAULT";
  }
  if (normalized.toUpperCase() === "DEVICE") {
    return "DEVICE";
  }
  return normalized.toLowerCase();
}

export function normalizeAudioLanguageForWeb(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toUpperCase() === "DEVICE") {
    return "system";
  }
  if (normalized.toUpperCase() === "ORIGINAL") {
    return "original";
  }
  // Android "DEFAULT" means "use media file default", i.e. no preferred
  // language — that is the web "none" option, not "system" (device locale).
  if (normalized.toUpperCase() === "DEFAULT") {
    return "none";
  }
  return normalized.toLowerCase();
}

export function normalizeSecondaryAudioLanguageForAndroid(value) {
  const normalized = normalizeAudioLanguageForAndroid(value);
  return ["DEFAULT", "DEVICE", "FORCED"].includes(String(normalized).toUpperCase()) ? null : normalized;
}

export function normalizeHomeLayoutForAndroid(value) {
  const normalized = String(value || "modern")
    .trim()
    .toLowerCase();
  switch (normalized) {
    case "classic":
      return "CLASSIC";
    case "grid":
      return "GRID";
    default:
      return "MODERN";
  }
}

export function normalizeHomeLayoutForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  switch (normalized) {
    case "CLASSIC":
      return "classic";
    case "GRID":
      return "grid";
    default:
      return "modern";
  }
}

export function normalizeDiscoverLocationForAndroid(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return ["IN_SEARCH", "IN_SIDEBAR", "OFF"].includes(normalized) ? normalized : value === false ? "OFF" : "IN_SEARCH";
}

export function normalizeDiscoverLocationForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "in_search";
  }
  return ["IN_SEARCH", "IN_SIDEBAR", "OFF"].includes(normalized) ? normalized.toLowerCase() : "in_search";
}

export function normalizeTrailerTargetForAndroid(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "expanded_card"
    ? "EXPANDED_CARD"
    : "HERO_MEDIA";
}

export function normalizeTrailerTargetForWeb(value) {
  return String(value || "")
    .trim()
    .toUpperCase() === "EXPANDED_CARD"
    ? "expanded_card"
    : "hero_media";
}

export function normalizeTraktWatchProgressSourceForAndroid(value) {
  const normalized = String(value || "trakt")
    .trim()
    .toLowerCase();
  if (normalized === "nuvio_sync" || normalized === "nuviosync") return "NUVIO_SYNC";
  if (normalized === "simkl") return "SIMKL";
  if (normalized === "mdblist") return "MDBLIST";
  return "TRAKT";
}

export function normalizeTraktWatchProgressSourceForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "NUVIO_SYNC") return "nuvio_sync";
  if (normalized === "SIMKL") return "simkl";
  if (normalized === "MDBLIST") return "mdblist";
  return "trakt";
}

export function normalizeTraktLibrarySourceForAndroid(value) {
  const normalized = String(value || "trakt")
    .trim()
    .toLowerCase();
  if (normalized === "mdblist") return "MDBLIST";
  if (normalized === "local") return "LOCAL";
  if (normalized === "simkl") return "SIMKL";
  return "TRAKT";
}

export function normalizeTraktLibrarySourceForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "MDBLIST") return "mdblist";
  if (normalized === "LOCAL") return "local";
  if (normalized === "SIMKL") return "simkl";
  return "trakt";
}
