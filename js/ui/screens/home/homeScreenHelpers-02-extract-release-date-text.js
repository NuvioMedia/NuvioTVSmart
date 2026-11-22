/* eslint-disable no-unused-vars */
import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { catalogRepository } from "../../../data/repository/catalogRepository.js";

import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

import { CloudLibraryPlaybackProgressStore, CloudLibraryPlaybackSessionStore } from "../../../data/local/cloudLibraryPlaybackStore.js";

import { cloudLibraryRepository } from "../../../data/repository/cloudLibraryRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";

import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";

import { libraryRepository, LibrarySourceMode } from "../../../data/repository/libraryRepository.js";

import { mapWithConcurrency } from "../../../core/network/mapWithConcurrency.js";

import { filterReleasedItems } from "../../../core/util/releaseInfoUtils.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { showHomeRatings } from "../../../core/util/imdbRatingVisibility.js";

import { continueWatchingUsesEpisodeThumbnails, continueWatchingImageSources } from "../../../core/util/continueWatchingImage.js";

import { ContinueWatchingPreferences } from "../../../data/local/continueWatchingPreferences.js";

import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

import { CollectionsStore, buildCollectionHomeKey } from "../../../data/local/collectionsStore.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { supportsMembershipFor } from "../../../core/tracking/trackingLibraryMembership.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

import { ProfileManager } from "../../../core/profile/profileManager.js";

import { StartupSyncService } from "../../../core/profile/startupSyncService.js";

import { Platform } from "../../../platform/index.js";

import { WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

import { watchProgressCompletedThreshold } from "../../../domain/model/watchProgress.js";

import { getTvArtworkPixelRatio, getTvHeroTransitionMode, getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { canUseModernTvArtworkBounding } from "../../../platform/tvPerformancePolicy.js";

import { jpegDimensions, pngStillDimensions, rescaleHomeLogoBlob } from "../../images/tvPosterRescaler.js";

import { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

import { LocalStore } from "../../../core/storage/localStore.js";

import { TMDB_API_KEY, YOUTUBE_PROXY_URL } from "../../../config.js";

import { I18n } from "../../../i18n/index.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

import { buildModernRowKey, MODERN_HOME_CONSTANTS, renderModernHomeLayout } from "./modernHomeLayout.js";

import { formatHomeRuntimeText, shouldPreserveHomeRuntimeText } from "./homeRuntime.js";

import { shouldKeepNextUpForAiringSetting } from "./nextUpAiringVisibility.js";

import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogShouldShowOnHome,
  catalogSkipStep,
  catalogSupportsExtra
} from "../../../core/addons/homeCatalogs.js";

import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getLegacySidebarNodes,
  getLegacySidebarSelectedNode,
  getModernSidebarNodes,
  getModernSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

import { NuvioDialog } from "../../components/nuvioDialog.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import {
  CW_DAYS_CAP,
  CW_DISPLAY_SNAPSHOT_KEY,
  CW_DISPLAY_SNAPSHOT_MAX_AGE_MS,
  CW_DISPLAY_SNAPSHOT_MAX_ITEMS,
  CW_DISPLAY_SNAPSHOT_MAX_SCOPES,
  CW_ENRICHMENT_CACHE_KEY,
  CW_ENRICHMENT_CACHE_MAX_AGE_MS,
  CW_ENTER_DELAY_MS,
  CW_HOLD_DELAY_MS,
  CW_MAX_ENRICHMENT_CONCURRENCY,
  CW_MAX_NEXT_UP_CONCURRENCY,
  CW_MAX_NEXT_UP_LOOKUPS,
  CW_MAX_VISIBLE_ITEMS,
  CW_META_TIMEOUT_MS,
  CW_META_TIMEOUT_TV_MS,
  CW_NEXT_UP_META_TIMEOUT_MS,
  CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS,
  CW_PROGRESS_START_THRESHOLD,
  CW_RENDER_BATCH_ITEMS_CONSTRAINED,
  CW_RENDER_BATCH_ITEMS_DEFAULT,
  CW_RENDER_BATCH_ITEMS_LEGACY_TV,
  CW_RENDER_LOAD_AHEAD_ITEMS,
  HERO_ROTATE_FIRST_DELAY_MS,
  HERO_ROTATE_INTERVAL_MS,
  HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS,
  HOME_BACKGROUND_RENDER_DELAY_MS,
  HOME_ADDON_MANIFEST_TIMEOUT_MS,
  HOME_GRID_COMPACT_ROW_COUNT,
  HOME_GRID_DEFAULT_ROW_COUNT,
  HOME_GRID_SAFE_MAX_COLUMNS,
  HOME_INITIAL_CATALOG_LOAD,
  HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS,
  HOME_LAYOUT_SEQUENCE,
  HOME_LOADING_ROW_ITEMS_CONSTRAINED,
  HOME_LOADING_ROW_ITEMS_DEFAULT,
  HOME_LOADING_ROW_ITEMS_LEGACY_TV,
  HOME_MAX_ITEMS_PER_ROW_CONSTRAINED,
  HOME_MAX_ITEMS_PER_ROW_CLASSIC,
  HOME_MAX_ITEMS_PER_ROW_DEFAULT,
  HOME_MAX_ITEMS_PER_ROW_LEGACY_TV,
  HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS,
  HOME_PERF_DEBUG,
  HOME_RETURN_FOCUS_STATE_KEY,
  HOME_ROW_RETRY_TIMEOUT_MS,
  HOME_ROW_TIMEOUT_MS,
  HOME_STABLE_GATE_TIMEOUT_MS
} from "./homeConstants.js";

import { mergeRefreshedHomeRows } from "./homeRowMerge.js";

import { findHomeFocusIdentityMatch, getHomeFocusIdentity, shouldApplyLateContinueWatchingFocus } from "./homeFocusPolicy.js";

import { resolveNextUpCandidates } from "./nextUpCandidateResolver.js";

import { findAbsoluteEpisodeAnchorIndex } from "./nextUpEpisodeAnchor.js";

import { shouldSurfaceNextUpForUntrackedSeries } from "./nextUpWatchingPolicy.js";

import { getContinueWatchingRenderItems, shouldAppendContinueWatchingItems } from "./continueWatchingRenderWindow.js";

import { shouldProtectContinueWatchingDisplay } from "./continueWatchingLoadPolicy.js";

import { buildHeroBackdropSources, buildImageFallbackErrorHandler, encodeHeroBackdropFallbacks } from "./homeImageHelpers.js";

import {
  escapeAttribute,
  escapeHtml,
  firstNonEmpty,
  formatContentTypeLabel,
  formatCatalogRowTitle,
  limitTextToWordCount,
  parseCssPx,
  prettyId,
  uniqueNonEmptyValues
} from "./homeUtils.js";

import { extractYear } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { buildModernHeroPresentation, buildHeroDisplayModel } from "./homeScreenHelpers-11-build-hero-display-model.js";

export function extractReleaseDateText(item) {
  const type = String(item?.type || item?.apiType || "").toLowerCase();
  if (type === "movie") {
    const candidates = [item?.released, item?.releaseDate, item?.release_date, item?.releaseInfo];
    for (const candidate of candidates) {
      const str = String(candidate || "");
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleDateString(I18n.getLocale(), {
            year: "numeric",
            month: "long",
            day: "numeric"
          });
        }
      }
    }
  }
  return extractYear(item);
}

export function formatRuntimeText(item) {
  return formatHomeRuntimeText(item);
}

export function shouldEnrichModernHero(hero) {
  if (!hero || hero.heroSource === "continueWatching" || hero.heroSource === "collection" || hero.heroMetaEnriched) {
    return false;
  }
  const settings = TmdbSettingsStore.get();
  const tmdbEnabledForCurrentLayout = settings.enabled && settings.modernHomeEnabled;
  const externalMetaEnabled = LayoutPreferences.get()?.preferExternalMetaAddonDetail !== false;
  // Keep the two enrichment sources independent, as in Android's focused
  // pipeline: TMDB is optional, while external addon metadata is enabled by
  // default and supplies the Home hero's runtime/rating fields.
  return Boolean(tmdbEnabledForCurrentLayout || externalMetaEnabled);
}

export const HERO_IMAGE_PRELOAD_CACHE_LIMIT = 32;

export const HERO_BACKDROP_BITMAP_CACHE_LIMIT = 4;

// Android's hero Coil request is 220x100dp, which is the 440x200 box the web
// hero paints at TV density. Addon logos can be 1664x437 or larger, and the
// Tizen renderer decodes an <img> at natural size for every hero swap.
export const HERO_LOGO_RESCALE_WIDTH_PX = 440;

