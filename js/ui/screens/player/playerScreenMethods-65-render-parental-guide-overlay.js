/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

// Compose tween() uses FastOutSlowInEasing: cubic-bezier(0.4, 0, 0.2, 1).
function parentalGuideEasing(progress) {
  if (progress <= 0 || progress >= 1) return progress;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) * (1 - t) * t * 0.4 + 3 * (1 - t) * t * t * 0.2 + t * t * t;
    if (x < progress) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) * t * t + t * t * t;
}

export function createPlayerScreenMethods65() {
  const {
    PARENTAL_GUIDE_ROW_HEIGHT,
    PARENTAL_GUIDE_ROW_GAP,
    PARENTAL_GUIDE_CONTAINER_IN_MS,
    PARENTAL_GUIDE_LINE_IN_MS,
    PARENTAL_GUIDE_ITEM_STAGGER_MS,
    PARENTAL_GUIDE_ITEM_IN_MS,
    PARENTAL_GUIDE_HOLD_MS,
    PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS,
    PARENTAL_GUIDE_ITEM_EXIT_MS,
    PARENTAL_GUIDE_LINE_OUT_DELAY_MS,
    PARENTAL_GUIDE_LINE_OUT_MS,
    PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS,
    PARENTAL_GUIDE_CONTAINER_OUT_MS,
    t,
    clamp,
    escapeHtml
  } = internals;

  return {
    renderParentalGuideOverlay() {
      const overlay = this.uiRefs?.parentalGuide;
      if (!overlay) {
        return;
      }

      const shouldRender = (this.parentalGuideVisible || this.parentalGuideExiting) && this.parentalWarnings.length;
      overlay.classList.toggle("hidden", !shouldRender);
      overlay.classList.toggle("is-exiting", Boolean(this.parentalGuideExiting));
      if (!shouldRender) {
        overlay.innerHTML = "";
        overlay.style.removeProperty("animation-delay");
        overlay.style.removeProperty("--parental-item-count");
        overlay.style.removeProperty("--parental-line-height");
        overlay.style.removeProperty("--parental-line-exit-delay");
        overlay.style.removeProperty("--parental-container-exit-delay");
        this.stopParentalGuideLineAnimation();
        return;
      }

      const total = this.parentalWarnings.length;
      const firstItemDelay = PARENTAL_GUIDE_CONTAINER_IN_MS + PARENTAL_GUIDE_LINE_IN_MS + PARENTAL_GUIDE_ITEM_STAGGER_MS;
      const lineExitDelay =
        Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) + PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
      const containerExitDelay = lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
      const rowHeight = PARENTAL_GUIDE_ROW_HEIGHT;
      const rowGap = PARENTAL_GUIDE_ROW_GAP;
      const lineHeight = rowHeight * total + rowGap * Math.max(0, total - 1);
      const currentLineHeight = clamp(Number(this.parentalGuideLineProgress || 0), 0, lineHeight);
      overlay.style.animationDelay = this.parentalGuideExiting ? `${containerExitDelay}ms` : "0ms";
      overlay.style.setProperty("--parental-row-height", `${rowHeight}px`);
      overlay.style.setProperty("--parental-row-gap", `${rowGap}px`);
      overlay.style.setProperty("--parental-item-count", String(total));
      overlay.style.setProperty("--parental-line-height", `${lineHeight}px`);
      overlay.style.setProperty("--parental-line-exit-delay", `${lineExitDelay}ms`);
      overlay.style.setProperty("--parental-container-exit-delay", `${containerExitDelay}ms`);
      overlay.innerHTML = `
          <div class="player-parental-line">
            <div class="player-parental-line-fill"></div>
          </div>
          <div class="player-parental-list">
            ${this.parentalWarnings
              .map((warning, index) => {
                const enterDelay = firstItemDelay + index * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS);
                const exitDelay =
                  PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS +
                  (total - index - 1) * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS);
                const activeDelay = this.parentalGuideExiting ? exitDelay : enterDelay;
                return `
              <div class="player-parental-item" style="animation-delay:${activeDelay}ms;--parental-enter-delay:${enterDelay}ms;--parental-exit-delay:${exitDelay}ms">
                <span class="player-parental-label">${escapeHtml(warning.label)}</span>
                <span class="player-parental-separator"> · </span>
                <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
              </div>
            `;
              })
              .join("")}
          </div>
        `;

      const line = overlay.querySelector(".player-parental-line");
      if (line) {
        line.style.height = `${currentLineHeight.toFixed(2)}px`;
      }
    },
    stopParentalGuideLineAnimation({ reset = true } = {}) {
      if (this.parentalGuideLineEnterTimer) {
        clearTimeout(this.parentalGuideLineEnterTimer);
        this.parentalGuideLineEnterTimer = null;
      }
      if (this.parentalGuideLineExitTimer) {
        clearTimeout(this.parentalGuideLineExitTimer);
        this.parentalGuideLineExitTimer = null;
      }
      if (this.parentalGuideLineAnimationFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
      }
      this.parentalGuideLineAnimationFrame = null;
      if (reset) {
        this.parentalGuideLineProgress = 0;
        const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
        if (line) {
          line.style.height = "0px";
        }
      }
    },
    animateParentalGuideLine(targetProgress, durationMs = 1) {
      const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
      if (!line) {
        return;
      }

      const target = Math.max(0, Number(targetProgress || 0));
      const from = Math.max(0, Number(this.parentalGuideLineProgress || 0));
      if (typeof requestAnimationFrame !== "function") {
        this.parentalGuideLineProgress = target;
        line.style.height = `${Math.max(0, target).toFixed(2)}px`;
        return;
      }

      if (this.parentalGuideLineAnimationFrame != null) {
        cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
        this.parentalGuideLineAnimationFrame = null;
      }

      const startedAt = performance?.now?.() ?? Date.now();
      const tick = (timestamp) => {
        const elapsed = Math.max(0, Number(timestamp || Date.now()) - startedAt);
        const progress = clamp(elapsed / Math.max(1, Number(durationMs || 1)), 0, 1);
        this.parentalGuideLineProgress = from + (target - from) * parentalGuideEasing(progress);
        line.style.height = `${Math.max(0, this.parentalGuideLineProgress).toFixed(2)}px`;
        if (progress < 1) {
          this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
          return;
        }
        this.parentalGuideLineAnimationFrame = null;
      };

      this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
    },
    scheduleParentalGuideLineAnimation(targetProgress, delayMs, durationMs) {
      const start = () => {
        this.parentalGuideLineEnterTimer = null;
        this.animateParentalGuideLine(targetProgress, durationMs);
      };
      if (delayMs > 0) {
        this.parentalGuideLineEnterTimer = setTimeout(start, delayMs);
        return;
      }
      start();
    },
    showParentalGuideOverlay() {
      if (!this.parentalWarnings.length) {
        return;
      }

      this.parentalGuideVisible = true;
      this.parentalGuideExiting = false;
      this.parentalGuideShown = true;
      this.renderParentalGuideOverlay();
      this.stopParentalGuideLineAnimation({ reset: true });
      const lineHeight =
        PARENTAL_GUIDE_ROW_HEIGHT * this.parentalWarnings.length + PARENTAL_GUIDE_ROW_GAP * Math.max(0, this.parentalWarnings.length - 1);
      this.scheduleParentalGuideLineAnimation(lineHeight, PARENTAL_GUIDE_CONTAINER_IN_MS, PARENTAL_GUIDE_LINE_IN_MS);

      if (this.parentalGuideTimer) {
        clearTimeout(this.parentalGuideTimer);
      }
      if (this.parentalGuideExitTimer) {
        clearTimeout(this.parentalGuideExitTimer);
        this.parentalGuideExitTimer = null;
      }

      const enterDuration =
        PARENTAL_GUIDE_CONTAINER_IN_MS +
        PARENTAL_GUIDE_LINE_IN_MS +
        this.parentalWarnings.length * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS);
      this.parentalGuideTimer = setTimeout(() => {
        this.hideParentalGuideOverlay();
      }, enterDuration + PARENTAL_GUIDE_HOLD_MS);
    },
    hideParentalGuideOverlay() {
      if (this.parentalGuideTimer) {
        clearTimeout(this.parentalGuideTimer);
        this.parentalGuideTimer = null;
      }
      if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
        this.parentalGuideVisible = false;
        this.parentalGuideExiting = false;
        this.renderParentalGuideOverlay();
        return;
      }

      this.parentalGuideVisible = false;
      this.parentalGuideExiting = true;
      this.renderParentalGuideOverlay();
      this.stopParentalGuideLineAnimation({ reset: false });

      if (this.parentalGuideExitTimer) {
        clearTimeout(this.parentalGuideExitTimer);
      }
      const total = this.parentalWarnings.length;
      const lineExitDelay =
        Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) + PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
      const containerExitDelay = lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
      this.parentalGuideLineExitTimer = setTimeout(() => {
        this.parentalGuideLineExitTimer = null;
        this.animateParentalGuideLine(0, PARENTAL_GUIDE_LINE_OUT_MS);
      }, lineExitDelay);
      this.parentalGuideExitTimer = setTimeout(() => {
        this.parentalGuideExiting = false;
        this.parentalGuideExitTimer = null;
        this.stopParentalGuideLineAnimation();
        this.renderParentalGuideOverlay();
      }, containerExitDelay + PARENTAL_GUIDE_CONTAINER_OUT_MS);
    },
    toggleEpisodePanel() {
      if (!this.episodes.length) {
        return;
      }
      if (this.episodePanelVisible) {
        this.hideEpisodePanel();
        return;
      }
      this.closeChaptersPanel?.({ restoreFocus: false });
      this.episodePanelVisible = true;
      this.episodePanelMode = "episodes";
      this.episodePanelStreamsError = "";
      this.episodePanelStreamsLoading = false;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.sourcesPanelVisible = false;
      this.syncEpisodePanelSeasonToIndex();
      this.episodePanelFocusZone = "episodes";
      this.updateModalBackdrop();
      this.setControlsVisible(true, { focus: false });
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.renderEpisodePanel();
    },
    getEpisodePanelSeasons() {
      const seen = new Set();
      const seasons = [];
      this.episodes.forEach((episode) => {
        const season = Number(episode?.season);
        if (!Number.isFinite(season) || seen.has(season)) {
          return;
        }
        seen.add(season);
        seasons.push(season);
      });
      const regular = seasons.filter((season) => season > 0).sort((left, right) => left - right);
      const specials = seasons.filter((season) => season === 0);
      return [...regular, ...specials];
    },
    getEpisodePanelSeasonLabel(season) {
      if (!Number.isFinite(Number(season))) {
        return t("episodes_panel_title", {}, "Episodes");
      }
      return Number(season) === 0 ? t("episodes_specials", {}, "Specials") : t("episodes_season", [Number(season)], "Season %1$d");
    },
    syncEpisodePanelSeasonToIndex() {
      const seasons = this.getEpisodePanelSeasons();
      if (seasons.length <= 1) {
        this.episodePanelSeason = null;
        this.episodePanelSeasonIndex = 0;
        return;
      }
      const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
      const selectedSeason = Number(selectedEpisode?.season);
      const fallbackSeason = Number(this.params?.season);
      const resolvedSeason = Number.isFinite(selectedSeason)
        ? selectedSeason
        : Number.isFinite(fallbackSeason)
          ? fallbackSeason
          : seasons[0];
      const seasonIndex = Math.max(0, seasons.indexOf(resolvedSeason));
      this.episodePanelSeasonIndex = seasonIndex;
      this.episodePanelSeason = seasons[seasonIndex] ?? seasons[0];
    },
    getEpisodePanelEntries() {
      const seasons = this.getEpisodePanelSeasons();
      const activeSeason = seasons.length > 1 ? Number(this.episodePanelSeason) : null;
      return this.episodes
        .map((episode, index) => ({ episode, index }))
        .filter(({ episode }) => activeSeason == null || Number(episode?.season) === activeSeason);
    },
    moveEpisodePanel(delta) {
      if (!this.episodePanelVisible || !this.episodes.length) {
        return;
      }
      const entries = this.getEpisodePanelEntries();
      if (!entries.length) {
        return;
      }
      const currentPosition = Math.max(
        0,
        entries.findIndex((entry) => entry.index === this.episodePanelIndex)
      );
      const nextPosition = clamp(currentPosition + delta, 0, entries.length - 1);
      this.episodePanelIndex = entries[nextPosition]?.index ?? this.episodePanelIndex;
      this.episodePanelFocusZone = "episodes";
      this.renderEpisodePanel();
    },
    moveEpisodePanelSeason(delta) {
      const seasons = this.getEpisodePanelSeasons();
      if (seasons.length <= 1) {
        return;
      }
      const currentIndex = seasons.indexOf(Number(this.episodePanelSeason));
      const nextIndex = clamp((currentIndex >= 0 ? currentIndex : this.episodePanelSeasonIndex) + delta, 0, seasons.length - 1);
      this.episodePanelSeasonIndex = nextIndex;
      this.episodePanelSeason = seasons[nextIndex];
      const firstEntry = this.getEpisodePanelEntries()[0];
      if (firstEntry) {
        this.episodePanelIndex = firstEntry.index;
      }
      this.episodePanelFocusZone = "seasons";
      this.renderEpisodePanel();
    },
    getEpisodePanelStreamFilters() {
      const addons = [];
      (this.episodePanelStreams || []).forEach((stream) => {
        const addonName = String(stream?.addonName || "").trim();
        if (addonName && !addons.includes(addonName)) {
          addons.push(addonName);
        }
      });
      return ["all", ...addons];
    }
  };
}
