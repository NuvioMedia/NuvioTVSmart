import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods24() {
  const {
    MODERN_HOME_CONSTANTS,
    CW_DAYS_CAP,
    HOME_LAZY_IMAGE_SELECTOR,
    HOME_LAZY_IMAGE_ROW_SELECTOR,
    HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS,
    HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME,
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
      Array.from(this.container.querySelectorAll(HOME_LAZY_IMAGE_SELECTOR)).forEach((image) => {
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
        const images = entry.images.filter((image) => image.isConnected && image.dataset.src);
        entry.images = images;
        if (!images.length) return;
        // Android's LazyRow loads the visible cards plus a small prefetch
        // neighborhood, not every item in the focused row. Keep the same
        // bounded behavior on Smart-TV runtimes; older/browser fallback paths
        // retain the full focused-row hydration for compatibility.
        const shouldHydrateFocusedRowImmediately = isFocusedRow && !useBoundedTvHydration;
        if (!shouldHydrateFocusedRowImmediately && row instanceof HTMLElement) {
          const rowRect = row.getBoundingClientRect();
          const isRowNearViewport =
            rowRect.bottom >= viewportRect.top - verticalMargin && rowRect.top <= viewportRect.bottom + verticalMargin;
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
              rect.bottom >= viewportRect.top - verticalMargin &&
              rect.top <= viewportRect.bottom + verticalMargin &&
              rect.right >= viewportRect.left - imageHorizontalMargin &&
              rect.left <= viewportRect.right + imageHorizontalMargin;
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
        pendingLoads.forEach(({ image, src }) => {
          image.loading = "eager";
          image.removeAttribute("data-src");
          image.src = src;
        });
      }
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
          const { image, src } = pending.shift();
          if (!(image instanceof HTMLImageElement) || !image.isConnected) {
            continue;
          }
          const currentSrc = String(image.dataset.src || "").trim();
          if (!currentSrc) {
            continue;
          }
          image.loading = "eager";
          image.removeAttribute("data-src");
          image.src = currentSrc || src;
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
