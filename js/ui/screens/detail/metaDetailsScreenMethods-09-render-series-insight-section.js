/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods09() {
  const {
    contentTextDirection,
    EPISODE_VIRTUALIZATION_THRESHOLD,
    EPISODE_VIRTUALIZATION_MIN_WINDOW,
    EPISODE_VIRTUALIZATION_OVERSCAN,
    EPISODE_VIRTUALIZATION_DEFAULT_CARD_WIDTH,
    EPISODE_VIRTUALIZATION_DEFAULT_GAP,
    t,
    detailImageLoadingMode,
    ratingToneClass,
    escapeHtml,
    escapeAttribute,
    resolveTrailerItems
  } = internals;

  return {
    renderSeriesInsightSection() {
      const trailerItems = resolveTrailerItems(this.meta);
      const tabItems = [
        ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
        ["ratings", t("detail.ratings", {}, "Ratings")],
        ...(this.moreLikeThisItems.length ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]] : []),
        ...(trailerItems.length ? [["trailer", t("detail_tab_trailer", {}, "Trailer")]] : []),
        ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
      ];
      const tabs = tabItems.length > 1 ? this.renderPeopleTabs("series", this.seriesInsightTab, tabItems) : "";
      return `
          <section class="series-insight-section is-switching">
            ${tabs}
            ${
              this.seriesInsightTab === "ratings"
                ? this.renderSeriesRatingsPanel()
                : this.seriesInsightTab === "collection"
                  ? this.renderPreviewRail(this.collectionItems, "series", "collection:series")
                  : this.seriesInsightTab === "morelike"
                    ? `${this.renderPreviewRail(this.moreLikeThisItems, "series", "morelike:series")}${this.renderMoreLikeThisAttribution()}`
                    : this.seriesInsightTab === "trailer"
                      ? this.renderTrailerRail(trailerItems, "series")
                      : this.renderSeriesCastTrack("series")
            }
          </section>
        `;
    },
    renderMoreLikeThisAttribution() {
      if (!this.moreLikeThisSource) return "";
      const provider = this.moreLikeThisSource === "trakt" ? "Trakt" : "TMDB";
      return `<p class="detail-more-like-source">Related titles provided by ${provider}.</p>`;
    },
    renderPeopleTabs(kind, activeTab, items = []) {
      const normalized = items.filter(([, label]) => Boolean(label));
      return `
          <div class="series-insight-tabs" data-scroll-key="people-tabs:${kind}">
            ${normalized
              .map(
                ([tab, label], index) => `
              ${index > 0 ? '<span class="series-insight-divider">|</span>' : ""}
              <button class="series-insight-tab focusable${activeTab === tab ? " selected" : ""}"
                      data-action="${kind === "series" ? "setSeriesInsightTab" : "setMovieInsightTab"}"
                      data-tab="${tab}">${escapeHtml(label)}</button>
            `
              )
              .join("")}
          </div>
        `;
    },
    renderSeriesCastTrack(kind = "series") {
      if (!Array.isArray(this.castItems) || !this.castItems.length) {
        return `<div class="series-insight-empty">No cast information.</div>`;
      }
      const className = kind === "movie" ? "movie-cast-track" : "series-cast-track";
      const cards = this.castItems
        .slice(0, 18)
        .map((person) => {
          const name = String(person.name || "").trim();
          const initial = name.charAt(0).toUpperCase() || "?";
          const photo = String(person.photo || "").trim();
          return `
          <article class="movie-cast-card focusable series-cast-card"
                   data-action="openCastDetail"
                   data-cast-id="${person.tmdbId || ""}"
                   data-cast-key="${escapeHtml(String(person.tmdbId || `${name}:${person.character || ""}`))}"
                   data-cast-name="${escapeHtml(name)}"
                   data-cast-role="${escapeHtml(person.character || "")}"
                   data-cast-photo="${escapeHtml(photo)}">
            <div class="movie-cast-avatar">
              <span class="movie-cast-avatar-fallback" aria-hidden="true">${escapeHtml(initial)}</span>
              ${
                photo
                  ? `<img class="movie-cast-avatar-image" src="${escapeAttribute(photo)}" alt="${escapeAttribute(name || "Cast")}" loading="${detailImageLoadingMode()}" decoding="async" onerror="this.hidden=true" />`
                  : ""
              }
            </div>
            <div class="movie-cast-name" dir="${contentTextDirection(name)}">${escapeHtml(name)}</div>
            <div class="movie-cast-role">${escapeHtml(person.character || "")}</div>
          </article>
        `;
        })
        .join("");
      return `<div class="${className}" data-scroll-key="cast:${kind}">${cards}</div>`;
    },
    renderSeriesRatingsPanel() {
      const seasonKeys = Object.keys(this.seriesRatingsBySeason || {})
        .map((key) => Number(key))
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      if (!seasonKeys.length) {
        return `<div class="series-insight-empty">${escapeHtml(t("detail.ratingsNotAvailable", {}, "Ratings not available."))}</div>`;
      }
      if (!seasonKeys.includes(Number(this.selectedRatingSeason))) {
        this.selectedRatingSeason = seasonKeys[0];
      }
      const ratings = this.seriesRatingsBySeason?.[this.selectedRatingSeason] || [];
      const seasonButtons = seasonKeys
        .map(
          (season) => `
          <button class="series-rating-season focusable${season === this.selectedRatingSeason ? " selected" : ""}"
                  data-action="selectRatingSeason"
                  data-season="${season}">S${season}</button>
        `
        )
        .join("");
      const chips = ratings.length
        ? ratings
            .map(
              (entry) => `
              <div class="series-episode-rating-chip focusable ${ratingToneClass(entry.rating)}"
                   data-rating-episode="${Number(entry.episode || 0)}">
                <span class="series-episode-rating-ep">E${entry.episode}</span>
                <span class="series-episode-rating-val">${entry.rating != null ? String(entry.rating).replace(".", ".") : "-"}</span>
              </div>
            `
            )
            .join("")
        : `<div class="series-insight-empty">${escapeHtml(t("detail.noEpisodeRatings", {}, "No episode ratings in this season."))}</div>`;
      return `
          <div class="series-rating-seasons" data-scroll-key="rating-seasons">${seasonButtons}</div>
          <div class="series-rating-summary">${escapeHtml(t("detail.seasonSummary", { season: this.selectedRatingSeason, count: ratings.length }, "Season {{season}} • {{count}} episodes"))}</div>
          <div class="series-episode-ratings-grid" data-scroll-key="rating-chips:${this.selectedRatingSeason}">${chips}</div>
        `;
    },
    renderSeasonButtons() {
      if (!this.episodes?.length) {
        return `<p>${escapeHtml(t("detail.noEpisodesFound", {}, "No episodes found."))}</p>`;
      }
      const seasons = this.getAvailableSeasons();
      return seasons
        .map(
          (season) => `
          <button class="series-season-btn focusable${season === this.selectedSeason ? " selected" : ""}"
                  data-action="selectSeason"
                  data-season="${season}">
            ${escapeHtml(season === 0 ? t("episodes_specials", {}, "Specials") : t("detail.seasonLabel", { season }, "Season {{season}}"))}
          </button>
          `
        )
        .join("");
    },
    selectSeason(season) {
      const nextSeason = Number(season);
      if (!Number.isFinite(nextSeason) || nextSeason < 0) {
        return false;
      }
      if (nextSeason === Number(this.selectedSeason || 0)) {
        return true;
      }
      this.hasManualSeasonSelection = true;
      this.selectedSeason = nextSeason;
      const focusRestore = { selector: `.series-season-btn[data-season="${nextSeason}"]` };
      if (!this.container?.querySelector(".series-detail-shell")) {
        this.render(this.meta, focusRestore);
        return true;
      }

      const seasonMount = this.container.querySelector("#detailSeasonRowMount");
      if (seasonMount && !this.syncRenderedSeasonButtons()) {
        seasonMount.innerHTML = `<div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>`;
      }
      if (!this.refreshEpisodeTrack(focusRestore, this.getRememberedEpisodeIndex())) {
        this.render(this.meta, focusRestore);
      }
      return true;
    },
    getSelectedSeasonEpisodes() {
      return this.getSelectedSeasonEpisodeState().episodes;
    },
    getSelectedSeasonEpisodeState() {
      const allEpisodes = Array.isArray(this.episodes) ? this.episodes : [];
      const season = Number(this.selectedSeason || 0);
      const cachedState = this.selectedSeasonEpisodeState;
      if (cachedState?.source === allEpisodes && cachedState.season === season) {
        return cachedState;
      }
      const seasonEpisodes = [];
      const indexByVideoId = new Map();
      const seenVideoIds = new Set();
      for (const episode of allEpisodes) {
        if (Number(episode?.season || 0) !== season) {
          continue;
        }
        const videoId = String(episode?.id || "").trim();
        if (!videoId || seenVideoIds.has(videoId)) {
          continue;
        }
        seenVideoIds.add(videoId);
        const absoluteIndex = seasonEpisodes.length;
        seasonEpisodes.push(episode);
        indexByVideoId.set(videoId, absoluteIndex);
      }
      this.selectedSeasonEpisodeState = {
        source: allEpisodes,
        season,
        episodes: seasonEpisodes,
        indexByVideoId
      };
      return this.selectedSeasonEpisodeState;
    },
    getEpisodeIndexByVideoId(videoId) {
      const wanted = String(videoId || "").trim();
      if (!wanted) {
        return -1;
      }
      return this.getSelectedSeasonEpisodeState().indexByVideoId.get(wanted) ?? -1;
    },
    getEpisodeTrackElement() {
      return this.container?.querySelector(".series-episode-track") || null;
    },
    getFocusedEpisodeCard() {
      const target = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
      return target instanceof HTMLElement ? target : null;
    },
    getEpisodeAbsoluteIndex(node) {
      if (!(node instanceof HTMLElement)) {
        return -1;
      }
      const explicitIndex = Number(node.dataset.episodeIndex || -1);
      if (Number.isFinite(explicitIndex) && explicitIndex >= 0) {
        return explicitIndex;
      }
      return this.getEpisodeIndexByVideoId(String(node.dataset.videoId || ""));
    },
    measureEpisodeTrackMetrics(track = null) {
      const target = track instanceof HTMLElement ? track : this.getEpisodeTrackElement();
      const season = Number(this.selectedSeason || 0);
      const viewportWidth = Number(target?.clientWidth || 0);
      const cachedMetrics = this.episodeVirtualMetrics;
      if (
        cachedMetrics &&
        cachedMetrics.season === season &&
        cachedMetrics.viewportWidth === viewportWidth &&
        cachedMetrics.cardWidth > 0 &&
        cachedMetrics.stride > 0
      ) {
        return cachedMetrics;
      }
      const sampleCard = target?.querySelector?.(".series-episode-card") || null;
      const sampleWindow = target?.querySelector?.(".series-episode-track-window") || target;
      const trackStyle = target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
      const windowStyle = sampleWindow && typeof getComputedStyle === "function" ? getComputedStyle(sampleWindow) : null;
      const rawGap = Number.parseFloat(windowStyle?.gap || windowStyle?.columnGap || trackStyle?.gap || trackStyle?.columnGap || "0");
      const gap = Number.isFinite(rawGap) && rawGap >= 0 ? rawGap : EPISODE_VIRTUALIZATION_DEFAULT_GAP;
      const measuredWidth = Number(sampleCard?.getBoundingClientRect?.().width || 0);
      const cardWidth = measuredWidth > 0 ? measuredWidth : cachedMetrics?.cardWidth || EPISODE_VIRTUALIZATION_DEFAULT_CARD_WIDTH;
      const stride = Math.max(1, cardWidth + gap);
      this.episodeVirtualMetrics = {
        season,
        cardWidth,
        gap,
        stride,
        viewportWidth
      };
      return this.episodeVirtualMetrics;
    },
    getEpisodeVirtualWindowState(episodes = this.getSelectedSeasonEpisodes(), preferredIndex = null) {
      const list = Array.isArray(episodes) ? episodes : [];
      const total = list.length;
      if (!total) {
        return null;
      }
      const virtualized = total > EPISODE_VIRTUALIZATION_THRESHOLD;
      const metrics = this.measureEpisodeTrackMetrics();
      if (!virtualized) {
        return {
          season: Number(this.selectedSeason || 0),
          virtualized: false,
          start: 0,
          end: total - 1,
          cardWidth: metrics.cardWidth,
          gap: metrics.gap,
          stride: metrics.stride,
          leftSpacer: 0,
          rightSpacer: 0,
          preferredIndex: Number.isFinite(preferredIndex) ? preferredIndex : null
        };
      }

      const visibleEstimate = Math.ceil(Math.max(1, metrics.viewportWidth || 0) / Math.max(1, metrics.stride || 1));
      // Tizen fast path: crossing the window edge rebuilds the whole track
      // (innerHTML + focus restore). On constrained runtimes render a wider
      // window up front — static cards are cheap, rebuilds are not.
      let windowOverscan = EPISODE_VIRTUALIZATION_OVERSCAN;
      try {
        if (
          (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) ||
          globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
          globalThis?.document?.documentElement?.classList?.contains("legacy-tizen")
        ) {
          windowOverscan = EPISODE_VIRTUALIZATION_OVERSCAN * 2;
        }
      } catch (_) {}
      const windowSize = Math.min(total, Math.max(EPISODE_VIRTUALIZATION_MIN_WINDOW, visibleEstimate + windowOverscan * 2));
      const maxStart = Math.max(0, total - windowSize);
      const currentTrack = this.getEpisodeTrackElement();
      const currentScrollLeft = Number(currentTrack?.scrollLeft || 0);
      const baseIndex = Number.isFinite(preferredIndex) ? preferredIndex : Math.floor(currentScrollLeft / Math.max(1, metrics.stride || 1));
      const start = Math.max(0, Math.min(maxStart, baseIndex - EPISODE_VIRTUALIZATION_OVERSCAN));
      const end = Math.min(total - 1, start + windowSize - 1);
      return {
        season: Number(this.selectedSeason || 0),
        virtualized: true,
        start,
        end,
        cardWidth: metrics.cardWidth,
        gap: metrics.gap,
        stride: metrics.stride,
        leftSpacer: start * metrics.stride,
        rightSpacer: Math.max(0, (total - end - 1) * metrics.stride),
        preferredIndex: Number.isFinite(preferredIndex) ? preferredIndex : null
      };
    }
  };
}
