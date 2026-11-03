import { Router } from "../../navigation/routerState.js";
import { isWatchPartySectionVisible } from "./settingsWatchPartySection.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { LocalStore } from "../../../core/storage/localStore.js";

import { SessionStore } from "../../../core/storage/sessionStore.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

import { accentColorForTheme, ThemeStore } from "../../../data/local/themeStore.js";

import { MemberAccessRepository } from "../../../data/remote/supabase/memberAccessRepository.js";

import { ThemeManager } from "../../theme/themeManager.js";

import { ThemeColors } from "../../theme/themeColors.js";

import { availableThemeIds, resolveThemeName } from "../../theme/themeAccess.js";

import { renderMemberBrandWordmark } from "../../components/memberBrandWordmark.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_MAX,
  SUBTITLE_VERTICAL_OFFSET_MIN,
  normalizeSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

import {
  SUBTITLE_TEXT_OPACITY_MAX,
  SUBTITLE_TEXT_OPACITY_MIN,
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity
} from "../../../core/player/subtitleTextOpacity.js";

import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";

import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";

import { AnimeSkipSettingsStore } from "../../../data/local/animeSkipSettingsStore.js";

import {
  DEBRID_SETTINGS_DEFAULTS,
  DEBRID_SORT_PROFILES,
  DEBRID_STREAM_AUDIO_CHANNELS,
  DEBRID_STREAM_AUDIO_TAGS,
  DEBRID_STREAM_ENCODES,
  DEBRID_STREAM_LANGUAGES,
  DEBRID_STREAM_QUALITIES,
  DEBRID_STREAM_RESOLUTIONS,
  DEBRID_STREAM_VISUAL_TAGS,
  DEFAULT_STREAM_PREFERENCES,
  normalizeDebridStreamPreferences,
  DebridSettingsStore
} from "../../../data/local/debridSettingsStore.js";

import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";

import { DebridApi } from "../../../data/remote/api/debridApi.js";

import { DEBRID_AUTH_METHODS, DebridProviders } from "../../../core/debrid/debridProviders.js";

import { DEBRID_DEVICE_AUTH_STATUS, DebridDeviceAuthService } from "../../../core/debrid/debridDeviceAuthService.js";

import { ProfileManager } from "../../../core/profile/profileManager.js";

import { AuthManager } from "../../../core/auth/authManager.js";

import { SupabaseApi } from "../../../data/remote/supabase/supabaseApi.js";

import { Platform } from "../../../platform/index.js";

import { TizenCapabilities } from "../../../platform/tizen/tizenCapabilities.js";

import { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

import { CW_DISPLAY_SNAPSHOT_KEY, CW_ENRICHMENT_CACHE_KEY } from "../home/homeConstants.js";

import { I18n } from "../../../i18n/index.js";

import { isContentRtl } from "../../../core/util/contentTextDirection.js";

import { PluginManager } from "../../../core/player/pluginManager.js";

import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";

import { TraktAuthService } from "../../../data/repository/traktAuthService.js";

import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

import {
  getStreamBadgePreviewSections,
  normalizeStreamBadgeChipColor,
  STREAM_BADGE_IMPORT_LIMIT
} from "../../../core/streams/streamBadgeRules.js";

import {
  TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource
} from "../../../data/local/traktSettingsStore.js";

import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isModernSidebarBlurAvailable,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { getLatestAppUpdate } from "../../../core/update/appUpdateService.js";

import { showAppUpdatePrompt } from "../../components/appUpdatePrompt.js";

import { getScrollMax, getScrollPosition } from "./settingsScreenHelpers-07-normalize-tmdb-language-code.js";
import { SECTION_META } from "./settingsScreenHelpers-03-clamp-subtitle-text-opacity.js";
import { arePluginsSupported } from "./settingsScreenHelpers-04-row-icons.js";

export function updateSettingsScrollIndicators(container) {
  if (!container) {
    return;
  }

  const verticalFrame = container.closest?.(".settings-content-frame, .settings-trakt-scroll-frame");
  if (verticalFrame && (container.classList?.contains("settings-content") || container.classList?.contains("settings-trakt-scroll-area"))) {
    const maxScroll = getScrollMax(container, "y");
    const scrollTop = getScrollPosition(container, "y");
    verticalFrame.classList.toggle("can-scroll-backward", scrollTop > 1);
    verticalFrame.classList.toggle("can-scroll-forward", maxScroll > 1 && scrollTop < maxScroll - 1);
  }

  const horizontalFrame = container.closest?.(".settings-horizontal-scroll-frame");
  if (horizontalFrame && container.classList?.contains("settings-theme-row")) {
    const maxScroll = getScrollMax(container, "x");
    const scrollLeft = getScrollPosition(container, "x");
    horizontalFrame.classList.toggle("can-scroll-backward", scrollLeft > 1);
    horizontalFrame.classList.toggle("can-scroll-forward", maxScroll > 1 && scrollLeft < maxScroll - 1);
  }
}

export function updateSettingsScrollIndicatorsSoon(container) {
  if (!container) {
    return;
  }
  requestAnimationFrame(() => updateSettingsScrollIndicators(container));
}

export function bindSettingsScrollIndicators(root) {
  if (!root) {
    return;
  }

  root.querySelectorAll?.(".settings-content, .settings-theme-row, .settings-trakt-scroll-area").forEach((container) => {
    if (!container.settingsScrollIndicatorBound) {
      container.settingsScrollIndicatorBound = true;
      container.addEventListener("scroll", () => updateSettingsScrollIndicators(container), {
        passive: true
      });
    }
    updateSettingsScrollIndicatorsSoon(container);
  });
}

export function settingsScrollIndicatorMarkup(axis = "vertical") {
  if (axis === "horizontal") {
    return `
      <span class="settings-scroll-indicator settings-scroll-indicator-left" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M14.6 7.4 10 12l4.6 4.6" /></svg>
      </span>
      <span class="settings-scroll-indicator settings-scroll-indicator-right" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="m9.4 7.4 4.6 4.6-4.6 4.6" /></svg>
      </span>
    `;
  }
  return `
    <span class="settings-scroll-indicator settings-scroll-indicator-up" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="M7.4 14.6 12 10l4.6 4.6" /></svg>
    </span>
    <span class="settings-scroll-indicator settings-scroll-indicator-down" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="m7.4 9.4 4.6 4.6 4.6-4.6" /></svg>
    </span>
  `;
}

export function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getSessionEmail() {
  const payload = decodeJwtPayload(SessionStore.accessToken);
  return String(payload?.email || payload?.user_metadata?.email || "").trim() || null;
}

export async function fetchAccountSyncOverview() {
  const response = await SupabaseApi.rpc("get_sync_overview", {}, true);
  const source = response && typeof response === "object" && !Array.isArray(response) ? response : {};
  const addons = source.addons && typeof source.addons === "object" ? source.addons : {};
  const plugins = source.plugins && typeof source.plugins === "object" ? source.plugins : {};
  const libraryItems = source.library_items && typeof source.library_items === "object" ? source.library_items : {};
  const watchProgress = source.watch_progress && typeof source.watch_progress === "object" ? source.watch_progress : {};
  const watchedItems = source.watched_items && typeof source.watched_items === "object" ? source.watched_items : {};
  const remoteProfiles = source.profiles && typeof source.profiles === "object" ? source.profiles : {};
  const profiles = await ProfileManager.getProfiles();
  const allProfileIds = Array.from(
    new Set([
      ...Object.keys(addons),
      ...Object.keys(plugins),
      ...Object.keys(libraryItems),
      ...Object.keys(watchProgress),
      ...Object.keys(watchedItems),
      ...Object.keys(remoteProfiles)
    ])
  )
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((left, right) => left - right);

  const readCount = (bucket, id) => {
    const value = Number(bucket[String(id)] || 0);
    return Number.isFinite(value) ? value : 0;
  };
  const total = (bucket) =>
    Object.values(bucket).reduce((sum, value) => {
      const count = Number(value || 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

  return {
    profileCount: Object.keys(remoteProfiles).length,
    totalAddons: total(addons),
    totalPlugins: total(plugins),
    totalLibrary: total(libraryItems),
    totalWatchProgress: total(watchProgress),
    totalWatchedItems: total(watchedItems),
    perProfile: allProfileIds.map((profileId) => {
      const profileIdString = String(profileId);
      const localProfile = profiles.find(
        (profile) => String(profile?.id) === profileIdString || String(profile?.profileIndex) === profileIdString
      );
      const remoteProfile = remoteProfiles[profileIdString] || {};
      return {
        profileId,
        profileName: localProfile?.name || remoteProfile.name || `Profile ${profileId}`,
        avatarColorHex: localProfile?.avatarColorHex || remoteProfile.color || "#1E88E5",
        addons: readCount(addons, profileId),
        plugins: readCount(plugins, profileId),
        library: readCount(libraryItems, profileId),
        watchProgress: readCount(watchProgress, profileId),
        watchedItems: readCount(watchedItems, profileId)
      };
    })
  };
}

export function getVisibleSections(model) {
  const isPrimaryProfileActive = String(model?.activeProfileId || "1") === "1";
  const isEssential = model?.experience?.mode === "ESSENTIAL";
  return SECTION_META.filter((section) => {
    if (section.hideFromNav) {
      return false;
    }
    if (section.id === "plugins" && !arePluginsSupported()) {
      return false;
    }
    // Android keeps Fusion/stream presentation controls inside the advanced
    // part of Layout, which is not exposed in Essential mode.
    if (isEssential && section.id === "streams") {
      return false;
    }
    if (section.id === "account" || section.id === "profiles") {
      return isPrimaryProfileActive;
    }
    if (section.id === "watchParty") {
      return isWatchPartySectionVisible();
    }
    return true;
  });
}

export function getSettingsSectionById(sectionId) {
  return SECTION_META.find((section) => section.id === sectionId) || null;
}
