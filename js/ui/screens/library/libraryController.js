import { MdbListLibrary } from "../../../data/repository/mdbListLibrary.js";
import { trackingErrorMessage } from "../../components/trackingErrorMessage.js";
import {
  LibraryListPrivacy,
  LibrarySortOptionKey,
  LibrarySourceMode,
  libraryRepository,
  libraryTypeLabel
} from "../../../data/repository/libraryRepository.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { I18n } from "../../../i18n/index.js";
import { buildWatchedTitleIdSet, isTitleItemWatched } from "../../components/watchedTitleBadge.js";
import {
  cloudLibraryRepository,
  cloudLibrarySettingsSignature
} from "../../../data/repository/cloudLibraryRepository.js";
import {
  CLOUD_LIBRARY_ITEM_TYPES,
  playableCloudFiles
} from "../../../core/cloud/cloudLibraryModels.js";
import { DebridSettingsStore } from "../../../data/local/debridSettingsStore.js";
import { LibraryPreferencesStore } from "../../../data/local/libraryPreferencesStore.js";

const ALL_KEY = "__all__";
const MESSAGE_CLEAR_MS = 2400;
const SYNC_LOADING_MIN_MS = 700;
const LEADING_ARTICLE_REGEX = /^(the|an|a)\s+/i;
export const LIBRARY_VIEW_MODE = { SAVED: "saved", CLOUD: "cloud", SERVERS: "servers" };
export const LIBRARY_WATCHED_FILTER = {
  ALL: "all",
  WATCHED: "watched",
  UNWATCHED: "unwatched"
};

export const LIBRARY_SORT_OPTIONS = [
  {
    key: LibrarySortOptionKey.DEFAULT,
    labelKey: "library_sort_trakt_order",
    fallback: "Trakt Order"
  },
  {
    key: LibrarySortOptionKey.ADDED_DESC,
    labelKey: "library_sort_added_desc",
    fallback: "Added ↓"
  },
  { key: LibrarySortOptionKey.ADDED_ASC, labelKey: "library_sort_added_asc", fallback: "Added ↑" },
  {
    key: LibrarySortOptionKey.TITLE_ASC,
    labelKey: "library_sort_title_asc",
    fallback: "Title A-Z"
  },
  {
    key: LibrarySortOptionKey.TITLE_DESC,
    labelKey: "library_sort_title_desc",
    fallback: "Title Z-A"
  }
];

export const LIBRARY_PRIVACY_OPTIONS = [
  LibraryListPrivacy.PRIVATE,
  LibraryListPrivacy.LINK,
  LibraryListPrivacy.FRIENDS,
  LibraryListPrivacy.PUBLIC
];

let persistedPosterFocusKey = null;
let persistedLibraryViewMode = LIBRARY_VIEW_MODE.SAVED;
// Android keeps LibraryViewModel alive on the back stack (Detail push, drawer
// saveState/restoreState), so filter and sort picks survive leaving the screen.
let persistedFilterSelections = null;

function activeProfileKey() {
  return String(ProfileManager.getActiveProfileId?.() ?? "");
}

function restoredFilterSelections() {
  const saved = persistedFilterSelections;
  if (!saved || saved.profileKey !== activeProfileKey()) {
    return {};
  }
  return {
    sourceMode: saved.sourceMode,
    selectedTypeKey: saved.selectedTypeKey,
    selectedGenre: saved.selectedGenre,
    selectedYear: saved.selectedYear,
    selectedWatchedFilter: saved.selectedWatchedFilter,
    selectedSortKey: saved.selectedSortKey
  };
}

function makeInitialState() {
  return {
    viewMode: persistedLibraryViewMode,
    sourceMode: LibrarySourceMode.LOCAL,
    allItems: [],
    visibleItems: [],
    listTabs: [],
    availableTypeTabs: [{ key: ALL_KEY, label: "All" }],
    availableGenres: [],
    availableYears: [],
    availableSortOptions: LIBRARY_SORT_OPTIONS.filter(
      (option) => option.key !== LibrarySortOptionKey.DEFAULT
    ),
    selectedListKey: null,
    selectedTypeKey: ALL_KEY,
    selectedGenre: null,
    selectedYear: null,
    selectedWatchedFilter: LIBRARY_WATCHED_FILTER.ALL,
    selectedSortKey: LibrarySortOptionKey.ADDED_DESC,
    expandedPicker: null,
    pickerFocusIndex: 0,
    isLoading: true,
    isSyncing: false,
    transientMessage: null,
    errorMessage: null,
    showManageDialog: false,
    manageSelectedListKey: null,
    listEditorState: null,
    showDeleteConfirm: false,
    pendingOperation: false,
    lastFocusedPosterKey: persistedPosterFocusKey,
    isNuvioAccount: false,
    isTraktAuthenticated: false,
    watchedTitleIds: new Set(),
    cloudLibrary: {
      isLoaded: false,
      isEnabled: true,
      isRefreshing: false,
      providers: [],
      items: []
    },
    ...restoredFilterSelections(),
    visibleCloudItems: [],
    availableCloudProviders: [],
    availableCloudTypes: [],
    selectedCloudProviderId: null,
    selectedCloudType: null,
    cloudSearchQuery: "",
    resolvingCloudFileKey: null,
    cloudFilePickerItem: null
  };
}

function cloudTypeLabel(type) {
  const labels = {
    [CLOUD_LIBRARY_ITEM_TYPES.TORRENT]: ["cloud_library_type_torrents", "Torrents"],
    [CLOUD_LIBRARY_ITEM_TYPES.USENET]: ["cloud_library_type_usenet", "Usenet"],
    [CLOUD_LIBRARY_ITEM_TYPES.WEB_DOWNLOAD]: ["cloud_library_type_web", "Web"],
    [CLOUD_LIBRARY_ITEM_TYPES.FILE]: ["cloud_library_type_files", "Files"]
  };
  const [key, fallback] = labels[type] || ["cloud_library_type_files", String(type || "")];
  return t(key, {}, fallback);
}

