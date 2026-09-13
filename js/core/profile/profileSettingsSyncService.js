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
import {
  TraktSettingsStore,
  normalizeTraktContinueWatchingDaysCap
} from "../../data/local/traktSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../data/local/animeSkipSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../data/local/streamBadgeSettingsStore.js";
import {
  ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE,
  DebridSettingsStore,
  normalizeDebridStreamPreferences
} from "../../data/local/debridSettingsStore.js";
import {
  parseStreamBadgeRulesFromPayload,
  normalizeStreamBadgeRules
} from "../../core/streams/streamBadgeRules.js";
import { ProfileManager } from "./profileManager.js";
import {
  clearProfileSettingsCloudSyncPending,
  getProfileSettingsCloudSyncPendingVersion,
  hasProfileSettingsCloudSyncPending
} from "../../data/local/profileScopedStore.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { normalizeSubtitleVerticalOffset } from "../player/subtitleVerticalOffset.js";
import {
  androidColorIntToSubtitleTextOpacity,
  normalizeSubtitleTextOpacity
} from "../player/subtitleTextOpacity.js";
import { isFastHorizontalNavigationEnabled } from "../../platform/sharedKeys.js";

const PULL_RPC = "sync_pull_profile_settings_blob";
const PUSH_RPC = "sync_push_profile_settings_blob";
const SETTINGS_SYNC_PLATFORM = "tv";
const CACHE_KEY = "profileSettingsSyncCache";
const syncInFlightByProfile = new Map();
const EXCLUDED_PROFILE_KEYS = {
  layout_settings: new Set(["search_discover_enabled"]),
  player_settings: new Set(["audio_amplification_db", "persist_audio_amplification"]),
  mdblist_settings: new Set(["mdblist_api_key"]),
  debrid_settings: new Set([
    "torbox_api_key",
    "premiumize_api_key",
    "real_debrid_api_key",
    "stream_badges_enabled",
    "stream_show_badges",
    "show_stream_badges"
  ]),
  animeskip_settings: new Set(["animeskip_client_id"])
};

export function profileSettingsExcludedKeys(featureName) {
  return Array.from(EXCLUDED_PROFILE_KEYS[String(featureName || "").trim()] || []).sort();
}

export function withoutExcludedProfileSettingsKeys(featureName, featurePayload = {}) {
  const sanitized = cloneValue(featurePayload) || {};
  EXCLUDED_PROFILE_KEYS[featureName]?.forEach((key) => delete sanitized[key]);
  return sanitized;
}

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

async function withProfileSettingsSyncLock(profileId, task) {
  const key = String(resolveProfileId(profileId));
  const previous = syncInFlightByProfile.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  syncInFlightByProfile.set(key, current);
  await previous.catch(() => false);
  try {
    return await task();
  } finally {
    release();
    if (syncInFlightByProfile.get(key) === current) {
      syncInFlightByProfile.delete(key);
    }
  }
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEncodedPreferenceValue(value) {
  return (
    isPlainObject(value) &&
    typeof value.type === "string" &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}

function normalizeFeaturePayload(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  const cloned = cloneValue(value) || {};
  return Object.entries(cloned).reduce((accumulator, [key, entry]) => {
    if (
      isPlainObject(entry) &&
      typeof entry.type === "string" &&
      Object.prototype.hasOwnProperty.call(entry, "value")
    ) {
      accumulator[key] = entry.value;
    } else {
      accumulator[key] = entry;
    }
    return accumulator;
  }, {});
}

function normalizeBlob(blob = {}) {
  const features = isPlainObject(blob?.features) ? blob.features : {};
  return {
    version: Number(blob?.version || 1) || 1,
    features: Object.entries(features).reduce((accumulator, [featureName, featureValue]) => {
      const normalizedFeatureName = String(featureName || "").trim();
      if (!normalizedFeatureName || !isPlainObject(featureValue)) {
        return accumulator;
      }
      accumulator[normalizedFeatureName] = cloneValue(featureValue) || {};
      return accumulator;
    }, {})
  };
}

function shouldSerializeLayoutStringArrayAsString(featureName = "", keyName = "") {
  return (
    String(featureName || "").trim() === "layout_settings" &&
    ["hero_catalog_keys", "home_catalog_order_keys", "disabled_home_catalog_keys"].includes(
      String(keyName || "").trim()
    )
  );
}

export function encodePreferenceValue(value, keyName = "", featureName = "") {
  if (isEncodedPreferenceValue(value)) {
    if (
      shouldSerializeLayoutStringArrayAsString(featureName, keyName) &&
      value.type === "string_set"
    ) {
      const normalized = Array.isArray(value.value)
        ? value.value.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
      return { type: "string", value: JSON.stringify(Array.from(new Set(normalized)).sort()) };
    }
    return cloneValue(value);
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { type: "int", value: Math.trunc(value) }
      : { type: "float", value };
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    const normalized = Array.from(new Set(value)).sort();
    if (shouldSerializeLayoutStringArrayAsString(featureName, keyName)) {
      return { type: "string", value: JSON.stringify(normalized) };
    }
    return { type: "string_set", value: normalized };
  }
  return null;
}

function encodeFeaturePayload(featurePayload = {}, featureName = "") {
  if (!isPlainObject(featurePayload)) {
    return {};
  }
  return Object.entries(featurePayload).reduce((accumulator, [key, value]) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      return accumulator;
    }
    const encodedValue = encodePreferenceValue(value, normalizedKey, featureName);
    if (encodedValue) {
      accumulator[normalizedKey] = encodedValue;
    }
    return accumulator;
  }, {});
}

function readCache() {
  const cached = LocalStore.get(CACHE_KEY, {}) || {};
  return isPlainObject(cached) ? cached : {};
}

function setCachedBlob(profileId, blob) {
  const cache = readCache();
  cache[String(resolveProfileId(profileId))] = normalizeBlob(blob);
  LocalStore.set(CACHE_KEY, cache);
}

function shouldTreatAsMissingResource(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && (error.code === "PGRST202" || error.code === "PGRST205")) {
    return true;
  }
  const message = String(error.message || "");
  return (
    message.includes("PGRST202") ||
    message.includes("PGRST205") ||
    message.includes("Could not find the function") ||
    message.includes("Could not find the table")
  );
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function booleanFromAnyKey(raw = {}, keys = []) {
  for (const key of keys) {
    if (booleanOrNull(raw[key]) != null) {
      return Boolean(raw[key]);
    }
  }
  return null;
}

function stringOrNull(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeNextEpisodeThresholdModeForSync(value) {
  const mode = String(value || "")
    .trim()
    .toUpperCase();
  return mode === "MINUTES_BEFORE_END" ? "MINUTES_BEFORE_END" : "PERCENTAGE";
}

function normalizeHalfStepForSync(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, parsed)) * 2) / 2;
}

function normalizeStillWatchingThresholdForSync(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.min(6, Math.max(2, parsed));
}

function extractLanguageCode(value, fallback = "off") {
  if (value && typeof value === "object") {
    return extractLanguageCode(
      value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode,
      fallback
    );
  }
  const code = String(value ?? "").trim();
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function normalizeSubtitleLanguage(value, fallback = "off") {
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

function normalizePreferredSubtitleLanguageForAndroid(settings = {}) {
  const normalized = normalizeSubtitleLanguage(
    settings.subtitleStyle?.preferredLanguage ?? settings.subtitleLanguage,
    "off"
  );
  if (normalized === "forced") {
    const secondary = normalizeSubtitleLanguage(
      settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
      "off"
    );
    return secondary && secondary !== "off" && secondary !== "forced" ? secondary : "en";
  }
  return normalized === "off" ? "none" : normalized;
}

function normalizeSecondarySubtitleLanguageForAndroid(settings = {}) {
  const normalized = normalizeSubtitleLanguage(
    settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
    "off"
  );
  return normalized === "forced" || normalized === "off" ? "none" : normalized;
}

function shouldUseForcedSubtitlesForAndroid(settings = {}) {
  const preferred = normalizeSubtitleLanguage(
    settings.subtitleStyle?.preferredLanguage ?? settings.subtitleLanguage,
    "off"
  );
  const secondary = normalizeSubtitleLanguage(
    settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage,
    "off"
  );
  return (
    Boolean(settings.subtitleStyle?.useForcedSubtitles || settings.useForcedSubtitles) ||
    preferred === "forced" ||
    secondary === "forced"
  );
}

function normalizeAudioLanguageForAndroid(value) {
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

function normalizeAudioLanguageForWeb(value) {
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

function normalizeSecondaryAudioLanguageForAndroid(value) {
  const normalized = normalizeAudioLanguageForAndroid(value);
  return ["DEFAULT", "DEVICE", "FORCED"].includes(String(normalized).toUpperCase())
    ? null
    : normalized;
}

function normalizeHomeLayoutForAndroid(value) {
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

function normalizeHomeLayoutForWeb(value) {
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

function normalizeDiscoverLocationForAndroid(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return ["IN_SEARCH", "IN_SIDEBAR", "OFF"].includes(normalized)
    ? normalized
    : value === false
      ? "OFF"
      : "IN_SEARCH";
}

function normalizeDiscoverLocationForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "in_search";
  }
  return ["IN_SEARCH", "IN_SIDEBAR", "OFF"].includes(normalized)
    ? normalized.toLowerCase()
    : "in_search";
}

function normalizeTrailerTargetForAndroid(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "expanded_card"
    ? "EXPANDED_CARD"
    : "HERO_MEDIA";
}

function normalizeTrailerTargetForWeb(value) {
  return String(value || "")
    .trim()
    .toUpperCase() === "EXPANDED_CARD"
    ? "expanded_card"
    : "hero_media";
}

function normalizeTraktWatchProgressSourceForAndroid(value) {
  const normalized = String(value || "trakt")
    .trim()
    .toLowerCase();
  if (normalized === "nuvio_sync" || normalized === "nuviosync") return "NUVIO_SYNC";
  if (normalized === "simkl") return "SIMKL";
  return "TRAKT";
}

function normalizeTraktWatchProgressSourceForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "NUVIO_SYNC") return "nuvio_sync";
  if (normalized === "SIMKL") return "simkl";
  return "trakt";
}

function normalizeTraktLibrarySourceForAndroid(value) {
  const normalized = String(value || "trakt")
    .trim()
    .toLowerCase();
  if (normalized === "local") return "LOCAL";
  if (normalized === "simkl") return "SIMKL";
  return "TRAKT";
}

function normalizeTraktLibrarySourceForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "LOCAL") return "local";
  if (normalized === "SIMKL") return "simkl";
  return "trakt";
}

