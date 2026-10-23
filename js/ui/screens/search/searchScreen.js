import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import {
  SEARCH_HISTORY_MAX_ITEMS,
  SearchHistoryStore
} from "../../../data/local/searchHistoryStore.js";
import { I18n } from "../../../i18n/index.js";
import { contentTextDirection } from "../../../core/util/contentTextDirection.js";
import { Platform } from "../../../platform/index.js";
import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";
import { MODERN_HOME_CONSTANTS } from "../home/modernHomeLayout.js";
import { allowDpadRepeat, resetDpadRepeat } from "../../navigation/dpadRepeatThrottle.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../components/posterOptionsMenu.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { filterReleasedItems } from "../../../core/util/releaseInfoUtils.js";
import {
  buildSearchScheduleIndices,
  buildSearchTargets,
  catalogSkipStep,
  catalogSupportsExtra
} from "./searchCatalogTargets.js";

import { createSearchScreenMethods01 } from "./searchScreenMethods-01-get-route-state-key.js";
import { createSearchScreenMethods02 } from "./searchScreenMethods-02-load-discover-rows.js";
import { createSearchScreenMethods03 } from "./searchScreenMethods-03-render-recent-searches.js";
import { createSearchScreenMethods04 } from "./searchScreenMethods-04-open-sidebar.js";
import { createSearchScreenMethods05 } from "./searchScreenMethods-05-ensure-header-visible.js";
import { createSearchScreenMethods06 } from "./searchScreenMethods-06-activate-action-node.js";

export {
  Router,
  ScreenUtils,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchedTitleStateRepository,
  LayoutPreferences,
  SEARCH_HISTORY_MAX_ITEMS,
  SearchHistoryStore,
  I18n,
  contentTextDirection,
  Platform,
  getTvRuntimePerformanceProfile,
  MODERN_HOME_CONSTANTS,
  allowDpadRepeat,
  resetDpadRepeat,
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded,
  PosterOptionsDialogController,
  posterItemFromNode,
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge,
  renderLoadingIndicator,
  filterReleasedItems,
  buildSearchScheduleIndices,
  buildSearchTargets,
  catalogSkipStep,
  catalogSupportsExtra,
  POSTER_HOLD_DELAY_MS,
  SEARCH_RESULTS_PER_ROW_DEFAULT,
  SEARCH_RESULTS_PER_ROW_CONSTRAINED,
  SEARCH_DISCOVER_RESULTS_PER_ROW_DEFAULT,
  SEARCH_DISCOVER_RESULTS_PER_ROW_CONSTRAINED,
  SEARCH_CATALOG_BATCH_SIZE_CONSTRAINED,
  SEARCH_CATALOG_TIMEOUT_MS_DEFAULT,
  SEARCH_CATALOG_TIMEOUT_MS_CONSTRAINED,
  clamp,
  escapeHtml,
  toTitleCase,
  formatTypeLabel,
  trimLeadingWhitespace,
  t,
  escapeRegExp,
  escapeSelectorValue,
  formatCatalogRowTitle,
  isSearchableCatalogType,
  isPerformanceConstrainedRuntime,
  getSearchResultsPerRow,
  getSearchDiscoverResultsPerRow,
  getSearchCatalogBatchSize,
  getSearchCatalogTimeoutMs,
  getInputSelectionSnapshot,
  restoreInputSelection,
  formatDateLabel,
  formatReleaseYear,
  withTimeout,
  buildRowStateKey
};
const POSTER_HOLD_DELAY_MS = 650;
const SEARCH_RESULTS_PER_ROW_DEFAULT = 18;
const SEARCH_RESULTS_PER_ROW_CONSTRAINED = 12;
const SEARCH_DISCOVER_RESULTS_PER_ROW_DEFAULT = 14;
const SEARCH_DISCOVER_RESULTS_PER_ROW_CONSTRAINED = 10;
const SEARCH_CATALOG_BATCH_SIZE_CONSTRAINED = 3;
const SEARCH_CATALOG_TIMEOUT_MS_DEFAULT = 3500;
const SEARCH_CATALOG_TIMEOUT_MS_CONSTRAINED = 6500;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatTypeLabel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Movie";
  if (normalized === "tv") return "TV";
  return toTitleCase(normalized) || "Movie";
}