export const HERO_LOGO_RESCALE_HEIGHT_PX = 200;

export const HERO_LOGO_RESCALE_CACHE_LIMIT = 16;

const HERO_LOGO_MAX_BYTES = 8 * 1024 * 1024;

export const HERO_IMAGE_PRELOAD_TIMEOUT_MS = 1500;

export const heroImagePreloadCache = new Map();

export const heroBackdropBitmapCache = new Map();

export const heroLogoRescaleCache = new Map();

function canDecodeHeroBackdropBitmap(src) {
  // Tizen's in-process renderer decodes a full-size <img> inside Commit; a
  // screen-sized ImageBitmap mirrors Android's Coil request sized to the hero.
  return (
    Platform.isTizen() &&
    canUseModernTvArtworkBounding(getTvRuntimePerformanceProfile()) &&
    typeof globalThis.fetch === "function" &&
    typeof globalThis.createImageBitmap === "function" &&
    /^https?:\/\//i.test(src)
  );
}

export function preloadHeroBackdrop(src) {
  const normalized = String(src || "").trim();
  if (!normalized || !canDecodeHeroBackdropBitmap(normalized)) {
    return preloadImageSource(normalized).then((loaded) => ({ loaded, bitmap: null }));
  }
  const cached = heroBackdropBitmapCache.get(normalized);
  if (cached) {
    heroBackdropBitmapCache.delete(normalized);
    heroBackdropBitmapCache.set(normalized, cached);
    return cached;
  }
  if (heroBackdropBitmapCache.size >= HERO_BACKDROP_BITMAP_CACHE_LIMIT) {
    const oldestSource = heroBackdropBitmapCache.keys().next().value;
    const oldest = heroBackdropBitmapCache.get(oldestSource);
    heroBackdropBitmapCache.delete(oldestSource);
    // Swaps already waiting on this entry draw it before the close runs.
    oldest.then((entry) => entry.bitmap?.close?.());
  }
  const resizeWidth = Math.max(1, Math.round((globalThis.innerWidth || 1920) * (globalThis.devicePixelRatio || 1)));
  const preload = globalThis
    .fetch(normalized, { mode: "cors", credentials: "omit" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.blob();
    })
    .then((blob) => globalThis.createImageBitmap(blob, { resizeWidth, resizeQuality: "medium" }))
    .then(
      (bitmap) => ({ loaded: true, bitmap }),
      () => {
        if (heroBackdropBitmapCache.get(normalized) === preload) {
          heroBackdropBitmapCache.delete(normalized);
        }
        return preloadImageSource(normalized).then((loaded) => ({ loaded, bitmap: null }));
      }
    );
  heroBackdropBitmapCache.set(normalized, preload);
  return preload;
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] || 0);
  }
  return text;
}

function uint16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function webpLogoDimensions(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = uint32le(bytes, offset + 4);
    const data = offset + 8;
    if (type === "VP8X") {
      if (bytes[data] & 0x02) {
        return null;
      }
      return {
        width: 1 + (bytes[data + 4] | (bytes[data + 5] << 8) | (bytes[data + 6] << 16)),
        height: 1 + (bytes[data + 7] | (bytes[data + 8] << 8) | (bytes[data + 9] << 16))
      };
    }
    if (type === "VP8L") {
      // 0x2f signature, then the two 14-bit sizes.
      const bits = uint32le(bytes, data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (type === "VP8 ") {
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        return null;
      }
      return {
        width: uint16le(bytes, data + 6) & 0x3fff,
        height: uint16le(bytes, data + 8) & 0x3fff
      };
    }
    offset = data + size + (size & 1);
  }
  return null;
}

/**
 * Natural size of a still PNG, WebP or JPEG read from its header. Returns null
 * for animated images and formats a canvas re-encode would change or drop.
 */
export function heroLogoDimensions(bytes) {
  if (!bytes || bytes.length < 24) {
    return null;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return pngStillDimensions(bytes);
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return webpLogoDimensions(bytes);
  }
  return jpegDimensions(bytes);
}

