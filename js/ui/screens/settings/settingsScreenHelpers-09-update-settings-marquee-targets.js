import { Router } from "../../navigation/routerState.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

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

import {
  SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND,
  SETTINGS_RAIL_SCROLL_TARGET_RATIO,
  SETTINGS_RAIL_SCROLL_DAMPING_RATIO,
  SETTINGS_RAIL_SCROLL_STIFFNESS
} from "./settingsScreenHelpers-01-settings-ui-state-key.js";
import { clamp, t } from "./settingsScreenHelpers-04-row-icons.js";

const SETTINGS_RAIL_HORIZONTAL_EDGE_PADDING = 24;

export function updateSettingsMarqueeTargets(root) {
  root?.querySelectorAll?.(".settings-nav-label").forEach((label) => {
    label._settingsMarqueeAnimation?.cancel?.();
    label._settingsMarqueeAnimation = null;
    label.classList.remove("is-marquee-active");
    label.style.transform = "";
    label.style.removeProperty("--settings-marquee-gap");
    const originalText = label.dataset.marqueeText || String(label.textContent || "");
    label.dataset.marqueeText = originalText;
    label.textContent = originalText;
    const textIsRtl = isContentRtl(originalText);
    label.setAttribute("dir", textIsRtl ? "rtl" : "ltr");

    const item = label.closest(".settings-nav-item");
    if (!item?.classList.contains("focused")) {
      return;
    }

    const textWidth = Number(label.scrollWidth || 0);
    const viewportWidth = Number(label.clientWidth || 0);
    if (textWidth <= viewportWidth + 1) {
      return;
    }

    const spacing = Math.max(24, viewportWidth / 3);
    const distance = textWidth + spacing;
    const travelMs = (distance / SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND) * 1000;

    label.style.setProperty("--settings-marquee-gap", `${spacing}px`);
    label.classList.add("is-marquee-active");
    if (typeof label.animate === "function") {
      label._settingsMarqueeAnimation = label.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(${textIsRtl ? distance : -distance}px)` }],
        {
          duration: travelMs,
          iterations: Infinity,
          easing: "linear"
        }
      );
    }
  });
}

export function scrollSettingsRailItem(node, options = {}) {
  const rail = node?.closest?.(".settings-sidebar");
  if (!rail || !node) {
    return;
  }

  // HORIZON lays the rail out as a row, so the same helper has to scroll on x.
  const horizontal = rail.scrollWidth > rail.clientWidth + 1;
  const clientSize = horizontal ? rail.clientWidth || 0 : rail.clientHeight || 0;
  const maxScroll = Math.max(0, horizontal ? rail.scrollWidth - clientSize : rail.scrollHeight - clientSize);
  if (!clientSize || maxScroll <= 0) {
    return;
  }

  const railRect = rail.getBoundingClientRect();
  const itemRect = node.getBoundingClientRect();
  const current = Number(horizontal ? rail.scrollLeft : rail.scrollTop) || 0;
  let next;
  if (horizontal) {
    // Android's LazyRow only moves when the focused tab is clipped by an edge.
    const itemStart = itemRect.left - railRect.left;
    const itemEnd = itemStart + (itemRect.width || node.offsetWidth || 0);
    if (itemEnd > clientSize) {
      next = current + itemEnd - clientSize + SETTINGS_RAIL_HORIZONTAL_EDGE_PADDING;
    } else if (itemStart < 0) {
      next = current + itemStart - SETTINGS_RAIL_HORIZONTAL_EDGE_PADDING;
    } else {
      next = current;
    }
  } else {
    const itemCenterInViewport = itemRect.top - railRect.top + (itemRect.height || node.offsetHeight || 0) / 2;
    const targetCenter = clientSize * SETTINGS_RAIL_SCROLL_TARGET_RATIO;
    next = current + itemCenterInViewport - targetCenter;
  }
  const nextPosition = clamp(next, 0, maxScroll);

  if (Math.abs(current - nextPosition) < 1) {
    return;
  }
  if (options?.immediate) {
    const frameKey = horizontal ? "settingsScrollAnimationFrameX" : "settingsScrollAnimationFrame";
    if (rail[frameKey]) {
      cancelAnimationFrame(rail[frameKey]);
      rail[frameKey] = null;
    }
    if (horizontal) {
      rail.scrollLeft = nextPosition;
    } else {
      rail.scrollTop = nextPosition;
    }
    updateSettingsRailIndicators(rail);
    return;
  }
  animateSettingsRailScroll(rail, nextPosition, horizontal ? "x" : "y");
}

export function animateSettingsRailScroll(rail, nextPosition, axis = "y") {
  if (!rail) {
    return;
  }

  const frameKey = axis === "x" ? "settingsScrollAnimationFrameX" : "settingsScrollAnimationFrame";
  if (rail[frameKey]) {
    cancelAnimationFrame(rail[frameKey]);
    rail[frameKey] = null;
  }

  const readPosition = () => Number(axis === "x" ? rail.scrollLeft : rail.scrollTop) || 0;
  const writePosition = (value) => {
    if (axis === "x") {
      rail.scrollLeft = value;
    } else {
      rail.scrollTop = value;
    }
  };

  // Constrained sets snap, like Home: on a 2019 Tizen set the spring cost a
  // 10 ms composite on each of its ~11 frames, for every key in Settings.
  const snap = Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  const startPosition = readPosition();
  if (snap || Math.abs(nextPosition - startPosition) < 1 || typeof requestAnimationFrame !== "function") {
    writePosition(nextPosition);
    updateSettingsRailIndicators(rail);
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
    writePosition(position);
    updateSettingsRailIndicators(rail);

    if (Math.abs(position - nextPosition) > 0.5 || Math.abs(velocity) > 0.5) {
      rail[frameKey] = requestAnimationFrame(step);
    } else {
      writePosition(nextPosition);
      rail[frameKey] = null;
      updateSettingsRailIndicators(rail);
    }
  };

  rail[frameKey] = requestAnimationFrame(step);
}

export function updateSettingsRailIndicators(rail) {
  if (!rail) {
    return;
  }

  const frame = rail.closest?.(".settings-sidebar-frame");
  if (!frame) {
    return;
  }

  const horizontal = rail.scrollWidth > rail.clientWidth + 1;
  const maxScroll = Math.max(0, horizontal ? rail.scrollWidth - rail.clientWidth : rail.scrollHeight - rail.clientHeight);
  const position = Number(horizontal ? rail.scrollLeft : rail.scrollTop) || 0;
  frame.classList.toggle("can-scroll-backward", position > 1);
  frame.classList.toggle("can-scroll-forward", maxScroll > 1 && position < maxScroll - 1);
}

export function updateSettingsRailIndicatorsSoon(rail) {
  if (!rail) {
    return;
  }
  requestAnimationFrame(() => updateSettingsRailIndicators(rail));
}

export function focusSettingsNode(node) {
  focusWithoutScroll(node);
}

export function isScrollContainerAtBoundary(node, direction) {
  if (!node) {
    return true;
  }

  const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  if (maxScrollTop <= 0) {
    return true;
  }

  const scrollTop = Number(node.scrollTop || 0);
  if (direction === "up") {
    return scrollTop <= 1;
  }
  if (direction === "down") {
    return scrollTop >= maxScrollTop - 1;
  }
  return false;
}

export function captureSettingsScrollState(contentNode) {
  if (!contentNode) {
    return null;
  }

  const fillScrollers = Array.from(contentNode.querySelectorAll(".settings-group-card-fill, .settings-trakt-scroll-area"));
  const horizontalScrollers = Array.from(contentNode.querySelectorAll(".settings-theme-row"));
  return {
    contentScrollTop: Number(contentNode.scrollTop || 0),
    fillScrollTops: fillScrollers.map((node) => Number(node.scrollTop || 0)),
    horizontalScrollLefts: horizontalScrollers.map((node) => Number(node.scrollLeft || 0))
  };
}

export function restoreSettingsScrollState(contentNode, scrollState) {
  if (!contentNode || !scrollState) {
    return;
  }

  contentNode.scrollTop = Number(scrollState.contentScrollTop || 0);
  Array.from(contentNode.querySelectorAll(".settings-group-card-fill, .settings-trakt-scroll-area")).forEach((node, index) => {
    node.scrollTop = Number(scrollState.fillScrollTops?.[index] || 0);
  });
  Array.from(contentNode.querySelectorAll(".settings-theme-row")).forEach((node, index) => {
    node.scrollLeft = Number(scrollState.horizontalScrollLefts?.[index] || 0);
  });
}

export function addonKindsLabel(addon) {
  const kinds = Array.isArray(addon?.types) ? addon.types.filter(Boolean) : [];
  if (!kinds.length) {
    return t("common.repository");
  }
  return kinds.map((entry) => String(entry)).join(", ");
}