function normalizeContinueWatchingSortModeForAndroid(value) {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
  if (
    normalized === "split_upcoming" ||
    normalized === "split-upcoming" ||
    normalized === "splitupcoming"
  ) {
    return "SPLIT_UPCOMING";
  }
  return normalized === "streaming_style" ||
    normalized === "streaming-style" ||
    normalized === "streamingstyle"
    ? "STREAMING_STYLE"
    : "DEFAULT";
}

function normalizeContinueWatchingSortModeForWeb(value) {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
  if (
    normalized === "split_upcoming" ||
    normalized === "split-upcoming" ||
    normalized === "splitupcoming"
  ) {
    return "split_upcoming";
  }
  return normalized === "streaming_style" ||
    normalized === "streaming-style" ||
    normalized === "streamingstyle"
    ? "streaming_style"
    : "default";
}

function normalizeTmdbLanguageForAndroid(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/_/g, "-");
  if (!normalized) {
    return "en";
  }

  // Android's TMDB catalogue stores Portuguese (Brazil) as lowercase "pt-br".
  return normalized === "pt-BR" ? "pt-br" : normalized;
}

function normalizeTmdbLanguageForWeb(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/_/g, "-");
  if (!normalized) {
    return "en";
  }

  switch (normalized.toLowerCase()) {
    case "en":
    case "en-us":
      return "en";
    case "en-au":
      return "en-AU";
    case "en-ca":
      return "en-CA";
    case "en-gb":
      return "en-GB";
    case "it-it":
      return "it";
    case "es-es":
      return "es";
    case "pt-pt":
      return "pt";
    default:
      return normalized.toLowerCase();
  }
}

