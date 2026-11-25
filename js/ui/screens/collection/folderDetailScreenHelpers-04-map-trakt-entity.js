import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { Environment } from "../../../platform/environment.js";

import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { catalogRepository } from "../../../data/repository/catalogRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { CollectionsStore } from "../../../data/local/collectionsStore.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { catalogSkipStep, catalogSupportsExtra } from "../../../core/addons/homeCatalogs.js";

import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";

import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID } from "../../../config.js";

import {
  HomeScreen,
  buildModernHomeSizingStyle,
  buildModernHeroPresentation,
  createPosterCardMarkup,
  createSeeAllCardMarkup,
  escapeAttribute,
  escapeHtml,
  formatCatalogRowTitle,
  normalizeCollectionFolderItem,
  renderContinueWatchingSection
} from "../home/homeScreen.js";

import { renderModernHomeLayout } from "../home/modernHomeLayout.js";

import { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { firstNonEmpty, normalizeItem, bestTraktImage, TRAKT_PAGE_SIZE } from "./folderDetailScreenHelpers-01-tmdb-api-url.js";
import { buildTraktHeaders, fetchTmdbSourceItems } from "./folderDetailScreenHelpers-03-set-tmdb-discover-param.js";
import { fetchAddonSourceItems } from "./folderDetailScreenHelpers-02-build-fallback-streaming-sources.js";

export function mapTraktEntity(entity = {}, type = "movie") {
  const ids = entity?.ids || {};
  const title = firstNonEmpty(entity?.title, entity?.name);
  if (!title) {
    return null;
  }
  const id = firstNonEmpty(ids?.imdb, ids?.slug ? `${type}:${ids.slug}` : "", ids?.trakt ? `trakt:${ids.trakt}` : "");
  if (!id) {
    return null;
  }
  const normalizedType = type === "show" ? "series" : "movie";
  return normalizeItem(
    {
      id,
      type: normalizedType,
      name: title,
      poster: bestTraktImage(entity?.images, "poster", "posters", "fanart"),
      background: bestTraktImage(entity?.images, "fanart", "background", "backdrop", "banner", "thumb", "poster"),
      releaseInfo: String(entity?.year || entity?.released || entity?.first_aired || "").slice(0, 4),
      logo: bestTraktImage(entity?.images, "logo", "clearart")
    },
    normalizedType
  );
}

export async function fetchTraktSourceItems(source = {}, page = 1) {
  const mediaType = String(source.mediaType || "MOVIE").toUpperCase() === "TV" ? "show" : "movie";
  const url = new URL(
    `${String(TRAKT_API_URL || "https://api.trakt.tv").replace(/\/+$/, "")}/lists/${encodeURIComponent(String(source.traktListId || ""))}/items/${mediaType}`
  );
  url.searchParams.set("extended", "full,images");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(TRAKT_PAGE_SIZE));
  url.searchParams.set("sort_by", String(source.sortBy || "rank"));
  url.searchParams.set("sort_how", String(source.sortHow || "asc"));
  const response = await fetch(url.toString(), { headers: buildTraktHeaders() });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(String(payload?.message || payload?.error || response.statusText || "Could not load Trakt list"));
  }
  const pageCount = Number(response.headers.get("X-Pagination-Page-Count") || page);
  const items = (Array.isArray(payload) ? payload : [])
    .map((entry) => {
      return mediaType === "show" ? mapTraktEntity(entry?.show || null, "show") : mapTraktEntity(entry?.movie || null, "movie");
    })
    .filter(Boolean);
  return {
    items,
    hasMore: page < pageCount && items.length > 0,
    page
  };
}

export async function fetchSourceItems(source = {}, page = 1, skipOverride = null) {
  const provider = String(source.provider || "addon").toLowerCase();
  if (provider === "tmdb") {
    return fetchTmdbSourceItems(source, page);
  }
  if (provider === "trakt") {
    return fetchTraktSourceItems(source, page);
  }
  return fetchAddonSourceItems(source, page, skipOverride);
}
