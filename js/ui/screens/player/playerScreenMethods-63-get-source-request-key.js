/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods63() {
  const {
    ensureWebOsImageProxyReady,
    preloadAddonLogoImages,
    streamRepository,
    StreamBadgeSettingsStore,
    Environment,
    contentTextDirection,
    t,
    normalizeItemType,
    escapeHtml,
    escapeAttribute,
    getPlayerSourceLogoDisplayUrl,
    renderPlayerSourceBadges,
    resolvePlayerSourceBadgePlacement,
    flattenStreamGroups,
    mergeStreamItems,
    streamMergeKey
  } = internals;

  return {
    getSourceRequestKey() {
      const type = normalizeItemType(this.params?.itemType || "movie");
      const videoId = String(this.params?.videoId || this.params?.itemId || "").trim();
      if (!videoId) {
        return "";
      }
      return [type, videoId, this.params?.season ?? "", this.params?.episode ?? ""].join("|");
    },
    cancelSourceLoad() {
      this.sourceLoadAbortController?.abort?.();
      this.sourceLoadAbortController = null;
      this.sourceLoadToken = Number(this.sourceLoadToken || 0) + 1;
      this.sourcesLoading = false;
    },
    closeSourcesPanel() {
      this.cancelSourceLoad();
      streamRepository.setLocalPluginSearchPaused(true);
      this.sourcesPanelVisible = false;
      this.sourcesLastNavigationRepeatAt = 0;
      this.sourcesError = "";
      this.renderSourcesPanel();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    async reloadSources({ forceRefresh = false } = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      if (this.sourcesLoading) {
        return;
      }

      const type = normalizeItemType(this.params?.itemType || "movie");
      const videoId = String(this.params?.videoId || this.params?.itemId || "");
      if (!videoId) {
        return;
      }
      const sourceRequestKey = this.getSourceRequestKey();

      const token = this.sourceLoadToken + 1;
      this.sourceLoadToken = token;
      const loadAbortController = typeof AbortController === "function" ? new AbortController() : null;
      this.sourceLoadAbortController = loadAbortController;
      this.sourcesLoading = true;
      this.sourcesError = "";
      this.renderSourcesPanel();

      const options = {
        itemId: String(this.params?.itemId || ""),
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null,
        forceRefresh,
        signal: loadAbortController?.signal || null,
        onChunk: (chunkResult) => {
          if (token !== this.sourceLoadToken) {
            return;
          }
          const chunkItems = flattenStreamGroups(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
          this.scheduleSourcesPanelRender();
          void this.preloadPlayerSourceLogos(chunkItems);
        }
      };

      try {
        const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
        if (token !== this.sourceLoadToken) {
          return;
        }
        const merged = mergeStreamItems(this.streamCandidates, flattenStreamGroups(result));
        if (merged.length) {
          this.streamCandidates = merged;
        }
      } catch (error) {
        if (token === this.sourceLoadToken) {
          this.sourcesError = this.formatPlaybackErrorForSources(t("panel_failed_load_streams", {}, "Failed to load streams"), {
            error,
            streamCandidate: this.getCurrentStreamCandidate(),
            playbackUrl: this.activePlaybackUrl,
            reason: "reload-sources"
          });
        }
      } finally {
        if (this.sourceLoadAbortController === loadAbortController) {
          this.sourceLoadAbortController = null;
        }
        if (token === this.sourceLoadToken) {
          this.completedSourceRequestKey = sourceRequestKey;
          this.sourcesLoading = false;
          this.renderSourcesPanel();
          void this.preloadPlayerSourceLogos();
        }
      }
    },
    async preloadPlayerSourceLogos(streams = this.getFilteredSources()) {
      if (StreamBadgeSettingsStore.snapshot().showAddonLogo !== true || !Environment.isWebOS()) {
        return;
      }
      try {
        await ensureWebOsImageProxyReady();
        await preloadAddonLogoImages(streams || []);
        this.scheduleSourceLogoRender();
      } catch (_) {
        // Logo cache warmup is best-effort; stream cards still render without logos.
      }
    },
    scheduleSourceLogoRender() {
      if (this.sourceLogoRenderTimer) {
        return;
      }
      this.sourceLogoRenderTimer = setTimeout(() => {
        this.sourceLogoRenderTimer = null;
        if (this.sourcesPanelVisible) {
          this.renderSourcesPanel();
        }
        if (this.episodePanelVisible) {
          this.renderEpisodePanel();
        }
      }, 120);
    },
    scrollSourcesCardIntoView(target, padding = 12) {
      const list = target?.closest?.(".player-sources-list");
      if (!list || typeof list.getBoundingClientRect !== "function" || typeof target?.getBoundingClientRect !== "function") {
        return;
      }

      // Keep scrolling inside the source list. Native scrollIntoView() can pick
      // the wrong ancestor on old Chromium after a full panel DOM replacement,
      // leaving virtual focus on one card while the list runs to its end.
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.top < listRect.top + padding) {
        list.scrollTop -= listRect.top + padding - targetRect.top;
      } else if (targetRect.bottom > listRect.bottom - padding) {
        list.scrollTop += targetRect.bottom - (listRect.bottom - padding);
      }
    },
    renderSourcesPanel() {
      this.cancelScheduledSourcesPanelRender();
      const panel = this.uiRefs?.sourcesPanel;
      if (!panel) {
        return;
      }

      panel.classList.toggle("hidden", !this.sourcesPanelVisible);
      if (!this.sourcesPanelVisible) {
        if (this.renderedSourcesMarkup !== null || panel.childNodes.length) {
          panel.innerHTML = "";
        }
        this.renderedSourcesMarkup = null;
        return;
      }

      const orderedSources = this.getOrderedStreamCandidates();
      const filters = this.getSourceFilters(orderedSources);
      const filtered = this.getFilteredSources(orderedSources);
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      const showAddonLogo = badgeSettings.showAddonLogo === true;
      const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
      // Keep the focused source by key: a chunk that inserts a source at the top must not
      // move the selection to another stream.
      if (this.sourcesFocus?.zone === "list" && this.sourcesFocus.key) {
        const keyedIndex = filtered.findIndex((stream) => streamMergeKey(stream) === this.sourcesFocus.key);
        if (keyedIndex >= 0) {
          this.sourcesFocus = { ...this.sourcesFocus, index: keyedIndex };
        }
      }
      this.ensureSourcesFocus(filters, filtered);

      const nextMarkup = `
          <div class="player-sources-header">
            <div class="player-sources-title">${escapeHtml(t("sources_title", {}, "Sources"))}</div>
            <div class="player-sources-actions">
              <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload" data-sources-zone="top" data-sources-index="0">${escapeHtml(t("sources_reload", {}, "Reload"))}</button>
              <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close" data-sources-zone="top" data-sources-index="1">${escapeHtml(t("sources_close", {}, "Close"))}</button>
            </div>
          </div>

          <div class="player-source-current-meta">
            ${escapeHtml(
              this.params?.season != null && this.params?.episode != null
                ? `S${this.params.season} E${this.params.episode}${this.params.playerSubtitle ? ` • ${this.params.playerSubtitle}` : ""}`
                : this.params?.playerTitle || this.params?.itemId || ""
            )}
          </div>

          <div class="player-sources-filters">
            ${filters
              .map((filter, index) => {
                const selected = this.sourceFilter === filter;
                const focused = this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
                return `
                <div class="player-sources-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}" data-sources-zone="filter" data-sources-index="${index}">
                  ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
                </div>
              `;
              })
              .join("")}
          </div>

          <div class="player-sources-list">
            ${
              this.sourcesLoading && !filtered.length
                ? `<div class="player-sources-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>`
                : ""
            }
            ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
            ${
              !this.sourcesLoading && !filtered.length && !this.sourcesError
                ? `<div class="player-sources-empty">${escapeHtml(t("sources_no_streams", {}, "No streams found"))}</div>`
                : filtered
                    .map((stream, index) => {
                      const focused = this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
                      const isCurrent = this.streamCandidates[this.currentStreamIndex]?.url === stream.url;
                      const badges = renderPlayerSourceBadges(stream, badgeSettings);
                      const topBadges = badgePlacement === "TOP" ? badges : "";
                      const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
                      const addonLogoUrl = showAddonLogo
                        ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () => this.scheduleSourceLogoRender())
                        : "";
                      const playingMarker = isCurrent
                        ? `<div class="player-source-playing">${escapeHtml(t("sources_playing", {}, "Playing"))}</div>`
                        : "";
                      const sourceLabel = stream.label || "Stream";
                      const sourceDescription = stream.description || stream.addonName || "";
                      const sourceAddonName = stream.addonName || t("nav_addons", {}, "Addon");
                      const sourceTitle = `<div class="player-source-title" dir="${contentTextDirection(sourceLabel)}">${escapeHtml(sourceLabel)}</div>`;
                      const mainTitle =
                        !showAddonLogo && playingMarker
                          ? `<div class="player-source-title-row">${sourceTitle}${playingMarker}</div>`
                          : sourceTitle;
                      const sourceSide = showAddonLogo
                        ? `<div class="player-source-side">
                      ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                      <div class="player-source-addon" dir="${contentTextDirection(sourceAddonName)}">${escapeHtml(sourceAddonName)}</div>
                      ${playingMarker}
                    </div>`
                        : "";
                      return `
                  <article class="player-source-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}${isCurrent ? " selected" : ""}" data-sources-zone="list" data-sources-index="${index}">
                    <div class="player-source-main">
                      ${topBadges}
                      ${mainTitle}
                      <div class="player-source-desc" dir="${contentTextDirection(sourceDescription)}">${escapeHtml(sourceDescription)}</div>
                      ${bottomBadges}
                    </div>
                    ${sourceSide}
                  </article>
                `;
                    })
                    .join("")
            }
            ${
              this.sourcesLoading && filtered.length
                ? `<div class="player-sources-empty player-sources-loading-more">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>`
                : ""
            }
          </div>
        `;

      // Addon responses and logo hydration can request several renders in one
      // frame. Retain the exact generated markup when nothing visible changed so
      // TV browsers do not repeatedly parse/layout/paint every source card.
      const panelMounted = Boolean(panel.querySelector(".player-sources-header"));
      const markupUnchanged = panelMounted && this.renderedSourcesMarkup === nextMarkup;
      if (!markupUnchanged) {
        panel.innerHTML = nextMarkup;
        this.renderedSourcesMarkup = nextMarkup;
      }

      const focusedCard = panel.querySelector(".player-source-card.focused");
      if (focusedCard) {
        this.scrollSourcesCardIntoView(focusedCard);
      }
    },
    syncSourcesFocusDom() {
      const panel = this.uiRefs?.sourcesPanel;
      if (!panel || !this.sourcesPanelVisible) {
        return;
      }

      const zone = String(this.sourcesFocus?.zone || "filter");
      const index = Number(this.sourcesFocus?.index || 0);
      if (zone === "list") {
        const focusedStream = this.getFilteredSources(this.getOrderedStreamCandidates())[index];
        if (focusedStream) {
          this.sourcesFocus.key = streamMergeKey(focusedStream);
        }
      }
      const focusedNode = panel.querySelector(`[data-sources-zone="${zone}"][data-sources-index="${index}"]`);
      // Source/filter data can change asynchronously while the panel is open.
      // If the live DOM no longer represents the state, retain the existing full
      // render path so content and focus cannot become misaligned.
      if (!focusedNode) {
        this.renderSourcesPanel();
        return;
      }

      panel.querySelectorAll("[data-sources-zone].focused").forEach((node) => {
        if (node !== focusedNode) {
          node.classList.remove("focused");
        }
      });
      focusedNode.classList.add("focused");
      if (focusedNode.classList.contains("player-source-card")) {
        this.scrollSourcesCardIntoView(focusedNode);
      }
    }
  };
}
