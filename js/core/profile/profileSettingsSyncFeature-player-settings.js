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
import { normalizeHdrBrightnessPreset } from "../player/hdrColorCalibration.js";

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

export const player_settings = {
  export(profileId) {
    const settings = PlayerSettingsStore.getForProfile(profileId);
    return {
      preferred_audio_language: normalizeAudioLanguageForAndroid(settings.preferredAudioLanguage),
      secondary_preferred_audio_language: normalizeSecondaryAudioLanguageForAndroid(settings.secondaryPreferredAudioLanguage),
      subtitle_preferred_language: normalizePreferredSubtitleLanguageForAndroid(settings),
      subtitle_secondary_language: normalizeSecondarySubtitleLanguageForAndroid(settings),
      subtitle_use_forced_subtitles: shouldUseForcedSubtitlesForAndroid(settings),
      subtitle_size: Math.min(200, Math.max(50, Math.trunc(Number(settings.subtitleStyle?.fontSize ?? 120) || 120))),
      subtitle_vertical_offset: normalizeSubtitleVerticalOffset(settings.subtitleStyle?.verticalOffset),
      subtitle_bold: Boolean(settings.subtitleStyle?.bold),
      subtitle_text_color: hexToAndroidColorInt(settings.subtitleStyle?.textColor, "#ffffff", settings.subtitleStyle?.textOpacity),
      subtitle_background_color: cssColorToAndroidColorInt(settings.subtitleStyle?.backgroundColor),
      subtitle_outline_enabled: settings.subtitleStyle?.outlineEnabled !== false,
      subtitle_outline_color: hexToAndroidColorInt(settings.subtitleStyle?.outlineColor, "#000000"),
      subtitle_hdr_brightness_preset: String(settings.subtitleStyle?.hdrBrightnessPreset || "REFERENCE"),
      loading_overlay_enabled: settings.loadingOverlayEnabled !== false,
      show_player_loading_status: settings.showPlayerLoadingStatus !== false,
      pause_overlay_enabled: settings.pauseOverlayEnabled !== false,
      parental_guide_enabled: settings.parentalGuideEnabled !== false,
      osd_clock_enabled: settings.osdClockEnabled !== false,
      subtitle_show_only_preferred_languages: Boolean(settings.subtitleStyle?.showOnlyPreferredLanguages),
      auto_skip_segment_types: Array.isArray(settings.autoSkipSegmentTypes) ? settings.autoSkipSegmentTypes : [],
      skip_intro_enabled: Boolean(settings.skipIntroEnabled),
      stream_auto_play_next_episode_enabled: Boolean(settings.autoplayNextEpisode),
      stream_auto_play_prefer_bingegroup_next_episode: Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode),
      stream_auto_play_reuse_binge_group: Boolean(settings.streamAutoPlayReuseBingeGroup),
      stream_reuse_last_link_enabled: Boolean(settings.streamReuseLastLinkEnabled),
      stream_reuse_last_link_cache_hours: Math.min(
        168,
        Math.max(1, Math.trunc(Number(settings.streamReuseLastLinkCacheHours ?? 24) || 24))
      ),
      still_watching_enabled: Boolean(settings.stillWatchingEnabled),
      still_watching_episode_threshold: normalizeStillWatchingThresholdForSync(settings.stillWatchingEpisodeThreshold),
      next_episode_threshold_mode: normalizeNextEpisodeThresholdModeForSync(settings.nextEpisodeThresholdMode),
      next_episode_threshold_percent_v2: normalizeHalfStepForSync(settings.nextEpisodeThresholdPercent, 97, 100, 99),
      next_episode_threshold_minutes_before_end_v2: normalizeHalfStepForSync(settings.nextEpisodeThresholdMinutesBeforeEnd, 0, 3.5, 2),
      stream_auto_play_mode: String(settings.streamAutoPlayMode || "MANUAL"),
      stream_auto_play_source: String(settings.streamAutoPlaySource || "ALL_SOURCES"),
      stream_auto_play_selected_addons: Array.isArray(settings.streamAutoPlaySelectedAddons) ? settings.streamAutoPlaySelectedAddons : [],
      stream_auto_play_selected_plugins: Array.isArray(settings.streamAutoPlaySelectedPlugins)
        ? settings.streamAutoPlaySelectedPlugins
        : [],
      stream_auto_play_regex: String(settings.streamAutoPlayRegex || ""),
      stream_auto_play_timeout_seconds: Math.max(0, Math.trunc(Number(settings.streamAutoPlayTimeoutSeconds ?? 3) || 0))
    };
  },
  project(rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const projected = {};
    if (stringOrNull(raw.preferred_audio_language)) {
      projected.preferred_audio_language = normalizeAudioLanguageForAndroid(raw.preferred_audio_language);
    }
    if (stringOrNull(raw.secondary_preferred_audio_language)) {
      const secondaryAudioLanguage = normalizeSecondaryAudioLanguageForAndroid(raw.secondary_preferred_audio_language);
      if (secondaryAudioLanguage) {
        projected.secondary_preferred_audio_language = secondaryAudioLanguage;
      }
    }
    if (stringOrNull(raw.subtitle_preferred_language)) {
      projected.subtitle_preferred_language = normalizeSubtitleLanguage(raw.subtitle_preferred_language, "off");
    }
    if (stringOrNull(raw.subtitle_secondary_language)) {
      projected.subtitle_secondary_language = normalizeSubtitleLanguage(raw.subtitle_secondary_language, "off");
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
    ["subtitle_size", "subtitle_text_color", "subtitle_background_color", "subtitle_outline_color"].forEach((key) => {
      if (numberOrNull(raw[key]) != null) {
        projected[key] = Math.trunc(Number(raw[key]));
      }
    });
    if (numberOrNull(raw.subtitle_vertical_offset) != null) {
      projected.subtitle_vertical_offset = normalizeSubtitleVerticalOffset(raw.subtitle_vertical_offset);
    }
    ["stream_auto_play_mode", "stream_auto_play_source", "stream_auto_play_regex"].forEach((key) => {
      if (raw[key] != null) {
        projected[key] = String(raw[key]);
      }
    });
    if (Array.isArray(raw.auto_skip_segment_types)) projected.auto_skip_segment_types = raw.auto_skip_segment_types;
    if (stringOrNull(raw.addon_subtitle_startup_mode))
      projected.addon_subtitle_startup_mode = String(raw.addon_subtitle_startup_mode).toUpperCase();
    if (numberOrNull(raw.stream_auto_play_timeout_seconds) != null) {
      projected.stream_auto_play_timeout_seconds = Math.max(0, Math.trunc(Number(raw.stream_auto_play_timeout_seconds)));
    }
    if (numberOrNull(raw.stream_reuse_last_link_cache_hours) != null) {
      projected.stream_reuse_last_link_cache_hours = Math.min(168, Math.max(1, Math.trunc(Number(raw.stream_reuse_last_link_cache_hours))));
    }
    ["stream_auto_play_selected_addons", "stream_auto_play_selected_plugins"].forEach((key) => {
      if (Array.isArray(raw[key])) {
        projected[key] = raw[key].map((entry) => String(entry || "").trim()).filter(Boolean);
      }
    });
    if (numberOrNull(raw.still_watching_episode_threshold) != null) {
      projected.still_watching_episode_threshold = normalizeStillWatchingThresholdForSync(raw.still_watching_episode_threshold);
    }
    if (raw.next_episode_threshold_mode != null) {
      projected.next_episode_threshold_mode = normalizeNextEpisodeThresholdModeForSync(raw.next_episode_threshold_mode);
    }
    const thresholdPercent = numberOrNull(raw.next_episode_threshold_percent_v2) ?? numberOrNull(raw.next_episode_threshold_percent);
    if (thresholdPercent != null) {
      projected.next_episode_threshold_percent_v2 = normalizeHalfStepForSync(thresholdPercent, 97, 100, 99);
    }
    const thresholdMinutes =
      numberOrNull(raw.next_episode_threshold_minutes_before_end_v2) ?? numberOrNull(raw.next_episode_threshold_minutes_before_end);
    if (thresholdMinutes != null) {
      projected.next_episode_threshold_minutes_before_end_v2 = normalizeHalfStepForSync(thresholdMinutes, 0, 3.5, 2);
    }
    return projected;
  },
  import(profileId, rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const partial = {};
    const subtitleStyle = {};
    const preferredAudioLanguage = normalizeAudioLanguageForWeb(raw.preferred_audio_language);
    const secondaryPreferredAudioLanguage = normalizeAudioLanguageForWeb(raw.secondary_preferred_audio_language);
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
        secondarySubtitleLanguage && secondarySubtitleLanguage !== "forced" && secondarySubtitleLanguage !== "off"
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
      subtitleStyle.showOnlyPreferredLanguages = Boolean(raw.subtitle_show_only_preferred_languages);
    }
    if (numberOrNull(raw.subtitle_size) != null) {
      subtitleStyle.fontSize = Math.min(200, Math.max(50, Math.trunc(Number(raw.subtitle_size))));
    }
    if (numberOrNull(raw.subtitle_vertical_offset) != null) {
      subtitleStyle.verticalOffset = normalizeSubtitleVerticalOffset(raw.subtitle_vertical_offset);
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
    if (raw.subtitle_hdr_brightness_preset != null) {
      subtitleStyle.hdrBrightnessPreset = normalizeHdrBrightnessPreset(raw.subtitle_hdr_brightness_preset);
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
    if (Array.isArray(raw.auto_skip_segment_types)) partial.autoSkipSegmentTypes = raw.auto_skip_segment_types;
    if (booleanOrNull(raw.stream_auto_play_next_episode_enabled) != null) {
      partial.autoplayNextEpisode = Boolean(raw.stream_auto_play_next_episode_enabled);
    }
    if (booleanOrNull(raw.stream_auto_play_prefer_bingegroup_next_episode) != null) {
      partial.streamAutoPlayPreferBingeGroupForNextEpisode = Boolean(raw.stream_auto_play_prefer_bingegroup_next_episode);
    }
    if (booleanOrNull(raw.still_watching_enabled) != null) {
      partial.stillWatchingEnabled = Boolean(raw.still_watching_enabled);
    }
    if (numberOrNull(raw.still_watching_episode_threshold) != null) {
      partial.stillWatchingEpisodeThreshold = normalizeStillWatchingThresholdForSync(raw.still_watching_episode_threshold);
    }
    if (raw.next_episode_threshold_mode != null) {
      partial.nextEpisodeThresholdMode = normalizeNextEpisodeThresholdModeForSync(raw.next_episode_threshold_mode);
    }
    const thresholdPercent = numberOrNull(raw.next_episode_threshold_percent_v2) ?? numberOrNull(raw.next_episode_threshold_percent);
    if (thresholdPercent != null) {
      partial.nextEpisodeThresholdPercent = normalizeHalfStepForSync(thresholdPercent, 97, 100, 99);
    }
    const thresholdMinutes =
      numberOrNull(raw.next_episode_threshold_minutes_before_end_v2) ?? numberOrNull(raw.next_episode_threshold_minutes_before_end);
    if (thresholdMinutes != null) {
      partial.nextEpisodeThresholdMinutesBeforeEnd = normalizeHalfStepForSync(thresholdMinutes, 0, 3.5, 2);
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
      partial.streamAutoPlayTimeoutSeconds = Math.max(0, Math.trunc(Number(raw.stream_auto_play_timeout_seconds)));
    }
    if (booleanOrNull(raw.stream_auto_play_reuse_binge_group) != null) {
      partial.streamAutoPlayReuseBingeGroup = Boolean(raw.stream_auto_play_reuse_binge_group);
    }
    if (booleanOrNull(raw.stream_reuse_last_link_enabled) != null) {
      partial.streamReuseLastLinkEnabled = Boolean(raw.stream_reuse_last_link_enabled);
    }
    if (numberOrNull(raw.stream_reuse_last_link_cache_hours) != null) {
      partial.streamReuseLastLinkCacheHours = Math.min(168, Math.max(1, Math.trunc(Number(raw.stream_reuse_last_link_cache_hours))));
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
};
