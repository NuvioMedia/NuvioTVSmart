import { continueWatchingClickOpensDetails } from "./continueWatchingClickAction.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods08() {
  const {
    Router,
    CloudLibraryPlaybackProgressStore,
    CloudLibraryPlaybackSessionStore,
    cloudLibraryRepository,
    watchedItemsShareIdentity,
    CW_ENTER_DELAY_MS,
    CW_HOLD_DELAY_MS,
    isSeriesTypeForContinueWatching,
    normalizeContinueWatchingItem,
    isCloudContinueWatchingItem,
    continueWatchingStreamParams
  } = internals;

  return {
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
      const item = isPoster ? this.getPosterItemFromNode(node) : this.getContinueWatchingItemFromNode(node);
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
        const current = this.container?.querySelector(".home-continue-card.focusable.focused, .home-poster-card.focusable.focused") || null;
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
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingContinueWatchingHold(node);
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
      this.openContinueWatchingSelection(item);
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
        const current = this.container?.querySelector(".home-continue-card.focusable.focused") || null;
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
        this.openContinueWatchingSelection(focusedItem);
      }, CW_ENTER_DELAY_MS);
      return true;
    },
    // Selecting a card follows the "On Select" setting; the item menu does not.
    openContinueWatchingSelection(item) {
      const normalized = normalizeContinueWatchingItem(item);
      if (
        normalized?.contentId &&
        !isCloudContinueWatchingItem(normalized) &&
        continueWatchingClickOpensDetails(this.layoutPrefs?.continueWatchingClickAction, normalized)
      ) {
        return this.openContinueWatchingDetails(item);
      }
      return this.openContinueWatchingFromItem(item);
    },
    openContinueWatchingFromItem(item, options = {}) {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized?.contentId) {
        return false;
      }
      const anchorIndex = Number(this.continueWatchingMenu?.index);
      const anchorRowKey = String(this.continueWatchingMenu?.rowKey || "");
      this.cancelPendingContinueWatchingEnter();
      this.destroyHomeHoldDialog();
      this.rememberContinueWatchingReturnFocus(anchorIndex, anchorRowKey);
      this.continueWatchingMenu = null;
      this.holdMenuScrollState = null;

      if (isCloudContinueWatchingItem(normalized)) {
        void this.openCloudContinueWatchingFromItem(normalized, options).catch((error) => {
          console.warn("Cloud Continue Watching playback failed", error);
        });
        return true;
      }

      const params = continueWatchingStreamParams(normalized, options);
      if (!params) {
        return false;
      }

      Router.navigate("detail", {
        itemId: normalized.contentId,
        itemType: normalized.type || (isSeriesTypeForContinueWatching(normalized?.type) ? "series" : "movie"),
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
    async openCloudContinueWatchingFromItem(item, options = {}) {
      const normalized = normalizeContinueWatchingItem(item);
      const target = CloudLibraryPlaybackProgressStore.findForContinueWatching(normalized?.contentId, normalized?.videoId);
      if (!target?.item || !target.file) {
        return false;
      }
      const result = await cloudLibraryRepository.resolvePlayback(target.item, target.file);
      if (result?.status !== "success" || !result.url) {
        return false;
      }
      const cloudSessionToken =
        target.sessionToken ||
        CloudLibraryPlaybackSessionStore.create({
          item: target.item,
          currentFileKey: target.file.stableKey
        });
      if (!cloudSessionToken) {
        return false;
      }
      const filename = result.filename || target.file.name || target.item.name;
      const streamId = `${target.item.stableKey}:${target.file.stableKey}`;
      const startFromBeginning = Boolean(options?.startOver);
      Router.navigate("player", {
        streamUrl: result.url,
        itemId: target.item.stableKey,
        itemType: "cloud",
        videoId: streamId,
        playerTitle: filename,
        playerSubtitle: target.item.name,
        episodeTitle: filename,
        cloudSessionToken,
        resumePositionMs: startFromBeginning ? 0 : Number(normalized?.positionMs || target.progress?.positionMs || 0) || 0,
        resumeDurationMs: startFromBeginning ? 0 : Number(normalized?.durationMs || target.progress?.durationMs || 0) || 0,
        startFromBeginning,
        returnToStreamOnBack: false,
        returnToHomeOnBack: true,
        streamCandidates: [
          {
            id: streamId,
            url: result.url,
            name: filename,
            title: filename,
            description: target.item.name,
            addonName: target.item.providerName,
            behaviorHints: {
              filename,
              videoSize: result.videoSizeBytes || target.file.sizeBytes || null
            }
          }
        ],
        preferredStreamId: streamId
      });
      return true;
    },
    openContinueWatchingDetails(item) {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized?.contentId || isCloudContinueWatchingItem(normalized)) {
        return false;
      }
      const anchorIndex = Number(this.continueWatchingMenu?.index);
      const anchorRowKey = String(this.continueWatchingMenu?.rowKey || "");
      this.cancelPendingContinueWatchingEnter();
      this.rememberContinueWatchingReturnFocus(anchorIndex, anchorRowKey);
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
        if (!watchedItemsShareIdentity(entry, normalized)) {
          return false;
        }
        if (!videoId) {
          return true;
        }
        const entryVideoId = String(entry?.videoId || "");
        return !entryVideoId || entryVideoId === videoId;
      };
      this.allProgress = Array.isArray(this.allProgress) ? this.allProgress.filter((entry) => !matchesItem(entry)) : [];
      this.continueWatching = Array.isArray(this.continueWatching) ? this.continueWatching.filter((entry) => !matchesItem(entry)) : [];
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
    }
  };
}
