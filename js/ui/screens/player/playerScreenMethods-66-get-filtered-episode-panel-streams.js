/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods66() {
  const { streamRepository, isSelectKeyCode, t, clamp, normalizeItemType, streamMergeKey } = internals;

  return {
    getFilteredEpisodePanelStreams() {
      const streams = Array.isArray(this.episodePanelStreams) ? this.episodePanelStreams : [];
      if (this.episodePanelStreamFilter === "all") {
        return streams;
      }
      return streams.filter((stream) => String(stream?.addonName || "") === this.episodePanelStreamFilter);
    },
    closeEpisodeStreamsView() {
      streamRepository.setLocalPluginSearchPaused(true);
      this.episodePanelStreamLoadToken = Number(this.episodePanelStreamLoadToken || 0) + 1;
      this.episodePanelMode = "episodes";
      this.episodePanelStreamsLoading = false;
      this.episodePanelStreamsError = "";
      this.episodePanelFocusZone = "episodes";
      this.renderEpisodePanel();
    },
    async openEpisodeStreamsView({ forceReload = false } = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      const selected = this.episodes[this.episodePanelIndex] || null;
      if (!selected?.id) {
        return;
      }
      this.episodePanelMode = "streams";
      this.episodePanelStreamVideoId = String(selected.id);
      this.episodePanelStreamFilter = "all";
      this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      this.episodePanelStreamsError = "";
      this.episodePanelStreamsLoading = true;
      this.episodePanelStreams = [];
      this.renderEpisodePanel();

      const itemType = this.params?.itemType || "series";
      const cacheKey = this.getStreamCacheKey(selected.id, normalizeItemType(itemType), selected.season, selected.episode);
      if (forceReload) {
        this.streamCandidatesByVideoId?.delete?.(cacheKey);
      }
      const token = Number(this.episodePanelStreamLoadToken || 0) + 1;
      this.episodePanelStreamLoadToken = token;
      const isCurrentRequest = () =>
        token === this.episodePanelStreamLoadToken &&
        this.episodePanelVisible &&
        this.episodePanelMode === "streams" &&
        !this.switchingEpisode &&
        String(this.episodePanelStreamVideoId || "") === String(selected.id);
      const applyStreams = (streams) => {
        if (!isCurrentRequest()) return;
        const previousStreams = this.getFilteredEpisodePanelStreams();
        const focus = this.episodePanelStreamFocus;
        const previousStream = focus?.zone === "streams" ? previousStreams[focus.index] : null;
        const previousFilter = this.getEpisodePanelStreamFilters()[focus?.index];
        const firstResults = this.episodePanelStreamsLoading && streams.length > 0;
        this.episodePanelStreams = streams;
        if (streams.length) this.episodePanelStreamsLoading = false;
        if (previousStream) {
          const key = streamMergeKey(previousStream);
          const filtered = this.getFilteredEpisodePanelStreams();
          const index = filtered.findIndex((stream) => stream === previousStream || (key && streamMergeKey(stream) === key));
          this.episodePanelStreamFocus = {
            zone: "streams",
            index: index >= 0 ? index : clamp(focus.index, 0, Math.max(0, filtered.length - 1))
          };
        } else if (focus?.zone === "filters") {
          this.episodePanelStreamFocus = {
            zone: "filters",
            index: Math.max(0, this.getEpisodePanelStreamFilters().indexOf(previousFilter))
          };
        } else if (firstResults && focus?.zone === "actions" && focus.index === 0) {
          this.episodePanelStreamFocus = { zone: "streams", index: 0 };
        }
        this.renderEpisodePanel();
      };
      try {
        const streams = await this.getPlayableStreamsForVideo(selected.id, itemType, {
          season: selected.season,
          episode: selected.episode,
          forceRefresh: forceReload,
          onChunk: applyStreams
        });
        if (!isCurrentRequest()) return;
        applyStreams(streams);
        if (this.episodePanelStreamsLoading) {
          this.episodePanelStreamsLoading = false;
          this.renderEpisodePanel();
        }
      } catch (_error) {
        if (!isCurrentRequest()) return;
        this.episodePanelStreamsLoading = false;
        this.episodePanelStreamsError = t("panel_failed_load_streams", {}, "Failed to load streams");
        this.renderEpisodePanel();
      }
    },
    updateEpisodeStreamFocus() {
      const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
      if (!panel || !this.episodePanelVisible || this.episodePanelMode !== "streams") return;
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      const selectors = {
        close: "[data-episode-action='close']",
        actions: `[data-episode-stream-action='${focus.index === 1 ? "reload" : "back"}']`,
        filters: `[data-episode-stream-filter-index="${Number(focus.index) || 0}"]`,
        streams: `[data-episode-stream-index="${Number(focus.index) || 0}"]`
      };
      const target = panel.querySelector(selectors[focus.zone] || selectors.actions);
      panel.querySelectorAll(".focused").forEach((node) => node.classList.remove("focused"));
      target?.classList.add("focused");
      this.scrollEpisodePanelIntoView();
    },
    moveEpisodeStreamFocus(direction) {
      const filters = this.getEpisodePanelStreamFilters();
      const streams = this.getFilteredEpisodePanelStreams();
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      let index = Number(focus.index || 0);

      if (focus.zone === "close") {
        if (direction === "down") {
          this.episodePanelStreamFocus = { zone: "actions", index: 0 };
        }
        return;
      }
      if (focus.zone === "actions") {
        if (direction === "left" || direction === "right") {
          this.episodePanelStreamFocus = {
            zone: "actions",
            index: clamp(index + (direction === "right" ? 1 : -1), 0, 1)
          };
        } else if (direction === "up") {
          this.episodePanelStreamFocus = { zone: "close", index: 0 };
        } else if (direction === "down") {
          this.episodePanelStreamFocus = filters.length
            ? {
                zone: "filters",
                index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, filters.length - 1)
              }
            : { zone: "streams", index: 0 };
        }
        return;
      }
      if (focus.zone === "filters") {
        if (direction === "left" || direction === "right") {
          this.episodePanelStreamFocus = {
            zone: "filters",
            index: clamp(index + (direction === "right" ? 1 : -1), 0, Math.max(0, filters.length - 1))
          };
        } else if (direction === "up") {
          this.episodePanelStreamFocus = { zone: "actions", index: 0 };
        } else if (direction === "down" && streams.length) {
          this.episodePanelStreamFocus = { zone: "streams", index: 0 };
        }
        return;
      }
      if (focus.zone === "streams") {
        if (direction === "up") {
          this.episodePanelStreamFocus =
            index > 0
              ? { zone: "streams", index: index - 1 }
              : {
                  zone: "filters",
                  index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, Math.max(0, filters.length - 1))
                };
        } else if (direction === "down") {
          this.episodePanelStreamFocus = {
            zone: "streams",
            index: clamp(index + 1, 0, Math.max(0, streams.length - 1))
          };
        }
      }
    },
    async activateEpisodeStreamFocus() {
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      if (focus.zone === "close") {
        this.hideEpisodePanel();
        return;
      }
      if (focus.zone === "actions") {
        if (Number(focus.index || 0) === 0) {
          this.closeEpisodeStreamsView();
        } else {
          await this.openEpisodeStreamsView({ forceReload: true });
        }
        return;
      }
      if (focus.zone === "filters") {
        const filters = this.getEpisodePanelStreamFilters();
        this.episodePanelStreamFilter = filters[clamp(Number(focus.index || 0), 0, Math.max(0, filters.length - 1))] || "all";
        this.episodePanelStreamFocus = {
          zone: "filters",
          index: Math.max(0, filters.indexOf(this.episodePanelStreamFilter))
        };
        this.renderEpisodePanel();
        return;
      }
      const streams = this.getFilteredEpisodePanelStreams();
      const selectedStream = streams[clamp(Number(focus.index || 0), 0, Math.max(0, streams.length - 1))] || null;
      if (selectedStream) {
        await this.playEpisodeFromPanel(selectedStream);
      }
    },
    handleEpisodePanelKey(event) {
      if (!this.episodePanelVisible) {
        return false;
      }
      const keyCode = Number(event?.keyCode || event?.which || event?.originalKeyCode || 0);
      const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
      if (!isNavigationKey) {
        return false;
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();

      if (this.episodePanelMode === "streams") {
        if (keyCode === 37) {
          this.moveEpisodeStreamFocus("left");
        } else if (keyCode === 38) {
          this.moveEpisodeStreamFocus("up");
        } else if (keyCode === 39) {
          this.moveEpisodeStreamFocus("right");
        } else if (keyCode === 40) {
          this.moveEpisodeStreamFocus("down");
        } else if (isSelectKeyCode(keyCode)) {
          void this.activateEpisodeStreamFocus();
          return true;
        }
        this.updateEpisodeStreamFocus();
        return true;
      }

      const seasons = this.getEpisodePanelSeasons();
      const hasSeasonTabs = seasons.length > 1;
      const entries = this.getEpisodePanelEntries();
      const currentPosition = Math.max(
        0,
        entries.findIndex((entry) => entry.index === this.episodePanelIndex)
      );

      if (keyCode === 38) {
        if (this.episodePanelFocusZone === "episodes") {
          if (currentPosition > 0) {
            this.moveEpisodePanel(-1);
          } else {
            this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "close";
            this.renderEpisodePanel();
          }
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "close";
          this.renderEpisodePanel();
          return true;
        }
        return true;
      }

      if (keyCode === 40) {
        if (this.episodePanelFocusZone === "close") {
          this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "episodes";
          this.renderEpisodePanel();
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "episodes";
          this.renderEpisodePanel();
          return true;
        }
        this.moveEpisodePanel(1);
        return true;
      }

      if (keyCode === 37 || keyCode === 39) {
        if (this.episodePanelFocusZone === "seasons") {
          this.moveEpisodePanelSeason(keyCode === 37 ? -1 : 1);
        }
        return true;
      }

      if (isSelectKeyCode(keyCode)) {
        if (this.episodePanelFocusZone === "close") {
          this.hideEpisodePanel();
          return true;
        }
        if (this.episodePanelFocusZone === "seasons") {
          this.episodePanelFocusZone = "episodes";
          this.renderEpisodePanel();
          return true;
        }
        this.playEpisodeFromPanel();
        return true;
      }

      return true;
    },
    scrollEpisodePanelIntoView() {
      const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
      if (!panel || !this.episodePanelVisible) {
        return;
      }

      const scrollVerticallyWithin = (container, target, padding = 12) => {
        if (!container || !target) {
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.top < containerRect.top + padding) {
          container.scrollTop -= containerRect.top + padding - targetRect.top;
        } else if (targetRect.bottom > containerRect.bottom - padding) {
          container.scrollTop += targetRect.bottom - (containerRect.bottom - padding);
        }
      };

      const scrollHorizontallyWithin = (container, target, padding = 8) => {
        if (!container || !target) {
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.left < containerRect.left + padding) {
          container.scrollLeft -= containerRect.left + padding - targetRect.left;
        } else if (targetRect.right > containerRect.right - padding) {
          container.scrollLeft += targetRect.right - (containerRect.right - padding);
        }
      };

      const selected = panel.querySelector(".player-episode-item.focused") || panel.querySelector(".player-episode-item.selected");
      scrollVerticallyWithin(panel.querySelector(".player-episode-list"), selected);

      const focusedSeason = panel.querySelector(".player-episode-season-tab.focused");
      scrollHorizontallyWithin(panel.querySelector(".player-episode-season-tabs"), focusedSeason);

      const focusedStream = panel.querySelector(".player-episode-stream-card.focused");
      scrollVerticallyWithin(panel.querySelector(".player-episode-stream-list"), focusedStream);

      const focusedFilter = panel.querySelector(".player-episode-stream-filter.focused");
      scrollHorizontallyWithin(panel.querySelector(".player-episode-stream-filters"), focusedFilter);

      try {
        const focused = panel.querySelector(".focused");
        focused?.focus?.({ preventScroll: true });
      } catch (_) {
        // Some TV WebKit builds reject programmatic focus during DOM replacement.
      }
    }
  };
}