function hexToAndroidColorInt(value, fallback = "#ffffff", alphaPercent = 100) {
  const match = String(value || fallback)
    .trim()
    .match(/^#([0-9a-f]{6})$/i);
  const hex = match ? match[1] : String(fallback || "#ffffff").replace(/^#/, "");
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const alpha = Math.round((normalizeSubtitleTextOpacity(alphaPercent) / 100) * 0xff);
  return (alpha << 24) | (red << 16) | (green << 8) | blue;
}

function androidColorIntToHex(value, fallback = "#ffffff") {
  const parsed = numberOrNull(value);
  if (parsed == null) {
    return fallback;
  }
  const unsigned = parsed >>> 0;
  return `#${unsigned.toString(16).slice(-6).padStart(6, "0")}`;
}

function cssColorToAndroidColorInt(value, fallback = "#00000000") {
  const match = String(value || fallback)
    .trim()
    .match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  const rgb = match?.[1] || "000000";
  const alpha = match?.[2] || "ff";
  return parseInt(`${alpha}${rgb}`, 16) | 0;
}

function androidColorIntToCss(value, fallback = "#00000000") {
  const parsed = numberOrNull(value);
  if (parsed == null) return fallback;
  const argb = (parsed >>> 0).toString(16).padStart(8, "0");
  return `#${argb.slice(2)}${argb.slice(0, 2)}`.toUpperCase();
}

const FEATURE_ADAPTERS = {
  theme_settings: {
    export(profileId) {
      const theme = ThemeStore.getForProfile(profileId);
      return {
        selected_theme: String(theme.themeName || "WHITE").toUpperCase(),
        selected_font: String(theme.fontFamily || "INTER").toUpperCase(),
        amoled_mode: Boolean(theme.amoledMode),
        amoled_surfaces_mode: Boolean(theme.amoledSurfacesMode),
        settings_ui_style: String(theme.settingsUiStyle || "CLASSIC").toUpperCase()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.selected_theme)) {
        projected.selected_theme = String(raw.selected_theme).toUpperCase();
      }
      if (stringOrNull(raw.selected_font)) {
        projected.selected_font = String(raw.selected_font).toUpperCase();
      }
      if (booleanOrNull(raw.amoled_mode) != null) {
        projected.amoled_mode = Boolean(raw.amoled_mode);
      }
      if (booleanOrNull(raw.amoled_surfaces_mode) != null) {
        projected.amoled_surfaces_mode = Boolean(raw.amoled_surfaces_mode);
      }
      if (stringOrNull(raw.settings_ui_style))
        projected.settings_ui_style = String(raw.settings_ui_style).toUpperCase();
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (stringOrNull(raw.selected_theme)) {
        const selectedTheme = String(raw.selected_theme).toUpperCase();
        partial.themeName = selectedTheme;
        partial.accentColor = accentColorForTheme(selectedTheme);
      }
      if (stringOrNull(raw.selected_font)) {
        partial.fontFamily = String(raw.selected_font).toUpperCase();
      }
      if (booleanOrNull(raw.amoled_mode) != null) {
        partial.amoledMode = Boolean(raw.amoled_mode);
      }
      if (booleanOrNull(raw.amoled_surfaces_mode) != null) {
        partial.amoledSurfacesMode = Boolean(raw.amoled_surfaces_mode);
      }
      if (stringOrNull(raw.settings_ui_style))
        partial.settingsUiStyle = String(raw.settings_ui_style).toUpperCase();
      if (!Object.keys(partial).length) {
        return false;
      }
      ThemeStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  layout_settings: {
    export(profileId) {
      const layout = LayoutPreferences.getForProfile(profileId);
      return {
        selected_layout: normalizeHomeLayoutForAndroid(layout.homeLayout),
        has_chosen_layout: Boolean(layout.hasChosenLayout),
        sidebar_collapsed_by_default: Boolean(layout.collapseSidebar),
        modern_sidebar_enabled: Boolean(layout.modernSidebar),
        modern_sidebar_blur_enabled: Boolean(layout.modernSidebarBlur),
        modern_landscape_posters_enabled: Boolean(layout.modernLandscapePostersEnabled),
        modern_hero_full_screen_backdrop: Boolean(layout.modernHeroFullScreenBackdropEnabled),
        hero_section_enabled: Boolean(layout.heroSectionEnabled),
        discover_location: normalizeDiscoverLocationForAndroid(layout.discoverLocation),
        hero_catalog_keys: Array.isArray(layout.heroCatalogKeys) ? layout.heroCatalogKeys : [],
        poster_labels_enabled: Boolean(layout.posterLabelsEnabled),
        catalog_addon_name_enabled: Boolean(layout.catalogAddonNameEnabled),
        catalog_type_suffix_enabled: Boolean(layout.catalogTypeSuffixEnabled),
        classic_focus_gradient_enabled: Boolean(layout.classicFocusGradientEnabled),
        focused_poster_backdrop_expand_enabled: Boolean(layout.focusedPosterBackdropExpandEnabled),
        focused_poster_backdrop_expand_delay_seconds: Math.max(
          0,
          Math.trunc(Number(layout.focusedPosterBackdropExpandDelaySeconds ?? 3) || 0)
        ),
        focused_poster_backdrop_trailer_enabled: Boolean(
          layout.focusedPosterBackdropTrailerEnabled
        ),
        focused_poster_backdrop_trailer_muted: layout.focusedPosterBackdropTrailerMuted !== false,
        focused_poster_backdrop_trailer_playback_target: normalizeTrailerTargetForAndroid(
          layout.focusedPosterBackdropTrailerPlaybackTarget
        ),
        poster_card_width_dp: Math.max(
          72,
          Math.trunc(Number(layout.posterCardWidthDp ?? 126) || 126)
        ),
        poster_card_height_dp: Math.max(
          108,
          Math.trunc((Math.trunc(Number(layout.posterCardWidthDp ?? 126) || 126) * 3) / 2)
        ),
        poster_card_corner_radius_dp: Math.max(
          0,
          Math.trunc(Number(layout.posterCardCornerRadiusDp ?? 12) || 12)
        ),
        card_depth_enabled: Boolean(layout.cardDepthEnabled),
        card_depth_edge_strength: Math.min(
          100,
          Math.max(0, Math.trunc(Number(layout.cardDepthEdgeStrength ?? 28) || 0))
        ),
        card_depth_sheen_strength: Math.min(
          100,
          Math.max(0, Math.trunc(Number(layout.cardDepthSheenStrength ?? 10) || 0))
        ),
        card_depth_edge_coverage: Math.min(
          100,
          Math.max(0, Math.trunc(Number(layout.cardDepthEdgeCoverage ?? 0) || 0))
        ),
        card_depth_posters_enabled: layout.cardDepthPostersEnabled !== false,
        card_depth_continue_watching_enabled: layout.cardDepthContinueWatchingEnabled !== false,
        card_depth_episode_cards_enabled: layout.cardDepthEpisodeCardsEnabled !== false,
        card_depth_cast_enabled: layout.cardDepthCastEnabled !== false,
        card_depth_trailers_enabled: layout.cardDepthTrailersEnabled !== false,
        continue_watching_card_style: String(
          layout.continueWatchingCardStyle || "card"
        ).toUpperCase(),
        detail_page_trailer_button_enabled: Boolean(layout.detailPageTrailerButtonEnabled),
        prefer_external_meta_addon_detail: layout.preferExternalMetaAddonDetail !== false,
        show_full_release_date: layout.showFullReleaseDate !== false,
        blur_unwatched_episodes: Boolean(layout.blurUnwatchedEpisodes),
        hide_unreleased_content: Boolean(layout.hideUnreleasedContent),
        use_episode_thumbnails_in_cw: layout.useEpisodeThumbnailsInCw !== false,
        blur_continue_watching_next_up: Boolean(layout.blurContinueWatchingNextUp),
        show_unaired_next_up: layout.showUnairedNextUp !== false,
        next_up_from_furthest_episode: layout.nextUpFromFurthestEpisode !== false,
        continue_watching_sort_mode: normalizeContinueWatchingSortModeForAndroid(
          layout.continueWatchingSortMode
        ),
        home_imdb_ratings_visibility: String(
          layout.homeImdbRatingsVisibility || "SHOW_ALL"
        ).toUpperCase(),
        fast_horizontal_navigation_enabled: isFastHorizontalNavigationEnabled()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.selected_layout)) {
        projected.selected_layout = normalizeHomeLayoutForAndroid(raw.selected_layout);
      }
      if (booleanOrNull(raw.has_chosen_layout) != null) {
        projected.has_chosen_layout = Boolean(raw.has_chosen_layout);
      }
      [
        "sidebar_collapsed_by_default",
        "modern_sidebar_enabled",
        "modern_sidebar_blur_enabled",
        "modern_landscape_posters_enabled",
        "modern_hero_full_screen_backdrop",
        "hero_section_enabled",
        "poster_labels_enabled",
        "catalog_addon_name_enabled",
        "catalog_type_suffix_enabled",
        "classic_focus_gradient_enabled",
        "focused_poster_backdrop_expand_enabled",
        "focused_poster_backdrop_trailer_enabled",
        "focused_poster_backdrop_trailer_muted",
        "detail_page_trailer_button_enabled",
        "blur_unwatched_episodes",
        "hide_unreleased_content",
        "use_episode_thumbnails_in_cw",
        "blur_continue_watching_next_up",
        "show_unaired_next_up",
        "next_up_from_furthest_episode",
        "card_depth_enabled",
        "card_depth_posters_enabled",
        "card_depth_continue_watching_enabled",
        "card_depth_episode_cards_enabled",
        "card_depth_cast_enabled",
        "card_depth_trailers_enabled",
        "prefer_external_meta_addon_detail",
        "show_full_release_date"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      if (numberOrNull(raw.focused_poster_backdrop_expand_delay_seconds) != null) {
        projected.focused_poster_backdrop_expand_delay_seconds = Math.max(
          0,
          Math.trunc(Number(raw.focused_poster_backdrop_expand_delay_seconds))
        );
      }
      if (stringOrNull(raw.discover_location)) {
        projected.discover_location = String(raw.discover_location).trim().toUpperCase();
      } else if (booleanOrNull(raw.search_discover_enabled) != null) {
        projected.discover_location = normalizeDiscoverLocationForAndroid(
          raw.search_discover_enabled === false ? "OFF" : "IN_SEARCH"
        );
      }
      if (stringOrNull(raw.focused_poster_backdrop_trailer_playback_target)) {
        projected.focused_poster_backdrop_trailer_playback_target =
          normalizeTrailerTargetForAndroid(raw.focused_poster_backdrop_trailer_playback_target);
      }
      if (stringOrNull(raw.continue_watching_sort_mode)) {
        projected.continue_watching_sort_mode = normalizeContinueWatchingSortModeForAndroid(
          raw.continue_watching_sort_mode
        );
      }
      if (stringOrNull(raw.continue_watching_card_style))
        projected.continue_watching_card_style = String(
          raw.continue_watching_card_style
        ).toUpperCase();
      if (Array.isArray(raw.hero_catalog_keys))
        projected.hero_catalog_keys = raw.hero_catalog_keys.map(String).filter(Boolean);
      ["card_depth_edge_strength", "card_depth_sheen_strength", "card_depth_edge_coverage"].forEach(
        (key) => {
          if (numberOrNull(raw[key]) != null)
            projected[key] = Math.min(100, Math.max(0, Math.trunc(Number(raw[key]))));
        }
      );
      if (numberOrNull(raw.poster_card_width_dp) != null) {
        projected.poster_card_width_dp = Math.max(72, Math.trunc(Number(raw.poster_card_width_dp)));
      }
      if (numberOrNull(raw.poster_card_height_dp) != null) {
        projected.poster_card_height_dp = Math.max(
          108,
          Math.trunc(Number(raw.poster_card_height_dp))
        );
      }
      if (numberOrNull(raw.poster_card_corner_radius_dp) != null) {
        projected.poster_card_corner_radius_dp = Math.max(
          0,
          Math.trunc(Number(raw.poster_card_corner_radius_dp))
        );
      }
      if (booleanOrNull(raw.fast_horizontal_navigation_enabled) != null) {
        projected.fast_horizontal_navigation_enabled = Boolean(
          raw.fast_horizontal_navigation_enabled
        );
      }
      if (stringOrNull(raw.home_imdb_ratings_visibility)) {
        projected.home_imdb_ratings_visibility = String(raw.home_imdb_ratings_visibility)
          .trim()
          .toUpperCase();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (stringOrNull(raw.selected_layout)) {
        partial.homeLayout = normalizeHomeLayoutForWeb(raw.selected_layout);
      }
      if (booleanOrNull(raw.has_chosen_layout) != null) {
        partial.hasChosenLayout = Boolean(raw.has_chosen_layout);
      }
      if (booleanOrNull(raw.sidebar_collapsed_by_default) != null) {
        partial.collapseSidebar = Boolean(raw.sidebar_collapsed_by_default);
      }
      if (booleanOrNull(raw.modern_sidebar_enabled) != null) {
        partial.modernSidebar = Boolean(raw.modern_sidebar_enabled);
      }
      if (booleanOrNull(raw.modern_sidebar_blur_enabled) != null) {
        partial.modernSidebarBlur = Boolean(raw.modern_sidebar_blur_enabled);
      }
      if (booleanOrNull(raw.modern_landscape_posters_enabled) != null) {
        partial.modernLandscapePostersEnabled = Boolean(raw.modern_landscape_posters_enabled);
      }
      if (booleanOrNull(raw.modern_hero_full_screen_backdrop) != null) {
        partial.modernHeroFullScreenBackdropEnabled = Boolean(raw.modern_hero_full_screen_backdrop);
      }
      if (booleanOrNull(raw.hero_section_enabled) != null) {
        partial.heroSectionEnabled = Boolean(raw.hero_section_enabled);
      }
      if (stringOrNull(raw.discover_location)) {
        partial.discoverLocation = normalizeDiscoverLocationForWeb(raw.discover_location);
      } else if (booleanOrNull(raw.search_discover_enabled) != null) {
        partial.discoverLocation = raw.search_discover_enabled ? "in_search" : "off";
      }
      if (booleanOrNull(raw.poster_labels_enabled) != null) {
        partial.posterLabelsEnabled = Boolean(raw.poster_labels_enabled);
      }
      if (booleanOrNull(raw.catalog_addon_name_enabled) != null) {
        partial.catalogAddonNameEnabled = Boolean(raw.catalog_addon_name_enabled);
      }
      if (booleanOrNull(raw.catalog_type_suffix_enabled) != null) {
        partial.catalogTypeSuffixEnabled = Boolean(raw.catalog_type_suffix_enabled);
      }
      if (booleanOrNull(raw.classic_focus_gradient_enabled) != null)
        partial.classicFocusGradientEnabled = Boolean(raw.classic_focus_gradient_enabled);
      if (Array.isArray(raw.hero_catalog_keys))
        partial.heroCatalogKeys = raw.hero_catalog_keys.map(String).filter(Boolean);
      if (stringOrNull(raw.continue_watching_card_style))
        partial.continueWatchingCardStyle = String(raw.continue_watching_card_style).toLowerCase();
      if (booleanOrNull(raw.focused_poster_backdrop_expand_enabled) != null) {
        partial.focusedPosterBackdropExpandEnabled = Boolean(
          raw.focused_poster_backdrop_expand_enabled
        );
      }
      if (numberOrNull(raw.focused_poster_backdrop_expand_delay_seconds) != null) {
        partial.focusedPosterBackdropExpandDelaySeconds = Math.max(
          0,
          Math.trunc(Number(raw.focused_poster_backdrop_expand_delay_seconds))
        );
      }
      if (booleanOrNull(raw.focused_poster_backdrop_trailer_enabled) != null) {
        partial.focusedPosterBackdropTrailerEnabled = Boolean(
          raw.focused_poster_backdrop_trailer_enabled
        );
      }
      if (booleanOrNull(raw.focused_poster_backdrop_trailer_muted) != null) {
        partial.focusedPosterBackdropTrailerMuted = Boolean(
          raw.focused_poster_backdrop_trailer_muted
        );
      }
      if (stringOrNull(raw.focused_poster_backdrop_trailer_playback_target)) {
        partial.focusedPosterBackdropTrailerPlaybackTarget = normalizeTrailerTargetForWeb(
          raw.focused_poster_backdrop_trailer_playback_target
        );
      }
      if (numberOrNull(raw.poster_card_width_dp) != null) {
        partial.posterCardWidthDp = Math.max(72, Math.trunc(Number(raw.poster_card_width_dp)));
      }
      if (numberOrNull(raw.poster_card_corner_radius_dp) != null) {
        partial.posterCardCornerRadiusDp = Math.max(
          0,
          Math.trunc(Number(raw.poster_card_corner_radius_dp))
        );
      }
      if (booleanOrNull(raw.fast_horizontal_navigation_enabled) != null) {
        partial.fastHorizontalNavigationEnabled = Boolean(raw.fast_horizontal_navigation_enabled);
      }
      const layoutBooleanFields = {
        card_depth_enabled: "cardDepthEnabled",
        card_depth_posters_enabled: "cardDepthPostersEnabled",
        card_depth_continue_watching_enabled: "cardDepthContinueWatchingEnabled",
        card_depth_episode_cards_enabled: "cardDepthEpisodeCardsEnabled",
        card_depth_cast_enabled: "cardDepthCastEnabled",
        card_depth_trailers_enabled: "cardDepthTrailersEnabled",
        prefer_external_meta_addon_detail: "preferExternalMetaAddonDetail",
        show_full_release_date: "showFullReleaseDate"
      };
      Object.entries(layoutBooleanFields).forEach(([key, field]) => {
        if (booleanOrNull(raw[key]) != null) partial[field] = Boolean(raw[key]);
      });
      const layoutNumberFields = {
        card_depth_edge_strength: "cardDepthEdgeStrength",
        card_depth_sheen_strength: "cardDepthSheenStrength",
        card_depth_edge_coverage: "cardDepthEdgeCoverage"
      };
      Object.entries(layoutNumberFields).forEach(([key, field]) => {
        if (numberOrNull(raw[key]) != null) partial[field] = Number(raw[key]);
      });
      if (booleanOrNull(raw.detail_page_trailer_button_enabled) != null) {
        partial.detailPageTrailerButtonEnabled = Boolean(raw.detail_page_trailer_button_enabled);
      }
      if (booleanOrNull(raw.blur_unwatched_episodes) != null) {
        partial.blurUnwatchedEpisodes = Boolean(raw.blur_unwatched_episodes);
      }
      if (booleanOrNull(raw.hide_unreleased_content) != null) {
        partial.hideUnreleasedContent = Boolean(raw.hide_unreleased_content);
      }
      if (booleanOrNull(raw.use_episode_thumbnails_in_cw) != null) {
        partial.useEpisodeThumbnailsInCw = Boolean(raw.use_episode_thumbnails_in_cw);
      }
      if (booleanOrNull(raw.blur_continue_watching_next_up) != null) {
        partial.blurContinueWatchingNextUp = Boolean(raw.blur_continue_watching_next_up);
      }
      if (booleanOrNull(raw.show_unaired_next_up) != null) {
        partial.showUnairedNextUp = Boolean(raw.show_unaired_next_up);
      }
      if (booleanOrNull(raw.next_up_from_furthest_episode) != null) {
        partial.nextUpFromFurthestEpisode = Boolean(raw.next_up_from_furthest_episode);
      }
      if (stringOrNull(raw.continue_watching_sort_mode)) {
        partial.continueWatchingSortMode = normalizeContinueWatchingSortModeForWeb(
          raw.continue_watching_sort_mode
        );
      }
      if (stringOrNull(raw.home_imdb_ratings_visibility)) {
        partial.homeImdbRatingsVisibility = String(raw.home_imdb_ratings_visibility)
          .trim()
          .toUpperCase();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      LayoutPreferences.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  experience_settings: {
    export(profileId) {
      const settings = ExperienceModeStore.getForProfile(profileId);
      return {
        ...(settings.mode ? { mode: settings.mode } : {}),
        addon_setup_skipped: Boolean(settings.addonSetupSkipped)
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const mode = String(raw.mode || "")
        .trim()
        .toUpperCase();
      return {
        ...(mode === "ESSENTIAL" || mode === "ADVANCED" ? { mode } : {}),
        ...(booleanOrNull(raw.addon_setup_skipped) != null
          ? { addon_setup_skipped: Boolean(raw.addon_setup_skipped) }
          : {})
      };
    },
    import(profileId, rawFeature = {}) {
      const projected = this.project(rawFeature);
      if (!Object.keys(projected).length) return false;
      ExperienceModeStore.setForProfile(
        profileId,
        {
          ...(projected.mode ? { mode: projected.mode } : {}),
          ...(Object.prototype.hasOwnProperty.call(projected, "addon_setup_skipped")
            ? { addonSetupSkipped: projected.addon_setup_skipped }
            : {})
        },
        { silentSync: true }
      );
      return true;
    }
  },
  player_settings: {
    export(profileId) {
      const settings = PlayerSettingsStore.getForProfile(profileId);
      return {
        preferred_audio_language: normalizeAudioLanguageForAndroid(settings.preferredAudioLanguage),
        secondary_preferred_audio_language: normalizeSecondaryAudioLanguageForAndroid(
          settings.secondaryPreferredAudioLanguage
        ),
        subtitle_preferred_language: normalizePreferredSubtitleLanguageForAndroid(settings),
        subtitle_secondary_language: normalizeSecondarySubtitleLanguageForAndroid(settings),
        subtitle_use_forced_subtitles: shouldUseForcedSubtitlesForAndroid(settings),
        subtitle_size: Math.min(
          200,
          Math.max(50, Math.trunc(Number(settings.subtitleStyle?.fontSize ?? 120) || 120))
        ),
        subtitle_vertical_offset: normalizeSubtitleVerticalOffset(
          settings.subtitleStyle?.verticalOffset
        ),
        subtitle_bold: Boolean(settings.subtitleStyle?.bold),
        subtitle_text_color: hexToAndroidColorInt(
          settings.subtitleStyle?.textColor,
          "#ffffff",
          settings.subtitleStyle?.textOpacity
        ),
        subtitle_background_color: cssColorToAndroidColorInt(
          settings.subtitleStyle?.backgroundColor
        ),
        subtitle_outline_enabled: settings.subtitleStyle?.outlineEnabled !== false,
        subtitle_outline_color: hexToAndroidColorInt(
          settings.subtitleStyle?.outlineColor,
          "#000000"
        ),
        loading_overlay_enabled: settings.loadingOverlayEnabled !== false,
        show_player_loading_status: settings.showPlayerLoadingStatus !== false,
        pause_overlay_enabled: settings.pauseOverlayEnabled !== false,
        parental_guide_enabled: settings.parentalGuideEnabled !== false,
        osd_clock_enabled: settings.osdClockEnabled !== false,
        subtitle_show_only_preferred_languages: Boolean(
          settings.subtitleStyle?.showOnlyPreferredLanguages
        ),
        auto_skip_segment_types: Array.isArray(settings.autoSkipSegmentTypes)
          ? settings.autoSkipSegmentTypes
          : [],
        addon_subtitle_startup_mode: String(settings.addonSubtitleStartupMode || "ALL_SUBTITLES"),
        skip_intro_enabled: Boolean(settings.skipIntroEnabled),
        stream_auto_play_next_episode_enabled: Boolean(settings.autoplayNextEpisode),
        stream_auto_play_prefer_bingegroup_next_episode: Boolean(
          settings.streamAutoPlayPreferBingeGroupForNextEpisode
        ),
        stream_auto_play_reuse_binge_group: Boolean(settings.streamAutoPlayReuseBingeGroup),
        stream_reuse_last_link_enabled: Boolean(settings.streamReuseLastLinkEnabled),
        stream_reuse_last_link_cache_hours: Math.min(
          168,
          Math.max(1, Math.trunc(Number(settings.streamReuseLastLinkCacheHours ?? 24) || 24))
        ),
        still_watching_enabled: Boolean(settings.stillWatchingEnabled),
        still_watching_episode_threshold: normalizeStillWatchingThresholdForSync(
          settings.stillWatchingEpisodeThreshold
        ),
        next_episode_threshold_mode: normalizeNextEpisodeThresholdModeForSync(
          settings.nextEpisodeThresholdMode
        ),
        next_episode_threshold_percent_v2: normalizeHalfStepForSync(
          settings.nextEpisodeThresholdPercent,
          97,
          100,
          99
        ),
        next_episode_threshold_minutes_before_end_v2: normalizeHalfStepForSync(
          settings.nextEpisodeThresholdMinutesBeforeEnd,
          0,
          3.5,
          2
        ),
        stream_auto_play_mode: String(settings.streamAutoPlayMode || "MANUAL"),
        stream_auto_play_source: String(settings.streamAutoPlaySource || "ALL_SOURCES"),
        stream_auto_play_selected_addons: Array.isArray(settings.streamAutoPlaySelectedAddons)
          ? settings.streamAutoPlaySelectedAddons
          : [],
        stream_auto_play_selected_plugins: Array.isArray(settings.streamAutoPlaySelectedPlugins)
          ? settings.streamAutoPlaySelectedPlugins
          : [],
        stream_auto_play_regex: String(settings.streamAutoPlayRegex || ""),
        stream_auto_play_timeout_seconds: Math.max(
          0,
          Math.trunc(Number(settings.streamAutoPlayTimeoutSeconds ?? 3) || 0)
        )
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.preferred_audio_language)) {
        projected.preferred_audio_language = normalizeAudioLanguageForAndroid(
          raw.preferred_audio_language
        );
      }
      if (stringOrNull(raw.secondary_preferred_audio_language)) {
        const secondaryAudioLanguage = normalizeSecondaryAudioLanguageForAndroid(
          raw.secondary_preferred_audio_language
        );
        if (secondaryAudioLanguage) {
          projected.secondary_preferred_audio_language = secondaryAudioLanguage;
        }
      }
      if (stringOrNull(raw.subtitle_preferred_language)) {
        projected.subtitle_preferred_language = normalizeSubtitleLanguage(
          raw.subtitle_preferred_language,
          "off"
        );
      }
      if (stringOrNull(raw.subtitle_secondary_language)) {
        projected.subtitle_secondary_language = normalizeSubtitleLanguage(
          raw.subtitle_secondary_language,
          "off"
        );
      }
      [
        "subtitle_bold",
        "subtitle_use_forced_subtitles",
        "subtitle_outline_enabled",
        "skip_intro_enabled",
        "stream_auto_play_next_episode_enabled",
        "stream_auto_play_prefer_bingegroup_next_episode",
        "stream_auto_play_reuse_binge_group",
        "stream_reuse_last_link_enabled",
        "still_watching_enabled",
        "loading_overlay_enabled",
        "show_player_loading_status",
        "pause_overlay_enabled",
        "parental_guide_enabled",
        "osd_clock_enabled",
        "subtitle_show_only_preferred_languages"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      [
        "subtitle_size",
        "subtitle_text_color",
        "subtitle_background_color",
        "subtitle_outline_color"
      ].forEach((key) => {
        if (numberOrNull(raw[key]) != null) {
          projected[key] = Math.trunc(Number(raw[key]));
        }
      });
      if (numberOrNull(raw.subtitle_vertical_offset) != null) {
        projected.subtitle_vertical_offset = normalizeSubtitleVerticalOffset(
          raw.subtitle_vertical_offset
        );
      }
      ["stream_auto_play_mode", "stream_auto_play_source", "stream_auto_play_regex"].forEach(
        (key) => {
          if (raw[key] != null) {
            projected[key] = String(raw[key]);
          }
        }
      );
      if (Array.isArray(raw.auto_skip_segment_types))
        projected.auto_skip_segment_types = raw.auto_skip_segment_types;
      if (stringOrNull(raw.addon_subtitle_startup_mode))
        projected.addon_subtitle_startup_mode = String(
          raw.addon_subtitle_startup_mode
        ).toUpperCase();
      if (numberOrNull(raw.stream_auto_play_timeout_seconds) != null) {
        projected.stream_auto_play_timeout_seconds = Math.max(
          0,
          Math.trunc(Number(raw.stream_auto_play_timeout_seconds))
        );
      }
      if (numberOrNull(raw.stream_reuse_last_link_cache_hours) != null) {
        projected.stream_reuse_last_link_cache_hours = Math.min(
          168,
          Math.max(1, Math.trunc(Number(raw.stream_reuse_last_link_cache_hours)))
        );
      }
      ["stream_auto_play_selected_addons", "stream_auto_play_selected_plugins"].forEach((key) => {
        if (Array.isArray(raw[key])) {
          projected[key] = raw[key].map((entry) => String(entry || "").trim()).filter(Boolean);
        }
      });
      if (numberOrNull(raw.still_watching_episode_threshold) != null) {
        projected.still_watching_episode_threshold = normalizeStillWatchingThresholdForSync(
          raw.still_watching_episode_threshold
        );
      }
      if (raw.next_episode_threshold_mode != null) {
        projected.next_episode_threshold_mode = normalizeNextEpisodeThresholdModeForSync(
          raw.next_episode_threshold_mode
        );
      }
      const thresholdPercent =
        numberOrNull(raw.next_episode_threshold_percent_v2) ??
        numberOrNull(raw.next_episode_threshold_percent);
      if (thresholdPercent != null) {
        projected.next_episode_threshold_percent_v2 = normalizeHalfStepForSync(
          thresholdPercent,
          97,
          100,
          99
        );
      }
      const thresholdMinutes =
        numberOrNull(raw.next_episode_threshold_minutes_before_end_v2) ??
        numberOrNull(raw.next_episode_threshold_minutes_before_end);
      if (thresholdMinutes != null) {
        projected.next_episode_threshold_minutes_before_end_v2 = normalizeHalfStepForSync(
          thresholdMinutes,
          0,
          3.5,
          2
        );
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      const subtitleStyle = {};
      const preferredAudioLanguage = normalizeAudioLanguageForWeb(raw.preferred_audio_language);
      const secondaryPreferredAudioLanguage = normalizeAudioLanguageForWeb(
        raw.secondary_preferred_audio_language
      );
      let subtitleLanguage = stringOrNull(raw.subtitle_preferred_language)
        ? normalizeSubtitleLanguage(raw.subtitle_preferred_language, "off")
        : null;
      let secondarySubtitleLanguage = stringOrNull(raw.subtitle_secondary_language)
        ? normalizeSubtitleLanguage(raw.subtitle_secondary_language, "off")
        : null;
      let useForcedSubtitles = booleanOrNull(raw.subtitle_use_forced_subtitles);

      if (subtitleLanguage === "forced") {
        useForcedSubtitles = true;
        subtitleLanguage =
          secondarySubtitleLanguage &&
          secondarySubtitleLanguage !== "forced" &&
          secondarySubtitleLanguage !== "off"
            ? secondarySubtitleLanguage
            : "en";
        secondarySubtitleLanguage = "off";
      }
      if (secondarySubtitleLanguage === "forced") {
        useForcedSubtitles = true;
        secondarySubtitleLanguage = "off";
      }

      if (preferredAudioLanguage) {
        partial.preferredAudioLanguage = preferredAudioLanguage;
      }
      if (secondaryPreferredAudioLanguage) {
        partial.secondaryPreferredAudioLanguage = secondaryPreferredAudioLanguage;
      }
      if (subtitleLanguage) {
        partial.subtitleLanguage = subtitleLanguage;
        // Android's "None" still permits forced-only selection when that flag
        // is enabled, so the removed Web-only master switch must stay enabled.
        partial.subtitlesEnabled = true;
        subtitleStyle.preferredLanguage = subtitleLanguage;
      }
      if (secondarySubtitleLanguage) {
        partial.secondarySubtitleLanguage = secondarySubtitleLanguage;
        subtitleStyle.secondaryPreferredLanguage = secondarySubtitleLanguage;
      }
      if (useForcedSubtitles != null) {
        subtitleStyle.useForcedSubtitles = Boolean(useForcedSubtitles);
      }
      if (booleanOrNull(raw.subtitle_show_only_preferred_languages) != null) {
        subtitleStyle.showOnlyPreferredLanguages = Boolean(
          raw.subtitle_show_only_preferred_languages
        );
      }
      if (numberOrNull(raw.subtitle_size) != null) {
        subtitleStyle.fontSize = Math.min(200, Math.max(50, Math.trunc(Number(raw.subtitle_size))));
      }
      if (numberOrNull(raw.subtitle_vertical_offset) != null) {
        subtitleStyle.verticalOffset = normalizeSubtitleVerticalOffset(
          raw.subtitle_vertical_offset
        );
      }
      if (booleanOrNull(raw.subtitle_bold) != null) {
        subtitleStyle.bold = Boolean(raw.subtitle_bold);
      }
      if (numberOrNull(raw.subtitle_text_color) != null) {
        subtitleStyle.textColor = androidColorIntToHex(raw.subtitle_text_color, "#ffffff");
        subtitleStyle.textOpacity = androidColorIntToSubtitleTextOpacity(raw.subtitle_text_color);
      }
      if (numberOrNull(raw.subtitle_background_color) != null) {
        subtitleStyle.backgroundColor = androidColorIntToCss(raw.subtitle_background_color);
      }
      if (booleanOrNull(raw.subtitle_outline_enabled) != null) {
        subtitleStyle.outlineEnabled = Boolean(raw.subtitle_outline_enabled);
      }
      if (numberOrNull(raw.subtitle_outline_color) != null) {
        subtitleStyle.outlineColor = androidColorIntToHex(raw.subtitle_outline_color, "#000000");
      }
      if (booleanOrNull(raw.skip_intro_enabled) != null) {
        partial.skipIntroEnabled = Boolean(raw.skip_intro_enabled);
      }
      const playerBooleanFields = {
        loading_overlay_enabled: "loadingOverlayEnabled",
        show_player_loading_status: "showPlayerLoadingStatus",
        pause_overlay_enabled: "pauseOverlayEnabled",
        parental_guide_enabled: "parentalGuideEnabled",
        osd_clock_enabled: "osdClockEnabled"
      };
      Object.entries(playerBooleanFields).forEach(([key, field]) => {
        if (booleanOrNull(raw[key]) != null) partial[field] = Boolean(raw[key]);
      });
      if (Array.isArray(raw.auto_skip_segment_types))
        partial.autoSkipSegmentTypes = raw.auto_skip_segment_types;
      if (stringOrNull(raw.addon_subtitle_startup_mode))
        partial.addonSubtitleStartupMode = String(raw.addon_subtitle_startup_mode).toUpperCase();
      if (booleanOrNull(raw.stream_auto_play_next_episode_enabled) != null) {
        partial.autoplayNextEpisode = Boolean(raw.stream_auto_play_next_episode_enabled);
      }
      if (booleanOrNull(raw.stream_auto_play_prefer_bingegroup_next_episode) != null) {
        partial.streamAutoPlayPreferBingeGroupForNextEpisode = Boolean(
          raw.stream_auto_play_prefer_bingegroup_next_episode
        );
      }
      if (booleanOrNull(raw.still_watching_enabled) != null) {
        partial.stillWatchingEnabled = Boolean(raw.still_watching_enabled);
      }
      if (numberOrNull(raw.still_watching_episode_threshold) != null) {
        partial.stillWatchingEpisodeThreshold = normalizeStillWatchingThresholdForSync(
          raw.still_watching_episode_threshold
        );
      }
      if (raw.next_episode_threshold_mode != null) {
        partial.nextEpisodeThresholdMode = normalizeNextEpisodeThresholdModeForSync(
          raw.next_episode_threshold_mode
        );
      }
      const thresholdPercent =
        numberOrNull(raw.next_episode_threshold_percent_v2) ??
        numberOrNull(raw.next_episode_threshold_percent);
      if (thresholdPercent != null) {
        partial.nextEpisodeThresholdPercent = normalizeHalfStepForSync(
          thresholdPercent,
          97,
          100,
          99
        );
      }
      const thresholdMinutes =
        numberOrNull(raw.next_episode_threshold_minutes_before_end_v2) ??
        numberOrNull(raw.next_episode_threshold_minutes_before_end);
      if (thresholdMinutes != null) {
        partial.nextEpisodeThresholdMinutesBeforeEnd = normalizeHalfStepForSync(
          thresholdMinutes,
          0,
          3.5,
          2
        );
      }
      if (raw.stream_auto_play_mode != null) {
        partial.streamAutoPlayMode = String(raw.stream_auto_play_mode);
      }
      if (raw.stream_auto_play_source != null) {
        partial.streamAutoPlaySource = String(raw.stream_auto_play_source);
      }
      if (Array.isArray(raw.stream_auto_play_selected_addons)) {
        partial.streamAutoPlaySelectedAddons = raw.stream_auto_play_selected_addons;
      }
      if (Array.isArray(raw.stream_auto_play_selected_plugins)) {
        partial.streamAutoPlaySelectedPlugins = raw.stream_auto_play_selected_plugins;
      }
      if (raw.stream_auto_play_regex != null) {
        partial.streamAutoPlayRegex = String(raw.stream_auto_play_regex);
      }
      if (numberOrNull(raw.stream_auto_play_timeout_seconds) != null) {
        partial.streamAutoPlayTimeoutSeconds = Math.max(
          0,
          Math.trunc(Number(raw.stream_auto_play_timeout_seconds))
        );
      }
      if (booleanOrNull(raw.stream_auto_play_reuse_binge_group) != null) {
        partial.streamAutoPlayReuseBingeGroup = Boolean(raw.stream_auto_play_reuse_binge_group);
      }
      if (booleanOrNull(raw.stream_reuse_last_link_enabled) != null) {
        partial.streamReuseLastLinkEnabled = Boolean(raw.stream_reuse_last_link_enabled);
      }
      if (numberOrNull(raw.stream_reuse_last_link_cache_hours) != null) {
        partial.streamReuseLastLinkCacheHours = Math.min(
          168,
          Math.max(1, Math.trunc(Number(raw.stream_reuse_last_link_cache_hours)))
        );
      }
      if (Object.keys(subtitleStyle).length) {
        partial.subtitleStyle = subtitleStyle;
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      PlayerSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  trailer_settings: {
    export(profileId) {
      const settings = PlayerSettingsStore.getForProfile(profileId);
      return {
        trailer_enabled: Boolean(settings.trailerAutoplay),
        trailer_delay_seconds: Math.min(
          15,
          Math.max(0, Number(settings.trailerDelaySeconds ?? 7) || 0)
        )
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (booleanOrNull(raw.trailer_enabled) != null) {
        projected.trailer_enabled = Boolean(raw.trailer_enabled);
      }
      if (numberOrNull(raw.trailer_delay_seconds) != null)
        projected.trailer_delay_seconds = Math.min(
          15,
          Math.max(0, Math.trunc(Number(raw.trailer_delay_seconds)))
        );
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      if (
        booleanOrNull(raw.trailer_enabled) == null &&
        numberOrNull(raw.trailer_delay_seconds) == null
      ) {
        return false;
      }
      PlayerSettingsStore.setForProfile(
        profileId,
        {
          ...(booleanOrNull(raw.trailer_enabled) != null
            ? { trailerAutoplay: Boolean(raw.trailer_enabled) }
            : {}),
          ...(numberOrNull(raw.trailer_delay_seconds) != null
            ? { trailerDelaySeconds: Number(raw.trailer_delay_seconds) }
            : {})
        },
        { silentSync: true }
      );
      return true;
    }
  },
  tmdb_settings: {
    export(profileId) {
      const settings = TmdbSettingsStore.getForProfile(profileId);
      return {
        tmdb_enabled: Boolean(settings.enabled),
        tmdb_modern_home_enabled: Boolean(settings.modernHomeEnabled),
        tmdb_enrich_continue_watching: settings.enrichContinueWatching !== false,
        tmdb_language: normalizeTmdbLanguageForAndroid(settings.language),
        tmdb_use_artwork: settings.useArtwork !== false,
        tmdb_use_basic_info: settings.useBasicInfo !== false,
        tmdb_use_details: settings.useDetails !== false,
        tmdb_use_release_dates: settings.useReleaseDates !== false,
        tmdb_use_credits: settings.useCredits !== false,
        tmdb_use_productions: settings.useProductions !== false,
        tmdb_use_networks: settings.useNetworks !== false,
        tmdb_use_episodes: settings.useEpisodes !== false,
        tmdb_use_trailers: settings.useTrailers !== false,
        tmdb_use_more_like_this: settings.useMoreLikeThis !== false,
        tmdb_use_collections: settings.useCollections !== false
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      [
        "tmdb_enabled",
        "tmdb_modern_home_enabled",
        "tmdb_enrich_continue_watching",
        "tmdb_use_artwork",
        "tmdb_use_basic_info",
        "tmdb_use_details",
        "tmdb_use_release_dates",
        "tmdb_use_credits",
        "tmdb_use_productions",
        "tmdb_use_networks",
        "tmdb_use_episodes",
        "tmdb_use_trailers",
        "tmdb_use_more_like_this",
        "tmdb_use_collections"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      if (stringOrNull(raw.tmdb_language)) {
        projected.tmdb_language = normalizeTmdbLanguageForAndroid(raw.tmdb_language);
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.tmdb_enabled) != null) {
        partial.enabled = Boolean(raw.tmdb_enabled);
      }
      if (booleanOrNull(raw.tmdb_modern_home_enabled) != null) {
        partial.modernHomeEnabled = Boolean(raw.tmdb_modern_home_enabled);
      }
      if (booleanOrNull(raw.tmdb_enrich_continue_watching) != null) {
        partial.enrichContinueWatching = Boolean(raw.tmdb_enrich_continue_watching);
      }
      if (stringOrNull(raw.tmdb_language)) {
        partial.language = normalizeTmdbLanguageForWeb(raw.tmdb_language);
      }
      if (booleanOrNull(raw.tmdb_use_artwork) != null) {
        partial.useArtwork = Boolean(raw.tmdb_use_artwork);
      }
      if (booleanOrNull(raw.tmdb_use_basic_info) != null) {
        partial.useBasicInfo = Boolean(raw.tmdb_use_basic_info);
      }
      if (booleanOrNull(raw.tmdb_use_details) != null) {
        partial.useDetails = Boolean(raw.tmdb_use_details);
      }
      if (booleanOrNull(raw.tmdb_use_release_dates) != null) {
        partial.useReleaseDates = Boolean(raw.tmdb_use_release_dates);
      }
      if (booleanOrNull(raw.tmdb_use_credits) != null) {
        partial.useCredits = Boolean(raw.tmdb_use_credits);
      }
      if (booleanOrNull(raw.tmdb_use_productions) != null) {
        partial.useProductions = Boolean(raw.tmdb_use_productions);
      }
      if (booleanOrNull(raw.tmdb_use_networks) != null) {
        partial.useNetworks = Boolean(raw.tmdb_use_networks);
      }
      if (booleanOrNull(raw.tmdb_use_episodes) != null) {
        partial.useEpisodes = Boolean(raw.tmdb_use_episodes);
      }
      if (booleanOrNull(raw.tmdb_use_trailers) != null) {
        partial.useTrailers = Boolean(raw.tmdb_use_trailers);
      }
      if (booleanOrNull(raw.tmdb_use_more_like_this) != null) {
        partial.useMoreLikeThis = Boolean(raw.tmdb_use_more_like_this);
      }
      if (booleanOrNull(raw.tmdb_use_collections) != null) {
        partial.useCollections = Boolean(raw.tmdb_use_collections);
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      TmdbSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  mdblist_settings: {
    export(profileId) {
      const settings = MdbListSettingsStore.getForProfile(profileId);
      return {
        mdblist_enabled: Boolean(settings.enabled),
        mdblist_api_key: String(settings.apiKey || "").trim(),
        mdblist_show_trakt: settings.showTrakt !== false,
        mdblist_show_imdb: settings.showImdb !== false,
        mdblist_show_tmdb: settings.showTmdb !== false,
        mdblist_show_letterboxd: settings.showLetterboxd !== false,
        mdblist_show_tomatoes: settings.showTomatoes !== false,
        mdblist_show_audience: settings.showAudience !== false,
        mdblist_show_metacritic: settings.showMetacritic !== false,
        mdblist_show_mal: settings.showMal !== false
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (booleanOrNull(raw.mdblist_enabled) != null) {
        projected.mdblist_enabled = Boolean(raw.mdblist_enabled);
      }
      if (raw.mdblist_api_key != null) {
        projected.mdblist_api_key = String(raw.mdblist_api_key || "").trim();
      }
      [
        "mdblist_show_trakt",
        "mdblist_show_imdb",
        "mdblist_show_tmdb",
        "mdblist_show_letterboxd",
        "mdblist_show_tomatoes",
        "mdblist_show_audience",
        "mdblist_show_metacritic",
        "mdblist_show_mal"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.mdblist_enabled) != null) {
        partial.enabled = Boolean(raw.mdblist_enabled);
      }
      if (raw.mdblist_api_key != null) {
        partial.apiKey = String(raw.mdblist_api_key || "").trim();
      }
      if (booleanOrNull(raw.mdblist_show_trakt) != null) {
        partial.showTrakt = Boolean(raw.mdblist_show_trakt);
      }
      if (booleanOrNull(raw.mdblist_show_imdb) != null) {
        partial.showImdb = Boolean(raw.mdblist_show_imdb);
      }
      if (booleanOrNull(raw.mdblist_show_tmdb) != null) {
        partial.showTmdb = Boolean(raw.mdblist_show_tmdb);
      }
      if (booleanOrNull(raw.mdblist_show_letterboxd) != null) {
        partial.showLetterboxd = Boolean(raw.mdblist_show_letterboxd);
      }
      if (booleanOrNull(raw.mdblist_show_tomatoes) != null) {
        partial.showTomatoes = Boolean(raw.mdblist_show_tomatoes);
      }
      if (booleanOrNull(raw.mdblist_show_audience) != null) {
        partial.showAudience = Boolean(raw.mdblist_show_audience);
      }
      if (booleanOrNull(raw.mdblist_show_metacritic) != null) {
        partial.showMetacritic = Boolean(raw.mdblist_show_metacritic);
      }
      if (booleanOrNull(raw.mdblist_show_mal) != null) {
        partial.showMal = Boolean(raw.mdblist_show_mal);
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      MdbListSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  trakt_settings: {
    export(profileId) {
      const settings = TraktSettingsStore.getForProfile(profileId);
      return {
        continue_watching_days_cap: normalizeTraktContinueWatchingDaysCap(
          settings.continueWatchingDaysCap
        ),
        dismissed_next_up_keys: ContinueWatchingPreferences.getDismissedNextUpKeys(profileId),
        show_meta_comments: settings.showMetaComments !== false,
        watch_progress_source: normalizeTraktWatchProgressSourceForAndroid(
          settings.watchProgressSource
        ),
        library_source_mode: normalizeTraktLibrarySourceForAndroid(settings.librarySourceMode),
        simkl_anime_id_preference: String(settings.simklAnimeIdPreference || "imdb").toUpperCase(),
        more_like_this_source: String(settings.moreLikeThisSource || "trakt").toUpperCase()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (numberOrNull(raw.continue_watching_days_cap) != null) {
        projected.continue_watching_days_cap = normalizeTraktContinueWatchingDaysCap(
          raw.continue_watching_days_cap
        );
      }
      if (Array.isArray(raw.dismissed_next_up_keys)) {
        projected.dismissed_next_up_keys = raw.dismissed_next_up_keys.map(String).filter(Boolean);
      }
      if (booleanOrNull(raw.show_meta_comments) != null) {
        projected.show_meta_comments = Boolean(raw.show_meta_comments);
      }
      if (stringOrNull(raw.watch_progress_source)) {
        projected.watch_progress_source = normalizeTraktWatchProgressSourceForAndroid(
          raw.watch_progress_source
        );
      }
      if (stringOrNull(raw.library_source_mode)) {
        projected.library_source_mode = normalizeTraktLibrarySourceForAndroid(
          raw.library_source_mode
        );
      }
      if (stringOrNull(raw.simkl_anime_id_preference)) {
        projected.simkl_anime_id_preference = String(raw.simkl_anime_id_preference).toUpperCase();
      }
      if (stringOrNull(raw.more_like_this_source)) {
        projected.more_like_this_source = String(raw.more_like_this_source).toUpperCase();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (numberOrNull(raw.continue_watching_days_cap) != null) {
        partial.continueWatchingDaysCap = normalizeTraktContinueWatchingDaysCap(
          raw.continue_watching_days_cap
        );
      }
      if (Array.isArray(raw.dismissed_next_up_keys)) {
        ContinueWatchingPreferences.replaceDismissedNextUpKeys(
          raw.dismissed_next_up_keys,
          profileId,
          { silentSync: true }
        );
      }
      if (booleanOrNull(raw.show_meta_comments) != null) {
        partial.showMetaComments = Boolean(raw.show_meta_comments);
      }
      if (stringOrNull(raw.watch_progress_source)) {
        partial.watchProgressSource = normalizeTraktWatchProgressSourceForWeb(
          raw.watch_progress_source
        );
      }
      if (stringOrNull(raw.library_source_mode)) {
        partial.librarySourceMode = normalizeTraktLibrarySourceForWeb(raw.library_source_mode);
      }
      if (stringOrNull(raw.simkl_anime_id_preference)) {
        partial.simklAnimeIdPreference = String(raw.simkl_anime_id_preference).toLowerCase();
      }
      if (stringOrNull(raw.more_like_this_source)) {
        partial.moreLikeThisSource = String(raw.more_like_this_source).toLowerCase();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      TraktSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  animeskip_settings: {
    export(profileId) {
      const settings = AnimeSkipSettingsStore.getForProfile(profileId);
      return {
        animeskip_enabled: Boolean(settings.enabled),
        animeskip_client_id: String(settings.clientId || "").trim()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (booleanOrNull(raw.animeskip_enabled) != null) {
        projected.animeskip_enabled = Boolean(raw.animeskip_enabled);
      }
      if (raw.animeskip_client_id != null) {
        projected.animeskip_client_id = String(raw.animeskip_client_id || "").trim();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.animeskip_enabled) != null) {
        partial.enabled = Boolean(raw.animeskip_enabled);
      }
      if (raw.animeskip_client_id != null) {
        partial.clientId = String(raw.animeskip_client_id || "").trim();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      AnimeSkipSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  stream_badge_settings: {
    export(profileId) {
      const settings = StreamBadgeSettingsStore.getForProfile(profileId);
      const rules = normalizeStreamBadgeRules(settings.rules);
      return {
        stream_badge_rules: rules.imports.length ? JSON.stringify(rules) : "",
        show_file_size_badges: settings.showFileSizeBadges !== false,
        show_addon_logo: settings.showAddonLogo !== false,
        stream_badge_placement: settings.badgePlacement === "TOP" ? "TOP" : "BOTTOM"
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      projected.stream_badge_rules = String(raw.stream_badge_rules || "").trim();
      projected.show_file_size_badges = booleanFromAnyKey(raw, ["show_file_size_badges"]) ?? true;
      projected.show_addon_logo = booleanFromAnyKey(raw, ["show_addon_logo"]) ?? true;
      projected.stream_badge_placement =
        String(raw.stream_badge_placement || raw.badge_placement || raw.badgePlacement || "")
          .trim()
          .toUpperCase() === "TOP"
          ? "TOP"
          : "BOTTOM";
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (raw.stream_badge_rules != null) {
        const normalizedRules = parseStreamBadgeRulesFromPayload(
          raw.stream_badge_rules,
          "Pasted badge rules"
        );
        partial.rules = normalizedRules || { imports: [] };
      }
      if (booleanOrNull(raw.show_file_size_badges) != null) {
        partial.showFileSizeBadges = Boolean(raw.show_file_size_badges);
      }
      if (booleanOrNull(raw.show_addon_logo) != null) {
        partial.showAddonLogo = Boolean(raw.show_addon_logo);
      }
      const badgePlacement = String(
        raw.stream_badge_placement ?? raw.badge_placement ?? raw.badgePlacement ?? ""
      )
        .trim()
        .toUpperCase();
      if (badgePlacement === "TOP" || badgePlacement === "BOTTOM") {
        partial.badgePlacement = badgePlacement;
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      StreamBadgeSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  track_preference: {
    export(profileId) {
      return TrackPreferencesStore.exportFeaturePayload(profileId);
    },
    project(rawFeature = {}) {
      return normalizeFeaturePayload(rawFeature);
    },
    import(profileId, rawFeature = {}) {
      return TrackPreferencesStore.importFeaturePayload(
        normalizeFeaturePayload(rawFeature),
        profileId
      );
    }
  },
  debrid_settings: {
    export(profileId) {
      const settings = DebridSettingsStore.getForProfile(profileId);
      return {
        debrid_enabled: Boolean(settings.enabled),
        cloud_library_enabled: settings.cloudLibraryEnabled !== false,
        torbox_api_key: String(settings.torboxApiKey || "").trim(),
        premiumize_api_key: String(settings.premiumizeApiKey || "").trim(),
        real_debrid_api_key: String(settings.realDebridApiKey || "").trim(),
        preferred_resolver_provider_id: String(settings.preferredResolverProviderId || "").trim(),
        instant_playback_preparation_limit: Math.max(
          0,
          Math.min(5, Math.trunc(Number(settings.instantPlaybackPreparationLimit || 0)))
        ),
        stream_max_results: Math.max(
          0,
          Math.min(100, Math.trunc(Number(settings.streamMaxResults || 0)))
        ),
        stream_sort_mode: String(settings.streamSortMode || "DEFAULT").toUpperCase(),
        stream_minimum_quality: String(settings.streamMinimumQuality || "ANY").toUpperCase(),
        stream_dolby_vision_filter: String(settings.streamDolbyVisionFilter || "ANY").toUpperCase(),
        stream_hdr_filter: String(settings.streamHdrFilter || "ANY").toUpperCase(),
        stream_codec_filter: String(settings.streamCodecFilter || "ANY").toUpperCase(),
        stream_preferences: JSON.stringify(
          normalizeDebridStreamPreferences(settings.streamPreferences)
        ),
        debrid_stream_name_template: String(settings.streamNameTemplate || ""),
        debrid_stream_description_template: String(
          settings.streamDescriptionTemplate ?? ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE
        )
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      ["debrid_enabled", "cloud_library_enabled"].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      [
        "torbox_api_key",
        "premiumize_api_key",
        "real_debrid_api_key",
        "preferred_resolver_provider_id",
        "stream_sort_mode",
        "stream_minimum_quality",
        "stream_dolby_vision_filter",
        "stream_hdr_filter",
        "stream_codec_filter",
        "debrid_stream_name_template",
        "debrid_stream_description_template"
      ].forEach((key) => {
        if (raw[key] != null) {
          projected[key] = String(raw[key] || "").trim();
        }
      });
      if (raw.stream_preferences != null) {
        projected.stream_preferences = JSON.stringify(
          normalizeDebridStreamPreferences(String(raw.stream_preferences || "").trim())
        );
      }
      ["instant_playback_preparation_limit", "stream_max_results"].forEach((key) => {
        if (numberOrNull(raw[key]) != null) {
          const max = key === "instant_playback_preparation_limit" ? 5 : 100;
          projected[key] = Math.max(0, Math.min(max, Math.trunc(Number(raw[key]))));
        }
      });
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.debrid_enabled) != null) {
        partial.enabled = Boolean(raw.debrid_enabled);
      }
      if (booleanOrNull(raw.cloud_library_enabled) != null) {
        partial.cloudLibraryEnabled = Boolean(raw.cloud_library_enabled);
      }
      if (raw.torbox_api_key != null) {
        partial.torboxApiKey = String(raw.torbox_api_key || "").trim();
      }
      if (raw.premiumize_api_key != null) {
        partial.premiumizeApiKey = String(raw.premiumize_api_key || "").trim();
      }
      if (raw.real_debrid_api_key != null) {
        partial.realDebridApiKey = String(raw.real_debrid_api_key || "").trim();
      }
      if (raw.preferred_resolver_provider_id != null) {
        partial.preferredResolverProviderId = String(
          raw.preferred_resolver_provider_id || ""
        ).trim();
      }
      if (numberOrNull(raw.instant_playback_preparation_limit) != null) {
        partial.instantPlaybackPreparationLimit = Math.max(
          0,
          Math.min(5, Math.trunc(Number(raw.instant_playback_preparation_limit)))
        );
      }
      if (numberOrNull(raw.stream_max_results) != null) {
        partial.streamMaxResults = Math.max(
          0,
          Math.min(100, Math.trunc(Number(raw.stream_max_results)))
        );
      }
      if (raw.stream_sort_mode != null) {
        partial.streamSortMode = String(raw.stream_sort_mode || "DEFAULT")
          .trim()
          .toUpperCase();
      }
      if (raw.stream_minimum_quality != null) {
        partial.streamMinimumQuality = String(raw.stream_minimum_quality || "ANY")
          .trim()
          .toUpperCase();
      }
      if (raw.stream_dolby_vision_filter != null) {
        partial.streamDolbyVisionFilter = String(raw.stream_dolby_vision_filter || "ANY")
          .trim()
          .toUpperCase();
      }
      if (raw.stream_hdr_filter != null) {
        partial.streamHdrFilter = String(raw.stream_hdr_filter || "ANY")
          .trim()
          .toUpperCase();
      }
      if (raw.stream_codec_filter != null) {
        partial.streamCodecFilter = String(raw.stream_codec_filter || "ANY")
          .trim()
          .toUpperCase();
      }
      if (raw.stream_preferences != null) {
        partial.streamPreferences = normalizeDebridStreamPreferences(
          String(raw.stream_preferences || "").trim()
        );
      }
      if (raw.debrid_stream_name_template != null) {
        partial.streamNameTemplate = String(raw.debrid_stream_name_template || "");
      }
      if (raw.debrid_stream_description_template != null) {
        partial.streamDescriptionTemplate = String(raw.debrid_stream_description_template || "");
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      DebridSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  }
};

const SUPPORTED_FEATURE_NAMES = Object.keys(FEATURE_ADAPTERS);

function buildComparableFeaturesFromBlob(blob = {}) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    const featurePayload = withoutExcludedProfileSettingsKeys(
      featureName,
      blob?.features?.[featureName] || {}
    );
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(featurePayload);
    return accumulator;
  }, {});
}

function buildComparableFeaturesFromLocal(profileId) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    const exported = FEATURE_ADAPTERS[featureName].export(profileId);
    const featurePayload = withoutExcludedProfileSettingsKeys(featureName, exported);
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(featurePayload);
    return accumulator;
  }, {});
}

function buildComparableSignatureFromBlob(blob = {}) {
  return stableStringify(buildComparableFeaturesFromBlob(blob));
}

function buildComparableSignatureFromLocal(profileId) {
  return stableStringify(buildComparableFeaturesFromLocal(profileId));
}

function buildOutgoingBlob(profileId, baseBlob = null) {
  const normalizedBase = normalizeBlob(baseBlob || {});
  const nextFeatures = Object.entries(normalizedBase.features).reduce(
    (accumulator, [featureName, featurePayload]) => {
      if (!SUPPORTED_FEATURE_NAMES.includes(featureName)) return accumulator;
      const encodedPayload = encodeFeaturePayload(featurePayload, featureName);
      EXCLUDED_PROFILE_KEYS[featureName]?.forEach((key) => delete encodedPayload[key]);
      accumulator[featureName] = encodedPayload;
      return accumulator;
    },
    {}
  );

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

function extractBlobFromResponse(response) {
  const payload = Array.isArray(response) ? response[0] || null : response;
  const blob = payload?.settings_json ?? payload?.settingsJson ?? null;
  if (!isPlainObject(blob)) {
    return null;
  }
  return normalizeBlob(blob);
}

async function pullRemoteBlob(profileId) {
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

function applyRemoteBlob(profileId, blob) {
  let applied = false;
  SUPPORTED_FEATURE_NAMES.forEach((featureName) => {
    const featurePayload = withoutExcludedProfileSettingsKeys(
      featureName,
      blob?.features?.[featureName] || {}
    );
    const didApply = FEATURE_ADAPTERS[featureName].import(profileId, featurePayload);
    if (didApply) {
      applied = true;
    }
  });
  return applied;
}

async function pullProfileSettingsUnlocked(resolvedProfileId) {
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
      !blob ||
      !AuthManager.isAuthenticated ||
      isSyncBackoffActive() ||
      hasProfileSettingsCloudSyncPending(resolvedProfileId)
    ) {
      return false;
    }

    setCachedBlob(resolvedProfileId, blob);

    const remoteSignature = buildComparableSignatureFromBlob(blob);
    const localSignature = buildComparableSignatureFromLocal(resolvedProfileId);
    if (remoteSignature === localSignature) {
      return false;
    }

    return applyRemoteBlob(String(resolvedProfileId), blob);
  } catch (error) {
    if (shouldTreatAsMissingResource(error)) {
      return false;
    }
    console.warn("Profile settings sync pull failed", error);
    return false;
  }
}

async function pushProfileSettingsUnlocked(resolvedProfileId) {
  try {
    if (!AuthManager.isAuthenticated || isSyncBackoffActive()) {
      return false;
    }
    const pendingVersion = getProfileSettingsCloudSyncPendingVersion(resolvedProfileId);
    const remoteBlob = await pullRemoteBlob(resolvedProfileId);
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

export const ProfileSettingsSyncService = {
  async pull(profileId = null) {
    const resolvedProfileId = resolveProfileId(profileId);
    return withProfileSettingsSyncLock(resolvedProfileId, () =>
      pullProfileSettingsUnlocked(resolvedProfileId)
    );
  },

  async push(profileId = null) {
    const resolvedProfileId = resolveProfileId(profileId);
    return withProfileSettingsSyncLock(resolvedProfileId, () =>
      pushProfileSettingsUnlocked(resolvedProfileId)
    );
  }
};
