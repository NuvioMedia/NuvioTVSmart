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

export const trailer_settings = {
  export(profileId) {
    const settings = PlayerSettingsStore.getForProfile(profileId);
    return {
      trailer_enabled: Boolean(settings.trailerAutoplay),
      trailer_delay_seconds: Math.min(15, Math.max(0, Number(settings.trailerDelaySeconds ?? 7) || 0)),
      trailer_subtitles_enabled: settings.trailerSubtitles === true
    };
  },
  project(rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const projected = {};
    if (booleanOrNull(raw.trailer_enabled) != null) {
      projected.trailer_enabled = Boolean(raw.trailer_enabled);
    }
    if (numberOrNull(raw.trailer_delay_seconds) != null)
      projected.trailer_delay_seconds = Math.min(15, Math.max(0, Math.trunc(Number(raw.trailer_delay_seconds))));
    if (booleanOrNull(raw.trailer_subtitles_enabled) != null) {
      projected.trailer_subtitles_enabled = Boolean(raw.trailer_subtitles_enabled);
    }
    return projected;
  },
  import(profileId, rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    if (
      booleanOrNull(raw.trailer_enabled) == null &&
      numberOrNull(raw.trailer_delay_seconds) == null &&
      booleanOrNull(raw.trailer_subtitles_enabled) == null
    ) {
      return false;
    }
    PlayerSettingsStore.setForProfile(
      profileId,
      {
        ...(booleanOrNull(raw.trailer_enabled) != null ? { trailerAutoplay: Boolean(raw.trailer_enabled) } : {}),
        ...(numberOrNull(raw.trailer_delay_seconds) != null ? { trailerDelaySeconds: Number(raw.trailer_delay_seconds) } : {}),
        ...(booleanOrNull(raw.trailer_subtitles_enabled) != null ? { trailerSubtitles: Boolean(raw.trailer_subtitles_enabled) } : {})
      },
      { silentSync: true }
    );
    return true;
  }
};
