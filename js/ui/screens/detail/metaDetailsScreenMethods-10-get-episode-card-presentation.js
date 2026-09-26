/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods10() {
  const {
    LayoutPreferences,
    contentTextDirection,
    EPISODE_TITLE_MARQUEE_VELOCITY_PX_PER_SECOND,
    t,
    renderImdbBadge,
    resolveEpisodeImdbRating,
    renderWatchedBadgeGlyph,
    escapeHtml,
    escapeAttribute,
    normalizeEpisodeTitle,
    formatEpisodeCardDate,
    renderEpisodeRuntimeLabel
  } = internals;

  return {
    getEpisodeCardPresentation(episode, sharedPrefs = null) {
      const progress = this.episodeProgressMap.get(`${episode.season}:${episode.episode}`) || null;
      const position = Number(progress?.positionMs || 0);
      const duration = Number(progress?.durationMs || 0);
      const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
      const isWatched = this.isEpisodeMarkedWatched(episode);
      // Tizen fast path: LayoutPreferences.get() does sync flash I/O per
      // call. renderEpisodeCards reads it once per track render and passes
      // it down; fall back to a live read for standalone callers.
      const prefs = sharedPrefs || LayoutPreferences.get();
      const shouldBlur = Boolean(prefs.blurUnwatchedEpisodes) && !isWatched;
      const rating = resolveEpisodeImdbRating(episode, this.seriesRatingsBySeason);
      const dateLabel = formatEpisodeCardDate(episode.released || "");
      const isUnavailable = episode.available === false;
      const metaParts = [
        episode.runtimeMinutes > 0 ? renderEpisodeRuntimeLabel(episode.runtimeMinutes) : "",
        rating != null ? `<span class="series-episode-rating-inline">${renderImdbBadge(String(Number(rating).toFixed(1)))}</span>` : "",
        dateLabel ? `<span class="series-episode-date">${escapeHtml(dateLabel)}</span>` : ""
      ]
        .filter(Boolean)
        .join("");
      return {
        isUnavailable,
        isWatched,
        metaParts,
        overview: String(episode.overview || t("episodes_episode", {}, "Episode")),
        progressRatio,
        shouldBlur,
        thumbnail: String(episode.thumbnail || "").trim(),
        title: normalizeEpisodeTitle(episode.title, episode.episode)
      };
    },
    renderEpisodeCard(episode, absoluteIndex, sharedPrefs = null) {
      const presentation = this.getEpisodeCardPresentation(episode, sharedPrefs);
      return `
          <article class="series-episode-card focusable${presentation.isWatched ? " watched" : ""}"
                data-action="openEpisodeStreams"
                data-video-id="${escapeHtml(episode.id)}"
                data-episode-index="${absoluteIndex}">
            <div class="series-episode-thumb">
              <div class="series-episode-image${presentation.shouldBlur ? " is-blurred" : ""}"
                   data-episode-thumb="${escapeAttribute(presentation.thumbnail)}"${presentation.thumbnail ? ` data-thumb="${escapeAttribute(presentation.thumbnail)}"` : ""}></div>
              <div class="series-episode-overlay"></div>
              ${presentation.isWatched ? `<div class="series-episode-status complete">${renderWatchedBadgeGlyph()}</div>` : presentation.progressRatio < 0.02 ? `<div class="series-episode-status idle"></div>` : ""}
              ${presentation.isUnavailable ? `<div class="series-episode-unavailable">${escapeHtml(t("episodes_unavailable", {}, "Unavailable").toUpperCase())}</div>` : ""}
              <div class="series-episode-copy">
                <div class="series-episode-badge">${escapeHtml(t("episodes_episode", {}, "Episode").toUpperCase())} ${Number(episode.episode || 0)}</div>
              <div class="series-episode-title" dir="${contentTextDirection(presentation.title)}"><span class="series-episode-title-text">${escapeHtml(presentation.title)}</span></div>
                <div class="series-episode-overview" dir="${contentTextDirection(presentation.overview)}">${escapeHtml(presentation.overview)}</div>
                ${presentation.metaParts ? `<div class="series-episode-meta">${presentation.metaParts}</div>` : ""}
              </div>
              ${presentation.progressRatio > 0.02 && presentation.progressRatio < 0.98 ? `<div class="series-episode-progress"><span style="width:${Math.round(presentation.progressRatio * 100)}%"></span></div>` : ""}
            </div>
          </article>
        `;
    },
    warmEpisodeThumbnails() {
      // Eager prefetch removed: episode thumbnails are now lazy-loaded on demand via
      // IntersectionObserver (see observeEpisodeThumbnails). Eagerly decoding a whole
      // season's thumbnails at once stalled low-end TVs when switching seasons.
    },
    applyEpisodeThumb(el) {
      try {
        if (!el) return;
        const url = el.getAttribute("data-thumb");
        if (!url) return;
        el.style.backgroundImage = "url('" + String(url).replace(/'/g, "%27") + "')";
        el.removeAttribute("data-thumb");
      } catch (_) {}
    },
    observeEpisodeThumbnails() {
      try {
        const root = this.container;
        if (!root) return;
        const thumbs = Array.from(root.querySelectorAll(".series-episode-image[data-thumb]"));
        if (!thumbs.length) return;
        // Fallback for engines without IntersectionObserver: just load them all.
        if (typeof IntersectionObserver !== "function") {
          thumbs.forEach((el) => this.applyEpisodeThumb(el));
          return;
        }
        if (!this.episodeThumbObserver) {
          this.episodeThumbObserver = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (entry.isIntersecting) {
                  this.applyEpisodeThumb(entry.target);
                  try {
                    this.episodeThumbObserver.unobserve(entry.target);
                  } catch (_) {}
                }
              });
            },
            { root: null, rootMargin: "300px", threshold: 0.01 }
          );
        }
        thumbs.forEach((el) => this.episodeThumbObserver.observe(el));
      } catch (_) {}
    },
    renderEpisodeCards(preferredIndex = null) {
      const episodes = this.getSelectedSeasonEpisodes();
      if (!episodes.length) {
        return `<p>${escapeHtml(t("episodes_panel_no_episodes", {}, "No episodes available"))}</p>`;
      }
      const windowState = this.getEpisodeVirtualWindowState(episodes, preferredIndex);
      if (!windowState) {
        return `<p>${escapeHtml(t("episodes_panel_no_episodes", {}, "No episodes available"))}</p>`;
      }
      this.episodeVirtualWindow = windowState;
      const visibleEpisodes = windowState.virtualized ? episodes.slice(windowState.start, windowState.end + 1) : episodes;
      this.warmEpisodeThumbnails(episodes, windowState.start, windowState.end);
      // Single prefs read per track render (see getEpisodeCardPresentation).
      const sharedPrefs = LayoutPreferences.get();
      const cards = visibleEpisodes
        .map((episode, offset) =>
          this.renderEpisodeCard(episode, windowState.virtualized ? windowState.start + offset : offset, sharedPrefs)
        )
        .join("");
      if (!windowState.virtualized) {
        return cards;
      }
      return `
          <div class="series-episode-track-spacer" aria-hidden="true" style="flex-basis:${Math.max(0, windowState.leftSpacer)}px"></div>
          <div class="series-episode-track-window" style="--episode-track-gap:${windowState.gap}px">
            ${cards}
          </div>
          <div class="series-episode-track-spacer" aria-hidden="true" style="flex-basis:${Math.max(0, windowState.rightSpacer)}px"></div>
        `;
    },
    syncRenderedSeasonButtons() {
      const row = this.container?.querySelector("#detailSeasonRowMount .series-season-row");
      if (!(row instanceof HTMLElement)) {
        return false;
      }
      const seasons = this.getAvailableSeasons();
      const buttons = Array.from(row.querySelectorAll(".series-season-btn.focusable"));
      if (buttons.length !== seasons.length) {
        return false;
      }
      const seasonLabel = (season) =>
        season === 0 ? t("episodes_specials", {}, "Specials") : t("detail.seasonLabel", { season }, "Season {{season}}");
      for (const [index, season] of seasons.entries()) {
        const button = buttons[index];
        if (Number(button?.dataset?.season || 0) !== Number(season)) {
          return false;
        }
        const label = seasonLabel(season);
        if (button.textContent.trim() !== label) {
          button.textContent = label;
        }
        button.classList.toggle("selected", season === this.selectedSeason);
      }
      return true;
    },
    clearEpisodeTitleMarquee(title) {
      if (!(title instanceof HTMLElement)) {
        return;
      }
      title.classList.remove("is-marquee-active");
      title.style.removeProperty("--episode-marquee-distance");
      title.style.removeProperty("--episode-marquee-duration");
      const text = title.querySelector(".series-episode-title-text");
      if (text instanceof HTMLElement) {
        text.style.removeProperty("width");
      }
      if (this.episodeMarqueeTitle === title) {
        this.episodeMarqueeTitle = null;
      }
    },
    syncEpisodeTitleMarquee() {
      const focusedTitle = this.container?.querySelector(".series-episode-card.focused .series-episode-title") || null;
      if (this.episodeMarqueeTitle && this.episodeMarqueeTitle !== focusedTitle) {
        this.clearEpisodeTitleMarquee(this.episodeMarqueeTitle);
      }
      if (!(focusedTitle instanceof HTMLElement)) {
        return;
      }
      const text = focusedTitle.querySelector(".series-episode-title-text");
      if (!(text instanceof HTMLElement)) {
        return;
      }
      if (focusedTitle.classList.contains("is-marquee-active")) {
        return;
      }
      const availableWidth = Number(focusedTitle.clientWidth || 0);
      const textWidth = Number(text.scrollWidth || 0);
      if (availableWidth <= 0 || textWidth <= availableWidth + 1) {
        return;
      }
      const spacing = Math.max(32, Math.round(availableWidth / 3));
      const distance = textWidth + spacing;
      const isRtl = typeof getComputedStyle === "function" && getComputedStyle(focusedTitle).direction === "rtl";
      const travel = isRtl ? distance : -distance;
      const duration = Math.max(1000, Math.round((distance / EPISODE_TITLE_MARQUEE_VELOCITY_PX_PER_SECOND) * 1000));
      text.style.width = `${textWidth}px`;
      focusedTitle.style.setProperty("--episode-marquee-distance", `${travel}px`);
      focusedTitle.style.setProperty("--episode-marquee-duration", `${duration}ms`);
      focusedTitle.classList.add("is-marquee-active");
      this.episodeMarqueeTitle = focusedTitle;
    },
    syncEpisodeCardDom(card, episode, absoluteIndex) {
      if (!(card instanceof HTMLElement) || !episode) {
        return false;
      }
      const thumb = card.querySelector(".series-episode-thumb");
      const image = card.querySelector(".series-episode-image");
      const copy = card.querySelector(".series-episode-copy");
      const title = card.querySelector(".series-episode-title");
      const overview = card.querySelector(".series-episode-overview");
      const badge = card.querySelector(".series-episode-badge");
      if (
        !(thumb instanceof HTMLElement) ||
        !(image instanceof HTMLElement) ||
        !(copy instanceof HTMLElement) ||
        !(title instanceof HTMLElement) ||
        !(overview instanceof HTMLElement) ||
        !(badge instanceof HTMLElement)
      ) {
        return false;
      }

      const presentation = this.getEpisodeCardPresentation(episode);
      const videoId = String(episode.id || "");
      card.dataset.videoId = videoId;
      card.dataset.episodeIndex = String(absoluteIndex);
      card.classList.toggle("watched", presentation.isWatched);

      let titleText = title.querySelector(".series-episode-title-text");
      if (!(titleText instanceof HTMLElement)) {
        const currentTitle = String(title.textContent || "").trim();
        title.textContent = "";
        titleText = document.createElement("span");
        titleText.className = "series-episode-title-text";
        title.appendChild(titleText);
        titleText.textContent = currentTitle;
      }
      if (titleText.textContent !== presentation.title) {
        this.clearEpisodeTitleMarquee(title);
        titleText.textContent = presentation.title;
      }
      if (badge.textContent.trim() !== `${t("episodes_episode", {}, "Episode").toUpperCase()} ${Number(episode.episode || 0)}`) {
        badge.textContent = `${t("episodes_episode", {}, "Episode").toUpperCase()} ${Number(episode.episode || 0)}`;
      }
      if (overview.textContent !== presentation.overview) {
        overview.textContent = presentation.overview;
      }

      const thumbnail = presentation.thumbnail;
      if (String(image.dataset.episodeThumb || "") !== thumbnail) {
        image.dataset.episodeThumb = thumbnail;
        image.removeAttribute("data-thumb");
        image.style.removeProperty("background-image");
        if (thumbnail) {
          image.setAttribute("data-thumb", thumbnail);
        }
      }

      let unavailable = thumb.querySelector(".series-episode-unavailable");
      if (presentation.isUnavailable) {
        if (!(unavailable instanceof HTMLElement)) {
          unavailable = document.createElement("div");
          thumb.appendChild(unavailable);
        }
        unavailable.className = "series-episode-unavailable";
        unavailable.textContent = t("episodes_unavailable", {}, "Unavailable").toUpperCase();
      } else if (unavailable instanceof HTMLElement) {
        unavailable.remove();
      }

      let meta = copy.querySelector(".series-episode-meta");
      if (presentation.metaParts) {
        if (!(meta instanceof HTMLElement)) {
          meta = document.createElement("div");
          meta.className = "series-episode-meta";
          copy.appendChild(meta);
        }
        if (meta.innerHTML !== presentation.metaParts) {
          meta.innerHTML = presentation.metaParts;
        }
      } else if (meta instanceof HTMLElement) {
        meta.remove();
      }

      this.syncEpisodeCardWatchedDom(episode);
      return true;
    }
  };
}
