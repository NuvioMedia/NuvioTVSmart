import { projectCustomPosterSettings, importCustomPosterSettings } from "./profileSettingsSyncCustomPoster.js";
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

export const layout_settings = {
  export(profileId) {
    const layout = LayoutPreferences.getForProfile(profileId);
    return {
      custom_poster_url_pattern: layout.customPosterUrlPattern || "",
      custom_poster_enabled_screens: layout.customPosterEnabledScreens.length ? layout.customPosterEnabledScreens.join(",") : "none",
      selected_layout: normalizeHomeLayoutForAndroid(layout.homeLayout),
      has_chosen_layout: Boolean(layout.hasChosenLayout),
      sidebar_collapsed_by_default: Boolean(layout.collapseSidebar),
      modern_sidebar_enabled: Boolean(layout.modernSidebar),
      modern_sidebar_blur_enabled: Boolean(layout.modernSidebarBlur),
      modern_landscape_posters_enabled: Boolean(layout.modernLandscapePostersEnabled),
      always_show_landscape_clearlogo: Boolean(layout.alwaysShowLandscapeClearlogo),
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
      focused_poster_backdrop_trailer_enabled: Boolean(layout.focusedPosterBackdropTrailerEnabled),
      focused_poster_backdrop_trailer_muted: layout.focusedPosterBackdropTrailerMuted !== false,
      focused_poster_backdrop_trailer_playback_target: normalizeTrailerTargetForAndroid(layout.focusedPosterBackdropTrailerPlaybackTarget),
      poster_card_width_dp: Math.max(72, Math.trunc(Number(layout.posterCardWidthDp ?? 126) || 126)),
      poster_card_height_dp: Math.max(108, Math.trunc((Math.trunc(Number(layout.posterCardWidthDp ?? 126) || 126) * 3) / 2)),
      poster_card_corner_radius_dp: Math.max(0, Math.trunc(Number(layout.posterCardCornerRadiusDp ?? 12))),
      card_depth_enabled: Boolean(layout.cardDepthEnabled),
      card_depth_edge_strength: Math.min(100, Math.max(0, Math.trunc(Number(layout.cardDepthEdgeStrength ?? 28) || 0))),
      card_depth_sheen_strength: Math.min(100, Math.max(0, Math.trunc(Number(layout.cardDepthSheenStrength ?? 10) || 0))),
      card_depth_edge_coverage: Math.min(100, Math.max(0, Math.trunc(Number(layout.cardDepthEdgeCoverage ?? 0) || 0))),
      card_depth_posters_enabled: layout.cardDepthPostersEnabled !== false,
      card_depth_continue_watching_enabled: layout.cardDepthContinueWatchingEnabled !== false,
      card_depth_episode_cards_enabled: layout.cardDepthEpisodeCardsEnabled !== false,
      card_depth_cast_enabled: layout.cardDepthCastEnabled !== false,
      card_depth_trailers_enabled: layout.cardDepthTrailersEnabled !== false,
      continue_watching_card_style: String(layout.continueWatchingCardStyle || "card").toUpperCase(),
      detail_page_trailer_button_enabled: Boolean(layout.detailPageTrailerButtonEnabled),
      prefer_external_meta_addon_detail: layout.preferExternalMetaAddonDetail !== false,
      show_full_release_date: layout.showFullReleaseDate !== false,
      blur_unwatched_episodes: Boolean(layout.blurUnwatchedEpisodes),
      random_episode_enabled: Boolean(layout.randomEpisodeEnabled),
      hide_unreleased_content: Boolean(layout.hideUnreleasedContent),
      use_episode_thumbnails_in_cw: layout.useEpisodeThumbnailsInCw !== false,
      blur_continue_watching_next_up: Boolean(layout.blurContinueWatchingNextUp),
      show_unaired_next_up: layout.showUnairedNextUp !== false,
      next_up_from_furthest_episode: layout.nextUpFromFurthestEpisode !== false,
      continue_watching_sort_mode: normalizeContinueWatchingSortModeForAndroid(layout.continueWatchingSortMode),
      home_imdb_ratings_visibility: String(layout.homeImdbRatingsVisibility || "SHOW_ALL").toUpperCase(),
      detail_imdb_ratings_visibility: String(layout.detailImdbRatingsVisibility || "SHOW_ALL").toUpperCase(),
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
      "always_show_landscape_clearlogo",
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
      "random_episode_enabled",
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
      projected.discover_location = normalizeDiscoverLocationForAndroid(raw.search_discover_enabled === false ? "OFF" : "IN_SEARCH");
    }
    if (stringOrNull(raw.focused_poster_backdrop_trailer_playback_target)) {
      projected.focused_poster_backdrop_trailer_playback_target = normalizeTrailerTargetForAndroid(
        raw.focused_poster_backdrop_trailer_playback_target
      );
    }
    if (stringOrNull(raw.continue_watching_sort_mode)) {
      projected.continue_watching_sort_mode = normalizeContinueWatchingSortModeForAndroid(raw.continue_watching_sort_mode);
    }
    if (stringOrNull(raw.continue_watching_card_style))
      projected.continue_watching_card_style = String(raw.continue_watching_card_style).toUpperCase();
    Object.assign(projected, projectCustomPosterSettings(raw));
    if (Array.isArray(raw.hero_catalog_keys)) projected.hero_catalog_keys = raw.hero_catalog_keys.map(String).filter(Boolean);
    ["card_depth_edge_strength", "card_depth_sheen_strength", "card_depth_edge_coverage"].forEach((key) => {
      if (numberOrNull(raw[key]) != null) projected[key] = Math.min(100, Math.max(0, Math.trunc(Number(raw[key]))));
    });
    if (numberOrNull(raw.poster_card_width_dp) != null) {
      projected.poster_card_width_dp = Math.max(72, Math.trunc(Number(raw.poster_card_width_dp)));
    }
    if (numberOrNull(raw.poster_card_height_dp) != null) {
      projected.poster_card_height_dp = Math.max(108, Math.trunc(Number(raw.poster_card_height_dp)));
    }
    if (numberOrNull(raw.poster_card_corner_radius_dp) != null) {
      projected.poster_card_corner_radius_dp = Math.max(0, Math.trunc(Number(raw.poster_card_corner_radius_dp)));
    }
    if (booleanOrNull(raw.fast_horizontal_navigation_enabled) != null) {
      projected.fast_horizontal_navigation_enabled = Boolean(raw.fast_horizontal_navigation_enabled);
    }
    if (stringOrNull(raw.home_imdb_ratings_visibility)) {
      projected.home_imdb_ratings_visibility = String(raw.home_imdb_ratings_visibility).trim().toUpperCase();
    }
    return projected;
  },
  import(profileId, rawFeature = {}, { isRemoteFeaturePresent = false } = {}) {
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
    if (booleanOrNull(raw.always_show_landscape_clearlogo) != null) {
      partial.alwaysShowLandscapeClearlogo = Boolean(raw.always_show_landscape_clearlogo);
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
    Object.assign(partial, importCustomPosterSettings(raw, isRemoteFeaturePresent));
    if (Array.isArray(raw.hero_catalog_keys)) partial.heroCatalogKeys = raw.hero_catalog_keys.map(String).filter(Boolean);
    if (stringOrNull(raw.continue_watching_card_style))
      partial.continueWatchingCardStyle = String(raw.continue_watching_card_style).toLowerCase();
    if (booleanOrNull(raw.focused_poster_backdrop_expand_enabled) != null) {
      partial.focusedPosterBackdropExpandEnabled = Boolean(raw.focused_poster_backdrop_expand_enabled);
    }
    if (numberOrNull(raw.focused_poster_backdrop_expand_delay_seconds) != null) {
      partial.focusedPosterBackdropExpandDelaySeconds = Math.max(0, Math.trunc(Number(raw.focused_poster_backdrop_expand_delay_seconds)));
    }
    if (booleanOrNull(raw.focused_poster_backdrop_trailer_enabled) != null) {
      partial.focusedPosterBackdropTrailerEnabled = Boolean(raw.focused_poster_backdrop_trailer_enabled);
    }
    if (booleanOrNull(raw.focused_poster_backdrop_trailer_muted) != null) {
      partial.focusedPosterBackdropTrailerMuted = Boolean(raw.focused_poster_backdrop_trailer_muted);
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
      partial.posterCardCornerRadiusDp = Math.max(0, Math.trunc(Number(raw.poster_card_corner_radius_dp)));
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
    if (booleanOrNull(raw.random_episode_enabled) != null) partial.randomEpisodeEnabled = Boolean(raw.random_episode_enabled);
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
      partial.continueWatchingSortMode = normalizeContinueWatchingSortModeForWeb(raw.continue_watching_sort_mode);
    }
    if (stringOrNull(raw.home_imdb_ratings_visibility)) {
      partial.homeImdbRatingsVisibility = String(raw.home_imdb_ratings_visibility).trim().toUpperCase();
    }
    if (stringOrNull(raw.detail_imdb_ratings_visibility)) {
      partial.detailImdbRatingsVisibility = String(raw.detail_imdb_ratings_visibility).trim().toUpperCase();
    }
    if (!Object.keys(partial).length) {
      return false;
    }
    LayoutPreferences.setForProfile(profileId, partial, { silentSync: true });
    return true;
  }
};
