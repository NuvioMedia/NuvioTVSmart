/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods67() {
  const {
    PlayerController,
    streamRepository,
    StreamBadgeSettingsStore,
    Router,
    contentTextDirection,
    ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS,
    EPISODE_PANEL_TRANSITION_MS,
    t,
    escapeHtml,
    escapeAttribute,
    formatEpisodePanelDate,
    episodeDisplayCode,
    episodeThumbnailUrl,
    getPlayerSourceLogoDisplayUrl,
    renderPlayerSourceBadges,
    resolvePlayerSourceBadgePlacement,
    streamDirectPlaybackUrl
  } = internals;

  return {
    renderEpisodeStreamsView() {
      const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
      const filters = this.getEpisodePanelStreamFilters();
      const streams = this.getFilteredEpisodePanelStreams();
      const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      const showAddonLogo = badgeSettings.showAddonLogo === true;
      const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
      const episodeCode = episodeDisplayCode(selectedEpisode);
      const episodeTitle = String(selectedEpisode?.title || t("episodes_episode", {}, "Episode")).trim();

      return `
          <div class="player-episode-stream-actions">
            <button type="button"
                    class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 0 ? " focused" : ""}"
                    data-episode-stream-action="back">
              ${escapeHtml(t("episodes_panel_back", {}, "Back"))}
            </button>
            <button type="button"
                    class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 1 ? " focused" : ""}"
                    data-episode-stream-action="reload">
              ${escapeHtml(t("episodes_panel_reload", {}, "Reload"))}
            </button>
            <div class="player-episode-stream-meta">
              ${escapeHtml([episodeCode, episodeTitle].filter(Boolean).join(" • "))}
            </div>
          </div>

          ${
            !this.episodePanelStreamsLoading && filters.length > 1
              ? `<div class="player-episode-stream-filters">
                  ${filters
                    .map((filter, index) => {
                      const selected = this.episodePanelStreamFilter === filter;
                      const focused = focus.zone === "filters" && focus.index === index;
                      return `
                        <button type="button"
                                class="player-episode-stream-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                                data-episode-stream-filter-index="${index}">
                          ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
                        </button>
                      `;
                    })
                    .join("")}
                </div>`
              : ""
          }

          <div class="player-episode-stream-list">
            ${
              this.episodePanelStreamsLoading
                ? `<div class="player-episode-stream-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>`
                : ""
            }
            ${
              this.episodePanelStreamsError
                ? `<div class="player-episode-stream-empty">${escapeHtml(this.episodePanelStreamsError)}</div>`
                : ""
            }
            ${
              !this.episodePanelStreamsLoading && !this.episodePanelStreamsError && !streams.length
                ? `<div class="player-episode-stream-empty">${escapeHtml(t("episodes_panel_no_streams", {}, "No streams found"))}</div>`
                : streams
                    .map((stream, index) => {
                      const focused = focus.zone === "streams" && focus.index === index;
                      const badges = renderPlayerSourceBadges(stream, badgeSettings);
                      const topBadges = badgePlacement === "TOP" ? badges : "";
                      const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
                      const addonLogoUrl = showAddonLogo
                        ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () => this.scheduleSourceLogoRender())
                        : "";
                      const sourceLabel = stream.label || "Stream";
                      const sourceDescription = stream.description || stream.addonName || "";
                      const sourceAddonName = stream.addonName || t("nav_addons", {}, "Addon");
                      const sourceSide = showAddonLogo
                        ? `<div class="player-source-side">
                            ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                            <div class="player-source-addon" dir="${contentTextDirection(sourceAddonName)}">${escapeHtml(sourceAddonName)}</div>
                          </div>`
                        : "";
                      return `
                        <article class="player-source-card player-episode-stream-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}"
                                 data-episode-stream-index="${index}">
                          <div class="player-source-main">
                            ${topBadges}
                            <div class="player-source-title" dir="${contentTextDirection(sourceLabel)}">${escapeHtml(sourceLabel)}</div>
                            <div class="player-source-desc" dir="${contentTextDirection(sourceDescription)}">${escapeHtml(sourceDescription)}</div>
                            ${bottomBadges}
                          </div>
                          ${sourceSide}
                        </article>
                      `;
                    })
                    .join("")
            }
          </div>
        `;
    },
    renderEpisodePanel() {
      if (this.episodePanelExitTimer) {
        clearTimeout(this.episodePanelExitTimer);
        this.episodePanelExitTimer = null;
      }
      const panelHost = this.uiRefs?.root;
      if (!panelHost) {
        return;
      }
      const existingPanel = panelHost.querySelector("#episodeSidePanel");
      const shouldAnimateEntry = !existingPanel || existingPanel.classList.contains("is-exiting");
      existingPanel?.remove();
      if (!this.episodePanelVisible) {
        return;
      }
      const panel = document.createElement("div");
      panel.id = "episodeSidePanel";
      panel.className = "player-episode-panel";

      this.syncEpisodePanelSeasonToIndex();
      const seasons = this.getEpisodePanelSeasons();
      const hasSeasonTabs = seasons.length > 1;
      panel.classList.toggle("has-season-tabs", hasSeasonTabs);
      const focusedZone = this.episodePanelFocusZone || "episodes";
      const seasonTabs = hasSeasonTabs
        ? `<div class="player-episode-season-tabs">
              ${seasons
                .map((season, index) => {
                  const selected = Number(season) === Number(this.episodePanelSeason);
                  const focused = focusedZone === "seasons" && selected;
                  return `
                  <button
                    type="button"
                    class="player-episode-season-tab focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                    tabindex="-1"
                    data-episode-season-index="${index}"
                    data-episode-season="${escapeAttribute(season)}"
                  >${escapeHtml(this.getEpisodePanelSeasonLabel(season))}</button>
                `;
                })
                .join("")}
            </div>`
        : "";
      const entries = this.getEpisodePanelEntries();
      const cards = entries
        .map(({ episode, index }) => {
          const selected = index === this.episodePanelIndex;
          const focused = focusedZone === "episodes" && selected;
          const selectedClass = `${selected ? " selected" : ""}${focused ? " focused" : ""}`;
          const current =
            (episode?.id && episode.id === this.params?.videoId) ||
            (Number(episode?.season) === Number(this.params?.season) && Number(episode?.episode) === Number(this.params?.episode));
          const code = episodeDisplayCode(episode);
          const thumbnail = episodeThumbnailUrl(episode);
          const date = formatEpisodePanelDate(episode.released);
          return `
            <div class="player-episode-item focusable${selectedClass}" tabindex="-1" data-episode-index="${index}">
              <div class="player-episode-thumb-wrap">
                ${thumbnail ? `<img class="player-episode-thumb" src="${escapeAttribute(thumbnail)}" alt="" />` : `<div class="player-episode-thumb-fallback"></div>`}
                ${code ? `<div class="player-episode-code">${escapeHtml(code)}</div>` : ""}
                ${current ? `<div class="player-episode-current">&#10003;</div>` : ""}
              </div>
              <div class="player-episode-copy">
                <div class="player-episode-item-title" dir="${contentTextDirection(episode.title || t("episodes_episode", {}, "Episode"))}">${escapeHtml(episode.title || t("episodes_episode", {}, "Episode"))}</div>
                ${date ? `<div class="player-episode-date">${escapeHtml(date)}</div>` : ""}
                <div class="player-episode-item-subtitle" dir="${contentTextDirection(episode.overview || "")}">${escapeHtml(episode.overview || "")}</div>
              </div>
            </div>
          `;
        })
        .join("");

      const isStreamsView = this.episodePanelMode === "streams";
      const streamFocus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
      panel.innerHTML = `
          <div class="player-episode-panel-header">
            <div class="player-episode-panel-title">${escapeHtml(isStreamsView ? t("episodes_panel_streams_title", {}, "Streams") : t("episodes_panel_title", {}, "Episodes"))}</div>
            <button type="button" class="player-episode-close-btn focusable${isStreamsView ? (streamFocus.zone === "close" ? " focused" : "") : focusedZone === "close" ? " focused" : ""}" tabindex="-1" data-episode-action="close">
              ${escapeHtml(t("episodes_panel_close", {}, "Close"))}
            </button>
          </div>
          ${
            isStreamsView
              ? this.renderEpisodeStreamsView()
              : `${seasonTabs}
                 <div class="player-episode-list">${cards}</div>`
          }
        `;
      panelHost.appendChild(panel);
      if (shouldAnimateEntry) {
        panel.classList.add("is-entering");
        const finishEntry = () => {
          panel.classList.remove("is-entering");
          this.scrollEpisodePanelIntoView();
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => requestAnimationFrame(finishEntry));
        } else {
          setTimeout(finishEntry, 32);
        }
        return;
      }
      this.scrollEpisodePanelIntoView();
    },
    hideEpisodePanel() {
      streamRepository.setLocalPluginSearchPaused(true);
      this.episodePanelVisible = false;
      this.episodePanelStreamLoadToken = Number(this.episodePanelStreamLoadToken || 0) + 1;
      const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
      panel?.classList.add("is-exiting");
      if (this.episodePanelExitTimer) {
        clearTimeout(this.episodePanelExitTimer);
      }
      this.episodePanelExitTimer = setTimeout(() => {
        panel?.remove();
        this.episodePanelExitTimer = null;
      }, EPISODE_PANEL_TRANSITION_MS);
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    async playEpisodeFromPanel(selectedStream = null) {
      if (this.switchingEpisode || !this.episodes.length) {
        return;
      }
      const selected = this.episodes[this.episodePanelIndex];
      if (!selected?.id) {
        return;
      }
      streamRepository.setLocalPluginSearchPaused(true);
      if (!selectedStream && this.episodePanelMode !== "streams") {
        await this.openEpisodeStreamsView();
        return;
      }
      this.switchingEpisode = true;
      try {
        const itemType = this.params?.itemType || "series";
        const streamItems = selectedStream
          ? this.episodePanelStreams
          : await this.getPlayableStreamsForVideo(selected.id, itemType, {
              season: selected.season,
              episode: selected.episode
            });
        if (!streamItems.length) {
          return;
        }
        const bestStreamCandidate = selectedStream || this.selectBestStreamCandidate(streamItems) || streamItems[0];
        const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
        const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
        await PlayerController.flushCurrentProgress({ allowCloudSync: false });
        void PlayerController.pushProgressIfDue?.(true);
        this.releaseCurrentEngineFsStreamBestEffort("episode-change", {
          removeTorrent: true,
          deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
        });
        await Router.navigate(
          "player",
          {
            streamUrl: bestStream,
            itemId: this.params?.itemId,
            itemType,
            imdbId: this.params?.imdbId || null,
            tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
            traktId: this.params?.traktId || this.params?.trakt_id || null,
            contentLanguage: this.contentLanguage || null,
            videoId: selected.id,
            season: selected.season ?? null,
            episode: selected.episode ?? null,
            episodeLabel: `S${selected.season}E${selected.episode}`,
            playerTitle: this.params?.playerTitle || this.params?.itemId,
            playerReleaseYear: this.params?.playerReleaseYear || this.params?.year || "",
            playerSubtitle: `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
            playerBackdropUrl: this.params?.playerBackdropUrl || null,
            playerLogoUrl: this.params?.playerLogoUrl || null,
            episodes: this.episodes,
            streamCandidates: streamItems,
            preferredStreamId: bestStreamCandidate.id || null,
            playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
            returnToStreamOnBack: false,
            returnHomeOnBack: this.buildDetailRouteParamsFromPlayer().returnHomeOnBack,
            nextEpisodeVideoId: nextEpisode?.id || null,
            nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
            nextEpisodeSeason: nextEpisode?.season ?? null,
            nextEpisodeEpisode: nextEpisode?.episode ?? null,
            nextEpisodeTitle: nextEpisode?.title || "",
            nextEpisodeReleased: nextEpisode?.released || ""
          },
          {
            replaceHistory: true
          }
        );
      } finally {
        this.switchingEpisode = false;
      }
    }
  };
}
