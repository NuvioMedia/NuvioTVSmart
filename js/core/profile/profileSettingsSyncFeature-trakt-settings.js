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

import { TraktSettingsStore, normalizeRatingSource, normalizeTraktContinueWatchingDaysCap } from "../../data/local/traktSettingsStore.js";

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

export const trakt_settings = {
  export(profileId) {
    const settings = TraktSettingsStore.getForProfile(profileId);
    return {
      continue_watching_days_cap: normalizeTraktContinueWatchingDaysCap(settings.continueWatchingDaysCap),
      dismissed_next_up_keys: ContinueWatchingPreferences.getDismissedNextUpKeys(profileId),
      show_meta_comments: settings.showMetaComments !== false,
      watch_progress_source: normalizeTraktWatchProgressSourceForAndroid(settings.watchProgressSource),
      library_source_mode: normalizeTraktLibrarySourceForAndroid(settings.librarySourceMode),
      simkl_anime_id_preference: String(settings.simklAnimeIdPreference || "imdb").toUpperCase(),
      more_like_this_source: String(settings.moreLikeThisSource || "trakt").toUpperCase(),
      // Android stores rating_source only while a source is chosen.
      ...(settings.ratingSource ? { rating_source: settings.ratingSource } : {})
    };
  },
  project(rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const projected = {};
    if (numberOrNull(raw.continue_watching_days_cap) != null) {
      projected.continue_watching_days_cap = normalizeTraktContinueWatchingDaysCap(raw.continue_watching_days_cap);
    }
    if (Array.isArray(raw.dismissed_next_up_keys)) {
      projected.dismissed_next_up_keys = raw.dismissed_next_up_keys.map(String).filter(Boolean);
    }
    if (booleanOrNull(raw.show_meta_comments) != null) {
      projected.show_meta_comments = Boolean(raw.show_meta_comments);
    }
    if (stringOrNull(raw.watch_progress_source)) {
      projected.watch_progress_source = normalizeTraktWatchProgressSourceForAndroid(raw.watch_progress_source);
    }
    if (stringOrNull(raw.library_source_mode)) {
      projected.library_source_mode = normalizeTraktLibrarySourceForAndroid(raw.library_source_mode);
    }
    if (stringOrNull(raw.simkl_anime_id_preference)) {
      projected.simkl_anime_id_preference = String(raw.simkl_anime_id_preference).toUpperCase();
    }
    if (stringOrNull(raw.more_like_this_source)) {
      projected.more_like_this_source = String(raw.more_like_this_source).toUpperCase();
    }
    if (normalizeRatingSource(raw.rating_source)) {
      projected.rating_source = normalizeRatingSource(raw.rating_source);
    }
    return projected;
  },
  import(profileId, rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const partial = {};
    if (numberOrNull(raw.continue_watching_days_cap) != null) {
      partial.continueWatchingDaysCap = normalizeTraktContinueWatchingDaysCap(raw.continue_watching_days_cap);
    }
    if (Array.isArray(raw.dismissed_next_up_keys)) {
      ContinueWatchingPreferences.replaceDismissedNextUpKeys(raw.dismissed_next_up_keys, profileId, { silentSync: true });
    }
    if (booleanOrNull(raw.show_meta_comments) != null) {
      partial.showMetaComments = Boolean(raw.show_meta_comments);
    }
    if (stringOrNull(raw.watch_progress_source)) {
      partial.watchProgressSource = normalizeTraktWatchProgressSourceForWeb(raw.watch_progress_source);
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
    // Android writes the whole feature: no rating_source means the rate button is off.
    if (Object.keys(raw).length) {
      partial.ratingSource = normalizeRatingSource(raw.rating_source);
    }
    if (!Object.keys(partial).length) {
      return false;
    }
    TraktSettingsStore.setForProfile(profileId, partial, { silentSync: true });
    return true;
  }
};
