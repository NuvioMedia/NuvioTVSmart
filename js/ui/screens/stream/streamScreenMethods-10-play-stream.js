import { activeStreamLinkProfile } from "../../../data/local/streamLinkCacheStore.js";
/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods10() {
  const {
    Router,
    streamRepository,
    watchProgressRepository,
    isWatchProgressInProgress,
    STREAM_DPAD_REPEAT_THROTTLE_MS,
    clamp,
    getDpadDirection,
    isBackEvent,
    normalizeType
  } = internals;

  return {
    async playStream(streamId, { cachedLink = null, autoSelected = false } = {}) {
      const loadToken = this.loadToken;
      const profileId = activeStreamLinkProfile();
      this.cancelAutoPlayCountdown();
      this.cancelAutoPlaySelectionWait();
      const filtered = this.getFilteredStreams();
      const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
      if (!selected) {
        return;
      }
      streamRepository.setLocalPluginSearchPaused(true);
      const playerStreamCandidates = this.getFilteredStreams();
      const itemType = normalizeType(this.params?.itemType);
      const playerEpisodes =
        itemType === "series" || itemType === "tv" ? (Array.isArray(this.params?.episodes) ? this.params.episodes : null) : [];
      const startFromBeginning = Boolean(this.params?.startFromBeginning);
      const routeResumeProgress = {
        positionMs: Number(this.params?.resumePositionMs || 0) || 0,
        progressPercent: this.params?.resumeProgressPercent,
        durationMs: Number(this.params?.resumeDurationMs || 0) || 0
      };
      const hasRouteResume = !startFromBeginning && isWatchProgressInProgress(routeResumeProgress);
      let resumePositionMs = hasRouteResume ? routeResumeProgress.positionMs : 0;
      let resumeProgressPercent = hasRouteResume ? routeResumeProgress.progressPercent : null;
      let resumeDurationMs = hasRouteResume ? routeResumeProgress.durationMs : 0;
      if (!startFromBeginning && resumePositionMs <= 0 && !(Number(resumeProgressPercent) > 0)) {
        const resumeTarget =
          itemType === "series" || itemType === "tv"
            ? {
                videoId: this.params?.videoId || null,
                season: this.params?.season,
                episode: this.params?.episode
              }
            : {};
        const resumeProgress = await watchProgressRepository.getResumeByContentId(this.params?.itemId, resumeTarget).catch((error) => {
          console.warn("Stream resume lookup failed", error);
          return null;
        });
        resumePositionMs = Number(resumeProgress?.positionMs || 0) || 0;
        resumeProgressPercent = resumeProgress?.progressPercent ?? resumeProgressPercent;
        resumeDurationMs = Number(resumeProgress?.durationMs || 0) || resumeDurationMs;
      }

      if (loadToken !== this.loadToken || Router.getCurrent() !== "stream" || profileId !== activeStreamLinkProfile()) return;
      Router.navigate("player", {
        streamUrl: selected.url || selected.externalUrl || null,
        itemId: this.params?.itemId || null,
        itemType: itemType || "movie",
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        contentLanguage:
          cachedLink?.contentLanguage ||
          this.params?.contentLanguage ||
          this.params?.originalLanguage ||
          this.params?.original_language ||
          null,
        videoId: this.params?.videoId || null,
        resumePositionMs,
        resumeProgressPercent,
        resumeDurationMs,
        startFromBeginning,
        episodeLabel: this.params?.season && this.params?.episode ? `S${this.params.season}E${this.params.episode}` : null,
        playerTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
        playerSubtitle: this.params?.episodeTitle || this.params?.playerSubtitle || "",
        playerEpisodeTitle: this.params?.episodeTitle || "",
        playerReleaseYear: cachedLink?.year || this.params?.year || "",
        playerBackdropUrl: this.getBackdropUrl() || null,
        playerLogoUrl: this.params?.logo || null,
        parentalWarnings: this.params?.parentalWarnings || null,
        parentalGuide: this.params?.parentalGuide || null,
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode),
        episodes: playerEpisodes,
        streamCandidates: playerStreamCandidates,
        preferredStreamId: selected.id,
        playbackSourceContext: selected.streamOrigin || {
          addonId: selected.addonId || "",
          addonBaseUrl: selected.addonBaseUrl || "",
          addonName: selected.addonName || "",
          addonOrderIndex: Number.isFinite(Number(selected.addonOrderIndex)) ? Number(selected.addonOrderIndex) : null,
          sourceProviderId: selected.sourceProviderId || "",
          sourceIds: Array.isArray(selected.sources) ? selected.sources : [],
          selectedStreamId: selected.id || ""
        },
        returnToStreamOnBack: true,
        fromLinkCache: Boolean(cachedLink),
        // Android autoPlayNav: picked by auto source selection, so it may fall back.
        autoPlayNav: Boolean(autoSelected),
        streamRouteParams: this.params ? { ...this.params } : null,
        fromDetailRoute: Boolean(this.params?.fromDetailRoute),
        nextEpisodeVideoId: this.params?.nextEpisodeVideoId || null,
        nextEpisodeLabel: this.params?.nextEpisodeLabel || null,
        nextEpisodeSeason: this.params?.nextEpisodeSeason ?? null,
        nextEpisodeEpisode: this.params?.nextEpisodeEpisode ?? null,
        nextEpisodeTitle: this.params?.nextEpisodeTitle || "",
        nextEpisodeReleased: this.params?.nextEpisodeReleased || "",
        nextEpisodeMetadataResolved: this.params?.nextEpisodeMetadataResolved ?? null
      });
    },
    refreshStreams() {
      this.cancelAutoPlayCountdown();
      this.streamVirtualFocusReset = true;
      void this.loadStreams({ forceRefresh: true });
      this.render();
    },
    onPointerFocus(target) {
      if (!target || !this.container?.contains(target)) {
        return false;
      }
      const { chips } = this.getFocusLists();
      const chipTarget = target.closest?.(".stream-route-chip.focusable") || target;
      const chipIndex = chips.indexOf(chipTarget);
      if (chipIndex >= 0) {
        this.streamUserMovedFocus = true;
        this.focusState = { zone: "filter", index: chipIndex };
        this.focusList(chips, chipIndex);
        return true;
      }
      const cardAction = target.closest?.("[data-stream-row][data-card-action]");
      if (cardAction) {
        this.streamUserMovedFocus = true;
        this.focusState = {
          zone: "card",
          row: Math.max(0, Number(cardAction.dataset.streamRow || 0)),
          action: String(cardAction.dataset.cardAction || "play")
        };
        this.focusElement(cardAction);
        return true;
      }
      return false;
    },
    onPointerActivate(target) {
      if (!target || !this.container?.contains(target)) {
        return false;
      }
      const actionTarget = target.closest?.("[data-action]") || target;
      this.onPointerFocus(actionTarget);
      const action = String(actionTarget.dataset.action || "");
      if (action === "refreshStreams") {
        this.refreshStreams();
        return true;
      }
      if (action === "setFilter") {
        const addon = String(actionTarget.dataset.addon || "all");
        const { chips } = this.getFocusLists();
        this.setAddonFilter(addon, "filter", Math.max(0, chips.indexOf(actionTarget)));
        return true;
      }
      if (action === "playStream") {
        this.playStream(actionTarget.dataset.streamId);
        return true;
      }
      if (action === "openNativePlayer") {
        void this.openStreamInNativePlayer(actionTarget.dataset.streamId);
        return true;
      }
      return false;
    },
    onKeyDown(event) {
      // Any key during the auto-play countdown hands control back to the user.
      // Back just cancels and stays on the picker; other keys cancel and then do
      // their normal thing (OK on the highlighted stream plays it right away).
      if (this.autoPlayCountdown) {
        this.cancelAutoPlayCountdown();
        if (isBackEvent(event)) {
          event?.preventDefault?.();
          return;
        }
      }

      if (isBackEvent(event)) {
        event?.preventDefault?.();
        if (!this.navigateBackFromStream()) {
          Router.back();
        }
        return;
      }

      const direction = getDpadDirection(event);
      if (direction && event?.repeat) {
        const now = Date.now();
        const lastRepeatAt = Number(this.streamLastNavigationRepeatAt || 0);
        if (now - lastRepeatAt < STREAM_DPAD_REPEAT_THROTTLE_MS) {
          event?.preventDefault?.();
          return;
        }
        this.streamLastNavigationRepeatAt = now;
      }
      if (direction) {
        this.streamUserMovedFocus = true;
        let { chips, rows, rowCount, virtualized } = this.getFocusLists();
        const zone = this.focusState?.zone || (rowCount ? "card" : "filter");
        let index = Number(this.focusState?.index || 0);
        event?.preventDefault?.();

        if (zone === "card" && virtualized) {
          const focusedRowIndex = clamp(Number(this.focusState?.row || 0), 0, Math.max(0, rowCount - 1));
          if (!rows[focusedRowIndex]) {
            this.ensureStreamVirtualRowMounted(focusedRowIndex);
            this.streamFocusDomCache = null;
            ({ chips, rows, rowCount, virtualized } = this.getFocusLists());
          }
        }

        if (zone === "filter") {
          if (direction === "left" || direction === "right") {
            if (chips.length) {
              const nextIndex = clamp(index + (direction === "left" ? -1 : 1), 0, chips.length - 1);
              const target = chips[nextIndex];
              if (target?.dataset.action === "refreshStreams") {
                this.focusState = { zone: "filter", index: nextIndex };
                this.applyFocus();
              } else {
                this.setAddonFilter(String(target?.dataset.addon || "all"), "filter", nextIndex);
              }
            }
            return;
          }
          if (direction === "down" && rowCount) {
            this.focusState = { zone: "card", row: 0, action: "play" };
            this.applyFocus();
          }
          return;
        }

        if (zone === "card") {
          const rowIndex = clamp(Number(this.focusState?.row || 0), 0, Math.max(0, rowCount - 1));
          const currentRow = rows[rowIndex] || null;
          const currentAction = String(this.focusState?.action || "play");
          if (direction === "up") {
            if (rowIndex > 0) {
              const previousRow = rows[rowIndex - 1] || null;
              const target = this.resolveCardActionForRow(previousRow, currentAction);
              this.focusState = {
                zone: "card",
                row: rowIndex - 1,
                action: String(target?.dataset?.cardAction || currentAction)
              };
              this.applyFocus();
              return;
            }
            this.focusState = {
              zone: "filter",
              index: 1 + Math.max(0, ["all", ...this.getOrderedFilterNames()].indexOf(this.addonFilter))
            };
            this.applyFocus();
            return;
          }
          if (direction === "down") {
            const nextRowIndex = clamp(rowIndex + 1, 0, Math.max(0, rowCount - 1));
            const nextRow = rows[nextRowIndex] || null;
            const target = this.resolveCardActionForRow(nextRow, currentAction);
            this.focusState = {
              zone: "card",
              row: nextRowIndex,
              action: String(target?.dataset?.cardAction || currentAction)
            };
            this.applyFocus();
            return;
          }
          if (direction === "left") {
            if (currentAction === "native" && currentRow?.play) {
              this.focusState = { zone: "card", row: rowIndex, action: "play" };
              this.applyFocus();
              return;
            }
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
            const nextFilter = ordered[clamp(currentIndex - 1, 0, ordered.length - 1)] || "all";
            this.setAddonFilter(nextFilter, "card", rowIndex);
            return;
          }
          if (direction === "right") {
            if (currentAction === "play" && currentRow?.native) {
              this.focusState = { zone: "card", row: rowIndex, action: "native" };
              this.applyFocus();
              return;
            }
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
            const nextFilter = ordered[clamp(currentIndex + 1, 0, ordered.length - 1)] || "all";
            this.setAddonFilter(nextFilter, "card", rowIndex);
            return;
          }
        }
        return;
      }

      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }

      let current = this.container.querySelector(".focusable.focused");
      if (!current && this.streamVirtualized && this.focusState?.zone === "card") {
        this.applyFocus();
        current = this.container.querySelector(".focusable.focused");
      }
      if (!current) {
        return;
      }
      const action = String(current.dataset.action || "");
      if (action === "refreshStreams") {
        this.refreshStreams();
        return;
      }
      if (action === "setFilter") {
        const addon = String(current.dataset.addon || "all");
        this.setAddonFilter(addon, "filter", Array.from(this.container.querySelectorAll(".stream-route-chip.focusable")).indexOf(current));
        return;
      }
      if (action === "playStream") {
        this.playStream(current.dataset.streamId);
        return;
      }
      if (action === "openNativePlayer") {
        void this.openStreamInNativePlayer(current.dataset.streamId);
      }
    }
  };
}