function canRescaleHeroLogo(src) {
  return Boolean(
    Platform.isTizen() &&
    canUseModernTvArtworkBounding(getTvRuntimePerformanceProfile()) &&
    typeof globalThis.fetch === "function" &&
    typeof globalThis.createImageBitmap === "function" &&
    typeof globalThis.OffscreenCanvas === "function" &&
    typeof globalThis.URL?.createObjectURL === "function" &&
    /^https?:\/\//i.test(src) &&
    !/\.(?:svg|gif)(?:[?#]|$)/i.test(src)
  );
}

export function shouldRescaleHeroLogo(src) {
  return canRescaleHeroLogo(String(src || "").trim());
}

function heroLogoTargetSize() {
  const ratio = getTvArtworkPixelRatio();
  return {
    width: Math.max(1, Math.round(HERO_LOGO_RESCALE_WIDTH_PX * ratio)),
    height: Math.max(1, Math.round(HERO_LOGO_RESCALE_HEIGHT_PX * ratio))
  };
}

function isHeroLogoPainted(objectUrl) {
  const images = globalThis.document?.querySelectorAll?.("img.home-hero-logo");
  if (!objectUrl || !images) {
    return false;
  }
  return Array.from(images).some((image) => image.getAttribute?.("src") === objectUrl);
}

function trimHeroLogoRescaleCache() {
  if (heroLogoRescaleCache.size <= HERO_LOGO_RESCALE_CACHE_LIMIT) {
    return;
  }
  for (const [source, entry] of heroLogoRescaleCache) {
    if (heroLogoRescaleCache.size <= HERO_LOGO_RESCALE_CACHE_LIMIT) {
      return;
    }
    // A blob url the hero still paints must outlive its cache slot; revoking
    // it blanks the logo. The next insert trims the entry once it is replaced.
    if (!entry.settled || isHeroLogoPainted(entry.objectUrl)) {
      continue;
    }
    if (entry.objectUrl) {
      globalThis.URL.revokeObjectURL(entry.objectUrl);
    }
    heroLogoRescaleCache.delete(source);
  }
}

function fallbackSource(src) {
  return preloadImageSource(src).then((loaded) => ({ loaded, src }));
}

/**
 * Resolve the url the hero logo should paint from. On eligible Tizen sets it is
 * a bounded WebP blob; everywhere else, and for every failure or unsupported
 * format, it is the original source loaded by preloadImageSource.
 */
export function preloadHeroLogo(src) {
  const normalized = String(src || "").trim();
  if (!normalized || !canRescaleHeroLogo(normalized)) {
    return fallbackSource(normalized);
  }
  const cached = heroLogoRescaleCache.get(normalized);
  if (cached) {
    heroLogoRescaleCache.delete(normalized);
    heroLogoRescaleCache.set(normalized, cached);
    return cached.promise;
  }

  const entry = { promise: null, objectUrl: "", settled: false };
  const target = heroLogoTargetSize();
  const finishRescaledBlob = (resized) => {
    const objectUrl = globalThis.URL.createObjectURL(resized);
    if (heroLogoRescaleCache.get(normalized) !== entry) {
      globalThis.URL.revokeObjectURL(objectUrl);
      return { loaded: true, src: normalized };
    }
    entry.objectUrl = objectUrl;
    entry.settled = true;
    return { loaded: true, src: objectUrl };
  };
  if (typeof globalThis.Worker === "function") {
    entry.promise = rescaleHomeLogoBlob(normalized, {
      width: target.width,
      height: target.height,
      timeoutMs: HERO_IMAGE_PRELOAD_TIMEOUT_MS
    })
      .then((resized) => {
        if (!resized) {
          throw new Error("logo rescale skipped");
        }
        return finishRescaledBlob(resized);
      })
      .catch(() => {
        entry.settled = true;
        return fallbackSource(normalized);
      });
    heroLogoRescaleCache.set(normalized, entry);
    trimHeroLogoRescaleCache();
    return entry.promise;
  }
  // A stalled addon CDN must not hold the logo blank forever: fall back to the
  // <img> path on the same budget as a hero image preload.
  const controller = typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), HERO_IMAGE_PRELOAD_TIMEOUT_MS) : 0;
  entry.promise = globalThis
    .fetch(normalized, { mode: "cors", credentials: "omit", signal: controller?.signal || undefined })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.blob();
    })
    .then(async (blob) => {
      if (blob.size > HERO_LOGO_MAX_BYTES) {
        throw new Error("logo too large");
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const dimensions = heroLogoDimensions(bytes);
      if (!dimensions) {
        throw new Error("unsupported logo");
      }
      if (dimensions.width <= target.width && dimensions.height <= target.height) {
        throw new Error("logo already small");
      }
      const bitmap = await globalThis.createImageBitmap(blob, {
        resizeWidth: Math.min(target.width, dimensions.width),
        resizeQuality: "medium",
        imageOrientation: "from-image"
      });
      try {
        // createImageBitmap keeps the aspect ratio when only the width is
        // given; the canvas then enforces the hero's height bound as Coil does.
        const scale = Math.min(target.width / bitmap.width, target.height / bitmap.height, 1);
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new globalThis.OffscreenCanvas(width, height);
        canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, width, height);
        const resized = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
        return finishRescaledBlob(resized);
      } finally {
        bitmap.close?.();
      }
    })
    .catch(() => {
      entry.settled = true;
      return fallbackSource(normalized);
    })
    .finally(() => clearTimeout(timeoutId));
  heroLogoRescaleCache.set(normalized, entry);
  trimHeroLogoRescaleCache();
  return entry.promise;
}

