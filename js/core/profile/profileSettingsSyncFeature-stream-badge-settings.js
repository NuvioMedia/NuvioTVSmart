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

export const stream_badge_settings = {
  export(profileId) {
    const settings = StreamBadgeSettingsStore.getForProfile(profileId);
    const rules = normalizeStreamBadgeRules(settings.rules);
    return {
      stream_badge_rules: rules.imports.length ? JSON.stringify(rules) : "",
      show_file_size_badges: settings.showFileSizeBadges !== false,
      show_addon_logo: settings.showAddonLogo !== false,
      show_badges_in_player: settings.showInPlayer === true,
      player_badge_source: settings.playerBadgeSource || "",
      stream_badge_placement: settings.badgePlacement === "TOP" ? "TOP" : "BOTTOM"
    };
  },
  project(rawFeature = {}) {
    const raw = normalizeFeaturePayload(rawFeature);
    const projected = {};
    projected.stream_badge_rules = String(raw.stream_badge_rules || "").trim();
    projected.show_file_size_badges = booleanFromAnyKey(raw, ["show_file_size_badges"]) ?? true;
    projected.show_addon_logo = booleanFromAnyKey(raw, ["show_addon_logo"]) ?? true;
    projected.show_badges_in_player = booleanFromAnyKey(raw, ["show_badges_in_player"]) ?? false;
    projected.player_badge_source = String(raw.player_badge_source || "").trim();
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
      const normalizedRules = parseStreamBadgeRulesFromPayload(raw.stream_badge_rules, "Pasted badge rules");
      partial.rules = normalizedRules || { imports: [] };
    }
    if (booleanOrNull(raw.show_file_size_badges) != null) {
      partial.showFileSizeBadges = Boolean(raw.show_file_size_badges);
    }
    if (booleanOrNull(raw.show_addon_logo) != null) {
      partial.showAddonLogo = Boolean(raw.show_addon_logo);
    }
    if (booleanOrNull(raw.show_badges_in_player) != null) partial.showInPlayer = Boolean(raw.show_badges_in_player);
    if (raw.player_badge_source != null) partial.playerBadgeSource = String(raw.player_badge_source).trim();
    const badgePlacement = String(raw.stream_badge_placement ?? raw.badge_placement ?? raw.badgePlacement ?? "")
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
};
