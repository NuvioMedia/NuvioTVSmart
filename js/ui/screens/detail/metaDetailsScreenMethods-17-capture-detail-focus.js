/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods17() {
  const {
    PlayerSettingsStore,
    getTvRuntimePerformanceProfile,
    DETAIL_SCROLL_STIFFNESS,
    DETAIL_SCROLL_DAMPING_RATIO,
    DETAIL_SCROLL_MAX_FRAME_SECONDS,
    escapeSelectorValue
  } = internals;

  return {
    captureDetailFocus() {
      if (this.episodeHoldMenu) {
        return this.getEpisodeFocusDescriptor(this.episodeHoldMenu?.videoId);
      }
      if (this.seasonHoldMenu) {
        const season = Number(this.seasonHoldMenu.season ?? this.selectedSeason ?? 1);
        return { selector: `.series-season-btn[data-season="${season}"]` };
      }
      if (this.posterOptionsController?.dialog) {
        return this.posterOptionsFocusRestore || null;
      }
      if (this.libraryListMenu) {
        return { selector: ".series-detail-actions [data-action='toggleLibrary']" };
      }
      if (this.heroPlayMenu) {
        return { selector: ".series-detail-actions [data-action='playDefault']" };
      }
      if (!this.container) {
        return null;
      }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeTarget = active && this.container.contains(active) && active.classList.contains("focusable") ? active : null;
      const current = this.container.querySelector(".focusable.focused");
      const target = activeTarget || current || (active && this.container.contains(active) ? active : null);
      if (!(target instanceof HTMLElement) || !target.closest(".series-detail-content")) {
        return null;
      }
      const action = String(target.dataset.action || "");
      if (action === "selectSeason") {
        const season = Number(target.dataset.season || 0);
        return season >= 0 ? { selector: `.series-season-btn[data-season="${season}"]` } : null;
      }
      if (action === "setSeriesInsightTab" || action === "setMovieInsightTab") {
        const tab = String(target.dataset.tab || "");
        return tab ? { selector: `.series-insight-tab[data-tab="${tab}"]` } : null;
      }
      if (action === "setCommentsMode") {
        const mode = String(target.dataset.commentsMode || "title") === "episode" ? "episode" : "title";
        return {
          selector: `.detail-comments-mode[data-comments-mode="${mode}"]`,
          preserveVerticalScroll: true
        };
      }
      if (action === "openComment") {
        const index = Number(target.dataset.commentIndex || 0);
        return {
          selector: `.detail-comment-card[data-comment-index="${index}"]`,
          preserveVerticalScroll: true
        };
      }
      if (action === "openSharedTrailer") {
        const index = Number(target.dataset.trailerIndex || 0);
        return { selector: `.detail-trailer-card[data-trailer-index="${index}"]` };
      }
      if (action === "selectRatingSeason") {
        const season = Number(target.dataset.season || 0);
        return season > 0 ? { selector: `.series-rating-season[data-season="${season}"]` } : null;
      }
      if (action === "openEpisodeStreams") {
        const videoId = String(target.dataset.videoId || "");
        const episodeIndex = Number(target.dataset.episodeIndex || -1);
        return videoId
          ? {
              episodeVideoId: videoId,
              episodeIndex: Number.isFinite(episodeIndex) && episodeIndex >= 0 ? episodeIndex : this.getEpisodeIndexByVideoId(videoId),
              selector: `.series-episode-card[data-video-id="${escapeSelectorValue(videoId)}"]`
            }
          : null;
      }
      if (action === "openCastDetail") {
        const castKey = String(target.dataset.castKey || "");
        return castKey ? { selector: `.series-cast-card[data-cast-key="${escapeSelectorValue(castKey)}"]` } : null;
      }
      if (action === "openMoreLikeDetail") {
        const itemId = String(target.dataset.itemId || "");
        return itemId ? { selector: `.detail-morelike-card[data-item-id="${escapeSelectorValue(itemId)}"]` } : null;
      }
      if (target.matches(".detail-company-card.focusable")) {
        const companyName = String(target.dataset.companyName || "");
        const companyKey = String(target.dataset.companyKey || "");
        if (companyKey) {
          return {
            selector: `.detail-company-card[data-company-key="${escapeSelectorValue(companyKey)}"]`
          };
        }
        return companyName
          ? {
              selector: `.detail-company-card[data-company-name="${escapeSelectorValue(companyName)}"]`
            }
          : null;
      }
      if (target.matches(".series-episode-rating-chip.focusable")) {
        const episode = Number(target.dataset.ratingEpisode || 0);
        return episode > 0 ? { selector: `.series-episode-rating-chip[data-rating-episode="${episode}"]` } : null;
      }
      if (action) {
        return { selector: `.series-detail-actions [data-action="${action}"]` };
      }
      return null;
    },
    restorePendingFocus() {
      const descriptor = this.pendingFocusRestore;
      this.pendingFocusRestore = null;
      return this.focusDetailDescriptor(descriptor);
    },
    isPerformanceConstrained() {
      return Boolean(
        getTvRuntimePerformanceProfile().isPerformanceConstrained ||
        globalThis.document?.body?.classList?.contains("performance-constrained")
      );
    },
    isLegacyTvRuntime() {
      return Boolean(getTvRuntimePerformanceProfile().isLegacyTvRuntime);
    },
    shouldSuppressTrailerAutoplay() {
      const content = this.getDetailContentScroller();
      const focused = this.container?.querySelector(".focusable.focused") || null;
      return Boolean(
        this.trailerHasAutoplayed ||
        !content ||
        Number(content.scrollTop || 0) > 160 ||
        !focused?.matches?.('.series-detail-actions [data-action="playDefault"]') ||
        this.seasonHoldMenu ||
        this.episodeHoldMenu ||
        this.heroPlayMenu ||
        this.libraryListMenu ||
        this.detailHoldDialog ||
        this.posterOptionsController?.dialog
      );
    },
    animateScroll(container, axis, targetValue, duration = 150) {
      if (!container) {
        return;
      }
      if (!this.isLegacyTvRuntime()) {
        this.animateSpringScroll(container, axis, targetValue);
        return;
      }
      const property = axis === "y" ? "scrollTop" : "scrollLeft";
      const max =
        axis === "y"
          ? Math.max(0, container.scrollHeight - container.clientHeight)
          : Math.max(0, container.scrollWidth - container.clientWidth);
      const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
      const startValue = Number(container[property] || 0);
      if (Math.abs(startValue - nextValue) <= 1) {
        container[property] = nextValue;
        return;
      }

      const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const effectiveDuration = this.isLegacyTvRuntime()
        ? 0
        : this.isPerformanceConstrained()
          ? Math.min(Number(duration || 150), 90)
          : Number(duration || 150);
      if (prefersReducedMotion || effectiveDuration <= 0) {
        container[property] = nextValue;
        return;
      }

      const ease = (t) => {
        const p1x = 0.4;
        const p1y = 0;
        const p2x = 0.2;
        const p2y = 1;
        const sampleCurveX = (x) => ((1 - 3 * p2x + 3 * p1x) * x + (3 * p2x - 6 * p1x)) * x * x + 3 * p1x * x;
        const sampleCurveY = (x) => ((1 - 3 * p2y + 3 * p1y) * x + (3 * p2y - 6 * p1y)) * x * x + 3 * p1y * x;
        const sampleDerivativeX = (x) => (3 * (1 - 3 * p2x + 3 * p1x) * x + 2 * (3 * p2x - 6 * p1x)) * x + 3 * p1x;
        let x = t;
        for (let i = 0; i < 4; i += 1) {
          const derivative = sampleDerivativeX(x);
          if (Math.abs(derivative) < 0.001) break;
          x -= (sampleCurveX(x) - t) / derivative;
        }
        return sampleCurveY(Math.max(0, Math.min(1, x)));
      };
      const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const key = axis === "y" ? "y" : "x";
      const existing = map.get(container) || {};
      if (existing[key]) {
        cancelAnimationFrame(existing[key]);
      }

      const startTime = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - startTime) / effectiveDuration);
        container[property] = Math.round(startValue + (nextValue - startValue) * ease(progress));
        if (progress < 1) {
          existing[key] = requestAnimationFrame(tick);
          map.set(container, existing);
        } else {
          existing[key] = null;
          map.set(container, existing);
        }
      };

      existing[key] = requestAnimationFrame(tick);
      map.set(container, existing);
    },
    animateSpringScroll(container, axis, targetValue, options = {}) {
      if (!container) {
        return;
      }
      const property = axis === "y" ? "scrollTop" : "scrollLeft";
      const max =
        axis === "y"
          ? Math.max(0, container.scrollHeight - container.clientHeight)
          : Math.max(0, container.scrollWidth - container.clientWidth);
      const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
      const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        container[property] = nextValue;
        return;
      }

      const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const key = axis === "y" ? "y" : "x";
      const tweenState = tweenMap.get(container);
      if (tweenState?.[key]) {
        cancelAnimationFrame(tweenState[key]);
        tweenState[key] = null;
        tweenMap.set(container, tweenState);
      }

      const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
      const existing = springMap.get(container) || {};
      const active = existing[key];
      if (active) {
        active.target = nextValue;
        active.stiffness = Number(options?.stiffness ?? active.stiffness ?? DETAIL_SCROLL_STIFFNESS);
        active.dampingRatio = Number(options?.dampingRatio ?? active.dampingRatio ?? DETAIL_SCROLL_DAMPING_RATIO);
        active.precision = Number(options?.precision ?? active.precision ?? 0.5);
        active.velocityEpsilon = Number(options?.velocityEpsilon ?? active.velocityEpsilon ?? 0.5);
        active.damping = 2 * active.dampingRatio * Math.sqrt(active.stiffness);
        springMap.set(container, existing);
        return;
      }

      const stiffness = Number(options?.stiffness ?? DETAIL_SCROLL_STIFFNESS);
      const dampingRatio = Number(options?.dampingRatio ?? DETAIL_SCROLL_DAMPING_RATIO);
      const state = {
        target: nextValue,
        position: Number(container[property] || 0),
        velocity: 0,
        raf: null,
        lastTime: performance.now(),
        stiffness,
        dampingRatio,
        damping: 2 * dampingRatio * Math.sqrt(stiffness),
        precision: Number(options?.precision ?? 0.5),
        velocityEpsilon: Number(options?.velocityEpsilon ?? 0.5)
      };

      const tick = (now) => {
        const deltaSeconds = Math.min(DETAIL_SCROLL_MAX_FRAME_SECONDS, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        const displacement = state.position - Number(state.target || 0);
        const acceleration = -state.stiffness * displacement - state.damping * state.velocity;
        state.velocity += acceleration * deltaSeconds;
        state.position += state.velocity * deltaSeconds;
        container[property] = state.position;

        if (Math.abs(Number(state.target || 0) - state.position) <= state.precision && Math.abs(state.velocity) <= state.velocityEpsilon) {
          container[property] = state.target;
          existing[key] = null;
          springMap.set(container, existing);
          return;
        }

        state.raf = requestAnimationFrame(tick);
        existing[key] = state;
        springMap.set(container, existing);
      };

      state.raf = requestAnimationFrame(tick);
      existing[key] = state;
      springMap.set(container, existing);
    },
    restartTrailerAutoplayTimer() {
      if (this.trailerAutoplayTimer) {
        clearTimeout(this.trailerAutoplayTimer);
        this.trailerAutoplayTimer = null;
      }
      if (
        !this.trailerSource ||
        this.isTrailerPlaying ||
        this.params?.autoOpenContinueWatching ||
        this.pendingEpisodeSelection ||
        this.pendingMovieSelection ||
        this.shouldSuppressTrailerAutoplay() ||
        !PlayerSettingsStore.get().trailerAutoplay
      ) {
        return;
      }
      const handoff =
        this.trailerHandoff && (!this.trailerSource?.ytId || String(this.trailerHandoff.ytId || "") === String(this.trailerSource.ytId))
          ? this.trailerHandoff
          : null;
      if (handoff) {
        const startAtSeconds = Math.max(0, Number(handoff.currentTime || 0));
        this.trailerHandoff = null;
        this.playTrailer({
          muted: handoff.muted === true,
          restart: true,
          initiatedByUser: false,
          startAtSeconds
        });
        return;
      }
      this.trailerAutoplayTimer = setTimeout(
        () => {
          this.playTrailer({ muted: false, restart: true, initiatedByUser: false });
        },
        Math.min(15, Math.max(0, Number(PlayerSettingsStore.get().trailerDelaySeconds ?? 7))) * 1000
      );
    },
    detachTrailerMediaListeners() {
      (this.trailerMediaListeners || []).forEach(({ target, eventName, handler }) => {
        target?.removeEventListener?.(eventName, handler);
      });
      this.trailerMediaListeners = [];
    }
  };
}
