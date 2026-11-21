import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";
import {
  isKnownUnrescalableHomeArtwork,
  releaseHomeArtwork,
  rescaleHomeArtwork,
  shouldQueueRescale,
  shouldRescaleHomeArtwork
} from "../../images/tvPosterRescaler.js";
import { getTvArtworkPixelRatio } from "../../../platform/tvRuntimePerformance.js";
import * as internals from "./homeScreenContext.js";

// The focused overlay is hydrated from several paths (focus change, poster
// flow, route restore), and each one would start its own request. One entry per
// <img> keeps the rescaled url's reference count matched to the single element
// painting it.
const focusGifRequests = new WeakMap();

export function createHomeScreenMethods11() {
  const {
    Router,
    TmdbSettingsStore,
    metaRepository,
    mdbListRepository,
    shouldPreserveHomeRuntimeText,
    firstNonEmpty,
    resolveImdbRating,
    preloadHeroBackdrop,
    preloadHeroLogo,
    parseRuntimeMinutes,
    normalizeCollectionFolderItem,
    withTimeout,
    fetchModernHeroTmdbEnrichment,
    buildHeroIdentity,
    buildModernHeroPresentation
  } = internals;

  return {
    async enrichCurrentHeroAsync(hero, focusToken = Number(this.heroFocusToken || 0), options = {}) {
      if (!hero || !hero.id || hero.heroSource === "continueWatching" || hero.heroSource === "collection") {
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
      let settledMdbImdbRating = null;
      let mdbImdbRatingSettled = false;
      let heroCommitStarted = false;
      const commitHero = async (resolvedHero, { merge = false, skipPreload = false } = {}) => {
        if (deferCommit && !skipPreload) {
          const display = buildModernHeroPresentation(resolvedHero);
          await Promise.all([preloadHeroBackdrop(display?.backdrop), preloadHeroLogo(display?.logo)]);
        }
        if (!canCommitHero()) {
          return false;
        }
        // A rating that settled while the media preload was running is newer
        // than the hero assembled by the caller.
        if (mdbImdbRatingSettled && settledMdbImdbRating != null) {
          resolvedHero = { ...resolvedHero, imdbRating: settledMdbImdbRating };
          merge = true;
        }
        this.heroItem = resolvedHero;
        const matchedIndex = (this.heroCandidates || []).findIndex((item) => String(item?.id || "") === itemId);
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
        MdbListSettingsStore.get().showOnHero
          ? mdbListRepository.getRatingsForMeta(hero, itemId, itemType).then((result) => result?.ratings?.imdb ?? null)
          : mdbListRepository.getImdbRatingForItem(itemId, itemType),
        3500,
        null
      ).catch(() => null);
      // A slow rating request must not hold the artwork/meta commit: the hero
      // paints as soon as TMDB/addon metadata resolves, and the rating is
      // patched in afterwards without re-preloading media already on screen.
      void mdbImdbRatingPromise
        .then((rating) => {
          settledMdbImdbRating = rating == null ? null : Number(rating);
          mdbImdbRatingSettled = true;
          if (settledMdbImdbRating == null || !heroCommitStarted || !canCommitHero()) {
            return null;
          }
          const currentHero = this.heroItem;
          if (String(currentHero?.id || "") !== itemId || Number(currentHero.imdbRating) === settledMdbImdbRating) {
            return null;
          }
          return commitHero({ ...currentHero, imdbRating: settledMdbImdbRating }, { merge: true, skipPreload: true });
        })
        .catch(() => {});
      let metadataPromise = null;
      let latestMetadataResult = null;
      let latestTmdbEnrichment = null;
      const commitFallbackHero = async () => {
        if (!canCommitHero()) {
          return false;
        }
        heroCommitStarted = true;
        const mdbImdbRating = mdbImdbRatingSettled ? settledMdbImdbRating : null;
        const fallbackHero = {
          ...(deferCommit ? hero : this.heroItem),
          heroMetaEnriched: false,
          heroMetaEnriching: false,
          ...(mdbImdbRating != null ? { imdbRating: Number(mdbImdbRating) } : {})
        };
        await commitHero(fallbackHero, { merge: mdbImdbRating != null });
        return true;
      };
      const commitMetadataResult = async (result, { late = false, tmdbEnrichment = null } = {}) => {
        const meta = result?.status === "success" && result.data ? result.data : null;
        if ((!meta && !tmdbEnrichment) || !canCommitHero()) {
          return false;
        }
        heroCommitStarted = true;
        const enrichedImdb = meta ? resolveImdbRating(meta) : null;
        const mdbImdbRating = mdbImdbRatingSettled ? settledMdbImdbRating : null;
        const settings = TmdbSettingsStore.get();
        const sourceHero =
          (late || tmdbEnrichment) && String(this.heroItem?.id || "") === itemId ? this.heroItem : deferCommit ? hero : this.heroItem;
        const enrichedRuntime = parseRuntimeMinutes(meta?.runtimeMinutes ?? meta?.runtime);
        const runtimePatch = {
          ...(enrichedRuntime > 0 ? { runtimeMinutes: enrichedRuntime } : {}),
          ...(shouldPreserveHomeRuntimeText(meta?.runtime) ? { runtime: meta.runtime } : {})
        };
        const tmdbRuntime = parseRuntimeMinutes(tmdbEnrichment?.runtimeMinutes ?? tmdbEnrichment?.runtime);
        const tmdbPatch = tmdbEnrichment
          ? {
              ...(settings.useBasicInfo && tmdbEnrichment.localizedTitle ? { name: tmdbEnrichment.localizedTitle } : {}),
              ...(settings.useBasicInfo && tmdbEnrichment.description ? { description: tmdbEnrichment.description } : {}),
              ...(settings.useBasicInfo && Array.isArray(tmdbEnrichment.genres) && tmdbEnrichment.genres.length
                ? { genres: tmdbEnrichment.genres }
                : {}),
              ...(settings.useArtwork && tmdbEnrichment.backdrop ? { background: tmdbEnrichment.backdrop } : {}),
              ...(settings.useArtwork && tmdbEnrichment.logo ? { logo: tmdbEnrichment.logo } : {}),
              ...(settings.useDetails && tmdbRuntime > 0 ? { runtimeMinutes: tmdbRuntime } : {}),
              ...(settings.useDetails && tmdbEnrichment.ageRating ? { ageRating: tmdbEnrichment.ageRating } : {}),
              ...(settings.useDetails && tmdbEnrichment.status ? { status: tmdbEnrichment.status } : {})
            }
          : {};
        const mergedHero = {
          ...sourceHero,
          heroMetaEnriched: Boolean(meta || tmdbEnrichment),
          heroMetaEnriching: false,
          ...(mdbImdbRating != null ? { imdbRating: Number(mdbImdbRating) } : enrichedImdb != null ? { imdbRating: enrichedImdb } : {}),
          ...(meta ? runtimePatch : {}),
          ...(meta?.released ? { released: meta.released } : {}),
          ...(meta?.releaseInfo ? { releaseInfo: meta.releaseInfo } : {}),
          ...(Array.isArray(meta?.genres) && meta.genres.length ? { genres: meta.genres } : {}),
          ...(meta?.description ? { description: meta.description } : {}),
          ...(meta?.logo ? { logo: meta.logo } : {}),
          ...(meta?.background ? { background: meta.background } : {}),
          ...tmdbPatch
        };
        return commitHero(mergedHero, { merge: true });
      };
      const tmdbPromise = fetchModernHeroTmdbEnrichment(hero, itemType).catch(() => null);
      void tmdbPromise
        .then((enrichment) => {
          latestTmdbEnrichment = enrichment;
          if (enrichment) {
            return commitMetadataResult(latestMetadataResult, {
              late: true,
              tmdbEnrichment: enrichment
            });
          }
          return null;
        })
        .catch(() => {});
      try {
        // Promise.race does not cancel the repository request. Keep it available
        // so a slow but successful metadata response can still update this hero.
        metadataPromise = metaRepository.getMetaFromAllAddons(itemType, itemId);
        const result = await Promise.race([
          metadataPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("hero-enrich-timeout")), 4000))
        ]);
        if (!canCommitHero()) {
          return;
        }
        latestMetadataResult = result;
        if (result?.status !== "success" || !result.data) {
          await commitFallbackHero();
          return;
        }
        await commitMetadataResult(result, { tmdbEnrichment: latestTmdbEnrichment });
      } catch (error) {
        await commitFallbackHero();
        if (error?.message === "hero-enrich-timeout" && metadataPromise) {
          void metadataPromise
            .then((result) => {
              latestMetadataResult = result;
              return commitMetadataResult(result, {
                late: true,
                tmdbEnrichment: latestTmdbEnrichment
              });
            })
            .catch(() => {});
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
        const nextItems = items.map((item) => (String(item?.id || "") === itemId ? { ...item, ...mergedHero } : item));
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
      const encodedMatch = itemType === "collection_folder" ? itemId.match(/^collection:([^:]+):(.+)$/i) : null;
      if (encodedMatch?.[1] && encodedMatch?.[2]) {
        return {
          collectionId: encodedMatch[1],
          folderId: encodedMatch[2]
        };
      }

      const rowIndex = Number(node.dataset.rowIndex || -1);
      const itemIndex = Number(node.dataset.itemIndex || -1);
      if (!Number.isFinite(rowIndex) || rowIndex < 0 || !Number.isFinite(itemIndex) || itemIndex < 0) {
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
      if (active && this?.activeCollectionFocusGifNode && this.activeCollectionFocusGifNode !== node) {
        this.hydrateCollectionFocusGif?.(this.activeCollectionFocusGifNode, false);
      }
      const gifNode = node?.querySelector?.(".home-poster-focus-gif") || null;
      if (!(gifNode instanceof HTMLImageElement)) {
        if (!active && this && this.activeCollectionFocusGifNode === node) {
          this.activeCollectionFocusGifNode = null;
        }
        return;
      }
      if (active) {
        if (this) {
          this.activeCollectionFocusGifNode = node;
        }
        const src = String(gifNode.dataset.src || gifNode.getAttribute("src") || "").trim();
        if (!src) {
          return;
        }
        if (gifNode.getAttribute("src")) {
          node.classList.add("is-focus-gif-active");
          return;
        }
        const pending = focusGifRequests.get(gifNode);
        if (pending?.src === src) {
          return;
        }
        // Android fades the overlay in once the bounded decode succeeds
        // (`gifAlpha` on Coil `onSuccess`), so the class that starts the CSS
        // fade goes on with the source that finally paints it.
        const paint = (value) => {
          gifNode.setAttribute("src", value);
          node.classList.add("is-focus-gif-active");
        };
        // Android bounds every focus overlay decode to the card pixels
        // (Coil `.size(requestWidthPx, requestHeightPx)`). An <img> always
        // decodes at natural size, so a static high-resolution overlay costs
        // the full bitmap even when the card paints a few hundred pixels.
        // Animated assets are refused by the rescaler and paint immediately.
        if (
          shouldRescaleHomeArtwork() &&
          shouldQueueRescale(src, { width: 1, height: 1, fit: "fill" }) &&
          !isKnownUnrescalableHomeArtwork(src)
        ) {
          // `.home-collection-card .home-poster-focus-gif` is object-fit: fill
          // in every layout, so the card box is exactly what Android decodes.
          const rect = gifNode.getBoundingClientRect();
          const ratio = getTvArtworkPixelRatio();
          const width = Math.round(rect.width * ratio);
          const height = Math.round(rect.height * ratio);
          if (width > 0 && height > 0) {
            const request = { src };
            const isStale = () => !gifNode.isConnected || gifNode.dataset.src !== src || !node.classList.contains("focused");
            focusGifRequests.set(gifNode, request);
            rescaleHomeArtwork(src, { width, height, fit: "fill", priority: 0, isStale }).then((objectUrl) => {
              if (focusGifRequests.get(gifNode) === request) {
                focusGifRequests.delete(gifNode);
              }
              // The card blurred while the worker ran: hand the url back
              // instead of decoding it into an overlay nobody sees.
              if (!objectUrl) {
                if (!isStale()) {
                  paint(src);
                }
                return;
              }
              if (isStale()) {
                releaseHomeArtwork(objectUrl);
                return;
              }
              paint(objectUrl);
            });
            return;
          }
        }
        paint(src);
        return;
      }
      node.classList.remove("is-focus-gif-active");
      if (this && this.activeCollectionFocusGifNode === node) {
        this.activeCollectionFocusGifNode = null;
      }
      // Match Android's focused-only GIF lifecycle: hiding the overlay is not
      // enough on TV browsers because an <img> with src keeps decoding/animating.
      // Preserve data-src so the asset can be loaded again on the next focus.
      const painted = String(gifNode.getAttribute("src") || "");
      gifNode.removeAttribute("src");
      // A rescaled overlay paints a pooled blob url; keep its reference counted
      // so the pool can reclaim the slot. Original urls are a no-op.
      releaseHomeArtwork(painted);
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
    }
  };
}