function trimLeadingWhitespace(value) {
  const text = String(value || "");
  if (typeof text.trimStart === "function") {
    return text.trimStart();
  }
  return text.replace(/^\s+/, "");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeSelectorValue(value = "") {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function formatCatalogRowTitle(catalogName, addonName, type, showTypeSuffix = true) {
  const typeLabel = formatTypeLabel(type);
  let base = String(catalogName || "").trim();
  if (!base) return typeLabel;
  const addon = String(addonName || "").trim();
  const cleanedAddon = addon.replace(/\baddon\b/i, "").trim();
  [addon, cleanedAddon, "The Movie Database Addon", "TMDB Addon", "Addon"]
    .filter(Boolean)
    .forEach((term) => {
      const regex = new RegExp(`\\s*-?\\s*${escapeRegExp(term)}\\s*`, "ig");
      base = base.replace(regex, " ");
    });
  base = base.replace(/\s{2,}/g, " ").trim();
  if (!base) return typeLabel;
  if (!showTypeSuffix) return base;
  const endsWithType = new RegExp(`\\b${escapeRegExp(typeLabel)}$`, "i").test(base);
  return endsWithType ? base : `${base} - ${typeLabel}`;
}

function isSearchableCatalogType(type) {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "movie" ||
    normalized === "series" ||
    normalized === "tv" ||
    normalized === "anime"
  );
}

function isPerformanceConstrainedRuntime() {
  return (
    getTvRuntimePerformanceProfile().isPerformanceConstrained ||
    Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"))
  );
}

function getSearchResultsPerRow() {
  return isPerformanceConstrainedRuntime()
    ? SEARCH_RESULTS_PER_ROW_CONSTRAINED
    : SEARCH_RESULTS_PER_ROW_DEFAULT;
}

function getSearchDiscoverResultsPerRow() {
  return isPerformanceConstrainedRuntime()
    ? SEARCH_DISCOVER_RESULTS_PER_ROW_CONSTRAINED
    : SEARCH_DISCOVER_RESULTS_PER_ROW_DEFAULT;
}

function getSearchCatalogBatchSize() {
  return isPerformanceConstrainedRuntime() ? SEARCH_CATALOG_BATCH_SIZE_CONSTRAINED : 0;
}

function getSearchCatalogTimeoutMs() {
  return isPerformanceConstrainedRuntime()
    ? SEARCH_CATALOG_TIMEOUT_MS_CONSTRAINED
    : SEARCH_CATALOG_TIMEOUT_MS_DEFAULT;
}

function getInputSelectionSnapshot(input = null) {
  if (
    !input ||
    typeof input.selectionStart !== "number" ||
    typeof input.selectionEnd !== "number"
  ) {
    return null;
  }
  return {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection || "none",
    valueLength: String(input.value || "").length
  };
}

function restoreInputSelection(input = null, snapshot = null) {
  if (!input || !snapshot || typeof input.setSelectionRange !== "function") {
    return;
  }
  const valueLength = String(input.value || "").length;
  const start = clamp(Number(snapshot.start || 0), 0, valueLength);
  const end = clamp(Number(snapshot.end || start), 0, valueLength);
  try {
    input.setSelectionRange(start, end, snapshot.direction || "none");
  } catch (_) {
    // Some TV inputs expose selection APIs but reject while the OS keyboard is settling.
  }
}

function formatDateLabel(item = {}) {
  const candidates = [
    item.released,
    item.releaseDate,
    item.release_date,
    item.releaseInfo,
    item.year
  ].filter(Boolean);

  for (const value of candidates) {
    const raw = String(value).trim();
    if (!raw) continue;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      return raw;
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
    const yearOnly = raw.match(/\b(19|20)\d{2}\b/);
    if (yearOnly) {
      return `01/01/${yearOnly[0]}`;
    }
  }
  return "";
}

function formatReleaseYear(item = {}) {
  const rawDate = formatDateLabel(item);
  const matchFromFormatted = rawDate.match(/\b(19|20)\d{2}\b/);
  if (matchFromFormatted) {
    return matchFromFormatted[0];
  }

  const candidates = [
    item.released,
    item.releaseDate,
    item.release_date,
    item.releaseInfo,
    item.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
}

async function withTimeout(promise, ms, fallbackValue, onTimeout = null) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          if (typeof onTimeout === "function") onTimeout();
          resolve(fallbackValue);
        }, ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildRowStateKey(row = {}, rowIndex = 0) {
  const parts = [
    row.addonBaseUrl,
    row.addonId,
    row.catalogId,
    row.catalogName,
    row.type,
    row.title,
    rowIndex
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.join("|") || `row:${rowIndex}`;
}

export const SearchScreen = {
  ...createSearchScreenMethods01(),
  ...createSearchScreenMethods02(),
  ...createSearchScreenMethods03(),
  ...createSearchScreenMethods04(),
  ...createSearchScreenMethods05(),
  ...createSearchScreenMethods06()
};
