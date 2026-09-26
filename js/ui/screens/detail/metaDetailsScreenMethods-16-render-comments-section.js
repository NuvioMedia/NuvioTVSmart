/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods16() {
  const {
    Router,
    ScreenUtils,
    t,
    detailImageLoadingMode,
    isSeriesDetailMeta,
    formatRatingValue,
    renderLibraryGlyph,
    renderWatchedGlyph,
    escapeHtml,
    normalizePreviewItem,
    extractPreviewYear
  } = internals;

  // Tizen fast path: preview/comment rails can hold hundreds of cards.
  // Render an initial window on fast-path runtimes and append more as focus
  // nears the end (stable original indices, no focus jumps).
  const PREVIEW_RAIL_WINDOW = 24;
  const COMMENTS_WINDOW = 12;
  const RAIL_EXTEND_AHEAD = 6;

  return {
    renderCommentsSection() {
      if (this.commentsLoading) {
        const cards = Array.from({ length: 3 })
          .map(() => `<article class="detail-comment-card is-loading"><span></span><span></span><span></span></article>`)
          .join("");
        return `<div class="detail-comments-track" data-scroll-key="comments:loading">${cards}</div>`;
      }
      if (this.commentsError) {
        return `
            <div class="detail-comments-error">
              <p>${escapeHtml(this.commentsError)}</p>
              <button class="series-season-btn focusable" data-action="retryComments">${escapeHtml(t("action_retry", {}, "Retry"))}</button>
            </div>
          `;
      }
      const modeButtons = isSeriesDetailMeta(this.meta, this.episodes)
        ? `<div class="detail-comments-modes">
              <button class="detail-comments-mode focusable${this.commentsMode !== "episode" ? " selected" : ""}" data-action="setCommentsMode" data-comments-mode="title">${escapeHtml(t("detail_comments_mode_show", {}, "Show"))}</button>
              <button class="detail-comments-mode focusable${this.commentsMode === "episode" ? " selected" : ""}" data-action="setCommentsMode" data-comments-mode="episode">${escapeHtml(this.commentsEpisodeTarget ? `S${this.commentsEpisodeTarget.season}E${this.commentsEpisodeTarget.episode}` : t("detail_comments_mode_episode", {}, "Episode"))}</button>
            </div>`
        : "";
      const subtitle =
        this.commentsMode === "episode" && this.commentsEpisodeTarget
          ? t(
              "detail_comments_subtitle_episode",
              {
                season: this.commentsEpisodeTarget.season,
                episode: this.commentsEpisodeTarget.episode
              },
              "Reviews for S{{season}}E{{episode}}"
            )
          : t("detail_comments_subtitle", {}, "Top Trakt reviews");
      if (!this.commentsItems.length) {
        return `
            <div class="detail-comments-section">
              <div class="detail-comments-heading"><img src="assets/icons/trakt_tv_glyph.svg" alt="" /><span>${escapeHtml(t("detail_comments_title", {}, "Comments"))}</span></div>
              <p class="detail-comments-subtitle">${escapeHtml(subtitle)}</p>
              ${modeButtons}
              <p class="series-insight-empty">${escapeHtml(t("detail_comments_empty", {}, "No Trakt comments yet."))}</p>
            </div>
          `;
      }
      const commentsWindow = this.getRailWindow(this.commentsItems, `comments:${this.commentsMode}`, COMMENTS_WINDOW);
      const cards = commentsWindow.list.map((review, offset) => this.renderCommentCard(review, commentsWindow.offset + offset)).join("");
      const loadingMore = this.commentsLoadingMore
        ? `<article class="detail-comment-card is-loading"><span></span><span></span><span></span></article>`
        : "";
      return `
          <div class="detail-comments-section">
            <div class="detail-comments-heading"><img src="assets/icons/trakt_tv_glyph.svg" alt="" /><span>${escapeHtml(t("detail_comments_title", {}, "Comments"))}</span></div>
            <p class="detail-comments-subtitle">${escapeHtml(subtitle)}</p>
            ${modeButtons}
            <div class="detail-comments-track" data-scroll-key="comments:${escapeHtml(this.commentsMode)}">${cards}${loadingMore}</div>
          </div>
        `;
    },
    getRailWindow(items = [], railKey = "", size = PREVIEW_RAIL_WINDOW) {
      const list = Array.isArray(items) ? items : [];
      this._railWindows = this._railWindows || {};
      if (list.length <= size || !ScreenUtils.shouldSkipRouteEnter(this)) {
        delete this._railWindows[railKey];
        return { list, offset: 0 };
      }
      const currentShown = Number(this._railWindows[railKey]?.shown || size);
      const commentsIndexMatch = String(this.pendingFocusRestore?.selector || "").match(
        /detail-comment-card\[data-comment-index="(\d+)"\]/
      );
      const rememberedIndex = railKey.startsWith("comments:")
        ? Number(commentsIndexMatch?.[1] || 0)
        : Number(this.railFocusIndexByKey?.[railKey] || 0);
      const restoredWindowSize = Number.isFinite(rememberedIndex) ? Math.ceil((rememberedIndex + 1) / size) * size : size;
      const shown = Math.min(list.length, Math.max(size, currentShown, restoredWindowSize));
      this._railWindows[railKey] = { items: list, shown, size };
      return { list: list.slice(0, shown), offset: 0 };
    },
    renderPreviewCard(rawItem, fallbackType = "movie") {
      const item = normalizePreviewItem(rawItem, fallbackType);
      const year = extractPreviewYear(item.releaseInfo);
      const primaryImage = item.landscapePoster || item.poster || "";
      const fallbackImage = item.poster && item.poster !== primaryImage ? item.poster : "";
      return `
          <article class="detail-morelike-card focusable"
               data-action="openMoreLikeDetail"
               data-item-id="${item.id}"
               data-item-type="${item.type || this.params?.itemType || "movie"}"
               data-item-title="${escapeHtml(item.name || "Untitled")}"
               data-poster-src="${escapeHtml(item.poster || primaryImage || "")}"
               data-backdrop-src="${escapeHtml(item.background || item.backdrop || item.landscapePoster || primaryImage || "")}">
            <div class="detail-morelike-poster-wrap">
              ${
                primaryImage
                  ? `<img class="detail-morelike-poster-image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(item.name || "content")}" loading="${detailImageLoadingMode()}" decoding="async"${fallbackImage ? ` data-fallback-src="${escapeHtml(fallbackImage)}"` : ""} onerror="var next=this.dataset.fallbackSrc||''; if(next && this.src !== next){ this.src = next; this.dataset.fallbackSrc=''; return; } this.hidden = true; var placeholder = this.nextElementSibling; if(placeholder){ placeholder.hidden = false; }" />`
                  : ""
              }
              <div class="detail-morelike-poster placeholder"${primaryImage ? " hidden" : ""}></div>
            </div>
            <div class="detail-morelike-name">${escapeHtml(item.name || "Untitled")}</div>
            ${year ? `<div class="detail-morelike-type">${escapeHtml(year)}</div>` : ""}
          </article>
        `;
    },
    renderCommentCard(review, index) {
      const body =
        review.spoiler || review.containsInlineSpoilers
          ? t("detail_comments_spoiler_hidden", {}, "Spoiler review. Press OK to reveal.")
          : review.comment;
      const chips = [
        review.review ? t("detail_comments_badge_review", {}, "Review") : "",
        review.spoiler || review.containsInlineSpoilers ? t("detail_comments_badge_spoiler", {}, "Spoiler") : "",
        review.rating != null
          ? t(
              "detail_comments_badge_rating",
              {
                rating: formatRatingValue(review.rating, { digits: 0, stripTrailingZero: true })
              },
              "{{rating}}/10"
            )
          : ""
      ]
        .filter(Boolean)
        .map((chip) => `<span>${escapeHtml(chip)}</span>`)
        .join("");
      return `
            <article class="detail-comment-card focusable" data-action="openComment" data-comment-index="${index}">
              <h4>${escapeHtml(review.authorDisplayName || "Trakt user")}</h4>
              ${chips ? `<div class="detail-comment-chips">${chips}</div>` : ""}
              <p>${escapeHtml(body)}</p>
              <small>${escapeHtml(t("detail_comments_likes", { likes: review.likes || 0 }, "{{likes}} likes"))}</small>
            </article>
          `;
    },
    extendRailWindowIfNeeded(target) {
      if (!(target instanceof HTMLElement) || !this.container?.contains(target)) {
        return false;
      }
      const track = target.closest?.(".detail-morelike-track, .detail-comments-track") || null;
      if (!(track instanceof HTMLElement)) {
        return false;
      }
      const windows = this._railWindows || {};
      const railKey = String(track.dataset.scrollKey || "");
      const windowState = windows[railKey];
      if (!windowState || windowState.shown >= windowState.items.length) {
        return false;
      }
      const cards = Array.from(track.querySelectorAll(":scope > article.focusable"));
      if (!cards.length) {
        return false;
      }
      const focusedIndex = cards.indexOf(target);
      if (focusedIndex < 0 || focusedIndex < cards.length - RAIL_EXTEND_AHEAD) {
        return false;
      }
      const nextShown = Math.min(windowState.items.length, windowState.shown + windowState.size);
      if (nextShown <= windowState.shown) {
        return false;
      }
      const isComments = track.classList.contains("detail-comments-track");
      let html = "";
      for (let i = windowState.shown; i < nextShown; i += 1) {
        html += isComments
          ? this.renderCommentCard(windowState.items[i], i)
          : this.renderPreviewCard(windowState.items[i], this.params?.itemType || "movie");
      }
      windowState.shown = nextShown;
      track.insertAdjacentHTML("beforeend", html);
      return true;
    },
    renderPreviewRail(items = [], fallbackType = "movie", railKey = "morelike") {
      if (!Array.isArray(items) || !items.length) {
        return "";
      }
      const windowed = this.getRailWindow(items, railKey, PREVIEW_RAIL_WINDOW);
      const cards = windowed.list.map((rawItem) => this.renderPreviewCard(rawItem, fallbackType)).join("");
      return `<div class="detail-morelike-track" data-scroll-key="${escapeHtml(railKey)}">${cards}</div>`;
    },
    renderMoreLikeCards() {
      return this.renderPreviewRail(this.moreLikeThisItems, this.params?.itemType || "movie");
    },
    renderCompanyLogosSection(rawCompanies = [], title = "Studios", entityKind = "company") {
      const toLogo = (logo) => {
        const value = String(logo || "").trim();
        if (!value) {
          return "";
        }
        if (value.startsWith("http://") || value.startsWith("https://")) {
          return value;
        }
        if (value.startsWith("/")) {
          return `https://image.tmdb.org/t/p/w500${value}`;
        }
        return value;
      };
      const companies = rawCompanies
        .map((entry) => ({
          name: entry?.name || "",
          logo: toLogo(entry?.logo || entry?.logoPath || entry?.logo_path || ""),
          tmdbId: Number(entry?.tmdbId || entry?.tmdb_id || entry?.id || 0) || null
        }))
        .filter((entry) => entry.logo || entry.name);
      if (!companies.length) {
        return "";
      }
      const logos = companies
        .slice(0, 10)
        .map(
          (company) => `
          <article class="detail-company-card focusable"
                   data-action="openTmdbEntity"
                   data-entity-kind="${escapeHtml(entityKind)}"
                   data-tmdb-id="${escapeHtml(company.tmdbId || "")}"
                   data-company-key="${escapeHtml(`${entityKind}:${company.tmdbId || company.name || ""}`)}"
                   data-company-name="${escapeHtml(company.name || "")}"
                   aria-label="${escapeHtml(company.name || title || "Company")}">
            ${company.logo ? `<img src="${company.logo}" alt="${escapeHtml(company.name || "Company")}" loading="lazy" decoding="async" />` : `<span>${escapeHtml(company.name || "")}</span>`}
          </article>
        `
        )
        .join("");
      return `
          <section class="detail-company-section">
            <h3 class="detail-company-title">${escapeHtml(title)}</h3>
            <div class="detail-company-track" data-scroll-key="company:${escapeHtml(String(title || "").toLowerCase())}">${logos}</div>
          </section>
        `;
    },
    bindDetailChrome() {
      this.observeEpisodeThumbnails();
      const content = this.container?.querySelector(".series-detail-content");
      if (!content) {
        return;
      }
      if (this.detailScrollHandler) {
        content.removeEventListener("scroll", this.detailScrollHandler);
      }
      this.detailScrollHandler = () => {
        const shell = this.container?.querySelector(".series-detail-shell");
        if (!shell) {
          return;
        }
        if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
          this.stopTrailerPlayback({ restartAutoplay: false });
        }
        shell.classList.toggle("detail-scrolled", content.scrollTop > 160);
      };
      content.addEventListener("scroll", this.detailScrollHandler, { passive: true });
      if (this.episodeTrackScrollNode && this.episodeTrackScrollHandler) {
        this.episodeTrackScrollNode.removeEventListener("scroll", this.episodeTrackScrollHandler);
      }
      // Android's LazyRow keeps a stable keyed window driven by focus. The Web
      // rail already syncs before moving focus; observing every spring-generated
      // scroll event repeats DOM work on each frame and makes TV navigation stutter.
      this.episodeTrackScrollNode = null;
      this.episodeTrackScrollHandler = null;
      if (this.detailFocusHandler) {
        this.container.removeEventListener("focusin", this.detailFocusHandler, true);
      }
      this.detailFocusHandler = (event) => {
        const target = event?.target;
        if (!(target instanceof HTMLElement) || !this.container?.contains(target)) {
          return;
        }
        if (!this.isTrailerPlaying) {
          if (target.matches('.series-detail-actions [data-action="playDefault"]')) {
            this.restartTrailerAutoplayTimer();
          } else if (this.trailerAutoplayTimer) {
            clearTimeout(this.trailerAutoplayTimer);
            this.trailerAutoplayTimer = null;
          }
        }
        if (target.matches(".series-season-btn.focusable")) {
          const season = Number(target.dataset.season || 0);
          if (season >= 0 && season !== this.selectedSeason) {
            // Tizen fast path: moving focus across the season row rebuilt the
            // whole episode track per button. Wait for focus to settle on
            // fast-path runtimes; only the last season loads.
            let deferSeason = false;
            try {
              deferSeason =
                (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) ||
                globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
                globalThis?.document?.documentElement?.classList?.contains("legacy-tizen");
            } catch (_) {}
            if (deferSeason) {
              if (this.seasonSwitchTimer) {
                clearTimeout(this.seasonSwitchTimer);
              }
              const pendingSeason = season;
              this.seasonSwitchTimer = setTimeout(() => {
                this.seasonSwitchTimer = null;
                if (Router.getCurrent?.() !== "detail") {
                  return;
                }
                const live = this.container?.querySelector(".series-season-btn.focusable.focused") || null;
                if (Number(live?.dataset?.season ?? -1) === pendingSeason && pendingSeason !== this.selectedSeason) {
                  this.selectSeason(pendingSeason);
                }
              }, 250);
              return;
            }
            this.selectSeason(season);
          }
          return;
        }
        if (target.matches(".series-insight-tab.focusable")) {
          const tab = String(target.dataset.tab || "");
          if (!tab) {
            return;
          }
          if (isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.seriesInsightTab) {
            this.seriesInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(tab) ? tab : "cast";
            this.updateRenderedDetailSections(this.meta);
            return;
          }
          if (!isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.movieInsightTab) {
            this.movieInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(tab) ? tab : "cast";
            this.updateRenderedDetailSections(this.meta);
          }
          return;
        }
        if (target.matches(".series-rating-season.focusable")) {
          const season = Number(target.dataset.season || 0);
          if (season > 0 && season !== this.selectedRatingSeason) {
            this.selectedRatingSeason = season;
            this.render(this.meta, { selector: `.series-rating-season[data-season="${season}"]` });
          }
        }
      };
      this.container.addEventListener("focusin", this.detailFocusHandler, true);
      if (this.detailClickHandler) {
        this.container.removeEventListener("click", this.detailClickHandler, true);
      }
      this.detailClickHandler = () => {
        if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
          this.stopTrailerPlayback({ restartAutoplay: false });
          return;
        }
      };
      this.container.addEventListener("click", this.detailClickHandler, true);
      this.detailScrollHandler();
      this.restoreChromeState();
      this.syncTrailerDom();
      this.restartTrailerAutoplayTimer();
      this.restorePendingFocus();
      this.syncEpisodeTitleMarquee();
    },
    restoreChromeState() {
      const content = this.container?.querySelector(".series-detail-content");
      if (content) {
        content.scrollTop = Number(this.restoredContentScrollTop || 0);
      }
      Array.from(this.container?.querySelectorAll("[data-scroll-key]") || []).forEach((node) => {
        const key = String(node.dataset.scrollKey || "");
        if (!key) {
          return;
        }
        node.scrollLeft = Number(this.restoredTrackScrollLeftByKey?.[key] || 0);
      });
    },
    syncDetailActionButtons() {
      if (!this.container) {
        return;
      }
      Array.from(this.container.querySelectorAll('[data-action="toggleLibrary"]')).forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if (node.classList.contains("series-circle-btn")) {
          node.classList.toggle("is-library-selected", this.isSavedInLibrary);
          node.innerHTML = renderLibraryGlyph(this.isSavedInLibrary);
          node.setAttribute(
            "aria-label",
            this.isSavedInLibrary
              ? t("detail.removeFromLibrary", {}, "Remove from Library")
              : t("detail.addToLibrary", {}, "Add to Library")
          );
        } else {
          node.textContent = this.isSavedInLibrary
            ? t("detail.removeFromLibrary", {}, "Remove from Library")
            : t("detail.addToLibrary", {}, "Add to Library");
        }
      });
      Array.from(this.container.querySelectorAll('[data-action="toggleWatched"]')).forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if (node.classList.contains("series-circle-btn")) {
          node.classList.toggle("is-selected", this.isMarkedWatched);
          node.innerHTML = renderWatchedGlyph(this.isMarkedWatched);
          node.setAttribute(
            "aria-label",
            this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched")
          );
        } else {
          node.textContent = this.isMarkedWatched
            ? t("common.markUnwatched", {}, "Mark Unwatched")
            : t("common.markWatched", {}, "Mark Watched");
        }
      });
      Router.captureCurrentRouteState();
    }
  };
}
