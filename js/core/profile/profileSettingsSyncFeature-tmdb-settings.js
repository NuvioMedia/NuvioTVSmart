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

import {
  normalizeFeaturePayload,
  stringOrNull,
  booleanOrNull,
  numberOrNull,
  normalizeNextEpisodeThresholdModeForSync,
  booleanFromAnyKey
} from "./profileSettingsSyncServiceHelpers-01-pull-rpc.js";

import {
  normalizeHomeLayoutForAndroid,
  normalizeDiscoverLocationForAndroid,
  normalizeTrailerTargetForAndroid,
  normalizeHomeLayoutForWeb,
  normalizeDiscoverLocationForWeb,
  normalizeTrailerTargetForWeb,
  normalizeAudioLanguageForAndroid,
  normalizeSecondaryAudioLanguageForAndroid,
  normalizePreferredSubtitleLanguageForAndroid,
  normalizeSecondarySubtitleLanguageForAndroid,
  shouldUseForcedSubtitlesForAndroid,
  normalizeStillWatchingThresholdForSync,
  normalizeHalfStepForSync,
  normalizeSubtitleLanguage,
  normalizeAudioLanguageForWeb,
  normalizeTraktWatchProgressSourceForAndroid,
  normalizeTraktLibrarySourceForAndroid,
  normalizeTraktWatchProgressSourceForWeb,
  normalizeTraktLibrarySourceForWeb
} from "./profileSettingsSyncServiceHelpers-02-normalize-half-step-for-sync.js";

import {
  normalizeContinueWatchingSortModeForAndroid,
  normalizeContinueWatchingSortModeForWeb,
  hexToAndroidColorInt,
  cssColorToAndroidColorInt,
  androidColorIntToHex,
  androidColorIntToCss,
  normalizeTmdbLanguageForAndroid,
  normalizeTmdbLanguageForWeb
} from "./profileSettingsSyncServiceHelpers-03-normalize-continue-watching-sort-mode-for-android.js";

export const tmdb_settings = {
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
      tmdb_use_credits: settings.useCredits !== false,
      tmdb_use_productions: settings.useProductions !== false,
      tmdb_use_networks: settings.useNetworks !== false,
      tmdb_use_episodes: settings.useEpisodes !== false,
      tmdb_use_season_posters: settings.useSeasonPosters === true,
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
      "tmdb_use_season_posters",
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
    if (booleanOrNull(raw.tmdb_use_season_posters) != null) {
      partial.useSeasonPosters = Boolean(raw.tmdb_use_season_posters);
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
};
