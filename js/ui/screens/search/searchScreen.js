import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import { MODERN_HOME_CONSTANTS } from "../home/modernHomeLayout.js";
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
import { buildSearchScheduleIndices, buildSearchTargets } from "./searchCatalogTargets.js";

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
    Platform.isWebOS() ||
    Platform.isTizen() ||
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
  getRouteStateKey() {
    return "route:search";
  },

  clearRouteStateOnMount(params = {}) {
    const incomingQuery = String(params.query || "").trim();
    if (!incomingQuery) {
      return false;
    }
    const previousQuery = String(this.query || "").trim();
    return Boolean(previousQuery && previousQuery !== incomingQuery);
  },

  captureRouteState() {
    this.captureLiveViewState();
    const content = this.container?.querySelector(".search-content");
    const rowScrollLeftByKey = {};
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "").trim();
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        rowScrollLeftByKey[rowKey] = Number(track.scrollLeft || 0);
      }
    });
    const focused = this.container?.querySelector(".focusable.focused");
    return {
      query: String(this.query || ""),
      mode: String(this.mode || "idle"),
      rows: Array.isArray(this.rows)
        ? this.rows.map((row, index) => ({
            ...row,
            stateKey: row.stateKey || buildRowStateKey(row, index)
          }))
        : [],
      focusZone: String(this.focusZone || "content"),
      lastContentFocus: this.lastContentFocus ? { ...this.lastContentFocus } : null,
      sidebarExpanded: Boolean(this.sidebarExpanded),
      sidebarFocusIndex: Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0,
      pillIconOnly: Boolean(this.pillIconOnly),
      contentScrollTop: Number(content?.scrollTop || 0),
      rowScrollLeftByKey,
      rowFocusedIndexByKey: this.rowFocusedIndexByKey ? { ...this.rowFocusedIndexByKey } : {},
      pendingAutoFocusResults: false,
      voiceSearchSupported: Boolean(this.voiceSearchSupported),
      focusedAction: String(focused?.dataset?.action || ""),
      focusedRowKey: String(focused?.dataset?.rowKey || ""),
      focusedItemId: String(focused?.dataset?.itemId || ""),
      focusedNavZone: String(focused?.dataset?.navZone || ""),
      focusedNavRow: Number(focused?.dataset?.navRow || 0),
      focusedNavCol: Number(focused?.dataset?.navCol || 0)
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const incomingQuery = String(params.query || "").trim();
    const hasExplicitQuery = Boolean(incomingQuery);
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    this.query = hasExplicitQuery ? incomingQuery : String(snapshot?.query || "").trim();
    this.mode = hasExplicitQuery
      ? incomingQuery.length >= 2
        ? "search"
        : "idle"
      : String(snapshot?.mode || (this.query.length >= 2 ? "search" : "idle"));
    this.rows = Array.isArray(snapshot?.rows)
      ? snapshot.rows.map((row, index) => ({
          ...row,
          stateKey: row.stateKey || buildRowStateKey(row, index)
        }))
      : [];
    this.focusZone = String(snapshot?.focusZone || this.focusZone || "content");
    this.lastContentFocus = snapshot?.lastContentFocus
      ? { ...snapshot.lastContentFocus }
      : this.lastContentFocus || null;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && snapshot?.sidebarExpanded);
    this.sidebarFocusIndex = Number.isFinite(snapshot?.sidebarFocusIndex)
      ? snapshot.sidebarFocusIndex
      : 0;
    this.pillIconOnly = Boolean(snapshot?.pillIconOnly);
    this.contentScrollTop = Number(snapshot?.contentScrollTop || 0);
    this.rowScrollLeftByKey =
      snapshot?.rowScrollLeftByKey && typeof snapshot.rowScrollLeftByKey === "object"
        ? { ...snapshot.rowScrollLeftByKey }
        : {};
    this.rowFocusedIndexByKey =
      snapshot?.rowFocusedIndexByKey && typeof snapshot.rowFocusedIndexByKey === "object"
        ? { ...snapshot.rowFocusedIndexByKey }
        : {};
    this.pendingAutoFocusResults = false;
    this.restoredFocusedDescriptor = snapshot
      ? {
          action: String(snapshot.focusedAction || ""),
          rowKey: String(snapshot.focusedRowKey || ""),
          itemId: String(snapshot.focusedItemId || ""),
          navZone: String(snapshot.focusedNavZone || ""),
          navRow: Number(snapshot.focusedNavRow || 0),
          navCol: Number(snapshot.focusedNavCol || 0)
        }
      : null;
  },

  cancelScheduledRender() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  cancelScheduledInputSearch() {
    if (this.inputSearchTimer) {
      clearTimeout(this.inputSearchTimer);
      this.inputSearchTimer = null;
    }
  },

  requestRender() {
    if (!this.container || Router.getCurrent() !== "search") {
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "search") {
        return;
      }
      this.render();
    });
  },

  async refreshWatchedTitleIds() {
    const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
    this.watchedTitleIds = buildWatchedTitleIdSet(watchedItems);
  },

  captureLiveViewState() {
    const content = this.container?.querySelector(".search-content");
    if (content) {
      this.contentScrollTop = Number(content.scrollTop || 0);
    }
    const nextRowScroll = {};
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "");
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        nextRowScroll[rowKey] = Number(track.scrollLeft || 0);
      }
    });
    if (Object.keys(nextRowScroll).length) {
      this.rowScrollLeftByKey = {
        ...(this.rowScrollLeftByKey || {}),
        ...nextRowScroll
      };
    }
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("search");
    ScreenUtils.show(this.container);
    this.searchRouteEnterPending = true;
    this.activationGuardUntil = Date.now() + 220;
    this.layoutPrefs = LayoutPreferences.get();
    try {
      this.sidebarProfile = await getSidebarProfileState();
    } catch (err) {
      console.warn("debug: fail on load", err);
      this.sidebarProfile = null;
    }
    this.sidebarExpanded = false;
    this.focusZone = "content";
    this.sidebarFocusIndex = 0;
    this.rows = [];
    this.lastContentFocus = null;
    this.contentScrollTop = 0;
    this.rowScrollLeftByKey = {};
    this.rowFocusedIndexByKey = {};
    this.restoredFocusedDescriptor = null;
    // TV platforms provide voice input through their native keyboard/IME, not
    // through a supported Web Speech API that an in-app button can start.
    this.voiceSearchSupported =
      Platform.isBrowser() &&
      typeof window !== "undefined" &&
      (typeof window.SpeechRecognition === "function" ||
        typeof window.webkitSpeechRecognition === "function");
    this.voiceSearchActive = false;
    this.voiceRecognition = this.voiceRecognition || null;
    this.searchToastTimer = null;
    this.inputSearchTimer = null;
    this.posterOptionsMenu = null;
    this.posterOptionsController = null;
    this.pendingPosterOptionsFocusId = "";
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;
    this.hydrateFromRouteState(navigationContext?.restoredState || null, params);
    await this.refreshWatchedTitleIds();
    if (!navigationContext?.isBackNavigation) {
      this.focusZone = "content";
      this.sidebarExpanded = false;
      this.sidebarFocusIndex = 0;
      this.pillIconOnly = false;
    }
    this.loadToken = (this.loadToken || 0) + 1;
    const hasExplicitQuery = Boolean(String(params.query || "").trim());
    const restoredQuery = String(navigationContext?.restoredState?.query || "").trim();
    const shouldUseRestoredState = Boolean(
      navigationContext?.restoredState &&
      (!hasExplicitQuery || restoredQuery === String(params.query || "").trim())
    );
    if (shouldUseRestoredState) {
      this.render();
      return;
    }
    this.renderLoading();
    try {
      await this.reloadRows();
    } catch (err) {
      console.error("searchScreen: Failed to load rows", err);
      this.rows = [];
      this.render();
    }
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="home-shell search-screen-shell${this.searchRouteEnterPending ? " search-route-enter" : ""}">
        ${renderRootSidebar({
          selectedRoute: "search",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main search-content search-loading-shell">
          <div class="search-loading">
            ${renderLoadingIndicator()}
            <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
          </div>
        </main>
      </div>
    `;
    this.searchRouteEnterPending = false;
  },

  async reloadRows() {
    const token = this.loadToken;
    if (this.mode === "search" && this.query.length >= 2) {
      this.rows = await this.searchRows(this.query, {
        token,
        onFirstResults: (rows) => {
          if (token !== this.loadToken) return;
          this.rows = rows;
          if (this.shouldPatchResultsWithoutReplacingInput()) {
            this.renderResultsOnly();
            return;
          }
          this.requestRender();
        }
      });
    } else if (this.mode === "discover") {
      this.rows = await this.loadDiscoverRows();
    } else {
      this.rows = [];
    }
    if (token !== this.loadToken) return;
    if (this.shouldPatchResultsWithoutReplacingInput()) {
      this.renderResultsOnly();
      return;
    }
    this.requestRender();
  },

  shouldPatchResultsWithoutReplacingInput() {
    return this.isSearchInputEditingActive() && !this.pendingAutoFocusResults;
  },

  renderResultsOnly() {
    const content = this.container?.querySelector(".search-content");
    const header = content?.querySelector(".search-header");
    const input = this.container?.querySelector("#searchInput");
    if (!content || !header || !input) {
      this.requestRender();
      return;
    }
    const selectionSnapshot = getInputSelectionSnapshot(input);

    while (header.nextSibling) {
      header.nextSibling.remove();
    }
    content.insertAdjacentHTML("beforeend", this.renderRows());
    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindActionEvents();
    input.value = this.query || "";
    input.focus?.();
    this.focusNode(this.container?.querySelector(".focusable.focused") || null, input);
    restoreInputSelection(input, selectionSnapshot);
    this.pendingAutoFocusResults = false;
  },

  async loadDiscoverRows() {
    const addons = await addonRepository.getInstalledAddons();
    const sections = [];
    const itemLimit = getSearchDiscoverResultsPerRow();
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        const requiresSearch =
          Array.isArray(catalog.extra) &&
          catalog.extra.some(
            (extra) =>
              String(extra?.name || "")
                .trim()
                .toLowerCase() === "search" && Boolean(extra?.isRequired)
          );
        if (requiresSearch) return;
        if (!isSearchableCatalogType(catalog.apiType) && !catalogSupportsExtra(catalog, "search"))
          return;
        sections.push({
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName,
          catalogId: catalog.id,
          catalogName: catalog.name,
          type: catalog.apiType
        });
      });
    });

    const picked = sections.slice(0, 8);
    const batchSize = getSearchCatalogBatchSize();
    const resolved = [];
    const loadSection = async (section) => {
      try {
        const result = await withTimeout(
          catalogRepository.getCatalog({
            addonBaseUrl: section.addonBaseUrl,
            addonId: section.addonId,
            addonName: section.addonName,
            catalogId: section.catalogId,
            catalogName: section.catalogName,
            type: section.type,
            skip: 0,
            supportsSkip: true
          }),
          getSearchCatalogTimeoutMs(),
          { status: "error", message: "timeout" }
        );
        return { ...section, result };
      } catch (err) {
        console.warn(`fail on load catalog ${section.catalogName}:`, err);
        return {
          ...section,
          result: { status: "error", message: "fetch_failed" }
        };
      }
    };

    if (batchSize > 0 && picked.length > batchSize) {
      for (let index = 0; index < picked.length; index += batchSize) {
        const batch = picked.slice(index, index + batchSize);
        resolved.push(...(await Promise.all(batch.map(loadSection))));
        if (index + batchSize < picked.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } else {
      resolved.push(...(await Promise.all(picked.map(loadSection))));
    }

    return resolved
      .filter((entry) => entry.result?.status === "success" && entry.result?.data?.items?.length)
      .map((entry) => {
        const items = entry.result?.data?.items || [];
        return {
          title: formatCatalogRowTitle(
            entry.catalogName,
            entry.addonName,
            entry.type,
            this.layoutPrefs?.catalogTypeSuffixEnabled !== false
          ),
          subtitle:
            this.layoutPrefs?.catalogAddonNameEnabled !== false
              ? `from ${entry.addonName || "Addon"}`
              : "",
          type: entry.type,
          addonBaseUrl: entry.addonBaseUrl,
          addonId: entry.addonId,
          addonName: entry.addonName,
          catalogId: entry.catalogId,
          catalogName: entry.catalogName,
          hasMore: Boolean(items.length > itemLimit || entry.result?.data?.hasMore),
          items: items.slice(0, itemLimit)
        };
      });
  },

  async searchRows(query, { token = this.loadToken, onFirstResults = null } = {}) {
    const addons = await addonRepository.getInstalledAddons();
    const searchableCatalogs = buildSearchTargets(addons);
    const scheduleIndices = buildSearchScheduleIndices(searchableCatalogs);
    const batchSize = getSearchCatalogBatchSize();
    const itemLimit = getSearchResultsPerRow();
    const responses = new Array(searchableCatalogs.length);
    let nextScheduleIndex = 0;
    let publishedFirstResults = false;
    const runCatalogSearch = async (catalog) => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      try {
        const result = await withTimeout(
          catalogRepository.getCatalog({
            addonBaseUrl: catalog.addonBaseUrl,
            addonId: catalog.addonId,
            addonName: catalog.addonName,
            catalogId: catalog.catalogId,
            catalogName: catalog.catalogName,
            type: catalog.type,
            skip: 0,
            extraArgs: { search: query },
            supportsSkip: catalog.supportsSkip,
            signal: controller?.signal || null
          }),
          getSearchCatalogTimeoutMs(),
          { status: "error", message: "timeout" },
          () => controller?.abort()
        );
        return { catalog, result };
      } catch (err) {
        console.warn(`fail on search catalog ${catalog.catalogName}:`, err);
        return {
          catalog,
          result: { status: "error", message: "fetch_failed" }
        };
      }
    };

    const buildRows = () =>
      responses
        .filter(({ result } = {}) => result?.status === "success" && result?.data?.items?.length)
        .map(({ catalog, result }) => {
          const items = result?.data?.items || [];
          return {
            title: formatCatalogRowTitle(
              catalog.catalogName,
              catalog.addonName,
              catalog.type,
              this.layoutPrefs?.catalogTypeSuffixEnabled !== false
            ),
            subtitle:
              this.layoutPrefs?.catalogAddonNameEnabled !== false
                ? `from ${catalog.addonName || "Addon"}`
                : "",
            type: catalog.type,
            addonBaseUrl: catalog.addonBaseUrl,
            addonId: catalog.addonId,
            addonName: catalog.addonName,
            catalogId: catalog.catalogId,
            catalogName: catalog.catalogName,
            hasMore: Boolean(items.length > itemLimit || result?.data?.hasMore),
            items: items.slice(0, itemLimit)
          };
        });

    const publishFirstResults = () => {
      if (
        publishedFirstResults ||
        token !== this.loadToken ||
        typeof onFirstResults !== "function"
      ) {
        return;
      }
      const rows = buildRows();
      if (!rows.length) return;
      publishedFirstResults = true;
      onFirstResults(rows);
    };

    const runWorker = async () => {
      while (token === this.loadToken) {
        const index = scheduleIndices[nextScheduleIndex];
        nextScheduleIndex += 1;
        if (typeof index !== "number") return;
        responses[index] = await runCatalogSearch(searchableCatalogs[index]);
        publishFirstResults();
      }
    };
    const workerCount = Math.min(
      batchSize > 0 ? batchSize : searchableCatalogs.length,
      searchableCatalogs.length
    );
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return buildRows();
  },

  renderRows() {
    if (!Array.isArray(this.rows) || !this.rows.length) {
      if (this.mode === "search") {
        return `
          <div class="search-empty-state search-empty-state-results">
            <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
            <h2>${escapeHtml(t("search_no_results_title", {}, "No Results"))}</h2>
            <p>${escapeHtml(t("search_no_results_subtitle", {}, "Try searching with different keywords"))}</p>
          </div>
        `;
      }
      return `
        <div class="search-empty-state">
          <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
          <h2>${escapeHtml(t("search_start_title", {}, "Start Searching"))}</h2>
          <p>${escapeHtml(
            this.layoutPrefs?.discoverLocation === "in_search"
              ? t("search_start_subtitle", {}, "Enter at least 2 characters")
              : t(
                  "search_start_subtitle_no_discover",
                  {},
                  "Discover is disabled. Enter at least 2 characters"
                )
          )}</p>
        </div>
      `;
    }

    return this.rows
      .map((row, rowIndex) => {
        const rowKey = row.stateKey || buildRowStateKey(row, rowIndex);
        const seeAllLabel = t("action_see_all", {}, "See All");
        return `
      <section class="search-results-row" data-row-key="${escapeHtml(rowKey)}">
        <h3 class="search-results-title">${row.title}</h3>
        ${row.subtitle ? `<div class="search-results-subtitle">${row.subtitle}</div>` : ""}
        <div class="search-results-track">
          ${(row.items || [])
            .map(
              (item) => `
            <article class="search-result-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.id || ""}"
                     data-item-type="${item.type || row.type || "movie"}"
                     data-item-title="${item.name || "Untitled"}"
                     data-poster-src="${escapeHtml(item.poster || "")}"
                     data-backdrop-src="${escapeHtml(item.background || item.backdrop || item.landscapePoster || "")}"
                     data-addon-base-url="${escapeHtml(row.addonBaseUrl || item.addonBaseUrl || "")}"
                     data-addon-id="${escapeHtml(row.addonId || item.addonId || "")}"
                     data-addon-name="${escapeHtml(row.addonName || item.addonName || "")}"
                     data-catalog-type="${escapeHtml(row.type || item.catalogType || "")}"
                     data-row-key="${escapeHtml(rowKey)}">
              <div class="search-result-poster-wrap">
                ${item.poster ? `<img class="search-result-poster" src="${item.poster}" alt="${item.name || "content"}" loading="lazy" decoding="async" />` : `<div class="search-result-poster placeholder"></div>`}
                ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
              </div>
              <div class="search-result-name">${item.name || "Untitled"}</div>
              <div class="search-result-date">${formatReleaseYear(item)}</div>
            </article>
          `
            )
            .join("")}
          ${
            row.hasMore || (row.items || []).length >= 15
              ? `
            <article class="search-result-card search-seeall-card focusable"
                     data-action="openCatalogSeeAll"
                     data-addon-base-url="${row.addonBaseUrl || ""}"
                     data-addon-id="${row.addonId || ""}"
                     data-addon-name="${row.addonName || ""}"
                     data-catalog-id="${row.catalogId || ""}"
                     data-catalog-name="${row.catalogName || ""}"
                     data-catalog-type="${row.type || "movie"}"
                     data-row-index="${rowIndex}"
                     data-row-key="${escapeHtml(rowKey)}">
              <div class="search-seeall-inner">
                <div class="search-seeall-arrow" aria-hidden="true">&#8594;</div>
                <div class="search-seeall-label">${escapeHtml(seeAllLabel)}</div>
              </div>
            </article>
          `
              : ""
          }
        </div>
      </section>
    `;
      })
      .join("");
  },

  render() {
    this.cancelScheduledRender();
    const queryText = this.query || "";
    this.container.innerHTML = `
      <div class="home-shell search-screen-shell${this.searchRouteEnterPending ? " search-route-enter" : ""}">
        ${renderRootSidebar({
          selectedRoute: "search",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main search-content">
          <section class="search-header${this.layoutPrefs?.discoverLocation === "in_search" ? "" : " no-discover"}${this.voiceSearchSupported ? "" : " no-voice"}">
            ${
              this.layoutPrefs?.discoverLocation === "in_search"
                ? `
              <button class="search-discover-btn focusable" data-action="openDiscover">
                <span class="search-action-icon material-icons" aria-hidden="true">explore</span>
              </button>
            `
                : ""
            }
            ${
              this.voiceSearchSupported
                ? `<button
              class="search-voice-btn focusable${this.voiceSearchActive ? " listening" : ""}"
              data-action="openVoice"
              aria-label="Voice search"
            >
              <span class="search-action-icon material-icons" aria-hidden="true">mic</span>
            </button>`
                : ""
            }
            <input
              id="searchInput"
              class="search-input-field focusable"
              type="text"
              data-action="searchInput"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="${escapeHtml(t("search_placeholder", {}, "Search movies & series"))}"
              value="${escapeHtml(queryText)}"
            />
          </section>
          ${this.renderRows()}
        </main>
      </div>
    `;
    this.searchRouteEnterPending = false;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    bindRootSidebarEvents(this.container, {
      currentRoute: "search",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
    this.bindSearchInputEvents();
    this.bindActionEvents();
    const input = this.container.querySelector("#searchInput");
    input?.blur?.();
    this.restoreScrollState();
    const shouldFocusResults = Boolean(
      this.pendingAutoFocusResults && this.navModel?.rows?.[0]?.[0]
    );
    if (this.focusZone === "sidebar") {
      this.focusSidebarNode();
    } else {
      this.restoreContentFocus(shouldFocusResults);
    }
    this.pendingAutoFocusResults = false;
  },

  isPosterHoldTarget(node) {
    return (
      node instanceof HTMLElement &&
      node.classList.contains("search-result-card") &&
      String(node.dataset.action || "") === "openDetail"
    );
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
  },

  startPendingPosterHold(node) {
    this.cancelPendingPosterHold();
    if (!this.isPosterHoldTarget(node)) {
      return;
    }
    this.pendingPosterHoldTarget = node;
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const target = this.pendingPosterHoldTarget;
      this.pendingPosterHoldTarget = null;
      if (target?.isConnected && target.classList.contains("focused")) {
        void this.openPosterOptionsMenu(target);
      }
    }, POSTER_HOLD_DELAY_MS);
  },

  completePendingPosterHold(node, event = null) {
    if (!this.pendingPosterHoldTarget) {
      return false;
    }
    const target = this.pendingPosterHoldTarget;
    const hadTimer = Boolean(this.pendingPosterHoldTimer);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    this.cancelPendingPosterHold();
    if (hadTimer && target === node) {
      if (heldLongEnough) {
        void this.openPosterOptionsMenu(target);
      } else {
        this.openDetailFromNode(target);
      }
    }
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node);
    if (!item?.id) {
      return false;
    }
    this.captureLiveViewState();
    this.pendingPosterOptionsFocusId = String(item.id || "");
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          this.openDetailFromNode({
            dataset: {
              itemId: target.id,
              itemType: target.type || "movie",
              itemTitle: target.title || "Untitled",
              posterSrc: target.poster || "",
              backdropSrc: target.background || "",
              addonBaseUrl: target.addonBaseUrl || "",
              addonId: target.addonId || "",
              addonName: target.addonName || "",
              catalogType: target.catalogType || target.type || "movie"
            }
          });
        },
        onDismiss: () => {
          const itemId = this.pendingPosterOptionsFocusId;
          this.pendingPosterOptionsFocusId = "";
          const target = itemId
            ? this.container?.querySelector(
                `.search-result-card.focusable[data-item-id="${escapeSelectorValue(itemId)}"]`
              )
            : null;
          if (target) {
            this.focusNode(this.container?.querySelector(".focusable.focused"), target);
          }
        },
        onChanged: () => {
          void this.refreshWatchedTitleIds().then(() => this.render());
        }
      });
    }
    this.suppressHoldMenuEnterUntilKeyUp = true;
    return this.posterOptionsController.open(item);
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    return true;
  },

  buildNavigationModel() {
    const header = [
      this.container?.querySelector(".search-discover-btn.focusable"),
      this.container?.querySelector(".search-voice-btn.focusable"),
      this.container?.querySelector("#searchInput.focusable")
    ].filter(Boolean);
    const rows = Array.from(
      this.container?.querySelectorAll(".search-results-row .search-results-track") || []
    )
      .map((track) => Array.from(track.querySelectorAll(".search-result-card.focusable")))
      .filter((row) => row.length > 0);

    header.forEach((node, index) => {
      node.dataset.navZone = "header";
      node.dataset.navCol = String(index);
    });

    rows.forEach((rowNodes, rowIndex) => {
      const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navZone = "results";
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
        if (rowKey) {
          node.dataset.rowKey = rowKey;
        }
      });
    });

    this.navModel = { header, rows };
    if (!this.lastContentFocus) {
      const fallback = this.getDefaultHeaderFocusTarget() || rows[0]?.[0] || null;
      if (fallback) {
        this.rememberContentFocus(fallback);
      }
    }
  },

  getDefaultHeaderFocusTarget() {
    return (
      this.container?.querySelector("#searchInput.focusable") ||
      this.container?.querySelector(".search-discover-btn.focusable") ||
      this.container?.querySelector(".search-voice-btn.focusable") ||
      null
    );
  },

  restoreScrollState() {
    const content = this.container?.querySelector(".search-content");
    if (content) {
      content.scrollTop = Number(this.contentScrollTop || 0);
    }
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "");
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        track.scrollLeft = Number(this.rowScrollLeftByKey?.[rowKey] || 0);
      }
    });
  },

  rememberContentFocus(node) {
    if (!node) {
      return;
    }
    const rowKey = String(node.dataset.rowKey || "");
    if (String(node.dataset.navZone || "") === "results" && rowKey) {
      this.rowFocusedIndexByKey = {
        ...(this.rowFocusedIndexByKey || {}),
        [rowKey]: Math.max(0, Number(node.dataset.navCol || 0))
      };
    }
    this.lastContentFocus = {
      zone: String(node.dataset.navZone || ""),
      row: Number(node.dataset.navRow || 0),
      col: Number(node.dataset.navCol || 0),
      action: String(node.dataset.action || ""),
      rowKey
    };
  },

  resolvePreferredResultsNode(rowNodes = [], fallbackCol = 0) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
    const storedIndex = rowKey ? Number(this.rowFocusedIndexByKey?.[rowKey]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusSidebarNode(preferredNode = null) {
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const target =
      preferredNode ||
      getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
      nodes[0] ||
      null;
    if (!target) {
      return false;
    }
    this.sidebarFocusIndex = Math.max(0, nodes.indexOf(target));
    this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
    return true;
  },

  async openSidebar() {
    this.captureLiveViewState();
    const selected = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    return this.focusSidebarNode(selected || nodes[0] || null);
  },

  async closeSidebarToContent() {
    this.captureLiveViewState();
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
    return this.restoreContentFocus(false) || true;
  },

  restoreContentFocus(preferResults = false) {
    let target = null;
    if (preferResults) {
      target =
        this.container?.querySelector(".search-results-row .search-result-card.focusable") || null;
    }
    if (!target && !preferResults && this.mode !== "search") {
      target = this.getDefaultHeaderFocusTarget();
    }
    if (
      !target &&
      this.restoredFocusedDescriptor?.rowKey &&
      this.restoredFocusedDescriptor?.itemId
    ) {
      target =
        this.container?.querySelector(
          `.search-result-card.focusable[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"][data-item-id="${escapeSelectorValue(this.restoredFocusedDescriptor.itemId)}"]`
        ) || null;
    }
    if (
      !target &&
      this.restoredFocusedDescriptor?.rowKey &&
      this.restoredFocusedDescriptor?.action === "openCatalogSeeAll"
    ) {
      target =
        this.container?.querySelector(
          `.search-result-card.focusable.search-seeall-card[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"]`
        ) || null;
    }
    if (!target && this.lastContentFocus) {
      if (this.lastContentFocus.zone === "results") {
        if (this.lastContentFocus.rowKey) {
          const rowNodes = Array.from(
            this.container?.querySelectorAll(
              `.search-result-card.focusable[data-row-key="${escapeSelectorValue(this.lastContentFocus.rowKey)}"]`
            ) || []
          );
          target = this.resolvePreferredResultsNode(rowNodes, this.lastContentFocus.col);
        }
        if (!target) {
          target =
            this.container?.querySelector(
              `.search-result-card.focusable[data-nav-row="${this.lastContentFocus.row}"][data-nav-col="${this.lastContentFocus.col}"]`
            ) || null;
        }
      } else if (this.lastContentFocus.zone === "header") {
        target =
          this.container?.querySelector(
            `.focusable[data-nav-zone="header"][data-nav-col="${this.lastContentFocus.col}"]`
          ) || null;
      }
    }
    if (!target) {
      target =
        this.getDefaultHeaderFocusTarget() ||
        this.container?.querySelector(".search-result-card.focusable") ||
        null;
    }
    if (!target) {
      return false;
    }
    this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
    this.restoredFocusedDescriptor = null;
    return true;
  },

  focusNode(current, target) {
    if (!target) return false;
    if (current && current !== target) {
      current.classList.remove("focused");
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    const zone = String(target.dataset.navZone || "");
    const currentZone = String(current?.dataset?.navZone || "");
    const sidebarFocused = isRootSidebarNode(target);
    this.focusZone = sidebarFocused ? "sidebar" : "content";
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, sidebarFocused);
    }
    if (!sidebarFocused) {
      this.rememberContentFocus(target);
    }
    if (zone === "header" && currentZone === "results") {
      this.ensureHeaderVisible();
    }
    if (zone === "results") {
      this.ensureResultsRowVisible(target);
      this.ensureResultCardVisible(current, target);
    }
    this.captureLiveViewState();
    return true;
  },

  cancelScrollAnimation(container, axis = "x") {
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const state = map.get(container);
    const key = axis === "y" ? "y" : "x";
    if (state?.[key]) {
      cancelAnimationFrame(state[key]);
      state[key] = null;
    }
    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const springState = springMap.get(container);
    if (springState?.[key]?.raf) {
      cancelAnimationFrame(springState[key].raf);
      springState[key] = null;
      springMap.set(container, springState);
    }
  },

  animateScroll(container, axis, targetValue, duration = 150, options = {}) {
    if (!container) {
      return;
    }
    if (options?.mode === "spring") {
      this.animateSpringScroll(container, axis, targetValue, options?.spring || {});
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max =
      axis === "y"
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const startValue = Number(container[property] || 0);
    if (Math.abs(startValue - nextValue) <= 1) {
      container[property] = nextValue;
      return;
    }

    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const key = axis === "y" ? "y" : "x";
    const existing = map.get(container) || {};
    if (existing[key]) {
      cancelAnimationFrame(existing[key]);
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      container[property] = Math.round(
        startValue + (nextValue - startValue) * easeOutCubic(progress)
      );
      if (progress < 1) {
        existing[key] = requestAnimationFrame(tick);
        map.set(container, existing);
      } else {
        existing[key] = null;
        map.set(container, existing);
      }
    };

    existing[key] = requestAnimationFrame(tick);
    map.set(container, existing);
  },

  animateSpringScroll(container, axis, targetValue, options = {}) {
    if (!container) {
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max =
      axis === "y"
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const tweenState = tweenMap.get(container);
    const key = axis === "y" ? "y" : "x";
    if (tweenState?.[key]) {
      cancelAnimationFrame(tweenState[key]);
      tweenState[key] = null;
      tweenMap.set(container, tweenState);
    }

    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const existing = springMap.get(container) || {};
    const active = existing[key];
    if (active) {
      active.target = nextValue;
      active.stiffness = Number(
        options?.stiffness ?? active.stiffness ?? MODERN_HOME_CONSTANTS.springScrollStiffness
      );
      active.dampingRatio = Number(
        options?.dampingRatio ??
          active.dampingRatio ??
          MODERN_HOME_CONSTANTS.springScrollDampingRatio
      );
      active.precision = Number(options?.precision ?? active.precision ?? 0.5);
      active.velocityEpsilon = Number(options?.velocityEpsilon ?? active.velocityEpsilon ?? 0.5);
      active.damping = 2 * active.dampingRatio * Math.sqrt(active.stiffness);
      springMap.set(container, existing);
      return;
    }

    const stiffness = Number(options?.stiffness ?? MODERN_HOME_CONSTANTS.springScrollStiffness);
    const dampingRatio = Number(
      options?.dampingRatio ?? MODERN_HOME_CONSTANTS.springScrollDampingRatio
    );
    const state = {
      target: nextValue,
      position: Number(container[property] || 0),
      velocity: 0,
      raf: null,
      lastTime: performance.now(),
      stiffness,
      dampingRatio,
      damping: 2 * dampingRatio * Math.sqrt(stiffness),
      precision: Number(options?.precision ?? 0.5),
      velocityEpsilon: Number(options?.velocityEpsilon ?? 0.5)
    };

    const tick = (now) => {
      const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - state.lastTime) / 1000));
      state.lastTime = now;
      const displacement = state.position - Number(state.target || 0);
      const acceleration = -state.stiffness * displacement - state.damping * state.velocity;
      state.velocity += acceleration * deltaSeconds;
      state.position += state.velocity * deltaSeconds;
      container[property] = state.position;

      const remaining = Number(state.target || 0) - Number(container[property] || 0);
      if (
        Math.abs(remaining) <= state.precision &&
        Math.abs(state.velocity) <= state.velocityEpsilon
      ) {
        container[property] = state.target;
        existing[key] = null;
        springMap.set(container, existing);
        return;
      }

      state.raf = requestAnimationFrame(tick);
      existing[key] = state;
      springMap.set(container, existing);
    };

    state.raf = requestAnimationFrame(tick);
    existing[key] = state;
    springMap.set(container, existing);
  },

  ensureResultsRowVisible(target) {
    const content = this.container?.querySelector(".search-content");
    const row = target?.closest?.(".search-results-row");
    if (!content || !row) {
      return;
    }

    const contentRect = content.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const topInset = 18;
    const bottomInset = 28;
    const rowTop = rowRect.top - contentRect.top + content.scrollTop;
    const rowBottom = rowRect.bottom - contentRect.top + content.scrollTop;
    const visibleTop = contentRect.top + topInset;
    const visibleBottom = contentRect.bottom - bottomInset;

    if (rowRect.top < visibleTop) {
      this.animateScroll(
        content,
        "y",
        rowTop - topInset,
        MODERN_HOME_CONSTANTS.cameraFollowDurationYMs,
        { mode: "spring" }
      );
      return;
    }

    if (rowRect.bottom > visibleBottom) {
      this.animateScroll(
        content,
        "y",
        rowBottom - content.clientHeight + bottomInset,
        MODERN_HOME_CONSTANTS.cameraFollowDurationYMs,
        { mode: "spring" }
      );
    }
  },

  ensureResultCardVisible(current, target) {
    const track = target?.closest?.(".search-results-track");
    if (!track || !target) {
      return;
    }

    const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
    const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
    const trackRect = track.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetLeft = targetRect.left - trackRect.left + Number(track.scrollLeft || 0);
    const maxScrollLeft = Math.max(
      0,
      Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
    );
    this.animateScroll(
      track,
      "x",
      Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad)),
      MODERN_HOME_CONSTANTS.cameraFollowDurationXMs,
      { mode: "spring" }
    );
  },

  ensureHeaderVisible() {
    const content = this.container?.querySelector(".search-content");
    const header = this.container?.querySelector(".search-header");
    if (!content || !header) return;

    const contentRect = content.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const topInset = 22;
    const visibleTop = contentRect.top + topInset;

    if (headerRect.top < visibleTop) {
      this.animateScroll(
        content,
        "y",
        content.scrollTop + (headerRect.top - visibleTop),
        MODERN_HOME_CONSTANTS.cameraFollowDurationYMs,
        { mode: "spring" }
      );
    }
  },

  handleSearchDpad(event) {
    const keyCode = Number(event?.keyCode || 0);
    const direction =
      keyCode === 38
        ? "up"
        : keyCode === 40
          ? "down"
          : keyCode === 37
            ? "left"
            : keyCode === 39
              ? "right"
              : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel || {};
    const current = this.container?.querySelector(".focusable.focused") || null;
    if (!current) {
      return false;
    }
    const zone = String(current.dataset.navZone || "");

    event?.preventDefault?.();

    if (zone === "header") {
      const col = Number(current.dataset.navCol || 0);
      if (direction === "left") {
        if (col > 0) return this.focusNode(current, nav.header?.[col - 1] || current) || true;
        return "sidebar";
      }
      if (direction === "right") {
        if (col < (nav.header?.length || 0) - 1) {
          return this.focusNode(current, nav.header?.[col + 1] || current) || true;
        }
        return true;
      }
      if (direction === "down") {
        const firstRow = nav.rows?.[0] || [];
        const target = this.resolvePreferredResultsNode(firstRow, col);
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        return true;
      }
      return true;
    }

    if (zone === "results") {
      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows?.[row] || [];

      if (direction === "left") {
        if (col > 0) {
          return this.focusNode(current, rowNodes[col - 1] || current) || true;
        }
        return "sidebar";
      }
      if (direction === "right") {
        const target = rowNodes[col + 1] || null;
        return this.focusNode(current, target || current) || true;
      }
      if (direction === "down") {
        const nextRowNodes = nav.rows?.[row + 1] || null;
        if (!nextRowNodes) {
          return true;
        }
        const target = this.resolvePreferredResultsNode(nextRowNodes, col);
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        const prevRowNodes = nav.rows?.[row - 1] || null;
        if (prevRowNodes) {
          const target = this.resolvePreferredResultsNode(prevRowNodes, col);
          return this.focusNode(current, target) || true;
        }
        const target =
          nav.header?.[Math.min(col, (nav.header?.length || 1) - 1)] || nav.header?.[0] || null;
        return this.focusNode(current, target) || true;
      }
      return true;
    }

    return false;
  },

  async runSearchFromInput(input, { autoFocusResults = false } = {}) {
    const nextQuery = trimLeadingWhitespace(input?.value || "").trim();
    this.query = nextQuery;
    const nextMode = nextQuery.length >= 2 ? "search" : "idle";
    if (nextMode === "idle" && this.mode === "idle" && !(this.rows || []).length) {
      this.lastSubmittedQuery = nextQuery;
      this.captureLiveViewState();
      return;
    }
    if (this.mode === nextMode && this.lastSubmittedQuery === nextQuery) {
      return;
    }
    this.mode = nextMode;
    this.pendingAutoFocusResults = Boolean(autoFocusResults && nextMode === "search");
    this.lastSubmittedQuery = nextQuery;
    this.loadToken = (this.loadToken || 0) + 1;
    this.captureLiveViewState();
    await this.reloadRows();
  },

  scheduleSearchFromInput(input) {
    this.cancelScheduledInputSearch();
    const nextQuery = trimLeadingWhitespace(input?.value || "");
    const selectionSnapshot = getInputSelectionSnapshot(input);
    if (input && input.value !== nextQuery) {
      const removedLeadingChars = String(input.value || "").length - nextQuery.length;
      input.value = nextQuery;
      if (selectionSnapshot) {
        restoreInputSelection(input, {
          ...selectionSnapshot,
          start: Math.max(0, Number(selectionSnapshot.start || 0) - removedLeadingChars),
          end: Math.max(0, Number(selectionSnapshot.end || 0) - removedLeadingChars)
        });
      }
    }
    this.query = nextQuery.trim();
    const delay = this.query.length >= 2 ? 320 : 120;
    this.inputSearchTimer = setTimeout(() => {
      this.inputSearchTimer = null;
      void this.runSearchFromInput(input, { autoFocusResults: false });
    }, delay);
  },

  bindSearchInputEvents() {
    const input = this.container?.querySelector("#searchInput");
    if (!input || input.__boundSearchListeners) return;
    input.__boundSearchListeners = true;

    input.addEventListener("input", (event) => {
      this.query = trimLeadingWhitespace(event.target?.value || "");
      this.scheduleSearchFromInput(input);
    });

    input.addEventListener("focus", () => {
      const current = this.container?.querySelector(".focusable.focused") || null;
      if (current !== input) {
        this.focusNode(current, input);
      }
      const valueLength = String(input.value || "").length;
      try {
        input.setSelectionRange(valueLength, valueLength);
      } catch (_) {}
    });

    input.addEventListener("keydown", async (event) => {
      if (event.keyCode !== 13) return;
      event.preventDefault();
      this.cancelScheduledInputSearch();
      await this.runSearchFromInput(input, { autoFocusResults: true });
    });
  },

  isSearchInputEditingActive(event = null) {
    const input = this.container?.querySelector("#searchInput");
    if (!input) {
      return false;
    }
    const eventTarget = event?.target || null;
    return (
      document.activeElement === input ||
      eventTarget === input ||
      Boolean(eventTarget?.closest?.("#searchInput")) ||
      input.classList.contains("focused") ||
      this.container?.querySelector(".focusable.focused") === input
    );
  },

  keepSearchInputEditingKey(event, code) {
    const input = this.container?.querySelector("#searchInput");
    const navigationKeys = [35, 36, 37, 39];
    if (!input || navigationKeys.indexOf(code) === -1 || !this.isSearchInputEditingActive(event)) {
      return false;
    }

    // Release left/right once the caret sits at the matching edge of the value
    // (always true for an empty input) so dpad navigation can move focus out
    // of the input, e.g. to the discover/mic buttons.
    const valueLength = String(input.value || "").length;
    const selectionSnapshot = getInputSelectionSnapshot(input);
    const caretStart = selectionSnapshot
      ? clamp(Number(selectionSnapshot.start || 0), 0, valueLength)
      : valueLength;
    const caretEnd = selectionSnapshot
      ? clamp(Number(selectionSnapshot.end || 0), 0, valueLength)
      : valueLength;
    const hasSelection = caretStart !== caretEnd;
    if (code === 37 && !hasSelection && caretStart <= 0) {
      return false;
    }
    if (code === 39 && !hasSelection && caretEnd >= valueLength) {
      return false;
    }

    if (document.activeElement !== input) {
      const selectionSnapshot = getInputSelectionSnapshot(input);
      input.focus?.();
      if (selectionSnapshot && (code === 37 || code === 39)) {
        const delta = code === 37 ? -1 : 1;
        const nextPosition = clamp(
          Number(selectionSnapshot.end || selectionSnapshot.start || 0) + delta,
          0,
          String(input.value || "").length
        );
        restoreInputSelection(input, {
          ...selectionSnapshot,
          start: nextPosition,
          end: nextPosition
        });
      } else if (selectionSnapshot) {
        restoreInputSelection(input, selectionSnapshot);
      }
      event?.preventDefault?.();
    }
    event?.stopPropagation?.();
    return true;
  },

  bindActionEvents() {
    this.container?.querySelectorAll("[data-action]").forEach((node) => {
      if (node.__boundActionListeners) return;
      node.__boundActionListeners = true;
      if (node.dataset.action === "searchInput") return;
      node.addEventListener("click", () => {
        this.activateActionNode(node);
      });
    });
  },

  activateActionNode(node) {
    if (!node) return;
    if (Date.now() < Number(this.activationGuardUntil || 0)) return;
    const action = String(node.dataset.action || "");
    if (!action) return;

    if (action === "openDetail") this.openDetailFromNode(node);
    if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(node);
    if (action === "openDiscover" && this.layoutPrefs?.discoverLocation === "in_search")
      Router.navigate("discover");
    if (action === "openVoice") this.handleVoiceSearch();
  },

  ensureVoiceRecognition() {
    if (this.voiceRecognition || !this.voiceSearchSupported) {
      return this.voiceRecognition;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognition !== "function") {
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = async (event) => {
      const recognized = String(event.results?.[0]?.[0]?.transcript || "").trim();
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      if (!recognized) {
        this.showSearchToast("No speech detected. Try again.");
        return;
      }
      this.query = recognized;
      this.mode = this.query.length >= 2 ? "search" : "idle";
      this.pendingAutoFocusResults = this.mode === "search";
      this.loadToken = (this.loadToken || 0) + 1;
      this.renderLoading();
      await this.reloadRows();
    };

    recognition.onerror = (event) => {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      const errorCode = String(event?.error || "");
      if (errorCode === "aborted") return;
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        this.showSearchToast("Microphone permission is required for voice search.");
        return;
      }
      if (errorCode === "no-speech") {
        this.showSearchToast("No speech detected. Try again.");
        return;
      }
      this.showSearchToast("Voice recognition failed. Try again.");
    };

    recognition.onend = () => {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
    };

    this.voiceRecognition = recognition;
    return recognition;
  },

  handleVoiceSearch() {
    const recognition = this.ensureVoiceRecognition();
    if (!recognition) {
      this.showSearchToast("Voice search is unavailable on this device.");
      return;
    }

    try {
      if (this.voiceSearchActive) {
        recognition.stop();
        return;
      }
      this.voiceSearchActive = true;
      this.syncVoiceButtonState();
      recognition.start();
    } catch (_) {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      this.showSearchToast("Voice search is unavailable on this device.");
    }
  },

  syncVoiceButtonState() {
    const button = this.container?.querySelector(".search-voice-btn");
    if (!button) return;
    button.classList.toggle("listening", Boolean(this.voiceSearchActive));
  },

  showSearchToast(message) {
    if (!this.container) return;
    const shell = this.container.querySelector(".search-screen-shell");
    if (!shell) return;
    let toast = shell.querySelector(".search-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "search-toast";
      shell.appendChild(toast);
    }
    toast.textContent = String(message || "").trim();
    toast.classList.add("visible");

    if (this.searchToastTimer) {
      clearTimeout(this.searchToastTimer);
    }
    this.searchToastTimer = setTimeout(() => {
      toast?.classList.remove("visible");
    }, 2600);
  },

  openDetailFromNode(node) {
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || node.dataset.catalogType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled",
      fallbackPoster: node.dataset.posterSrc || "",
      fallbackBackground: node.dataset.backdropSrc || "",
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogType: node.dataset.catalogType || node.dataset.itemType || "movie",
      returnToSearchOnBack: true
    });
  },

  openCatalogSeeAllFromNode(node) {
    const rowIndex = Math.max(0, Number(node?.dataset?.rowIndex || 0));
    const sourceRow = this.rows?.[rowIndex] || null;
    Router.navigate("catalogSeeAll", {
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogId: node.dataset.catalogId || "",
      catalogName: node.dataset.catalogName || "",
      type: node.dataset.catalogType || "movie",
      initialItems: Array.isArray(sourceRow?.items) ? sourceRow.items : []
    });
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
      event.preventDefault?.();
      return;
    }
    const currentFocusedNode = this.container?.querySelector(".focusable.focused") || null;
    const isPosterHoldTarget = this.isPosterHoldTarget(currentFocusedNode);
    if (!isPosterHoldTarget || code !== 13) {
      this.cancelPendingPosterHold();
    }

    if (Platform.isBackEvent(event)) {
      event.preventDefault?.();
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    if (this.keepSearchInputEditingKey(event, code)) {
      return;
    }
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === 40) {
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === 38) {
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
      }
    }

    if (this.focusZone === "sidebar") {
      const current = this.container?.querySelector(".focusable.focused") || null;
      const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      if (code === 38 || code === 40 || code === 39) {
        event.preventDefault?.();
      }
      if (code === 38 || code === 40) {
        const focusedIndex = Math.max(0, nodes.indexOf(current));
        const nextIndex = clamp(
          focusedIndex + (code === 38 ? -1 : 1),
          0,
          Math.max(0, nodes.length - 1)
        );
        const nextNode = nodes[nextIndex] || current;
        if (nextNode) {
          this.sidebarFocusIndex = nextIndex;
          this.focusNode(current, nextNode);
        }
        return;
      }
      if (code === 39) {
        await this.closeSidebarToContent();
        return;
      }
      if (code === 13 && current && isRootSidebarNode(current)) {
        event.preventDefault?.();
        activateLegacySidebarAction(String(current.dataset.action || ""), "search");
        if (isSelectedSidebarAction(String(current.dataset.action || ""), "search")) {
          await this.closeSidebarToContent();
        }
        return;
      }
    }

    if (code === 13 && isPosterHoldTarget) {
      event.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(currentFocusedNode)) {
        this.startPendingPosterHold(currentFocusedNode);
      }
      return;
    }

    const dpadResult = this.handleSearchDpad(event);
    if (dpadResult === "sidebar") {
      await this.openSidebar();
      return;
    }
    if (dpadResult) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (code !== 13) return;
    const current = this.container.querySelector(".focusable.focused");
    if (!current) return;

    const action = String(current.dataset.action || "");
    if (
      action === "openDiscover" ||
      action === "openVoice" ||
      action === "openDetail" ||
      action === "openCatalogSeeAll"
    ) {
      this.activateActionNode(current);
    }
    if (action === "searchInput") {
      const input = this.container?.querySelector("#searchInput");
      if (input) {
        input.focus();
      }
    }
  },

  onKeyUp(event) {
    if (this.suppressHoldMenuEnterUntilKeyUp) {
      this.suppressHoldMenuEnterUntilKeyUp = false;
      if (Number(event?.keyCode || 0) === 13) {
        event?.preventDefault?.();
        return;
      }
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".search-result-card.focusable.focused") || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  consumeBackRequest() {
    return this.closePosterOptionsMenu();
  },

  cleanup() {
    this.cancelScheduledRender();
    this.cancelPendingPosterHold();
    this.posterOptionsMenu = null;
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.pendingPosterOptionsFocusId = "";
    this.suppressHoldMenuEnterUntilKeyUp = false;
    if (this.searchToastTimer) {
      clearTimeout(this.searchToastTimer);
      this.searchToastTimer = null;
    }
    this.cancelScheduledInputSearch();
    if (this.voiceRecognition) {
      try {
        this.voiceRecognition.onresult = null;
        this.voiceRecognition.onerror = null;
        this.voiceRecognition.onend = null;
        this.voiceRecognition.stop();
      } catch (_) {
        // Ignore stop failures from inactive recognizers.
      }
      this.voiceRecognition = null;
    }
    this.voiceSearchActive = false;
    ScreenUtils.hide(this.container);
  }
};
