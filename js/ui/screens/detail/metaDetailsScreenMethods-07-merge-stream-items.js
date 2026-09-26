/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods07() {
  const {
    ScreenUtils,
    LayoutPreferences,
    showStandardDetailRatings,
    formatHeroRuntime,
    mdbListRepository,
    localizedGenreLabel,
    contentTextDirection,
    renderLoadingIndicator,
    isWatchProgressInProgress,
    EPISODE_VIRTUALIZATION_THRESHOLD,
    t,
    isRtlDetailLocale,
    resolveDetailBackdropUrl,
    detailProgressFraction,
    formatResumeRemaining,
    isSeriesDetailMeta,
    resolvePlayableDetailType,
    metaWithRouteExternalIds,
    renderImdbBadge,
    hasMdbListRatings,
    normalizeGenreList,
    formatMovieReleaseDate,
    resolveImdbRating,
    formatRuntimeMinutes,
    resolveEpisodeRuntimeForSeason,
    renderPlayGlyph,
    renderTrailerGlyph,
    renderLibraryGlyph,
    renderWatchedGlyph,
    escapeHtml,
    escapeAttribute,
    normalizeCountryLabel,
    resolveTrailerSource
  } = internals;

  return {
    mergeStreamItems(existing = [], incoming = []) {
      const byKey = new Set();
      const merged = [];
      const push = (item) => {
        if (!item?.url) {
          return;
        }
        const key = [
          String(item.addonName || "Addon"),
          String(item.url || ""),
          String(item.sourceType || ""),
          String(item.label || "")
        ].join("::");
        if (byKey.has(key)) {
          return;
        }
        byKey.add(key);
        merged.push(item);
      };
      (existing || []).forEach(push);
      (incoming || []).forEach(push);
      return merged;
    },
    render(meta, focusRestore = undefined) {
      if (this._sectionsUpdateRaf) {
        const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
        cancelRaf(this._sectionsUpdateRaf);
        this._sectionsUpdateRaf = null;
        this._pendingSectionsMeta = null;
        this._pendingSectionsFocusRestore = null;
      }
      if (focusRestore !== undefined) {
        this.pendingFocusRestore = focusRestore;
      } else if (!this.pendingFocusRestore) {
        this.pendingFocusRestore = this.captureDetailFocus();
      }
      const isSeries = isSeriesDetailMeta(meta, this.episodes);
      if (isSeries) {
        this.renderSeriesLayout(meta);
        if (this.pendingEpisodeSelection) {
          this.renderEpisodeStreamChooser();
        }
        return;
      }
      this.renderMovieLayout(meta);
      if (this.pendingMovieSelection) {
        this.renderMovieStreamChooser();
      }
    },
    renderSeriesHeroMarkup(meta) {
      const nextEpisodeLabel = this.getSeriesHeroPlayLabel();
      const creditLine =
        Array.isArray(meta.director) && meta.director.length
          ? meta.director.slice(0, 2).join(", ")
          : Array.isArray(meta.writer) && meta.writer.length
            ? meta.writer.slice(0, 2).join(", ")
            : meta.director || meta.writer || "";
      const creditPrefix =
        Array.isArray(meta.director) && meta.director.length ? t("detail.creator", {}, "Creator") : t("detail.writer", {}, "Writer");
      return this.renderHeroSection({
        meta,
        playLabel: nextEpisodeLabel,
        creditLine,
        creditPrefix,
        showWatchedButton: false
      });
    },
    getSeriesHeroPlayLabel() {
      const progress = this.getActiveResumeProgress();
      if (progress) {
        const season = Number(progress.season || this.nextEpisodeToWatch?.season || 0);
        const episode = Number(progress.episode || this.nextEpisodeToWatch?.episode || 0);
        return season >= 0 && episode > 0
          ? t("detail.resumeEpisodeShort", { season, episode }, "Resume S{{season}}E{{episode}}")
          : t("detail.resume", {}, "Resume");
      }
      return this.nextEpisodeToWatch
        ? t(
            "detail.nextEpisodeShort",
            { season: this.nextEpisodeToWatch.season, episode: this.nextEpisodeToWatch.episode },
            "Next S{{season}}E{{episode}}"
          )
        : t("detail.play", {}, "Play");
    },
    getMovieHeroPlayLabel() {
      return this.getActiveResumeProgress() ? t("detail.resume", {}, "Resume") : t("detail.play", {}, "Play");
    },
    renderMovieHeroMarkup(meta) {
      const directorLine = Array.isArray(meta.director) ? meta.director.slice(0, 2).join(", ") : meta.director || "";
      const playableType = resolvePlayableDetailType(this.params?.itemType || meta?.type, meta);
      return this.renderHeroSection({
        meta,
        playLabel: this.getMovieHeroPlayLabel(),
        creditLine: directorLine,
        creditPrefix: t("detail.director", {}, "Director"),
        showWatchedButton: playableType !== "tv"
      });
    },
    getTrailerShellStateClasses() {
      if (!this.isTrailerPlaying) {
        return "";
      }
      const mode = this.trailerPlaybackMode === "autoplay" ? "autoplay" : "manual";
      return ` detail-trailer-active detail-trailer-${mode}${this.trailerVisualReady ? " detail-trailer-ready" : ""}`;
    },
    renderSeriesLayout(meta) {
      const backdrop = resolveDetailBackdropUrl(meta);
      const heroMarkup = this.renderSeriesHeroMarkup(meta);
      const detailDirectionClass = isRtlDetailLocale() ? " detail-rtl" : "";
      if (!this.selectedRatingSeason || !this.seriesRatingsBySeason?.[this.selectedRatingSeason]) {
        this.selectedRatingSeason = this.selectedSeason || this.episodes?.[0]?.season || 1;
      }
      const insightMarkup = this.renderSeriesInsightSection();
      const commentsMarkup = this.renderStandaloneCommentsSection();
      const companyMarkup = this.renderCompanySections(meta);

      this.container.innerHTML = `
          <div class="series-detail-shell${detailDirectionClass}${this.getTrailerShellStateClasses()}">
            <div class="series-detail-backdrop" data-backdrop-url="${escapeAttribute(backdrop || "")}"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
            <div class="detail-trailer-layer"></div>
            <div class="detail-trailer-loading-spinner" aria-hidden="true">${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}</div>
            <div class="series-detail-vignette"></div>
            <div class="detail-bottom-shadow"></div>

            <div class="series-detail-content">
              <div id="detailHeroSection">${heroMarkup}</div>
              <div id="detailSeasonRowMount">
                <div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>
              </div>
              <div id="detailEpisodeTrackMount">
                <div class="series-episode-track${this.getSelectedSeasonEpisodes().length > EPISODE_VIRTUALIZATION_THRESHOLD ? " is-virtualized" : ""}" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards()}</div>
              </div>
              <div id="detailInsightSectionMount">${insightMarkup}</div>
              <div id="detailCommentsSectionMount">${commentsMarkup}</div>
              <div id="detailCompanySectionsMount">${companyMarkup}</div>
            </div>

            <div id="episodeStreamChooserMount"></div>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      if (!this.pendingFocusRestore) {
        ScreenUtils.setInitialFocus(this.container);
      }
      this._detailHeroMarkup = heroMarkup;
      this._detailInsightMarkup = insightMarkup;
      this._detailCommentsMarkup = commentsMarkup;
      this._detailCompanyMarkup = companyMarkup;
      this.bindDetailChrome();
      this.scheduleEpisodeVirtualizationSync(this.getRememberedEpisodeIndex());
    },
    async loadMdbListRatings(meta, token = this.detailLoadToken) {
      const lookupMeta = metaWithRouteExternalIds(meta, this.params);
      const ratingsResult = await mdbListRepository
        .getRatingsForMeta(lookupMeta, this.params?.itemId || "", this.params?.itemType || "movie")
        .catch(() => null);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.meta = {
        ...(this.meta || meta || {}),
        mdbListRatings: ratingsResult?.ratings || null,
        showMdbListImdb: ratingsResult?.hasImdbRating === true
      };
      this.updateRenderedDetailSections(this.meta);
    },
    renderHeroSection({ meta, playLabel, creditLine = "", creditPrefix = "", showWatchedButton = false }) {
      const heroTitle = meta.name || "Untitled";
      const heroDescription = meta.description || t("detail.noDescription", {}, "No description.");
      const logoOrTitle = meta.logo
        ? `<img src="${meta.logo}" class="series-detail-logo" alt="${escapeHtml(meta.name || "logo")}" decoding="async" fetchpriority="high" />`
        : `<h1 class="series-detail-title" dir="${contentTextDirection(heroTitle)}">${escapeHtml(heroTitle)}</h1>`;
      const externalRatings = this.renderExternalRatingsRow(meta);
      const trailerSource = this.trailerSource || resolveTrailerSource(meta);
      const hasTrailerCandidate = Boolean(trailerSource);
      if (!this.trailerSource && trailerSource) {
        this.trailerSource = trailerSource;
      }
      const trailerButtonEnabled = Boolean(LayoutPreferences.get().detailPageTrailerButtonEnabled);
      const trailerButton =
        trailerButtonEnabled && hasTrailerCandidate
          ? `
              <button class="series-circle-btn focusable" data-action="toggleTrailer" aria-label="${escapeAttribute(t("detail.playTrailer", {}, "Play trailer"))}">
                ${renderTrailerGlyph()}
              </button>
            `
          : "";
      return `
          <section class="detail-hero-section">
            <div class="detail-hero-brand">
              ${logoOrTitle}
              <p class="detail-trailer-hint">${escapeHtml(t("detail.pressBackToReturn", {}, "Press back to return to details"))}</p>
            </div>
            <div class="detail-hero-body">
              <div class="series-detail-actions">
                <button class="series-primary-btn focusable" data-action="playDefault">
                  <span class="series-btn-icon">${renderPlayGlyph()}</span>
                  <span>${escapeHtml(playLabel)}</span>
                </button>
                ${this.getActiveResumeProgress() ? `<button class="series-secondary-btn focusable" data-action="playFromBeginning">${escapeHtml(t("detail.playFromBeginning", {}, "Play from Beginning"))}</button>` : ""}
                <button class="series-circle-btn focusable${this.isSavedInLibrary ? " is-library-selected" : ""}" data-action="toggleLibrary">
                  ${renderLibraryGlyph(this.isSavedInLibrary)}
                </button>
                ${showWatchedButton ? `<button class="series-circle-btn focusable${this.isMarkedWatched ? " is-selected" : ""}" data-action="toggleWatched" aria-label="${escapeAttribute(this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched"))}">${renderWatchedGlyph(this.isMarkedWatched)}</button>` : ""}
                ${trailerButton}
              </div>
              ${this.renderResumeIndicator()}
              ${creditLine ? `<p class="series-detail-support">${escapeHtml(creditPrefix)}: ${escapeHtml(creditLine)}</p>` : ""}
              ${externalRatings}
              <p class="series-detail-description" dir="${contentTextDirection(heroDescription)}">${escapeHtml(heroDescription)}</p>
              ${this.renderHeroMetaRows(meta)}
            </div>
          </section>
        `;
    },
    getActiveResumeProgress() {
      const progress = this.resumeProgress || null;
      return progress && isWatchProgressInProgress(progress) ? progress : null;
    },
    renderResumeIndicator() {
      const progress = this.getActiveResumeProgress();
      if (!progress) {
        return "";
      }
      const percent = Math.max(1, Math.min(99, Math.round(detailProgressFraction(progress) * 100)));
      const episodeParts = [];
      const season = Number(progress.season || 0);
      const episode = Number(progress.episode || 0);
      if (season >= 0 && episode > 0) {
        episodeParts.push(`S${season}E${episode}`);
      }
      const title = String(progress.episodeTitle || "").trim();
      if (title) {
        episodeParts.push(title);
      }
      const episodeText = episodeParts.join(" - ");
      const remaining = formatResumeRemaining(progress);
      const parts = [
        t("detail.resumeAvailable", {}, "Resume available"),
        `${percent}%`,
        episodeText ? t("detail.currentEpisode", { episode: episodeText }, "Episode {{episode}}") : "",
        remaining
      ].filter(Boolean);
      return `<div class="detail-resume-indicator">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
    },
    renderHeroMetaRows(meta) {
      const hasExternalRatings = hasMdbListRatings(meta?.mdbListRatings);
      const genresText = normalizeGenreList(meta).slice(0, 6).map(localizedGenreLabel).join(" • ");
      const yearText = formatMovieReleaseDate(meta);
      const imdbValue = resolveImdbRating(meta);
      const imdbText = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue).replace(",", ".") : "";
      const runtimeText =
        formatHeroRuntime(meta?.runtime) ||
        formatRuntimeMinutes(meta?.runtimeMinutes || resolveEpisodeRuntimeForSeason(this.episodes, this.selectedSeason));
      const countryText = normalizeCountryLabel(Array.isArray(meta?.country) ? meta.country.join(", ") : meta?.country || "");
      const languageText = String(meta?.language || "")
        .trim()
        .toUpperCase();
      const ageRating = String(meta?.ageRating || "").trim();
      const status = String(meta?.status || "")
        .trim()
        .toUpperCase();
      const primaryParts = [
        genresText ? `<span class="detail-meta-genres">${escapeHtml(genresText)}</span>` : "",
        yearText ? `<span>${escapeHtml(yearText)}</span>` : "",
        imdbText && showStandardDetailRatings(LayoutPreferences.get().homeImdbRatingsVisibility, hasExternalRatings)
          ? renderImdbBadge(imdbText)
          : ""
      ].filter(Boolean);
      const secondaryParts = [];
      if (ageRating && status) {
        secondaryParts.push(`
            <span class="detail-meta-badge combined">
              <span>${escapeHtml(ageRating)}</span>
              <span class="detail-meta-badge-divider"></span>
              <span class="strong">${escapeHtml(status)}</span>
            </span>
          `);
      } else {
        if (ageRating) {
          secondaryParts.push(`<span class="detail-meta-badge">${escapeHtml(ageRating)}</span>`);
        }
        if (status) {
          secondaryParts.push(`<span class="detail-meta-badge strong">${escapeHtml(status)}</span>`);
        }
      }
      [runtimeText, countryText, languageText].filter(Boolean).forEach((value) => {
        secondaryParts.push(`<span>${escapeHtml(value)}</span>`);
      });

      return `
          <div class="detail-meta-stack">
            ${primaryParts.length ? `<div class="detail-meta-row">${primaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
            ${secondaryParts.length ? `<div class="detail-meta-row secondary">${secondaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
          </div>
        `;
    }
  };
}