function withVisibleCloudItems(state) {
  const allItems = Array.isArray(state.cloudLibrary?.items) ? state.cloudLibrary.items : [];
  const providerItems = state.selectedCloudProviderId
    ? allItems.filter((item) => item.providerId === state.selectedCloudProviderId)
    : allItems;
  const typeItems = state.selectedCloudType
    ? providerItems.filter((item) => item.type === state.selectedCloudType)
    : providerItems;
  const query = String(state.cloudSearchQuery || "")
    .trim()
    .toLowerCase();
  const visibleCloudItems = query
    ? typeItems.filter(
        (item) =>
          String(item.name || "")
            .toLowerCase()
            .includes(query) ||
          (item.files || []).some((file) =>
            String(file.name || "")
              .toLowerCase()
              .includes(query)
          )
      )
    : typeItems;
  const providerMap = new Map();
  allItems.forEach((item) => {
    const current = providerMap.get(item.providerId) || {
      key: item.providerId,
      label: item.providerName,
      count: 0
    };
    current.count += 1;
    providerMap.set(item.providerId, current);
  });
  const typeMap = new Map();
  providerItems.forEach((item) => typeMap.set(item.type, (typeMap.get(item.type) || 0) + 1));
  const availableCloudProviders = [...providerMap.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
  const availableCloudTypes = Object.values(CLOUD_LIBRARY_ITEM_TYPES)
    .filter((type) => typeMap.has(type))
    .map((type) => ({ key: type, label: cloudTypeLabel(type), count: typeMap.get(type) }));
  return {
    ...state,
    visibleCloudItems,
    availableCloudProviders,
    availableCloudTypes,
    selectedCloudProviderId: availableCloudProviders.some(
      (option) => option.key === state.selectedCloudProviderId
    )
      ? state.selectedCloudProviderId
      : null,
    selectedCloudType: availableCloudTypes.some((option) => option.key === state.selectedCloudType)
      ? state.selectedCloudType
      : null
  };
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return delay(0);
  }
  return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

async function allowLoadingFrame() {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

function optionLabel(option = {}) {
  return option.labelKey
    ? t(option.labelKey, {}, option.fallback || option.key)
    : String(option.label || option.key || "");
}

function stripCountSuffix(value) {
  return String(value || "").replace(/\s+\(\d+\)$/, "");
}

function typeLabelForEmptyState(key) {
  if (!key || key === ALL_KEY) {
    return "all";
  }
  return libraryTypeLabel(key)
    .replace(/\s+\(\d+\)$/, "")
    .toLowerCase();
}

function itemTypeKey(item = {}) {
  return String(item.mediaCategory || item.type || "")
    .trim()
    .toLowerCase();
}

function normalizeTypeTabs(items) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = itemTypeKey(item);
    if (!key || byKey.has(key)) {
      return;
    }
    byKey.set(key, libraryTypeLabel(key));
  });
  return [
    { key: ALL_KEY, label: `${t("library_type_all", {}, "All")} (${items.length})` },
    ...Array.from(byKey.entries()).map(([key, label]) => ({
      key,
      label: `${label} (${items.filter((item) => itemTypeKey(item) === key).length})`
    }))
  ];
}

function extractYear(item = {}) {
  const value = String(item.releaseInfo || item.releaseDate || item.released || item.year || "");
  return value.match(/\b(19|20)\d{2}\b/)?.[0] || null;
}

function titleSortKey(value) {
  return String(value || "")
    .trim()
    .replace(LEADING_ARTICLE_REGEX, "")
    .toLowerCase();
}

