import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods09() {
  const {
    Router,
    watchProgressRepository,
    CloudLibraryPlaybackProgressStore,
    watchedItemsRepository,
    watchedItemsShareIdentity,
    watchedSeriesReconciliationService,
    savedLibraryRepository,
    ContinueWatchingPreferences,
    buildWatchedTitleIdSet,
    isTitleItemWatched,
    isSeriesTypeForContinueWatching,
    normalizeContinueWatchingItem,
    isCloudContinueWatchingItem
  } = internals;

  return {
    async toggleContinueWatchingWatched(item) {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized?.contentId) {
        return false;
      }
      if (this.isContinueWatchingItemWatched(normalized)) {
        if (
          (await watchedItemsRepository.unmark(normalized.contentId, {
            contentType: normalized.type || "movie",
            season: normalized.season ?? null,
            episode: normalized.episode ?? null,
            videoId: normalized.videoId || null,
            imdbId: normalized.imdbId || null,
            tmdbId: normalized.tmdbId || null,
            traktId: normalized.traktId || null,
            title: normalized.title || normalized.contentId || "Untitled"
          })) === false
        )
          return false;
        await watchProgressRepository.removeProgress(normalized.contentId, normalized.videoId || null);
        this.watchedItems = await watchedItemsRepository.getAll(2000).catch(() => this.watchedItems);
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        return true;
      }
      if (
        (await watchedItemsRepository.mark({
          contentId: normalized.contentId,
          contentType: normalized.type || "movie",
          season: normalized.season ?? null,
          episode: normalized.episode ?? null,
          videoId: normalized.videoId || null,
          imdbId: normalized.imdbId || null,
          tmdbId: normalized.tmdbId || null,
          traktId: normalized.traktId || null,
          title: normalized.title || normalized.contentId || "Untitled",
          watchedAt: Date.now()
        })) === false
      )
        return false;
      await watchProgressRepository.saveProgress({
        contentId: normalized.contentId,
        imdbId: normalized.imdbId || null,
        tmdbId: normalized.tmdbId || null,
        traktId: normalized.traktId || null,
        contentType: normalized.type || "movie",
        videoId: normalized.videoId || null,
        season: normalized.season,
        episode: normalized.episode,
        positionMs: 100,
        durationMs: 100,
        updatedAt: Date.now()
      });
      this.watchedItems = await watchedItemsRepository.getAll(2000).catch(() => this.watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      this.pruneContinueWatchingItem(normalized);
      return true;
    },
    async markContinueWatchingItemWatched(item) {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized?.contentId) {
        return false;
      }
      if (this.isContinueWatchingItemWatched(normalized)) {
        // Already watched: the menu action only has to drop the row.
        this.pruneContinueWatchingItem(normalized);
        return true;
      }
      return this.toggleContinueWatchingWatched(normalized);
    },
    async removeContinueWatchingItem(item) {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized?.contentId) {
        return false;
      }
      if (normalized.isNextUp) {
        ContinueWatchingPreferences.addDismissedNextUpKey(normalized.contentId);
        // Android dismisses the whole title from Continue Watching, including
        // any other Next Up entry for the same content.
        this.pruneContinueWatchingItem({ ...normalized, videoId: null });
        return true;
      }
      if (isCloudContinueWatchingItem(normalized)) {
        CloudLibraryPlaybackProgressStore.removeForContinueWatching(normalized.contentId);
        this.pruneContinueWatchingItem({ ...normalized, videoId: null });
        return true;
      }
      // Android removes all progress for an InProgress title, not only the
      // currently displayed episode. Keep the in-memory projection in sync too.
      await watchProgressRepository.removeProgress(normalized.contentId);
      this.pruneContinueWatchingItem({ ...normalized, videoId: null });
      return true;
    },
    async activateContinueWatchingMenuOption() {
      const item = this.getContinueWatchingMenuItem();
      const options = this.getContinueWatchingMenuOptions();
      const option = options[Math.max(0, Math.min(options.length - 1, Number(this.continueWatchingMenu?.optionIndex || 0)))];
      if (!item || !option) {
        return false;
      }
      const anchorIndex = Math.max(0, Number(this.continueWatchingMenu?.index || 0));
      const anchorRowKey = String(this.continueWatchingMenu?.rowKey || "continue_watching");
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
      if (option.action === "markWatched") {
        if (!(await this.markContinueWatchingItemWatched(item))) {
          return false;
        }
      } else if (option.action === "remove") {
        await this.removeContinueWatchingItem(item);
      } else {
        return false;
      }
      this.destroyHomeHoldDialog();
      this.continueWatchingMenu = null;
      this.pendingContinueWatchingFocusIndex = anchorIndex;
      this.pendingContinueWatchingFocusRowKey = anchorRowKey;
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
        isTitleItemWatched(item, this.watchedTitleIds) ||
        (await watchedItemsRepository.isWatched(item.id).catch(() => false))
      );
      if (isSeriesTypeForContinueWatching(item.type)) {
        if (watched) {
          if (
            (await watchedSeriesReconciliationService.unmarkSeriesWatched(item.id, {
              contentType: item.type || "series"
            })) === false
          )
            return false;
        } else {
          const marked = await watchedSeriesReconciliationService.markSeriesWatched(item.id, item.type || "series", {
            title: item.name || item.id || "Untitled"
          });
          if (!marked) return false;
        }
        this.watchedItems = await watchedItemsRepository.getAll(2000).catch(() => this.watchedItems);
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        void this.refreshWatchedTitleState({ token: this.homeLoadToken });
        if (this.posterHoldMenu) {
          this.posterHoldMenu = { ...this.posterHoldMenu, isWatched: !watched };
        }
        return true;
      }
      if (watched) {
        if (
          (await watchedItemsRepository.unmark(item.id, {
            contentType: item.type || "movie",
            imdbId: item.imdbId || null,
            tmdbId: item.tmdbId || null,
            traktId: item.traktId || null,
            title: item.name || item.id || "Untitled"
          })) === false
        )
          return false;
        await watchProgressRepository.removeProgress(item.id, null).catch(() => false);
        this.watchedItems = Array.isArray(this.watchedItems)
          ? this.watchedItems.filter((entry) => !watchedItemsShareIdentity(entry, item))
          : [];
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        if (this.posterHoldMenu) {
          this.posterHoldMenu = { ...this.posterHoldMenu, isWatched: false };
        }
        return true;
      }
      if (
        (await watchedItemsRepository.mark({
          contentId: item.id,
          contentType: item.type || "movie",
          imdbId: item.imdbId || null,
          tmdbId: item.tmdbId || null,
          traktId: item.traktId || null,
          title: item.name || item.id || "Untitled",
          watchedAt: Date.now()
        })) === false
      )
        return false;
      await watchProgressRepository.saveProgress({
        contentId: item.id,
        imdbId: item.imdbId || null,
        tmdbId: item.tmdbId || null,
        traktId: item.traktId || null,
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
          imdbId: item.imdbId || null,
          tmdbId: item.tmdbId || null,
          traktId: item.traktId || null,
          title: item.name || item.id || "Untitled",
          watchedAt: Date.now()
        },
        ...(Array.isArray(this.watchedItems) ? this.watchedItems.filter((entry) => !watchedItemsShareIdentity(entry, item)) : [])
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
      const option = options[Math.max(0, Math.min(options.length - 1, Number(this.posterHoldMenu?.optionIndex || 0)))];
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
    }
  };
}
