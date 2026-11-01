import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { localizedGenreLabel } from "../../../i18n/genreLabels.js";
import { Platform } from "../../../platform/index.js";
import { MODERN_HOME_CONSTANTS } from "../home/modernHomeLayout.js";
import { renderContentFilterPicker } from "../../components/filterPicker.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../components/posterOptionsMenu.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isRootSidebarNode,
  isSelectedSidebarAction,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { allowDpadRepeat, resetDpadRepeat } from "../../navigation/dpadRepeatThrottle.js";
import { catalogSkipStep, catalogSupportsExtra } from "../../../core/addons/homeCatalogs.js";

import { createDiscoverScreenMethods01 } from "./discoverScreenMethods-01-clear-closing-picker.js";
import { createDiscoverScreenMethods02 } from "./discoverScreenMethods-02-reload-items.js";
import { createDiscoverScreenMethods03 } from "./discoverScreenMethods-03-open-picker-menu.js";
import { createDiscoverScreenMethods04 } from "./discoverScreenMethods-04-restore-focused-card.js";
import { createDiscoverScreenMethods05 } from "./discoverScreenMethods-05-restore-content-focus.js";
import { createDiscoverScreenMethods06 } from "./discoverScreenMethods-06-bind-card-events.js";

export {
  Router,
  ScreenUtils,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchedTitleStateRepository,
  LayoutPreferences,
  I18n,
  Platform,
  MODERN_HOME_CONSTANTS,
  renderContentFilterPicker,
  PosterOptionsDialogController,
  posterItemFromNode,
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge,
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isRootSidebarNode,
  isSelectedSidebarAction,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded,
  renderLoadingIndicator,
  allowDpadRepeat,
  resetDpadRepeat,
  catalogSkipStep,
  catalogSupportsExtra,
  POSTER_HOLD_DELAY_MS,
  PICKER_MENU_EXIT_MS,
  DISCOVER_POSTER_PREFETCH_MARGIN_PX,
  toTitleCase,
  formatAddonTypeLabel,
  formatGenreLabel,
  escapeHtml,
  t,
  groupNodesByOffsetTop,
  extractReleaseYear,
  actionForPickerKind,
  isKey,
  isUpKey,
  isDownKey,
  isLeftKey,
  isRightKey,
  isEnterKey,
  setContainerScrollTop,
  scrollNodeIntoContainerView
};
const POSTER_HOLD_DELAY_MS = 650;
const PICKER_MENU_EXIT_MS = 160;
const DISCOVER_POSTER_PREFETCH_MARGIN_PX = 640;

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatAddonTypeLabel(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();
  if (!type || type === "movie") return t("type_movie", {}, "Movie");
  if (type === "tv") return "TV";
  if (type === "series") return t("type_series", {}, "Series");
  return toTitleCase(type);
}

// "Default" is the stored genre value; only its label is localized, like Android TV.
function formatGenreLabel(value) {
  return value === "Default"
    ? t("discover_genre_default", {}, "Default")
    : localizedGenreLabel(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function groupNodesByOffsetTop(nodes = []) {
  const grouped = [];
  nodes.forEach((node) => {
    const top = Math.round(node.offsetTop);
    const bucket = grouped.find((entry) => Math.abs(entry.top - top) <= 6);
    if (bucket) {
      bucket.nodes.push(node);
      return;
    }
    grouped.push({ top, nodes: [node] });
  });
  grouped.sort((left, right) => left.top - right.top);
  return grouped.map((entry) => entry.nodes);
}

function extractReleaseYear(item = {}) {
  const candidates = [
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.releaseInfo,
    item?.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function actionForPickerKind(kind) {
  if (kind === "type") return "discoverFilterType";
  if (kind === "catalog") return "discoverFilterCatalog";
  if (kind === "genre") return "discoverFilterGenre";
  return "discoverFilterType";
}

function isKey(event, code, aliases = []) {
  const keyCode = Number(event?.keyCode || 0);
  if (keyCode === code) return true;
  const key = String(event?.key || "");
  return aliases.includes(key);
}

function isUpKey(event) {
  return isKey(event, 38, ["ArrowUp", "Up"]);
}

function isDownKey(event) {
  return isKey(event, 40, ["ArrowDown", "Down"]);
}

function isLeftKey(event) {
  return isKey(event, 37, ["ArrowLeft", "Left"]);
}

function isRightKey(event) {
  return isKey(event, 39, ["ArrowRight", "Right"]);
}

function isEnterKey(event) {
  return isKey(event, 13, ["Enter"]);
}

function setContainerScrollTop(container, top, behavior = "auto") {
  if (!(container instanceof HTMLElement)) {
    return 0;
  }
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const resolvedTop = Math.max(0, Math.min(maxScrollTop, Number(top || 0)));
  if (behavior === "smooth") {
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: resolvedTop, behavior: "smooth" });
    } else {
      container.scrollTop = resolvedTop;
    }
    return resolvedTop;
  }

  const previousBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  container.scrollTop = resolvedTop;
  void container.offsetHeight;
  container.style.scrollBehavior = previousBehavior;
  return resolvedTop;
}

function scrollNodeIntoContainerView(
  node,
  container,
  { center = false, padding = 18, behavior = "smooth" } = {}
) {
  if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return null;
  }
  const itemTop = node.offsetTop;
  const itemBottom = itemTop + node.offsetHeight;
  const currentTop = container.scrollTop;
  const viewTop = currentTop + padding;
  const viewBottom = currentTop + container.clientHeight - padding;
  let nextScrollTop = currentTop;

  if (center) {
    nextScrollTop = itemTop - (container.clientHeight - node.offsetHeight) / 2;
  } else if (itemTop < viewTop) {
    nextScrollTop = itemTop - padding;
  } else if (itemBottom > viewBottom) {
    nextScrollTop = itemBottom - container.clientHeight + padding;
  }

  const resolvedTop = Math.max(0, nextScrollTop);
  if (Math.abs(resolvedTop - currentTop) <= 1) {
    return resolvedTop;
  }
  if (behavior === "smooth") {
    setContainerScrollTop(container, resolvedTop, "smooth");
  } else {
    setContainerScrollTop(container, resolvedTop, "auto");
  }
  return resolvedTop;
}

export const DiscoverScreen = {
  ...createDiscoverScreenMethods01(),
  ...createDiscoverScreenMethods02(),
  ...createDiscoverScreenMethods03(),
  ...createDiscoverScreenMethods04(),
  ...createDiscoverScreenMethods05(),
  ...createDiscoverScreenMethods06()
};
