import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import {
  libraryRepository,
  LibrarySourceMode
} from "../../../data/repository/libraryRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { ContinueWatchingPreferences } from "../../../data/local/continueWatchingPreferences.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { CollectionsStore, buildCollectionHomeKey } from "../../../data/local/collectionsStore.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AvatarRepository } from "../../../data/remote/supabase/avatarRepository.js";
import { Platform } from "../../../platform/index.js";
import { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { TMDB_API_KEY, YOUTUBE_PROXY_URL } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import {
  buildModernRowKey,
  MODERN_HOME_CONSTANTS,
  renderModernHomeLayout
} from "./modernHomeLayout.js";
import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogRequiresExtras
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
  CW_DISPLAY_SNAPSHOT_MAX_SCOPES,
  CW_ENRICHMENT_CACHE_KEY,
  CW_ENRICHMENT_CACHE_MAX_AGE_MS,
  CW_ENTER_DELAY_MS,
  CW_HOLD_DELAY_MS,
  CW_MAX_NEXT_UP_CONCURRENCY,
  CW_MAX_NEXT_UP_LOOKUPS,
  CW_MAX_VISIBLE_ITEMS,
  CW_META_TIMEOUT_MS,
  CW_META_TIMEOUT_TV_MS,
  CW_NEXT_UP_META_TIMEOUT_MS,
  CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS,
  CW_PROGRESS_END_THRESHOLD,
  CW_PROGRESS_START_THRESHOLD,
  HERO_ROTATE_FIRST_DELAY_MS,
  HERO_ROTATE_INTERVAL_MS,
  HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS,
  HOME_BACKGROUND_RENDER_DELAY_MS,
  HOME_INITIAL_CATALOG_LOAD,
  HOME_LAYOUT_SEQUENCE,
  HOME_LOADING_ROW_ITEMS_CONSTRAINED,
  HOME_LOADING_ROW_ITEMS_DEFAULT,
  HOME_LOADING_ROW_ITEMS_LEGACY_TV,
  HOME_MAX_ITEMS_PER_ROW_CONSTRAINED,
  HOME_MAX_ITEMS_PER_ROW_DEFAULT,
  HOME_MAX_ITEMS_PER_ROW_LEGACY_TV,
  HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS,
  HOME_PERF_DEBUG,
  HOME_RETURN_FOCUS_STATE_KEY,
  HOME_ROW_RETRY_TIMEOUT_MS,
  HOME_ROW_TIMEOUT_MS
} from "./homeConstants.js";
import { resolveNextUpCandidates } from "./nextUpCandidateResolver.js";
import {
  buildHeroBackdropSources,
  buildImageFallbackErrorHandler,
  encodeHeroBackdropFallbacks
} from "./homeImageHelpers.js";
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

export { escapeAttribute, escapeHtml, formatCatalogRowTitle } from "./homeUtils.js";

/** @typedef {import("./homeTypes.js").HomeMediaSourceLike} HomeMediaSourceLike */
/** @typedef {import("./homeTypes.js").HomeHeroDisplay} HomeHeroDisplay */

const MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS = 4000;
const CW_RELEASE_ALERT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

function homePerfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logHomePerf(stage, data = {}) {
  if (!HOME_PERF_DEBUG) {
    return;
  }
  try {
    console.info(`[home-perf] ${stage}`, data);
  } catch (_) {}
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function getDirectionFromKeyCode(keyCode) {
  switch (Number(keyCode || 0)) {
    case 37:
      return "left";
    case 38:
      return "up";
    case 39:
      return "right";
    case 40:
      return "down";
    default:
      return null;
  }
}

async function getLocalSidebarProfileState() {
  const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
  const profiles = await ProfileManager.getProfiles();
  const avatarCatalog = await AvatarRepository.getAvatarCatalog().catch(() => []);
  const activeProfile =
    profiles.find(
      (profile) => String(profile.id || profile.profileIndex || "1") === activeProfileId
    ) ||
    profiles[0] ||
    null;
  const name =
    String(activeProfile?.name || t("sidebar.profileFallback")).trim() ||
    t("sidebar.profileFallback");
  const avatarUrl =
    activeProfile?.avatarUrl ||
    AvatarRepository.getAvatarImageUrl(activeProfile?.avatarId, avatarCatalog);

  return {
    activeProfileName: name,
    activeProfileInitial: name ? name.charAt(0).toUpperCase() : "P",
    activeProfileColorHex: String(activeProfile?.avatarColorHex || "#1E88E5"),
    activeProfileAvatarUrl: String(avatarUrl || ""),
    showProfileSelector: Boolean(activeProfile)
  };
}

function renderHeroBackdropImage(display) {
  if (!display?.backdrop) {
    return '<div class="home-hero-backdrop placeholder"></div>';
  }
  const fallbackQueue = encodeHeroBackdropFallbacks(display.backdropFallbacks || []);
  const fallbackAttribute = fallbackQueue
    ? ` data-fallback-srcs="${escapeAttribute(fallbackQueue)}"`
    : "";
  return `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}"${fallbackAttribute} alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" onerror="${buildImageFallbackErrorHandler()}" />`;
}

export function buildModernHomeSizingStyle(layoutPrefs = {}) {
  const baseWidthDp = Math.max(72, Number(layoutPrefs?.posterCardWidthDp ?? 126) || 126);
  const radiusDp = Math.max(0, Number(layoutPrefs?.posterCardCornerRadiusDp ?? 12) || 12);
  const dpToPx = 2;
  const portraitWidth = Math.round(baseWidthDp * 0.84 * 1.08 * dpToPx);
  const portraitHeight = Math.round(baseWidthDp * 1.5 * 0.84 * 1.08 * dpToPx);
  const portraitExpandedWidth = Math.round(portraitHeight * (16 / 9));
  const landscapeWidth = Math.round(baseWidthDp * 1.24 * 1.34 * dpToPx);
  const landscapeHeight = Math.round(landscapeWidth / 1.77);
  const radius = Math.round(radiusDp * dpToPx);
  return [
    `--home-poster-width:${portraitWidth}px`,
    `--home-poster-height:${portraitHeight}px`,
    `--home-modern-portrait-poster-width:${portraitWidth}px`,
    `--home-modern-portrait-poster-height:${portraitHeight}px`,
    `--home-modern-portrait-expanded-width:${portraitExpandedWidth}px`,
    `--home-landscape-poster-width:${landscapeWidth}px`,
    `--home-landscape-poster-height:${landscapeHeight}px`,
    `--home-poster-expanded-width:${portraitExpandedWidth}px`,
    `--home-poster-radius:${radius}px`
  ].join(";");
}

function createCubicBezierEasing(x1, y1, x2, y2) {
  const newtonIterations = 4;
  const newtonMinSlope = 0.001;
  const subdivisionPrecision = 0.0000001;
  const subdivisionMaxIterations = 10;
  const splineTableSize = 11;
  const sampleStepSize = 1 / (splineTableSize - 1);

  const calcBezier = (t, a1, a2) =>
    (((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t + 3 * a1) * t;
  const getSlope = (t, a1, a2) =>
    3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
  const sampleValues = new Float32Array(splineTableSize);

  for (let index = 0; index < splineTableSize; index += 1) {
    sampleValues[index] = calcBezier(index * sampleStepSize, x1, x2);
  }

  const binarySubdivide = (x, lower, upper) => {
    let current = 0;
    let currentX = 0;
    let iteration = 0;
    do {
      current = lower + (upper - lower) / 2;
      currentX = calcBezier(current, x1, x2) - x;
      if (currentX > 0) {
        upper = current;
      } else {
        lower = current;
      }
      iteration += 1;
    } while (Math.abs(currentX) > subdivisionPrecision && iteration < subdivisionMaxIterations);
    return current;
  };

  const newtonRaphsonIterate = (x, guess) => {
    let currentGuess = guess;
    for (let index = 0; index < newtonIterations; index += 1) {
      const currentSlope = getSlope(currentGuess, x1, x2);
      if (currentSlope === 0) {
        return currentGuess;
      }
      const currentX = calcBezier(currentGuess, x1, x2) - x;
      currentGuess -= currentX / currentSlope;
    }
    return currentGuess;
  };

  const getTForX = (x) => {
    let intervalStart = 0;
    let currentSample = 1;
    const lastSample = splineTableSize - 1;

    while (currentSample !== lastSample && sampleValues[currentSample] <= x) {
      intervalStart += sampleStepSize;
      currentSample += 1;
    }
    currentSample -= 1;

    const denominator = sampleValues[currentSample + 1] - sampleValues[currentSample];
    const dist = denominator === 0 ? 0 : (x - sampleValues[currentSample]) / denominator;
    const guess = intervalStart + dist * sampleStepSize;
    const initialSlope = getSlope(guess, x1, x2);

    if (initialSlope >= newtonMinSlope) {
      return newtonRaphsonIterate(x, guess);
    }
    if (initialSlope === 0) {
      return guess;
    }
    return binarySubdivide(x, intervalStart, intervalStart + sampleStepSize);
  };

  return (x) => {
    if (x <= 0) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    return calcBezier(getTForX(x), y1, y2);
  };
}

const MODERN_CAMERA_PAN_EASING = createCubicBezierEasing(0.43, 0.7, 0.45, 1.0);

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id || item?.contentId || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function renderHomeLoadingState() {
  return `
    <div class="home-loading-state" aria-label="Loading">
      ${renderLoadingIndicator({ className: "home-loading-spinner" })}
    </div>
  `;
}

function resolveImdbRating(item) {
  const direct =
    item?.imdbRating ?? item?.episodeImdbRating ?? item?.imdb_rating ?? item?.rating ?? null;
  if (direct == null || direct === "") {
    return null;
  }
  const value = Number(direct);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value.toFixed(1);
}

function extractYear(item) {
  const candidates = [
    item?.releaseInfo,
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.year
  ];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }
  return "";
}

/**
 * For movies: returns "Month DD, YYYY" (e.g. "April 24, 2026") from any ISO date field.
 * For non-movies: falls back to extractYear().
 * Matches ATV ModernHomeModels.kt extractYearText(type=Movie, released=ISO) behaviour.
 */
function extractReleaseDateText(item) {
  const type = String(item?.type || item?.apiType || "").toLowerCase();
  if (type === "movie") {
    const candidates = [item?.released, item?.releaseDate, item?.release_date, item?.releaseInfo];
    for (const candidate of candidates) {
      const str = String(candidate || "");
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleDateString("en-US", {
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

function formatRuntimeText(item) {
  const value = parseRuntimeMinutes(
    item?.runtimeMinutes ?? item?.runtime ?? item?.durationMinutes ?? item?.duration_minutes ?? 0
  );
  return formatDurationMinutes(value);
}

function shouldEnrichModernHero(hero) {
  if (
    !hero ||
    hero.heroSource === "continueWatching" ||
    hero.heroSource === "collection" ||
    hero.heroMetaEnriched
  ) {
    return false;
  }
  const settings = TmdbSettingsStore.get();
  return Boolean(settings.enabled && settings.modernHomeEnabled);
}

const HERO_IMAGE_PRELOAD_CACHE_LIMIT = 32;
const HERO_IMAGE_PRELOAD_TIMEOUT_MS = 1500;
const heroImagePreloadCache = new Map();

function preloadImageSource(src) {
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
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.decoding = "async";
    image.src = normalized;
    if (image.complete) {
      finish(Number(image.naturalWidth || 0) > 0);
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

function animateModernHeroBackdropSwap(backdrop, nextSrc, nextAlt = "") {
  if (!(backdrop instanceof HTMLImageElement)) {
    return;
  }

  const normalizedSrc = String(nextSrc || "").trim();
  const normalizedAlt = String(nextAlt || "featured").trim() || "featured";
  const currentSrc = String(backdrop.getAttribute("src") || "").trim();
  const token = Number(backdrop.heroBackdropTransitionToken || 0) + 1;
  backdrop.heroBackdropTransitionToken = token;

  const clearGhosts = () => {
    backdrop.parentElement
      ?.querySelectorAll?.(".home-hero-backdrop-transition-ghost")
      ?.forEach((node) => node.remove());
  };

  const finalize = () => {
    if (Number(backdrop.heroBackdropTransitionToken || 0) !== token) {
      return;
    }
    backdrop.classList.remove("home-hero-backdrop-transition-enter", "is-visible");
    clearGhosts();
  };

  if (!normalizedSrc) {
    finalize();
    backdrop.removeAttribute("src");
    backdrop.setAttribute("alt", normalizedAlt);
    backdrop.classList.add("placeholder");
    return;
  }

  if (currentSrc === normalizedSrc) {
    backdrop.setAttribute("alt", normalizedAlt);
    backdrop.classList.remove("placeholder");
    return;
  }

  preloadImageSource(normalizedSrc).then((loaded) => {
    if (Number(backdrop.heroBackdropTransitionToken || 0) !== token) {
      return;
    }

    if (!loaded) {
      finalize();
      backdrop.setAttribute("src", normalizedSrc);
      backdrop.setAttribute("alt", normalizedAlt);
      backdrop.classList.remove("placeholder");
      return;
    }

    clearGhosts();
    const parent = backdrop.parentElement;
    let ghost = null;
    if (parent && currentSrc) {
      ghost = backdrop.cloneNode(false);
      ghost.classList.add("home-hero-backdrop-transition-ghost");
      parent.insertBefore(ghost, backdrop);
    }

    backdrop.classList.add("home-hero-backdrop-transition-enter");
    backdrop.classList.remove("placeholder");
    backdrop.setAttribute("src", normalizedSrc);
    backdrop.setAttribute("alt", normalizedAlt);

    requestAnimationFrame(() => {
      if (Number(backdrop.heroBackdropTransitionToken || 0) !== token) {
        return;
      }
      requestAnimationFrame(() => {
        if (Number(backdrop.heroBackdropTransitionToken || 0) !== token) {
          return;
        }
        backdrop.classList.add("is-visible");
        ghost?.classList?.add("is-fading-out");
        setTimeout(() => {
          finalize();
        }, HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS);
      });
    });
  });
}

function animateModernHeroLogoSwap(logoNode, nextSrc, nextAlt = "") {
  if (!(logoNode instanceof HTMLImageElement)) {
    return;
  }

  const normalizedSrc = String(nextSrc || "").trim();
  const normalizedAlt = String(nextAlt || "logo").trim() || "logo";
  const currentSrc = String(logoNode.getAttribute("src") || "").trim();
  const token = Number(logoNode.heroLogoTransitionToken || 0) + 1;
  logoNode.heroLogoTransitionToken = token;

  const clearGhosts = () => {
    logoNode.parentElement
      ?.querySelectorAll?.(".home-hero-logo-transition-ghost")
      ?.forEach((node) => node.remove());
  };

  const finalize = () => {
    if (Number(logoNode.heroLogoTransitionToken || 0) !== token) {
      return;
    }
    logoNode.classList.remove("home-hero-logo-transition-enter", "is-visible");
    clearGhosts();
  };

  if (!normalizedSrc) {
    finalize();
    logoNode.remove();
    return;
  }

  if (currentSrc === normalizedSrc) {
    logoNode.setAttribute("alt", normalizedAlt);
    return;
  }

  preloadImageSource(normalizedSrc).then((loaded) => {
    if (Number(logoNode.heroLogoTransitionToken || 0) !== token) {
      return;
    }

    if (!loaded) {
      finalize();
      logoNode.setAttribute("src", normalizedSrc);
      logoNode.setAttribute("alt", normalizedAlt);
      return;
    }

    clearGhosts();
    const parent = logoNode.parentElement;
    let ghost = null;
    if (parent && currentSrc) {
      ghost = logoNode.cloneNode(false);
      ghost.classList.add("home-hero-logo-transition-ghost");
      parent.insertBefore(ghost, logoNode);
    }

    logoNode.classList.add("home-hero-logo-transition-enter");
    logoNode.setAttribute("src", normalizedSrc);
    logoNode.setAttribute("alt", normalizedAlt);

    requestAnimationFrame(() => {
      if (Number(logoNode.heroLogoTransitionToken || 0) !== token) {
        return;
      }
      requestAnimationFrame(() => {
        if (Number(logoNode.heroLogoTransitionToken || 0) !== token) {
          return;
        }
        logoNode.classList.add("is-visible");
        ghost?.classList?.add("is-fading-out");
        setTimeout(() => {
          finalize();
        }, HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS);
      });
    });
  });
}

function parseRuntimeMinutes(value) {
  if (value == null || value === "") {
    return 0;
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 0) {
    return numberValue;
  }
  const text = String(value).toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+)\s*(?:m|min)/);
  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return Math.round(hours * 60 + minutes);
  }
  const leading = text.match(/^(\d+)/);
  return leading ? Number(leading[1]) : 0;
}

function formatDurationMinutes(totalMinutes) {
  const minutesValue = Number(totalMinutes || 0);
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
    return "";
  }
  const roundedMinutes = Math.max(0, Math.round(minutesValue));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function normalizeCollectionPosterShape(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "POSTER") {
    return "POSTER";
  }
  if (normalized === "LANDSCAPE" || normalized === "WIDE") {
    return "LANDSCAPE";
  }
  return "SQUARE";
}

function normalizeAnimatedCollectionAssetUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (/\.gifv(?:$|[?#])/i.test(normalized)) {
    return normalized.replace(/\.gifv(?=($|[?#]))/i, ".gif");
  }
  return normalized;
}

function isCollectionFolderItem(item = {}) {
  return (
    String(item?.heroSource || "").toLowerCase() === "collection" ||
    String(item?.type || item?.apiType || "").toLowerCase() === "collection_folder" ||
    Boolean(item?.collectionId && item?.folderId)
  );
}

export function normalizeCollectionFolderItem(item, collectionMeta = null) {
  if (!item) {
    return null;
  }
  const collectionId = firstNonEmpty(item.collectionId, collectionMeta?.id);
  const folderId = firstNonEmpty(item.folderId, item.id);
  const title = firstNonEmpty(
    item.rawTitle,
    item.folderTitle,
    item.title,
    item.name,
    item.heroTitle
  );
  if (!collectionId || !folderId || !title) {
    return null;
  }
  const collectionTitle = firstNonEmpty(item.collectionTitle, collectionMeta?.title);
  const coverImageUrl = firstNonEmpty(item.coverImageUrl, item.coverImage);
  const focusGifUrl = normalizeAnimatedCollectionAssetUrl(firstNonEmpty(item.focusGifUrl));
  const focusGifEnabled = item.focusGifEnabled !== false;
  const hideTitle = Boolean(item.hideTitle);
  const tileShape = normalizeCollectionPosterShape(item.tileShape || item.posterShape);
  const coverEmoji = firstNonEmpty(item.coverEmoji);
  const cardImage = focusGifEnabled
    ? firstNonEmpty(coverImageUrl, collectionMeta?.backdropImageUrl)
    : firstNonEmpty(focusGifUrl, coverImageUrl, collectionMeta?.backdropImageUrl);
  const heroBackdrop = firstNonEmpty(
    item.heroBackdropUrl,
    coverImageUrl,
    collectionMeta?.backdropImageUrl
  );
  return {
    ...item,
    id: `collection:${collectionId}:${folderId}`,
    type: "collection_folder",
    apiType: "collection_folder",
    heroSource: "collection",
    rawTitle: title,
    name: hideTitle ? "" : title,
    title: hideTitle ? "" : title,
    heroTitle: hideTitle ? "" : coverEmoji ? `${coverEmoji}  ${title}` : title,
    subtitle: hideTitle ? "" : collectionTitle,
    poster: cardImage,
    background: heroBackdrop,
    backdrop: heroBackdrop,
    landscapePoster: heroBackdrop,
    logo: firstNonEmpty(item.titleLogoUrl),
    description: "",
    genres: [],
    collectionId,
    collectionTitle,
    folderId,
    coverImageUrl,
    focusGifUrl,
    focusGifEnabled,
    coverEmoji,
    tileShape,
    hideTitle,
    heroBackdropUrl: firstNonEmpty(item.heroBackdropUrl),
    heroVideoUrl: firstNonEmpty(item.heroVideoUrl),
    titleLogoUrl: firstNonEmpty(item.titleLogoUrl)
  };
}

function buildCollectionHomeRow(collection = {}) {
  const rowKey = buildCollectionHomeKey(collection);
  return {
    rowKind: "collection",
    collectionId: collection.id,
    collectionTitle: collection.title,
    collection,
    type: "collection_folder",
    homeCatalogKey: rowKey,
    homeCatalogDisableKey: rowKey,
    pinToTop: Boolean(collection.pinToTop),
    focusGlowEnabled: collection.focusGlowEnabled !== false,
    viewMode: String(collection.viewMode || "TABBED_GRID"),
    showAllTab: collection.showAllTab !== false,
    result: {
      status: "success",
      data: {
        items: (Array.isArray(collection.folders) ? collection.folders : [])
          .map((folder) =>
            normalizeCollectionFolderItem(
              {
                ...folder,
                collectionId: collection.id,
                collectionTitle: collection.title
              },
              collection
            )
          )
          .filter(Boolean)
      }
    }
  };
}

function normalizeHomeRowItem(row = null, item = null) {
  if (!row || !item) {
    return null;
  }
  if (row.rowKind === "collection") {
    return normalizeCollectionFolderItem(
      item,
      row.collection || {
        id: row.collectionId,
        title: row.collectionTitle
      }
    );
  }
  return normalizeCatalogItem(item, row.type || "movie");
}

function formatEpisodeCode(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (
    season != null &&
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 0 &&
    Number.isFinite(episodeNumber) &&
    episodeNumber > 0
  ) {
    return `S${seasonNumber} E${episodeNumber}`;
  }
  if (Number.isFinite(episodeNumber) && episodeNumber > 0) {
    return `E${episodeNumber}`;
  }
  return "";
}

function resolveYoutubeId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const directMatch = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function buildYoutubeEmbedUrl(videoId, { muted = true } = {}) {
  const cleanId = resolveYoutubeId(videoId);
  if (!cleanId) {
    return "";
  }
  const proxyBase = String(YOUTUBE_PROXY_URL || "").trim();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", "1");
      proxyUrl.searchParams.set("playlist", cleanId);
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  if (typeof globalThis?.document === "undefined") {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    cc_load_policy: "0",
    iv_load_policy: "3"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube.com/embed/${cleanId}?${params.toString()}`;
}

function resolveTrailerSource(meta = {}) {
  const trailerCandidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.videos) ? meta.videos : [])
  ];
  for (const entry of trailerCandidates) {
    const ytId = resolveYoutubeId(
      entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || ""
    );
    if (ytId) {
      const embedUrl = buildYoutubeEmbedUrl(ytId);
      if (!embedUrl) {
        continue;
      }
      return {
        kind: "youtube",
        ytId,
        embedUrl
      };
    }
  }
  const fallbackId = resolveYoutubeId(
    Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : ""
  );
  if (!fallbackId) {
    return null;
  }
  const fallbackEmbedUrl = buildYoutubeEmbedUrl(fallbackId);
  if (!fallbackEmbedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId: fallbackId,
    embedUrl: fallbackEmbedUrl
  };
}

function applyTrailerAudioPreferences(source, prefs = {}) {
  if (!source) {
    return null;
  }
  const muted = Boolean(prefs.focusedPosterBackdropTrailerMuted);
  if (source.kind === "youtube") {
    const embedUrl = buildYoutubeEmbedUrl(source.ytId, { muted });
    if (!embedUrl) {
      return null;
    }
    return {
      ...source,
      embedUrl,
      muted
    };
  }
  if (source.kind === "video") {
    return {
      ...source,
      muted
    };
  }
  return source;
}

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function resolveTrailerMetaWithTmdbFallback(meta = {}, itemType = "movie") {
  const fallbackSource = resolveTrailerSource(meta);
  if (fallbackSource) {
    return fallbackSource;
  }
  const settings = TmdbSettingsStore.get();
  if (!settings.enabled || !settings.useTrailers || !TMDB_API_KEY) {
    return fallbackSource;
  }
  try {
    const tmdbId = await withTimeout(TmdbService.ensureTmdbId(meta?.id, itemType), 1800, null);
    if (!tmdbId) {
      return null;
    }
    const enrichment = await withTimeout(
      TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: itemType,
        language: settings.language
      }),
      2200,
      null
    );
    if (!enrichment) {
      return fallbackSource;
    }
    const mergedMeta = {
      ...meta,
      trailers:
        Array.isArray(meta?.trailers) && meta.trailers.length
          ? meta.trailers
          : Array.isArray(enrichment?.trailers)
            ? enrichment.trailers
            : [],
      trailerYtIds:
        Array.isArray(meta?.trailerYtIds) && meta.trailerYtIds.length
          ? meta.trailerYtIds
          : Array.isArray(enrichment?.trailerYtIds)
            ? enrichment.trailerYtIds
            : []
    };
    const enrichedFallbackSource = resolveTrailerSource(mergedMeta);
    return enrichedFallbackSource || fallbackSource;
  } catch (_) {
    return fallbackSource;
  }
}

function getContinueWatchingMetaTimeout(timeoutMs) {
  const requestedTimeout = Math.max(500, Number(timeoutMs || 0) || CW_META_TIMEOUT_MS);
  if (Platform.isWebOS() || Platform.isTizen()) {
    return Math.max(requestedTimeout, CW_META_TIMEOUT_TV_MS);
  }
  return requestedTimeout;
}

function progressFractionForContinueWatching(item = {}) {
  const explicitPercent = Number(item.progressPercent);
  if (Number.isFinite(explicitPercent) && explicitPercent > 0) {
    return Math.max(0, Math.min(1, explicitPercent / 100));
  }
  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(positionMs) ||
    positionMs <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.min(1, positionMs / durationMs));
}

function isSeriesTypeForContinueWatching(type) {
  const normalized = String(type || "").toLowerCase();
  return ["series", "tv", "anime"].includes(normalized);
}

function isPosterWatchedType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "movie" || isSeriesTypeForContinueWatching(normalized);
}

function isCompletedForContinueWatching(item = {}) {
  return progressFractionForContinueWatching(item) >= CW_PROGRESS_END_THRESHOLD;
}

function isInProgressForContinueWatching(item = {}) {
  const fraction = progressFractionForContinueWatching(item);
  return fraction >= CW_PROGRESS_START_THRESHOLD && fraction < CW_PROGRESS_END_THRESHOLD;
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgressForContinueWatching(item)) {
    return true;
  }
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  const hasStartedPlayback =
    Number(item.positionMs || 0) > 0 || Number(item.progressPercent || 0) > 0;
  const source = String(item.source || "").toLowerCase();
  return hasStartedPlayback && source !== "trakt_history" && source !== "trakt_show_progress";
}

function episodeKey(season, episode) {
  return `${Number(season || 0)}:${Number(episode || 0)}`;
}

function episodeSortKey(season, episode) {
  return Number(season || 0) * 1000 + Number(episode || 0);
}

function normalizeEpisodeEntry(video = {}) {
  return {
    id: String(video?.id || "").trim(),
    season: Number(video?.season ?? video?.seasonNumber ?? 0),
    episode: Number(video?.episode ?? video?.episodeNumber ?? 0),
    title: String(video?.title || video?.name || "").trim(),
    thumbnail: firstNonEmpty(
      video?.thumbnail,
      video?.thumbnailUrl,
      video?.still,
      video?.stillUrl,
      video?.image,
      video?.poster
    ),
    overview: firstNonEmpty(video?.overview, video?.description),
    released: firstNonEmpty(video?.released, video?.releaseInfo),
    runtimeMinutes: parseRuntimeMinutes(video?.runtimeMinutes ?? video?.runtime ?? 0)
  };
}

function normalizeEpisodeEntries(videos = []) {
  return (Array.isArray(videos) ? videos : [])
    .map((video) => normalizeEpisodeEntry(video))
    .filter((entry) => entry.season > 0 && entry.episode > 0)
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

function findEpisodeEntry(videos = [], season = null, episode = null) {
  const targetSeason = Number(season);
  const targetEpisode = Number(episode || 0);
  if (season == null || !Number.isFinite(targetSeason) || targetSeason < 0 || targetEpisode <= 0) {
    return null;
  }
  return (
    (Array.isArray(videos) ? videos : [])
      .filter((video) => video?.season != null || video?.seasonNumber != null)
      .map((video) => normalizeEpisodeEntry(video))
      .find((entry) => entry.season === targetSeason && entry.episode === targetEpisode) || null
  );
}

function hasEpisodeAiredForContinueWatching(released) {
  const parsedTime = parseEpisodeReleaseDateForContinueWatching(released);
  return parsedTime == null || parsedTime <= Date.now();
}

function parseEpisodeReleaseDateForContinueWatching(released) {
  const raw = String(released || "").trim();
  if (!raw) {
    return null;
  }
  const exactTime = Date.parse(raw);
  if (Number.isFinite(exactTime)) {
    return exactTime;
  }
  const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const parsedTime = datePortion ? Date.parse(datePortion) : NaN;
  return Number.isFinite(parsedTime) ? parsedTime : null;
}

function resolveNextUpReleaseState(item = {}) {
  const releaseTimestamp = parseEpisodeReleaseDateForContinueWatching(
    firstNonEmpty(item?.released, item?.releaseInfo)
  );
  const seedUpdatedAt = Number(item?.seedUpdatedAt ?? item?.updatedAt ?? 0) || 0;
  const hasAired =
    releaseTimestamp == null ? item?.hasAired !== false : releaseTimestamp <= Date.now();
  const isReleaseAlert = Boolean(
    hasAired &&
    releaseTimestamp != null &&
    releaseTimestamp > seedUpdatedAt &&
    Date.now() - releaseTimestamp < CW_RELEASE_ALERT_MAX_AGE_MS
  );
  const seedSeason = Number(item?.seedSeason || 0);
  const nextSeason = Number(item?.season || 0);

  return {
    hasAired,
    releaseTimestamp,
    isReleaseAlert,
    isNewSeasonRelease: Boolean(
      isReleaseAlert && seedSeason > 0 && nextSeason > 0 && nextSeason !== seedSeason
    ),
    sortTimestamp: isReleaseAlert ? releaseTimestamp : seedUpdatedAt
  };
}

function parseEpisodeReleaseCalendarDateForContinueWatching(released) {
  const raw = String(released || "").trim();
  if (!raw) {
    return null;
  }
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return new Date(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]) - 1,
      Number(dateOnlyMatch[3])
    );
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const embeddedDate = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return embeddedDate
    ? new Date(Number(embeddedDate[1]), Number(embeddedDate[2]) - 1, Number(embeddedDate[3]))
    : null;
}

function continueWatchingCalendarDayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * 60 * 1000)
  );
}

function buildNextUpAirDateStatus(item = {}) {
  const releaseValue = firstNonEmpty(item?.released, item?.releaseInfo);
  const releaseDate = parseEpisodeReleaseCalendarDateForContinueWatching(releaseValue);
  if (!releaseDate || Number.isNaN(releaseDate.getTime())) {
    return "";
  }
  const daysUntil =
    continueWatchingCalendarDayNumber(releaseDate) - continueWatchingCalendarDayNumber(new Date());
  if (daysUntil < 0) {
    return "";
  }
  if (daysUntil === 0) {
    return t("cw_airs_today", {}, "Airs Today");
  }
  if (daysUntil === 1) {
    return t("cw_airs_tomorrow", {}, "Airs Tomorrow");
  }
  if (daysUntil <= 7) {
    return t("cw_airs_in_days", [daysUntil], "Airs in %1$d Days");
  }
  let dateLabel = "";
  try {
    dateLabel = releaseDate.toLocaleDateString(I18n.getLocale(), {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  } catch (_) {
    dateLabel = String(releaseValue || "").match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
  }
  return dateLabel ? t("cw_airs_date", [dateLabel], "Airs %1$s") : "";
}

function continueWatchingSortTimestamp(item = {}) {
  return Number(item?.sortTimestamp || item?.updatedAt || item?.watchedAt || 0);
}

function nextUpReleaseTimestamp(item = {}) {
  return parseEpisodeReleaseDateForContinueWatching(
    firstNonEmpty(item?.released, item?.releaseInfo)
  );
}

function sortContinueWatchingItemsForDisplay(items = [], mode = "default") {
  const normalizedMode = String(mode || "default")
    .trim()
    .toLowerCase();
  if (normalizedMode !== "streaming_style") {
    return [...items].sort(
      (left, right) => continueWatchingSortTimestamp(right) - continueWatchingSortTimestamp(left)
    );
  }

  const released = [];
  const unreleased = [];
  (items || []).forEach((item) => {
    if (!item?.isNextUp || item?.hasAired !== false) {
      released.push(item);
    } else {
      unreleased.push(item);
    }
  });

  released.sort(
    (left, right) => continueWatchingSortTimestamp(right) - continueWatchingSortTimestamp(left)
  );
  unreleased.sort((left, right) => {
    const leftTime = nextUpReleaseTimestamp(left);
    const rightTime = nextUpReleaseTimestamp(right);
    if (leftTime == null && rightTime == null) {
      return 0;
    }
    if (leftTime == null) {
      return 1;
    }
    if (rightTime == null) {
      return -1;
    }
    return leftTime - rightTime;
  });

  return [...released, ...unreleased];
}

function shouldShowNextUpEpisodeForContinueWatching(
  candidate = {},
  anchorSeason = null,
  showUnairedNextUp = true
) {
  const candidateSeason = Number(candidate?.season || 0);
  const seedSeason = Number(anchorSeason || 0);
  const isSeasonRollover = seedSeason > 0 && candidateSeason > 0 && candidateSeason !== seedSeason;
  const releaseTime = parseEpisodeReleaseDateForContinueWatching(candidate?.released);
  if (isSeasonRollover && releaseTime == null) {
    return false;
  }
  if (releaseTime == null || releaseTime <= Date.now()) {
    return true;
  }
  if (!showUnairedNextUp) {
    return false;
  }
  if (!isSeasonRollover) {
    return true;
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const daysUntil = Math.floor((releaseTime - todayStart.getTime()) / (24 * 60 * 60 * 1000));
  return daysUntil <= CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS;
}

function buildProgressStatus(item) {
  if (item?.isNextUp) {
    if (item?.isReleaseAlert) {
      return item?.isNewSeasonRelease
        ? t("cw_new_season", {}, "New Season")
        : t("cw_new_episode", {}, "New Episode");
    }
    if (item?.hasAired === false) {
      return buildNextUpAirDateStatus(item) || t("cw_upcoming", {}, "Upcoming");
    }
    return t("home.continueStatusNextUp", {}, "Next Up");
  }
  const durationMs = continueWatchingDurationMs(item);
  const rawPositionMs = Number(item?.positionMs || 0);
  const progressPercent = Number(item?.progressPercent);
  const positionMs =
    rawPositionMs > 0
      ? rawPositionMs
      : durationMs > 0 && Number.isFinite(progressPercent)
        ? (durationMs * Math.max(0, Math.min(100, progressPercent))) / 100
        : 0;
  if (!durationMs || !positionMs) {
    if (Number.isFinite(progressPercent) && progressPercent > 0) {
      const percent = Math.max(1, Math.min(99, Math.round(progressPercent)));
      return t("home.continueStatusWatchedPercent", { percent }, "{{percent}}% watched");
    }
    return t("home.continueStatusContinue", {}, "Continue");
  }
  const effectivePositionMs = Math.max(0, Math.min(durationMs, positionMs));
  const remainingMinutes = Math.max(
    1,
    Math.floor(Math.max(0, durationMs - effectivePositionMs) / 60000)
  );
  if (remainingMinutes < 60) {
    return t("home.timeLeft", { minutes: remainingMinutes }, "{{minutes}}m left");
  }
  const remainingLabel = formatDurationMinutes(remainingMinutes);
  return t("home.timeLeftDuration", { time: remainingLabel }, "{{time}} left");
}

function continueWatchingDurationMs(item = {}) {
  const explicitDurationMs = Number(item?.durationMs || 0);
  if (Number.isFinite(explicitDurationMs) && explicitDurationMs > 0) {
    return Math.trunc(explicitDurationMs);
  }
  const runtimeMinutes = parseRuntimeMinutes(
    item?.runtimeMinutes ?? item?.runtime ?? item?.durationMinutes ?? item?.duration_minutes ?? 0
  );
  return runtimeMinutes > 0 ? Math.round(runtimeMinutes * 60000) : 0;
}

function buildProgressFraction(item) {
  if (item?.isNextUp) {
    return 0;
  }
  return progressFractionForContinueWatching(item);
}

function buildCatalogLoadingItems(rowKey, count = HOME_LOADING_ROW_ITEMS_DEFAULT) {
  const safeCount = Math.max(
    1,
    Math.min(HOME_MAX_ITEMS_PER_ROW_DEFAULT, Number(count || HOME_LOADING_ROW_ITEMS_DEFAULT))
  );
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `${rowKey || "row"}__loading_${index}`,
    name: t("common.loading", {}, "Loading"),
    isLoading: true
  }));
}

function normalizeCatalogItem(item, fallbackType = "movie") {
  if (!item) {
    return null;
  }
  return {
    ...item,
    id: String(item.id || "").trim(),
    type: String(item.type || item.apiType || fallbackType || "movie").trim() || "movie",
    apiType: String(item.apiType || item.type || fallbackType || "movie").trim() || "movie",
    name: firstNonEmpty(item.name, item.title, prettyId(item.id)),
    landscapePoster: firstNonEmpty(
      item.landscapePoster,
      item.backdrop,
      item.backdropUrl,
      item.background
    ),
    poster: firstNonEmpty(item.poster, item.backdrop, item.backdropUrl, item.thumbnail),
    background: firstNonEmpty(
      item.background,
      item.backdrop,
      item.backdropUrl,
      item.poster,
      item.thumbnail
    ),
    logo: firstNonEmpty(item.logo),
    description: firstNonEmpty(item.description, item.overview, item.plot),
    releaseInfo: firstNonEmpty(item.releaseInfo, item.released),
    genres: Array.isArray(item.genres) ? item.genres.filter(Boolean) : [],
    runtimeMinutes: parseRuntimeMinutes(item.runtimeMinutes ?? item.runtime ?? 0),
    imdbRating: resolveImdbRating(item),
    ageRating: firstNonEmpty(item.ageRating, item.age_rating),
    status: firstNonEmpty(item.status),
    language: firstNonEmpty(item.language),
    country: firstNonEmpty(item.country)
  };
}

function normalizeContinueWatchingItem(item) {
  if (!item) {
    return null;
  }
  const title = firstNonEmpty(item.title, item.name, prettyId(item.contentId));
  const type = String(item.contentType || item.type || "movie").trim() || "movie";
  const isSeries = isSeriesTypeForContinueWatching(type);
  const releaseState = item?.isNextUp ? resolveNextUpReleaseState(item) : null;
  const resolvedItem = releaseState ? { ...item, ...releaseState } : item;
  return {
    ...resolvedItem,
    heroSource: "continueWatching",
    id: String(item.contentId || item.id || "").trim(),
    contentId: String(item.contentId || item.id || "").trim(),
    videoId: item.videoId || null,
    season: Number.isFinite(Number(item.season)) ? Number(item.season) : null,
    episode: Number.isFinite(Number(item.episode)) ? Number(item.episode) : null,
    positionMs: Number(item.positionMs || 0) || 0,
    durationMs: continueWatchingDurationMs(item),
    type,
    apiType: type,
    name: title,
    title,
    landscapePoster: firstNonEmpty(
      item.landscapePoster,
      item.thumbnail,
      item.backdrop,
      item.background,
      item.poster
    ),
    thumbnail: firstNonEmpty(
      item.thumbnail,
      item.episodeThumbnail,
      item.poster,
      item.backdrop,
      item.background
    ),
    backdrop: firstNonEmpty(
      item.backdrop,
      item.background,
      item.thumbnail,
      item.poster,
      item.episodeThumbnail
    ),
    episodeThumbnail: firstNonEmpty(
      item.episodeThumbnail,
      item.thumbnail,
      item.backdrop,
      item.background,
      item.poster
    ),
    poster: isSeries
      ? firstNonEmpty(
          item.poster,
          item.episodeThumbnail,
          item.thumbnail,
          item.backdrop,
          item.background
        )
      : firstNonEmpty(
          item.poster,
          item.backdrop,
          item.background,
          item.thumbnail,
          item.episodeThumbnail
        ),
    background: isSeries
      ? firstNonEmpty(
          item.background,
          item.backdrop,
          item.poster,
          item.episodeThumbnail,
          item.thumbnail
        )
      : firstNonEmpty(
          item.background,
          item.backdrop,
          item.poster,
          item.thumbnail,
          item.episodeThumbnail
        ),
    logo: firstNonEmpty(item.logo),
    description: firstNonEmpty(item.description),
    episodeDescription: firstNonEmpty(item.episodeDescription, item.episode_description),
    releaseInfo: firstNonEmpty(item.releaseInfo),
    genres: Array.isArray(item.genres) ? item.genres.filter(Boolean) : [],
    runtimeMinutes: Number(item.runtimeMinutes ?? item.runtime ?? 0) || 0,
    imdbRating: resolveImdbRating(item),
    ageRating: firstNonEmpty(item.ageRating, item.age_rating),
    status: firstNonEmpty(item.status),
    language: firstNonEmpty(item.language),
    country: firstNonEmpty(item.country),
    progressStatus: buildProgressStatus(resolvedItem),
    progressFraction: buildProgressFraction(resolvedItem),
    episodeCode: isSeries ? formatEpisodeCode(item.season, item.episode) : "",
    episodeTitle: isSeries ? firstNonEmpty(item.episodeTitle, item.subtitle) : ""
  };
}

function isRawContinueWatchingTitle(item) {
  const contentId = String(item?.contentId || item?.id || "").trim();
  const title = firstNonEmpty(item?.title, item?.name);
  return Boolean(title) && Boolean(contentId) && title === prettyId(contentId);
}

function hasContinueWatchingArtwork(item) {
  return Boolean(
    firstNonEmpty(
      item?.poster,
      item?.background,
      item?.backdrop,
      item?.backdropUrl,
      item?.thumbnail,
      item?.episodeThumbnail,
      item?.logo
    )
  );
}

function isPresentableContinueWatchingItem(item, { requireArtwork = false } = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized) {
    return false;
  }
  const hasMeaningfulTitle =
    Boolean(firstNonEmpty(normalized.title, normalized.name)) &&
    !isRawContinueWatchingTitle(normalized);
  const hasArtwork = hasContinueWatchingArtwork(normalized);
  return requireArtwork ? hasMeaningfulTitle && hasArtwork : hasMeaningfulTitle || hasArtwork;
}

function buildVisibleContinueWatchingItems(items = [], options = {}) {
  return (items || [])
    .map((item) => normalizeContinueWatchingItem(item))
    .filter((item) => isPresentableContinueWatchingItem(item, options));
}

function buildCompleteContinueWatchingDisplay(items = []) {
  return (items || [])
    .map((item) => normalizeContinueWatchingItem(item))
    .filter((item) => item?.contentId);
}

function hasContinueWatchingHeroMetadata(item = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized) {
    return false;
  }
  const hasDescription = Boolean(
    firstNonEmpty(normalized.description, normalized.episodeDescription)
  );
  const hasDetails = Boolean(
    resolveImdbRating(normalized) ||
    normalized.genres?.length ||
    firstNonEmpty(
      normalized.releaseInfo,
      normalized.ageRating,
      normalized.status,
      normalized.language,
      normalized.country
    ) ||
    Number(normalized.runtimeMinutes || 0) > 0
  );
  return hasDescription && hasDetails;
}

function needsContinueWatchingMetadataRefresh(items = []) {
  return (items || []).some((item) => {
    const normalized = normalizeContinueWatchingItem(item);
    return (
      normalized?.contentId &&
      (isRawContinueWatchingTitle(normalized) ||
        !hasContinueWatchingArtwork(normalized) ||
        (!normalized.continueWatchingMetaResolved && !hasContinueWatchingHeroMetadata(normalized)))
    );
  });
}

function buildNextUpSeedFromWatchedItem(item = {}) {
  const contentId = String(item?.contentId || "").trim();
  const contentType = String(item?.contentType || "series")
    .trim()
    .toLowerCase();
  const season = Number(item?.season || 0);
  const episode = Number(item?.episode || 0);
  if (!contentId || !isSeriesTypeForContinueWatching(contentType) || season <= 0 || episode <= 0) {
    return null;
  }
  const watchedAt = Number(item?.watchedAt || 0) || Date.now();
  return {
    contentId,
    contentType,
    videoId: item?.videoId || contentId,
    season,
    episode,
    title: firstNonEmpty(item?.title, prettyId(contentId)),
    episodeTitle: firstNonEmpty(item?.episodeTitle),
    positionMs: 100,
    durationMs: 100,
    progressPercent: 100,
    updatedAt: watchedAt,
    source: "watched_items"
  };
}

function continueWatchingEnrichmentCacheKey(item = {}) {
  const type =
    String(item.contentType || item.type || "movie")
      .trim()
      .toLowerCase() || "movie";
  const contentId = String(item.contentId || item.id || "").trim();
  const season = item.season == null ? "" : String(Number(item.season || 0));
  const episode = item.episode == null ? "" : String(Number(item.episode || 0));
  return contentId ? `${type}:${contentId}:${season}:${episode}` : "";
}

function readContinueWatchingEnrichmentCache() {
  const cache = LocalStore.get(CW_ENRICHMENT_CACHE_KEY, {});
  return cache && typeof cache === "object" ? cache : {};
}

function getCachedContinueWatchingEnrichment(item = {}) {
  const key = continueWatchingEnrichmentCacheKey(item);
  if (!key) {
    return null;
  }
  const cached = readContinueWatchingEnrichmentCache()[key];
  if (!cached || typeof cached !== "object") {
    return null;
  }
  if (Date.now() - Number(cached.cachedAt || 0) > CW_ENRICHMENT_CACHE_MAX_AGE_MS) {
    return null;
  }
  return cached;
}

function applyCachedContinueWatchingEnrichment(item = {}) {
  const cached = getCachedContinueWatchingEnrichment(item);
  if (!cached) {
    return item;
  }
  return {
    ...item,
    ...cached,
    contentId: item.contentId,
    contentType: item.contentType,
    videoId: item.videoId,
    season: item.season,
    episode: item.episode,
    positionMs: item.positionMs,
    durationMs: item.durationMs,
    progressPercent: item.progressPercent,
    updatedAt: item.updatedAt,
    source: item.source
  };
}

function saveContinueWatchingEnrichment(item = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (
    !normalized?.contentId ||
    isRawContinueWatchingTitle(normalized) ||
    !hasContinueWatchingArtwork(normalized)
  ) {
    return;
  }
  const key = continueWatchingEnrichmentCacheKey(normalized);
  if (!key) {
    return;
  }
  const cache = readContinueWatchingEnrichmentCache();
  cache[key] = {
    cachedAt: Date.now(),
    title: normalized.title,
    name: normalized.name,
    landscapePoster: normalized.landscapePoster,
    episodeThumbnail: normalized.episodeThumbnail,
    poster: normalized.poster,
    background: normalized.background,
    backdrop: normalized.backdrop,
    thumbnail: normalized.thumbnail,
    logo: normalized.logo,
    description: normalized.description,
    releaseInfo: normalized.releaseInfo,
    imdbRating: normalized.imdbRating,
    genres: normalized.genres,
    runtimeMinutes: normalized.runtimeMinutes,
    ageRating: normalized.ageRating,
    status: normalized.status,
    language: normalized.language,
    country: normalized.country,
    episodeTitle: normalized.episodeTitle,
    episodeDescription: normalized.episodeDescription,
    continueWatchingMetaResolved: true
  };
  const enrichmentCacheLimit = Platform.isTizen() || Platform.isWebOS() ? 50 : 200;
  const entries = Object.entries(cache)
    .sort(([, left], [, right]) => Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0))
    .slice(0, enrichmentCacheLimit);
  LocalStore.set(CW_ENRICHMENT_CACHE_KEY, Object.fromEntries(entries));
}

function readContinueWatchingDisplaySnapshot(scopeKey) {
  const key = String(scopeKey || "").trim();
  if (!key) {
    return [];
  }
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  const entry = store && typeof store === "object" ? store[key] : null;
  if (!entry || !Array.isArray(entry.items)) {
    return [];
  }
  if (Date.now() - Number(entry.savedAt || 0) > CW_DISPLAY_SNAPSHOT_MAX_AGE_MS) {
    return [];
  }
  return entry.items;
}

function writeContinueWatchingDisplaySnapshot(scopeKey, items = []) {
  const key = String(scopeKey || "").trim();
  if (!key || !Array.isArray(items) || !items.length) {
    return;
  }
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  const next = store && typeof store === "object" ? { ...store } : {};
  next[key] = { savedAt: Date.now(), items: items.slice(0, CW_MAX_VISIBLE_ITEMS) };
  const entries = Object.entries(next)
    .sort(([, left], [, right]) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0))
    .slice(0, CW_DISPLAY_SNAPSHOT_MAX_SCOPES);
  LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, Object.fromEntries(entries));
}

function buildContinueWatchingSignature(items = []) {
  return (items || [])
    .map((item) => {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized) {
        return "";
      }
      const position = Math.round(Number(normalized.positionMs || 0) / 1000);
      const duration = Math.round(Number(normalized.durationMs || 0) / 1000);
      return [
        normalized.contentId,
        normalized.videoId || "",
        normalized.season ?? "",
        normalized.episode ?? "",
        normalized.title || normalized.name || "",
        normalized.poster || "",
        normalized.background || normalized.backdrop || normalized.thumbnail || "",
        normalized.logo || "",
        normalized.episodeTitle || "",
        normalized.episodeThumbnail || "",
        normalized.description || normalized.episodeDescription || "",
        resolveImdbRating(normalized) || "",
        (normalized.genres || []).join(","),
        normalized.releaseInfo || "",
        normalized.runtimeMinutes || "",
        normalized.ageRating || "",
        normalized.status || "",
        normalized.language || "",
        normalized.country || "",
        normalized.continueWatchingMetaResolved ? "resolved" : "",
        position,
        duration,
        normalized.progressStatus || "",
        normalized.progressFraction ?? ""
      ].join("|");
    })
    .join("::");
}

function buildSidebarProfileSignature(profile = null) {
  if (!profile || typeof profile !== "object") {
    return "";
  }
  return [
    profile.id || "",
    profile.name || "",
    profile.avatarColorHex || "",
    profile.avatarId || "",
    profile.avatarUrl || profile.activeProfileAvatarUrl || ""
  ].join("|");
}

function buildHeroIdentity(item = null) {
  const normalized = isCollectionFolderItem(item)
    ? normalizeCollectionFolderItem(item)
    : normalizeCatalogItem(item || null, "movie");
  if (!normalized) {
    return "";
  }
  return [
    normalized.id ||
      normalized.videoId ||
      normalized.contentId ||
      normalized.title ||
      normalized.name ||
      "",
    normalized.type || normalized.apiType || "",
    normalized.season ?? "",
    normalized.episode ?? ""
  ].join("|");
}

/**
 * @param {HomeMediaSourceLike | null | undefined} hero
 * @param {string} layoutMode
 * @returns {HomeHeroDisplay}
 */
function buildHeroDisplayModel(hero, layoutMode) {
  if (isCollectionFolderItem(hero)) {
    const normalized = normalizeCollectionFolderItem(hero);
    return {
      title: normalized?.heroTitle || normalized?.name || normalized?.collectionTitle || "Untitled",
      description: " ",
      logo: firstNonEmpty(normalized?.titleLogoUrl, normalized?.logo),
      backdrop: firstNonEmpty(
        normalized?.heroBackdropUrl,
        normalized?.background,
        normalized?.backdrop,
        normalized?.poster
      ),
      backdropFallbacks: buildHeroBackdropSources(normalized).slice(1),
      metaPrimary: [],
      metaSecondary: [],
      chips: []
    };
  }
  const year = extractYear(hero);
  const imdb = resolveImdbRating(hero);
  const genres = Array.isArray(hero?.genres) ? hero.genres.filter(Boolean).slice(0, 3) : [];
  const typeLabel = formatContentTypeLabel(hero?.type || hero?.apiType || "movie", "movie");
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const metaPrimary = [];
  const metaSecondary = [];
  let chips = [];

  if (layoutMode === "modern") {
    if (isContinueWatchingHero) {
      const episodeLabel = [hero?.episodeCode, hero?.episodeTitle].filter(Boolean).join(" · ");
      metaPrimary.push(episodeLabel || typeLabel, genres[0], year);
      metaSecondary.push(String(hero?.progressStatus || "").toUpperCase());
      if (imdb) {
        metaSecondary.push({ imdb });
      }
    } else {
      metaPrimary.push(typeLabel, genres[0], formatRuntimeText(hero), year);
      if (imdb) {
        metaSecondary.push({ imdb });
      }
      chips = [];
    }
  } else {
    if (imdb) {
      metaPrimary.push({ imdb });
    }
    if (year) {
      metaPrimary.push(year);
    }
    chips = genres;
  }

  return {
    title: hero?.name || "Untitled",
    description: firstNonEmpty(hero?.description) || " ",
    logo: firstNonEmpty(hero?.logo),
    backdrop: buildHeroBackdropSources(hero)[0] || "",
    backdropFallbacks: buildHeroBackdropSources(hero).slice(1),
    metaPrimary: metaPrimary.filter(Boolean),
    metaSecondary: metaSecondary.filter(Boolean),
    chips
  };
}

export function buildModernHeroPresentation(hero) {
  if (isCollectionFolderItem(hero)) {
    const normalizedCollection = normalizeCollectionFolderItem(hero);
    if (!normalizedCollection) {
      return null;
    }
    return {
      title:
        normalizedCollection.heroTitle ||
        normalizedCollection.name ||
        normalizedCollection.rawTitle ||
        "",
      logo: firstNonEmpty(normalizedCollection.titleLogoUrl, normalizedCollection.logo),
      description: "",
      backdrop: buildHeroBackdropSources(normalizedCollection)[0] || "",
      backdropFallbacks: buildHeroBackdropSources(normalizedCollection).slice(1),
      leadingMeta: [],
      trailingMeta: [],
      secondaryHighlightText: "",
      badges: [],
      languageText: "",
      showImdbPrimary: false,
      showImdbSecondary: false,
      imdbText: ""
    };
  }
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const normalized = isContinueWatchingHero
    ? normalizeContinueWatchingItem(hero)
    : normalizeCatalogItem(hero);
  if (!normalized) {
    return null;
  }

  const isSeries = String(normalized.type || normalized.apiType || "").toLowerCase() === "series";
  const genres = Array.isArray(normalized.genres) ? normalized.genres.filter(Boolean) : [];
  const contentTypeText = formatContentTypeLabel(
    normalized.type || normalized.apiType || "movie",
    "movie"
  );
  const runtimeText = formatRuntimeText(normalized);
  const yearText = extractReleaseDateText(normalized);
  const imdbText = resolveImdbRating(normalized);
  const statusBadge = firstNonEmpty(normalized.status).toUpperCase();
  const ageRatingBadge = firstNonEmpty(normalized.ageRating);
  const languageText = firstNonEmpty(normalized.language).toUpperCase();
  const secondaryHighlightText = isContinueWatchingHero
    ? firstNonEmpty(normalized.progressStatus).toUpperCase()
    : "";
  const leadingMeta = isContinueWatchingHero
    ? [
        [normalized.episodeCode, normalized.episodeTitle, genres[0]].filter(Boolean).join(" · ") ||
          contentTypeText
      ].filter(Boolean)
    : [contentTypeText, genres[0]].filter(Boolean);
  const trailingMeta = isContinueWatchingHero
    ? [yearText].filter(Boolean)
    : [runtimeText, yearText].filter(Boolean);
  const badges = isContinueWatchingHero ? [] : [ageRatingBadge, statusBadge].filter(Boolean);
  const showImdbPrimary =
    Boolean(imdbText) && !isSeries && !badges.length && !secondaryHighlightText;
  const showImdbSecondary = Boolean(imdbText) && !showImdbPrimary;

  return {
    title: normalized.name || "Untitled",
    logo: firstNonEmpty(normalized.logo),
    description:
      firstNonEmpty(
        isContinueWatchingHero ? normalized.episodeDescription : null,
        normalized.description
      ) || "",
    backdrop: buildHeroBackdropSources(normalized)[0] || "",
    backdropFallbacks: buildHeroBackdropSources(normalized).slice(1),
    leadingMeta,
    trailingMeta,
    secondaryHighlightText,
    badges,
    languageText,
    showImdbPrimary,
    showImdbSecondary,
    imdbText
  };
}

function renderModernHeroMetaGroup(tokens = []) {
  return tokens
    .filter(Boolean)
    .map((token) => `<span>${escapeHtml(token)}</span>`)
    .join('<span class="home-hero-dot">•</span>');
}

function renderModernHeroPrimary(display) {
  const left = renderModernHeroMetaGroup(display.leadingMeta);
  const rightTokens = display.trailingMeta
    .filter(Boolean)
    .map((token) => `<span>${escapeHtml(token)}</span>`);
  if (display.showImdbPrimary) {
    rightTokens.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  const hasRight = rightTokens.length > 0;
  return `
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-leading">${left}</div>
    ${left && hasRight ? '<span class="home-hero-dot">•</span>' : ""}
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-trailing">${rightTokens.join('<span class="home-hero-dot">•</span>')}</div>
  `;
}

function renderModernHeroSecondary(display) {
  const parts = [];
  if (display.secondaryHighlightText) {
    parts.push(
      `<span class="home-modern-hero-highlight">${escapeHtml(display.secondaryHighlightText)}</span>`
    );
  }
  display.badges.forEach((badge) => {
    parts.push(`<span class="home-modern-hero-badge">${escapeHtml(badge)}</span>`);
  });
  if (display.showImdbSecondary) {
    parts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  if (display.languageText) {
    parts.push(
      `<span class="home-modern-hero-secondary-detail">${escapeHtml(display.languageText)}</span>`
    );
  }
  return parts.join('<span class="home-hero-dot">•</span>');
}

function renderMetaTokens(tokens = []) {
  return tokens
    .map((token) => {
      if (token && typeof token === "object" && token.imdb) {
        return `
        <span class="home-hero-imdb">
          <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
          <span>${escapeHtml(token.imdb)}</span>
        </span>
      `;
      }
      return `<span>${escapeHtml(token)}</span>`;
    })
    .join('<span class="home-hero-dot">•</span>');
}

function buildHeroIndicators(items = [], activeItem) {
  if (!Array.isArray(items) || items.length <= 1) {
    return "";
  }
  const activeId = String(activeItem?.id || "");
  const matchedIndex = items.findIndex((item) => String(item?.id || "") === activeId);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
  return items
    .map(
      (_, index) => `
    <span class="home-hero-indicator${index === activeIndex ? " is-active" : ""}"></span>
  `
    )
    .join("");
}

function renderHeroMarkup(layoutMode, heroItem, heroCandidates) {
  const display = buildHeroDisplayModel(heroItem, layoutMode);
  const isInteractive = layoutMode !== "modern";
  return `
    <section class="home-hero home-hero-${escapeAttribute(layoutMode)}">
      <article class="home-hero-card${isInteractive ? " focusable" : ""}"
               ${isInteractive ? 'tabindex="0"' : ""}
               ${isInteractive ? 'data-nav-zone="main" data-nav-row="0" data-nav-col="0" data-nav-row-key="__hero__"' : ""}
               ${
                 isInteractive
                   ? `data-action="openDetail"
               data-item-id="${escapeAttribute(heroItem?.id || "")}"
               data-item-type="${escapeAttribute(heroItem?.type || "movie")}"
               data-item-title="${escapeAttribute(heroItem?.name || "Untitled")}"`
                   : ""
               }>
        <div class="home-hero-backdrop-wrap">
          ${renderHeroBackdropImage(display)}
        </div>
        <div class="home-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : ""}
            <h1 class="home-hero-title-text${display.logo ? " is-hidden" : ""}">${escapeHtml(display.title)}</h1>
          </div>
          <div class="home-hero-meta-primary${display.metaPrimary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaPrimary)}</div>
          <div class="home-hero-chip-row${display.chips.length ? "" : " is-empty"}">${display.chips.map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`).join("")}</div>
          <div class="home-hero-meta-secondary${display.metaSecondary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaSecondary)}</div>
          <p class="home-hero-description">${escapeHtml(display.description)}</p>
        </div>
        <div class="home-hero-indicators">${buildHeroIndicators(heroCandidates, heroItem)}</div>
      </article>
    </section>
  `;
}

function buildPosterSubtitle(item, layoutMode) {
  if (isCollectionFolderItem(item)) {
    return firstNonEmpty(item.collectionTitle, item.subtitle, "");
  }
  const normalized = normalizeCatalogItem(item);
  if (layoutMode === "modern") {
    return firstNonEmpty(normalized.releaseInfo, "");
  }
  return firstNonEmpty(extractYear(normalized), normalized.releaseInfo, "");
}

function renderRowHeader(title, subtitle = "") {
  return `
    <div class="home-row-head">
      <h2 class="home-row-title">${escapeHtml(title)}</h2>
      ${subtitle ? `<div class="home-row-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

function resolveContinueWatchingBlurNextUp(layoutPrefs) {
  if (Platform.isTizen()) {
    return false;
  }
  return Boolean(layoutPrefs?.blurContinueWatchingNextUp);
}

function renderContinueWatchingCard(item, index, options = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  const subtitle = normalized.episodeTitle || "";
  const isNextUp = Boolean(normalized?.isNextUp);
  const hasAired = normalized?.hasAired !== false;
  const useEpisodeThumbnails = options?.useEpisodeThumbnails !== false;
  const blurNextUp = Boolean(options?.blurNextUp && isNextUp && useEpisodeThumbnails);
  const rowKey = String(options?.rowKey || "continue_watching").trim() || "continue_watching";
  const cardImageSources = useEpisodeThumbnails
    ? !isNextUp
      ? [
          normalized.episodeThumbnail,
          normalized.backdrop,
          normalized.poster,
          normalized.thumbnail,
          normalized.background
        ]
      : !hasAired
        ? [
            normalized.backdrop,
            normalized.poster,
            normalized.thumbnail,
            normalized.background,
            normalized.episodeThumbnail
          ]
        : [
            normalized.thumbnail,
            normalized.episodeThumbnail,
            normalized.backdrop,
            normalized.poster,
            normalized.background
          ]
    : [
        normalized.backdrop,
        normalized.poster,
        normalized.thumbnail,
        normalized.episodeThumbnail,
        normalized.background
      ];
  const uniqueCardImageSources = uniqueNonEmptyValues(cardImageSources);
  const cardImage = uniqueCardImageSources[0] || "";
  const fallbackQueue = encodeHeroBackdropFallbacks(uniqueCardImageSources.slice(1));
  const deferContinueImage = Platform.isTizen() || Platform.isWebOS();
  const continueImageAttrs = cardImage
    ? buildLazyImageAttributes(cardImage, { defer: deferContinueImage })
    : "";
  return `
    <article class="home-content-card home-continue-card${blurNextUp ? " home-continue-card-blur-next-up" : ""} focusable"
             tabindex="0"
             data-nav-zone="main"
             data-nav-row="0"
             data-nav-col="${index}"
             data-nav-row-key="${escapeAttribute(rowKey)}"
             data-action="resumeProgress"
             data-cw-index="${index}"
             data-item-id="${escapeAttribute(normalized.contentId)}"
             data-video-id="${escapeAttribute(normalized.videoId || "")}"
             data-season="${escapeAttribute(normalized.season ?? "")}"
             data-episode="${escapeAttribute(normalized.episode ?? "")}"
             data-item-type="${escapeAttribute(normalized.type || "movie")}"
             data-item-title="${escapeAttribute(normalized.title || "Untitled")}">
      <div class="home-continue-media">
        ${cardImage ? `<img class="home-continue-bg" ${continueImageAttrs}${fallbackQueue ? ` data-fallback-srcs="${escapeAttribute(fallbackQueue)}"` : ""} alt="" aria-hidden="true" decoding="async" onerror="${buildImageFallbackErrorHandler()}" />` : ""}
        <span class="home-continue-badge">${escapeHtml(normalized.progressStatus || t("home.continueStatusContinue", {}, "Continue"))}</span>
        <div class="home-continue-copy">
          ${normalized.episodeCode ? `<div class="home-continue-kicker">${escapeHtml(normalized.episodeCode)}</div>` : ""}
          <div class="home-continue-title">${escapeHtml(normalized.title)}</div>
          ${subtitle ? `<div class="home-continue-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        <div class="home-continue-progress"><span style="width:${Math.round((normalized.progressFraction || 0) * 100)}%"></span></div>
      </div>
    </article>
  `;
}

function renderContinueWatchingLoadingCard(index = 0, rowKey = "continue_watching") {
  const titleWidths = [132, 148, 124, 156, 138, 144, 126, 152, 136, 142];
  const subtitleWidths = [108, 118, 96, 124, 110, 122, 102, 116, 106, 120];
  const safeIndex = Math.max(0, Number(index) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-continue-card home-continue-card-loading focusable"
              tabindex="0"
              data-nav-zone="main"
              data-nav-row="0"
              data-nav-col="${index}"
              data-nav-row-key="${escapeAttribute(rowKey)}"
              data-action="continueWatchingLoading"
             data-cw-loading-index="${index}"
              aria-disabled="true">
      <div class="home-continue-media home-continue-media-loading"
           style="--cw-skeleton-title:${titleWidth}px;--cw-skeleton-subtitle:${subtitleWidth}px;">
        <span class="home-continue-badge" aria-hidden="true">${escapeHtml(t("common.loading", {}, "Loading"))}</span>
        <div class="home-continue-copy home-continue-copy-skeleton" aria-hidden="true">
          <div class="home-continue-skeleton-line home-continue-skeleton-kicker"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-title"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-subtitle"></div>
        </div>
      </div>
    </article>
  `;
}

export function renderContinueWatchingSection(items = [], options = {}) {
  const loading = Boolean(options?.loading);
  if (!items.length && !loading) {
    return "";
  }
  const rowKey = String(options?.rowKey || "").trim();
  const loadingCount = Math.max(
    1,
    Math.min(10, Number(options?.loadingCount || items.length || 3))
  );
  const cardOptions = {
    useEpisodeThumbnails: options?.useEpisodeThumbnails,
    blurNextUp: options?.blurNextUp,
    rowKey
  };
  return `
    <section class="home-row home-row-continue"${rowKey ? ` data-row-key="${escapeAttribute(rowKey)}"` : ""}>
      <div class="home-row-head">
        <h2 class="home-row-title">${escapeHtml(t("home.continueWatching", {}, "Continue Watching"))}</h2>
      </div>
      <div class="home-track home-track-continue"${rowKey ? ` data-track-row-key="${escapeAttribute(rowKey)}"` : ""}>
        ${
          items.length
            ? items
                .map((item, index) => renderContinueWatchingCard(item, index, cardOptions))
                .join("")
            : Array.from({ length: loadingCount }, (_, index) =>
                renderContinueWatchingLoadingCard(index, rowKey)
              ).join("")
        }
      </div>
    </section>
  `;
}

function continueWatchingStreamParams(item, options = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized?.contentId) {
    return null;
  }
  const isSeries = isSeriesTypeForContinueWatching(normalized.type);
  return {
    itemId: normalized.contentId,
    itemType: normalized.type || "movie",
    imdbId: normalized.imdbId || null,
    tmdbId: normalized.tmdbId || null,
    traktId: normalized.traktId || null,
    itemTitle: normalized.title || normalized.contentId || "Untitled",
    playerTitle: normalized.title || normalized.contentId || "Untitled",
    playerEpisodeTitle: isSeries ? normalized.episodeTitle || "" : "",
    playerReleaseYear: isSeries
      ? ""
      : String(normalized.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
    // Do not turn contentId into a synthetic videoId; the player and sync layer should keep
    // progress identity stable across entry points.
    videoId: normalized.videoId || null,
    season: isSeries ? normalized.season : null,
    episode: isSeries ? normalized.episode : null,
    episodeTitle: isSeries ? normalized.episodeTitle || "" : "",
    backdrop: firstNonEmpty(
      normalized.backdrop,
      normalized.background,
      normalized.landscapePoster,
      normalized.poster
    ),
    landscapePoster: firstNonEmpty(
      normalized.landscapePoster,
      normalized.backdrop,
      normalized.background,
      normalized.poster
    ),
    poster: firstNonEmpty(normalized.poster, normalized.backdrop, normalized.background),
    logo: firstNonEmpty(normalized.logo),
    resumePositionMs: options.startOver ? 0 : Number(normalized.positionMs || 0) || 0,
    resumeProgressPercent: options.startOver ? null : (normalized.progressPercent ?? null),
    resumeDurationMs: options.startOver ? 0 : Number(normalized.durationMs || 0) || 0,
    resumeStreamIdentity: options.startOver ? null : normalized.streamIdentity || null,
    startFromBeginning: Boolean(options.startOver),
    manualSelection: Boolean(options.manualSelection)
  };
}

function renderLegacyCatalogRowsMarkup(rows = [], options = {}) {
  const {
    layoutMode = "classic",
    showPosterLabels = true,
    showCatalogAddonName = true,
    showCatalogTypeSuffix = true,
    focusedRowKey = "",
    focusedItemIndex = -1,
    expandFocusedPoster = false,
    rowItemLimit = HOME_MAX_ITEMS_PER_ROW_DEFAULT,
    watchedTitleIds = null
  } = options;
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];

  rows.forEach((rowData, rowIndex) => {
    const isCollectionRow = rowData?.rowKind === "collection";
    const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
    const isLoading = rowData?.result?.status === "loading";
    const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData));
    const loadingItems = isLoading
      ? rowData.loadingItems || buildCatalogLoadingItems(rowKey, rowItemLimit)
      : [];
    const rowItems = items.length ? items : loadingItems;
    if (!rowItems.length) {
      return;
    }

    const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
    if (!isLoading && !isCollectionRow) {
      catalogSeeAllMap.set(seeAllId, {
        addonBaseUrl: rowData.addonBaseUrl || "",
        addonId: rowData.addonId || "",
        addonName: rowData.addonName || "",
        catalogId: rowData.catalogId || "",
        catalogName: rowData.catalogName || "",
        type: rowData.type || "movie",
        initialItems: items
      });
    }

    const rowTitle = isCollectionRow
      ? String(rowData.collectionTitle || rowData.collection?.title || "Collection")
      : formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
    const rowSubtitle =
      layoutMode === "classic" && showCatalogAddonName && rowData.addonName
        ? `from ${rowData.addonName}`
        : "";
    const maxItems = Math.max(1, Number(rowItemLimit || HOME_MAX_ITEMS_PER_ROW_DEFAULT));
    const hasSeeAll = !isCollectionRow && !isLoading && items.length > maxItems;
    const gridLimit = Math.max(1, hasSeeAll ? maxItems - 1 : maxItems);
    const visibleItems = isCollectionRow
      ? rowItems
      : layoutMode === "grid"
        ? rowItems.slice(0, gridLimit)
        : rowItems.slice(0, maxItems);
    const deferRowImages = shouldDeferHomeRowImages(rowIndex, rowKey, focusedRowKey);
    const cardsMarkup = visibleItems
      .map((item, itemIndex) =>
        createPosterCardMarkup(
          item,
          rowIndex,
          itemIndex,
          rowData.type,
          rowData,
          showPosterLabels,
          layoutMode,
          expandFocusedPoster && focusedRowKey === rowKey && focusedItemIndex === itemIndex,
          false,
          deferRowImages,
          watchedTitleIds
        )
      )
      .join("");
    const trackMarkup = `
      <div class="${layoutMode === "grid" ? "home-grid-track" : "home-track"}" data-track-row-key="${escapeAttribute(rowKey)}">
        ${cardsMarkup}
        ${hasSeeAll ? createSeeAllCardMarkup(seeAllId, rowData, visibleItems.length, rowIndex) : ""}
      </div>
    `;

    if (layoutMode === "grid") {
      sectionsMarkup.push(`
        <section class="home-grid-section"
                 data-row-key="${escapeAttribute(rowKey)}"
                 data-row-index="${rowIndex}"
                 data-section-title="${escapeAttribute(rowTitle)}">
          <div class="home-grid-section-divider">${escapeHtml(rowTitle)}</div>
          ${trackMarkup}
        </section>
      `);
      return;
    }

    sectionsMarkup.push(`
      <section class="home-row"
               data-row-key="${escapeAttribute(rowKey)}"
               data-row-index="${rowIndex}">
        ${renderRowHeader(rowTitle, rowSubtitle)}
        ${trackMarkup}
      </section>
    `);
  });

  return {
    catalogSeeAllMap,
    markup: sectionsMarkup.join("")
  };
}

export function createSeeAllCardMarkup(seeAllId, rowData, itemIndex = 0, rowIndex = 0) {
  const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData)).trim();
  return `
    <article class="home-content-card home-seeall-card focusable"
             tabindex="0"
             data-nav-zone="main"
             data-nav-row="${Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : 0}"
             data-nav-col="${Math.max(0, Number(itemIndex || 0))}"
             data-nav-row-key="${escapeAttribute(rowKey)}"
             data-action="openCatalogSeeAll"
             data-see-all-id="${escapeAttribute(seeAllId)}"
             data-addon-base-url="${escapeAttribute(rowData.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData.addonName || "")}"
             data-catalog-id="${escapeAttribute(rowData.catalogId || "")}"
             data-catalog-name="${escapeAttribute(rowData.catalogName || "")}"
             data-catalog-type="${escapeAttribute(rowData.type || "")}">
      <div class="home-seeall-card-inner">
        <div class="home-seeall-arrow" aria-hidden="true">&#8594;</div>
        <div class="home-seeall-label">See All</div>
      </div>
    </article>
  `;
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

function shouldDeferHomeRowImages(rowIndex = 0, rowKey = "", focusedRowKey = "") {
  const safeRowIndex = Math.max(0, Number(rowIndex || 0));
  const focused = String(focusedRowKey || "").trim();
  if (focused && String(rowKey || "") === focused) {
    return false;
  }
  const eagerRows = Platform.isWebOS() || Platform.isTizen() ? 3 : 5;
  return safeRowIndex >= eagerRows;
}

function buildLazyImageAttributes(src = "", { defer = false, highPriority = false } = {}) {
  const safeSrc = escapeAttribute(src);
  const priority = highPriority ? ' fetchpriority="high"' : "";
  const loadingMode = Platform.isWebOS() || Platform.isTizen() ? "eager" : "lazy";
  if (defer) {
    return `data-src="${safeSrc}" loading="${loadingMode}" decoding="async"${priority}`;
  }
  return `src="${safeSrc}" loading="${loadingMode}" decoding="async"${priority}`;
}

export function createPosterCardMarkup(
  item,
  rowIndex,
  itemIndex,
  itemType,
  rowData = null,
  showLabels = true,
  layoutMode = "classic",
  isExpanded = false,
  preferLandscapePoster = false,
  deferImages = false,
  watchedTitleIds = null
) {
  const suppressPosterText = Boolean(rowData?.suppressPosterText);
  const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData || {})).trim();
  const collectionSeed =
    rowData?.rowKind === "collection"
      ? {
          ...(item || {}),
          collectionId: item?.collectionId || rowData?.collectionId || rowData?.collection?.id,
          collectionTitle:
            item?.collectionTitle || rowData?.collectionTitle || rowData?.collection?.title
        }
      : item;
  const collectionItem =
    rowData?.rowKind === "collection"
      ? normalizeCollectionFolderItem(collectionSeed, rowData?.collection || null)
      : isCollectionFolderItem(item)
        ? normalizeCollectionFolderItem(item)
        : null;
  if (collectionItem) {
    const visualSrc = firstNonEmpty(
      collectionItem.poster,
      collectionItem.coverImageUrl,
      collectionItem.backdrop
    );
    const subtitle = buildPosterSubtitle(collectionItem, layoutMode);
    const tileShape = normalizeCollectionPosterShape(collectionItem.tileShape);
    const shapeClass =
      tileShape === "POSTER"
        ? ""
        : tileShape === "SQUARE"
          ? " is-collection-square"
          : " is-landscape is-collection-landscape";
    const focusGifOverlay =
      collectionItem.focusGifEnabled && collectionItem.focusGifUrl
        ? `<img class="home-poster-focus-gif" data-src="${escapeAttribute(collectionItem.focusGifUrl)}" alt="" aria-hidden="true" />`
        : "";
    const contentMarkup = visualSrc
      ? `<img class="content-poster" ${buildLazyImageAttributes(visualSrc, { defer: deferImages })} alt="${escapeAttribute(collectionItem.name || collectionItem.heroTitle || collectionItem.collectionTitle || "collection")}" />`
      : collectionItem.coverEmoji
        ? `<div class="home-collection-emoji" aria-hidden="true">${escapeHtml(collectionItem.coverEmoji)}</div>`
        : '<div class="content-poster placeholder"></div>';
    return `
      <article class="home-content-card home-poster-card home-collection-card focusable${shapeClass}"
               tabindex="0"
               data-nav-zone="main"
               data-nav-row="${rowIndex}"
               data-nav-col="${itemIndex}"
               data-nav-row-key="${escapeAttribute(rowKey)}"
               data-action="openCollectionFolder"
               data-row-index="${rowIndex}"
               data-item-index="${itemIndex}"
               data-item-id="${escapeAttribute(collectionItem.id)}"
               data-item-type="collection_folder"
               data-item-title="${escapeAttribute(collectionItem.name || collectionItem.heroTitle || collectionItem.collectionTitle || "Collection")}"
               data-collection-id="${escapeAttribute(collectionItem.collectionId)}"
               data-folder-id="${escapeAttribute(collectionItem.folderId)}"
               data-collection-title="${escapeAttribute(collectionItem.collectionTitle || "")}"
               data-focus-gif-enabled="${collectionItem.focusGifEnabled ? "true" : "false"}"
               data-focus-gif-src="${escapeAttribute(collectionItem.focusGifUrl || "")}"
               data-hero-video-url="${escapeAttribute(collectionItem.heroVideoUrl || "")}"
               data-logo-src="${escapeAttribute(collectionItem.titleLogoUrl || "")}"
               data-backdrop-src="${escapeAttribute(collectionItem.heroBackdropUrl || collectionItem.backdrop || "")}">
        <div class="home-poster-frame">
          ${contentMarkup}
          ${focusGifOverlay}
        </div>
        ${
          layoutMode !== "modern" && showLabels && !collectionItem.hideTitle
            ? `
          <div class="home-poster-copy">
            <div class="home-poster-title">${escapeHtml(collectionItem.name || collectionItem.collectionTitle || "Collection")}</div>
            ${subtitle ? `<div class="home-poster-subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
        `
            : ""
        }
      </article>
    `;
  }
  const isLoading = Boolean(item?.isLoading);
  const normalized = normalizeCatalogItem(item, itemType);
  const subtitle = buildPosterSubtitle(normalized, layoutMode);
  const preferredLandscapePosterSrc = firstNonEmpty(normalized.landscapePoster);
  const useLandscapePoster = layoutMode === "modern" && preferLandscapePoster;
  const landscapeVisualSrc = firstNonEmpty(
    preferredLandscapePosterSrc,
    normalized.background,
    normalized.backdrop,
    normalized.backdropUrl,
    normalized.poster,
    normalized.thumbnail
  );
  const backdropSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(
        preferredLandscapePosterSrc,
        normalized.background,
        normalized.backdrop,
        normalized.backdropUrl,
        normalized.poster
      );
  const posterSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(
        normalized.poster,
        normalized.thumbnail,
        preferredLandscapePosterSrc,
        normalized.backdrop,
        normalized.backdropUrl
      );
  const expandedVisualSrc = firstNonEmpty(backdropSrc, posterSrc);
  const expandedClass = isExpanded ? " is-expanded" : "";
  const landscapeClass = useLandscapePoster ? " is-landscape" : "";
  const focusableClass = isLoading ? "" : " focusable";
  const loadingClass = isLoading ? " home-poster-card-loading" : "";
  const shouldShowLabels = showLabels && !isLoading && !suppressPosterText;
  const watchedBadge =
    !isLoading && isTitleItemWatched(normalized, watchedTitleIds) ? renderTitleWatchedBadge() : "";
  const titleWidths = [116, 128, 104, 132, 120, 140, 110, 124, 136, 112];
  const subtitleWidths = [82, 96, 74, 90, 88, 100, 80, 94, 86, 92];
  const safeIndex = Math.max(0, Number(itemIndex) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-poster-card${focusableClass}${expandedClass}${landscapeClass}${loadingClass}"
             ${isLoading ? "" : 'tabindex="0"'}
             ${
               isLoading
                 ? ""
                 : `data-nav-zone="main"
             data-nav-row="${rowIndex}"
             data-nav-col="${itemIndex}"
             data-nav-row-key="${escapeAttribute(rowKey)}"`
             }
             ${
               isLoading
                 ? 'aria-disabled="true"'
                 : `data-action="openDetail"
             data-row-index="${rowIndex}"
             data-item-index="${itemIndex}"
             data-item-id="${escapeAttribute(normalized.id)}"
             data-item-type="${escapeAttribute(normalized.type || itemType || "movie")}"
             data-item-title="${escapeAttribute(normalized.name || "Untitled")}"
             data-poster-src="${escapeAttribute(posterSrc || "")}"
             data-backdrop-src="${escapeAttribute(backdropSrc || "")}"
             data-logo-src="${escapeAttribute(normalized.logo || "")}"
             data-addon-base-url="${escapeAttribute(rowData?.addonBaseUrl || normalized.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData?.addonId || normalized.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData?.addonName || normalized.addonName || "")}"
             data-catalog-type="${escapeAttribute(rowData?.type || normalized.catalogType || "")}"`
             }>
      <div class="home-poster-frame">
        ${
          !isLoading && posterSrc
            ? `<img class="content-poster" ${buildLazyImageAttributes(posterSrc, { defer: deferImages })} alt="${escapeAttribute(normalized.name || "content")}" />`
            : '<div class="content-poster placeholder"></div>'
        }
        ${
          !isLoading && expandedVisualSrc
            ? `<img class="home-poster-expanded-backdrop" data-src="${escapeAttribute(expandedVisualSrc)}" decoding="async" loading="lazy" alt="" aria-hidden="true" />`
            : '<div class="home-poster-expanded-backdrop placeholder" aria-hidden="true"></div>'
        }
        <div class="home-poster-trailer-layer"></div>
        <div class="home-poster-expanded-gradient"></div>
        ${watchedBadge}
        <div class="home-poster-expanded-brand">
          ${
            !isLoading && normalized.logo
              ? `<img class="home-poster-expanded-logo" data-src="${escapeAttribute(normalized.logo)}" decoding="async" loading="lazy" alt="${escapeAttribute(normalized.name || "content")}" />`
              : `<div class="home-poster-expanded-title">${escapeHtml(normalized.name || "Untitled")}</div>`
          }
        </div>
        ${
          !isLoading && useLandscapePoster && !suppressPosterText
            ? `
          <div class="home-poster-landscape-copy" aria-hidden="true">
            ${
              normalized.logo
                ? `<img class="home-poster-landscape-logo" ${buildLazyImageAttributes(normalized.logo, { defer: deferImages })} alt="" />`
                : `<div class="home-poster-landscape-title">${escapeHtml(normalized.name || "Untitled")}</div>`
            }
            ${subtitle ? `<div class="home-poster-landscape-subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
        `
            : ""
        }
      </div>
      ${
        shouldShowLabels
          ? `
        <div class="home-poster-copy">
          <div class="home-poster-title">${escapeHtml(normalized.name || "Untitled")}</div>
          ${subtitle ? `<div class="home-poster-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      `
          : isLoading
            ? `
        <div class="home-poster-copy home-poster-copy-skeleton" aria-hidden="true"
             style="--poster-skeleton-title:${titleWidth}px;--poster-skeleton-subtitle:${subtitleWidth}px;">
          <div class="home-poster-skeleton-line home-poster-skeleton-title"></div>
          <div class="home-poster-skeleton-line home-poster-skeleton-subtitle"></div>
        </div>
      `
            : ""
      }
    </article>
  `;
}

export const HomeScreen = {
  getRouteStateKey() {
    return "home";
  },

  captureRouteState() {
    return this.captureCurrentContentFocusState() || this.captureCurrentFocusState();
  },

  captureCurrentFocusState() {
    const layoutMode = String(this.renderedLayoutMode || this.layoutMode || "").toLowerCase();
    if (!this.container || !layoutMode) {
      return null;
    }
    let focused =
      this.getCurrentFocusedNode() ||
      this.container.querySelector(".focusable.focused") ||
      this.lastMainFocus ||
      null;
    if (focused && !focused.isConnected) {
      return null;
    }
    if (focused?.closest?.(".home-sidebar, .modern-sidebar-panel")) {
      return {
        layoutMode,
        focusKind: "sidebar",
        sidebarExpanded: Boolean(this.sidebarExpanded),
        sidebarIndex: Number(focused?.dataset?.navIndex || 0),
        sidebarAction: String(focused?.dataset?.action || "")
      };
    }
    const viewport =
      layoutMode === "modern"
        ? this.container.querySelector(".home-modern-rows-viewport")
        : this.container.querySelector(".home-main");
    if (!viewport) {
      return null;
    }

    focused =
      this.container.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
    if (!focused) {
      return null;
    }
    const trackStates = Object.fromEntries(
      this.getNavigationTrackNodes()
        .map((track) => [String(track.dataset.trackRowKey || ""), track.scrollLeft])
        .filter(([key]) => key)
    );
    const section = focused?.closest?.("[data-row-key]") || null;
    const rowKey = String(section?.dataset?.rowKey || "");
    let itemIndex = -1;

    if (focused) {
      const track = focused.closest(".home-track, .home-grid-track");
      if (track) {
        itemIndex = Array.from(track.querySelectorAll(".home-content-card.focusable")).indexOf(
          focused
        );
      }
    }

    const focusKind = focused?.classList?.contains("home-hero-card")
      ? "hero"
      : focused?.dataset?.action === "resumeProgress"
        ? "continue"
        : focused?.dataset?.action === "openCatalogSeeAll"
          ? "seeAll"
          : "item";

    return {
      layoutMode,
      mainScrollTop: viewport.scrollTop,
      rowKey,
      itemIndex,
      focusKind,
      trackStates
    };
  },

  captureCurrentContentFocusState() {
    const focused =
      this.container?.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
    if (!focused || !focused.isConnected || !this.isMainNode(focused)) {
      return null;
    }
    return this.captureFocusStateForNode(focused);
  },

  persistCurrentFocusState() {
    const currentState = this.captureCurrentFocusState();
    if (!currentState?.layoutMode) {
      return;
    }
    this.savedFocusStates = {
      ...(this.savedFocusStates || {}),
      [currentState.layoutMode]: currentState
    };
  },

  captureFocusStateForNode(node) {
    const layoutMode = String(this.renderedLayoutMode || this.layoutMode || "").toLowerCase();
    if (
      !this.container ||
      !layoutMode ||
      !(node instanceof HTMLElement) ||
      !this.container.contains(node)
    ) {
      return null;
    }
    const viewport =
      layoutMode === "modern"
        ? this.container.querySelector(".home-modern-rows-viewport")
        : this.container.querySelector(".home-main");
    if (!viewport) {
      return null;
    }

    const trackStates = Object.fromEntries(
      this.getNavigationTrackNodes()
        .map((track) => [String(track.dataset.trackRowKey || ""), track.scrollLeft])
        .filter(([key]) => key)
    );
    const section = node.closest("[data-row-key]") || null;
    const track = node.closest(".home-track, .home-grid-track");
    const itemIndex = track
      ? Array.from(track.querySelectorAll(".home-content-card.focusable")).indexOf(node)
      : -1;
    const focusKind = node.classList.contains("home-hero-card")
      ? "hero"
      : node.dataset?.action === "resumeProgress"
        ? "continue"
        : node.dataset?.action === "openCatalogSeeAll"
          ? "seeAll"
          : "item";

    return {
      layoutMode,
      mainScrollTop: viewport.scrollTop,
      rowKey: String(section?.dataset?.rowKey || ""),
      itemIndex,
      focusKind,
      trackStates
    };
  },

  rememberReturnFocusForNode(node) {
    const state = this.captureFocusStateForNode(node);
    if (!state?.layoutMode) {
      this.persistCurrentFocusState();
      return;
    }
    this.savedFocusStates = {
      ...(this.savedFocusStates || {}),
      [state.layoutMode]: state
    };
    this.pendingBackFocusState = state;
    try {
      globalThis.sessionStorage?.setItem?.(HOME_RETURN_FOCUS_STATE_KEY, JSON.stringify(state));
    } catch (_) {}
  },

  rememberContinueWatchingReturnFocus(index = null) {
    const cards = this.getNavigationRowNodes("continue_watching");
    const preferredIndex = Number(index);
    const target = Number.isFinite(preferredIndex)
      ? cards[Math.max(0, Math.min(cards.length - 1, preferredIndex))] || null
      : this.getCurrentFocusedNode()?.closest?.(".home-continue-card") || null;
    if (target instanceof HTMLElement) {
      this.rememberReturnFocusForNode(target);
      return;
    }
    this.persistCurrentFocusState();
  },

  readStoredReturnFocusState() {
    try {
      const navigationEntry = globalThis.performance?.getEntriesByType?.("navigation")?.[0] || null;
      if (navigationEntry?.type === "reload") {
        globalThis.sessionStorage?.removeItem?.(HOME_RETURN_FOCUS_STATE_KEY);
        return null;
      }
      const raw = globalThis.sessionStorage?.getItem?.(HOME_RETURN_FOCUS_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.layoutMode ? parsed : null;
    } catch (_) {
      return null;
    }
  },

  clearStoredReturnFocusState() {
    this.pendingBackFocusState = null;
    try {
      globalThis.sessionStorage?.removeItem?.(HOME_RETURN_FOCUS_STATE_KEY);
    } catch (_) {}
  },

  applyReturnFocusStateNow(focusState) {
    if (!focusState?.layoutMode || focusState.layoutMode !== this.layoutMode || !this.container) {
      return false;
    }
    const viewport = this.getHomeViewport();
    if (!viewport) {
      return false;
    }

    Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.getNavigationTrackNodes().find(
        (node) => String(node.dataset.trackRowKey || "") === String(rowKey || "")
      );
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });

    const nodes = this.getNavigationRowNodes(focusState.rowKey);
    const target = nodes[focusState.itemIndex] || nodes[0] || null;
    if (!target) {
      return false;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));
    this.setFocusedNode(target, { suppressDelegatedFocus: true });
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    this.syncFocusedCollectionCardState();
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
    return true;
  },

  scheduleReturnFocusRestore() {
    const focusState =
      this.pendingBackFocusState ||
      (this.isRestoringFocusFromBack ? this.readStoredReturnFocusState() : null);
    if (!focusState?.layoutMode) {
      return;
    }
    const restore = () => {
      if (Router.getCurrent() !== "home") {
        return;
      }
      if (this.applyReturnFocusStateNow(focusState)) {
        this.clearStoredReturnFocusState();
      }
    };
    requestAnimationFrame(() => {
      restore();
      setTimeout(restore, 180);
    });
  },

  restoreFocusState(state = null) {
    if (this.homeHoldFocusLocked) {
      return false;
    }
    const focusState =
      state?.layoutMode === this.layoutMode
        ? state
        : this.savedFocusStates?.[this.layoutMode] || null;
    if (!focusState) {
      return false;
    }

    if (this.layoutMode === "modern") {
      if (focusState.focusKind === "sidebar") {
        return this.restoreSidebarFocusState(focusState);
      }
      return this.restoreModernFocusState(focusState);
    }

    if (focusState.focusKind === "sidebar") {
      return this.restoreSidebarFocusState(focusState);
    }
    return this.restoreLegacyFocusState(focusState);
  },

  restoreSidebarFocusState(focusState) {
    if (this.homeHoldFocusLocked || !focusState || !this.container) {
      return false;
    }

    const nodes = this.layoutPrefs?.modernSidebar
      ? getModernSidebarNodes(this.container)
      : getLegacySidebarNodes(this.container);
    if (!nodes.length) {
      return false;
    }

    let target = this.layoutPrefs?.modernSidebar
      ? getModernSidebarSelectedNode(this.container)
      : getLegacySidebarSelectedNode(this.container);

    if (!target && focusState.sidebarAction) {
      target =
        nodes.find(
          (node) => String(node.dataset?.action || "") === String(focusState.sidebarAction || "")
        ) || null;
    }

    const preferredIndex = Number(focusState.sidebarIndex);
    target =
      target ||
      (Number.isFinite(preferredIndex)
        ? nodes[Math.max(0, Math.min(nodes.length - 1, preferredIndex))] || null
        : null) ||
      nodes[0] ||
      null;
    if (!target) {
      return false;
    }

    this.setSidebarExpanded(true);
    this.setFocusedNode(target);
    return true;
  },

  restoreModernFocusState(focusState) {
    if (this.homeHoldFocusLocked || !focusState || this.layoutMode !== "modern") {
      return false;
    }

    const viewport = this.getHomeViewport();
    if (!viewport) {
      return false;
    }

    Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.getNavigationTrackNodes().find(
        (node) => String(node.dataset.trackRowKey || "") === String(rowKey || "")
      );
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

    const targetNodes = this.getNavigationRowNodes(focusState.rowKey);
    if (this.isRestoringFocusFromBack && focusState.rowKey && !targetNodes.length) {
      return false;
    }
    const fallback = this.isRestoringFocusFromBack
      ? null
      : this.container.querySelector(
          ".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable"
        );
    const target = targetNodes[focusState.itemIndex] || targetNodes[0] || fallback;
    if (!target) {
      return false;
    }

    this.setFocusedNode(target);
    this.syncFocusedCollectionCardState();
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!this.isRestoringFocusFromBack) {
      this.ensureMainVerticalVisibility(target, "down");
    }
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
    return true;
  },

  restoreLegacyFocusState(focusState) {
    if (this.homeHoldFocusLocked || !focusState || !["classic", "grid"].includes(this.layoutMode)) {
      return false;
    }

    const main = this.container?.querySelector(".home-main");
    if (!main) {
      return false;
    }

    Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.getNavigationTrackNodes().find(
        (node) => String(node.dataset.trackRowKey || "") === String(rowKey || "")
      );
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });

    const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
    main.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

    let target = null;
    if (focusState.focusKind === "hero") {
      target = this.container.querySelector(".home-hero-card.focusable");
    } else if (focusState.rowKey) {
      const rowNodes = this.getNavigationRowNodes(focusState.rowKey);
      target = rowNodes[focusState.itemIndex] || rowNodes[0] || null;
    }

    if (this.isRestoringFocusFromBack && focusState.rowKey) {
      const targetExists = this.getNavigationRowNodes(focusState.rowKey).length > 0;
      if (!targetExists && focusState.focusKind !== "hero") {
        return false;
      }
    }
    const fallback = this.isRestoringFocusFromBack
      ? null
      : this.container.querySelector(this.getInitialFocusSelector());
    target = target || fallback;
    if (!target) {
      return false;
    }

    this.setFocusedNode(target);
    this.syncFocusedCollectionCardState();
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!this.isRestoringFocusFromBack && target.closest(".home-track, .home-grid-track")) {
      this.ensureTrackHorizontalVisibility(target);
    }
    if (!this.isRestoringFocusFromBack) {
      this.ensureMainVerticalVisibility(target);
    }
    return true;
  },

  focusInitialContinueWatchingCard() {
    if (this.homeHoldFocusLocked) {
      return false;
    }
    const target = this.getNavigationRowNodes("continue_watching")[0] || null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    this.syncFocusedCollectionCardState();
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    this.ensureTrackHorizontalVisibility(target);
    this.ensureMainVerticalVisibility(target);
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
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
    const key = axis === "y" ? "y" : "x";
    const startValue = Number(container[property] || 0);
    if (Math.abs(startValue - nextValue) <= 1) {
      container[property] = nextValue;
      return;
    }
    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    const effectiveDuration = Math.max(0, Number(duration || 0));
    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const springState = springMap.get(container);
    if (springState?.[key]?.raf) {
      cancelAnimationFrame(springState[key].raf);
      springState[key] = null;
      springMap.set(container, springState);
    }
    if (prefersReducedMotion || effectiveDuration <= 0) {
      container[property] = nextValue;
      return;
    }

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easing = typeof options?.easing === "function" ? options.easing : easeOutCubic;
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const existing = map.get(container) || {};
    if (existing[key]) {
      cancelAnimationFrame(existing[key]);
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / effectiveDuration);
      container[property] = Math.round(startValue + (nextValue - startValue) * easing(progress));
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
    const key = axis === "y" ? "y" : "x";
    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const tweenState = tweenMap.get(container);
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

  getModernCameraPanEasing() {
    return MODERN_CAMERA_PAN_EASING;
  },

  shouldUseDelayedModernCameraFollow(target, _direction = null) {
    return false;
  },

  cancelModernCameraFollow({ stopAnimations = false } = {}) {
    if (this.modernCameraFollowTimer) {
      clearTimeout(this.modernCameraFollowTimer);
      this.modernCameraFollowTimer = null;
    }
    const state = this.modernCameraFollowState || null;
    if (stopAnimations) {
      const horizontalContainers = [
        state?.horizontal?.container,
        this.modernCameraFollowLastHorizontalContainer
      ];
      const verticalContainers = [
        state?.vertical?.container,
        this.modernCameraFollowLastVerticalContainer
      ];
      horizontalContainers.forEach((container) => {
        if (container) {
          this.cancelScrollAnimation(container, "x");
        }
      });
      verticalContainers.forEach((container) => {
        if (container) {
          this.cancelScrollAnimation(container, "y");
        }
      });
    }
    this.modernCameraFollowState = null;
    this.modernCameraFollowLastHorizontalContainer = null;
    this.modernCameraFollowLastVerticalContainer = null;
  },

  isScrollAnimationActive(container, axis = "x") {
    if (!container) {
      return false;
    }
    const map = this.scrollAnimations || null;
    const state = map?.get?.(container) || null;
    const key = axis === "y" ? "y" : "x";
    const springMap = this.springScrollAnimations || null;
    const springState = springMap?.get?.(container) || null;
    return Boolean(state?.[key] || springState?.[key]?.raf);
  },

  shouldSuspendModernViewportFocusSync() {
    if (this.layoutMode !== "modern") {
      return false;
    }
    if (this.modernCameraFollowTimer) {
      return true;
    }
    if (this.modernVerticalFastScrollState) {
      return true;
    }
    return (
      this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y") ||
      this.isScrollAnimationActive(this.modernCameraFollowLastHorizontalContainer, "x")
    );
  },

  isSidebarFocusActive() {
    return Boolean(
      this.container?.querySelector(
        ".home-sidebar .focusable.focused, .modern-sidebar-panel .focusable.focused"
      )
    );
  },

  getRowFocusInset() {
    if (this.layoutMode === "modern") {
      return MODERN_HOME_CONSTANTS.rowFocusInset;
    }
    if (this.layoutMode === "grid") {
      return 24;
    }
    return 32;
  },

  getTrackEdgePadding() {
    if (this.layoutMode === "modern") {
      return MODERN_HOME_CONSTANTS.trackEdgePadding;
    }
    if (this.layoutMode === "grid") {
      return 24;
    }
    return 48;
  },

  getCachedModernLandscapePosterMetrics(shell = null) {
    if (this.cachedModernLandscapePosterMetrics) {
      return this.cachedModernLandscapePosterMetrics;
    }
    const targetShell =
      shell instanceof HTMLElement
        ? shell
        : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
    if (!(targetShell instanceof HTMLElement)) {
      return null;
    }
    const shellStyles = getComputedStyle(targetShell);
    const posterWidth = parseCssPx(
      shellStyles.getPropertyValue("--home-landscape-poster-width"),
      418
    );
    const posterHeight = parseCssPx(
      shellStyles.getPropertyValue("--home-landscape-poster-height"),
      Math.round(posterWidth / 1.77)
    );
    this.cachedModernLandscapePosterMetrics = {
      width: posterWidth,
      height: posterHeight
    };
    return this.cachedModernLandscapePosterMetrics;
  },

  applyCachedModernLandscapePosterMetrics(shell = null) {
    const targetShell =
      shell instanceof HTMLElement
        ? shell
        : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
    if (!(targetShell instanceof HTMLElement)) {
      return;
    }
    const metrics = this.getCachedModernLandscapePosterMetrics(targetShell);
    if (!metrics) {
      return;
    }
    targetShell.style.setProperty("--home-landscape-poster-width", `${metrics.width}px`);
    targetShell.style.setProperty("--home-landscape-poster-height", `${metrics.height}px`);
  },

  getCachedModernPortraitPosterMetrics(shell = null) {
    if (this.cachedModernPortraitPosterMetrics) {
      return this.cachedModernPortraitPosterMetrics;
    }
    const targetShell =
      shell instanceof HTMLElement
        ? shell
        : this.container?.querySelector(
            ".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)"
          );
    if (!(targetShell instanceof HTMLElement)) {
      return null;
    }
    const shellStyles = getComputedStyle(targetShell);
    const posterWidth = parseCssPx(
      shellStyles.getPropertyValue("--home-modern-portrait-poster-width"),
      228
    );
    const posterHeight = parseCssPx(
      shellStyles.getPropertyValue("--home-modern-portrait-poster-height"),
      Math.round(posterWidth * 1.5)
    );
    this.cachedModernPortraitPosterMetrics = {
      width: posterWidth,
      height: posterHeight,
      expandedWidth: Math.round(posterHeight * (16 / 9))
    };
    return this.cachedModernPortraitPosterMetrics;
  },

  applyCachedModernPortraitPosterMetrics(shell = null) {
    const targetShell =
      shell instanceof HTMLElement
        ? shell
        : this.container?.querySelector(
            ".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)"
          );
    if (!(targetShell instanceof HTMLElement)) {
      return;
    }
    const metrics = this.getCachedModernPortraitPosterMetrics(targetShell);
    if (!metrics) {
      return;
    }
    targetShell.style.setProperty("--home-modern-portrait-poster-width", `${metrics.width}px`);
    targetShell.style.setProperty("--home-modern-portrait-poster-height", `${metrics.height}px`);
    targetShell.style.setProperty(
      "--home-modern-portrait-expanded-width",
      `${metrics.expandedWidth}px`
    );
  },

  getHomeViewport() {
    return this.layoutMode === "modern"
      ? this.container?.querySelector(".home-modern-rows-viewport")
      : this.container?.querySelector(".home-main");
  },

  isLegacyTvRuntime() {
    if (Platform.isTizen()) {
      return true;
    }
    if (!Platform.isWebOS()) {
      return false;
    }
    const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
    return webOsMajor > 0 && webOsMajor <= 5;
  },

  shouldSuppressAutomaticTrailerPlayback() {
    return this.isLegacyTvRuntime() && !Platform.isTizen();
  },

  getFocusedPosterTrailerDelayMs() {
    if (Platform.isTizen()) {
      return 1600;
    }
    if (this.isLegacyTvRuntime()) {
      return 0;
    }
    if (this.isPerformanceConstrained()) {
      return 1400;
    }
    return 0;
  },

  isPerformanceConstrained() {
    return Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  },

  // Constrained TVs (all webOS/Tizen, plus low-end) cannot afford the animated
  // spring scroll on every focus move: each move runs a ~440ms rAF loop writing
  // scrollTop/scrollLeft per frame, which stacks into seconds of input lag. Snap
  // focus scrolling instead, matching the classic layout and Tizen behaviour.
  shouldUseImmediateFocusScroll() {
    return Boolean(Platform.isTizen() || this.isPerformanceConstrained());
  },

  hasCollectionHomeRows() {
    return Array.isArray(this.collections) && this.collections.length > 0;
  },

  getRowItemLimit() {
    if (this.isLegacyTvRuntime()) {
      return HOME_MAX_ITEMS_PER_ROW_LEGACY_TV;
    }
    if (Platform.isWebOS() && this.hasCollectionHomeRows()) {
      return this.collections.length > 2
        ? HOME_MAX_ITEMS_PER_ROW_LEGACY_TV
        : HOME_MAX_ITEMS_PER_ROW_CONSTRAINED;
    }
    return this.isPerformanceConstrained()
      ? HOME_MAX_ITEMS_PER_ROW_CONSTRAINED
      : HOME_MAX_ITEMS_PER_ROW_DEFAULT;
  },

  getLoadingRowItemCount() {
    if (this.isLegacyTvRuntime()) {
      return HOME_LOADING_ROW_ITEMS_LEGACY_TV;
    }
    if (Platform.isWebOS() && this.hasCollectionHomeRows()) {
      return HOME_LOADING_ROW_ITEMS_LEGACY_TV;
    }
    return this.isPerformanceConstrained()
      ? HOME_LOADING_ROW_ITEMS_CONSTRAINED
      : HOME_LOADING_ROW_ITEMS_DEFAULT;
  },

  getInitialCatalogLoadCount() {
    if (this.isPerformanceConstrained()) {
      if (this.isLegacyTvRuntime()) {
        return 4;
      }
      return 5;
    }
    if (Platform.isWebOS()) {
      if (this.hasCollectionHomeRows()) {
        return 4;
      }
      const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
      if (webOsMajor > 0 && webOsMajor <= 5) {
        return 4;
      }
      return Math.min(HOME_INITIAL_CATALOG_LOAD, 6);
    }
    if (Platform.isTizen()) {
      return Math.min(HOME_INITIAL_CATALOG_LOAD, 6);
    }
    return HOME_INITIAL_CATALOG_LOAD;
  },

  getDeferredCatalogBatchSize() {
    if (this.isPerformanceConstrained()) {
      return this.isLegacyTvRuntime() ? 2 : 4;
    }
    if (Platform.isWebOS()) {
      if (this.hasCollectionHomeRows()) {
        return 4;
      }
      const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
      if (webOsMajor > 0 && webOsMajor <= 5) {
        return 4;
      }
      return 8;
    }
    if (Platform.isTizen()) {
      return 8;
    }
    return 0;
  },

  getScrollDuration(base) {
    const baseline = Number.isFinite(base) ? base : 150;
    if (this.isLegacyTvRuntime()) {
      return 0;
    }
    if (this.isPerformanceConstrained()) {
      return Math.min(baseline, 90);
    }
    return baseline + 40;
  },

  shouldUseImmediateHorizontalScrollForNode(node) {
    return Boolean(
      node?.matches?.(".home-continue-card.focusable") &&
      (Platform.isWebOS() || this.isPerformanceConstrained() || this.isLegacyTvRuntime())
    );
  },

  shouldDeferContinueWatchingFocusEffects(node, direction = null, inputMeta = null) {
    void inputMeta;
    return Boolean(
      (direction === "left" || direction === "right") &&
      this.shouldUseImmediateHorizontalScrollForNode(node)
    );
  },

  scheduleDeferredContinueWatchingFocusEffects(node) {
    if (this.deferredContinueWatchingFocusTimer) {
      clearTimeout(this.deferredContinueWatchingFocusTimer);
      this.deferredContinueWatchingFocusTimer = null;
    }
    const target = node instanceof HTMLElement ? node : null;
    if (!target) {
      return;
    }
    this.deferredContinueWatchingFocusTimer = setTimeout(
      () => {
        this.deferredContinueWatchingFocusTimer = null;
        if (
          Router.getCurrent() !== "home" ||
          !target.isConnected ||
          this.getCurrentFocusedNode() !== target
        ) {
          return;
        }
        this.scheduleModernHeroUpdate(target);
      },
      this.isLegacyTvRuntime() ? 260 : 220
    );
  },

  getBackgroundRenderDelay() {
    if (this.isLegacyTvRuntime()) {
      const collectionCount = Array.isArray(this.collections) ? this.collections.length : 0;
      return collectionCount > 2
        ? HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS + 140
        : HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS;
    }
    if (this.isPerformanceConstrained()) {
      return HOME_BACKGROUND_RENDER_DELAY_MS;
    }
    return 0;
  },

  shouldProgressivelyRenderDeferredRows() {
    if (Platform.isWebOS() && this.hasCollectionHomeRows()) {
      return false;
    }
    return !this.isPerformanceConstrained();
  },

  getDirectionalRepeatThrottleMs(direction = null) {
    if ((direction === "left" || direction === "right") && isFastHorizontalNavigationEnabled()) {
      // Match Android TV's fast-horizontal D-pad gate while preserving
      // the existing vertical and constrained-runtime throttles.
      return 48;
    }
    if (!Platform.isBrowser()) {
      return direction === "up" || direction === "down"
        ? MODERN_HOME_CONSTANTS.verticalKeyRepeatThrottleMs
        : MODERN_HOME_CONSTANTS.keyRepeatThrottleMs;
    }
    if (this.isLegacyTvRuntime()) {
      return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 120);
    }
    if (this.isPerformanceConstrained()) {
      return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 100);
    }
    return MODERN_HOME_CONSTANTS.keyRepeatThrottleMs;
  },

  getHeroFocusDelay({ rapid = false } = {}) {
    if (this.isLegacyTvRuntime()) {
      return rapid ? 260 : 150;
    }
    return rapid ? MODERN_HOME_CONSTANTS.heroRapidSettleMs : MODERN_HOME_CONSTANTS.heroFocusDelayMs;
  },

  cancelScheduledRender() {
    if (this.homeRenderTimer) {
      clearTimeout(this.homeRenderTimer);
      this.homeRenderTimer = null;
    }
    if (this.homeRenderFrame) {
      cancelAnimationFrame(this.homeRenderFrame);
      this.homeRenderFrame = null;
    }
  },

  invalidateNavigationModel() {
    this.navigationDomVersion = Number(this.navigationDomVersion || 0) + 1;
    this.navModel = null;
  },

  requestRender(options = {}) {
    if (!this.container || Router.getCurrent() !== "home") {
      return;
    }
    const delayMs = Math.max(0, Number(options?.delayMs || 0));
    if (delayMs > 0) {
      if (this.homeRenderTimer) {
        clearTimeout(this.homeRenderTimer);
        this.homeRenderTimer = null;
      }
      if (this.homeRenderFrame) {
        return;
      }
      this.homeRenderTimer = setTimeout(() => {
        this.homeRenderTimer = null;
        this.requestRender();
      }, delayMs);
      return;
    }
    if (this.homeRenderTimer) {
      clearTimeout(this.homeRenderTimer);
      this.homeRenderTimer = null;
    }
    if (this.homeRenderFrame) {
      return;
    }
    this.homeRenderFrame = requestAnimationFrame(() => {
      this.homeRenderFrame = null;
      if (!this.container || Router.getCurrent() !== "home") {
        return;
      }
      this.render();
    });
  },

  requestBackgroundRender() {
    this.requestRender({ delayMs: this.getBackgroundRenderDelay() });
  },

  stopHeroRotation() {
    if (this.heroRotateTimer) {
      clearInterval(this.heroRotateTimer);
      this.heroRotateTimer = null;
    }
    if (this.heroRotateTimeout) {
      clearTimeout(this.heroRotateTimeout);
      this.heroRotateTimeout = null;
    }
  },

  cancelPendingHeroFocus() {
    if (this.heroFocusDelayTimer) {
      clearTimeout(this.heroFocusDelayTimer);
      this.heroFocusDelayTimer = null;
    }
    if (this.heroBackdropPreloadTimer) {
      clearTimeout(this.heroBackdropPreloadTimer);
      this.heroBackdropPreloadTimer = null;
    }
    if (this.deferredContinueWatchingFocusTimer) {
      clearTimeout(this.deferredContinueWatchingFocusTimer);
      this.deferredContinueWatchingFocusTimer = null;
    }
    this.heroFocusToken = Number(this.heroFocusToken || 0) + 1;
  },

  startHeroRotation() {
    this.stopHeroRotation();
    if (this.layoutMode === "modern" || this.isPerformanceConstrained()) {
      return;
    }
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    this.heroRotateTimeout = setTimeout(() => {
      if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
        this.rotateHero(1);
      }
      this.heroRotateTimer = setInterval(() => {
        if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
          this.rotateHero(1);
        }
      }, HERO_ROTATE_INTERVAL_MS);
    }, HERO_ROTATE_FIRST_DELAY_MS);
  },

  rotateHero(step = 1) {
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    const total = this.heroCandidates.length;
    this.heroIndex = (Number(this.heroIndex || 0) + step + total) % total;
    this.heroItem = this.heroCandidates[this.heroIndex];
    this.applyHeroToDom();
  },

  applyHeroToDom() {
    const heroNode = this.container?.querySelector(".home-hero-card");
    if (!heroNode) {
      return;
    }
    const hero = this.heroItem || this.heroCandidates?.[0] || null;
    if (!hero) {
      return;
    }

    const display =
      this.layoutMode === "modern"
        ? buildModernHeroPresentation(hero)
        : buildHeroDisplayModel(hero, this.layoutMode);
    if (!display) {
      return;
    }
    heroNode.dataset.itemId = hero?.id || "";
    heroNode.dataset.itemType = hero?.type || "movie";
    heroNode.dataset.itemTitle = hero?.name || "Untitled";
    heroNode.classList.toggle("is-hero-meta-enriching", Boolean(hero?.heroMetaEnriching));

    const backdrop = heroNode.querySelector(".home-hero-backdrop");
    if (backdrop) {
      const src = display.backdrop || "";
      if (this.layoutMode === "modern" && backdrop instanceof HTMLImageElement) {
        const shouldFreezeBackdrop =
          Boolean(hero?.heroMetaEnriching) && String(backdrop.getAttribute("src") || "").trim();
        if (!shouldFreezeBackdrop) {
          animateModernHeroBackdropSwap(backdrop, src, display.title || "featured");
        } else {
          backdrop.setAttribute("alt", display.title || "featured");
        }
      } else if (src) {
        backdrop.setAttribute("src", src);
        backdrop.setAttribute("alt", display.title || "featured");
        backdrop.classList.remove("placeholder");
      } else {
        backdrop.removeAttribute("src");
        backdrop.classList.add("placeholder");
      }
    }

    const logoNode = heroNode.querySelector(".home-hero-logo");
    const brandNode = heroNode.querySelector(".home-hero-brand");
    if (display.logo) {
      if (logoNode) {
        animateModernHeroLogoSwap(logoNode, display.logo, display.title || "logo");
      } else if (brandNode) {
        brandNode.insertAdjacentHTML(
          "afterbegin",
          `<img class="home-hero-logo home-hero-logo-transition-enter" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title || "logo")}" decoding="async" fetchpriority="high" />`
        );
        const insertedLogo = brandNode.querySelector(".home-hero-logo");
        requestAnimationFrame(() => {
          insertedLogo?.classList?.add("is-visible");
          setTimeout(
            () => insertedLogo?.classList?.remove("home-hero-logo-transition-enter", "is-visible"),
            HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS
          );
        });
      }
    } else if (logoNode) {
      logoNode.remove();
    }

    const titleNode = heroNode.querySelector(".home-hero-title-text");
    if (titleNode) {
      titleNode.textContent = display.title || "Untitled";
      titleNode.classList.toggle("is-hidden", Boolean(display.logo));
    }

    if (this.layoutMode === "modern") {
      const primaryNode = heroNode.querySelector(".home-modern-hero-meta-line");
      if (primaryNode) {
        primaryNode.innerHTML = renderModernHeroPrimary(display);
        primaryNode.classList.toggle(
          "is-empty",
          !display.leadingMeta.length && !display.trailingMeta.length && !display.showImdbPrimary
        );
      }

      const secondaryNode = heroNode.querySelector(".home-modern-hero-secondary");
      if (secondaryNode) {
        secondaryNode.innerHTML = renderModernHeroSecondary(display);
        secondaryNode.classList.toggle(
          "is-empty",
          !display.secondaryHighlightText &&
            !display.badges.length &&
            !display.showImdbSecondary &&
            !display.languageText
        );
      }
    } else {
      const primaryNode = heroNode.querySelector(".home-hero-meta-primary");
      if (primaryNode) {
        primaryNode.innerHTML = renderMetaTokens(display.metaPrimary);
        primaryNode.classList.toggle("is-empty", !display.metaPrimary.length);
      }

      const secondaryNode = heroNode.querySelector(".home-hero-meta-secondary");
      if (secondaryNode) {
        secondaryNode.innerHTML = renderMetaTokens(display.metaSecondary);
        secondaryNode.classList.toggle("is-empty", !display.metaSecondary.length);
      }

      const chipNode = heroNode.querySelector(".home-hero-chip-row");
      if (chipNode) {
        chipNode.innerHTML = display.chips
          .map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`)
          .join("");
        chipNode.classList.toggle("is-empty", !display.chips.length);
      }
    }

    const descriptionNode = heroNode.querySelector(".home-hero-description");
    if (descriptionNode) {
      descriptionNode.textContent = display.description || " ";
      descriptionNode.classList.toggle("is-empty", !display.description);
    }
    this.scheduleHomeTruncationUpdate({ scope: heroNode });
    this.syncCollectionHeroMedia(hero);

    const indicators = heroNode.querySelector(".home-hero-indicators");
    if (indicators) {
      indicators.innerHTML = buildHeroIndicators(this.heroCandidates, hero);
    }
  },

  setSidebarExpanded(expanded) {
    if (this.layoutPrefs?.modernSidebar) {
      this.sidebarExpanded = Boolean(expanded);
      return;
    }
    setLegacySidebarExpanded(this.container, expanded);
  },

  isSidebarNode(node) {
    return String(node?.dataset?.navZone || "") === "sidebar";
  },

  isMainNode(node) {
    return String(node?.dataset?.navZone || "") === "main";
  },

  getNodeRowKey(node) {
    if (!node) {
      return "";
    }
    if (node.classList?.contains("home-hero-card")) {
      return "__hero__";
    }
    return String(
      node.dataset?.navRowKey ||
        node.dataset?.rowKey ||
        node.closest?.("[data-row-key]")?.dataset?.rowKey ||
        ""
    );
  },

  getNavigationTrackNodes() {
    if (this.layoutMode === "grid") {
      return Array.from(this.container?.querySelectorAll("[data-track-row-key]") || []);
    }
    if (
      this.navModel?.domVersion === Number(this.navigationDomVersion || 0) &&
      Array.isArray(this.navModel?.tracks) &&
      this.navModel.tracks.length
    ) {
      return this.navModel.tracks.filter((node) => node?.isConnected);
    }
    return Array.from(this.container?.querySelectorAll("[data-track-row-key]") || []);
  },

  getNavigationRowSection(rowKey = "") {
    const key = String(rowKey || "").trim();
    if (!key) {
      return null;
    }
    const cached =
      this.navModel?.domVersion === Number(this.navigationDomVersion || 0)
        ? this.navModel?.rowSectionByKey?.get(key) || null
        : null;
    if (cached?.isConnected) {
      return cached;
    }
    return (
      Array.from(this.container?.querySelectorAll("[data-row-key]") || []).find(
        (node) => String(node.dataset.rowKey || "") === key
      ) || null
    );
  },

  getNavigationRowNodes(rowKey = "") {
    const key = String(rowKey || "").trim();
    if (!key) {
      return [];
    }
    const cached =
      this.navModel?.domVersion === Number(this.navigationDomVersion || 0)
        ? this.navModel?.rowNodesByRowKey?.get(key)
        : null;
    if (Array.isArray(cached) && cached.length) {
      return cached.filter((node) => node?.isConnected);
    }
    const rowSection = this.getNavigationRowSection(key);
    const track = rowSection?.querySelector?.(".home-track, .home-grid-track") || null;
    return Array.from(track?.querySelectorAll(".home-content-card.focusable") || []);
  },

  rememberMainRowFocus(node) {
    if (!this.isMainNode(node)) {
      return;
    }
    const rowKey = this.getNodeRowKey(node);
    if (!rowKey || rowKey === "__hero__") {
      return;
    }
    this.lastFocusedItemIndexByRowKey = {
      ...(this.lastFocusedItemIndexByRowKey || {}),
      [rowKey]: Math.max(0, Number(node.dataset?.navCol || 0))
    };
  },

  resolvePreferredNodeForRow(rowNodes = [], _fallbackCol = 0) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowKey = this.getNodeRowKey(rowNodes[0]);
    const storedIndex = rowKey ? Number(this.lastFocusedItemIndexByRowKey?.[rowKey]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusWithoutAutoScroll(target, { suppressDelegatedFocus = false } = {}) {
    if (suppressDelegatedFocus && target) {
      this.pendingDelegatedFocusTarget = target;
    }
    focusWithoutAutoScroll(target);
  },

  getCurrentFocusedNode() {
    if (this.currentFocusedNode && this.container?.contains(this.currentFocusedNode)) {
      return this.currentFocusedNode;
    }
    const focused = this.container?.querySelector(".focusable.focused") || null;
    this.currentFocusedNode = focused;
    return focused;
  },

  setCurrentFocusedNode(node = null) {
    this.currentFocusedNode = node instanceof HTMLElement ? node : null;
  },

  setFocusedNode(target, { suppressDelegatedFocus = false } = {}) {
    if (this.homeHoldFocusLocked) {
      return target instanceof HTMLElement ? target : null;
    }
    const current = this.getCurrentFocusedNode();
    if (current && current !== target && current.isConnected) {
      current.classList.remove("focused");
    }
    if (!(target instanceof HTMLElement)) {
      this.setCurrentFocusedNode(null);
      return null;
    }
    target.classList.add("focused");
    this.setCurrentFocusedNode(target);
    this.focusWithoutAutoScroll(target, { suppressDelegatedFocus });
    this.scheduleHomeLazyImageHydration(target);
    return target;
  },

  getInitialFocusSelector() {
    if (this.layoutMode === "grid") {
      return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-grid-track .home-content-card.focusable";
    }
    if (this.layoutMode === "classic") {
      return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
    }
    if (this.layoutMode === "modern") {
      return ".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
    }
    return ".home-main .focusable";
  },

  getNodeHeroSource(node) {
    if (!node) {
      return null;
    }
    if (node.classList.contains("home-hero-card")) {
      return this.heroItem || this.heroCandidates?.[0] || null;
    }
    if (node.dataset.cwIndex != null) {
      return normalizeContinueWatchingItem(
        this.continueWatchingDisplay?.[Number(node.dataset.cwIndex)] || null
      );
    }
    if (node.dataset.rowIndex != null && node.dataset.itemIndex != null) {
      const row = this.rows?.[Number(node.dataset.rowIndex)] || null;
      const item = row?.result?.data?.items?.[Number(node.dataset.itemIndex)] || null;
      return normalizeHomeRowItem(row, item);
    }
    return null;
  },

  getHeroSourceFromFocusState(focusState) {
    if (!focusState?.layoutMode) {
      return null;
    }
    if (focusState.focusKind === "hero") {
      return this.heroItem || this.heroCandidates?.[0] || null;
    }
    if (String(focusState.rowKey || "") === "continue_watching") {
      const index = Math.max(0, Number(focusState.itemIndex || 0));
      return normalizeContinueWatchingItem(this.continueWatchingDisplay?.[index] || null);
    }
    const row =
      (this.rows || []).find((entry) => {
        return (
          String(entry?.homeCatalogKey || buildModernRowKey(entry)) ===
          String(focusState.rowKey || "")
        );
      }) || null;
    const item = row?.result?.data?.items?.[Math.max(0, Number(focusState.itemIndex || 0))] || null;
    return normalizeHomeRowItem(row, item);
  },

  getContinueWatchingItemFromNode(node) {
    const index = Number(node?.dataset?.cwIndex ?? -1);
    if (!Number.isFinite(index) || index < 0) {
      return null;
    }
    return normalizeContinueWatchingItem(
      this.continueWatchingDisplay?.[index] || this.continueWatching?.[index] || null
    );
  },

  getContinueWatchingMenuItem() {
    const menu = this.continueWatchingMenu;
    if (!menu) {
      return null;
    }
    return normalizeContinueWatchingItem(
      this.continueWatchingDisplay?.find((item) => {
        return (
          String(item?.contentId || "") === String(menu.contentId || "") &&
          String(item?.videoId || "") === String(menu.videoId || "")
        );
      }) ||
        menu.item ||
        null
    );
  },

  isContinueWatchingItemWatched(item) {
    const contentId = String(item?.contentId || "");
    if (!contentId) {
      return false;
    }
    return Boolean(
      (this.watchedItems || []).some((entry) => String(entry?.contentId || "") === contentId)
    );
  },

  getContinueWatchingMenuOptions() {
    const item = this.getContinueWatchingMenuItem();
    if (!item) {
      return [];
    }
    const options = [
      { action: "details", label: t("cw_action_go_to_details", {}, "Go to details") }
    ];
    if (this.showContinueWatchingManualPlayOption) {
      options.push({ action: "playManually", label: t("play_manually", {}, "Play manually") });
    }
    if (!item.isNextUp) {
      options.push({
        action: "startOver",
        label: t("cw_action_start_from_beginning", {}, "Start from beginning")
      });
    }
    options.push({ action: "remove", label: t("cw_action_remove", {}, "Remove") });
    return options;
  },

  renderContinueWatchingMenu() {
    return "";
  },

  getPosterHoldMenuItem() {
    return this.posterHoldMenu?.item || null;
  },

  getPosterHoldMenuOptions() {
    const item = this.getPosterHoldMenuItem();
    if (!item?.id) {
      return [];
    }
    const isTraktLibrary = this.posterHoldMenu?.librarySourceMode === LibrarySourceMode.TRAKT;
    const options = [
      { action: "details", label: t("cw_action_go_to_details", {}, "Go to details") },
      {
        action: isTraktLibrary ? "manageLists" : "toggleLibrary",
        label: isTraktLibrary
          ? t("library_manage_lists", {}, "Manage Lists")
          : this.posterHoldMenu?.isSaved
            ? t("hero_remove_from_library", {}, "Remove from library")
            : t("hero_add_to_library", {}, "Add to library")
      }
    ];
    if (isPosterWatchedType(item.type)) {
      options.push({
        action: "toggleWatched",
        label: this.posterHoldMenu?.isWatched
          ? t("hero_mark_unwatched", {}, "Mark as unwatched")
          : t("hero_mark_watched", {}, "Mark as watched")
      });
    }
    return options;
  },

  renderPosterHoldMenu() {
    return "";
  },

  renderActiveHoldMenu() {
    return "";
  },

  destroyHomeHoldDialog({ afterExit = null } = {}) {
    const dialog = this._homeHoldDialog;
    this._homeHoldDialog = null;
    if (dialog) {
      dialog.destroy({ afterExit });
    } else if (typeof afterExit === "function") {
      afterExit();
    }
  },

  dismissContinueWatchingMenu() {
    this._homeHoldDialog = null;
    if (this.continueWatchingMenu) {
      this.pendingContinueWatchingFocusIndex = Math.max(
        0,
        Number(this.continueWatchingMenu.index || 0)
      );
    }
    this.continueWatchingMenu = null;
    this.restoreContinueWatchingMenuFocus();
    this.holdMenuScrollState = null;
  },

  dismissPosterHoldMenu() {
    this._homeHoldDialog = null;
    if (this.posterHoldMenu) {
      this.pendingPosterHoldFocus = {
        rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
        index: Number(this.posterHoldMenu.index || 0),
        rowKey: String(this.posterHoldMenu.rowKey || ""),
        itemId: String(this.posterHoldMenu.item?.id || "")
      };
    }
    this.posterHoldMenu = null;
    this.restorePosterHoldMenuFocus();
    this.holdMenuScrollState = null;
  },

  lockHomeHoldFocus() {
    this.homeHoldFocusLocked = true;
    const current = this.getCurrentFocusedNode();
    if (current?.isConnected) {
      current.classList.remove("focused");
    }
    if (
      document.activeElement instanceof HTMLElement &&
      this.container?.contains(document.activeElement)
    ) {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }
    this.setCurrentFocusedNode(null);
  },

  unlockHomeHoldFocus() {
    this.homeHoldFocusLocked = false;
  },

  captureHoldMenuScrollState() {
    const viewport = this.getHomeViewport();
    if (!viewport) {
      return null;
    }
    const trackStates = Object.fromEntries(
      Array.from(this.container?.querySelectorAll("[data-track-row-key]") || [])
        .map((track) => [String(track.dataset.trackRowKey || ""), Number(track.scrollLeft || 0)])
        .filter(([key]) => key)
    );
    return {
      mainScrollTop: Number(viewport.scrollTop || 0),
      trackStates
    };
  },

  restoreHoldMenuScrollState() {
    const state = this.holdMenuScrollState;
    const viewport = this.getHomeViewport();
    if (!state || !viewport) {
      return false;
    }
    Object.entries(state.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.container?.querySelector(`[data-track-row-key="${rowKey}"]`);
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(state.mainScrollTop || 0)));
    return true;
  },

  scheduleHoldMenuScrollRestore() {
    this.restoreHoldMenuScrollState();
    requestAnimationFrame(() => requestAnimationFrame(() => this.restoreHoldMenuScrollState()));
  },

  restoreContinueWatchingMenuFocus() {
    this.unlockHomeHoldFocus();
    const cards = this.getNavigationRowNodes("continue_watching");
    const target =
      cards[
        Math.max(0, Math.min(cards.length - 1, Number(this.pendingContinueWatchingFocusIndex || 0)))
      ] ||
      cards[cards.length - 1] ||
      null;
    this.pendingContinueWatchingFocusIndex = null;
    if (!target) {
      return;
    }
    this.setFocusedNode(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!this.restoreHoldMenuScrollState()) {
      this.ensureTrackHorizontalVisibility(target);
      this.ensureMainVerticalVisibility(target);
    }
  },

  // Find the card to re-focus after a poster hold menu closes. Use the stable
  // row key before numeric positions so row inserts and duplicate item ids do
  // not redirect focus to a different catalog.
  resolvePosterHoldRestoreTarget(pending) {
    if (!pending) {
      return null;
    }
    const rowKey = String(pending.rowKey || "");
    const itemId = String(pending.itemId || "");
    const rowSection = rowKey
      ? Array.from(this.container?.querySelectorAll("[data-row-key]") || []).find(
          (node) => String(node.dataset.rowKey || "") === rowKey
        ) || null
      : null;
    if (rowSection) {
      const rowCards = Array.from(rowSection.querySelectorAll(".home-poster-card.focusable"));
      const byRowIdentity = itemId
        ? rowCards.find((card) => String(card.dataset.itemId || "") === itemId) || null
        : null;
      if (byRowIdentity) {
        return byRowIdentity;
      }
      const byRowIndex =
        rowCards.find(
          (card) => Number(card.dataset.itemIndex || 0) === Number(pending.index || 0)
        ) || null;
      if (byRowIndex) {
        return byRowIndex;
      }
    }
    const byPosition =
      this.container?.querySelector(
        `.home-poster-card.focusable[data-row-index="${Number(pending.rowIndex || 0)}"][data-item-index="${Number(pending.index || 0)}"]`
      ) || null;
    if (byPosition) {
      return byPosition;
    }
    if (!itemId) {
      return null;
    }
    const cards =
      this.container?.querySelectorAll(".home-poster-card.focusable[data-item-id]") || [];
    for (let index = 0; index < cards.length; index += 1) {
      if (String(cards[index].dataset.itemId || "") === itemId) {
        return cards[index];
      }
    }
    return null;
  },

  restorePosterHoldMenuFocus() {
    this.unlockHomeHoldFocus();
    const pending = this.pendingPosterHoldFocus;
    this.pendingPosterHoldFocus = null;
    if (!pending) {
      return;
    }
    const target = this.resolvePosterHoldRestoreTarget(pending);
    if (!target) {
      return;
    }
    this.setFocusedNode(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!this.restoreHoldMenuScrollState()) {
      this.ensureTrackHorizontalVisibility(target);
      this.ensureMainVerticalVisibility(target);
    }
  },

  mountContinueWatchingDialog() {
    const item = this.getContinueWatchingMenuItem();
    if (!item) {
      return false;
    }
    this.lockHomeHoldFocus();
    this.destroyHomeHoldDialog();
    const options = this.getContinueWatchingMenuOptions();
    this._homeHoldDialog = new NuvioDialog({
      title: item.title || "Untitled",
      subtitle: t("cw_dialog_subtitle", {}, "Choose what you want to do with this item."),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: options.map((option, index) => ({
        label: option.label,
        key: option.action,
        onAction: () => {
          this.continueWatchingMenu = {
            ...(this.continueWatchingMenu || {}),
            optionIndex: index
          };
          void this.activateContinueWatchingMenuOption();
        }
      })),
      onDismiss: () => this.dismissContinueWatchingMenu()
    }).mount(document.body);
    this.suppressHoldMenuEnterUntilKeyUp = true;
    this.scheduleHoldMenuScrollRestore();
    return true;
  },

  mountPosterHoldDialog() {
    const item = this.getPosterHoldMenuItem();
    if (!item?.id) {
      return false;
    }
    this.lockHomeHoldFocus();
    this.destroyHomeHoldDialog();
    const options = this.getPosterHoldMenuOptions();
    this._homeHoldDialog = new NuvioDialog({
      title: item.name || "Untitled",
      subtitle: t("home_poster_dialog_subtitle", {}, "Title actions"),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: options.map((option, index) => ({
        label: option.label,
        key: option.action,
        onAction: () => {
          this.posterHoldMenu = {
            ...(this.posterHoldMenu || {}),
            optionIndex: index
          };
          void this.activatePosterHoldMenuOption();
        }
      })),
      onDismiss: () => this.dismissPosterHoldMenu()
    }).mount(document.body);
    this.suppressHoldMenuEnterUntilKeyUp = true;
    this.scheduleHoldMenuScrollRestore();
    return true;
  },

  getPosterListPickerOptions() {
    if (!this.posterListPicker) {
      return [];
    }
    const membership = this.posterListPicker.membership || {};
    const tabs = Array.isArray(this.posterListPicker.tabs) ? this.posterListPicker.tabs : [];
    return [
      ...tabs.map((tab) => ({
        action: `toggleLibraryList:${tab.key}`,
        label: tab.title || tab.key,
        selected: membership[tab.key] === true,
        className: "poster-list-picker-list-button"
      })),
      {
        action: "saveLibraryLists",
        label: t("action_save", {}, "Save"),
        className: "poster-list-picker-save-button"
      }
    ];
  },

  mountPosterListPickerDialog() {
    if (!this.posterListPicker) {
      return false;
    }
    this.lockHomeHoldFocus();
    this.destroyHomeHoldDialog();
    const item = this.posterListPicker.item || {};
    this._homeHoldDialog = new NuvioDialog({
      title: item.name || item.title || item.id || "Untitled",
      subtitle: t("detail_lists_subtitle", {}, "Choose which lists should include this title"),
      error: this.posterListPicker.error || null,
      widthVw: 52,
      buttons: this.getPosterListPickerOptions().map((option) => ({
        label: option.label,
        key: option.action,
        selected: option.selected,
        className: option.className,
        onAction: () => {
          void this.activatePosterListPickerOption(option.action);
        }
      })),
      panelClassName: "poster-list-picker-dialog-panel",
      actionsClassName: "poster-list-picker-actions",
      onDismiss: () => {
        this._homeHoldDialog = null;
        this.posterListPicker = null;
        this.restorePosterHoldMenuFocus();
        this.holdMenuScrollState = null;
      }
    }).mount(document.body);
    this.scheduleHoldMenuScrollRestore();
    return true;
  },

  async openPosterListPicker(item) {
    if (!item?.id) {
      return false;
    }
    const tabs = await libraryRepository.getListTabs().catch(() => []);
    const resolvedTabs =
      Array.isArray(tabs) && tabs.length
        ? tabs
        : [{ key: "local", title: t("detail.library", {}, "Library"), type: "local" }];
    const libraryItem = {
      itemId: item.id,
      itemType: item.type || "movie",
      title: item.name || item.title || item.id || "Untitled",
      poster: item.poster || null,
      background: item.background || item.backdrop || null,
      description: item.description || "",
      releaseInfo: item.releaseInfo || "",
      imdbRating: item.imdbRating == null ? null : Number(item.imdbRating),
      genres: Array.isArray(item.genres) ? item.genres : []
    };
    const snapshot = await libraryRepository
      .getMembershipSnapshot(libraryItem)
      .catch(() => ({ listMembership: {} }));
    if (this.posterHoldMenu) {
      this.pendingPosterHoldFocus = {
        rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
        index: Number(this.posterHoldMenu.index || 0),
        rowKey: String(this.posterHoldMenu.rowKey || ""),
        itemId: String(this.posterHoldMenu.item?.id || "")
      };
    }
    this.posterHoldMenu = null;
    this.posterListPicker = {
      item: libraryItem,
      tabs: resolvedTabs,
      membership: Object.fromEntries(
        resolvedTabs.map((tab) => [tab.key, Boolean(snapshot?.listMembership?.[tab.key])])
      ),
      error: ""
    };
    return this.mountPosterListPickerDialog();
  },

  async activatePosterListPickerOption(action) {
    if (!this.posterListPicker) {
      return false;
    }
    const normalizedAction = String(action || "");
    if (normalizedAction.startsWith("toggleLibraryList:")) {
      const key = normalizedAction.slice("toggleLibraryList:".length);
      this.posterListPicker.membership = {
        ...(this.posterListPicker.membership || {}),
        [key]: !this.posterListPicker.membership?.[key]
      };
      this._homeHoldDialog?.setButtonSelected?.(
        normalizedAction,
        Boolean(this.posterListPicker.membership[key])
      );
      return true;
    }
    if (normalizedAction === "saveLibraryLists") {
      try {
        await libraryRepository.applyMembershipChanges(this.posterListPicker.item, {
          desiredMembership: this.posterListPicker.membership || {}
        });
        this.posterListPicker = null;
        this.destroyHomeHoldDialog();
        this.restorePosterHoldMenuFocus();
        this.holdMenuScrollState = null;
      } catch (error) {
        console.warn("Failed to update library lists", error);
        this.posterListPicker.error = t(
          "detail_lists_save_failed",
          {},
          "Could not save list changes."
        );
        this.mountPosterListPickerDialog();
      }
      return true;
    }
    return false;
  },

  getPosterItemFromNode(node) {
    if (!node?.matches?.(".home-poster-card.focusable")) {
      return null;
    }
    if (this.resolveCollectionFolderTargetFromNode(node)) {
      return null;
    }
    return normalizeCatalogItem(
      {
        id: node.dataset.itemId || "",
        type: node.dataset.itemType || "movie",
        name: node.dataset.itemTitle || "Untitled",
        poster: node.dataset.posterSrc || null,
        background: node.dataset.backdropSrc || null,
        backdrop: node.dataset.backdropSrc || null,
        logo: node.dataset.logoSrc || null,
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
      },
      node.dataset.itemType || "movie"
    );
  },

  async openPosterHoldMenu(node) {
    const item = this.getPosterItemFromNode(node);
    if (!item?.id) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.cancelPendingContinueWatchingHold();
    this.continueWatchingMenu = null;
    this.holdMenuScrollState = this.captureHoldMenuScrollState();
    const [isSaved, isWatched] = await Promise.all([
      savedLibraryRepository.isSaved(item.id).catch(() => false),
      watchedItemsRepository.isWatched(item.id).catch(() => false)
    ]);
    const librarySourceMode = await libraryRepository
      .getSourceMode()
      .catch(() => LibrarySourceMode.LOCAL);
    this.posterHoldMenu = {
      item,
      index: Number(node?.dataset?.itemIndex || 0),
      rowIndex: Number(node?.dataset?.rowIndex || 0),
      rowKey: this.getNodeRowKey(node),
      optionIndex: 0,
      isSaved: Boolean(isSaved),
      isWatched: Boolean(isWatched),
      librarySourceMode
    };
    return this.mountPosterHoldDialog();
  },

  closePosterHoldMenu() {
    if (!this.posterHoldMenu) {
      return false;
    }
    this.pendingPosterHoldFocus = {
      rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
      index: Number(this.posterHoldMenu.index || 0),
      rowKey: String(this.posterHoldMenu.rowKey || ""),
      itemId: String(this.posterHoldMenu.item?.id || "")
    };
    this.posterHoldMenu = null;
    this.destroyHomeHoldDialog();
    this.restorePosterHoldMenuFocus();
    this.holdMenuScrollState = null;
    return true;
  },

  openContinueWatchingMenu(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.posterHoldMenu = null;
    this.holdMenuScrollState = this.captureHoldMenuScrollState();
    this.continueWatchingMenu = {
      contentId: item.contentId,
      videoId: item.videoId || "",
      index: Number(node?.dataset?.cwIndex || 0),
      optionIndex: 0,
      item
    };
    return this.mountContinueWatchingDialog();
  },

  closeContinueWatchingMenu() {
    if (!this.continueWatchingMenu) {
      return false;
    }
    this.pendingContinueWatchingFocusIndex = Math.max(
      0,
      Number(this.continueWatchingMenu.index || 0)
    );
    this.continueWatchingMenu = null;
    this.destroyHomeHoldDialog();
    this.restoreContinueWatchingMenuFocus();
    this.holdMenuScrollState = null;
    return true;
  },

  isPosterHoldTarget(node) {
    return (
      Boolean(node?.matches?.(".home-poster-card.focusable")) &&
      !this.resolveCollectionFolderTargetFromNode(node) &&
      String(node?.dataset?.action || "") === "openDetail"
    );
  },

  isHomeHoldTarget(node) {
    return this.isContinueWatchingHoldTarget(node) || this.isPosterHoldTarget(node);
  },

  openHoldMenuForNode(node) {
    if (this.isContinueWatchingHoldTarget(node)) {
      return this.openContinueWatchingMenu(node);
    }
    if (this.isPosterHoldTarget(node)) {
      void this.openPosterHoldMenu(node);
      return true;
    }
    return false;
  },

  cancelPendingContinueWatchingEnter() {
    if (this.pendingContinueWatchingEnterTimer) {
      clearTimeout(this.pendingContinueWatchingEnterTimer);
      this.pendingContinueWatchingEnterTimer = null;
    }
    this.pendingContinueWatchingEnterTarget = null;
  },

  isContinueWatchingHoldTarget(node) {
    return Boolean(node?.matches?.(".home-continue-card.focusable"));
  },

  cancelPendingContinueWatchingHold() {
    if (this.pendingContinueWatchingHoldTimer) {
      clearTimeout(this.pendingContinueWatchingHoldTimer);
      this.pendingContinueWatchingHoldTimer = null;
    }
    this.pendingContinueWatchingHoldTarget = null;
  },

  hasPendingContinueWatchingHold(node) {
    const pending = this.pendingContinueWatchingHoldTarget;
    if (!pending || !node) {
      return false;
    }
    if (pending.kind === "poster") {
      return (
        this.isPosterHoldTarget(node) &&
        String(node.dataset.itemId || "") === String(pending.itemId || "") &&
        String(node.dataset.itemType || "") === String(pending.itemType || "")
      );
    }
    return (
      String(node.dataset.itemId || "") === String(pending.itemId || "") &&
      String(node.dataset.videoId || "") === String(pending.videoId || "") &&
      String(node.dataset.season || "") === String(pending.season || "") &&
      String(node.dataset.episode || "") === String(pending.episode || "")
    );
  },

  startPendingContinueWatchingHold(node) {
    if (!this.isHomeHoldTarget(node)) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.cancelPendingContinueWatchingHold();
    const isPoster = this.isPosterHoldTarget(node);
    const item = isPoster
      ? this.getPosterItemFromNode(node)
      : this.getContinueWatchingItemFromNode(node);
    if (isPoster && !item?.id) {
      return false;
    }
    if (!isPoster && !item?.contentId) {
      return false;
    }
    this.pendingContinueWatchingHoldTarget = {
      kind: isPoster ? "poster" : "continueWatching",
      itemId: String(isPoster ? item.id : item.contentId || ""),
      itemType: String(isPoster ? item.type : ""),
      videoId: String(isPoster ? "" : item.videoId || ""),
      season: String(isPoster ? "" : (item.season ?? "")),
      episode: String(isPoster ? "" : (item.episode ?? "")),
      holdTriggered: false
    };
    this.pendingContinueWatchingHoldTimer = setTimeout(() => {
      this.pendingContinueWatchingHoldTimer = null;
      const pending = this.pendingContinueWatchingHoldTarget;
      if (!pending || Router.getCurrent() !== "home") {
        return;
      }
      const current =
        this.container?.querySelector(
          ".home-continue-card.focusable.focused, .home-poster-card.focusable.focused"
        ) || null;
      if (!this.hasPendingContinueWatchingHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      this.openHoldMenuForNode(current);
    }, CW_HOLD_DELAY_MS);
    return true;
  },

  completePendingContinueWatchingHold(node, event = null) {
    const pending = this.pendingContinueWatchingHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= CW_HOLD_DELAY_MS;
    const shouldOpenHoldMenu =
      !holdTriggered && heldLongEnough && this.hasPendingContinueWatchingHold(node);
    this.cancelPendingContinueWatchingHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        this.openHoldMenuForNode(node);
      }
      return true;
    }
    if (!this.isHomeHoldTarget(node)) {
      return false;
    }
    if (this.isPosterHoldTarget(node)) {
      this.openDetailFromNode(node);
      return true;
    }
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.openContinueWatchingFromItem(item);
    return true;
  },

  scheduleContinueWatchingEnter(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.pendingContinueWatchingEnterTarget = {
      contentId: item.contentId,
      videoId: String(item.videoId || "")
    };
    this.pendingContinueWatchingEnterTimer = setTimeout(() => {
      this.pendingContinueWatchingEnterTimer = null;
      const pending = this.pendingContinueWatchingEnterTarget;
      this.pendingContinueWatchingEnterTarget = null;
      if (!pending || Router.getCurrent() !== "home") {
        return;
      }
      const current =
        this.container?.querySelector(".home-continue-card.focusable.focused") || null;
      const focusedItem = this.getContinueWatchingItemFromNode(current);
      if (!focusedItem?.contentId) {
        return;
      }
      if (
        String(focusedItem.contentId) !== String(pending.contentId) ||
        String(focusedItem.videoId || "") !== String(pending.videoId || "")
      ) {
        return;
      }
      this.rememberReturnFocusForNode(current);
      this.openContinueWatchingFromItem(focusedItem);
    }, CW_ENTER_DELAY_MS);
    return true;
  },

  openContinueWatchingFromItem(item, options = {}) {
    const params = continueWatchingStreamParams(item, options);
    if (!params) {
      return false;
    }
    const normalized = normalizeContinueWatchingItem(item);
    const anchorIndex = Number(this.continueWatchingMenu?.index);
    this.cancelPendingContinueWatchingEnter();
    this.destroyHomeHoldDialog();
    this.rememberContinueWatchingReturnFocus(anchorIndex);
    this.continueWatchingMenu = null;
    this.holdMenuScrollState = null;

    Router.navigate("detail", {
      itemId: normalized.contentId,
      itemType:
        normalized.type || (isSeriesTypeForContinueWatching(normalized?.type) ? "series" : "movie"),
      imdbId: normalized.imdbId || null,
      tmdbId: normalized.tmdbId || null,
      traktId: normalized.traktId || null,
      fallbackTitle: normalized.title || normalized.contentId || "Untitled",
      autoOpenContinueWatching: true,
      returnHomeOnBack: true,
      resumeProgressMs: Number(params.resumePositionMs || 0) || 0,
      resumeProgressPercent: params.resumeProgressPercent ?? null,
      resumeDurationMs: Number(params.resumeDurationMs || 0) || 0,
      startFromBeginning: Boolean(params.startFromBeginning),
      manualSelection: Boolean(params.manualSelection),
      resumeVideoId: normalized.videoId || null,
      resumeSeason: normalized.season ?? null,
      resumeEpisode: normalized.episode ?? null,
      resumeStreamIdentity: params.resumeStreamIdentity || null
    });
    return true;
  },

  openContinueWatchingDetails(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    const anchorIndex = Number(this.continueWatchingMenu?.index);
    this.cancelPendingContinueWatchingEnter();
    this.rememberContinueWatchingReturnFocus(anchorIndex);
    this.continueWatchingMenu = null;
    this.holdMenuScrollState = null;
    this.destroyHomeHoldDialog({
      afterExit: () =>
        Router.navigate("detail", {
          itemId: normalized.contentId,
          itemType: normalized.type || "movie",
          imdbId: normalized.imdbId || null,
          tmdbId: normalized.tmdbId || null,
          traktId: normalized.traktId || null,
          fallbackTitle: normalized.title || normalized.contentId || "Untitled",
          fromContinueWatching: true,
          returnHomeOnBack: true,
          resumeVideoId: normalized.videoId || null,
          resumeSeason: normalized.season ?? null,
          resumeEpisode: normalized.episode ?? null,
          resumeStreamIdentity: normalized.streamIdentity || null
        })
    });
    return true;
  },

  pruneContinueWatchingItem(item) {
    const normalized = normalizeContinueWatchingItem(item);
    const contentId = String(normalized?.contentId || "");
    const videoId = String(normalized?.videoId || "");
    if (!contentId) {
      return;
    }
    this.clearContinueWatchingSnapshot();
    const matchesItem = (entry) => {
      if (String(entry?.contentId || "") !== contentId) {
        return false;
      }
      if (!videoId) {
        return true;
      }
      const entryVideoId = String(entry?.videoId || "");
      return !entryVideoId || entryVideoId === videoId;
    };
    this.allProgress = Array.isArray(this.allProgress)
      ? this.allProgress.filter((entry) => !matchesItem(entry))
      : [];
    this.continueWatching = Array.isArray(this.continueWatching)
      ? this.continueWatching.filter((entry) => !matchesItem(entry))
      : [];
    this.continueWatchingDisplay = Array.isArray(this.continueWatchingDisplay)
      ? this.continueWatchingDisplay.filter((entry) => !matchesItem(entry))
      : [];
    this.nextUpProgressCandidates = Array.isArray(this.nextUpProgressCandidates)
      ? this.nextUpProgressCandidates.filter((entry) => !matchesItem(entry))
      : [];
    this.continueWatchingLoading = false;
    if (this.layoutMode === "modern") {
      this.heroItem = this.pickInitialHero();
    }
  },

  async toggleContinueWatchingWatched(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    if (this.isContinueWatchingItemWatched(normalized)) {
      await watchedItemsRepository.unmark(normalized.contentId);
      this.watchedItems = Array.isArray(this.watchedItems)
        ? this.watchedItems.filter(
            (entry) => String(entry?.contentId || "") !== String(normalized.contentId)
          )
        : [];
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      return true;
    }
    await watchedItemsRepository.mark({
      contentId: normalized.contentId,
      contentType: normalized.type || "movie",
      title: normalized.title || normalized.contentId || "Untitled",
      watchedAt: Date.now()
    });
    await watchProgressRepository.saveProgress({
      contentId: normalized.contentId,
      contentType: normalized.type || "movie",
      videoId: normalized.videoId || null,
      season: normalized.season,
      episode: normalized.episode,
      positionMs: 100,
      durationMs: 100,
      updatedAt: Date.now()
    });
    this.watchedItems = [
      {
        contentId: normalized.contentId,
        contentType: normalized.type || "movie",
        title: normalized.title || normalized.contentId || "Untitled",
        watchedAt: Date.now()
      },
      ...(Array.isArray(this.watchedItems)
        ? this.watchedItems.filter(
            (entry) => String(entry?.contentId || "") !== String(normalized.contentId)
          )
        : [])
    ];
    this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
    this.pruneContinueWatchingItem(normalized);
    return true;
  },

  async removeContinueWatchingItem(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    if (normalized.isNextUp) {
      ContinueWatchingPreferences.addDismissedNextUpKey(normalized.contentId);
      this.pruneContinueWatchingItem(normalized);
      return true;
    }
    await watchProgressRepository.removeProgress(normalized.contentId, normalized.videoId || null);
    this.pruneContinueWatchingItem(normalized);
    return true;
  },

  async activateContinueWatchingMenuOption() {
    const item = this.getContinueWatchingMenuItem();
    const options = this.getContinueWatchingMenuOptions();
    const option =
      options[
        Math.max(
          0,
          Math.min(options.length - 1, Number(this.continueWatchingMenu?.optionIndex || 0))
        )
      ];
    if (!item || !option) {
      return false;
    }
    const anchorIndex = Math.max(0, Number(this.continueWatchingMenu?.index || 0));
    if (option.action === "resume") {
      return this.openContinueWatchingFromItem(item);
    }
    if (option.action === "startOver") {
      return this.openContinueWatchingFromItem(item, { startOver: true });
    }
    if (option.action === "playManually") {
      return this.openContinueWatchingFromItem(item, { manualSelection: true });
    }
    if (option.action === "details") {
      return this.openContinueWatchingDetails(item);
    }
    if (option.action === "remove") {
      await this.removeContinueWatchingItem(item);
    } else {
      return false;
    }
    this.destroyHomeHoldDialog();
    this.continueWatchingMenu = null;
    this.pendingContinueWatchingFocusIndex = anchorIndex;
    this.holdMenuScrollState = null;
    this.unlockHomeHoldFocus();
    this.render();
    return true;
  },

  async togglePosterLibrary(item) {
    if (!item?.id) {
      return false;
    }
    const saved = await savedLibraryRepository.toggle({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.name || item.id || "Untitled",
      poster: item.poster || null,
      background: item.background || item.backdrop || null
    });
    if (this.posterHoldMenu) {
      this.posterHoldMenu = { ...this.posterHoldMenu, isSaved: Boolean(saved) };
    }
    return true;
  },

  async togglePosterWatched(item) {
    if (!item?.id) {
      return false;
    }
    const watched = Boolean(
      this.posterHoldMenu?.isWatched ||
      (await watchedItemsRepository.isWatched(item.id).catch(() => false))
    );
    if (isSeriesTypeForContinueWatching(item.type)) {
      if (watched) {
        await watchedSeriesReconciliationService.unmarkSeriesWatched(item.id);
      } else {
        await watchedSeriesReconciliationService.markSeriesWatched(item.id, item.type || "series", {
          title: item.name || item.id || "Untitled"
        });
      }
      this.watchedItems = await watchedItemsRepository.getAll(2000).catch(() => this.watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      if (this.posterHoldMenu) {
        this.posterHoldMenu = { ...this.posterHoldMenu, isWatched: !watched };
      }
      return true;
    }
    if (watched) {
      await watchedItemsRepository.unmark(item.id);
      await watchProgressRepository.removeProgress(item.id, null).catch(() => false);
      this.watchedItems = Array.isArray(this.watchedItems)
        ? this.watchedItems.filter((entry) => String(entry?.contentId || "") !== String(item.id))
        : [];
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      if (this.posterHoldMenu) {
        this.posterHoldMenu = { ...this.posterHoldMenu, isWatched: false };
      }
      return true;
    }
    await watchedItemsRepository.mark({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.name || item.id || "Untitled",
      watchedAt: Date.now()
    });
    await watchProgressRepository.saveProgress({
      contentId: item.id,
      contentType: item.type || "movie",
      videoId: null,
      season: null,
      episode: null,
      positionMs: 100,
      durationMs: 100,
      updatedAt: Date.now()
    });
    this.watchedItems = [
      {
        contentId: item.id,
        contentType: item.type || "movie",
        title: item.name || item.id || "Untitled",
        watchedAt: Date.now()
      },
      ...(Array.isArray(this.watchedItems)
        ? this.watchedItems.filter((entry) => String(entry?.contentId || "") !== String(item.id))
        : [])
    ];
    this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
    if (this.posterHoldMenu) {
      this.posterHoldMenu = { ...this.posterHoldMenu, isWatched: true };
    }
    return true;
  },

  async activatePosterHoldMenuOption() {
    const item = this.getPosterHoldMenuItem();
    const options = this.getPosterHoldMenuOptions();
    const option =
      options[
        Math.max(0, Math.min(options.length - 1, Number(this.posterHoldMenu?.optionIndex || 0)))
      ];
    if (!item || !option) {
      return false;
    }
    const pendingFocus = this.posterHoldMenu
      ? {
          rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
          index: Number(this.posterHoldMenu.index || 0),
          rowKey: String(this.posterHoldMenu.rowKey || ""),
          itemId: String(this.posterHoldMenu.item?.id || "")
        }
      : null;
    if (option.action === "details") {
      if (pendingFocus) {
        const target = this.resolvePosterHoldRestoreTarget(pendingFocus);
        if (target) {
          this.rememberReturnFocusForNode(target);
        }
      }
      this.posterHoldMenu = null;
      this.holdMenuScrollState = null;
      this.unlockHomeHoldFocus();
      this.destroyHomeHoldDialog({
        afterExit: () =>
          Router.navigate("detail", {
            itemId: item.id,
            itemType: item.type || "movie",
            fallbackTitle: item.name || item.id || "Untitled",
            fallbackPoster: item.poster || "",
            fallbackBackground: item.background || item.backdrop || "",
            addonBaseUrl: item.addonBaseUrl || "",
            addonId: item.addonId || "",
            addonName: item.addonName || "",
            catalogType: item.catalogType || item.type || "movie"
          })
      });
      return true;
    }
    this.destroyHomeHoldDialog();
    if (option.action === "toggleLibrary") {
      await this.togglePosterLibrary(item);
    } else if (option.action === "manageLists") {
      return this.openPosterListPicker(item);
    } else if (option.action === "toggleWatched") {
      await this.togglePosterWatched(item);
    } else {
      return false;
    }
    this.pendingPosterHoldFocus = pendingFocus;
    this.posterHoldMenu = null;
    this.holdMenuScrollState = null;
    this.unlockHomeHoldFocus();
    this.render();
    return true;
  },

  openContinueWatchingFromNode(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    this.rememberReturnFocusForNode(node);
    this.openContinueWatchingFromItem(item);
  },

  scheduleModernHeroUpdate(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    const hero = this.getNodeHeroSource(node);
    if (!hero || !hero.id) {
      return;
    }
    const currentHeroIdentity = buildHeroIdentity(this.heroItem);
    const nextHeroIdentity = buildHeroIdentity(hero);
    if (
      currentHeroIdentity === nextHeroIdentity &&
      !this.heroItem?.heroMetaEnriching &&
      !shouldEnrichModernHero(hero)
    ) {
      this.syncCollectionHeroMedia(hero);
      return;
    }
    this.cancelPendingHeroFocus();
    const focusToken = Number(this.heroFocusToken || 0) + 1;
    this.heroFocusToken = focusToken;
    const scheduledHeroIdentity = nextHeroIdentity;
    const now = Date.now();
    const previous = Number(this.lastModernHeroNavAt || 0);
    const isRapidNav =
      previous > 0 && now - previous < MODERN_HOME_CONSTANTS.heroRapidNavThresholdMs;
    const delay = this.getHeroFocusDelay({ rapid: isRapidNav });
    this.lastModernHeroNavAt = now;
    const preloadDelay = Math.max(0, Math.min(120, delay - 80));
    this.heroBackdropPreloadTimer = setTimeout(() => {
      this.heroBackdropPreloadTimer = null;
      if (Number(this.heroFocusToken || 0) !== focusToken) {
        return;
      }
      const focusedNode = this.getCurrentFocusedNode();
      if (focusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
        return;
      }
      const focusedHero = this.getNodeHeroSource(node);
      if (buildHeroIdentity(focusedHero) !== scheduledHeroIdentity) {
        return;
      }
      const backdropSource = buildModernHeroPresentation(focusedHero)?.backdrop || "";
      void preloadImageSource(backdropSource);
    }, preloadDelay);
    this.heroFocusDelayTimer = setTimeout(() => {
      if (Number(this.heroFocusToken || 0) !== focusToken) {
        return;
      }
      const currentFocusedNode = this.getCurrentFocusedNode();
      if (
        currentFocusedNode !== node ||
        !node?.isConnected ||
        !node.classList.contains("focused")
      ) {
        return;
      }
      const currentHero = this.getNodeHeroSource(node);
      if (buildHeroIdentity(currentHero) !== scheduledHeroIdentity) {
        return;
      }
      requestAnimationFrame(() => {
        if (Number(this.heroFocusToken || 0) !== focusToken) {
          return;
        }
        const focusedNode = this.getCurrentFocusedNode();
        if (focusedNode !== node || !node?.isConnected || !node.classList.contains("focused")) {
          return;
        }
        const latestHero = this.getNodeHeroSource(node);
        if (!latestHero || buildHeroIdentity(latestHero) !== scheduledHeroIdentity) {
          return;
        }
        if (shouldEnrichModernHero(latestHero)) {
          void this.enrichCurrentHeroAsync(latestHero, focusToken, { deferCommit: true });
          return;
        }
        this.heroItem = latestHero;
        const matchedIndex = this.heroCandidates.findIndex(
          (item) => String(item?.id || "") === String(latestHero.id || "")
        );
        if (matchedIndex >= 0) {
          this.heroIndex = matchedIndex;
        }
        this.applyHeroToDom();
      });
    }, delay);
  },

  async enrichCurrentHeroAsync(hero, focusToken = Number(this.heroFocusToken || 0), options = {}) {
    if (
      !hero ||
      !hero.id ||
      hero.heroSource === "continueWatching" ||
      hero.heroSource === "collection"
    ) {
      return;
    }
    const itemId = String(hero.id);
    const itemType = String(hero.type || hero.apiType || "movie");
    const heroIdentity = buildHeroIdentity(hero);
    const deferCommit = Boolean(options?.deferCommit);
    const token = (this.heroEnrichmentToken = Number(this.heroEnrichmentToken || 0) + 1);
    const canCommitHero = () => {
      if (Number(this.heroEnrichmentToken) !== token) {
        return false;
      }
      if (Number(this.heroFocusToken || 0) !== Number(focusToken || 0)) {
        return false;
      }
      if (!deferCommit) {
        return String(this.heroItem?.id || "") === itemId;
      }
      if (Router.getCurrent() !== String(options?.routeName || "home")) {
        return false;
      }
      const focusedHero = this.getNodeHeroSource(this.getCurrentFocusedNode());
      return buildHeroIdentity(focusedHero) === heroIdentity;
    };
    const commitHero = async (resolvedHero, { merge = false } = {}) => {
      if (deferCommit) {
        const display = buildModernHeroPresentation(resolvedHero);
        await Promise.all([
          preloadImageSource(display?.backdrop),
          preloadImageSource(display?.logo)
        ]);
      }
      if (!canCommitHero()) {
        return false;
      }
      this.heroItem = resolvedHero;
      const matchedIndex = (this.heroCandidates || []).findIndex(
        (item) => String(item?.id || "") === itemId
      );
      if (matchedIndex >= 0) {
        this.heroIndex = matchedIndex;
      }
      if (merge) {
        this.mergeHeroIntoCatalogState(itemId, resolvedHero);
      }
      this.applyHeroToDom();
      return true;
    };
    const mdbImdbRatingPromise = withTimeout(
      mdbListRepository.getImdbRatingForItem(itemId, itemType),
      3500,
      null
    ).catch(() => null);
    try {
      const result = await Promise.race([
        metaRepository.getMetaFromAllAddons(itemType, itemId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("hero-enrich-timeout")), 4000))
      ]);
      if (!canCommitHero()) {
        return;
      }
      if (result?.status !== "success" || !result.data) {
        const fallbackHero = {
          ...(deferCommit ? hero : this.heroItem),
          heroMetaEnriched: true,
          heroMetaEnriching: false
        };
        await commitHero(fallbackHero);
        return;
      }
      const meta = result.data;
      const enrichedImdb = resolveImdbRating(meta);
      const mdbImdbRating = await mdbImdbRatingPromise;
      if (!canCommitHero()) {
        return;
      }
      const enrichedRuntime = parseRuntimeMinutes(meta.runtimeMinutes ?? meta.runtime);
      const mergedHero = {
        ...(deferCommit ? hero : this.heroItem),
        heroMetaEnriched: true,
        heroMetaEnriching: false,
        ...(mdbImdbRating != null
          ? { imdbRating: Number(mdbImdbRating) }
          : enrichedImdb != null
            ? { imdbRating: enrichedImdb }
            : {}),
        ...(enrichedRuntime > 0 ? { runtimeMinutes: enrichedRuntime } : {}),
        ...(meta.released ? { released: meta.released } : {}),
        ...(meta.releaseInfo ? { releaseInfo: meta.releaseInfo } : {}),
        ...(Array.isArray(meta.genres) && meta.genres.length ? { genres: meta.genres } : {}),
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.logo ? { logo: meta.logo } : {}),
        ...(meta.background ? { background: meta.background } : {})
      };
      await commitHero(mergedHero, { merge: true });
    } catch (_e) {
      if (canCommitHero()) {
        const fallbackHero = {
          ...(deferCommit ? hero : this.heroItem),
          heroMetaEnriched: true,
          heroMetaEnriching: false
        };
        await commitHero(fallbackHero);
      }
    }
  },

  mergeHeroIntoCatalogState(itemId, mergedHero) {
    this.heroCandidates = (this.heroCandidates || []).map((item) => {
      return String(item?.id || "") === itemId ? { ...item, ...mergedHero } : item;
    });
    this.rows = (this.rows || []).map((row) => {
      const items = row?.result?.data?.items;
      if (!Array.isArray(items)) {
        return row;
      }
      const nextItems = items.map((item) =>
        String(item?.id || "") === itemId ? { ...item, ...mergedHero } : item
      );
      return {
        ...row,
        result: {
          ...row.result,
          data: {
            ...(row.result?.data || {}),
            items: nextItems
          }
        }
      };
    });
  },

  isModernPosterNode(node) {
    return this.layoutMode === "modern" && Boolean(node?.classList?.contains("home-poster-card"));
  },

  resolveCollectionFolderTargetFromNode(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const directCollectionId = String(node.dataset.collectionId || "").trim();
    const directFolderId = String(node.dataset.folderId || "").trim();
    if (directCollectionId && directFolderId) {
      return {
        collectionId: directCollectionId,
        folderId: directFolderId
      };
    }

    const itemId = String(node.dataset.itemId || "").trim();
    const itemType = String(node.dataset.itemType || "")
      .trim()
      .toLowerCase();
    const encodedMatch =
      itemType === "collection_folder" ? itemId.match(/^collection:([^:]+):(.+)$/i) : null;
    if (encodedMatch?.[1] && encodedMatch?.[2]) {
      return {
        collectionId: encodedMatch[1],
        folderId: encodedMatch[2]
      };
    }

    const rowIndex = Number(node.dataset.rowIndex || -1);
    const itemIndex = Number(node.dataset.itemIndex || -1);
    if (
      !Number.isFinite(rowIndex) ||
      rowIndex < 0 ||
      !Number.isFinite(itemIndex) ||
      itemIndex < 0
    ) {
      return null;
    }
    const row = this.rows?.[rowIndex] || null;
    if (row?.rowKind !== "collection") {
      return null;
    }
    const item = row?.result?.data?.items?.[itemIndex] || null;
    const normalized = normalizeCollectionFolderItem(item, row.collection || null);
    if (!normalized?.collectionId || !normalized?.folderId) {
      return null;
    }
    return {
      collectionId: normalized.collectionId,
      folderId: normalized.folderId
    };
  },

  isCollectionFolderNode(node) {
    return Boolean(this.resolveCollectionFolderTargetFromNode(node));
  },

  shouldPreserveCollectionHeroMedia(node) {
    if (!this.isCollectionFolderNode(node)) {
      return false;
    }
    return Boolean(firstNonEmpty(this.getNodeHeroSource(node)?.heroVideoUrl));
  },

  hydrateCollectionFocusGif(node, active = false) {
    const gifNode = node?.querySelector?.(".home-poster-focus-gif") || null;
    if (!(gifNode instanceof HTMLImageElement)) {
      return;
    }
    if (active) {
      const src = String(gifNode.dataset.src || gifNode.getAttribute("src") || "").trim();
      if (src && !gifNode.getAttribute("src")) {
        gifNode.setAttribute("src", src);
      }
      node.classList.add("is-focus-gif-active");
      return;
    }
    node.classList.remove("is-focus-gif-active");
  },

  syncFocusedCollectionCardState() {
    const focused = this.getCurrentFocusedNode();
    const focusedCollection = focused?.classList?.contains("home-collection-card") ? focused : null;
    if (
      this.activeCollectionFocusGifNode &&
      this.activeCollectionFocusGifNode !== focusedCollection &&
      this.activeCollectionFocusGifNode.isConnected
    ) {
      this.hydrateCollectionFocusGif(this.activeCollectionFocusGifNode, false);
    }
    if (focusedCollection) {
      this.hydrateCollectionFocusGif(focusedCollection, true);
      this.activeCollectionFocusGifNode = focusedCollection;
    } else {
      this.activeCollectionFocusGifNode = null;
    }
  },

  syncCollectionHeroMedia(hero = null) {
    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    const activeHero = isCollectionFolderItem(hero) ? normalizeCollectionFolderItem(hero) : null;
    const videoUrl = firstNonEmpty(activeHero?.heroVideoUrl);
    const playbackKey =
      videoUrl && activeHero ? `${activeHero.collectionId}:${activeHero.folderId}:${videoUrl}` : "";
    if (!heroLayer || !heroMedia || !playbackKey) {
      if (this.collectionHeroMediaKey) {
        this.collectionHeroMediaKey = "";
        this.clearTrailerLayer(heroLayer);
        heroMedia.classList.remove("trailer-active");
      }
      return;
    }
    if (this.collectionHeroMediaKey === playbackKey && heroLayer.querySelector("video")) {
      if (heroLayer.classList.contains("is-active")) {
        heroMedia.classList.add("trailer-active");
      }
      return;
    }
    this.collectionHeroMediaKey = playbackKey;
    this.heroTrailerPlaybackState = null;
    this.mountTrailerLayer(heroLayer, { kind: "video", url: videoUrl, muted: true }, () => {
      if (this.collectionHeroMediaKey === playbackKey) {
        heroMedia.classList.add("trailer-active");
      }
    });
  },

  hydrateFocusedPosterAssets(node, { defer = false } = {}) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
    const hydrate = () => {
      const backdrop = node.querySelector(".home-poster-expanded-backdrop");
      if (backdrop?.tagName === "IMG") {
        const src = String(backdrop.dataset.src || backdrop.getAttribute("src") || "").trim();
        const markBackdropReady = () => {
          if (node.isConnected) {
            node.classList.add("is-expanded-backdrop-ready");
          }
          backdrop.dataset.loadState = "ready";
        };
        const markBackdropPending = () => {
          node.classList.remove("is-expanded-backdrop-ready");
          backdrop.dataset.loadState = src ? "pending" : "";
        };
        if (src && !backdrop.getAttribute("src")) {
          backdrop.setAttribute("src", src);
        }
        if (backdrop.complete && Number(backdrop.naturalWidth || 0) > 0) {
          markBackdropReady();
        } else if (src) {
          markBackdropPending();
          if (backdrop.dataset.loadBound !== "true") {
            backdrop.dataset.loadBound = "true";
            backdrop.addEventListener(
              "load",
              () => {
                markBackdropReady();
              },
              { once: true }
            );
            backdrop.addEventListener(
              "error",
              () => {
                if (node.isConnected) {
                  node.classList.remove("is-expanded-backdrop-ready");
                }
                backdrop.dataset.loadState = "error";
                backdrop.dataset.loadBound = "false";
              },
              { once: true }
            );
          }
        } else {
          markBackdropPending();
        }
        backdrop.removeAttribute("data-src");
      } else {
        node.classList.remove("is-expanded-backdrop-ready");
      }
      const logo = node.querySelector(".home-poster-expanded-logo[data-src]");
      if (logo) {
        const src = String(logo.dataset.src || "").trim();
        if (src && !logo.getAttribute("src")) {
          logo.setAttribute("src", src);
        }
        logo.removeAttribute("data-src");
      }
    };
    if (!defer) {
      hydrate();
      return;
    }
    const run = () => {
      if (!node.isConnected || !node.classList.contains("is-expanded")) {
        return;
      }
      hydrate();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 400 });
    } else {
      setTimeout(run, 0);
    }
  },

  promotePosterCardAssets(node, { includeNeighbors = false } = {}) {
    const promoteCard = (card, isPrimary = false) => {
      if (!this.isModernPosterNode(card)) {
        return;
      }
      const poster = card.querySelector(".content-poster");
      if (poster instanceof HTMLImageElement) {
        poster.loading = "eager";
        poster.decoding = "async";
        if (isPrimary) {
          try {
            poster.fetchPriority = "high";
          } catch (_) {}
        }
      }
      if (isPrimary) {
        this.hydrateFocusedPosterAssets(card);
      }
    };

    promoteCard(node, true);
    if (!includeNeighbors) {
      return;
    }
    const siblings = Array.from(
      node?.closest(".home-track")?.querySelectorAll(".home-poster-card") || []
    );
    const index = siblings.indexOf(node);
    [siblings[index - 1], siblings[index + 1]].forEach((sibling) => {
      if (sibling) {
        promoteCard(sibling, false);
      }
    });
  },

  clearTrailerLayer(container) {
    if (!container) {
      return;
    }
    const activeFrame = container.querySelector("iframe");
    if (activeFrame) {
      this.homeTrailerFrameCleanup?.get(activeFrame)?.();
      this.homeTrailerFrameCleanup?.delete(activeFrame);
      try {
        activeFrame.src = "about:blank";
      } catch (_) {}
      try {
        activeFrame.removeAttribute("src");
      } catch (_) {}
    }
    const activeVideo = container.querySelector("video");
    if (activeVideo) {
      try {
        activeVideo.pause();
        activeVideo.removeAttribute("src");
        activeVideo.load?.();
      } catch (_) {}
    }
    container.innerHTML = "";
    container.classList.remove("is-active");
  },

  restorePersistentHeroTrailer(node, options = {}) {
    if (!this.isModernPosterNode(node)) {
      return false;
    }
    const shouldExpand = Boolean(options?.shouldExpand);
    const shouldPreviewTrailer = Boolean(options?.shouldPreviewTrailer);
    const trailerTarget = String(options?.trailerTarget || "hero_media").toLowerCase();
    const flowKey = String(options?.flowKey || this.getFocusedPosterFlowKey(node) || "");
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer || trailerTarget !== "hero_media" || !flowKey) {
      return false;
    }
    const cachedState = this.heroTrailerPlaybackState;
    if (!cachedState?.source || String(cachedState.key || "") !== flowKey) {
      return false;
    }
    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    if (!heroLayer || !heroMedia) {
      return false;
    }
    heroMedia.classList.remove("trailer-active");
    this.mountTrailerLayer(heroLayer, cachedState.source, () => {
      if (
        node.classList.contains("focused") &&
        String(this.getFocusedPosterFlowKey(node) || "") === flowKey
      ) {
        heroMedia.classList.add("trailer-active");
      }
    });
    return true;
  },

  getFocusedPosterFlowConfig(prefs = this.layoutPrefs || {}) {
    const useLandscapePosters = Boolean(prefs.modernLandscapePostersEnabled);
    const expandSettingEnabled = Boolean(prefs.focusedPosterBackdropExpandEnabled);
    const requestedTrailerTarget =
      String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase() ===
      "expanded_card"
        ? "expanded_card"
        : "hero_media";
    const trailerEnabled =
      Boolean(prefs.focusedPosterBackdropTrailerEnabled) &&
      !this.shouldSuppressAutomaticTrailerPlayback();
    const shouldPreviewTrailer = trailerEnabled && (useLandscapePosters || expandSettingEnabled);
    const landscapeExpandedCardMode =
      useLandscapePosters && shouldPreviewTrailer && requestedTrailerTarget === "expanded_card";
    const shouldExpand =
      (expandSettingEnabled && !useLandscapePosters) || landscapeExpandedCardMode;
    return {
      shouldExpand,
      shouldPreviewTrailer,
      trailerTarget: shouldExpand ? requestedTrailerTarget : "hero_media"
    };
  },

  mountTrailerLayer(container, source, onReady = null) {
    if (!container || !source) {
      return;
    }
    this.clearTrailerLayer(container);
    if (source.kind === "youtube" && source.embedUrl) {
      const frame = document.createElement("iframe");
      frame.className = "home-inline-trailer-frame";
      frame.src = source.embedUrl;
      frame.title = "Trailer preview";
      frame.allow = "autoplay; encrypted-media; picture-in-picture";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      let revealTimer = 0;
      let fallbackTimer = 0;
      let revealed = false;
      const reveal = (delayMs = 0) => {
        if (revealed || revealTimer) {
          return;
        }
        revealTimer = setTimeout(() => {
          revealTimer = 0;
          if (revealed || !frame.isConnected || frame.parentElement !== container) {
            return;
          }
          revealed = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = 0;
          }
          container.classList.add("is-active");
          onReady?.();
        }, delayMs);
      };
      const handleProxyMessage = (event) => {
        if (event?.source !== frame.contentWindow) {
          return;
        }
        const data = event?.data;
        if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
          return;
        }
        if (data.type === "firstFrame") {
          reveal(150);
          return;
        }
        const state =
          data.type === "state" && data.state && typeof data.state === "object" ? data.state : null;
        if (state && Number(state.currentTime || 0) > 0 && state.paused === false) {
          reveal(150);
        } else if (state && state.controllable === false && state.loading === false) {
          reveal(1200);
        }
      };
      const cleanup = () => {
        window.removeEventListener("message", handleProxyMessage);
        if (revealTimer) {
          clearTimeout(revealTimer);
          revealTimer = 0;
        }
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = 0;
        }
      };
      this.homeTrailerFrameCleanup ||= new WeakMap();
      this.homeTrailerFrameCleanup.set(frame, cleanup);
      window.addEventListener("message", handleProxyMessage);
      frame.addEventListener(
        "load",
        () => {
          if (!revealed) {
            fallbackTimer = setTimeout(() => reveal(), 7000);
          }
        },
        { once: true }
      );
      container.appendChild(frame);
      return;
    }
    if (source.kind === "video" && source.url) {
      const shouldMute = source.muted !== false;
      const video = document.createElement("video");
      video.className = "home-inline-trailer-video";
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.defaultMuted = shouldMute;
      video.muted = shouldMute;
      video.preload = "auto";
      video.setAttribute("autoplay", "");
      video.setAttribute("loop", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      if (shouldMute) {
        video.setAttribute("muted", "");
      } else {
        video.removeAttribute("muted");
      }
      try {
        video.volume = shouldMute ? 0 : 1;
      } catch (_) {}
      try {
        video.disableRemotePlayback = true;
      } catch (_) {}

      let didActivate = false;
      const activate = () => {
        if (didActivate) {
          return;
        }
        didActivate = true;
        container.classList.add("is-active");
        onReady?.();
      };
      ["playing", "canplay", "loadeddata", "loadedmetadata", "timeupdate"].forEach((eventName) => {
        video.addEventListener(eventName, activate, { once: true });
      });
      video.addEventListener(
        "error",
        () => {
          console.warn("Home inline MP4 hero video failed", {
            url: String(source.url || ""),
            code: video.error?.code || 0,
            message: video.error?.message || ""
          });
        },
        { once: true }
      );
      container.appendChild(video);
      video.setAttribute("src", String(source.url || ""));
      try {
        video.load?.();
      } catch (_) {}
      const playAttempt = video.play?.();
      if (playAttempt?.then) {
        playAttempt.then(activate).catch((error) => {
          console.warn("Home inline MP4 hero video autoplay failed", error);
        });
      } else {
        setTimeout(() => {
          if (video.isConnected && !didActivate && Number(video.readyState || 0) >= 2) {
            activate();
          }
        }, 500);
      }
    }
  },

  collapseFocusedPoster(node = this.expandedPosterNode, options = {}) {
    // Avoid overlapping flex-size transitions that leave stale poster layers on TV runtimes.
    const instant = Boolean(options?.instant || Platform.isTizen() || Platform.isWebOS());
    const preserveHeroMedia = Boolean(options?.preserveHeroMedia);
    const excludeNode = options?.excludeNode instanceof HTMLElement ? options.excludeNode : null;
    const targets = new Set();
    if (node instanceof HTMLElement && node !== excludeNode) {
      targets.add(node);
    }
    Array.from(
      this.container?.querySelectorAll(
        ".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active"
      ) || []
    ).forEach((card) => {
      if (card !== excludeNode) {
        targets.add(card);
      }
    });
    targets.forEach((target) => {
      const frame = target?.querySelector?.(".home-poster-frame") || null;
      const previousCardTransition =
        instant && target instanceof HTMLElement ? target.style.transition : "";
      const previousFrameTransition =
        instant && frame instanceof HTMLElement ? frame.style.transition : "";
      // TV performance CSS marks these transitions !important, so the instant collapse must match it.
      if (instant && target instanceof HTMLElement) {
        target.style.setProperty("transition", "none", "important");
      }
      if (instant && frame instanceof HTMLElement) {
        frame.style.setProperty("transition", "none", "important");
      }
      target.classList.remove("is-expanded", "is-trailer-active", "is-expanded-backdrop-ready");
      this.clearTrailerLayer(target.querySelector(".home-poster-trailer-layer"));
      if (instant && target instanceof HTMLElement) {
        void target.offsetWidth;
        requestAnimationFrame(() => {
          if (target.isConnected) {
            target.style.transition = previousCardTransition;
          }
          if (frame instanceof HTMLElement && frame.isConnected) {
            frame.style.transition = previousFrameTransition;
          }
        });
      }
    });
    if (!preserveHeroMedia) {
      const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
      this.clearTrailerLayer(heroLayer);
      this.container?.querySelector(".home-modern-hero-media")?.classList.remove("trailer-active");
      this.heroTrailerPlaybackState = null;
    }
    if (
      !this.expandedPosterNode?.isConnected ||
      !this.expandedPosterNode?.classList?.contains("is-expanded")
    ) {
      this.expandedPosterNode = null;
    }
  },

  expandFocusedPoster(node) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
    const hasOtherExpandedPosters = Array.from(
      this.container?.querySelectorAll(
        ".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active"
      ) || []
    ).some((card) => card !== node);
    if ((this.expandedPosterNode && this.expandedPosterNode !== node) || hasOtherExpandedPosters) {
      this.collapseFocusedPoster(this.expandedPosterNode, { excludeNode: node });
    }
    node.classList.add("is-expanded");
    this.hydrateFocusedPosterAssets(node);
    this.expandedPosterNode = node;
    requestAnimationFrame(() => {
      if (node.classList.contains("focused")) {
        this.ensureTrackHorizontalVisibility(node);
      }
    });
  },

  async getTrailerSourceForItem(item) {
    if (isCollectionFolderItem(item)) {
      return null;
    }
    const itemId = String(item?.id || item?.contentId || "").trim();
    const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
    if (!itemId) {
      return null;
    }
    try {
      const inlineSource = await withTimeout(
        resolveTrailerMetaWithTmdbFallback(
          { ...(item || {}), id: itemId, type: itemType },
          itemType
        ),
        2200,
        null
      );
      if (inlineSource) {
        return inlineSource;
      }

      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(itemType, itemId),
        3200,
        { status: "error", message: "timeout" }
      );
      const source =
        result?.status === "success"
          ? await resolveTrailerMetaWithTmdbFallback(
              { ...(result?.data || {}), id: itemId, type: itemType },
              itemType
            )
          : null;
      return source || null;
    } catch (error) {
      console.warn("Home trailer preview lookup failed", error);
      return null;
    }
  },

  async activateFocusedPosterFlow(node, flowToken = Number(this.focusedPosterFlowToken || 0)) {
    if (!this.isModernPosterNode(node) || !node.classList.contains("focused")) {
      return;
    }
    if (this.isCollectionFolderNode(node)) {
      this.collapseFocusedPoster(this.expandedPosterNode, {
        instant: true,
        preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 140);
      });
      if (
        !node.classList.contains("focused") ||
        Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)
      ) {
        return;
      }
      this.hydrateCollectionFocusGif(node, true);
      return;
    }
    const prefs = this.layoutPrefs || {};
    const { shouldExpand, shouldPreviewTrailer, trailerTarget } =
      this.getFocusedPosterFlowConfig(prefs);
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer) {
      return;
    }
    const trailerDelayMs = this.getFocusedPosterTrailerDelayMs();
    if (trailerDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, trailerDelayMs);
      });
      if (
        Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0) ||
        !node.classList.contains("focused")
      ) {
        return;
      }
    }

    const sourceItem = this.getNodeHeroSource(node);
    const baseSource = await this.getTrailerSourceForItem(sourceItem);
    if (Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)) {
      return;
    }
    const source = applyTrailerAudioPreferences(baseSource, prefs);
    if (!source || !node.classList.contains("focused")) {
      return;
    }
    const flowKey = this.getFocusedPosterFlowKey(node);

    if (trailerTarget === "expanded_card" && shouldExpand) {
      this.heroTrailerPlaybackState = null;
      const trailerLayer = node.querySelector(".home-poster-trailer-layer");
      if (trailerLayer) {
        this.mountTrailerLayer(trailerLayer, source, () => {
          if (
            node.classList.contains("focused") &&
            Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)
          ) {
            node.classList.add("is-trailer-active");
          }
        });
      }
      return;
    }

    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    if (heroLayer && heroMedia) {
      this.heroTrailerPlaybackState = {
        key: flowKey,
        source
      };
      this.mountTrailerLayer(heroLayer, source, () => {
        if (
          node.classList.contains("focused") &&
          Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)
        ) {
          heroMedia.classList.add("trailer-active");
        }
      });
    }
  },

  cancelFocusedPosterFlow() {
    if (this.focusedPosterTimer) {
      clearTimeout(this.focusedPosterTimer);
      this.focusedPosterTimer = null;
    }
    this.focusedPosterFlowToken = Number(this.focusedPosterFlowToken || 0) + 1;
  },

  clearFocusedPosterFlowState() {
    this.focusedPosterFlowState = null;
  },

  getFocusedPosterFlowKey(node) {
    const heroSource = this.getNodeHeroSource(node);
    const itemId = String(
      node?.dataset?.itemId || node?.dataset?.contentId || heroSource?.id || ""
    ).trim();
    const itemType = String(node?.dataset?.itemType || heroSource?.type || "")
      .trim()
      .toLowerCase();
    if (!itemId) {
      return "";
    }
    return `${itemType}:${itemId}`;
  },

  scheduleHomeTruncationUpdate({ scope = null } = {}) {
    if (!this.container) {
      return;
    }
    this.homeTruncationScope = scope || null;
    if (this.homeTruncationFrame) {
      cancelAnimationFrame(this.homeTruncationFrame);
    }
    this.homeTruncationFrame = requestAnimationFrame(() => {
      this.homeTruncationFrame = null;
      this.applyHomeTruncationState();
    });
  },

  applyHomeTruncationState() {
    if (!this.container) {
      return;
    }
    const modernHeroDescriptionWordLimit = 40;
    const root = this.homeTruncationScope || this.container;
    this.homeTruncationScope = null;
    this.applyModernHeroDescriptionBounds(root);
    const truncationSelector = this.isPerformanceConstrained()
      ? ".home-hero-description"
      : ".home-hero-description, .home-poster-title, .home-poster-subtitle";
    const nodes = root.querySelectorAll(truncationSelector);
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const currentText = node.textContent ?? "";
      const storedText = node.dataset.fullText || "";
      const shouldRefresh =
        !storedText ||
        (currentText && currentText !== storedText && !currentText.trim().endsWith("..."));
      const sourceText = shouldRefresh ? currentText : storedText;
      const isModernHeroDescription =
        node.classList.contains("home-hero-description") &&
        Boolean(node.closest(".home-modern-hero-copy"));
      const { text: fullText, truncated: wordTrimmed } = isModernHeroDescription
        ? limitTextToWordCount(sourceText, modernHeroDescriptionWordLimit)
        : { text: sourceText, truncated: false };
      if (!fullText) {
        return;
      }
      node.dataset.fullText = fullText;
      node.textContent = wordTrimmed ? `${fullText}...` : fullText;
      const fits =
        node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1;
      if (fits) {
        node.classList.toggle("is-truncated", wordTrimmed);
        return;
      }

      const ellipsis = "...";
      let low = 0;
      let high = fullText.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        node.textContent = `${fullText.slice(0, mid).trimEnd()}${ellipsis}`;
        const overflows =
          node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
        if (overflows) {
          high = mid - 1;
        } else {
          low = mid;
        }
      }
      const finalText = `${fullText.slice(0, Math.max(0, low)).trimEnd()}${ellipsis}`;
      node.textContent = finalText;
      node.classList.add("is-truncated");
    });
  },

  applyModernHeroDescriptionBounds(root = null) {
    if (!this.container || this.layoutMode !== "modern") {
      return;
    }
    const modernHeroDescriptionMaxLines = 4;
    const scope = root instanceof HTMLElement ? root : this.container;
    const heroNodes = scope.classList?.contains("home-hero-card")
      ? [scope]
      : Array.from(scope.querySelectorAll(".home-hero-card"));
    heroNodes.forEach((heroNode) => {
      const description = heroNode.querySelector(".home-hero-description");
      if (!(description instanceof HTMLElement)) {
        return;
      }

      description.style.maxHeight = "";
      description.style.webkitLineClamp = "";
      description.style.lineClamp = "";
      if (description.classList.contains("is-empty")) {
        return;
      }

      const descriptionStyle = getComputedStyle(description);
      const lineHeight = parseFloat(descriptionStyle.lineHeight || "0") || 0;
      const fontSize = parseFloat(descriptionStyle.fontSize || "0") || 0;
      const lineBoxHeight = Math.max(
        1,
        Math.ceil(lineHeight || fontSize * 1.35 || description.offsetHeight || 1)
      );
      description.style.maxHeight = `${lineBoxHeight * modernHeroDescriptionMaxLines}px`;
    });
  },

  ensureHomeTruncationObservers() {
    if (this.homeTruncationObserversBound || this.isPerformanceConstrained()) {
      return;
    }
    this.homeTruncationObserversBound = true;
    if (globalThis?.document?.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          this.scheduleHomeTruncationUpdate();
        })
        .catch(() => {});
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => {
        this.scheduleHomeTruncationUpdate();
      });
    }
  },

  scheduleFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
    if (this.isCollectionFolderNode(node)) {
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster(this.expandedPosterNode, {
        instant: true,
        preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
      });
      this.hydrateCollectionFocusGif(node, true);
      return;
    }
    const prefs = this.layoutPrefs || {};
    const { shouldExpand, shouldPreviewTrailer, trailerTarget } =
      this.getFocusedPosterFlowConfig(prefs);
    const shouldRun = Boolean(shouldExpand || shouldPreviewTrailer);
    if (!shouldRun) {
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
      return;
    }
    if (!this.isModernPosterNode(node)) {
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
      return;
    }
    if (this.expandedPosterNode && this.expandedPosterNode !== node) {
      this.collapseFocusedPoster(this.expandedPosterNode);
    }
    const flowKey = this.getFocusedPosterFlowKey(node);
    if (this.focusedPosterFlowState?.key && this.focusedPosterFlowState.key !== flowKey) {
      this.collapseFocusedPoster();
    }
    const defaultDelayMs =
      Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
    const existingState = this.focusedPosterFlowState;
    const canReuseExistingState = Boolean(flowKey && existingState?.key === flowKey);
    const now = Date.now();
    const delayMs = canReuseExistingState
      ? Math.max(0, Number(existingState.activated ? 0 : (existingState.activateAt || now) - now))
      : defaultDelayMs;
    const flowToken = Number(this.focusedPosterFlowToken || 0) + 1;
    this.focusedPosterFlowToken = flowToken;
    this.focusedPosterFlowState = {
      key: flowKey,
      activateAt: now + delayMs,
      activated: Boolean(canReuseExistingState && existingState.activated),
      token: flowToken
    };
    if (
      canReuseExistingState &&
      existingState.activated &&
      this.restorePersistentHeroTrailer(node, {
        shouldExpand,
        shouldPreviewTrailer,
        trailerTarget,
        flowKey
      })
    ) {
      return;
    }
    this.focusedPosterTimer = setTimeout(() => {
      if (
        this.focusedPosterFlowState?.key === flowKey &&
        this.focusedPosterFlowState?.token === flowToken
      ) {
        this.focusedPosterFlowState = {
          key: flowKey,
          activateAt: Date.now(),
          activated: true,
          token: flowToken
        };
      }
      if (Number(this.focusedPosterFlowToken || 0) !== flowToken) {
        return;
      }
      if (
        this.getCurrentFocusedNode() !== node ||
        !node?.isConnected ||
        !node.classList.contains("focused")
      ) {
        return;
      }
      this.promotePosterCardAssets(node, { includeNeighbors: this.isPerformanceConstrained() });
      this.activateFocusedPosterFlow(node, flowToken).catch((error) => {
        console.warn("Focused poster flow failed", error);
      });
    }, delayMs);
  },

  resetFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
    this.clearFocusedPosterFlowState();
    if (this.isModernPosterNode(node)) {
      this.collapseFocusedPoster(node, {
        preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
      });
      this.scheduleFocusedPosterFlow(node);
      return;
    }
    this.collapseFocusedPoster();
  },

  cancelModernSidebarPillAutoCollapse() {
    if (!this.modernSidebarPillAutoCollapseTimer) {
      return;
    }
    clearTimeout(this.modernSidebarPillAutoCollapseTimer);
    this.modernSidebarPillAutoCollapseTimer = null;
  },

  scheduleModernSidebarPillAutoCollapse({ restart = false } = {}) {
    const shouldSchedule = Boolean(
      this.layoutPrefs?.modernSidebar &&
      !this.sidebarExpanded &&
      !this.pillIconOnly &&
      Router.getCurrent() === "home"
    );
    if (!shouldSchedule) {
      this.cancelModernSidebarPillAutoCollapse();
      return;
    }
    if (this.modernSidebarPillAutoCollapseTimer && !restart) {
      return;
    }
    this.cancelModernSidebarPillAutoCollapse();
    this.modernSidebarPillAutoCollapseTimer = setTimeout(() => {
      this.modernSidebarPillAutoCollapseTimer = null;
      const shell = this.container?.querySelector(".modern-sidebar-shell");
      if (
        Router.getCurrent() !== "home" ||
        !this.layoutPrefs?.modernSidebar ||
        this.sidebarExpanded ||
        !shell ||
        shell.classList.contains("keep-pill-expanded")
      ) {
        return;
      }
      this.pillIconOnly = true;
      setModernSidebarPillIconOnly(this.container, true);
    }, MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS);
  },

  openSidebar({ openedByBack = false } = {}) {
    this.sidebarOpenedByBack = Boolean(openedByBack);
    if (this.layoutPrefs?.modernSidebar) {
      this.cancelModernSidebarPillAutoCollapse();
      if (this.sidebarExpanded) {
        return true;
      }
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
      const target = getModernSidebarSelectedNode(this.container);
      const current = this.getCurrentFocusedNode() || null;
      return this.focusNode(current, target) || true;
    }
    const target = getLegacySidebarSelectedNode(this.container);
    if (target) {
      this.setFocusedNode(target);
      this.setSidebarExpanded(true);
      return true;
    }
    return false;
  },

  closeSidebarToContent() {
    this.sidebarOpenedByBack = false;
    if (this.layoutPrefs?.modernSidebar) {
      if (!this.sidebarExpanded) {
        return false;
      }
      const target =
        this.lastMainFocus && this.isMainNode(this.lastMainFocus)
          ? this.lastMainFocus
          : this.navModel?.rows?.[0]?.[0] || null;
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
      this.scheduleModernSidebarPillAutoCollapse({ restart: true });
      const current = this.getCurrentFocusedNode() || null;
      return this.focusNode(current, target, "right") || true;
    }
    const current =
      this.getCurrentFocusedNode() ||
      this.container?.querySelector(".home-sidebar .focusable.focused") ||
      null;
    const target =
      this.lastMainFocus && this.isMainNode(this.lastMainFocus)
        ? this.lastMainFocus
        : this.navModel?.rows?.[0]?.[0] || null;
    return this.focusNode(current, target, "right") || true;
  },

  // Selecting Home while already on Home scrolls back to the top, matching the
  // Android TV app. Clears the remembered content focus so we land on the very
  // first row, resets the scroll position, then moves focus into the content.
  onSidebarReselect() {
    const viewport = this.getHomeViewport();
    if (viewport) {
      viewport.scrollTop = 0;
    }
    this.lastMainFocus = null;
    this.closeSidebarToContent();
  },

  getMainFocusAnchor(node) {
    if (!node) {
      return null;
    }
    return node.closest(".home-row, .home-grid-section") || node.closest(".home-hero") || node;
  },

  getTrackViewportMetrics(track) {
    let leftPadding = this.getTrackEdgePadding();
    let rightPadding = leftPadding;
    const cachedLeft = Number.parseFloat(track?.dataset?.trackPadLeft || "");
    const cachedRight = Number.parseFloat(track?.dataset?.trackPadRight || "");
    if (Number.isFinite(cachedLeft) && cachedLeft >= 0) {
      leftPadding = cachedLeft;
    }
    if (Number.isFinite(cachedRight) && cachedRight >= 0) {
      rightPadding = cachedRight;
    }
    if (
      (!Number.isFinite(cachedLeft) || !Number.isFinite(cachedRight)) &&
      typeof window !== "undefined" &&
      window.getComputedStyle
    ) {
      const computed = window.getComputedStyle(track);
      const paddingLeft = Number.parseFloat(computed?.paddingLeft || "");
      const paddingRight = Number.parseFloat(computed?.paddingRight || "");
      if (Number.isFinite(paddingLeft) && paddingLeft >= 0) {
        leftPadding = paddingLeft;
        track.dataset.trackPadLeft = String(paddingLeft);
      }
      if (Number.isFinite(paddingRight) && paddingRight >= 0) {
        rightPadding = paddingRight;
        track.dataset.trackPadRight = String(paddingRight);
      }
    }
    const safeRightPadding = Math.min(rightPadding, Math.max(24, leftPadding));
    const visibleLeft = track.scrollLeft + leftPadding;
    const visibleRight = track.scrollLeft + track.clientWidth - safeRightPadding;
    return {
      leftPadding,
      safeRightPadding,
      visibleLeft,
      visibleRight,
      visibleCenter: visibleLeft + Math.max(0, (visibleRight - visibleLeft) / 2)
    };
  },

  getExpandedPosterScrollAdjustments(current, target, direction = null) {
    const expanded = this.layoutMode === "modern" ? this.expandedPosterNode : null;
    if (
      !expanded ||
      expanded !== current ||
      expanded === target ||
      !expanded.classList.contains("is-expanded")
    ) {
      return { horizontal: 0, vertical: 0 };
    }
    const targetShell = this.container?.querySelector(".home-screen-shell");
    if (!(targetShell instanceof HTMLElement)) {
      return { horizontal: 0, vertical: 0 };
    }
    const shellStyles = getComputedStyle(targetShell);
    const expandedFrame = expanded.querySelector(".home-poster-frame");
    const isLandscape = expanded.classList.contains("is-landscape");
    const collapsedHeight = isLandscape
      ? parseCssPx(
          shellStyles.getPropertyValue("--home-landscape-poster-height"),
          expandedFrame?.offsetHeight || 0
        )
      : parseCssPx(
          shellStyles.getPropertyValue("--home-modern-portrait-poster-height"),
          expandedFrame?.offsetHeight || 0
        );

    const vertical =
      direction === "down" && isLandscape
        ? Math.max(0, Number(expandedFrame?.offsetHeight || 0) - collapsedHeight)
        : 0;

    return { horizontal: 0, vertical };
  },

  getModernVerticalScrollOffset(main) {
    return Math.max(10, Math.min(18, Math.round(Number(main?.clientHeight || 0) * 0.025)));
  },

  getModernTrackAlignedScrollTarget(target, layoutAdjustment = 0) {
    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return null;
    }
    const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
    const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
    const trackRect = track.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetLeft =
      targetRect.left -
      trackRect.left +
      Number(track.scrollLeft || 0) -
      Number(layoutAdjustment || 0);
    const maxScrollLeft = Math.max(
      0,
      Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
    );
    return {
      container: track,
      value: Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad))
    };
  },

  getModernMainAlignedScrollTarget(target, direction = null, current = null, layoutAdjustment = 0) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (!main || !target || !this.container?.contains(target)) {
      return null;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop =
      anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom =
      anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const targetTop =
      targetRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
    const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
    const currentAnchor = this.getMainFocusAnchor(current);
    const sameAnchor = Boolean(currentAnchor && currentAnchor === anchor);
    const isHorizontalMove = direction === "left" || direction === "right";
    const isVerticalMove = direction === "up" || direction === "down";
    const isEnteringMainFromSidebar = direction === "right" && current && !this.isMainNode(current);

    if (isHorizontalMove && sameAnchor) {
      return null;
    }

    let nextValue = null;
    if (isVerticalMove || isEnteringMainFromSidebar) {
      nextValue = targetTop - inset;
    } else if (adjustedTop < visibleTop) {
      nextValue = anchorTop - inset;
    } else if (adjustedBottom > visibleBottom) {
      nextValue = anchorBottom - main.clientHeight + 24;
    } else {
      nextValue = anchorTop - Math.max(0, (main.clientHeight - anchor.offsetHeight) / 2);
    }

    const maxScrollTop = Math.max(
      0,
      Number(main.scrollHeight || 0) - Number(main.clientHeight || 0)
    );
    return {
      container: main,
      value: Math.max(0, Math.min(maxScrollTop, nextValue))
    };
  },

  getModernMainSafetyScrollTarget(target, layoutAdjustment = 0) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (!main || !target || !this.container?.contains(target)) {
      return null;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop =
      anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom =
      anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
    const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
    const minVisible = Math.max(
      32,
      Math.min(72, Math.round(Number(anchor.offsetHeight || 0) * 0.22))
    );
    let nextValue = null;
    if (adjustedBottom <= visibleTop + minVisible) {
      nextValue = anchorBottom - inset - minVisible;
    } else if (adjustedTop >= visibleBottom - minVisible) {
      nextValue = anchorTop - main.clientHeight + 24 + minVisible;
    }
    if (!Number.isFinite(nextValue)) {
      return null;
    }
    const maxScrollTop = Math.max(
      0,
      Number(main.scrollHeight || 0) - Number(main.clientHeight || 0)
    );
    return {
      container: main,
      value: Math.max(0, Math.min(maxScrollTop, nextValue))
    };
  },

  applyModernCameraFollowTargets(horizontal = null, vertical = null) {
    if (horizontal?.container?.isConnected) {
      if (
        Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1
      ) {
        this.animateScroll(
          horizontal.container,
          "x",
          horizontal.value,
          MODERN_HOME_CONSTANTS.cameraFollowDurationXMs,
          { mode: "spring" }
        );
      }
      this.modernCameraFollowLastHorizontalContainer = horizontal.container;
    }
    if (vertical?.container?.isConnected) {
      if (Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1) {
        this.animateScroll(
          vertical.container,
          "y",
          vertical.value,
          MODERN_HOME_CONSTANTS.cameraFollowDurationYMs,
          { mode: "spring" }
        );
      }
      this.modernCameraFollowLastVerticalContainer = vertical.container;
    }
  },

  flushModernCameraFollow() {
    const state = this.modernCameraFollowState || null;
    this.modernCameraFollowTimer = null;
    this.modernCameraFollowState = null;
    if (!state || Router.getCurrent() !== "home" || this.layoutMode !== "modern") {
      return;
    }
    if (state.deferred) {
      const horizontal = this.getModernTrackAlignedScrollTarget(
        state.target,
        state.horizontalAdjustment
      );
      const vertical = this.getModernMainAlignedScrollTarget(
        state.target,
        state.direction,
        state.current,
        state.verticalAdjustment
      );
      const hasHorizontal = Boolean(
        horizontal?.container &&
        Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1
      );
      const hasVertical = Boolean(
        vertical?.container &&
        Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1
      );
      this.modernCameraFollowLastHorizontalContainer =
        horizontal?.container || this.modernCameraFollowLastHorizontalContainer;
      this.modernCameraFollowLastVerticalContainer =
        vertical?.container || this.modernCameraFollowLastVerticalContainer;
      this.applyModernCameraFollowTargets(
        hasHorizontal ? horizontal : null,
        hasVertical ? vertical : null
      );
    } else {
      this.applyModernCameraFollowTargets(state.horizontal, state.vertical);
    }
  },

  scheduleModernCameraFollow(
    target,
    direction = null,
    current = null,
    layoutAdjustment = {},
    inputMeta = {}
  ) {
    if (!this.shouldUseDelayedModernCameraFollow(target, direction)) {
      return false;
    }
    this.cancelModernCameraFollow({ stopAnimations: true });
    const isVerticalMove = direction === "up" || direction === "down";
    const shouldFollowVerticalHoldImmediately = isVerticalMove && Boolean(inputMeta?.repeat);
    const horizontalAdjustment = Number(layoutAdjustment?.horizontal || 0);
    const verticalAdjustment = Number(layoutAdjustment?.vertical || 0);

    if (shouldFollowVerticalHoldImmediately) {
      const horizontal = this.getModernTrackAlignedScrollTarget(target, horizontalAdjustment);
      const vertical = this.getModernMainAlignedScrollTarget(
        target,
        direction,
        current,
        verticalAdjustment
      );
      this.applyModernCameraFollowTargets(horizontal, vertical);
      return true;
    }

    this.modernCameraFollowState = {
      deferred: true,
      target,
      direction,
      current,
      horizontalAdjustment,
      verticalAdjustment
    };
    this.modernCameraFollowTimer = setTimeout(() => {
      this.flushModernCameraFollow();
    }, MODERN_HOME_CONSTANTS.cameraFollowDelayMs);
    return true;
  },

  isNodeWithinMainViewport(node) {
    const main = this.getHomeViewport();
    if (!main || !node || !this.container?.contains(node)) {
      return false;
    }
    const anchor = this.getMainFocusAnchor(node);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    return anchorRect.bottom > visibleTop && anchorRect.top < visibleBottom;
  },

  resolveBestVisibleNodeForRow(rowNodes = []) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const preferred = this.resolvePreferredNodeForRow(rowNodes);
    const track = rowNodes[0]?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return preferred || rowNodes[0] || null;
    }
    const metrics = this.getTrackViewportMetrics(track);
    const visibleNodes = rowNodes
      .map((node) => {
        const left = Number(node.offsetLeft || 0);
        const right = left + Number(node.offsetWidth || 0);
        return {
          node,
          overlap: Math.min(right, metrics.visibleRight) - Math.max(left, metrics.visibleLeft),
          distance: Math.abs((left + right) / 2 - metrics.visibleCenter)
        };
      })
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }
        return left.distance - right.distance;
      });
    if (preferred && visibleNodes.some((entry) => entry.node === preferred)) {
      return preferred;
    }
    return visibleNodes[0]?.node || preferred || rowNodes[0] || null;
  },

  syncMainFocusToViewport({ suppressFlows = false } = {}) {
    if (!this.container || !this.navModel?.rows?.length) {
      return null;
    }
    const current = this.getCurrentFocusedNode();
    if (current?.closest?.(".home-sidebar, .modern-sidebar-panel")) {
      return current;
    }
    if (this.isSidebarFocusActive()) {
      return this.container.querySelector(
        ".home-sidebar .focusable.focused, .modern-sidebar-panel .focusable.focused"
      );
    }
    const currentMain =
      current && this.isMainNode(current)
        ? current
        : this.container.querySelector(".home-main .focusable.focused") || null;
    if (currentMain && this.isMainNode(currentMain) && this.isNodeWithinMainViewport(currentMain)) {
      return currentMain;
    }
    const main = this.getHomeViewport();
    if (!main) {
      return currentMain || null;
    }
    const mainRect = main.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const visibleCenter = visibleTop + Math.max(0, (visibleBottom - visibleTop) / 2);
    const bestRow = this.navModel.rows
      .map((rowNodes) => {
        const anchor = this.getMainFocusAnchor(rowNodes[0]);
        if (!anchor) {
          return null;
        }
        const rect = anchor.getBoundingClientRect();
        const overlap = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
        if (overlap <= 0) {
          return null;
        }
        return {
          rowNodes,
          overlap,
          distance: Math.abs((rect.top + rect.bottom) / 2 - visibleCenter)
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }
        return left.distance - right.distance;
      })[0];
    const target = this.resolveBestVisibleNodeForRow(bestRow?.rowNodes || []);
    if (!(target instanceof HTMLElement)) {
      return currentMain || null;
    }
    if (currentMain !== target) {
      const syncStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      if (currentMain && currentMain.isConnected) {
        currentMain.classList.remove("focused");
      }
      this.setFocusedNode(target, { suppressDelegatedFocus: true });
      logHomePerf("syncMainFocusToViewport", {
        ms: Number((homePerfNow() - syncStart).toFixed(2)),
        rowKey: String(this.getNodeRowKey(target) || ""),
        itemIndex: Number(target.dataset?.navCol || 0)
      });
    }
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!suppressFlows) {
      this.scheduleModernHeroUpdate(target);
      this.scheduleFocusedPosterFlow(target);
    }
    return target;
  },

  scheduleHomeViewportFocusSync() {
    // If the sidebar is active, a home refresh must not promote a card into focus.
    if (this.isSidebarFocusActive()) {
      return;
    }
    if (this.homeViewportFocusSyncTimer) {
      clearTimeout(this.homeViewportFocusSyncTimer);
    }
    this.homeViewportFocusSyncTimer = setTimeout(() => {
      this.homeViewportFocusSyncTimer = null;
      if (Router.getCurrent() !== "home") {
        return;
      }
      this.syncMainFocusToViewport({ suppressFlows: true });
    }, 120);
  },

  endModernVerticalFastScroll({ land = true } = {}) {
    const state = this.modernVerticalFastScrollState || null;
    if (state?.raf) {
      cancelAnimationFrame(state.raf);
    }
    if (this.modernVerticalFastScrollEndTimer) {
      clearTimeout(this.modernVerticalFastScrollEndTimer);
      this.modernVerticalFastScrollEndTimer = null;
    }
    this.modernVerticalFastScrollState = null;
    if (land && state?.direction) {
      this.landModernVerticalFastScroll(state.direction);
      this.scheduleHomeLazyImageHydration(this.getCurrentFocusedNode());
    }
  },

  canModernFastScroll(main, direction) {
    if (!main) {
      return false;
    }
    const maxScrollTop = Math.max(
      0,
      Number(main.scrollHeight || 0) - Number(main.clientHeight || 0)
    );
    const scrollTop = Number(main.scrollTop || 0);
    if (direction > 0) {
      return scrollTop < maxScrollTop - 1;
    }
    return scrollTop > 1;
  },

  startModernVerticalFastScroll(direction) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (this.layoutMode !== "modern" || !main || !direction) {
      return false;
    }
    this.cancelModernCameraFollow({ stopAnimations: true });
    if (this._mainVertRaf) {
      cancelAnimationFrame(this._mainVertRaf);
      this._mainVertRaf = null;
    }
    this.cancelScrollAnimation(main, "y");
    if (!this.canModernFastScroll(main, direction)) {
      this.endModernVerticalFastScroll({ land: true });
      return true;
    }

    const existing = this.modernVerticalFastScrollState;
    if (existing?.raf && existing.direction === direction) {
      this.armModernVerticalFastScrollEndTimer();
      return true;
    }
    this.endModernVerticalFastScroll({ land: false });
    if (this.homeViewportFocusSyncTimer) {
      clearTimeout(this.homeViewportFocusSyncTimer);
      this.homeViewportFocusSyncTimer = null;
    }
    if (this.homeLazyImageHydrationRaf) {
      cancelAnimationFrame(this.homeLazyImageHydrationRaf);
      this.homeLazyImageHydrationRaf = 0;
    }

    const state = {
      container: main,
      direction,
      raf: null,
      lastTime: performance.now()
    };
    const tick = (now) => {
      if (this.modernVerticalFastScrollState !== state || !main.isConnected) {
        return;
      }
      const dtMs = Math.min(
        MODERN_HOME_CONSTANTS.verticalFastScrollMaxFrameMs,
        Math.max(0, now - state.lastTime)
      );
      state.lastTime = now;
      const maxScrollTop = Math.max(
        0,
        Number(main.scrollHeight || 0) - Number(main.clientHeight || 0)
      );
      const current = Number(main.scrollTop || 0);
      const delta =
        direction * MODERN_HOME_CONSTANTS.verticalFastScrollVelocityPxPerSec * (dtMs / 1000);
      const next = Math.max(0, Math.min(maxScrollTop, current + delta));
      main.scrollTop = next;
      if (Math.abs(next - current) <= 0.1 || next <= 0 || next >= maxScrollTop) {
        this.endModernVerticalFastScroll({ land: true });
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    this.modernVerticalFastScrollState = state;
    state.raf = requestAnimationFrame(tick);
    this.armModernVerticalFastScrollEndTimer();
    return true;
  },

  armModernVerticalFastScrollEndTimer() {
    if (this.modernVerticalFastScrollEndTimer) {
      clearTimeout(this.modernVerticalFastScrollEndTimer);
    }
    this.modernVerticalFastScrollEndTimer = setTimeout(() => {
      this.modernVerticalFastScrollEndTimer = null;
      this.endModernVerticalFastScroll({ land: true });
    }, MODERN_HOME_CONSTANTS.verticalFastScrollEndTimeoutMs);
  },

  landModernVerticalFastScroll(direction) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (!main || !this.navModel?.rows?.length) {
      return;
    }
    const mainRect = main.getBoundingClientRect();
    const visibleRows = this.navModel.rows
      .map((rowNodes) => {
        const anchor = this.getMainFocusAnchor(rowNodes[0]);
        if (!anchor) {
          return null;
        }
        const rect = anchor.getBoundingClientRect();
        const overlap = Math.min(rect.bottom, mainRect.bottom) - Math.max(rect.top, mainRect.top);
        if (overlap <= 0) {
          return null;
        }
        const edgeDistance =
          direction > 0
            ? Math.abs(rect.top - mainRect.top)
            : Math.abs(rect.bottom - mainRect.bottom);
        return { rowNodes, overlap, edgeDistance };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }
        return left.edgeDistance - right.edgeDistance;
      });
    const target = this.resolveBestVisibleNodeForRow(visibleRows[0]?.rowNodes || []);
    const current = this.container?.querySelector(".home-main .focusable.focused") || null;
    if (target && current !== target) {
      this.focusNode(current, target, direction > 0 ? "down" : "up", { repeat: true });
    } else if (target) {
      this.syncMainFocusToViewport({ suppressFlows: false });
    }
  },

  ensureMainVerticalVisibility(target, direction = null, current = null, layoutAdjustment = 0) {
    if (this.layoutMode === "modern") {
      if (this._mainVertRaf) {
        cancelAnimationFrame(this._mainVertRaf);
      }
      const _target = target;
      const _direction = direction;
      const _current = current;
      const _adj = layoutAdjustment;
      this._mainVertRaf = requestAnimationFrame(() => {
        this._mainVertRaf = null;
        if (!_target.isConnected) {
          return;
        }
        const next = this.getModernMainAlignedScrollTarget(_target, _direction, _current, _adj);
        if (!next?.container) {
          return;
        }
        const delta = Math.abs(Number(next.container.scrollTop || 0) - Number(next.value || 0));
        if (delta <= 1) {
          return;
        }
        if (this.shouldUseImmediateFocusScroll()) {
          this.cancelScrollAnimation(next.container, "y");
          next.container.scrollTop = Math.round(Number(next.value || 0));
          return;
        }
        this.modernCameraFollowLastVerticalContainer = next.container;
        this.animateSpringScroll(next.container, "y", next.value);
      });
      return;
    }

    if (
      (direction === "up" || direction === "down") &&
      (Platform.isTizen() || Platform.isWebOS() || this.isPerformanceConstrained())
    ) {
      if (this._mainClassicVertRaf) {
        cancelAnimationFrame(this._mainClassicVertRaf);
      }
      const _target = target;
      const _direction = direction;
      const _current = current;
      const _adj = layoutAdjustment;
      this._mainClassicVertRaf = requestAnimationFrame(() => {
        this._mainClassicVertRaf = null;
        if (!_target?.isConnected) {
          return;
        }
        this.applyClassicMainVerticalVisibility(_target, _direction, _current, _adj);
      });
      return;
    }

    this.applyClassicMainVerticalVisibility(target, direction, current, layoutAdjustment);
  },

  applyClassicMainVerticalVisibility(
    target,
    direction = null,
    current = null,
    layoutAdjustment = 0
  ) {
    void direction;
    void current;
    const main =
      this.layoutMode === "modern"
        ? this.container?.querySelector(".home-modern-rows-viewport")
        : this.container?.querySelector(".home-main");
    if (!main || !target || !this.container?.contains(target)) {
      return;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop =
      anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom =
      anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);

    if (anchorRect.top < visibleTop) {
      this.animateScroll(main, "y", anchorTop - inset, this.getScrollDuration(150));
      return;
    }

    if (anchorRect.bottom > visibleBottom) {
      const targetScrollTop = anchorBottom - main.clientHeight + 24;
      this.animateScroll(main, "y", targetScrollTop, this.getScrollDuration(150));
    }
  },

  ensureTrackHorizontalVisibility(target, direction = null, layoutAdjustment = 0) {
    if (this.layoutMode === "modern") {
      if (this._trackHorizRaf) {
        cancelAnimationFrame(this._trackHorizRaf);
        this._trackHorizRaf = null;
      }
      if (
        this.shouldUseImmediateHorizontalScrollForNode(target) ||
        this.shouldUseImmediateFocusScroll()
      ) {
        const next = this.getModernTrackAlignedScrollTarget(target, layoutAdjustment);
        if (next?.container) {
          this.cancelScrollAnimation(next.container, "x");
          if (Math.abs(Number(next.container.scrollLeft || 0) - Number(next.value || 0)) > 1) {
            next.container.scrollLeft = Math.round(Number(next.value || 0));
          }
        }
        return;
      }
      const _target = target;
      const _adj = layoutAdjustment;
      this._trackHorizRaf = requestAnimationFrame(() => {
        this._trackHorizRaf = null;
        if (!_target.isConnected) {
          return;
        }
        const next = this.getModernTrackAlignedScrollTarget(_target, _adj);
        if (!next?.container) {
          return;
        }
        if (Math.abs(Number(next.container.scrollLeft || 0) - Number(next.value || 0)) <= 1) {
          return;
        }
        if (this.shouldUseImmediateHorizontalScrollForNode(_target)) {
          this.cancelScrollAnimation(next.container, "x");
          next.container.scrollLeft = Math.round(Number(next.value || 0));
          return;
        }
        this.modernCameraFollowLastHorizontalContainer = next.container;
        this.animateSpringScroll(next.container, "x", next.value);
      });
      return;
    }

    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return;
    }
    const metrics = this.getTrackViewportMetrics(track);
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const visibleLeft = metrics.visibleLeft;
    const visibleRight = metrics.visibleRight;

    if (targetLeft < visibleLeft) {
      if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
        this.cancelScrollAnimation(track, "x");
        track.scrollLeft = Math.max(0, Math.round(targetLeft - metrics.leftPadding));
        return;
      }
      this.animateScroll(track, "x", targetLeft - metrics.leftPadding, this.getScrollDuration(160));
      return;
    }
    if (targetRight > visibleRight) {
      if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
        this.cancelScrollAnimation(track, "x");
        const maxScrollLeft = Math.max(
          0,
          Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
        );
        track.scrollLeft = Math.max(
          0,
          Math.min(
            maxScrollLeft,
            Math.round(targetRight - track.clientWidth + metrics.safeRightPadding)
          )
        );
        return;
      }
      this.animateScroll(
        track,
        "x",
        targetRight - track.clientWidth + metrics.safeRightPadding,
        this.getScrollDuration(160)
      );
      return;
    }
    if (this.layoutMode !== "modern" && !direction) {
      const targetCenter = targetLeft + target.offsetWidth / 2;
      const centeredLeft = targetCenter - track.clientWidth / 2;
      if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
        this.cancelScrollAnimation(track, "x");
        const maxScrollLeft = Math.max(
          0,
          Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
        );
        track.scrollLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(centeredLeft)));
        return;
      }
      this.animateScroll(track, "x", centeredLeft, this.getScrollDuration(160));
    }
  },

  focusNode(current, target, direction = null, inputMeta = null) {
    if (this.homeHoldFocusLocked) {
      return false;
    }
    if (!current || !target || current === target) {
      return false;
    }
    const focusStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
    const scrollAdjustments = this.getExpandedPosterScrollAdjustments(current, target, direction);
    const shouldInstantCollapseExpandedPoster =
      this.layoutMode === "modern" && (direction === "left" || direction === "right");
    if (
      this.layoutMode === "modern" &&
      this.expandedPosterNode &&
      this.expandedPosterNode !== target
    ) {
      this.collapseFocusedPoster(this.expandedPosterNode, {
        instant: shouldInstantCollapseExpandedPoster
      });
    }
    current.classList.remove("focused");
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target, { suppressDelegatedFocus: true });
    this.setCurrentFocusedNode(target);
    this.scheduleHomeLazyImageHydration(target);
    if (this.isCollectionFolderNode(current)) {
      this.hydrateCollectionFocusGif(current, false);
    }
    if (this.isCollectionFolderNode(target)) {
      this.hydrateCollectionFocusGif(target, true);
    }
    this.setSidebarExpanded(this.isSidebarNode(target));
    if (this.isMainNode(target)) {
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      const shouldDeferFocusEffects = this.shouldDeferContinueWatchingFocusEffects(
        target,
        direction,
        inputMeta
      );
      const usingDelayedCameraFollow = this.scheduleModernCameraFollow(
        target,
        direction,
        current,
        scrollAdjustments,
        inputMeta
      );
      if (!usingDelayedCameraFollow) {
        this.ensureTrackHorizontalVisibility(target, direction, scrollAdjustments.horizontal);
        if (!shouldDeferFocusEffects) {
          this.ensureMainVerticalVisibility(target, direction, current, scrollAdjustments.vertical);
        }
      }
      this.scheduleModernTrackPaginationForFocus(target);
      if (shouldDeferFocusEffects) {
        this.cancelPendingHeroFocus();
        this.cancelFocusedPosterFlow();
        this.scheduleDeferredContinueWatchingFocusEffects(target);
      } else {
        this.scheduleModernHeroUpdate(target);
        this.scheduleFocusedPosterFlow(target);
      }
    } else {
      this.cancelModernCameraFollow({ stopAnimations: true });
      this.cancelPendingHeroFocus();
      this.cancelFocusedPosterFlow();
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
    }
    logHomePerf("focusNode", {
      ms: Number((homePerfNow() - focusStart).toFixed(2)),
      direction: direction || "",
      layoutMode: this.layoutMode,
      main: Boolean(this.isMainNode(target)),
      sidebar: Boolean(this.isSidebarNode(target))
    });
    return true;
  },

  buildNavigationModel() {
    const sidebar = this.layoutPrefs?.modernSidebar
      ? Array.from(this.container?.querySelectorAll(".modern-sidebar-panel .focusable") || [])
      : Array.from(this.container?.querySelectorAll(".home-sidebar .focusable") || []);
    const rows = [];
    const tracks = [];
    const rowSectionByKey = new Map();
    const rowNodesByRowKey = new Map();
    const domVersion = Number(this.navigationDomVersion || 0);

    if (this.layoutMode === "modern") {
      const continueTrack = this.container?.querySelector(".home-row-continue .home-track");
      if (continueTrack) {
        const continueNodes = Array.from(
          continueTrack.querySelectorAll(".home-content-card.focusable")
        );
        if (continueNodes.length) {
          rows.push(continueNodes);
          tracks.push(continueTrack);
          rowSectionByKey.set(
            "continue_watching",
            continueTrack.closest(".home-row-continue") || null
          );
          rowNodesByRowKey.set("continue_watching", continueNodes);
        }
      }
      const rowSections = Array.from(this.container?.querySelectorAll(".home-modern-row") || []);
      rowSections.forEach((section) => {
        const track = section.querySelector(".home-track");
        if (!track) {
          return;
        }
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        if (!cards.length) {
          return;
        }
        const rowKey = String(section.dataset.rowKey || "");
        rows.push(cards);
        tracks.push(track);
        if (rowKey) {
          rowSectionByKey.set(rowKey, section);
          rowNodesByRowKey.set(rowKey, cards);
        }
      });
    } else {
      const hero = this.container?.querySelector(".home-hero-card.focusable");
      if (hero) {
        rows.push([hero]);
      }

      const trackSections = Array.from(
        this.container?.querySelectorAll(".home-main .home-row") || []
      );
      trackSections.forEach((section) => {
        const track = section.querySelector(".home-track");
        if (!track) {
          return;
        }
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        if (cards.length) {
          rows.push(cards);
          tracks.push(track);
          const rowKey = String(section.dataset.rowKey || "");
          if (rowKey) {
            rowSectionByKey.set(rowKey, section);
            rowNodesByRowKey.set(rowKey, cards);
          }
        }
      });
    }

    if (this.layoutMode === "grid") {
      const gridTracks = Array.from(this.container?.querySelectorAll(".home-grid-track") || []);
      gridTracks.forEach((track) => {
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        groupNodesByOffsetTop(cards).forEach((rowNodes) => {
          if (rowNodes.length) {
            rows.push(rowNodes);
          }
        });
      });
    }

    sidebar.forEach((node, index) => {
      const nextIndex = String(index);
      if (node.dataset.navZone !== "sidebar") {
        node.dataset.navZone = "sidebar";
      }
      if (node.dataset.navIndex !== nextIndex) {
        node.dataset.navIndex = nextIndex;
      }
    });

    rows.forEach((rowNodes, rowIndex) => {
      const rowKey = this.getNodeRowKey(rowNodes[0]);
      const nextRowIndex = String(rowIndex);
      rowNodes.forEach((node, colIndex) => {
        const nextColIndex = String(colIndex);
        if (node.dataset.navZone !== "main") {
          node.dataset.navZone = "main";
        }
        if (node.dataset.navRow !== nextRowIndex) {
          node.dataset.navRow = nextRowIndex;
        }
        if (node.dataset.navCol !== nextColIndex) {
          node.dataset.navCol = nextColIndex;
        }
        if (rowKey && node.dataset.navRowKey !== rowKey) {
          node.dataset.navRowKey = rowKey;
        }
      });
    });

    this.navModel = {
      domVersion,
      sidebar,
      rows,
      tracks,
      rowSectionByKey,
      rowNodesByRowKey
    };
    if (
      !this.lastMainFocus ||
      !this.container?.contains(this.lastMainFocus) ||
      !this.isMainNode(this.lastMainFocus)
    ) {
      this.lastMainFocus = rows[0]?.[0] || null;
    }
  },

  handleHomeDpad(event) {
    const keyCode = Number(event?.keyCode || 0);
    const direction = getDirectionFromKeyCode(keyCode);
    if (!direction) {
      return false;
    }

    const nav = this.navModel;
    if (!nav) {
      return false;
    }

    const activeFastScroll = this.modernVerticalFastScrollState || null;
    const requestedFastScrollDirection = direction === "down" ? 1 : direction === "up" ? -1 : 0;
    if (
      activeFastScroll &&
      (direction === "left" ||
        direction === "right" ||
        (!event?.repeat && requestedFastScrollDirection !== activeFastScroll.direction))
    ) {
      this.endModernVerticalFastScroll({ land: true });
    }

    let current =
      this.getCurrentFocusedNode() || this.container?.querySelector(".focusable") || null;
    if (!current) {
      return false;
    }
    if (
      this.isMainNode(current) &&
      !this.isNodeWithinMainViewport(current) &&
      !this.shouldSuspendModernViewportFocusSync()
    ) {
      current = this.syncMainFocusToViewport({ suppressFlows: true }) || current;
    }
    const isSidebar = this.isSidebarNode(current);

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const inputMeta = {
      repeat: Boolean(event?.repeat)
    };

    if (
      inputMeta.repeat &&
      this.layoutMode === "modern" &&
      !isSidebar &&
      (direction === "up" || direction === "down") &&
      this.startModernVerticalFastScroll(direction === "down" ? 1 : -1)
    ) {
      return true;
    }

    if (inputMeta.repeat) {
      const now = Date.now();
      const repeatThrottleMs = this.getDirectionalRepeatThrottleMs(direction);
      const repeatTimes =
        this.lastDirectionalKeyAtByDirection || (this.lastDirectionalKeyAtByDirection = {});
      const lastDirectionalKeyAt = Number(repeatTimes[direction] || 0);
      if (lastDirectionalKeyAt > 0 && now - lastDirectionalKeyAt < repeatThrottleMs) {
        return true;
      }
      repeatTimes[direction] = now;
    }

    if (
      !isSidebar &&
      current.classList.contains("home-hero-card") &&
      (direction === "left" || direction === "right")
    ) {
      if (this.heroCandidates?.length > 1) {
        this.rotateHero(direction === "right" ? 1 : -1);
      }
      return true;
    }

    if (isSidebar) {
      const sidebarIndex = Number(current.dataset.navIndex || 0);
      if (direction === "up") {
        const target = nav.sidebar[Math.max(0, sidebarIndex - 1)] || current;
        return this.focusNode(current, target, direction, inputMeta) || true;
      }
      if (direction === "down") {
        const target = nav.sidebar[Math.min(nav.sidebar.length - 1, sidebarIndex + 1)] || current;
        return this.focusNode(current, target, direction, inputMeta) || true;
      }
      if (direction === "right") {
        return this.closeSidebarToContent() || true;
      }
      return true;
    }

    const row = Number(current.dataset.navRow || 0);
    const col = Number(current.dataset.navCol || 0);
    const rowNodes = nav.rows[row] || [];

    if (direction === "left") {
      const targetInRow = rowNodes[col - 1] || null;
      if (this.focusNode(current, targetInRow, direction, inputMeta)) {
        return true;
      }
      const sidebarFallback =
        getLegacySidebarSelectedNode(this.container) ||
        getModernSidebarSelectedNode(this.container) ||
        nav.sidebar[0] ||
        null;
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        this.lastMainFocus = current;
        return this.openSidebar();
      }
      return this.focusNode(current, sidebarFallback, direction, inputMeta) || true;
    }

    if (direction === "right") {
      const target = rowNodes[col + 1] || null;
      return this.focusNode(current, target, direction, inputMeta) || true;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRow = row + delta;
      const targetRowNodes = nav.rows[targetRow] || null;
      if (!targetRowNodes || !targetRowNodes.length) {
        return true;
      }
      const target = this.resolvePreferredNodeForRow(targetRowNodes, col);
      return this.focusNode(current, target, direction, inputMeta) || true;
    }

    return false;
  },

  ensureDelegatedEventsBound() {
    if (!this.container) {
      return;
    }
    if (!this.boundHomeFocusInHandler) {
      this.boundHomeFocusInHandler = (event) => {
        const target = event?.target?.closest?.(".focusable");
        if (!target || !this.container?.contains(target)) {
          return;
        }
        if (this.pendingDelegatedFocusTarget) {
          const isSuppressedProgrammaticFocus = this.pendingDelegatedFocusTarget === target;
          this.pendingDelegatedFocusTarget = null;
          if (isSuppressedProgrammaticFocus) {
            return;
          }
        }
        if (target.closest(".home-sidebar .focusable, .modern-sidebar-panel .focusable")) {
          this.setSidebarExpanded(true);
          return;
        }
        if (!target.closest(".home-main .focusable")) {
          return;
        }
        if (this.isMainNode(target)) {
          this.lastMainFocus = target;
        }
        this.syncFocusedCollectionCardState();
        this.scheduleModernHeroUpdate(target);
        this.scheduleFocusedPosterFlow(target);
      };
    }
    if (!this.boundHomeClickHandler) {
      this.boundHomeClickHandler = (event) => {
        const target = event?.target?.closest?.(".home-main .focusable");
        if (!target || !this.container?.contains(target)) {
          return;
        }
        const action = String(target.dataset.action || "");
        if (action === "openDetail" || action === "openCollectionFolder") {
          this.openDetailFromNode(target);
          return;
        }
        if (action === "openCatalogSeeAll") {
          this.openCatalogSeeAllFromNode(target);
          return;
        }
        if (action === "resumeProgress") {
          this.openContinueWatchingFromNode(target);
        }
      };
    }
    if (!this.boundHomeMouseOverHandler) {
      this.boundHomeMouseOverHandler = (event) => {
        const target = event?.target?.closest?.(".home-main .home-content-card.focusable");
        if (!target || !this.container?.contains(target) || target.classList.contains("focused")) {
          return;
        }
        this.setFocusedNode(target, { suppressDelegatedFocus: true });
        if (this.isMainNode(target)) {
          this.lastMainFocus = target;
        }
        this.syncFocusedCollectionCardState();
        this.scheduleModernHeroUpdate(target);
        this.scheduleFocusedPosterFlow(target);
      };
    }
    if (!this.boundHomeWheelHandler) {
      this.boundHomeWheelHandler = (event) => {
        const main = this.getHomeViewport();
        const target = event?.target;
        if (!(target instanceof HTMLElement) || !main?.contains(target)) {
          return;
        }
        this.cancelPendingHeroFocus();
        this.cancelFocusedPosterFlow();
        this.scheduleHomeViewportFocusSync();
      };
    }
    if (this.boundHomeEventContainer === this.container) {
      return;
    }
    if (this.boundHomeEventContainer) {
      this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
      this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
      this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
      this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
    }
    this.container.addEventListener("focusin", this.boundHomeFocusInHandler);
    this.container.addEventListener("click", this.boundHomeClickHandler);
    this.container.addEventListener("mouseover", this.boundHomeMouseOverHandler);
    this.container.addEventListener("wheel", this.boundHomeWheelHandler, { passive: true });
    this.boundHomeEventContainer = this.container;
  },

  bindHomeViewportEvents() {
    const viewport = this.getHomeViewport();
    if (this.boundHomeViewport === viewport) {
      return;
    }
    if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
      this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler);
    }
    this.boundHomeViewport = viewport || null;
    if (!viewport) {
      return;
    }
    if (!this.boundHomeViewportScrollHandler) {
      this.boundHomeViewportScrollHandler = () => {
        if (this.shouldSuspendModernViewportFocusSync()) {
          return;
        }
        this.scheduleHomeLazyImageHydration();
        // Keep the sidebar sticky across rerenders and layout-driven scroll events.
        if (this.isSidebarFocusActive()) {
          return;
        }
        const current = this.container?.querySelector(".home-main .focusable.focused") || null;
        if (current && this.isMainNode(current) && this.isNodeWithinMainViewport(current)) {
          return;
        }
        this.scheduleHomeViewportFocusSync();
      };
    }
    viewport.addEventListener("scroll", this.boundHomeViewportScrollHandler, { passive: true });
  },

  async mount(params = {}, navigationContext = {}) {
    const mountStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
    this.container = document.getElementById("home");
    const restoredRouteFocusState =
      navigationContext?.isBackNavigation && navigationContext?.restoredState?.layoutMode
        ? navigationContext.restoredState
        : null;
    const storedReturnFocusState = navigationContext?.isBackNavigation
      ? this.pendingBackFocusState || this.readStoredReturnFocusState()
      : null;
    const returnFocusState = restoredRouteFocusState || storedReturnFocusState;
    ScreenUtils.show(this.container);
    this.ensureDelegatedEventsBound();
    this.sidebarExpanded = false;
    this.sidebarOpenedByBack = false;
    this.pillIconOnly = Boolean(
      navigationContext?.isBackNavigation && returnFocusState?.focusKind !== "sidebar"
    );
    this.cancelModernSidebarPillAutoCollapse();
    this.homeRouteEnterPending = !(
      navigationContext?.isBackNavigation || returnFocusState?.layoutMode
    );
    this.destroyHomeHoldDialog();
    this.unlockHomeHoldFocus();
    this.continueWatchingMenu = null;
    this.posterHoldMenu = null;
    this.posterListPicker = null;
    this.pendingContinueWatchingFocusIndex = null;
    this.suppressHoldMenuEnterUntilKeyUp = false;
    this.cancelPendingContinueWatchingEnter();
    this.forceInitialContinueWatchingFocus = false;
    this.continueWatchingLoading = false;
    if (returnFocusState?.layoutMode) {
      this.pendingBackFocusState = returnFocusState;
    } else if (!navigationContext?.isBackNavigation) {
      this.clearStoredReturnFocusState();
    }
    this.isRestoringFocusFromBack = Boolean(
      navigationContext?.isBackNavigation || returnFocusState?.layoutMode
    );
    this.suppressInitialContinueWatchingFocus = Boolean(
      navigationContext?.isBackNavigation || returnFocusState?.layoutMode
    );
    if (navigationContext?.restoredState?.layoutMode) {
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [navigationContext.restoredState.layoutMode]: navigationContext.restoredState
      };
    }
    if (returnFocusState?.layoutMode) {
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [returnFocusState.layoutMode]: returnFocusState
      };
    }
    const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
    const profileChanged = activeProfileId !== String(this.loadedProfileId || "");
    const watchProgressSourceChanged =
      watchProgressRepository.getContinueWatchingSourceKey() !==
      String(this.loadedWatchProgressSourceKey || "");
    const forceReload = Boolean(params?.forceReload);
    if (profileChanged || watchProgressSourceChanged || forceReload) {
      this.hasLoadedOnce = false;
      this.hasAppliedInitialContinueWatchingFocus = false;
      this.sidebarProfile = null;
      this.savedFocusStates = {};
    }
    if (returnFocusState?.layoutMode) {
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [returnFocusState.layoutMode]: returnFocusState
      };
    }

    const canResumePreservedTizenHome = Boolean(
      Platform.isTizen() &&
      navigationContext?.isBackNavigation &&
      this.homeDomPreserved &&
      this.hasLoadedOnce &&
      Array.isArray(this.rows) &&
      this.rows.length &&
      this.container?.childNodes?.length &&
      String(this.renderedLayoutMode || "") === String(this.layoutMode || "")
    );
    if (canResumePreservedTizenHome) {
      this.homeDomPreserved = false;
      this.container.classList.remove("home-dom-preserved");
      this.container.style.removeProperty("visibility");
      this.container.style.removeProperty("pointer-events");
      setModernSidebarPillIconOnly(this.container, this.pillIconOnly);
      this.scheduleModernSidebarPillAutoCollapse();
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.bindHomeViewportEvents();
      if (this.layoutMode === "modern") {
        this.setupModernTrackScrollPagination();
      }
      const restoredFocus = this.restoreFocusState(returnFocusState);
      if (restoredFocus) {
        this.isRestoringFocusFromBack = false;
      } else {
        ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
      }
      this.syncFocusedCollectionCardState();
      if (this.layoutMode === "grid") {
        this.setupGridStickyHeader(
          Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(this.heroItem)
        );
      }
      this.startHeroRotation();
      this.homeRouteEnterPending = false;
      this.pendingCollectionRouteReturnAnimation = false;
      this.ensureHomeTruncationObservers();
      this.scheduleHomeTruncationUpdate();
      this.scheduleHomeLazyImageHydration();
      this.scheduleReturnFocusRestore();
      this.loadData({
        background: true,
        preserveReturnState: true
      }).catch((error) => {
        console.warn("Home background refresh failed", error);
      });
      logHomePerf("mount", {
        ms: Number((homePerfNow() - mountStart).toFixed(2)),
        route: "home",
        background: true,
        layoutMode: String(this.layoutMode || ""),
        mode: "resume"
      });
      return;
    }
    this.homeDomPreserved = false;
    this.container.classList.remove("home-dom-preserved");
    this.container.style.removeProperty("position");
    this.container.style.removeProperty("top");
    this.container.style.removeProperty("right");
    this.container.style.removeProperty("bottom");
    this.container.style.removeProperty("left");
    this.container.style.removeProperty("visibility");
    this.container.style.removeProperty("pointer-events");

    if (this.hasLoadedOnce && Array.isArray(this.rows) && this.rows.length) {
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.render();
      this.loadData({
        background: true,
        preserveReturnState: Boolean(
          navigationContext?.isBackNavigation || returnFocusState?.layoutMode
        )
      }).catch((error) => {
        console.warn("Home background refresh failed", error);
      });
      logHomePerf("mount", {
        ms: Number((homePerfNow() - mountStart).toFixed(2)),
        route: "home",
        background: true,
        layoutMode: String(this.layoutMode || ""),
        mode: "refresh"
      });
      return;
    }

    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this.hasAppliedInitialContinueWatchingFocus = false;
    this.isInitialHomeLoading = true;
    this.layoutPrefs = LayoutPreferences.get();
    this.layoutMode = String(this.layoutPrefs.homeLayout || "classic").toLowerCase();
    this.rows = [];
    this.watchedItems = [];
    this.watchedTitleIds = new Set();
    this.continueWatchingDisplay = readContinueWatchingDisplaySnapshot(
      watchProgressRepository.getContinueWatchingSourceKey()
    );
    this.continueWatchingHydratedFromSnapshot = Boolean(this.continueWatchingDisplay.length);
    this.continueWatchingLoading = false;
    this.heroCandidates = [];
    this.heroItem = null;
    this.sidebarProfile = await getLocalSidebarProfileState().catch(() => null);
    this.render();
    await this.loadData({ background: false });
    logHomePerf("mount", {
      ms: Number((homePerfNow() - mountStart).toFixed(2)),
      route: "home",
      background: false,
      layoutMode: String(this.layoutMode || "")
    });
  },

  async loadData({ background = false, preserveReturnState = false } = {}) {
    const loadStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
    const token = this.homeLoadToken;
    const preserveHomeReturnState = Boolean(background && preserveReturnState);
    const preservedHeroItem = preserveHomeReturnState ? this.heroItem : null;
    const preservedHeroIdentity = preserveHomeReturnState ? buildHeroIdentity(this.heroItem) : "";
    const prefs = LayoutPreferences.get();
    this.layoutPrefs = prefs;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();
    const includeWatchedItemNextUpSeeds =
      watchProgressRepository.getContinueWatchingSource?.() !== "trakt";
    const watchedItemsPromise = watchedItemsRepository.getAll(2000).catch(() => []);
    watchedItemsPromise.then((watchedItems) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.watchedItems = Array.isArray(watchedItems) ? watchedItems : [];
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      this.requestBackgroundRender();
    });

    const preserveContinueWatching = Boolean(background && this.continueWatchingDisplay?.length);
    const hydratedFromSnapshot = Boolean(
      !background &&
      this.continueWatchingHydratedFromSnapshot &&
      this.continueWatchingDisplay?.length
    );
    const suppressContinueWatchingLoading = preserveContinueWatching || hydratedFromSnapshot;
    const previousContinueWatchingSignature = preserveContinueWatching
      ? buildContinueWatchingSignature(this.continueWatchingDisplay)
      : "";
    const waitForInitialContinueWatching = Boolean(!background && !hydratedFromSnapshot);
    let initialContinueWatchingReleased = false;
    const releaseInitialHomeAfterContinueWatching = () => {
      if (!waitForInitialContinueWatching || initialContinueWatchingReleased) {
        return false;
      }
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return false;
      }
      initialContinueWatchingReleased = true;
      this.isInitialHomeLoading = false;
      this.hasLoadedOnce = true;
      this.render();
      return true;
    };

    let progressAllError = null;
    let recentProgressError = null;
    const sidebarProfilePromise = getSidebarProfileState().catch(() => null);
    const progressAllPromise = watchProgressRepository
      .getAllForContinueWatching()
      .catch((error) => {
        progressAllError = error;
        return [];
      });
    const recentProgressPromise = watchProgressRepository.getRecent(10).catch((error) => {
      recentProgressError = error;
      return [];
    });
    // Continue Watching is reconciled fire-and-forget in the block below, so a
    // slow addon or Trakt call never blocks catalog rows. The section paints
    // instantly from the snapshot hydrated in mount().

    const addons = await addonRepository.getInstalledAddons();
    this.collections = CollectionsStore.get();
    const catalogDescriptors = [];

    addons.forEach((addon) => {
      addon.catalogs
        .filter((catalog) => !catalogRequiresExtras(catalog))
        .forEach((catalog) => {
          catalogDescriptors.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
    });

    // Seed missing order keys from manifest order before progressive requests
    // can add rows in network-completion order.
    HomeCatalogStore.ensureOrderKeys(
      catalogDescriptors.map((catalog) =>
        buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId)
      )
    );

    const initialCatalogLoad = this.getInitialCatalogLoadCount();
    const initialDescriptors = catalogDescriptors.slice(0, initialCatalogLoad);
    const deferredDescriptors = catalogDescriptors.slice(initialCatalogLoad);

    const progressiveInitialRows = new Map();
    const initialRows = await this.fetchCatalogRows(initialDescriptors, {
      allowLoading: true,
      onRow: (row) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        if (preserveHomeReturnState) {
          return;
        }
        progressiveInitialRows.set(row.homeCatalogKey, row);
        this.rows = this.sortAndFilterRows(
          Array.from(progressiveInitialRows.values()),
          this.collections
        );
        this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
        if (!this.heroItem) {
          this.heroItem = this.pickInitialHero();
        }
        if (!waitForInitialContinueWatching) {
          this.isInitialHomeLoading = false;
          this.hasLoadedOnce = true;
          this.requestBackgroundRender();
        }
      }
    });
    if (token !== this.homeLoadToken) {
      return;
    }
    const nextInitialRows = preserveHomeReturnState
      ? Array.from(
          new Map(
            [...(this.rows || []), ...initialRows].map((row) => [row.homeCatalogKey, row])
          ).values()
        )
      : initialRows;
    this.rows = this.sortAndFilterRows(nextInitialRows, this.collections);
    if (preserveContinueWatching) {
      this.continueWatchingLoading = false;
    } else if (
      !background &&
      this.layoutMode === "modern" &&
      this.continueWatchingHydratedFromSnapshot &&
      this.continueWatchingDisplay?.length
    ) {
      // CW already painted instantly from the snapshot — focus it on this render.
      // Fresh data reconciles fire-and-forget below.
      if (!this.suppressInitialContinueWatchingFocus) {
        this.forceInitialContinueWatchingFocus = true;
      }
    }
    this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
    if (preserveHomeReturnState) {
      const currentHeroIdentity = buildHeroIdentity(this.heroItem);
      const shouldRestorePreservedHero =
        Boolean(preservedHeroItem) &&
        (!preservedHeroIdentity || currentHeroIdentity === preservedHeroIdentity);
      if (shouldRestorePreservedHero) {
        this.heroItem = preservedHeroItem;
      } else if (!this.heroItem) {
        this.heroItem = this.pickInitialHero();
      }
      const heroIdentity = buildHeroIdentity(this.heroItem);
      const matchedHeroIndex = this.heroCandidates.findIndex(
        (candidate) => buildHeroIdentity(candidate) === heroIdentity
      );
      if (matchedHeroIndex >= 0) {
        this.heroIndex = matchedHeroIndex;
      }
    } else {
      this.heroIndex = 0;
      this.heroItem = this.pickInitialHero();
    }
    this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
    this.loadedWatchProgressSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
    if (!waitForInitialContinueWatching) {
      this.isInitialHomeLoading = false;
      this.hasLoadedOnce = true;
      this.render();
    }
    logHomePerf("loadData", {
      phase: "first-render",
      ms: Number((homePerfNow() - loadStart).toFixed(2)),
      background: Boolean(background),
      rows: Number(this.rows?.length || 0),
      continueWatching: Number(this.continueWatchingDisplay?.length || 0),
      nextUpCandidates: Number(this.nextUpProgressCandidates?.length || 0),
      layoutMode: this.layoutMode
    });
    const previousSidebarProfileSignature = buildSidebarProfileSignature(this.sidebarProfile);
    sidebarProfilePromise.then((profile) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      if (profile && buildSidebarProfileSignature(profile) !== previousSidebarProfileSignature) {
        this.sidebarProfile = profile;
        this.requestBackgroundRender();
      }
    });

    if (deferredDescriptors.length) {
      const progressiveDeferredRows = this.shouldProgressivelyRenderDeferredRows();
      this.fetchCatalogRows(deferredDescriptors, {
        allowLoading: true,
        batchSize: this.getDeferredCatalogBatchSize(),
        onBatch: progressiveDeferredRows
          ? (batchRows) => {
              if (
                token !== this.homeLoadToken ||
                Router.getCurrent() !== "home" ||
                !Array.isArray(batchRows) ||
                !batchRows.length
              ) {
                return;
              }
              const combinedByKey = new Map(
                (this.rows || []).map((row) => [row.homeCatalogKey, row])
              );
              batchRows.forEach((row) => {
                combinedByKey.set(row.homeCatalogKey, row);
              });
              this.rows = this.sortAndFilterRows(
                Array.from(combinedByKey.values()),
                this.collections
              );
              this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
              if (!this.heroItem) {
                this.heroItem = this.pickInitialHero();
              }
              this.requestBackgroundRender();
            }
          : null
      })
        .then((extraRows) => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          const combinedByKey = new Map();
          [...this.rows, ...extraRows].forEach((row) => {
            combinedByKey.set(row.homeCatalogKey, row);
          });
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          this.requestBackgroundRender();
          this.retryPendingCatalogRows();
        })
        .catch((error) => {
          console.warn("Deferred home rows load failed", error);
        });
    }

    if (this.layoutMode !== "modern") {
      this.enrichHero(this.heroCandidates[0] || null)
        .then(() => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          this.applyHeroToDom();
        })
        .catch((error) => {
          console.warn("Hero async enrichment failed", error);
        });
    }

    {
      (async () => {
        const [allProgress, continueWatching] = await Promise.all([
          progressAllPromise,
          recentProgressPromise
        ]);
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.allProgress = Array.isArray(allProgress) ? allProgress : [];
        this.continueWatching = Array.isArray(continueWatching) ? continueWatching : [];
        this.watchedItems = await watchedItemsPromise;
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.nextUpProgressCandidates = this.selectNextUpProgressCandidates(
          this.allProgress,
          this.continueWatching,
          this.watchedItems,
          {
            applyDaysCap: !includeWatchedItemNextUpSeeds,
            includeProgressSeeds: !includeWatchedItemNextUpSeeds,
            includeWatchedItemSeeds: includeWatchedItemNextUpSeeds,
            nextUpFromFurthestEpisode: prefs.nextUpFromFurthestEpisode
          }
        ).slice(0, CW_MAX_NEXT_UP_LOOKUPS);
        const shouldShowLoading = Boolean(
          (this.continueWatching?.length || 0) + (this.nextUpProgressCandidates?.length || 0)
        );
        const previousDisplaySignature = buildContinueWatchingSignature(
          this.continueWatchingDisplay
        );
        const previousHeroIdentity = buildHeroIdentity(this.heroItem);
        const previousLoadingState = Boolean(this.continueWatchingLoading);
        if (!suppressContinueWatchingLoading) {
          this.continueWatchingLoading = shouldShowLoading;
          this.continueWatchingDisplay = [];
          if (
            !waitForInitialContinueWatching &&
            (previousLoadingState !== this.continueWatchingLoading || previousDisplaySignature)
          ) {
            this.requestBackgroundRender();
          }
        }

        if (!shouldShowLoading) {
          if (suppressContinueWatchingLoading && (progressAllError || recentProgressError)) {
            this.continueWatchingLoading = false;
            releaseInitialHomeAfterContinueWatching();
            return;
          }
          if (preserveContinueWatching) {
            const nextSignature = "";
            if (nextSignature === previousContinueWatchingSignature) {
              this.continueWatchingLoading = false;
              releaseInitialHomeAfterContinueWatching();
              return;
            }
          }
          this.continueWatchingLoading = false;
          this.continueWatchingDisplay = [];
          if (
            !releaseInitialHomeAfterContinueWatching() &&
            (previousLoadingState || previousDisplaySignature)
          ) {
            this.requestBackgroundRender();
          }
          return;
        }

        try {
          const enriched = await this.enrichContinueWatching(this.continueWatching, {
            allProgress: this.allProgress,
            watchedItems: this.watchedItems,
            nextUpProgressCandidates: this.nextUpProgressCandidates
          });
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          const nextDisplayStrict = buildVisibleContinueWatchingItems(enriched, {
            requireArtwork: true
          });
          const nextDisplayFallback = buildCompleteContinueWatchingDisplay(enriched);
          const nextDisplayLoose = buildVisibleContinueWatchingItems(enriched, {
            requireArtwork: false
          });
          const nextDisplay =
            nextDisplayStrict.length === nextDisplayFallback.length
              ? nextDisplayStrict
              : nextDisplayLoose.length >= nextDisplayFallback.length
                ? nextDisplayLoose
                : nextDisplayFallback;
          const nextSignature = preserveContinueWatching
            ? buildContinueWatchingSignature(nextDisplay)
            : "";
          if (preserveContinueWatching && nextSignature === previousContinueWatchingSignature) {
            this.continueWatchingLoading = false;
            return;
          }
          this.continueWatchingDisplay = nextDisplay;
          this.continueWatchingLoading = false;
          this.persistContinueWatchingSnapshot();
          if (this.layoutMode === "modern" && this.continueWatchingDisplay.length) {
            if (!preserveHomeReturnState && !this.suppressInitialContinueWatchingFocus) {
              this.heroItem = this.pickInitialHero();
            }
            if (
              !background &&
              !this.suppressInitialContinueWatchingFocus &&
              !this.hasAppliedInitialContinueWatchingFocus
            ) {
              this.forceInitialContinueWatchingFocus = true;
            }
          }
          const nextDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
          const nextHeroIdentity = buildHeroIdentity(this.heroItem);
          if (
            !releaseInitialHomeAfterContinueWatching() &&
            (previousLoadingState !== this.continueWatchingLoading ||
              previousDisplaySignature !== nextDisplaySignature ||
              (!preserveHomeReturnState && previousHeroIdentity !== nextHeroIdentity))
          ) {
            this.requestBackgroundRender();
          }
        } catch (error) {
          console.warn("Continue watching async enrichment failed", error);
          this.continueWatchingLoading = false;
          if (
            !releaseInitialHomeAfterContinueWatching() &&
            !suppressContinueWatchingLoading &&
            previousLoadingState
          ) {
            this.requestBackgroundRender();
          }
        }
      })().catch((error) => {
        console.warn("Continue watching load failed", error);
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.continueWatchingLoading = false;
        if (!releaseInitialHomeAfterContinueWatching() && !suppressContinueWatchingLoading) {
          this.requestBackgroundRender();
        }
      });
    }

    this.retryPendingCatalogRows();
  },

  pickInitialHero() {
    if (this.layoutMode === "modern") {
      if (
        this.continueWatchingLoading &&
        Array.isArray(this.continueWatching) &&
        this.continueWatching.length &&
        !this.continueWatchingDisplay?.length
      ) {
        return null;
      }
      const continueHero = normalizeContinueWatchingItem(this.continueWatchingDisplay?.[0] || null);
      if (
        continueHero &&
        isPresentableContinueWatchingItem(continueHero, { requireArtwork: true })
      ) {
        return continueHero;
      }
    }
    return this.heroCandidates[0] || this.pickHeroItem(this.rows);
  },

  async fetchCatalogRows(descriptors = [], options = {}) {
    const allowLoading = Boolean(options?.allowLoading);
    const timeoutMs = Number(options?.timeoutMs || HOME_ROW_TIMEOUT_MS);
    const loadingCount = this.getLoadingRowItemCount();
    const batchSize = Math.max(0, Number(options?.batchSize || 0));
    const onBatch = typeof options?.onBatch === "function" ? options.onBatch : null;
    const onRow = typeof options?.onRow === "function" ? options.onRow : null;
    const fetchedRows = [];
    const normalizedDescriptors = Array.isArray(descriptors) ? descriptors : [];
    if (HOME_PERF_DEBUG) {
      const descriptorKeys = normalizedDescriptors.map((descriptor) =>
        buildModernRowKey(descriptor)
      );
      const uniqueDescriptorCount = new Set(descriptorKeys).size;
      logHomePerf("fetchCatalogRows", {
        requested: Number(normalizedDescriptors.length || 0),
        unique: uniqueDescriptorCount,
        duplicates: Number(normalizedDescriptors.length || 0) - uniqueDescriptorCount,
        batchSize: Number(batchSize || 0),
        allowLoading
      });
    }

    const fetchBatch = async (batchDescriptors = []) => {
      const rowResults = await Promise.all(
        batchDescriptors.map(async (catalog) => {
          const result = await withTimeout(
            catalogRepository.getCatalog({
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              type: catalog.type,
              skip: 0,
              supportsSkip: true
            }),
            timeoutMs,
            { status: "error", message: "timeout" }
          );
          const rowKey = buildModernRowKey(catalog);
          const row = {
            ...catalog,
            result:
              result?.status === "success" ? result : allowLoading ? { status: "loading" } : result,
            loadingItems:
              allowLoading && result?.status !== "success"
                ? buildCatalogLoadingItems(rowKey, loadingCount)
                : null,
            homeCatalogKey: buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId),
            homeCatalogDisableKey: buildCatalogDisableKey(
              catalog.addonBaseUrl,
              catalog.type,
              catalog.catalogId,
              catalog.catalogName
            )
          };
          if (onRow && (row.result?.status === "success" || allowLoading)) {
            onRow(row);
          }
          return row;
        })
      );
      const mappedRows = rowResults.filter(
        (row) => row.result?.status === "success" || allowLoading
      );
      fetchedRows.push(...mappedRows);
      if (onBatch && mappedRows.length) {
        onBatch(mappedRows);
      }
    };

    if (batchSize > 0 && normalizedDescriptors.length > batchSize) {
      for (let index = 0; index < normalizedDescriptors.length; index += batchSize) {
        await fetchBatch(normalizedDescriptors.slice(index, index + batchSize));
        if (index + batchSize < normalizedDescriptors.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return fetchedRows;
    }

    await fetchBatch(normalizedDescriptors);
    return fetchedRows;
  },

  sortAndFilterRows(rows = [], collections = []) {
    const collectionRows = (Array.isArray(collections) ? collections : [])
      .map((collection) => buildCollectionHomeRow(collection))
      .filter((row) => Array.isArray(row?.result?.data?.items) && row.result.data.items.length);
    const catalogRows = (Array.isArray(rows) ? rows : []).filter(
      (row) => row?.rowKind !== "collection"
    );
    const rowMap = new Map(
      [...catalogRows, ...collectionRows].map((row) => [row.homeCatalogKey, row])
    );
    const allKeys = Array.from(rowMap.keys());
    const orderedKeys = HomeCatalogStore.ensureOrderKeys(allKeys);
    const homeCatalogPrefs = HomeCatalogStore.get();
    const disabledKeys = new Set(homeCatalogPrefs.disabled || []);
    const customTitles = homeCatalogPrefs.customTitles || {};
    const applyCustomTitle = (row) => {
      const customTitle = String(customTitles[row?.homeCatalogKey] || "").trim();
      return customTitle ? { ...row, catalogName: customTitle } : row;
    };
    const isRowDisabled = (row) =>
      disabledKeys.has(row.homeCatalogDisableKey) || disabledKeys.has(row.homeCatalogKey);
    const pinnedTopRows = collectionRows
      .filter((row) => row.pinToTop && !isRowDisabled(row))
      .map(applyCustomTitle);
    const pinnedKeys = new Set(pinnedTopRows.map((row) => row.homeCatalogKey));
    const orderedRows = orderedKeys
      .filter((key) => !pinnedKeys.has(key))
      .map((key) => rowMap.get(key))
      .filter(Boolean)
      .filter((row) => !isRowDisabled(row))
      .map(applyCustomTitle);
    return [...pinnedTopRows, ...orderedRows];
  },

  retryPendingCatalogRows() {
    if (this.catalogRetryInFlight) {
      return;
    }
    const pendingRows = (this.rows || []).filter((row) => row?.result?.status === "loading");
    if (!pendingRows.length) {
      return;
    }
    const token = this.homeLoadToken;
    this.catalogRetryInFlight = true;
    const retryBatchSize = Math.max(
      1,
      Number(this.getDeferredCatalogBatchSize() || pendingRows.length || 1)
    );
    const progressiveRetryRendering = this.shouldProgressivelyRenderDeferredRows();
    let hasBufferedUpdates = false;
    (async () => {
      for (let index = 0; index < pendingRows.length; index += retryBatchSize) {
        const batch = pendingRows.slice(index, index + retryBatchSize);
        const settled = await Promise.allSettled(
          batch.map(async (row) => {
            const result = await withTimeout(
              catalogRepository.getCatalog({
                addonBaseUrl: row.addonBaseUrl,
                addonId: row.addonId,
                addonName: row.addonName,
                catalogId: row.catalogId,
                catalogName: row.catalogName,
                type: row.type,
                skip: 0,
                supportsSkip: true
              }),
              HOME_ROW_RETRY_TIMEOUT_MS,
              { status: "error", message: "timeout" }
            );
            if (result?.status !== "success") {
              return null;
            }
            return {
              ...row,
              result
            };
          })
        );
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        const updatedRows = settled
          .filter((entry) => entry?.status === "fulfilled" && entry.value)
          .map((entry) => entry.value);
        settled
          .filter((entry) => entry?.status === "rejected")
          .forEach((entry) => console.warn("Retry catalog row load failed", entry.reason));
        if (updatedRows.length) {
          const combinedByKey = new Map(
            (this.rows || []).map((entry) => [entry.homeCatalogKey, entry])
          );
          updatedRows.forEach((row) => {
            combinedByKey.set(row.homeCatalogKey, row);
          });
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          if (progressiveRetryRendering) {
            this.requestBackgroundRender();
          } else {
            hasBufferedUpdates = true;
          }
        }
        if (index + retryBatchSize < pendingRows.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (hasBufferedUpdates && token === this.homeLoadToken && Router.getCurrent() === "home") {
        this.requestBackgroundRender();
      }
    })().finally(() => {
      if (token === this.homeLoadToken) {
        this.catalogRetryInFlight = false;
      }
    });
  },

  render() {
    const renderStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
    this.cancelScheduledRender();
    this.cancelModernCameraFollow({ stopAnimations: true });
    this.teardownModernTrackScrollPagination();
    this.invalidateNavigationModel();
    const backFocusState = this.isRestoringFocusFromBack
      ? this.pendingBackFocusState || this.readStoredReturnFocusState() || null
      : null;
    const liveFocusState = this.captureCurrentFocusState();
    const savedFocusState = this.savedFocusStates?.[this.layoutMode] || null;
    const rawRetainedFocusState =
      backFocusState ||
      (!this.isRestoringFocusFromBack && liveFocusState?.focusKind === "sidebar"
        ? null
        : liveFocusState) ||
      (!this.isRestoringFocusFromBack && savedFocusState?.focusKind === "sidebar"
        ? null
        : savedFocusState) ||
      null;
    const retainedFocusState = rawRetainedFocusState;
    this.cancelFocusedPosterFlow();
    this.expandedPosterNode = null;
    const backFocusHero = backFocusState ? this.getHeroSourceFromFocusState(backFocusState) : null;
    const shouldHoldHeroForContinueWatching =
      this.layoutMode === "modern" &&
      Boolean(this.continueWatchingLoading) &&
      !this.continueWatchingDisplay?.length &&
      !this.heroItem;
    let heroItem = null;
    if (!shouldHoldHeroForContinueWatching) {
      const rawHeroItem =
        backFocusHero ||
        this.heroItem ||
        this.heroCandidates?.[this.heroIndex] ||
        this.pickHeroItem(this.rows);
      heroItem = isCollectionFolderItem(rawHeroItem)
        ? normalizeCollectionFolderItem(rawHeroItem)
        : normalizeCatalogItem(rawHeroItem, "movie");
      if (backFocusHero) {
        this.heroItem = heroItem;
      }
    }
    if (this.layoutMode === "modern" && shouldEnrichModernHero(heroItem)) {
      heroItem = { ...heroItem, heroMetaEnriching: true };
      this.heroItem = heroItem;
    }
    const showHeroSection = Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(heroItem);
    const modernLandscapePostersEnabled =
      this.layoutMode === "modern" && Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
    const modernLandscapeLayoutClass = modernLandscapePostersEnabled
      ? " home-modern-landscape-posters"
      : "";
    const modernHeroFullScreenBackdropClass =
      this.layoutMode === "modern" && Boolean(this.layoutPrefs?.modernHeroFullScreenBackdropEnabled)
        ? " home-modern-fullscreen-backdrop"
        : "";
    const modernSidebarLayoutClass = this.layoutPrefs?.modernSidebar
      ? " home-modern-sidebar-enabled"
      : "";
    const layoutClass = `home-layout-${this.layoutMode}${modernLandscapeLayoutClass}${modernHeroFullScreenBackdropClass}${modernSidebarLayoutClass}`;
    const sizingStyle =
      this.layoutMode === "modern" ? buildModernHomeSizingStyle(this.layoutPrefs) : "";
    const showPosterLabels = this.layoutPrefs?.posterLabelsEnabled !== false;
    const showCatalogAddonName = this.layoutPrefs?.catalogAddonNameEnabled !== false;
    const showCatalogTypeSuffix = this.layoutPrefs?.catalogTypeSuffixEnabled !== false;
    const pendingPosterFocusState = this.pendingPosterHoldFocus?.rowKey
      ? {
          rowKey: String(this.pendingPosterHoldFocus.rowKey),
          itemIndex: Number(this.pendingPosterHoldFocus.index || 0)
        }
      : null;
    const focusState =
      pendingPosterFocusState ||
      (!this.homeHoldFocusLocked && retainedFocusState && retainedFocusState.focusKind === "item"
        ? retainedFocusState
        : null);
    const focusedPosterFlowConfig = this.getFocusedPosterFlowConfig(this.layoutPrefs || {});
    const expandFocusedPoster =
      this.layoutMode === "modern" &&
      Boolean(focusedPosterFlowConfig.shouldExpand) &&
      Number(this.layoutPrefs?.focusedPosterBackdropExpandDelaySeconds ?? 3) <= 0 &&
      Boolean(focusState);
    const rowItemLimit = this.getRowItemLimit();
    const loadingRowItemCount = this.getLoadingRowItemCount();
    const continueWatchingLoadingCount = Math.min(
      Math.max(
        Number(this.continueWatching?.length || 0),
        Number(this.nextUpProgressCandidates?.length || 0)
      ),
      loadingRowItemCount
    );
    const effectiveContinueWatchingLoadingCount =
      this.continueWatchingLoading && continueWatchingLoadingCount === 0
        ? loadingRowItemCount
        : continueWatchingLoadingCount;
    this.teardownGridStickyHeader();

    let mainContentMarkup = "";
    let modernLayoutPayload = null;

    if (this.isInitialHomeLoading) {
      mainContentMarkup = renderHomeLoadingState();
      this.catalogSeeAllMap = new Map();
    } else if (this.layoutMode === "modern") {
      modernLayoutPayload = renderModernHomeLayout({
        rows: this.rows,
        heroItem,
        heroCandidates: this.heroCandidates,
        continueWatchingItems: this.continueWatchingDisplay || [],
        continueWatchingLoading: Boolean(this.continueWatchingLoading),
        continueWatchingLoadingCount: effectiveContinueWatchingLoadingCount,
        useEpisodeThumbnailsInCw: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
        blurContinueWatchingNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs),
        rowItemLimit,
        showHeroSection,
        showPosterLabels,
        showCatalogTypeSuffix,
        preferLandscapePosters: modernLandscapePostersEnabled,
        focusedRowKey: focusState?.rowKey || "",
        focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
        expandFocusedPoster,
        buildModernHeroPresentation,
        renderHeroBackdropImage,
        renderContinueWatchingSection,
        createPosterCardMarkup,
        createSeeAllCardMarkup,
        formatCatalogRowTitle,
        shouldDeferRowImages: shouldDeferHomeRowImages,
        watchedTitleIds: this.watchedTitleIds,
        escapeHtml,
        escapeAttribute
      });
      this.catalogSeeAllMap = modernLayoutPayload.catalogSeeAllMap;
      mainContentMarkup = modernLayoutPayload.markup;
    } else {
      const continueHtml = renderContinueWatchingSection(this.continueWatchingDisplay || [], {
        rowKey: "continue_watching",
        loading: Boolean(this.continueWatchingLoading),
        loadingCount: effectiveContinueWatchingLoadingCount,
        useEpisodeThumbnails: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
        blurNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs)
      });
      const legacyRowsPayload = renderLegacyCatalogRowsMarkup(this.rows, {
        layoutMode: this.layoutMode,
        showPosterLabels,
        showCatalogAddonName,
        showCatalogTypeSuffix,
        focusedRowKey: focusState?.rowKey || "",
        focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
        expandFocusedPoster: false,
        rowItemLimit,
        watchedTitleIds: this.watchedTitleIds
      });
      this.catalogSeeAllMap = legacyRowsPayload.catalogSeeAllMap;
      mainContentMarkup = `
        ${showHeroSection ? renderHeroMarkup(this.layoutMode, heroItem, this.heroCandidates) : ""}
        ${continueHtml}
        ${this.layoutMode === "grid" ? '<div class="home-grid-sticky" id="homeGridSticky"></div>' : ""}
        <section class="home-catalogs${this.layoutMode === "grid" ? " home-grid-catalogs" : ""}" id="homeCatalogRows">${legacyRowsPayload.markup}</section>
      `;
    }

    const routeEnterClass = this.homeRouteEnterPending
      ? this.pendingCollectionRouteReturnAnimation
        ? " nuvio-route-slide-enter"
        : " home-route-content-enter"
      : "";
    this.pendingCollectionRouteReturnAnimation = false;
    // On Back, only keep the sidebar expanded if the restored focus actually
    // belonged to the sidebar.
    if (this.isRestoringFocusFromBack && retainedFocusState?.focusKind !== "sidebar") {
      this.sidebarExpanded = false;
    }
    const sidebarFocusLocked = Boolean(
      this.sidebarExpanded && retainedFocusState?.focusKind === "sidebar"
    );

    this.container.innerHTML = `
      <div class="home-shell home-screen-shell ${layoutClass}"${sizingStyle ? ` style="${escapeAttribute(sizingStyle)}"` : ""}>
        ${renderRootSidebar({
          selectedRoute: "home",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}

        <main class="home-main home-screen-main">
          <div class="home-route-content${routeEnterClass}">
            ${mainContentMarkup}
          </div>
        </main>
      </div>
      ${this.renderActiveHoldMenu()}
    `;

    if (modernLandscapePostersEnabled) {
      this.applyCachedModernLandscapePosterMetrics(
        this.container.querySelector(".home-screen-shell.home-modern-landscape-posters")
      );
    } else if (this.layoutMode === "modern") {
      this.applyCachedModernPortraitPosterMetrics(
        this.container.querySelector(
          ".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)"
        )
      );
    }
    bindRootSidebarEvents(this.container, {
      currentRoute: "home",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
    this.scheduleModernSidebarPillAutoCollapse();

    this.buildNavigationModel();
    this.bindHomeViewportEvents();
    if (this.layoutMode === "modern") {
      this.setupModernTrackScrollPagination();
    }
    const canAttemptRestore = Boolean(retainedFocusState);
    let restoredFocus = false;
    if (sidebarFocusLocked) {
      restoredFocus = this.restoreSidebarFocusState(
        retainedFocusState?.focusKind === "sidebar" ? retainedFocusState : null
      );
    }
    if (
      !sidebarFocusLocked &&
      !this.homeHoldFocusLocked &&
      !backFocusState &&
      this.pendingPosterHoldFocus
    ) {
      const pending = this.pendingPosterHoldFocus;
      const target = this.resolvePosterHoldRestoreTarget(pending);
      this.pendingPosterHoldFocus = null;
      if (target) {
        restoredFocus = true;
        this.setFocusedNode(target);
        this.lastMainFocus = target;
        this.rememberMainRowFocus(target);
        this.ensureTrackHorizontalVisibility(target);
        this.ensureMainVerticalVisibility(target);
      }
    }
    if (
      !restoredFocus &&
      !sidebarFocusLocked &&
      !this.homeHoldFocusLocked &&
      this.isRestoringFocusFromBack &&
      backFocusState
    ) {
      restoredFocus = this.restoreFocusState(backFocusState);
      if (restoredFocus) {
        this.isRestoringFocusFromBack = false;
      }
    }
    if (
      !restoredFocus &&
      !sidebarFocusLocked &&
      !this.homeHoldFocusLocked &&
      !backFocusState &&
      Number.isFinite(this.pendingContinueWatchingFocusIndex)
    ) {
      const cards = Array.from(
        this.container?.querySelectorAll(".home-row-continue .home-content-card.focusable") || []
      );
      const target =
        cards[
          Math.max(
            0,
            Math.min(cards.length - 1, Number(this.pendingContinueWatchingFocusIndex || 0))
          )
        ] ||
        cards[cards.length - 1] ||
        null;
      this.pendingContinueWatchingFocusIndex = null;
      if (target) {
        restoredFocus = true;
        this.setFocusedNode(target);
        this.lastMainFocus = target;
        this.rememberMainRowFocus(target);
        this.ensureTrackHorizontalVisibility(target);
        this.ensureMainVerticalVisibility(target);
      } else {
        ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
        const current = this.container.querySelector(".home-main .focusable.focused");
        if (current && this.isMainNode(current)) {
          this.lastMainFocus = current;
          this.scheduleModernHeroUpdate(current);
          this.scheduleFocusedPosterFlow(current);
        }
      }
    } else if (
      !sidebarFocusLocked &&
      !backFocusState &&
      !this.isRestoringFocusFromBack &&
      this.forceInitialContinueWatchingFocus &&
      this.layoutMode === "modern"
    ) {
      this.forceInitialContinueWatchingFocus = false;
      restoredFocus = this.focusInitialContinueWatchingCard();
      this.hasAppliedInitialContinueWatchingFocus = restoredFocus;
    } else if (!sidebarFocusLocked && canAttemptRestore && !this.homeHoldFocusLocked) {
      restoredFocus = this.restoreFocusState(retainedFocusState);
      if (restoredFocus) {
        this.isRestoringFocusFromBack = false;
      }
    }
    if (
      !restoredFocus &&
      !sidebarFocusLocked &&
      !this.homeHoldFocusLocked &&
      !backFocusState &&
      !this.isRestoringFocusFromBack &&
      shouldHoldHeroForContinueWatching &&
      this.layoutMode === "modern"
    ) {
      const currentFocusedNode = this.getCurrentFocusedNode();
      if (currentFocusedNode?.isConnected) {
        currentFocusedNode.classList.remove("focused");
      }
      this.setCurrentFocusedNode(null);
      this.lastMainFocus = null;
      this.hasAppliedInitialContinueWatchingFocus = this.focusInitialContinueWatchingCard();
    } else if (
      !restoredFocus &&
      !sidebarFocusLocked &&
      !this.homeHoldFocusLocked &&
      !backFocusState
    ) {
      ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
      const current = this.container.querySelector(".home-main .focusable.focused");
      if (current && this.isMainNode(current)) {
        this.lastMainFocus = current;
        this.scheduleModernHeroUpdate(current);
        this.scheduleFocusedPosterFlow(current);
      }
      this.isRestoringFocusFromBack = false;
    }
    if (!this.container?.querySelector(".home-poster-card.focused")) {
      this.clearFocusedPosterFlowState();
    }
    this.syncFocusedCollectionCardState();
    if (!this.layoutPrefs?.modernSidebar) {
      this.setSidebarExpanded(false);
    }
    if (this.layoutMode === "grid") {
      this.setupGridStickyHeader(showHeroSection);
    }
    this.startHeroRotation();
    if (this.layoutMode === "modern" && heroItem) {
      void this.enrichCurrentHeroAsync(heroItem);
    }
    this.homeRouteEnterPending = false;
    this.renderedLayoutMode = this.layoutMode;
    this.ensureHomeTruncationObservers();
    this.scheduleHomeTruncationUpdate();
    this.scheduleHomeLazyImageHydration();
    this.scheduleReturnFocusRestore();
    const mountedRows = Number(this.navModel?.rows?.length || 0);
    const mountedCards = Number(
      (this.navModel?.rows || []).reduce((total, rowNodes) => total + rowNodes.length, 0)
    );
    logHomePerf("render", {
      ms: Number((homePerfNow() - renderStart).toFixed(2)),
      layoutMode: this.layoutMode,
      rows: Number(this.rows?.length || 0),
      mountedRows,
      mountedCards,
      continueWatching: Number(this.continueWatchingDisplay?.length || 0),
      focusables: Number(mountedCards + (this.navModel?.sidebar?.length || 0))
    });
  },

  scheduleHomeLazyImageHydration(anchorNode = null) {
    if (anchorNode instanceof HTMLElement) {
      this.pendingHomeLazyImageAnchor = anchorNode;
    }
    if (this.modernVerticalFastScrollState) {
      return;
    }
    if (this.homeLazyImageHydrationRaf) {
      return;
    }
    this.homeLazyImageHydrationRaf = requestAnimationFrame(() => {
      this.homeLazyImageHydrationRaf = 0;
      const anchor = this.pendingHomeLazyImageAnchor || this.getCurrentFocusedNode();
      this.pendingHomeLazyImageAnchor = null;
      this.hydrateHomeLazyImages(anchor);
    });
  },

  hydrateHomeLazyImages(anchorNode = null) {
    if (!this.container) {
      return;
    }
    const images = Array.from(
      this.container.querySelectorAll(
        ".home-main .content-poster[data-src], .home-main .home-poster-landscape-logo[data-src], .home-main .home-continue-bg[data-src]"
      )
    );
    if (!images.length) {
      return;
    }
    const viewport =
      this.container.querySelector(".home-modern-rows-viewport") ||
      this.container.querySelector(".home-main") ||
      this.container;
    const viewportRect = viewport.getBoundingClientRect();
    const anchorRow =
      anchorNode?.closest?.(
        ".home-row, .home-modern-row, .home-grid-section, .home-row-continue"
      ) || null;
    const verticalMargin = Platform.isWebOS() || Platform.isTizen() ? 720 : 1200;
    const horizontalMargin = Platform.isWebOS() || Platform.isTizen() ? 520 : 1000;
    const rowSelector = ".home-row, .home-modern-row, .home-grid-section, .home-row-continue";
    const imagesByRow = new Map();
    images.forEach((image) => {
      const row = image.closest(rowSelector);
      const rowImages = imagesByRow.get(row) || [];
      rowImages.push(image);
      imagesByRow.set(row, rowImages);
    });
    imagesByRow.forEach((rowImages, row) => {
      const shouldHydrateFocusedRow = Boolean(anchorRow && row === anchorRow);
      if (!shouldHydrateFocusedRow && row instanceof HTMLElement) {
        const rowRect = row.getBoundingClientRect();
        const isRowNearViewport =
          rowRect.bottom >= viewportRect.top - verticalMargin &&
          rowRect.top <= viewportRect.bottom + verticalMargin;
        if (!isRowNearViewport) {
          return;
        }
      }
      rowImages.forEach((image) => {
        if (!(image instanceof HTMLImageElement)) {
          return;
        }
        const src = String(image.dataset.src || "").trim();
        if (!src) {
          image.removeAttribute("data-src");
          return;
        }
        if (!shouldHydrateFocusedRow) {
          const rect = image.getBoundingClientRect();
          const isNearViewport =
            rect.bottom >= viewportRect.top - verticalMargin &&
            rect.top <= viewportRect.bottom + verticalMargin &&
            rect.right >= viewportRect.left - horizontalMargin &&
            rect.left <= viewportRect.right + horizontalMargin;
          if (!isNearViewport) {
            return;
          }
        }
        // The app already decides when an image is close enough to load. Leaving
        // loading="lazy" here delegates that decision back to old TV browsers,
        // which can miscalculate visibility inside the nested modern-home viewport.
        image.loading = "eager";
        image.removeAttribute("data-src");
        image.src = src;
      });
    });
  },

  teardownGridStickyHeader() {
    if (this.gridStickyCleanup) {
      this.gridStickyCleanup();
      this.gridStickyCleanup = null;
    }
  },

  setupGridStickyHeader(showHeroSection) {
    const main = this.container?.querySelector(".home-main");
    const sticky = this.container?.querySelector("#homeGridSticky");
    const sections = Array.from(
      this.container?.querySelectorAll(".home-grid-section[data-section-title]") || []
    );
    if (!main || !sticky || !sections.length) {
      return;
    }
    const hero = showHeroSection ? this.container?.querySelector(".home-hero") : null;
    const heroHeight = hero ? hero.offsetHeight : 0;
    const update = () => {
      const threshold = main.scrollTop + 72;
      let activeTitle = "";
      sections.forEach((section) => {
        if (section.offsetTop <= threshold) {
          activeTitle = String(section.dataset.sectionTitle || "");
        }
      });
      const shouldShow =
        activeTitle && (!showHeroSection || main.scrollTop > Math.max(0, heroHeight - 48));
      sticky.textContent = activeTitle;
      sticky.classList.toggle("is-visible", Boolean(shouldShow));
    };
    main.addEventListener("scroll", update, { passive: true });
    update();
    this.gridStickyCleanup = () => {
      main.removeEventListener("scroll", update);
    };
  },

  selectNextUpProgressCandidates(
    allProgress = [],
    inProgressItems = [],
    watchedItems = [],
    options = {}
  ) {
    const includeWatchedItemSeeds = options?.includeWatchedItemSeeds !== false;
    const includeProgressSeeds = options?.includeProgressSeeds !== false;
    const applyDaysCap = options?.applyDaysCap !== false;
    const cutoffMs = applyDaysCap ? Date.now() - CW_DAYS_CAP * 24 * 60 * 60 * 1000 : 0;
    const nextUpFromFurthestEpisode = options?.nextUpFromFurthestEpisode !== false;
    const inProgressSeriesIds = new Set(
      (Array.isArray(inProgressItems) ? inProgressItems : [])
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    const latestCompletedByContent = new Map();
    const shouldReplaceNextUpSeed = (existing, incoming) => {
      if (!existing) {
        return true;
      }
      const existingEpisodeKey = episodeSortKey(existing.season, existing.episode);
      const incomingEpisodeKey = episodeSortKey(incoming.season, incoming.episode);
      if (nextUpFromFurthestEpisode && incomingEpisodeKey !== existingEpisodeKey) {
        return incomingEpisodeKey > existingEpisodeKey;
      }
      const existingUpdated = Number(existing.updatedAt || 0);
      const incomingUpdated = Number(incoming.updatedAt || 0);
      if (incomingUpdated !== existingUpdated) {
        return incomingUpdated > existingUpdated;
      }
      return incomingEpisodeKey > existingEpisodeKey;
    };
    const addSeed = (entry) => {
      if (cutoffMs > 0 && Number(entry?.updatedAt || 0) < cutoffMs) {
        return;
      }
      const contentId = String(entry?.contentId || "").trim();
      if (!contentId || inProgressSeriesIds.has(contentId)) {
        return;
      }
      if (!isSeriesTypeForContinueWatching(entry?.contentType)) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (season <= 0 || episode <= 0 || !isCompletedForContinueWatching(entry)) {
        return;
      }

      const existing = latestCompletedByContent.get(contentId);
      if (shouldReplaceNextUpSeed(existing, entry)) {
        latestCompletedByContent.set(contentId, entry);
      }
    };

    if (includeProgressSeeds) {
      (Array.isArray(allProgress) ? allProgress : []).forEach(addSeed);
    }
    if (includeWatchedItemSeeds) {
      (Array.isArray(watchedItems) ? watchedItems : [])
        .map((item) => buildNextUpSeedFromWatchedItem(item))
        .filter(Boolean)
        .forEach(addSeed);
    }

    return Array.from(latestCompletedByContent.values()).sort(
      (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
    );
  },

  buildWatchedEpisodeIndex(watchedItems = []) {
    const byContent = new Map();
    (Array.isArray(watchedItems) ? watchedItems : []).forEach((entry) => {
      const contentId = String(entry?.contentId || "").trim();
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (!contentId || season <= 0 || episode <= 0) {
        return;
      }
      if (!byContent.has(contentId)) {
        byContent.set(contentId, new Set());
      }
      byContent.get(contentId).add(episodeKey(season, episode));
    });
    return byContent;
  },

  buildEpisodeProgressIndex(allProgress = [], contentId = "") {
    const targetContentId = String(contentId || "").trim();
    const byEpisode = new Map();
    if (!targetContentId) {
      return byEpisode;
    }

    (Array.isArray(allProgress) ? allProgress : []).forEach((entry) => {
      if (String(entry?.contentId || "").trim() !== targetContentId) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (season <= 0 || episode <= 0) {
        return;
      }
      const key = episodeKey(season, episode);
      const existing = byEpisode.get(key);
      if (!existing || Number(entry?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
        byEpisode.set(key, entry);
      }
    });

    return byEpisode;
  },

  async fetchMetaForContinueWatching(
    contentType,
    contentId,
    timeoutMs = CW_META_TIMEOUT_MS,
    alternateContentIds = []
  ) {
    const effectiveTimeoutMs = getContinueWatchingMetaTimeout(timeoutMs);
    const normalizedType = String(contentType || "")
      .trim()
      .toLowerCase();
    const typeCandidates = [];
    if (normalizedType) {
      typeCandidates.push(normalizedType);
    }
    if (isSeriesTypeForContinueWatching(normalizedType)) {
      typeCandidates.push("series", "tv");
    } else {
      typeCandidates.push("movie");
    }

    const rawContentId = String(contentId || "").trim();
    const idCandidates = [];
    [
      ...(Array.isArray(alternateContentIds) ? alternateContentIds : [alternateContentIds]),
      rawContentId
    ]
      .map((candidate) => String(candidate || "").trim())
      .filter(Boolean)
      .forEach((candidate) => {
        idCandidates.push(candidate);
        if (candidate.includes(":")) {
          idCandidates.push(candidate.split(":").pop());
        }
      });

    const seenTypes = new Set();
    const requests = [];
    for (const type of typeCandidates) {
      const normalizedCandidate = String(type || "")
        .trim()
        .toLowerCase();
      if (!normalizedCandidate || seenTypes.has(normalizedCandidate)) {
        continue;
      }
      seenTypes.add(normalizedCandidate);
      const seenIds = new Set();
      for (const candidateId of idCandidates) {
        const normalizedId = String(candidateId || "").trim();
        if (!normalizedId || seenIds.has(normalizedId)) {
          continue;
        }
        seenIds.add(normalizedId);
        requests.push(
          withTimeout(
            metaRepository.getMetaFromAllAddons(normalizedCandidate, normalizedId),
            effectiveTimeoutMs,
            { status: "error", message: "timeout" }
          ).catch(() => ({ status: "error" }))
        );
      }
    }

    const results = await Promise.all(requests);
    const match = results.find((result) => result?.status === "success" && result?.data);
    if (match) {
      return match.data;
    }

    return null;
  },

  resolveNextUpEpisode(
    meta = {},
    completedProgress = {},
    allProgress = [],
    watchedEpisodeKeys = new Set(),
    options = {}
  ) {
    const episodes = normalizeEpisodeEntries(meta?.videos || []);
    if (!episodes.length) {
      return null;
    }
    const showUnairedNextUp = options?.showUnairedNextUp !== false;

    const progressByEpisode = this.buildEpisodeProgressIndex(
      allProgress,
      completedProgress?.contentId
    );
    const anchorVideoId = String(completedProgress?.videoId || "").trim();
    let anchorIndex = anchorVideoId
      ? episodes.findIndex((entry) => String(entry?.id || "") === anchorVideoId)
      : -1;

    const anchorSeason = Number(completedProgress?.season || 0);
    const anchorEpisode = Number(completedProgress?.episode || 0);
    if (anchorIndex < 0 && anchorSeason > 0 && anchorEpisode > 0) {
      anchorIndex = episodes.findIndex(
        (entry) =>
          Number(entry.season || 0) === anchorSeason && Number(entry.episode || 0) === anchorEpisode
      );
    }

    if (anchorIndex < 0) {
      let latestCompleted = null;
      progressByEpisode.forEach((entry) => {
        if (!isCompletedForContinueWatching(entry)) {
          return;
        }
        if (
          !latestCompleted ||
          Number(entry.updatedAt || 0) > Number(latestCompleted.updatedAt || 0)
        ) {
          latestCompleted = entry;
        }
      });
      if (latestCompleted) {
        anchorIndex = episodes.findIndex(
          (entry) =>
            Number(entry.season || 0) === Number(latestCompleted.season || 0) &&
            Number(entry.episode || 0) === Number(latestCompleted.episode || 0)
        );
      }
    }

    if (anchorIndex < 0) {
      return null;
    }

    for (let index = anchorIndex + 1; index < episodes.length; index += 1) {
      const candidate = episodes[index];
      const key = episodeKey(candidate.season, candidate.episode);
      const candidateProgress = progressByEpisode.get(key);
      if (watchedEpisodeKeys?.has?.(key)) {
        continue;
      }
      if (candidateProgress && isCompletedForContinueWatching(candidateProgress)) {
        continue;
      }
      if (candidateProgress && shouldTreatAsInProgressForContinueWatching(candidateProgress)) {
        return null;
      }
      if (
        !shouldShowNextUpEpisodeForContinueWatching(
          candidate,
          episodes[anchorIndex]?.season,
          showUnairedNextUp
        )
      ) {
        continue;
      }
      return candidate;
    }

    return null;
  },

  async buildNextUpItems({
    allProgress = [],
    inProgressItems = [],
    nextUpProgressCandidates = [],
    watchedItems = []
  } = {}) {
    const resolvedCandidates =
      Array.isArray(nextUpProgressCandidates) && nextUpProgressCandidates.length
        ? nextUpProgressCandidates
        : this.selectNextUpProgressCandidates(allProgress, inProgressItems, watchedItems, {
            applyDaysCap: watchProgressRepository.getContinueWatchingSource?.() === "trakt",
            includeProgressSeeds: watchProgressRepository.getContinueWatchingSource?.() === "trakt",
            includeWatchedItemSeeds:
              watchProgressRepository.getContinueWatchingSource?.() !== "trakt",
            nextUpFromFurthestEpisode: this.layoutPrefs?.nextUpFromFurthestEpisode
          });

    if (!resolvedCandidates.length) {
      return [];
    }

    const dismissedNextUpKeys = new Set(ContinueWatchingPreferences.getDismissedNextUpKeys());
    const activeCandidates = resolvedCandidates.filter((entry) => {
      const contentId = String(entry?.contentId || "").trim();
      return contentId && !dismissedNextUpKeys.has(contentId);
    });
    if (!activeCandidates.length) {
      return [];
    }

    const watchedEpisodeIndex = this.buildWatchedEpisodeIndex(watchedItems);

    const nextUpItems = await resolveNextUpCandidates(
      activeCandidates,
      async (progressEntry) => {
        const contentType = String(progressEntry?.contentType || "series").toLowerCase();
        const contentId = String(progressEntry?.contentId || "").trim();
        if (!contentId || !isSeriesTypeForContinueWatching(contentType)) {
          return null;
        }

        let meta = null;
        try {
          meta = await this.fetchMetaForContinueWatching(
            contentType,
            contentId,
            CW_NEXT_UP_META_TIMEOUT_MS,
            [progressEntry?.imdbId]
          );
        } catch (error) {
          console.warn("Next up meta lookup failed", error);
        }

        if (!meta) {
          return null;
        }
        meta = await this.enrichContinueWatchingMetaWithTmdb(meta, {
          contentId,
          contentType,
          season: progressEntry?.season,
          episode: progressEntry?.episode
        });

        const watchedEpisodeKeys = watchedEpisodeIndex.get(contentId) || new Set();
        const nextEpisode = this.resolveNextUpEpisode(
          meta,
          progressEntry,
          allProgress,
          watchedEpisodeKeys,
          {
            showUnairedNextUp: this.layoutPrefs?.showUnairedNextUp
          }
        );
        if (!nextEpisode) {
          return null;
        }
        const hasAired = hasEpisodeAiredForContinueWatching(nextEpisode.released);
        const releaseState = resolveNextUpReleaseState({
          released: nextEpisode.released,
          hasAired,
          seedUpdatedAt: progressEntry?.updatedAt,
          seedSeason: progressEntry?.season,
          season: nextEpisode.season
        });

        return {
          contentId,
          contentType,
          videoId: nextEpisode.id || null,
          season: Number(nextEpisode.season || 0) || null,
          episode: Number(nextEpisode.episode || 0) || null,
          episodeTitle: firstNonEmpty(nextEpisode.title),
          positionMs: 0,
          durationMs: 0,
          updatedAt: Number(progressEntry?.updatedAt || Date.now()),
          seedUpdatedAt: Number(progressEntry?.updatedAt || 0) || 0,
          seedSeason: Number(progressEntry?.season || 0) || null,
          isNextUp: true,
          ...releaseState,
          title: meta.name || prettyId(contentId),
          landscapePoster: firstNonEmpty(
            meta.landscapePoster,
            meta.thumbnail,
            meta.backdrop,
            meta.background,
            nextEpisode.thumbnail,
            meta.poster
          ),
          episodeThumbnail: firstNonEmpty(nextEpisode.thumbnail),
          poster: firstNonEmpty(
            meta.poster,
            nextEpisode.thumbnail,
            meta.thumbnail,
            meta.background,
            meta.backdrop
          ),
          background: firstNonEmpty(
            meta.background,
            meta.backdrop,
            nextEpisode.thumbnail,
            meta.poster
          ),
          backdrop: firstNonEmpty(meta.backdrop, meta.background, nextEpisode.thumbnail),
          thumbnail: firstNonEmpty(
            nextEpisode.thumbnail,
            meta.thumbnail,
            meta.poster,
            meta.background
          ),
          logo: firstNonEmpty(meta.logo),
          description: firstNonEmpty(nextEpisode.overview, meta.description),
          released: firstNonEmpty(nextEpisode.released),
          releaseInfo: firstNonEmpty(nextEpisode.released, meta.releaseInfo),
          imdbRating: resolveImdbRating(meta),
          genres: Array.isArray(meta.genres) ? meta.genres : [],
          runtimeMinutes: Number(meta.runtimeMinutes ?? meta.runtime ?? 0) || 0,
          ageRating: firstNonEmpty(meta.ageRating, meta.age_rating),
          status: firstNonEmpty(meta.status),
          language: firstNonEmpty(meta.language),
          country: firstNonEmpty(meta.country)
        };
      },
      {
        maxLookups: CW_MAX_NEXT_UP_LOOKUPS,
        concurrency: CW_MAX_NEXT_UP_CONCURRENCY
      }
    );

    return nextUpItems.sort(
      (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
    );
  },

  persistContinueWatchingSnapshot() {
    writeContinueWatchingDisplaySnapshot(
      watchProgressRepository.getContinueWatchingSourceKey(),
      this.continueWatchingDisplay
    );
  },

  clearContinueWatchingSnapshot() {
    const scopeKey = watchProgressRepository.getContinueWatchingSourceKey();
    if (!scopeKey) {
      return;
    }
    const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
    if (
      !store ||
      typeof store !== "object" ||
      !Object.prototype.hasOwnProperty.call(store, scopeKey)
    ) {
      return;
    }
    const next = { ...store };
    delete next[scopeKey];
    LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, next);
    this.continueWatchingHydratedFromSnapshot = false;
  },

  async enrichContinueWatchingMetaWithTmdb(meta = {}, item = {}) {
    const settings = TmdbSettingsStore.get();
    if (!settings.enabled || !settings.enrichContinueWatching || !TMDB_API_KEY || !meta) {
      return meta;
    }
    const contentType = item.contentType || meta.type || "movie";
    try {
      const explicitTmdbId = Number(item.tmdbId || 0);
      const tmdbLookupId =
        explicitTmdbId > 0
          ? `tmdb:${explicitTmdbId}`
          : firstNonEmpty(item.imdbId, item.contentId, meta.id);
      const tmdbId = await withTimeout(
        TmdbService.ensureTmdbId(tmdbLookupId, contentType),
        1800,
        null
      );
      if (!tmdbId) {
        return meta;
      }
      const enrichment = await withTimeout(
        TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType,
          language: settings.language
        }),
        2200,
        null
      );
      if (!enrichment) {
        return meta;
      }
      const isSeries = isSeriesTypeForContinueWatching(contentType);
      const episodeMap =
        settings.useEpisodes && isSeries && item.season != null && Number(item.season) >= 0
          ? await withTimeout(
              TmdbMetadataService.fetchEpisodeEnrichment({
                tmdbId,
                seasonNumbers: [Number(item.season)],
                language: settings.language
              }),
              1800,
              new Map()
            )
          : new Map();
      const videos =
        episodeMap.size && Array.isArray(meta.videos)
          ? meta.videos.map((video) => {
              const key =
                (video?.season != null || video?.seasonNumber != null) &&
                Number(video?.season ?? video?.seasonNumber) >= 0 &&
                Number(video?.episode ?? video?.episodeNumber ?? 0) > 0
                  ? `${Number(video.season ?? video.seasonNumber)}:${Number(
                      video.episode ?? video.episodeNumber
                    )}`
                  : "";
              const episode = key ? episodeMap.get(key) : null;
              if (!episode) {
                return video;
              }
              return {
                ...video,
                title: episode.title || video.title,
                overview: episode.overview || video.overview,
                released: settings.useReleaseDates
                  ? episode.airDate || video.released
                  : video.released,
                thumbnail: episode.thumbnail || video.thumbnail,
                runtime: episode.runtime || video.runtime
              };
            })
          : meta.videos;
      const currentEpisode = episodeMap.get(
        `${Number(item.season || 0)}:${Number(item.episode || 0)}`
      );
      return {
        ...meta,
        name: settings.useBasicInfo ? enrichment.localizedTitle || meta.name : meta.name,
        description: settings.useBasicInfo
          ? enrichment.description || meta.description
          : meta.description,
        background: settings.useArtwork ? enrichment.backdrop || meta.background : meta.background,
        backdrop: settings.useArtwork ? enrichment.backdrop || meta.backdrop : meta.backdrop,
        poster: settings.useArtwork ? enrichment.poster || meta.poster : meta.poster,
        thumbnail: settings.useArtwork ? enrichment.poster || meta.thumbnail : meta.thumbnail,
        logo: settings.useArtwork ? enrichment.logo || meta.logo : meta.logo,
        genres:
          settings.useBasicInfo && enrichment.genres?.length ? enrichment.genres : meta.genres,
        releaseInfo: settings.useReleaseDates
          ? enrichment.releaseInfo || meta.releaseInfo
          : meta.releaseInfo,
        released: settings.useReleaseDates ? enrichment.released || meta.released : meta.released,
        runtime: settings.useDetails ? enrichment.runtime || meta.runtime : meta.runtime,
        country: settings.useDetails ? enrichment.country || meta.country : meta.country,
        language: settings.useDetails ? enrichment.language || meta.language : meta.language,
        ageRating: settings.useDetails ? enrichment.ageRating || meta.ageRating : meta.ageRating,
        status: settings.useDetails ? enrichment.status || meta.status : meta.status,
        tmdbRating:
          settings.useBasicInfo && typeof enrichment.rating === "number"
            ? Number(enrichment.rating.toFixed(1))
            : meta.tmdbRating,
        episodeThumbnail: settings.useArtwork
          ? currentEpisode?.thumbnail || meta.episodeThumbnail
          : meta.episodeThumbnail,
        episodeTitle: settings.useEpisodes
          ? currentEpisode?.title || meta.episodeTitle
          : meta.episodeTitle,
        episodeDescription: settings.useEpisodes
          ? currentEpisode?.overview || meta.episodeDescription
          : meta.episodeDescription,
        episodeRuntime: settings.useEpisodes
          ? currentEpisode?.runtime || meta.episodeRuntime
          : meta.episodeRuntime,
        videos
      };
    } catch (error) {
      console.warn("Continue watching TMDB enrichment failed", error);
      return meta;
    }
  },

  async enrichContinueWatching(items = [], options = {}) {
    const [inProgressItems, nextUpItems] = await Promise.all([
      Promise.all(
        (items || []).map(async (item) => {
          const cachedItem = applyCachedContinueWatchingEnrichment(item);
          if (
            !options?.forceRefreshMetadata &&
            !needsContinueWatchingMetadataRefresh([cachedItem])
          ) {
            return cachedItem;
          }
          try {
            let meta = await this.fetchMetaForContinueWatching(
              item.contentType || "movie",
              item.contentId,
              options?.metaTimeoutMs || 1800,
              [item.imdbId]
            );
            if (!meta) {
              meta = {
                id: item.contentId,
                type: item.contentType || "movie",
                name: item.title || prettyId(item.contentId)
              };
            }
            if (meta) {
              const enrichedMeta = await this.enrichContinueWatchingMetaWithTmdb(meta, item);
              const episodeEntry = findEpisodeEntry(enrichedMeta.videos, item.season, item.episode);
              const runtimeMinutes = parseRuntimeMinutes(
                episodeEntry?.runtimeMinutes ??
                  enrichedMeta.episodeRuntime ??
                  enrichedMeta.runtimeMinutes ??
                  enrichedMeta.runtime ??
                  0
              );
              const enriched = {
                ...item,
                title: enrichedMeta.name || prettyId(item.contentId),
                landscapePoster:
                  enrichedMeta.landscapePoster ||
                  enrichedMeta.thumbnail ||
                  enrichedMeta.backdrop ||
                  enrichedMeta.background ||
                  null,
                episodeThumbnail:
                  episodeEntry?.thumbnail ||
                  enrichedMeta.episodeThumbnail ||
                  item.episodeThumbnail ||
                  null,
                poster:
                  enrichedMeta.poster ||
                  enrichedMeta.thumbnail ||
                  enrichedMeta.background ||
                  enrichedMeta.backdrop ||
                  null,
                background:
                  enrichedMeta.background ||
                  enrichedMeta.backdrop ||
                  enrichedMeta.thumbnail ||
                  enrichedMeta.poster ||
                  null,
                backdrop: enrichedMeta.backdrop || enrichedMeta.background || null,
                thumbnail: enrichedMeta.thumbnail || enrichedMeta.poster || null,
                logo: enrichedMeta.logo || null,
                description: enrichedMeta.description || "",
                releaseInfo: enrichedMeta.releaseInfo || "",
                imdbRating: resolveImdbRating(enrichedMeta),
                genres: Array.isArray(enrichedMeta.genres) ? enrichedMeta.genres : [],
                runtimeMinutes,
                durationMs:
                  Number(item.durationMs || 0) > 0
                    ? Number(item.durationMs || 0)
                    : runtimeMinutes > 0
                      ? Math.round(runtimeMinutes * 60000)
                      : 0,
                ageRating: firstNonEmpty(enrichedMeta.ageRating, enrichedMeta.age_rating),
                status: firstNonEmpty(enrichedMeta.status),
                language: firstNonEmpty(enrichedMeta.language),
                country: firstNonEmpty(enrichedMeta.country),
                episodeTitle: firstNonEmpty(
                  enrichedMeta.episodeTitle,
                  episodeEntry?.title,
                  item.episodeTitle,
                  item.subtitle
                ),
                episodeDescription: firstNonEmpty(
                  enrichedMeta.episodeDescription,
                  episodeEntry?.overview,
                  item.episodeDescription,
                  item.episode_description
                ),
                continueWatchingMetaResolved: true
              };
              saveContinueWatchingEnrichment(enriched);
              return enriched;
            }
          } catch (error) {
            console.warn("Continue watching enrichment failed", error);
          }
          return {
            ...cachedItem,
            title: firstNonEmpty(cachedItem.title, cachedItem.name),
            landscapePoster:
              cachedItem.landscapePoster ||
              cachedItem.thumbnail ||
              cachedItem.backdrop ||
              cachedItem.background ||
              null,
            episodeThumbnail: cachedItem.episodeThumbnail || null,
            poster: cachedItem.poster || cachedItem.thumbnail || null,
            background: cachedItem.background || cachedItem.backdrop || cachedItem.poster || null,
            backdrop: cachedItem.backdrop || cachedItem.background || null,
            thumbnail: cachedItem.thumbnail || cachedItem.poster || null,
            logo: cachedItem.logo || null,
            description: cachedItem.description || "",
            releaseInfo: cachedItem.releaseInfo || "",
            genres: Array.isArray(cachedItem.genres) ? cachedItem.genres : [],
            runtimeMinutes: Number(cachedItem.runtimeMinutes ?? cachedItem.runtime ?? 0) || 0,
            ageRating: firstNonEmpty(cachedItem.ageRating, cachedItem.age_rating),
            status: firstNonEmpty(cachedItem.status),
            language: firstNonEmpty(cachedItem.language),
            country: firstNonEmpty(cachedItem.country),
            episodeTitle: firstNonEmpty(cachedItem.episodeTitle, cachedItem.subtitle)
          };
        })
      ),
      this.buildNextUpItems({
        allProgress: options?.allProgress || [],
        inProgressItems: items || [],
        nextUpProgressCandidates: options?.nextUpProgressCandidates || [],
        watchedItems: options?.watchedItems || []
      })
    ]);

    const inProgressSeriesIds = new Set(
      inProgressItems
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    const combinedItems = [
      ...inProgressItems,
      ...nextUpItems.filter(
        (item) => !inProgressSeriesIds.has(String(item?.contentId || "").trim())
      )
    ];

    return sortContinueWatchingItemsForDisplay(
      combinedItems,
      this.layoutPrefs?.continueWatchingSortMode
    ).slice(0, CW_MAX_VISIBLE_ITEMS);
  },

  pickHeroItem(rows) {
    for (const row of rows) {
      const first = row.result?.data?.items?.[0];
      if (first) {
        return normalizeHomeRowItem(row, first);
      }
    }
    return null;
  },

  collectHeroCandidates(rows) {
    const flat = [];
    rows.forEach((row) => {
      (row?.result?.data?.items || []).slice(0, 4).forEach((item) => {
        const normalized = normalizeHomeRowItem(row, item);
        if (!normalized?.id || flat.some((entry) => entry.id === normalized.id)) {
          return;
        }
        flat.push(normalized);
      });
    });
    return flat.slice(0, 10);
  },

  async enrichHero(baseHero = null) {
    const nextBaseHero = baseHero || this.pickHeroItem(this.rows);
    const hero = isCollectionFolderItem(nextBaseHero)
      ? normalizeCollectionFolderItem(nextBaseHero)
      : normalizeCatalogItem(nextBaseHero, "movie");
    if (!hero) {
      this.heroItem = null;
      return;
    }

    if (isCollectionFolderItem(hero)) {
      this.heroItem = hero;
      return;
    }

    const settings = TmdbSettingsStore.get();
    const tmdbEnabledForCurrentLayout =
      settings.enabled && (this.layoutMode !== "modern" || settings.modernHomeEnabled);
    if (!tmdbEnabledForCurrentLayout || !TMDB_API_KEY) {
      this.heroItem = hero;
      return;
    }

    try {
      const tmdbId = await withTimeout(TmdbService.ensureTmdbId(hero.id, hero.type), 2200, null);
      if (!tmdbId) {
        this.heroItem = hero;
        return;
      }

      const enriched = await withTimeout(
        TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType: hero.type,
          language: settings.language
        }),
        2400,
        null
      );

      if (!enriched) {
        this.heroItem = hero;
        return;
      }

      this.heroItem = normalizeCatalogItem(
        {
          ...hero,
          name: settings.useBasicInfo ? enriched.localizedTitle || hero.name : hero.name,
          description: settings.useBasicInfo
            ? enriched.description || hero.description
            : hero.description,
          background: settings.useArtwork ? enriched.backdrop || hero.background : hero.background,
          poster: settings.useArtwork ? enriched.poster || hero.poster : hero.poster,
          logo: settings.useArtwork ? enriched.logo : hero.logo,
          genres: settings.useBasicInfo ? enriched.genres || hero.genres : hero.genres,
          releaseInfo: settings.useReleaseDates
            ? enriched.releaseInfo || hero.releaseInfo
            : hero.releaseInfo
        },
        hero.type || "movie"
      );
    } catch (error) {
      console.warn("Hero TMDB enrichment failed", error);
      this.heroItem = hero;
    }
  },

  openDetailFromNode(node) {
    if (this.resolveCollectionFolderTargetFromNode(node)) {
      this.openCollectionFolderFromNode(node);
      return;
    }
    const itemId = node.dataset.itemId;
    if (!itemId) {
      return;
    }
    this.rememberReturnFocusForNode(node);
    Router.navigate("detail", {
      itemId,
      itemType: node.dataset.itemType || node.dataset.catalogType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled",
      fallbackPoster: node.dataset.posterSrc || "",
      fallbackBackground: node.dataset.backdropSrc || "",
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
    });
  },

  openCollectionFolderFromNode(node) {
    const target = this.resolveCollectionFolderTargetFromNode(node);
    const collectionId = String(target?.collectionId || "").trim();
    const folderId = String(target?.folderId || "").trim();
    if (!collectionId || !folderId) {
      return;
    }
    this.rememberReturnFocusForNode(node);
    Router.navigate("folderDetail", {
      collectionId,
      folderId,
      collectionTitle: node?.dataset?.collectionTitle || ""
    });
  },

  openCatalogSeeAllFromNode(node) {
    if (!node) {
      return;
    }
    this.rememberReturnFocusForNode(node);
    const seeAllId = String(node.dataset.seeAllId || "");
    const mapped = this.catalogSeeAllMap?.get?.(seeAllId) || null;
    if (mapped) {
      Router.navigate("catalogSeeAll", mapped);
      return;
    }
    Router.navigate("catalogSeeAll", {
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogId: node.dataset.catalogId || "",
      catalogName: node.dataset.catalogName || "",
      type: node.dataset.catalogType || "movie",
      initialItems: []
    });
  },

  onKeyDown(event) {
    const currentFocusedNode =
      this.getCurrentFocusedNode() || this.container?.querySelector(".focusable") || null;
    const code = Number(event?.keyCode || 0);
    if (this._homeHoldDialog) {
      return true;
    }
    if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
      event.preventDefault?.();
      return;
    }
    const isEnterHoldTarget = code === 13 && this.isHomeHoldTarget(currentFocusedNode);
    if (!isEnterHoldTarget) {
      this.cancelPendingContinueWatchingEnter();
      this.cancelPendingContinueWatchingHold();
    }
    if (this.continueWatchingMenu || this.posterHoldMenu) {
      return;
    }
    if (Platform.isBackEvent(event)) {
      event.preventDefault?.();
      this.consumeBackRequest();
      return;
    }
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === 40) {
        this.pillIconOnly = true;
        this.cancelModernSidebarPillAutoCollapse();
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === 38) {
        const wasIconOnly = Boolean(this.pillIconOnly);
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
        this.scheduleModernSidebarPillAutoCollapse({ restart: wasIconOnly });
      }
    }
    if (this.layoutMode === "modern" && [37, 38, 39, 40].includes(code)) {
      this.cancelFocusedPosterFlow();
    }
    if (this.handleHomeDpad(event)) {
      return;
    }
    const isHomeHoldTarget = this.isHomeHoldTarget(currentFocusedNode);
    if (code === 13 && isHomeHoldTarget) {
      event.preventDefault?.();
      if (!event?.repeat && !this.hasPendingContinueWatchingHold(currentFocusedNode)) {
        this.startPendingContinueWatchingHold(currentFocusedNode);
      }
      return;
    }
    if (code === 76) {
      this.persistCurrentFocusState();
      const currentIndex = HOME_LAYOUT_SEQUENCE.indexOf(this.layoutMode);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % HOME_LAYOUT_SEQUENCE.length : 0;
      this.layoutMode = HOME_LAYOUT_SEQUENCE[nextIndex];
      LayoutPreferences.set({ homeLayout: this.layoutMode });
      this.heroItem = this.pickInitialHero();
      this.render();
      return;
    }
    if (code !== 13) {
      return;
    }

    const current = this.getCurrentFocusedNode();
    if (!current) {
      return;
    }
    const action = current.dataset.action;
    if (String(current.dataset.navZone || "") === "sidebar") {
      activateLegacySidebarAction(action, "home");
      return;
    }
    if (action === "openDetail" || action === "openCollectionFolder")
      this.openDetailFromNode(current);
    if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
    if (action === "resumeProgress") {
      this.scheduleContinueWatchingEnter(current);
    }
  },

  onKeyUp(event) {
    if (this._homeHoldDialog) {
      return true;
    }
    const keyCode = Number(event?.keyCode || 0);
    const direction = getDirectionFromKeyCode(keyCode);
    if (direction && this.lastDirectionalKeyAtByDirection) {
      delete this.lastDirectionalKeyAtByDirection[direction];
    }
    if ((direction === "up" || direction === "down") && this.modernVerticalFastScrollState) {
      const releasedDirection = direction === "down" ? 1 : -1;
      if (this.modernVerticalFastScrollState.direction === releasedDirection) {
        this.endModernVerticalFastScroll({ land: true });
      }
    }
    if ((keyCode === 37 || keyCode === 39) && this.layoutMode === "modern") {
      const current = this.getCurrentFocusedNode();
      if (this.shouldUseImmediateHorizontalScrollForNode(current)) {
        this.scheduleModernHeroUpdate(current);
        this.scheduleFocusedPosterFlow(current);
      }
    }
    if (this.suppressHoldMenuEnterUntilKeyUp) {
      this.suppressHoldMenuEnterUntilKeyUp = false;
      if (keyCode === 13) {
        event?.preventDefault?.();
        return;
      }
    }
    if (keyCode !== 13) {
      return;
    }
    const current = this.getCurrentFocusedNode();
    if (this.completePendingContinueWatchingHold(current, event)) {
      event.preventDefault?.();
    }
  },

  consumeBackRequest() {
    if (this._homeHoldDialog) {
      this._homeHoldDialog.destroy();
      if (this.continueWatchingMenu) {
        this.dismissContinueWatchingMenu();
      } else if (this.posterHoldMenu || this.posterListPicker) {
        if (this.posterListPicker) {
          this.posterListPicker = null;
        }
        this.dismissPosterHoldMenu();
      } else {
        this._homeHoldDialog = null;
        this.unlockHomeHoldFocus();
      }
      return true;
    }
    if (this.continueWatchingMenu) {
      this.closeContinueWatchingMenu();
      return true;
    }
    if (this.posterHoldMenu) {
      this.closePosterHoldMenu();
      return true;
    }
    if (this.layoutMode === "modern") {
      this.cancelFocusedPosterFlow();
      this.collapseFocusedPoster();
    }
    const sidebarFocused = Boolean(
      this.container?.querySelector(".modern-sidebar-panel .focusable.focused") ||
      this.container?.querySelector(".home-sidebar .focusable.focused")
    );
    if (sidebarFocused || this.sidebarExpanded) {
      if (this.sidebarOpenedByBack) {
        this.sidebarOpenedByBack = false;
        Platform.exitApp();
        return true;
      }
      this.closeSidebarToContent();
      return true;
    }
    this.openSidebar({ openedByBack: true });
    return true;
  },

  // ---------------------------------------------------------------------------
  // Scroll-triggered pagination for modern layout catalog tracks
  // Matches ATV ModernHomeRows.kt: fires when lastVisible >= total - 4 AND hasMore
  // ---------------------------------------------------------------------------

  scheduleModernTrackPaginationForFocus(target) {
    if (this.layoutMode !== "modern" || !target?.matches?.(".home-poster-card.focusable")) {
      return;
    }
    const itemIndex = Number(target.dataset.navCol || -1);
    if (itemIndex < 0) {
      return;
    }
    const track = target.closest(".home-track");
    this._trackScrollHandlers?.get?.(track)?.requestAhead?.({
      focusedIndex: itemIndex,
      focusedNode: target
    });
  },

  setupModernTrackScrollPagination() {
    this.teardownModernTrackScrollPagination();
    if (this.layoutMode !== "modern" || !this.container) {
      return;
    }
    const tracks = Array.from(this.container.querySelectorAll(".home-modern-row .home-track"));
    if (!tracks.length) {
      return;
    }
    this._trackScrollHandlers = this._trackScrollHandlers || new Map();
    tracks.forEach((track) => {
      const rowKey = String(track.dataset.trackRowKey || "");
      if (!rowKey || this._trackScrollHandlers.has(track)) {
        return;
      }
      let duplicatePageRetryCount = 0;
      const scheduleLiveTrackCatchUp = (delayMs = 0) => {
        setTimeout(
          () => {
            if (Router.getCurrent() !== "home") {
              return;
            }
            const liveTrack =
              this.getNavigationRowSection(rowKey)?.querySelector?.(".home-track") || null;
            this._trackScrollHandlers?.get?.(liveTrack)?.requestAhead?.();
          },
          Math.max(0, Number(delayMs || 0))
        );
      };
      const runPagination = ({ assumeNearEnd = false } = {}) => {
        if (this._trackPaginationInFlight?.has(rowKey)) {
          return;
        }
        const cards = track.querySelectorAll(".home-content-card:not(.home-poster-card-loading)");
        const totalVisible = cards.length;
        if (!totalVisible) {
          return;
        }
        if (!assumeNearEnd) {
          // Estimate card width from first real card or fallback to CSS variable
          const firstCard = cards[0];
          const cardWidth = firstCard ? firstCard.offsetWidth : 212;
          const gapApprox = 24; // --home-poster-gap
          const nearEndThreshold = (cardWidth + gapApprox) * 4;
          const distanceFromEnd = track.scrollWidth - (track.scrollLeft + track.clientWidth);
          if (distanceFromEnd > nearEndThreshold) {
            return;
          }
        }
        // Find row data with hasMore
        const rowData = (this.rows || []).find((row) => buildModernRowKey(row) === rowKey);
        const rowResult = rowData?.result;
        if (!rowResult || rowResult.status !== "success") {
          return;
        }
        const rowPayload = rowResult.data;
        const currentItems = Array.isArray(rowPayload.items) ? rowPayload.items : [];
        const rowIndex = (this.rows || []).indexOf(rowData);
        const layoutPrefs = this.layoutPrefs || {};
        const showPosterLabels = Boolean(layoutPrefs.showPosterLabels !== false);
        const preferLandscape = Boolean(layoutPrefs.modernLandscapePostersEnabled);
        const chunkSize = Math.max(
          1,
          Number(this.getRowItemLimit?.() || HOME_MAX_ITEMS_PER_ROW_DEFAULT)
        );
        const appendItemsToTrack = (itemsToAppend = [], startIndex = 0) => {
          if (!itemsToAppend.length || !track.isConnected) {
            return false;
          }
          const newMarkup = itemsToAppend
            .map((item, i) =>
              createPosterCardMarkup(
                item,
                rowIndex,
                startIndex + i,
                rowData.type || "movie",
                rowData,
                showPosterLabels,
                "modern",
                false,
                preferLandscape,
                true,
                this.watchedTitleIds
              )
            )
            .join("");
          if (!newMarkup) {
            return false;
          }
          const frag = document.createRange().createContextualFragment(newMarkup);
          const appendedCards = Array.from(frag.querySelectorAll(".home-content-card.focusable"));
          const navigationRowIndex = (this.navModel?.rows || []).findIndex(
            (rowNodes) => rowNodes[0]?.closest?.(".home-track") === track
          );
          appendedCards.forEach((card, index) => {
            card.dataset.navZone = "main";
            card.dataset.navRow = String(Math.max(0, navigationRowIndex));
            card.dataset.navCol = String(startIndex + index);
            card.dataset.navRowKey = rowKey;
          });
          track.appendChild(frag);
          if (navigationRowIndex >= 0 && this.navModel?.rows?.[navigationRowIndex]) {
            this.navModel.rows[navigationRowIndex].push(...appendedCards);
            this.navModel.rowNodesByRowKey?.set?.(rowKey, this.navModel.rows[navigationRowIndex]);
          } else {
            this.invalidateNavigationModel();
            this.buildNavigationModel();
          }
          this.scheduleHomeLazyImageHydration(this.getCurrentFocusedNode());
          return true;
        };
        if (totalVisible < currentItems.length) {
          this._trackPaginationInFlight = this._trackPaginationInFlight || new Set();
          this._trackPaginationInFlight.add(rowKey);
          appendItemsToTrack(
            currentItems.slice(totalVisible, totalVisible + chunkSize),
            totalVisible
          );
          this._trackPaginationInFlight.delete(rowKey);
          return;
        }
        if (!rowPayload?.hasMore) {
          return;
        }
        const storedNextSkip = Number(rowPayload.nextSkip);
        const skip =
          Number.isFinite(storedNextSkip) && storedNextSkip > currentItems.length
            ? Math.trunc(storedNextSkip)
            : currentItems.length;
        this._trackPaginationInFlight = this._trackPaginationInFlight || new Set();
        this._trackPaginationInFlight.add(rowKey);
        const token = this.homeLoadToken;
        let shouldRequestAnotherPage = false;
        catalogRepository
          .getCatalog({
            addonBaseUrl: rowData.addonBaseUrl || "",
            addonId: rowData.addonId || "",
            addonName: rowData.addonName || "",
            catalogId: rowData.catalogId || "",
            catalogName: rowData.catalogName || "",
            type: rowData.type || "movie",
            skip,
            supportsSkip: true
          })
          .then((result) => {
            if (token !== this.homeLoadToken || result?.status !== "success") {
              return;
            }
            const liveRowData =
              (this.rows || []).find((candidate) => buildModernRowKey(candidate) === rowKey) ||
              rowData;
            const liveRowPayload = liveRowData?.result?.data || rowPayload;
            const latestItems = Array.isArray(liveRowPayload?.items)
              ? liveRowPayload.items
              : currentItems;
            const incomingItems = Array.isArray(result.data?.items) ? result.data.items : [];
            const seenIds = new Set(
              latestItems.map((item) => String(item?.id || "").trim()).filter(Boolean)
            );
            const newItems = incomingItems.filter((item) => {
              const itemId = String(item?.id || "").trim();
              if (!itemId) {
                return true;
              }
              if (seenIds.has(itemId)) {
                return false;
              }
              seenIds.add(itemId);
              return true;
            });
            if (!incomingItems.length) {
              // Mark hasMore=false so we stop trying
              if (liveRowPayload) {
                liveRowPayload.hasMore = false;
              }
              duplicatePageRetryCount = 0;
              return;
            }
            const nextSkip = skip + incomingItems.length;
            const startIndex = latestItems.length;
            // Update in-memory row data
            if (liveRowPayload) {
              liveRowPayload.items = [...latestItems, ...newItems];
              liveRowPayload.hasMore = result.data?.hasMore ?? newItems.length > 0;
              liveRowPayload.currentPage = result.data?.currentPage ?? liveRowPayload.currentPage;
              liveRowPayload.nextSkip = nextSkip;
            }
            const didAppend = appendItemsToTrack(newItems.slice(0, chunkSize), startIndex);
            if (didAppend) {
              duplicatePageRetryCount = 0;
            } else if (liveRowPayload?.hasMore) {
              duplicatePageRetryCount += 1;
              shouldRequestAnotherPage = duplicatePageRetryCount <= 2;
            }
            return didAppend;
          })
          .catch((err) => {
            console.warn("Home track pagination failed for", rowKey, err);
          })
          .finally(() => {
            if (token === this.homeLoadToken) {
              this._trackPaginationInFlight?.delete(rowKey);
              if (!track.isConnected) {
                scheduleLiveTrackCatchUp();
              } else if (shouldRequestAnotherPage) {
                scheduleLiveTrackCatchUp(MODERN_HOME_CONSTANTS.trackPaginationPrefetchDelayMs);
              }
            }
          });
      };
      let scrollTimer = 0;
      let prefetchTimer = 0;
      let pendingPrefetchContext = null;
      let measuredTrackWidth = 0;
      let visibleCardCount = 1;
      const runWhenIdle = () => {
        scrollTimer = 0;
        if (!track.isConnected || Router.getCurrent() !== "home") {
          return;
        }
        if (
          this.modernVerticalFastScrollState ||
          this.isScrollAnimationActive(track, "x") ||
          this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y")
        ) {
          scrollTimer = setTimeout(runWhenIdle, 32);
          return;
        }
        runPagination();
      };
      const handler = () => {
        if (scrollTimer) {
          clearTimeout(scrollTimer);
        }
        scrollTimer = setTimeout(runWhenIdle, MODERN_HOME_CONSTANTS.trackPaginationIdleMs);
      };
      handler.requestAhead = (context = null) => {
        if (context?.focusedNode?.isConnected && Number(context?.focusedIndex) >= 0) {
          pendingPrefetchContext = context;
        }
        if (prefetchTimer) {
          return;
        }
        prefetchTimer = setTimeout(() => {
          prefetchTimer = 0;
          if (!track.isConnected || Router.getCurrent() !== "home") {
            pendingPrefetchContext = null;
            return;
          }
          const requestContext = pendingPrefetchContext;
          pendingPrefetchContext = null;
          if (requestContext?.focusedNode?.isConnected) {
            const cards = track.querySelectorAll(
              ".home-content-card:not(.home-poster-card-loading)"
            );
            const mountedCount = cards.length;
            const trackWidth = Number(track.clientWidth || 0);
            if (trackWidth !== measuredTrackWidth) {
              const cardWidth = Number(requestContext.focusedNode.offsetWidth || 0);
              const styles = globalThis.getComputedStyle?.(track);
              const gap = Number.parseFloat(styles?.columnGap || styles?.gap || "0") || 0;
              const stride = Math.max(1, cardWidth + gap);
              visibleCardCount = Math.max(1, Math.ceil(trackWidth / stride));
              measuredTrackWidth = trackWidth;
            }
            const projectedLastVisible = Number(requestContext.focusedIndex) + visibleCardCount - 1;
            const loadAheadStart = Math.max(
              0,
              mountedCount - MODERN_HOME_CONSTANTS.trackPaginationLoadAheadItems
            );
            if (projectedLastVisible < loadAheadStart) {
              return;
            }
          }
          runPagination({ assumeNearEnd: true });
        }, MODERN_HOME_CONSTANTS.trackPaginationPrefetchDelayMs);
      };
      handler.cancelPending = () => {
        if (scrollTimer) {
          clearTimeout(scrollTimer);
          scrollTimer = 0;
        }
        if (prefetchTimer) {
          clearTimeout(prefetchTimer);
          prefetchTimer = 0;
        }
        pendingPrefetchContext = null;
      };
      this._trackScrollHandlers.set(track, handler);
      track.addEventListener("scroll", handler, { passive: true });
    });
  },

  teardownModernTrackScrollPagination() {
    if (!this._trackScrollHandlers) {
      return;
    }
    this._trackScrollHandlers.forEach((handler, track) => {
      track.removeEventListener("scroll", handler);
      handler.cancelPending?.();
    });
    this._trackScrollHandlers.clear();
  },

  cleanup() {
    this.cancelModernSidebarPillAutoCollapse();
    this.cancelPendingContinueWatchingEnter();
    this.cancelPendingContinueWatchingHold();
    this.suppressHoldMenuEnterUntilKeyUp = false;
    this.destroyHomeHoldDialog();
    this.unlockHomeHoldFocus();
    this.continueWatchingMenu = null;
    this.posterHoldMenu = null;
    this.posterListPicker = null;
    this.persistCurrentFocusState();
    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this._trackPaginationInFlight?.clear();
    this.cancelScheduledRender();
    this.cancelModernCameraFollow({ stopAnimations: true });
    this.endModernVerticalFastScroll({ land: false });
    this.stopHeroRotation();
    this.cancelPendingHeroFocus();
    this.cancelFocusedPosterFlow();
    this.clearFocusedPosterFlowState();
    this.collapseFocusedPoster();
    this.teardownGridStickyHeader();
    this.teardownModernTrackScrollPagination();
    if (this.homeViewportFocusSyncTimer) {
      clearTimeout(this.homeViewportFocusSyncTimer);
      this.homeViewportFocusSyncTimer = null;
    }
    if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
      this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler);
    }
    this.boundHomeViewport = null;
    if (this.homeTruncationFrame) {
      cancelAnimationFrame(this.homeTruncationFrame);
      this.homeTruncationFrame = null;
    }
    if (this.homeLazyImageHydrationRaf) {
      cancelAnimationFrame(this.homeLazyImageHydrationRaf);
      this.homeLazyImageHydrationRaf = 0;
    }
    this.pendingHomeLazyImageAnchor = null;
    this.lastDirectionalKeyAtByDirection = {};
    this.homeTruncationScope = null;
    if (this.boundHomeEventContainer) {
      this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
      this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
      this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
      this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
      this.boundHomeEventContainer = null;
    }
    this.cachedModernPortraitPosterMetrics = null;
    this.cachedModernLandscapePosterMetrics = null;
    const preserveRenderedTizenHome = Boolean(
      Platform.isTizen() &&
      this.hasLoadedOnce &&
      Array.isArray(this.rows) &&
      this.rows.length &&
      this.container?.childNodes?.length
    );
    if (preserveRenderedTizenHome) {
      // Keep layout alive while another screen is shown. Re-displaying a large
      // Tizen catalog after display:none can itself force an expensive full
      // layout before the first Home frame is painted.
      this.container.style.position = "absolute";
      this.container.style.top = "0";
      this.container.style.right = "0";
      this.container.style.bottom = "0";
      this.container.style.left = "0";
      this.container.style.visibility = "hidden";
      this.container.style.pointerEvents = "none";
      this.container.classList.add("home-dom-preserved");
      this.homeDomPreserved = true;
    } else {
      this.homeDomPreserved = false;
      this.container.classList.remove("home-dom-preserved");
      this.container.style.removeProperty("position");
      this.container.style.removeProperty("top");
      this.container.style.removeProperty("right");
      this.container.style.removeProperty("bottom");
      this.container.style.removeProperty("left");
      this.container.style.removeProperty("visibility");
      this.container.style.removeProperty("pointer-events");
      ScreenUtils.hide(this.container);
    }
  }
};
