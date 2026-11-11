import { Router } from "../../navigation/routerState.js";

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

import { normalizeSelectableSubtitleLanguageCode } from "./settingsScreenHelpers-06-debrid-rule-rows.js";
import { translateOptionLabel, t, clamp } from "./settingsScreenHelpers-04-row-icons.js";
import { PREFERRED_SUBTITLE_LANGUAGE_OPTIONS } from "./settingsScreenHelpers-02-available-languages.js";
import { updateSettingsScrollIndicators } from "./settingsScreenHelpers-08-update-settings-scroll-indicators.js";
import {
  SETTINGS_RAIL_SCROLL_DAMPING_RATIO,
  SETTINGS_RAIL_SCROLL_STIFFNESS,
  SETTINGS_RAIL_SCROLL_TARGET_RATIO
} from "./settingsScreenHelpers-01-settings-ui-state-key.js";

export function normalizeTmdbLanguageCode(language) {
  const code = String(language ?? "")
    .trim()
    .replace(/_/g, "-");
  if (!code) {
    return "en";
  }

  switch (code.toLowerCase()) {
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
      return code.toLowerCase();
  }
}

export function labelForSubtitlePlaybackLanguage(language) {
  const normalized = normalizeSelectableSubtitleLanguageCode(language);
  return translateOptionLabel(
    PREFERRED_SUBTITLE_LANGUAGE_OPTIONS.find((item) => String(item.id) === normalized),
    normalized === "off"
      ? "Off"
      : normalized === "forced"
        ? t("settings.playback.useForcedSubtitles.title", {}, "Use forced subtitles")
        : normalized === "system"
          ? t("common.system")
          : String(language || "system")
  );
}

export function subtitleLanguageOptionCode(option) {
  const normalized = normalizeSelectableSubtitleLanguageCode(option?.id);
  if (!normalized || normalized === "off") {
    return "";
  }
  return normalized.toUpperCase();
}

export function renderModeLabel(value) {
  return String(value || "native").toLowerCase() === "html" ? t("common.htmlOverlay") : t("common.native");
}

export function escapeSelector(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

export function plannedSubtitle(subtitle) {
  return subtitle ? t("common.comingSoonWithContext", { subject: subtitle }) : t("common.comingSoon");
}

export function focusKeySelector(selector, key) {
  return `${selector}[data-focus-key="${escapeSelector(String(key))}"]`;
}

export function isSettingsActivateEvent(event) {
  const code = Number(event?.keyCode || event?.which || 0);
  const key = String(event?.key || "");
  return code === 13 || code === 23 || key === "Enter" || key === "NumpadEnter" || key === "OK" || key === "Select";
}

export function scrollIntoNearestView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }
  try {
    node.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  } catch (_) {
    node.scrollIntoView();
  }
}

export function getScrollMax(node, axis = "y") {
  if (!node) {
    return 0;
  }
  return Math.max(0, axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight);
}

export function getScrollPosition(node, axis = "y") {
  return Number(axis === "x" ? node?.scrollLeft || 0 : node?.scrollTop || 0);
}

export function setScrollPosition(node, value, axis = "y") {
  if (!node) {
    return;
  }
  if (axis === "x") {
    node.scrollLeft = value;
    return;
  }
  node.scrollTop = value;
}

export function animateSettingsScroll(container, nextPosition, axis = "y") {
  if (!container) {
    return;
  }

  const frameKey = axis === "x" ? "settingsScrollAnimationFrameX" : "settingsScrollAnimationFrameY";
  if (container[frameKey]) {
    cancelAnimationFrame(container[frameKey]);
    container[frameKey] = null;
  }

  // Constrained sets snap, like Home: on a 2019 Tizen set the spring cost a
  // 10 ms composite on each of its ~11 frames, for every key in Settings.
  const snap = Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  const startPosition = getScrollPosition(container, axis);
  if (snap || Math.abs(nextPosition - startPosition) < 1 || typeof requestAnimationFrame !== "function") {
    setScrollPosition(container, nextPosition, axis);
    updateSettingsScrollIndicators(container);
    return;
  }

  let position = startPosition;
  let velocity = 0;
  let lastTime = performance.now();
  const damping = 2 * SETTINGS_RAIL_SCROLL_DAMPING_RATIO * Math.sqrt(SETTINGS_RAIL_SCROLL_STIFFNESS);
  const step = (now) => {
    const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    const displacement = position - nextPosition;
    const acceleration = -SETTINGS_RAIL_SCROLL_STIFFNESS * displacement - damping * velocity;
    velocity += acceleration * deltaSeconds;
    position += velocity * deltaSeconds;
    setScrollPosition(container, position, axis);
    updateSettingsScrollIndicators(container);

    if (Math.abs(position - nextPosition) > 0.5 || Math.abs(velocity) > 0.5) {
      container[frameKey] = requestAnimationFrame(step);
    } else {
      setScrollPosition(container, nextPosition, axis);
      container[frameKey] = null;
      updateSettingsScrollIndicators(container);
    }
  };

  container[frameKey] = requestAnimationFrame(step);
}

export function scrollSettingsNodeIntoContainer(node, container, axis = "y") {
  if (!node || !container) {
    return;
  }

  const maxScroll = getScrollMax(container, axis);
  if (maxScroll <= 0) {
    updateSettingsScrollIndicators(container);
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const containerSize = axis === "x" ? container.clientWidth : container.clientHeight;
  const nodeStart = axis === "x" ? nodeRect.left - containerRect.left : nodeRect.top - containerRect.top;
  const nodeSize = axis === "x" ? nodeRect.width || node.offsetWidth || 0 : nodeRect.height || node.offsetHeight || 0;
  const itemCenterInViewport = nodeStart + nodeSize / 2;
  const targetCenter = containerSize * SETTINGS_RAIL_SCROLL_TARGET_RATIO;
  const nextPosition = clamp(getScrollPosition(container, axis) + itemCenterInViewport - targetCenter, 0, maxScroll);

  if (Math.abs(getScrollPosition(container, axis) - nextPosition) < 1) {
    updateSettingsScrollIndicators(container);
    return;
  }
  animateSettingsScroll(container, nextPosition, axis);
}

export function scrollSettingsContentItem(node) {
  if (!node) {
    return;
  }

  const dialogContainer = node.closest?.(".settings-dialog-list");
  if (dialogContainer) {
    scrollSettingsNodeIntoContainer(node, dialogContainer, "y");
    return;
  }

  const horizontalContainer = node.closest?.(".settings-theme-row");
  if (horizontalContainer) {
    scrollSettingsNodeIntoContainer(node, horizontalContainer, "x");
  }

  const verticalContainer = node.closest?.(".settings-content, .settings-group-card-fill, .settings-trakt-scroll-area, .supporters-list");
  if (verticalContainer) {
    scrollSettingsNodeIntoContainer(node, verticalContainer, "y");
    return;
  }

  scrollIntoNearestView(node);
}