/** Drop every cached hero logo blob. Used when the Home DOM is discarded. */
export function resetHeroLogoRescaleCache() {
  heroLogoRescaleCache.forEach((entry) => {
    if (entry.objectUrl) {
      globalThis.URL?.revokeObjectURL?.(entry.objectUrl);
    }
  });
  heroLogoRescaleCache.clear();
}

export function preloadImageSource(src) {
  const normalized = String(src || "").trim();
  if (!normalized || typeof Image === "undefined") {
    return Promise.resolve(false);
  }
  const cached = heroImagePreloadCache.get(normalized);
  if (cached) {
    return cached;
  }
  if (heroImagePreloadCache.size >= HERO_IMAGE_PRELOAD_CACHE_LIMIT) {
    const oldestSource = heroImagePreloadCache.keys().next().value;
    heroImagePreloadCache.delete(oldestSource);
  }
  const preload = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const settleLoadedImage = () => {
      if (Number(image.naturalWidth || 0) <= 0) {
        finish(false);
        return;
      }
      if (typeof image.decode !== "function") {
        finish(true);
        return;
      }
      try {
        const decoded = image.decode();
        if (decoded && typeof decoded.then === "function") {
          decoded.then(() => finish(true)).catch(() => finish(false));
        } else {
          finish(true);
        }
      } catch (_) {
        // Some older WebKit/Chromium builds expose decode but cannot call it.
        finish(true);
      }
    };
    const finish = (loaded) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(Boolean(loaded));
    };
    // Older TV engines can leave image requests pending without load/error.
    const timeoutId = setTimeout(() => finish(false), HERO_IMAGE_PRELOAD_TIMEOUT_MS);
    image.onload = settleLoadedImage;
    image.onerror = () => finish(false);
    image.decoding = "async";
    image.src = normalized;
    if (image.complete) {
      settleLoadedImage();
    }
  });
  heroImagePreloadCache.set(normalized, preload);
  preload.then((loaded) => {
    if (!loaded) {
      // Let the immediate DOM swap reuse the settled failure before allowing retries.
      setTimeout(() => {
        if (heroImagePreloadCache.get(normalized) === preload) {
          heroImagePreloadCache.delete(normalized);
        }
      }, 0);
    }
  });
  return preload;
}

export function preloadHeroAssets(hero, layoutMode = "modern") {
  const display = layoutMode === "modern" ? buildModernHeroPresentation(hero) : buildHeroDisplayModel(hero, layoutMode);
  return Promise.all([preloadHeroBackdrop(display?.backdrop), preloadHeroLogo(display?.logo)]);
}

export function prepareHeroImageEnter(image, enterClass) {
  // A reused image is already opaque. Without an immediate reset, changing src
  // flashes the new artwork while CSS starts fading from 1 towards 0; the next
  // animation frame then reverses that fade instead of entering from 0.
  const transition = image.style.getPropertyValue("transition");
  const priority = image.style.getPropertyPriority("transition");
  image.style.setProperty("transition", "none", "important");
  image.classList.remove("is-visible");
  image.classList.add(enterClass);
  void image.offsetWidth;
  if (transition) {
    image.style.setProperty("transition", transition, priority);
  } else {
    image.style.removeProperty("transition");
  }
}
