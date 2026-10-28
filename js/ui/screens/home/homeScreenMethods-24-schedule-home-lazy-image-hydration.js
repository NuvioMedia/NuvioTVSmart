import * as internals from "./homeScreenContext.js";
import {
  rescaleHomeArtwork,
  releaseHomeArtwork,
  shouldRescaleHomeArtwork,
  getHomeArtworkPixelRatio,
  getHomeArtworkObjectFit,
  isRescalableArtworkFit
} from "../../images/tvPosterRescaler.js";

export function createHomeScreenMethods24() {
  const imageRequests = new WeakMap();
  const {
    MODERN_HOME_CONSTANTS,
    CW_DAYS_CAP,
    HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR,
    HOME_LAZY_IMAGE_ROW_SELECTOR,
    HOME_LAZY_IMAGE_EVICT_MARGIN_PX,
    HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS,
    HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME,
    Router,
    getTvRuntimePerformanceProfile,
    isSeriesTypeForContinueWatching,
    isCompletedForContinueWatching,
    episodeKey,
    episodeSortKey,
    buildNextUpSeedFromWatchedItem
  } = internals;

  return {
    shouldUseBoundedHomeImageHydration() {
      // Keep image prefetch bounded on TV independently of the animated scroll policy.
      return Boolean(this.isPerformanceConstrained() || getTvRuntimePerformanceProfile().isTvRuntime);
    },
    scheduleHomeLazyImageHydration(
      anchorNode = null,
      {
        refreshIndex = false,
        deferUntilVerticalSettle = false,
        focusedRowOnly = false,
        includeNeighborRows = false,
        viewportChanged = false
      } = {}
    ) {
      const anchorRow = anchorNode instanceof HTMLElement ? anchorNode.closest(HOME_LAZY_IMAGE_ROW_SELECTOR) : null;
      const anchorImagePending = Boolean(
        anchorNode?.querySelector?.(".content-poster[data-src], .home-poster-landscape-logo[data-src], .home-continue-bg[data-src]")
      );
      const legacyFocusedRowPass = Boolean(this.isLegacyTvRuntime() && focusedRowOnly && anchorRow instanceof HTMLElement);
      if (legacyFocusedRowPass) {
        if (this.homeLazyImageNeighborTimer) {
          clearTimeout(this.homeLazyImageNeighborTimer);
        }
        this.homeLazyImageNeighborTimer = setTimeout(() => {
          this.homeLazyImageNeighborTimer = null;
          this.scheduleHomeLazyImageHydration(this.getCurrentFocusedNode(), {
            includeNeighborRows: true
          });
        }, HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS);
      }
      if (
        anchorRow instanceof HTMLElement &&
        anchorRow === this.lastHomeLazyImageHydrationAnchorRow &&
        !refreshIndex &&
        !this.homeLazyImageHydrationNeedsFullScan &&
        !this.homeLazyImageHydrationNeedsIndexRefresh &&
        !this.homeLazyImageHydrationRaf &&
        !includeNeighborRows &&
        !viewportChanged &&
        !(this.shouldUseBoundedHomeImageHydration() && anchorImagePending)
      ) {
        // Avoid scheduling another animation-frame callback until the DOM,
        // viewport, or focused image changes. Smart-TV bounded hydration may
        // leave a later horizontal target pending, so that target is allowed to
        // request a second pass.
        return;
      }
      if (anchorNode instanceof HTMLElement) {
        this.pendingHomeLazyImageAnchor = anchorNode;
      } else {
        this.homeLazyImageHydrationNeedsFullScan = true;
      }
      this.pendingHomeLazyImageFocusedRowOnly = legacyFocusedRowPass;
      this.pendingHomeLazyImageIncludeNeighborRows = Boolean(includeNeighborRows || (this.isLegacyTvRuntime() && !legacyFocusedRowPass));
      if (refreshIndex) {
        this.homeLazyImageHydrationNeedsIndexRefresh = true;
      }
      if (!legacyFocusedRowPass && (includeNeighborRows || !(anchorRow instanceof HTMLElement))) {
        if (this.homeLazyImageNeighborTimer) {
          clearTimeout(this.homeLazyImageNeighborTimer);
          this.homeLazyImageNeighborTimer = null;
        }
      }
      if (deferUntilVerticalSettle && !legacyFocusedRowPass && this.shouldUseImmediateFocusScroll() && this.layoutMode === "modern") {
        if (this.homeLazyImageHydrationSettleTimer) {
          clearTimeout(this.homeLazyImageHydrationSettleTimer);
        }
        const target = anchorNode instanceof HTMLElement ? anchorNode : null;
        const hydrationDelayMs = this.shouldUseImmediateFocusScroll()
          ? MODERN_HOME_CONSTANTS.smartTvLazyHydrationDebounceMs
          : MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs;
        const retryAfterVerticalSettle = () => {
          this.homeLazyImageHydrationSettleTimer = null;
          if (this.isModernVerticalScrollActive()) {
            this.homeLazyImageHydrationSettleTimer = setTimeout(retryAfterVerticalSettle, MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs);
            return;
          }
          this.scheduleHomeLazyImageHydration(target, { refreshIndex });
        };
        this.homeLazyImageHydrationSettleTimer = setTimeout(retryAfterVerticalSettle, hydrationDelayMs);
        return;
      }
      if (this.homeLazyImageHydrationSettleTimer) {
        clearTimeout(this.homeLazyImageHydrationSettleTimer);
        this.homeLazyImageHydrationSettleTimer = null;
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
        const forceFullScan = Boolean(this.homeLazyImageHydrationNeedsFullScan);
        this.homeLazyImageHydrationNeedsFullScan = false;
        const shouldRefreshIndex = Boolean(this.homeLazyImageHydrationNeedsIndexRefresh);
        this.homeLazyImageHydrationNeedsIndexRefresh = false;
        const onlyFocusedRow = Boolean(this.pendingHomeLazyImageFocusedRowOnly);
        this.pendingHomeLazyImageFocusedRowOnly = false;
        const includeNeighbors = Boolean(this.pendingHomeLazyImageIncludeNeighborRows);
        this.pendingHomeLazyImageIncludeNeighborRows = false;
        this.hydrateHomeLazyImages(anchor, {
          forceFullScan,
          refreshIndex: shouldRefreshIndex,
          focusedRowOnly: onlyFocusedRow,
          includeNeighborRows: includeNeighbors
        });
      });
    },
    buildHomeLazyImageHydrationIndex() {
      if (!this.container) {
        this.homeLazyImageHydrationIndex = null;
        return [];
      }
      const imagesByRow = new Map();
      // Index by lifecycle, not by pending state. An image that has already
      // loaded is exactly the one eviction needs to find, so selecting only
      // [data-src] here would drop every poster the moment it painted.
      Array.from(this.container.querySelectorAll(HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR)).forEach((image) => {
        const row = image.closest(HOME_LAZY_IMAGE_ROW_SELECTOR);
        const rowImages = imagesByRow.get(row) || [];
        rowImages.push(image);
        imagesByRow.set(row, rowImages);
      });
      const index = Array.from(imagesByRow, ([row, images]) => ({ row, images }));
      this.homeLazyImageHydrationIndex = index;
      return index;
    },
    hydrateHomeLazyImages(
      anchorNode = null,
      { forceFullScan = false, refreshIndex = false, focusedRowOnly = false, includeNeighborRows = false } = {}
    ) {
      if (!this.container) {
        return;
      }
      const anchorRow = anchorNode?.closest?.(HOME_LAZY_IMAGE_ROW_SELECTOR) || null;
      const useBoundedTvHydration = this.shouldUseBoundedHomeImageHydration();
      const sameAnchorRow = anchorRow instanceof HTMLElement && anchorRow === this.lastHomeLazyImageHydrationAnchorRow;
      if (!forceFullScan && !refreshIndex && sameAnchorRow && !useBoundedTvHydration) {
        // The first pass for a focused row hydrates every image in that row. On
        // subsequent horizontal moves, the viewport geometry for every other row
        // is unchanged, so rescanning and measuring all distant lazy images only
        // repeats work on the D-pad hot path.
        return;
      }
      this.lastHomeLazyImageHydrationAnchorRow = anchorRow;
      const imageRows =
        refreshIndex || !Array.isArray(this.homeLazyImageHydrationIndex)
          ? this.buildHomeLazyImageHydrationIndex()
          : this.homeLazyImageHydrationIndex;
      if (!imageRows.length) {
        return;
      }
      const viewport =
        this.container.querySelector(".home-modern-rows-viewport") || this.container.querySelector(".home-main") || this.container;
      const viewportRect = viewport.getBoundingClientRect();
      const screenHeight = Number(globalThis.innerHeight || globalThis.document?.documentElement?.clientHeight || 0);
      const screenWidth = Number(globalThis.innerWidth || globalThis.document?.documentElement?.clientWidth || 0);
      const visibleRect =
        useBoundedTvHydration && screenHeight > 0 && screenWidth > 0
          ? {
              top: Math.max(0, viewportRect.top),
              bottom: Math.min(screenHeight, viewportRect.bottom),
              left: Math.max(0, viewportRect.left),
              right: Math.min(screenWidth, viewportRect.right)
            }
          : viewportRect;
      const constrained = this.isPerformanceConstrained();
      // Android prefetches the visible window plus a small row/card neighborhood.
      // Keep the browser's DOM-mounted rows from turning every vertical focus
      // move into a burst of eager image requests.
      const verticalMargin = useBoundedTvHydration ? 480 : constrained ? 720 : 1200;
      const horizontalMargin = useBoundedTvHydration ? 320 : constrained ? 520 : 1000;
      const focusedRow = Boolean(anchorRow && anchorRow === anchorNode?.closest?.(HOME_LAZY_IMAGE_ROW_SELECTOR));
      const focusedRowMargin = focusedRow ? Math.max(96, Math.round(Number(anchorNode?.offsetWidth || 0) * 0.65)) : horizontalMargin;
      const pendingLoads = [];
      imageRows.forEach((entry) => {
        const { row } = entry;
        if (row instanceof HTMLElement && !row.isConnected) {
          return;
        }
        const isFocusedRow = Boolean(anchorRow && row === anchorRow);
        if (focusedRowOnly && anchorRow && !isFocusedRow) {
          return;
        }
        if (sameAnchorRow && useBoundedTvHydration && !forceFullScan && !refreshIndex && !includeNeighborRows && !isFocusedRow) {
          return;
        }
        // Keep every image the row still owns so eviction can hand its artwork
        // back later. Only detached nodes leave the index; a loaded poster is
        // the whole point of the sweep.
        entry.images = entry.images.filter((image) => image.isConnected);
        const images = entry.images.filter((image) => image.dataset.src);
        if (!images.length) return;
        // Android's LazyRow loads the visible cards plus a small prefetch
        // neighborhood, not every item in the focused row. Keep the same
        // bounded behavior on Smart-TV runtimes; older/browser fallback paths
        // retain the full focused-row hydration for compatibility.
        const shouldHydrateFocusedRowImmediately = isFocusedRow && !useBoundedTvHydration;
        if (!shouldHydrateFocusedRowImmediately && row instanceof HTMLElement) {
          const rowRect = row.getBoundingClientRect();
          const isRowNearViewport =
            rowRect.bottom >= visibleRect.top - verticalMargin && rowRect.top <= visibleRect.bottom + verticalMargin;
          if (!isRowNearViewport) {
            return;
          }
        }
        images.forEach((image) => {
          if (!(image instanceof HTMLImageElement) || !image.isConnected) {
            return;
          }
          const src = String(image.dataset.src || "").trim();
          if (!src) {
            image.removeAttribute("data-src");
            return;
          }
          if (!shouldHydrateFocusedRowImmediately) {
            const imageHorizontalMargin = isFocusedRow ? focusedRowMargin : horizontalMargin;
            const rect = image.getBoundingClientRect();
            const isNearViewport =
              rect.bottom >= visibleRect.top - verticalMargin &&
              rect.top <= visibleRect.bottom + verticalMargin &&
              rect.right >= visibleRect.left - imageHorizontalMargin &&
              rect.left <= visibleRect.right + imageHorizontalMargin;
            if (!isNearViewport) {
              return;
            }
          }
          // The app already decides when an image is close enough to load. Leaving
          // loading="lazy" here delegates that decision back to old TV browsers,
          // which can miscalculate visibility inside the nested modern-home viewport.
          const isFocusedImage = Boolean(
            anchorNode && (anchorNode === image || anchorNode.contains?.(image) || image.closest(".focusable") === anchorNode)
          );
          pendingLoads.push({
            image,
            src,
            row,
            isFocusedRow,
            isFocusedImage,
            priority: isFocusedImage ? 0 : isFocusedRow ? 1 : 2
          });
        });
      });
      // Complete geometry reads before changing image layout/loading state.
      if (this.isLegacyTvRuntime()) {
        this.commitHomeLazyImageSources(pendingLoads, anchorNode, anchorRow);
      } else {
        pendingLoads.forEach(({ image, src, priority }) => {
          this.assignHomeLazyImageSource(image, src, priority);
        });
      }
      // Sweep on every pass. Rows drift out of reach as later catalogs mount,
      // not only when focus moves, so a row-change gate left artwork behind.
      // The sweep measures rows rather than images, which keeps it cheap enough
      // for the D-pad hot path.
      if (getTvRuntimePerformanceProfile().isTvRuntime && Router.getCurrent() === "home") {
        this.evictDistantHomeLazyImages(anchorNode);
      }
    },
    assignHomeLazyImageSource(image, src, priority = 2) {
      // The app already decided this image is close enough to load, so stop
      // deferring to the browser's own lazy heuristic.
      image.loading = "eager";
      image.removeAttribute("data-src");
      // Only posters are worth rescaling. Logos carry transparency a JPEG
      // would flatten, and they are small enough not to matter.
      if (!shouldRescaleHomeArtwork() || !image.classList.contains("content-poster")) {
        image.src = src;
        return;
      }
      const rect = image.getBoundingClientRect();
      // Home poster rules are not uniform: a catalog card crops its artwork
      // while a collection card stretches it. Redrawing a stretched poster as
      // a crop would silently change the picture, so ask the stylesheet what
      // this element actually resolved to and skip anything else.
      const fit = getHomeArtworkObjectFit(image);
      if (!isRescalableArtworkFit(fit)) {
        image.src = src;
        return;
      }
      // webOS reports devicePixelRatio 2 on a 1080p panel whose CSS viewport is
      // already 1920 wide, so trusting it decodes four times the pixels the
      // panel can show. Derive the ratio from the screen instead, which stays
      // correct on a real 4K device where the app still lays out at 1920.
      const ratio = getHomeArtworkPixelRatio();
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (!(width > 0) || !(height > 0)) {
        image.src = src;
        return;
      }
      image.dataset.originalSrc = src;
      const request = {};
      imageRequests.set(image, request);
      // Anything already on screen goes to the front of the queue. Hydration
      // ranks by focused row, which leaves a visible but unfocused row queued
      // behind rows the viewer has not reached, and those cards stay empty.
      const onScreen =
        rect.bottom > 0 &&
        rect.top < (Number(globalThis.innerHeight) || 0) &&
        rect.right > 0 &&
        rect.left < (Number(globalThis.innerWidth) || 0);
      const isStale = () =>
        !image.isConnected || imageRequests.get(image) !== request || image.dataset.originalSrc !== src || Boolean(image.dataset.src);
      rescaleHomeArtwork(src, { width, height, fit, priority: onScreen ? 0 : priority, isStale }).then((objectUrl) => {
        // The worker runs for a few hundred milliseconds, which is long enough
        // for the card to be released or queued again. Either way this result
        // is stale and holding on to it would leak the url.
        if (isStale()) {
          releaseHomeArtwork(objectUrl);
          return;
        }
        image.src = objectUrl || src;
      });
    },
    evictDistantHomeLazyImages(anchorNode = null) {
      if (!this.container || !Array.isArray(this.homeLazyImageHydrationIndex)) {
        return 0;
      }
      // Measure against the screen, not a scroll container. The classic home
      // mounts its rows inside an element that is as tall as all of them
      // together (25759px on an LG k8lp), so a container rect reports every row
      // as visible and nothing is ever far enough away to release.
      const doc = globalThis.document?.documentElement;
      const viewportRect = {
        top: 0,
        left: 0,
        bottom: Number(globalThis.innerHeight || doc?.clientHeight || 0) || 1080,
        right: Number(globalThis.innerWidth || doc?.clientWidth || 0) || 1920
      };
      const margin = HOME_LAZY_IMAGE_EVICT_MARGIN_PX;
      const anchorRow = anchorNode?.closest?.(HOME_LAZY_IMAGE_ROW_SELECTOR) || null;
      let released = 0;
      // Measure rows, never individual images. A full per-image sweep measured
      // 67ms for 1009 images on an LG k8lp, which would land on every vertical
      // move; the row count stays small and a row's images share its band.
      this.homeLazyImageHydrationIndex.forEach((entry) => {
        const row = entry?.row;
        if (!(row instanceof HTMLElement) || !row.isConnected || row === anchorRow) {
          return;
        }
        const rowRect = row.getBoundingClientRect();
        const gap =
          rowRect.bottom < viewportRect.top
            ? viewportRect.top - rowRect.bottom
            : rowRect.top > viewportRect.bottom
              ? rowRect.top - viewportRect.bottom
              : 0;
        if (gap <= margin) {
          return;
        }
        (entry.images || []).forEach((image) => {
          released += this.releaseHomeLazyImage(image) ? 1 : 0;
        });
      });
      return released;
    },
    releaseHomeLazyImage(image) {
      if (!(image instanceof HTMLImageElement) || !image.isConnected) {
        return false;
      }
      // Read the url off the element, so artwork hydrated by any path -
      // including the initial render - can still be handed back. A rescaled
      // poster paints from a blob url, so the original has to be what goes
      // back into data-src or the source is lost for good.
      const painted = String(image.getAttribute("src") || "").trim();
      const original = String(image.dataset.originalSrc || "").trim() || painted;
      if (!original) {
        return false;
      }
      releaseHomeArtwork(painted);
      imageRequests.delete(image);
      delete image.dataset.originalSrc;
      image.dataset.src = original;
      image.removeAttribute("src");
      return true;
    },
    releaseAllHomeLazyImages() {
      // TV runtimes keep the rendered home in the document while another
      // screen is shown, so tearing the rescaler down would revoke blob urls
      // that those cards are still pointing at and leave them broken when the
      // viewer comes back. Hand every url back first: the artwork is freed
      // while the other screen runs, and the next hydration pass refetches.
      // Query the document rather than the index, which cleanup may have
      // already dropped.
      if (!this.container) {
        return 0;
      }
      let released = 0;
      Array.from(this.container.querySelectorAll(HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR)).forEach((image) => {
        released += this.releaseHomeLazyImage(image) ? 1 : 0;
      });
      return released;
    },
    commitHomeLazyImageSources(queued = [], anchorNode = null, anchorRow = null) {
      const pending = this.homeLazyImageCommitQueue || (this.homeLazyImageCommitQueue = []);
      const nextOrder = () => {
        this.homeLazyImageCommitOrder = Number(this.homeLazyImageCommitOrder || 0) + 1;
        return this.homeLazyImageCommitOrder;
      };
      const isCurrentFocusedImage = (image) =>
        Boolean(anchorNode && (anchorNode === image || anchorNode.contains?.(image) || image.closest(".focusable") === anchorNode));
      pending.forEach((entry) => {
        entry.isFocusedImage = isCurrentFocusedImage(entry.image);
        entry.priority = entry.row === anchorRow ? (entry.isFocusedImage ? 0 : 1) : 2;
      });
      queued.forEach((entry) => {
        if (!(entry?.image instanceof HTMLImageElement) || !entry.image.isConnected || !entry.image.dataset.src) {
          return;
        }
        const existingIndex = pending.findIndex((candidate) => candidate.image === entry.image);
        if (existingIndex >= 0) {
          const existing = pending[existingIndex];
          existing.src = entry.src;
          existing.row = entry.row;
          existing.isFocusedRow = entry.isFocusedRow;
          existing.isFocusedImage = entry.isFocusedImage;
          existing.priority = entry.priority;
          existing.order = nextOrder();
          return;
        }
        pending.push({ ...entry, order: nextOrder() });
      });
      pending.sort((left, right) => left.priority - right.priority || left.order - right.order);
      if (!pending.length || this.homeLazyImageCommitRaf) {
        return;
      }

      const drain = () => {
        this.homeLazyImageCommitRaf = 0;
        let assigned = 0;
        while (pending.length && assigned < HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME) {
          const { image, src, priority } = pending.shift();
          if (!(image instanceof HTMLImageElement) || !image.isConnected) {
            continue;
          }
          const currentSrc = String(image.dataset.src || "").trim();
          if (!currentSrc) {
            continue;
          }
          this.assignHomeLazyImageSource(image, currentSrc || src, priority);
          assigned += 1;
        }
        if (pending.length) {
          this.homeLazyImageCommitRaf = requestAnimationFrame(drain);
        }
      };
      this.homeLazyImageCommitRaf = requestAnimationFrame(drain);
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
      const sections = Array.from(this.container?.querySelectorAll(".home-grid-section[data-section-title]") || []);
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
        const shouldShow = activeTitle && (!showHeroSection || main.scrollTop > Math.max(0, heroHeight - 48));
        sticky.textContent = activeTitle;
        sticky.classList.toggle("is-visible", Boolean(shouldShow));
      };
      main.addEventListener("scroll", update, { passive: true });
      update();
      this.gridStickyCleanup = () => {
        main.removeEventListener("scroll", update);
      };
    },
    selectNextUpProgressCandidates(allProgress = [], inProgressItems = [], watchedItems = [], options = {}) {
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
    }
  };
}
