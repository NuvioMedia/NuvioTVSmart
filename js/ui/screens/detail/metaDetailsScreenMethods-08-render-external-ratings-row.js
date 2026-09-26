/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods08() {
  const {
    ScreenUtils,
    LayoutPreferences,
    showHomeRatings,
    mdbListRatingIcon,
    renderLoadingIndicator,
    EPISODE_VIRTUALIZATION_THRESHOLD,
    t,
    isRtlDetailLocale,
    resolveDetailBackdropUrl,
    isSeriesDetailMeta,
    formatMdbListRating,
    resolveImdbRating,
    getAddonIconPath,
    escapeHtml,
    escapeAttribute,
    resolveTrailerItems,
    captureHorizontalScrollMap
  } = internals;

  return {
    renderExternalRatingsRow(meta = {}) {
      const ratings = meta?.mdbListRatings || {};
      const items = [
        ["trakt", getAddonIconPath("trakt"), ratings.trakt],
        ["imdb", "assets/icons/imdb_logo_2016.svg", ratings.imdb],
        ["tmdb", "assets/icons/mdblist_tmdb.svg", ratings.tmdb],
        ["letterboxd", "assets/icons/mdblist_letterboxd.svg", ratings.letterboxd],
        ["tomatoes", mdbListRatingIcon("tomatoes", ratings.tomatoes, ratings), ratings.tomatoes],
        ["audience", mdbListRatingIcon("audience", ratings.audience, ratings), ratings.audience],
        ["metacritic", "assets/icons/mdblist_metacritic.png", ratings.metacritic]
      ].filter(([, , value]) => value != null && String(value).trim() !== "");
      if (!items.length) {
        return "";
      }
      return `
          <div class="detail-ratings-row">
            ${items
              .map(
                ([label, icon, value]) => `
              <span class="detail-rating-item">
                <img src="${icon}" alt="${escapeHtml(label)}" />
                <span>${escapeHtml(formatMdbListRating(label, value))}</span>
              </span>
            `
              )
              .join("")}
          </div>
        `;
    },
    renderCompanySections(meta = {}) {
      const production = this.renderCompanyLogosSection(
        meta.productionCompanies || meta.production_companies || [],
        t("detail.productionCompanies", {}, "Production"),
        "company"
      );
      const networks = this.renderCompanyLogosSection(meta.networks || [], t("detail.networks", {}, "Network"), "network");
      if (meta.type === "series" || meta.type === "tv") {
        return `${networks}${production}`;
      }
      return `${production}${networks}`;
    },
    renderDefaultLayout(meta, streamItems) {
      const isSeries = isSeriesDetailMeta(meta, this.episodes);
      const seasonButtons = this.renderSeasonButtons();
      const episodeCards = this.renderEpisodeCards();
      const castCards = this.renderCastCards();
      const moreLikeCards = this.renderMoreLikeCards();

      this.container.innerHTML = `
          <div class="row">
            <h2>${meta.name || "Untitled"}</h2>
            <p>${meta.description || t("detail.noDescription", {}, "No description.")}</p>
            <p style="opacity:0.8;">Type: ${meta.type || "unknown"} | Id: ${meta.id || "-"}</p>
          </div>
          <div class="row">
            <div class="card focusable" data-action="playDefault">${isSeries ? t("detail.playNextEpisode", {}, "Play Next Episode") : t("detail.play", {}, "Play")}</div>
            <div class="card focusable" data-action="toggleLibrary">${this.isSavedInLibrary ? t("detail.removeFromLibrary", {}, "Remove from Library") : t("detail.addToLibrary", {}, "Add to Library")}</div>
            <div class="card focusable" data-action="toggleWatched">${this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched")}</div>
            <div class="card focusable" data-action="openSearch">${t("detail.searchSimilar", {}, "Search Similar")}</div>
            <div class="card focusable" data-action="goBack">${t("common.back", {}, "Back")}</div>
          </div>
          ${
            isSeries
              ? `
          <div class="row">
            <h3>${t("detail.seasons", {}, "Seasons")}</h3>
            <div id="detailSeasons">${seasonButtons}</div>
          </div>
          <div class="row">
            <h3>${t("detail.episodes", {}, "Episodes")}</h3>
            <div id="detailEpisodes">${episodeCards}</div>
          </div>
          `
              : ""
          }
          ${
            castCards
              ? `
          <div class="row">
            <h3>${t("detail.cast", {}, "Cast")}</h3>
            <div id="detailCast">${castCards}</div>
          </div>
          `
              : ""
          }
          ${
            moreLikeCards
              ? `
          <div class="row">
            <h3>${t("detail.moreLikeThis", {}, "More Like This")}</h3>
            <div id="detailMoreLike">${moreLikeCards}</div>
          </div>
          `
              : ""
          }
          <div class="row">
            <h3>${t("detail.streams", {}, "Streams")} (${streamItems.length})</h3>
            <div id="detailStreams"></div>
          </div>
        `;

      const streamWrap = this.container.querySelector("#detailStreams");
      streamItems.slice(0, 30).forEach((stream, index) => {
        const node = document.createElement("div");
        node.className = "card focusable";
        node.dataset.action = "playStream";
        node.dataset.streamUrl = stream.url;
        node.dataset.streamIndex = String(index);
        node.innerHTML = `
            <div style="font-weight:700;">${stream.label}</div>
            <div style="opacity:0.8;">${stream.addonName}</div>
          `;
        streamWrap.appendChild(node);
      });

      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    renderMovieLayout(meta) {
      const backdrop = resolveDetailBackdropUrl(meta);
      const heroMarkup = this.renderMovieHeroMarkup(meta);
      const detailDirectionClass = isRtlDetailLocale() ? " detail-rtl" : "";
      const insightMarkup = this.renderMovieInsightSection(meta);
      const commentsMarkup = this.renderStandaloneCommentsSection();
      const companyMarkup = this.renderCompanySections(meta);

      this.container.innerHTML = `
          <div class="series-detail-shell movie-detail-shell${detailDirectionClass}${this.getTrailerShellStateClasses()}">
            <div class="series-detail-backdrop" data-backdrop-url="${escapeAttribute(backdrop || "")}"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
            <div class="detail-trailer-layer"></div>
            <div class="detail-trailer-loading-spinner" aria-hidden="true">${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}</div>
            <div class="series-detail-vignette"></div>
            <div class="detail-bottom-shadow"></div>

            <div class="series-detail-content movie-detail-content">
              <div id="detailHeroSection">${heroMarkup}</div>
              <div id="detailInsightSectionMount">${insightMarkup}</div>
              <div id="detailCommentsSectionMount">${commentsMarkup}</div>
              <div id="detailCompanySectionsMount">${companyMarkup}
            </div>
            <div id="movieStreamChooserMount"></div>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      if (!this.pendingFocusRestore) {
        ScreenUtils.setInitialFocus(this.container, ".movie-detail-content .focusable");
      }
      this._detailHeroMarkup = heroMarkup;
      this._detailInsightMarkup = insightMarkup;
      this._detailCommentsMarkup = commentsMarkup;
      this._detailCompanyMarkup = companyMarkup;
      this.bindDetailChrome();
    },
    captureRenderedChromeState() {
      const content = this.getDetailContentScroller();
      this.restoredContentScrollTop = Number(content?.scrollTop || 0);
      this.restoredTrackScrollLeftByKey = captureHorizontalScrollMap(this.container);
    },
    applyDetailBackdrop(meta) {
      const node = this.container?.querySelector(".series-detail-backdrop");
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const desired = resolveDetailBackdropUrl(meta);
      if (node.dataset.backdropUrl === desired) {
        return;
      }
      node.dataset.backdropUrl = desired;
      if (!desired) {
        node.style.backgroundImage = "";
        return;
      }
      const token = this.detailLoadToken;
      const apply = () => {
        if (this.detailLoadToken !== token) {
          return;
        }
        const current = this.container?.querySelector(".series-detail-backdrop");
        if (current instanceof HTMLElement && current.dataset.backdropUrl === desired) {
          current.style.backgroundImage = `url('${desired.replace(/'/g, "%27")}')`;
        }
      };
      if (typeof Image === "function") {
        const preload = new Image();
        preload.onload = apply;
        preload.onerror = apply;
        preload.src = desired;
      } else {
        apply();
      }
    },
    updateRenderedDetailSections(meta, focusRestoreOverride = null) {
      if (!this.container || !meta || !this.container.querySelector(".series-detail-shell")) {
        this.render(meta, focusRestoreOverride || null);
        return;
      }
      this._pendingSectionsMeta = meta;
      if (focusRestoreOverride) {
        this._pendingSectionsFocusRestore = focusRestoreOverride;
      }
      if (this._sectionsUpdateRaf) {
        return;
      }
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
      this._sectionsUpdateRaf = raf(() => {
        this._sectionsUpdateRaf = null;
        const pendingMeta = this._pendingSectionsMeta;
        const pendingFocus = this._pendingSectionsFocusRestore || null;
        this._pendingSectionsMeta = null;
        this._pendingSectionsFocusRestore = null;
        if (pendingMeta) {
          this._renderDetailSectionsNow(pendingMeta, pendingFocus);
        }
      });
    },
    _renderDetailSectionsNow(meta, focusRestoreOverride = null) {
      if (!this.container || !this.container.querySelector(".series-detail-shell")) {
        return;
      }
      const focusRestore = focusRestoreOverride || this.captureDetailFocus();
      this.captureRenderedChromeState();
      const isSeries = isSeriesDetailMeta(meta, this.episodes);
      this.applyDetailBackdrop(meta);

      const heroMount = this.container.querySelector("#detailHeroSection");
      if (heroMount) {
        const heroMarkup = isSeries ? this.renderSeriesHeroMarkup(meta) : this.renderMovieHeroMarkup(meta);
        if (heroMarkup !== this._detailHeroMarkup) {
          heroMount.innerHTML = heroMarkup;
          this._detailHeroMarkup = heroMarkup;
        }
      }

      const seasonMount = this.container.querySelector("#detailSeasonRowMount");
      if (isSeries && seasonMount && !this.syncRenderedSeasonButtons()) {
        seasonMount.innerHTML = `<div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>`;
      }

      const episodeMount = this.container.querySelector("#detailEpisodeTrackMount");
      if (isSeries && episodeMount && !this.syncRenderedEpisodeTrack()) {
        episodeMount.innerHTML = `<div class="series-episode-track${this.getSelectedSeasonEpisodes().length > EPISODE_VIRTUALIZATION_THRESHOLD ? " is-virtualized" : ""}" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards()}</div>`;
      }

      const insightMount = this.container.querySelector("#detailInsightSectionMount");
      if (insightMount) {
        // Tizen fast path: blind re-parses destroy live focus nodes and
        // force full layout per data arrival. Write only on change.
        const insightMarkup = isSeries ? this.renderSeriesInsightSection() : this.renderMovieInsightSection(meta);
        if (insightMarkup !== this._detailInsightMarkup) {
          insightMount.innerHTML = insightMarkup;
          this._detailInsightMarkup = insightMarkup;
        }
      }

      const commentsMount = this.container.querySelector("#detailCommentsSectionMount");
      if (commentsMount) {
        const commentsMarkup = this.renderStandaloneCommentsSection();
        if (commentsMarkup !== this._detailCommentsMarkup) {
          commentsMount.innerHTML = commentsMarkup;
          this._detailCommentsMarkup = commentsMarkup;
        }
      }

      const companyMount = this.container.querySelector("#detailCompanySectionsMount");
      if (companyMount) {
        const companyMarkup = this.renderCompanySections(meta);
        if (companyMarkup !== this._detailCompanyMarkup) {
          companyMount.innerHTML = companyMarkup;
          this._detailCompanyMarkup = companyMarkup;
        }
      }

      ScreenUtils.indexFocusables(this.container);
      this.pendingFocusRestore = focusRestore;
      this.bindDetailChrome();
      this.scheduleEpisodeVirtualizationSync(this.getRememberedEpisodeIndex());
    },
    renderMovieInsightSection(meta) {
      const trailerItems = resolveTrailerItems(meta);
      const showRatings = showHomeRatings(LayoutPreferences.get().homeImdbRatingsVisibility);
      const tabItems = [
        ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
        ...(showRatings ? [["ratings", t("detail.ratings", {}, "Ratings")]] : []),
        ...(this.moreLikeThisItems.length ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]] : []),
        ...(trailerItems.length ? [["trailer", t("detail_tab_trailer", {}, "Trailer")]] : []),
        ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
      ];
      const tabs = tabItems.length > 1 ? this.renderPeopleTabs("movie", this.movieInsightTab, tabItems) : "";
      if (this.movieInsightTab === "ratings" && showRatings) {
        const imdbValue = resolveImdbRating(meta);
        const imdb = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue) : "-";
        const tmdb = Number.isFinite(Number(meta?.tmdbRating)) ? String(meta.tmdbRating) : "-";
        return `
            <section class="series-insight-section">
              ${tabs}
              <div class="movie-ratings-row">
                <article class="movie-rating-card">
                  <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
                  <div class="movie-rating-value">${imdb}</div>
                </article>
                <article class="movie-rating-card">
                  <img src="assets/icons/mdblist_tmdb.svg" alt="TMDB" />
                  <div class="movie-rating-value">${tmdb}</div>
                </article>
              </div>
            </section>
          `;
      }
      if (this.movieInsightTab === "collection") {
        return `
            <section class="series-insight-section">
              ${tabs}
              ${this.renderPreviewRail(this.collectionItems, "movie", "collection:movie")}
            </section>
          `;
      }
      if (this.movieInsightTab === "morelike") {
        return `
            <section class="series-insight-section">
              ${tabs}
              ${this.renderPreviewRail(this.moreLikeThisItems, "movie", "morelike:movie")}
              ${this.renderMoreLikeThisAttribution()}
            </section>
          `;
      }
      if (this.movieInsightTab === "trailer") {
        return `
            <section class="series-insight-section is-switching">
              ${tabs}
              ${this.renderTrailerRail(trailerItems, "movie")}
            </section>
          `;
      }
      return `
          <section class="series-insight-section movie-cast-section is-switching">
            ${tabs}
            ${this.renderSeriesCastTrack("movie")}
          </section>
        `;
    }
  };
}