function buildFilterOptions(items = [], field) {
  const counts = new Map();
  items.forEach((item) => {
    const values =
      field === "genre"
        ? Array.isArray(item.genres)
          ? item.genres
          : []
        : [extractYear(item)].filter(Boolean);
    values.forEach((value) => {
      const key = String(value || "").trim();
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  });
  return Array.from(counts.entries())
    .sort((left, right) =>
      field === "year"
        ? String(right[0]).localeCompare(String(left[0]))
        : String(left[0]).localeCompare(String(right[0]), undefined, { sensitivity: "base" })
    )
    .map(([key, count]) => ({ key, label: key, count }));
}

function itemMatchesGenre(item, genre) {
  if (!genre) {
    return true;
  }
  return (Array.isArray(item.genres) ? item.genres : []).some(
    (entry) => String(entry).toLowerCase() === String(genre).toLowerCase()
  );
}

function itemMatchesYear(item, year) {
  return !year || extractYear(item) === year;
}

function buildFacets(allItems, state) {
  const listFiltered =
    state.sourceMode !== LibrarySourceMode.LOCAL && state.selectedListKey
      ? allItems.filter(
          (item) => Array.isArray(item.listKeys) && item.listKeys.includes(state.selectedListKey)
        )
      : allItems;
  const selectedTypeKey = state.selectedTypeKey;
  const typeFiltered = listFiltered.filter((item) => {
    return selectedTypeKey === ALL_KEY || itemTypeKey(item) === selectedTypeKey;
  });
  const itemsForTypeCounts = listFiltered.filter(
    (item) =>
      itemMatchesGenre(item, state.selectedGenre) && itemMatchesYear(item, state.selectedYear)
  );
  const itemsForGenreCounts = state.selectedYear
    ? typeFiltered.filter((item) => itemMatchesYear(item, state.selectedYear))
    : typeFiltered;
  const itemsForYearCounts = state.selectedGenre
    ? typeFiltered.filter((item) => itemMatchesGenre(item, state.selectedGenre))
    : typeFiltered;
  return {
    availableTypeTabs: normalizeTypeTabs(itemsForTypeCounts),
    availableGenres: buildFilterOptions(itemsForGenreCounts, "genre"),
    availableYears: buildFilterOptions(itemsForYearCounts, "year")
  };
}

function sortForState(items, state) {
  const selectedTypeKey = state.selectedTypeKey;
  const typeFiltered = items.filter((item) => {
    return selectedTypeKey === ALL_KEY || itemTypeKey(item) === selectedTypeKey;
  });

  const listFiltered =
    state.sourceMode !== LibrarySourceMode.LOCAL && state.selectedListKey
      ? typeFiltered.filter(
          (item) => Array.isArray(item.listKeys) && item.listKeys.includes(state.selectedListKey)
        )
      : typeFiltered;

  const genreFiltered = state.selectedGenre
    ? listFiltered.filter((item) => itemMatchesGenre(item, state.selectedGenre))
    : listFiltered;

  const yearFiltered = state.selectedYear
    ? genreFiltered.filter((item) => itemMatchesYear(item, state.selectedYear))
    : genreFiltered;

  const watchedFiltered =
    state.selectedWatchedFilter === LIBRARY_WATCHED_FILTER.WATCHED
      ? yearFiltered.filter((item) => isTitleItemWatched(item, state.watchedTitleIds))
      : state.selectedWatchedFilter === LIBRARY_WATCHED_FILTER.UNWATCHED
        ? yearFiltered.filter((item) => !isTitleItemWatched(item, state.watchedTitleIds))
        : yearFiltered;

  const listMetaValue = (item, field) => {
    if (!state.selectedListKey) {
      return field === "listedAt" ? Number(item.listedAt || 0) : item.traktRank;
    }
    return (
      item.listMeta?.[state.selectedListKey]?.[field] ??
      (field === "listedAt" ? Number(item.listedAt || 0) : item.traktRank)
    );
  };

  const byNameAsc = (left, right) => {
    const nameResult = String(left.name || left.id).localeCompare(
      String(right.name || right.id),
      undefined,
      { sensitivity: "base" }
    );
    if (nameResult !== 0) {
      return nameResult;
    }
    return String(left.id).localeCompare(String(right.id), undefined, { sensitivity: "base" });
  };

  const byTitleSortAsc = (left, right) => {
    const nameResult = titleSortKey(left.name || left.id).localeCompare(
      titleSortKey(right.name || right.id),
      undefined,
      { sensitivity: "base" }
    );
    if (nameResult !== 0) {
      return nameResult;
    }
    return String(left.id).localeCompare(String(right.id), undefined, { sensitivity: "base" });
  };

  const providerOrder =
    state.sourceMode === LibrarySourceMode.MDBLIST &&
    state.providerSortOrder?.listKey === state.selectedListKey &&
    state.providerSortOrder?.sortKey === state.selectedSortKey
      ? new Map(state.providerSortOrder.keys.map((key, index) => [key, index]))
      : null;
  const sorted = [...watchedFiltered];
  sorted.sort((left, right) => {
    if (providerOrder) {
      const rank =
        (providerOrder.get(`${left.type}:${left.id}`) ?? Number.MAX_SAFE_INTEGER) -
        (providerOrder.get(`${right.type}:${right.id}`) ?? Number.MAX_SAFE_INTEGER);
      if (rank !== 0) return rank;
    }
    switch (state.selectedSortKey) {
      case LibrarySortOptionKey.DEFAULT: {
        const rankDiff =
          Number(listMetaValue(left, "traktRank") ?? Number.MAX_SAFE_INTEGER) -
          Number(listMetaValue(right, "traktRank") ?? Number.MAX_SAFE_INTEGER);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        const addedDiff =
          Number(listMetaValue(right, "listedAt") || 0) -
          Number(listMetaValue(left, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
      case LibrarySortOptionKey.ADDED_ASC: {
        const addedDiff =
          Number(listMetaValue(left, "listedAt") || 0) -
          Number(listMetaValue(right, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
      case "released_asc":
      case "released_desc": {
        const leftDate = Date.parse(left.releaseDate || left.releaseInfo || "") || 0;
        const rightDate = Date.parse(right.releaseDate || right.releaseInfo || "") || 0;
        const delta =
          state.selectedSortKey === "released_desc" ? rightDate - leftDate : leftDate - rightDate;
        return delta || byNameAsc(left, right);
      }
      case LibrarySortOptionKey.TITLE_ASC:
        return byTitleSortAsc(left, right);
      case LibrarySortOptionKey.TITLE_DESC:
        return byTitleSortAsc(right, left);
      case LibrarySortOptionKey.ADDED_DESC:
      default: {
        const addedDiff =
          Number(listMetaValue(right, "listedAt") || 0) -
          Number(listMetaValue(left, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
    }
  });
  return sorted;
}

function copyEditorState(state) {
  return state
    ? {
        mode: state.mode,
        listId: state.listId || null,
        name: state.name || "",
        description: state.description || "",
        privacy: state.privacy || LibraryListPrivacy.PRIVATE
      }
    : null;
}

export class LibraryController {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.state = makeInitialState();
    this.messageTimer = null;
    this.reloadToken = 0;
    this.disposed = false;
    this.cloudSettingsSignature = cloudLibrarySettingsSignature();
    this.unsubscribeDebridSettings = DebridSettingsStore.subscribe(() => {
      void this.refreshCloudLibraryIfSettingsChanged();
    });
  }

  async init() {
    this.disposed = false;
    await this.reload();
  }

  dispose() {
    if (!this.disposed) {
      persistedFilterSelections = {
        profileKey: activeProfileKey(),
        sourceMode: this.state.sourceMode,
        selectedTypeKey: this.state.selectedTypeKey,
        selectedGenre: this.state.selectedGenre,
        selectedYear: this.state.selectedYear,
        selectedWatchedFilter: this.state.selectedWatchedFilter,
        selectedSortKey: this.state.selectedSortKey,
        posterFocusIndex: this.posterFocusIndex()
      };
    }
    this.disposed = true;
    this.reloadToken += 1;
    this.unsubscribeDebridSettings?.();
    this.unsubscribeDebridSettings = null;
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
  }

  posterFocusIndex() {
    const key = this.state.lastFocusedPosterKey;
    return this.state.visibleItems.findIndex((item) => `${item.type}:${item.id}` === key);
  }

  getState() {
    return {
      ...this.state,
      listTabs: [...this.state.listTabs],
      availableTypeTabs: [...this.state.availableTypeTabs],
      availableGenres: [...this.state.availableGenres],
      availableYears: [...this.state.availableYears],
      availableSortOptions: [...this.state.availableSortOptions],
      allItems: [...this.state.allItems],
      visibleItems: [...this.state.visibleItems],
      visibleCloudItems: [...this.state.visibleCloudItems],
      availableCloudProviders: [...this.state.availableCloudProviders],
      availableCloudTypes: [...this.state.availableCloudTypes],
      cloudLibrary: {
        ...this.state.cloudLibrary,
        providers: [...(this.state.cloudLibrary?.providers || [])],
        items: [...(this.state.cloudLibrary?.items || [])]
      },
      watchedTitleIds: new Set(this.state.watchedTitleIds || []),
      listEditorState: copyEditorState(this.state.listEditorState)
    };
  }

  setState(patch, options = {}) {
    this.state = {
      ...this.state,
      ...patch
    };
    const facets = buildFacets(this.state.allItems, this.state);
    // While items are still loading the facets are not final; reload() validates
    // the (possibly restored) selections once the repository data is in.
    const keepSelections = this.state.isLoading === true;
    const selectedGenre =
      this.state.selectedGenre &&
      (keepSelections ||
        facets.availableGenres.some((item) => item.key === this.state.selectedGenre))
        ? this.state.selectedGenre
        : null;
    const selectedYear =
      this.state.selectedYear &&
      (keepSelections || facets.availableYears.some((item) => item.key === this.state.selectedYear))
        ? this.state.selectedYear
        : null;
    this.state = {
      ...this.state,
      ...facets,
      selectedTypeKey:
        keepSelections ||
        facets.availableTypeTabs.some((item) => item.key === this.state.selectedTypeKey)
          ? this.state.selectedTypeKey
          : ALL_KEY,
      selectedGenre,
      selectedYear
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    this.state = withVisibleCloudItems(this.state);
    const hasFocusedPoster =
      this.state.viewMode === LIBRARY_VIEW_MODE.CLOUD
        ? this.state.visibleCloudItems.some(
            (item) => `cloud:${item.stableKey}` === this.state.lastFocusedPosterKey
          )
        : this.state.visibleItems.some(
            (item) => `${item.type}:${item.id}` === this.state.lastFocusedPosterKey
          );
    if (!hasFocusedPoster) {
      const firstItem =
        this.state.viewMode === LIBRARY_VIEW_MODE.CLOUD
          ? this.state.visibleCloudItems[0] || null
          : this.state.visibleItems[0] || null;
      this.state.lastFocusedPosterKey = firstItem
        ? this.state.viewMode === LIBRARY_VIEW_MODE.CLOUD
          ? `cloud:${firstItem.stableKey}`
          : `${firstItem.type}:${firstItem.id}`
        : null;
      persistedPosterFocusKey = this.state.lastFocusedPosterKey;
    }
    if (options.notify !== false) {
      this.onChange(this.getState(), {
        reason: options.reason || "state"
      });
    }
  }

  async reload(options = {}) {
    const reloadToken = this.reloadToken + 1;
    this.reloadToken = reloadToken;
    const preserveOverlay = options.preserveOverlay === true;
    if (!preserveOverlay) {
      this.state = {
        ...this.state,
        isLoading: true
      };
      this.onChange(this.getState());
    }

    const sourceMode = await libraryRepository.getSourceMode();
    if (this.disposed || reloadToken !== this.reloadToken) {
      return;
    }
    let listTabs, allItems, watchedItems;
    try {
      [listTabs, allItems, watchedItems] = await Promise.all([
        libraryRepository.getListTabs({ sourceMode }),
        libraryRepository.getItems({ hydrate: false, sourceMode }),
        watchedItemsRepository.getAll(5000).catch(() => [])
      ]);
    } catch (error) {
      if (sourceMode !== LibrarySourceMode.MDBLIST) throw error;
      if (!this.disposed && reloadToken === this.reloadToken)
        this.setState({
          sourceMode,
          selectedSortKey: LibrarySortOptionKey.DEFAULT,
          allItems: [],
          listTabs: [],
          selectedListKey: null,
          isLoading: false,
          errorMessage: trackingErrorMessage(error) || t("mdblist_unavailable")
        });
      return;
    }
    if (this.disposed || reloadToken !== this.reloadToken) {
      return;
    }

    const persistedListKey = LibraryPreferencesStore.getLastSelectedListKey();
    const nextSelectedListKey =
      sourceMode !== LibrarySourceMode.LOCAL
        ? this.state.selectedListKey &&
          listTabs.some((item) => item.key === this.state.selectedListKey)
          ? this.state.selectedListKey
          : listTabs.some((item) => item.key === persistedListKey)
            ? persistedListKey
            : listTabs[0]?.key || null
        : null;

    const availableSortOptions =
      sourceMode === LibrarySourceMode.MDBLIST
        ? [
            ...LIBRARY_SORT_OPTIONS.map((option) =>
              option.key === LibrarySortOptionKey.DEFAULT
                ? { ...option, labelKey: "library_sort_provider_order", fallback: "Provider Order" }
                : option
            ),
            { key: "released_desc", labelKey: "library_sort_released_desc" },
            { key: "released_asc", labelKey: "library_sort_released_asc" }
          ]
        : sourceMode !== LibrarySourceMode.LOCAL
          ? LIBRARY_SORT_OPTIONS
          : LIBRARY_SORT_OPTIONS.filter((option) => option.key !== LibrarySortOptionKey.DEFAULT);
    const facets = buildFacets(allItems, {
      ...this.state,
      sourceMode,
      selectedListKey: nextSelectedListKey
    });
    const availableTypeTabs = facets.availableTypeTabs;
    const selectedTypeKey = availableTypeTabs.some(
      (item) => item.key === this.state.selectedTypeKey
    )
      ? this.state.selectedTypeKey
      : ALL_KEY;
    const selectedGenre =
      this.state.selectedGenre &&
      facets.availableGenres.some((item) => item.key === this.state.selectedGenre)
        ? this.state.selectedGenre
        : null;
    const selectedYear =
      this.state.selectedYear &&
      facets.availableYears.some((item) => item.key === this.state.selectedYear)
        ? this.state.selectedYear
        : null;
    const selectedSortKey =
      sourceMode === LibrarySourceMode.MDBLIST && this.state.sourceMode !== sourceMode
        ? LibrarySortOptionKey.DEFAULT
        : availableSortOptions.some((item) => item.key === this.state.selectedSortKey)
          ? this.state.selectedSortKey
          : sourceMode !== LibrarySourceMode.LOCAL
            ? LibrarySortOptionKey.DEFAULT
            : LibrarySortOptionKey.ADDED_DESC;
    const previousFocusIndex = this.state.visibleItems.length
      ? this.posterFocusIndex()
      : persistedFilterSelections?.profileKey === activeProfileKey()
        ? persistedFilterSelections.posterFocusIndex
        : -1;
    const manageSelectedListKey =
      this.state.manageSelectedListKey &&
      listTabs.some(
        (item) => item.key === this.state.manageSelectedListKey && item.type === "personal"
      )
        ? this.state.manageSelectedListKey
        : listTabs.find((item) => item.type === "personal")?.key || null;

    this.state = {
      ...this.state,
      sourceMode,
      allItems,
      listTabs,
      availableTypeTabs: facets.availableTypeTabs,
      availableGenres: facets.availableGenres,
      availableYears: facets.availableYears,
      availableSortOptions,
      selectedListKey: nextSelectedListKey,
      selectedTypeKey,
      selectedGenre,
      selectedYear,
      selectedSortKey,
      providerSortOrder: null,
      manageSelectedListKey,
      isNuvioAccount: sourceMode === LibrarySourceMode.LOCAL && AuthManager.isAuthenticated,
      isTraktAuthenticated: sourceMode === LibrarySourceMode.TRAKT,
      isSimklAuthenticated: sourceMode === LibrarySourceMode.SIMKL,
      ...(sourceMode === LibrarySourceMode.MDBLIST
        ? { errorMessage: trackingErrorMessage(MdbListLibrary.error()) || null }
        : {}),
      watchedTitleIds: buildWatchedTitleIdSet(watchedItems),
      isLoading: false,
      isSyncing: false,
      expandedPicker: preserveOverlay ? this.state.expandedPicker : null,
      pickerFocusIndex: 0
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    // A removed title keeps the grid position by focusing the card that took its slot.
    if (previousFocusIndex >= 0 && this.posterFocusIndex() < 0 && this.state.visibleItems.length) {
      const item =
        this.state.visibleItems[Math.min(previousFocusIndex, this.state.visibleItems.length - 1)];
      this.setFocusedPosterKey(`${item.type}:${item.id}`);
    }
    this.onChange(this.getState());
    void this.loadMdbListSortOrder();

    void watchedTitleStateRepository
      .getTitleWatchedItems(allItems, { baseWatchedItems: watchedItems, limit: 5000 })
      .then((projectedItems) => {
        if (this.disposed || reloadToken !== this.reloadToken) {
          return;
        }
        this.setState(
          { watchedTitleIds: buildWatchedTitleIdSet(projectedItems) },
          { reason: "watchedTitleProjection" }
        );
      })
      .catch((error) => {
        if (!this.disposed && reloadToken === this.reloadToken) {
          console.warn("Library watched title projection failed", error);
        }
      });

    let hydrationChanged = false;
    void libraryRepository
      .hydrateItems(allItems, {
        shouldContinue: () => !this.disposed && reloadToken === this.reloadToken,
        onBatch: (enrichedItems) => {
          if (this.disposed || reloadToken !== this.reloadToken) {
            return;
          }
          hydrationChanged = true;
          this.setState({ allItems: enrichedItems }, { notify: false });
        }
      })
      .then((enrichedItems) => {
        if (!hydrationChanged || this.disposed || reloadToken !== this.reloadToken) {
          return;
        }
        this.setState({ allItems: enrichedItems }, { reason: "metadataHydration" });
      })
      .catch((error) => {
        if (!this.disposed && reloadToken === this.reloadToken) {
          console.warn("Library metadata enrichment failed", error);
        }
      });
  }

  getSourceLabel() {
    if (this.state.viewMode === LIBRARY_VIEW_MODE.CLOUD) {
      return t("library_source_cloud", {}, "CLOUD").toUpperCase();
    }
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t("library_source_trakt", {}, "TRAKT");
    }
    if (this.state.sourceMode === LibrarySourceMode.MDBLIST) return "MDBLIST";
    if (this.state.sourceMode === LibrarySourceMode.SIMKL) {
      return "SIMKL";
    }
    if (this.state.isNuvioAccount) {
      return t("library_source_nuvio", {}, "NUVIO");
    }
    return t("library_source_local", {}, "LOCAL");
  }

  getSelectedTypeLabel() {
    const label =
      this.state.availableTypeTabs.find((item) => item.key === this.state.selectedTypeKey)?.label ||
      t("library_type_all", {}, "All");
    return stripCountSuffix(label);
  }

  getSelectedSortLabel() {
    return (
      optionLabel(
        this.state.availableSortOptions.find((item) => item.key === this.state.selectedSortKey)
      ) || t("library_sort_added_desc", {}, "Added ↓")
    );
  }

  getSelectedListLabel() {
    return (
      this.state.listTabs.find((item) => item.key === this.state.selectedListKey)?.title || "Select"
    );
  }

  getSelectedGenreLabel() {
    return this.state.selectedGenre || t("library_type_all", {}, "All");
  }

  getSelectedYearLabel() {
    return this.state.selectedYear || t("library_type_all", {}, "All");
  }

  getSelectedWatchedLabel() {
    const labels = {
      [LIBRARY_WATCHED_FILTER.ALL]: t("library_watched_filter_all", {}, "All"),
      [LIBRARY_WATCHED_FILTER.WATCHED]: t("library_watched_filter_watched", {}, "Watched"),
      [LIBRARY_WATCHED_FILTER.UNWATCHED]: t("library_watched_filter_unwatched", {}, "Unwatched")
    };
    return labels[this.state.selectedWatchedFilter] || labels[LIBRARY_WATCHED_FILTER.ALL];
  }

  getEmptyStateTitle() {
    const selectedTypeLabel = typeLabelForEmptyState(this.state.selectedTypeKey);
    if (this.state.sourceMode === LibrarySourceMode.TRAKT && !this.state.isTraktAuthenticated) {
      return t("library_empty_trakt_not_auth_title", {}, "Trakt not connected");
    }
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t(
        "library_empty_trakt_title",
        [selectedTypeLabel],
        `No ${selectedTypeLabel} in this list`
      );
    }
    if (this.state.sourceMode === LibrarySourceMode.SIMKL) {
      return `No ${selectedTypeLabel} in this Simkl status`;
    }
    return t("library_empty_local_title", [selectedTypeLabel], `No ${selectedTypeLabel} yet`);
  }

  getEmptyStateSubtitle() {
    if (this.state.sourceMode === LibrarySourceMode.TRAKT && !this.state.isTraktAuthenticated) {
      return t(
        "library_empty_trakt_not_auth_subtitle",
        {},
        "Connect your Trakt account in Settings to view your Trakt library"
      );
    }
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t(
        "library_empty_trakt_subtitle",
        {},
        "Use + in details to add items to watchlist or lists"
      );
    }
    if (this.state.sourceMode === LibrarySourceMode.SIMKL) {
      return "Use + in details to move items between Simkl statuses";
    }
    return t("library_empty_local_subtitle", {}, "Start saving your favorites to see them here");
  }

  getPickerOptions(picker) {
    if (picker === "cloud_provider") {
      return [
        { value: ALL_KEY, label: t("cloud_library_provider_all", {}, "All") },
        ...this.state.availableCloudProviders.map((item) => ({
          value: item.key,
          label: `${item.label} (${item.count})`
        }))
      ];
    }
    if (picker === "cloud_type") {
      return [
        { value: ALL_KEY, label: t("cloud_library_type_all", {}, "All") },
        ...this.state.availableCloudTypes.map((item) => ({
          value: item.key,
          label: `${item.label} (${item.count})`
        }))
      ];
    }
    if (picker === "list") {
      return this.state.listTabs.map((item) => ({ value: item.key, label: item.title }));
    }
    if (picker === "type") {
      return this.state.availableTypeTabs.map((item) => ({ value: item.key, label: item.label }));
    }
    if (picker === "sort") {
      return this.state.availableSortOptions.map((item) => ({
        value: item.key,
        label: optionLabel(item)
      }));
    }
    if (picker === "genre") {
      return [
        { value: ALL_KEY, label: t("library_type_all", {}, "All") },
        ...this.state.availableGenres.map((item) => ({
          value: item.key,
          label: `${item.label} (${item.count})`
        }))
      ];
    }
    if (picker === "year") {
      return [
        { value: ALL_KEY, label: t("library_type_all", {}, "All") },
        ...this.state.availableYears.map((item) => ({
          value: item.key,
          label: `${item.label} (${item.count})`
        }))
      ];
    }
    if (picker === "watched") {
      return [
        {
          value: LIBRARY_WATCHED_FILTER.ALL,
          label: t("library_watched_filter_all", {}, "All")
        },
        {
          value: LIBRARY_WATCHED_FILTER.WATCHED,
          label: t("library_watched_filter_watched", {}, "Watched")
        },
        {
          value: LIBRARY_WATCHED_FILTER.UNWATCHED,
          label: t("library_watched_filter_unwatched", {}, "Unwatched")
        }
      ];
    }
    return [];
  }

  togglePicker(picker) {
    const nextExpanded = this.state.expandedPicker === picker ? null : picker;
    const options = this.getPickerOptions(picker);
    let pickerFocusIndex = 0;
    if (nextExpanded) {
      const currentValue =
        picker === "cloud_provider"
          ? this.state.selectedCloudProviderId || ALL_KEY
          : picker === "cloud_type"
            ? this.state.selectedCloudType || ALL_KEY
            : picker === "list"
              ? this.state.selectedListKey
              : picker === "type"
                ? this.state.selectedTypeKey
                : picker === "genre"
                  ? this.state.selectedGenre || ALL_KEY
                  : picker === "year"
                    ? this.state.selectedYear || ALL_KEY
                    : picker === "watched"
                      ? this.state.selectedWatchedFilter
                      : this.state.selectedSortKey;
      const optionIndex = Math.max(
        0,
        options.findIndex((item) => item.value === currentValue)
      );
      pickerFocusIndex = optionIndex;
    }
    this.setState({
      expandedPicker: nextExpanded,
      pickerFocusIndex
    });
  }

  closePicker() {
    if (!this.state.expandedPicker) {
      return false;
    }
    this.setState({
      expandedPicker: null,
      pickerFocusIndex: 0
    });
    return true;
  }

  movePickerFocus(direction, config = {}) {
    const pickerOptions = this.getPickerOptions(this.state.expandedPicker);
    if (!pickerOptions.length) {
      return;
    }
    const delta = direction === "up" ? -1 : 1;
    const nextIndex = Math.max(
      0,
      Math.min(pickerOptions.length - 1, Number(this.state.pickerFocusIndex || 0) + delta)
    );
    if (config.silent === true) {
      this.state.pickerFocusIndex = nextIndex;
      return;
    }
    this.setState({ pickerFocusIndex: nextIndex });
  }

  selectOpenPickerOption() {
    const picker = this.state.expandedPicker;
    if (!picker) {
      return;
    }
    const options = this.getPickerOptions(picker);
    const option = options[Number(this.state.pickerFocusIndex || 0)];
    if (!option) {
      return;
    }
    if (picker === "cloud_provider") {
      this.selectCloudProvider(option.value === ALL_KEY ? null : option.value);
      return;
    }
    if (picker === "cloud_type") {
      this.selectCloudType(option.value === ALL_KEY ? null : option.value);
      return;
    }
    if (picker === "list") {
      this.selectList(option.value);
      return;
    }
    if (picker === "type") {
      this.selectType(option.value);
      return;
    }
    if (picker === "sort") {
      this.selectSort(option.value);
      return;
    }
    if (picker === "genre") {
      this.selectGenre(option.value === ALL_KEY ? null : option.value);
      return;
    }
    if (picker === "year") {
      this.selectYear(option.value === ALL_KEY ? null : option.value);
      return;
    }
    if (picker === "watched") {
      this.selectWatchedFilter(option.value);
    }
  }

  async selectViewMode(mode) {
    const normalized = Object.values(LIBRARY_VIEW_MODE).includes(mode)
      ? mode
      : LIBRARY_VIEW_MODE.SAVED;
    persistedLibraryViewMode = normalized;
    this.setState({ viewMode: normalized, expandedPicker: null });
    if (normalized === LIBRARY_VIEW_MODE.CLOUD && !this.state.cloudLibrary.isLoaded) {
      await this.refreshCloudLibrary();
    }
  }

  async refreshCloudLibrary() {
    if (this.state.cloudLibrary.isRefreshing) return false;
    this.setState({
      cloudLibrary: { ...this.state.cloudLibrary, isRefreshing: true },
      cloudFilePickerItem: null
    });
    try {
      const cloudLibrary = await cloudLibraryRepository.refresh();
      if (this.disposed) return false;
      this.cloudSettingsSignature = cloudLibrarySettingsSignature();
      this.setState({ cloudLibrary });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      this.setTransientMessage(
        String(trackingErrorMessage(error) || "") ||
          t("cloud_library_load_failed", { provider: "" }, "Could not load cloud library")
      );
      this.setState({
        cloudLibrary: { ...this.state.cloudLibrary, isLoaded: true, isRefreshing: false }
      });
      return false;
    }
  }

  async refreshCloudLibraryIfSettingsChanged() {
    if (this.state.viewMode !== LIBRARY_VIEW_MODE.CLOUD) return false;
    const signature = cloudLibrarySettingsSignature();
    if (signature === this.cloudSettingsSignature) return false;
    this.cloudSettingsSignature = signature;
    return this.refreshCloudLibrary();
  }

  selectCloudProvider(providerId) {
    this.setState({ selectedCloudProviderId: providerId, expandedPicker: null });
  }

  selectCloudType(type) {
    this.setState({ selectedCloudType: type, expandedPicker: null });
  }

  setCloudSearchQuery(query, options = {}) {
    this.setState(
      { cloudSearchQuery: String(query || "") },
      { reason: options.reason || "cloudSearch" }
    );
  }

  openCloudFilePicker(item) {
    this.setState({ cloudFilePickerItem: item || null });
  }

  closeCloudFilePicker() {
    if (!this.state.cloudFilePickerItem) return false;
    this.setState({ cloudFilePickerItem: null, resolvingCloudFileKey: null });
    return true;
  }

  cloudItemByKey(stableKey) {
    return this.state.visibleCloudItems.find((item) => item.stableKey === stableKey) || null;
  }

  async resolveCloudPlayback(item, file) {
    if (!item || !file || this.state.resolvingCloudFileKey) return null;
    const resolveKey = `${item.stableKey}:${file.stableKey}`;
    this.setState({ resolvingCloudFileKey: resolveKey });
    try {
      const result = await cloudLibraryRepository.resolvePlayback(item, file);
      if (this.disposed) return null;
      this.setState({ resolvingCloudFileKey: null });
      if (result?.status === "success") return result;
      const fallback =
        result?.status === "missingCredentials"
          ? t("cloud_library_connect_message", {}, "Connect a cloud account in Settings.")
          : result?.status === "notPlayable"
            ? t("cloud_library_no_playable_files", {}, "No playable files")
            : result?.status === "disabled"
              ? t("cloud_library_error_disabled", {}, "Cloud library is disabled.")
              : t("cloud_library_play_failed", {}, "Could not play this cloud file.");
      this.setTransientMessage(result?.message || fallback);
      return null;
    } catch (error) {
      if (!this.disposed) {
        this.setState({ resolvingCloudFileKey: null });
        this.setTransientMessage(
          String(trackingErrorMessage(error) || "") ||
            t("cloud_library_play_failed", {}, "Could not play this cloud file.")
        );
      }
      return null;
    }
  }

  playableFilesForCloudItem(item) {
    return playableCloudFiles(item);
  }

  selectList(key) {
    LibraryPreferencesStore.setLastSelectedListKey(key);
    this.setState({
      providerSortOrder: null,
      selectedListKey: key,
      selectedTypeKey: ALL_KEY,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
    void this.loadMdbListSortOrder();
  }

  selectType(key) {
    this.setState({
      selectedTypeKey: key,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectGenre(key) {
    this.setState({
      selectedGenre: key || null,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectYear(key) {
    this.setState({
      selectedYear: key || null,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectWatchedFilter(key) {
    const selectedWatchedFilter = Object.values(LIBRARY_WATCHED_FILTER).includes(key)
      ? key
      : LIBRARY_WATCHED_FILTER.ALL;
    this.setState({
      selectedWatchedFilter,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectSort(key) {
    this.state = {
      ...this.state,
      selectedSortKey: key,
      providerSortOrder: null,
      expandedPicker: null,
      pickerFocusIndex: 0
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    const firstItem = this.state.visibleItems[0] || null;
    this.state.lastFocusedPosterKey = firstItem ? `${firstItem.type}:${firstItem.id}` : null;
    persistedPosterFocusKey = this.state.lastFocusedPosterKey;
    this.onChange(this.getState());
    void this.loadMdbListSortOrder();
  }

  async loadMdbListSortOrder() {
    if (
      this.state.sourceMode !== LibrarySourceMode.MDBLIST ||
      !["added_asc", "added_desc", "released_asc", "released_desc"].includes(
        this.state.selectedSortKey
      ) ||
      !this.state.selectedListKey
    )
      return;
    const token = this.reloadToken,
      listKey = this.state.selectedListKey,
      sortKey = this.state.selectedSortKey;
    const current = () =>
      !this.disposed &&
      token === this.reloadToken &&
      this.state.sourceMode === LibrarySourceMode.MDBLIST &&
      this.state.selectedListKey === listKey &&
      this.state.selectedSortKey === sortKey;
    try {
      const keys = await MdbListLibrary.order(listKey, sortKey);
      if (current()) this.setState({ providerSortOrder: { listKey, sortKey, keys } });
    } catch (error) {
      if (current())
        this.setState({
          selectedSortKey: LibrarySortOptionKey.DEFAULT,
          providerSortOrder: null,
          errorMessage: trackingErrorMessage(error) || t("mdblist_unavailable")
        });
    }
  }

  setFocusedPosterKey(key) {
    this.state.lastFocusedPosterKey = key || null;
    persistedPosterFocusKey = this.state.lastFocusedPosterKey;
  }

  openManageLists() {
    this.setState({
      showManageDialog: true,
      errorMessage: null,
      expandedPicker: null,
      manageSelectedListKey:
        this.state.manageSelectedListKey ||
        this.state.listTabs.find((item) => item.type === "personal")?.key ||
        null
    });
  }

  closeManageLists() {
    this.setState({
      showManageDialog: false,
      listEditorState: null,
      showDeleteConfirm: false,
      errorMessage: null
    });
  }

  selectManageList(key) {
    this.setState({
      manageSelectedListKey: key
    });
  }

  startCreateList() {
    this.setState({
      listEditorState: {
        mode: "create",
        listId: null,
        name: "",
        description: "",
        privacy: LibraryListPrivacy.PRIVATE
      },
      errorMessage: null
    });
  }

  startEditList() {
    const selected = this.state.listTabs.find(
      (item) => item.key === this.state.manageSelectedListKey && item.type === "personal"
    );
    if (!selected) {
      return;
    }
    this.setState({
      listEditorState: {
        mode: "edit",
        listId: selected.traktListId || selected.key.replace("personal:", ""),
        name: selected.title,
        description:
          this.state.sourceMode === LibrarySourceMode.MDBLIST ? "" : selected.description || "",
        privacy: selected.privacy || LibraryListPrivacy.PRIVATE
      },
      errorMessage: null
    });
  }

  updateEditorField(field, value, options = {}) {
    if (!this.state.listEditorState) {
      return;
    }
    this.state.listEditorState = {
      ...this.state.listEditorState,
      [field]: value
    };
    if (options.silent === true) {
      return;
    }
    this.onChange(this.getState());
  }

  closeEditor() {
    this.setState({
      listEditorState: null
    });
  }

  promptDeleteList() {
    this.setState({
      showDeleteConfirm: true
    });
  }

  closeDeleteConfirm() {
    this.setState({
      showDeleteConfirm: false
    });
  }

  async submitEditor() {
    const editor = this.state.listEditorState;
    if (!editor) {
      return;
    }
    const name = String(editor.name || "").trim();
    if (!name) {
      this.setError("List name is required");
      return;
    }

    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      if (editor.mode === "create") {
        const newKey = await libraryRepository.createPersonalList(
          name,
          editor.description.trim() || null,
          editor.privacy
        );
        this.setTransientMessage(
          this.state.sourceMode === LibrarySourceMode.MDBLIST
            ? t("library_list_created")
            : "List created"
        );
        await this.reload({ preserveOverlay: true });
        this.setState({
          pendingOperation: false,
          listEditorState: null,
          manageSelectedListKey: newKey
        });
      } else {
        await libraryRepository.updatePersonalList(
          editor.listId,
          name,
          editor.description.trim() || null,
          editor.privacy
        );
        this.setTransientMessage(
          this.state.sourceMode === LibrarySourceMode.MDBLIST
            ? t("library_list_updated")
            : "List updated"
        );
        await this.reload({ preserveOverlay: true });
        this.setState({
          pendingOperation: false,
          listEditorState: null
        });
      }
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(trackingErrorMessage(error) || "Failed to save list");
    }
  }

  async deleteSelectedList() {
    const selected = this.state.listTabs.find(
      (item) => item.key === this.state.manageSelectedListKey && item.type === "personal"
    );
    if (!selected) {
      return;
    }
    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      await libraryRepository.deletePersonalList(
        selected.traktListId || selected.key.replace("personal:", "")
      );
      this.setTransientMessage(
        this.state.sourceMode === LibrarySourceMode.MDBLIST
          ? t("library_list_deleted")
          : "List deleted"
      );
      await this.reload({ preserveOverlay: true });
      this.setState({
        pendingOperation: false,
        showDeleteConfirm: false
      });
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(trackingErrorMessage(error) || "Failed to delete list");
    }
  }

  async moveSelectedList(direction) {
    const personalTabs = this.state.listTabs.filter((item) => item.type === "personal");
    const currentIndex = personalTabs.findIndex(
      (item) => item.key === this.state.manageSelectedListKey
    );
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= personalTabs.length) {
      return;
    }
    const reordered = [...personalTabs];
    const [selected] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, selected);

    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      await libraryRepository.reorderPersonalLists(
        reordered.map((item) => item.traktListId || item.key.replace("personal:", ""))
      );
      this.setTransientMessage("List order updated");
      await this.reload({ preserveOverlay: true });
      this.setState({
        pendingOperation: false,
        manageSelectedListKey: selected.key
      });
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(trackingErrorMessage(error) || "Failed to reorder lists");
    }
  }

  async refreshNow() {
    if (this.state.isSyncing) {
      return false;
    }
    const startedAt = Date.now();
    this.setState({ isSyncing: true, errorMessage: null });
    try {
      await allowLoadingFrame();
      await libraryRepository.refreshNow();
      const elapsed = Date.now() - startedAt;
      if (elapsed < SYNC_LOADING_MIN_MS) {
        await delay(SYNC_LOADING_MIN_MS - elapsed);
      }
      await this.reload({ preserveOverlay: true });
      this.setTransientMessage(t("library_message_synced", {}, "Library synced"));
      this.setState({ isSyncing: false });
    } catch (error) {
      this.setState({ isSyncing: false });
      this.setError(
        trackingErrorMessage(error) ||
          t("library_error_refresh_failed", {}, "Failed to refresh library")
      );
    }
  }

  setError(message) {
    this.setState({
      errorMessage: message,
      transientMessage: message
    });
    this.scheduleMessageClear();
  }

  setTransientMessage(message) {
    this.setState({
      transientMessage: message,
      errorMessage: null
    });
    this.scheduleMessageClear();
  }

  clearTransientMessage() {
    this.setState({
      transientMessage: null
    });
  }

  scheduleMessageClear() {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
    }
    this.messageTimer = setTimeout(() => {
      this.messageTimer = null;
      this.clearTransientMessage();
    }, MESSAGE_CLEAR_MS);
  }
}
