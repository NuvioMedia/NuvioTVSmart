/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

export function createPlayerScreenMethods04() {
  const {
    renderLoadingIndicator,
    formatHeroRuntime,
    localizedGenreLabel,
    POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED,
    t,
    escapeHtml,
    escapeAttribute
  } = internals;

  return {
    syncPostPlayBackdropTransition(mount, previousImage, previousRecommendationId, recommendationId) {
      const backdrop = mount?.querySelector?.(".player-post-play-backdrop");
      const currentImage = backdrop?.querySelector?.(".player-post-play-backdrop-image.is-current");
      if (!backdrop || !currentImage) {
        return;
      }
      if (!previousImage || !previousRecommendationId || previousRecommendationId === recommendationId) {
        currentImage.classList.add("is-current");
        return;
      }
      const oldImage = previousImage.cloneNode(true);
      oldImage.className = "player-post-play-backdrop-image is-previous";
      backdrop.appendChild(oldImage);
      currentImage.classList.remove("is-current");
      currentImage.classList.add("is-entering");
      const reveal = () => currentImage.classList.add("is-loaded");
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(reveal);
      } else {
        setTimeout(reveal, 0);
      }
      this.postPlayBackdropTransitionTimer = setTimeout(() => {
        oldImage.remove?.();
        currentImage.classList.remove("is-entering", "is-loaded");
        currentImage.classList.add("is-current");
        this.postPlayBackdropTransitionTimer = null;
      }, 350);
    },
    renderPostPlayRecommendation() {
      const mount = this.uiRefs?.postPlay;
      if (!mount) {
        return;
      }
      const state = this.getPostPlayState();
      const recommendation = state.recommendation;
      if (!state.isVisible && !state.hasReturnedToPlayer) {
        this.clearPostPlayTrailerActionTransition();
        mount.classList.remove("is-rendered", "is-exiting", "is-loading");
        mount.setAttribute("aria-hidden", "true");
        mount.innerHTML = "";
        this.postPlayRenderedSignature = "";
        return;
      }
      if (!recommendation && !state.isVisible) {
        this.clearPostPlayTrailerActionTransition();
        mount.classList.add("is-exiting");
        mount.classList.remove("is-rendered", "is-loading");
        mount.setAttribute("aria-hidden", "true");
        return;
      }
      if (!recommendation) {
        this.clearPostPlayTrailerActionTransition();
        mount.classList.add("is-loading", "is-rendered");
        mount.classList.remove("is-exiting");
        mount.setAttribute("aria-hidden", "false");
        mount.innerHTML = `<div class="player-post-play-loading-content">${renderLoadingIndicator({ className: "player-post-play-loading-spinner" })}</div>`;
        return;
      }

      const isSeries = recommendation.contentType === "series";
      const backdrop = recommendation.backdrop || recommendation.background || recommendation.poster;
      const currentTitle = this.getPostPlayCurrentTitle();
      const header = currentTitle
        ? t("player_post_play_because", { title: currentTitle }, `Because you watched ${currentTitle}`)
        : t("player_post_play_recommended", {}, "Recommended for you");
      const genres = (Array.isArray(recommendation.genres) ? recommendation.genres : [])
        .map(localizedGenreLabel)
        .filter(Boolean)
        .slice(0, 2);
      const details = [...genres, recommendation.releaseInfo || "", formatHeroRuntime(recommendation.runtime) || ""].filter(Boolean);
      const standardRatings = this.renderPostPlayStandardRatings(recommendation);
      const mdbListRatings = this.renderPostPlayMdbListRatings(recommendation);
      const trailerFeatureEnabled = Boolean(POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED);
      const trailerAvailable =
        trailerFeatureEnabled && !state.isTrailerPlaying && Boolean(recommendation.trailerYtId || recommendation.trailerVideoUrl);
      const trailerLabel = state.isTrailerPlaying
        ? t("player_post_play_trailer_playing", {}, "Trailer playing")
        : state.countdownSeconds != null
          ? t("player_post_play_trailer_countdown", { seconds: state.countdownSeconds }, `Trailer in ${state.countdownSeconds}`)
          : t("player_post_play_trailer", {}, "Trailer");
      const primaryLabel = isSeries ? t("tmdb_details_title", {}, "Details") : t("player_post_play_play", {}, "Play");
      const primaryActionIcon = isSeries
        ? `<svg class="player-post-play-action-icon player-post-play-info-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" fill="currentColor" /></svg>`
        : `<img class="player-post-play-action-icon" src="assets/icons/ic_player_play.svg" alt="" />`;
      const signature = JSON.stringify([
        recommendation.id,
        recommendation.title,
        recommendation.logo,
        recommendation.backdrop,
        recommendation.description,
        recommendation.releaseInfo,
        recommendation.runtime,
        recommendation.imdbRating,
        recommendation.tmdbRating,
        recommendation.showStandardRatings,
        JSON.stringify(recommendation.genres || []),
        recommendation.country,
        recommendation.language,
        recommendation.status,
        recommendation.ageRating,
        recommendation.trailerYtId,
        recommendation.trailerVideoUrl,
        recommendation.detailsLoaded,
        JSON.stringify(recommendation.mdbListRatings || null),
        state.recommendationIndex,
        state.isChangingRecommendation,
        state.canReturnToPlayer,
        this.postPlayManualDialogVisible,
        this.postPlaySynopsisVisible,
        this.postPlayFocusedAction
      ]);
      mount.classList.add("is-rendered");
      mount.classList.remove("is-exiting", "is-loading");
      mount.setAttribute("aria-hidden", "false");
      if (signature === this.postPlayRenderedSignature) {
        this.syncPostPlayDynamicState(mount, state, recommendation);
        this.syncPostPlayTrailerMedia();
        return;
      }
      this.clearPostPlayBackdropTransition();
      const previousBackdrop = mount.querySelector(".player-post-play-backdrop");
      const previousSummary = mount.querySelector(".player-post-play-summary");
      const previousBackdropId = String(previousBackdrop?.dataset?.recommendationId || "");
      const previousBackdropImage =
        previousBackdrop?.querySelector?.(".player-post-play-backdrop-image.is-current, .player-post-play-backdrop-image.is-entering") ||
        previousBackdrop?.querySelector?.(".player-post-play-backdrop-image");
      const previousTrailerSlot = mount.querySelector(".player-post-play-trailer-slot");
      const previousTrailerVisible = Boolean(previousTrailerSlot?.classList.contains("is-visible"));
      const initialTrailerVisible = previousTrailerSlot ? previousTrailerVisible : trailerAvailable;
      const trailerVisibilityChanged = Boolean(previousTrailerSlot) && initialTrailerVisible !== trailerAvailable;
      this.postPlayRenderedSignature = signature;
      mount.innerHTML = `
          <div class="player-post-play-background" aria-hidden="true">
          <div class="player-post-play-backdrop" data-recommendation-id="${escapeAttribute(recommendation.id)}" aria-hidden="true">
            ${backdrop ? `<img class="player-post-play-backdrop-image is-current" src="${escapeAttribute(backdrop)}" alt="" decoding="async" />` : ""}
          </div>
          <div class="player-post-play-trailer-media" aria-hidden="true"></div>
          <div class="player-post-play-scrim" aria-hidden="true"></div>
          </div>
          ${this.renderPostPlayPlayerWindow(state)}
          <div class="player-post-play-content${state.isChangingRecommendation ? " is-changing" : ""}">
            <div class="player-post-play-summary">
              <div class="player-post-play-header-block">
                <div class="player-post-play-header">${escapeHtml(header)}</div>
              </div>
              <div class="player-post-play-identity">
                <div class="player-post-play-identity-content">
                  ${
                    recommendation.logo
                      ? `<img class="player-post-play-logo is-loading" data-player-post-play-logo src="${escapeAttribute(recommendation.logo)}" alt="${escapeAttribute(recommendation.title)}" decoding="async" />`
                      : ""
                  }
                  <div class="player-post-play-title-states${recommendation.logo ? " is-logo-pending" : ""}" data-player-post-play-title-states${recommendation.logo ? " hidden" : ""}>
                    <h1 class="player-post-play-title player-post-play-title-state player-post-play-title-state--normal" aria-hidden="true">${escapeHtml(recommendation.title)}</h1>
                    <h1 class="player-post-play-title player-post-play-title-state player-post-play-title-state--trailer" aria-hidden="true">${escapeHtml(recommendation.title)}</h1>
                  </div>
                </div>
              </div>
              <div class="player-post-play-details-block">
                ${details.length || standardRatings ? `<div class="player-post-play-meta-row">${details.length ? `<div class="player-post-play-details">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join('<span class="player-post-play-detail-separator">  •  </span>')}</div>` : ""}${details.length && standardRatings ? '<span class="player-post-play-meta-separator">•</span>' : ""}${standardRatings}</div>` : ""}
                ${mdbListRatings}
                ${
                  recommendation.description
                    ? `<button class="player-post-play-synopsis focusable${this.postPlayDescriptionTruncated ? " is-truncated" : ""}" type="button" tabindex="-1" data-player-post-play-action="synopsis" aria-label="${escapeAttribute(t("hero_synopsis_read_more", {}, "Read more"))}"><span class="player-post-play-synopsis-text">${escapeHtml(recommendation.description)}</span><span class="player-post-play-synopsis-read-more">${escapeHtml(t("hero_synopsis_read_more", {}, "Read more"))}</span></button>`
                    : ""
                }
              </div>
            </div>
            <div class="player-post-play-actions${initialTrailerVisible ? " has-trailer" : ""}${state.recommendationCount > 1 ? " has-navigation" : ""}" role="group" aria-label="${escapeAttribute(t("player_post_play_recommended", {}, "Recommended for you"))}">
              <button class="player-post-play-action player-post-play-primary focusable${this.postPlayFocusedAction === "primary" ? " focused" : ""}" type="button" tabindex="-1" data-player-post-play-action="primary">
                ${primaryActionIcon}<span>${escapeHtml(primaryLabel)}</span>
              </button>
              ${
                trailerFeatureEnabled
                  ? `<div class="player-post-play-trailer-slot${initialTrailerVisible ? " is-visible" : ""}" data-player-post-play-trailer-slot aria-hidden="${String(!initialTrailerVisible)}"><button class="player-post-play-action player-post-play-trailer-button focusable${this.postPlayFocusedAction === "trailer" ? " focused" : ""}" type="button" tabindex="-1" data-player-post-play-action="trailer"${trailerAvailable && initialTrailerVisible ? "" : " disabled"} aria-hidden="${String(!(trailerAvailable && initialTrailerVisible))}" aria-label="${escapeAttribute(trailerLabel)}"><img class="player-post-play-action-icon" src="assets/icons/trailer_play_button.svg" alt="" /><span class="player-post-play-trailer-label" data-player-post-play-trailer-label>${escapeHtml(trailerLabel)}</span></button></div>`
                  : ""
              }
              ${
                state.recommendationCount > 1
                  ? `<button class="player-post-play-action player-post-play-nav focusable${this.postPlayFocusedAction === "previous" ? " focused" : ""}" type="button" tabindex="-1" data-player-post-play-action="previous"${state.canNavigatePrevious ? "" : " disabled"} aria-label="${escapeAttribute(t("player_post_play_previous_recommendation", {}, "Previous recommendation"))}"><img class="player-post-play-nav-icon player-post-play-nav-icon-previous" src="assets/icons/ic_chevron_compact_left.png" alt="" /></button>
                     <button class="player-post-play-action player-post-play-nav focusable${this.postPlayFocusedAction === "next" ? " focused" : ""}" type="button" tabindex="-1" data-player-post-play-action="next"${state.canNavigateNext ? "" : " disabled"} aria-label="${escapeAttribute(t("player_post_play_next_recommendation", {}, "Next recommendation"))}"><img class="player-post-play-nav-icon player-post-play-nav-icon-next" src="assets/icons/ic_chevron_compact_left.png" alt="" /></button>`
                  : ""
              }
            </div>
          </div>
          ${this.renderPostPlayManualDialog(recommendation)}
          ${this.renderPostPlaySynopsisDialog(recommendation)}
        `;
      this.syncPostPlayBackdropTransition(mount, previousBackdropImage, previousBackdropId, String(recommendation.id || ""));
      this.syncPostPlayDynamicState(mount, state, recommendation, {
        animateTrailerTransition: trailerVisibilityChanged,
        initialTrailerVisible
      });
      this.syncPostPlaySummaryTransition(mount, previousSummary, previousBackdropId, String(recommendation.id || ""));
      this.schedulePostPlayDescriptionMeasurement();
      this.syncPostPlayTrailerMedia();
    },
    renderPostPlayPlayerWindow(state = this.getPostPlayState()) {
      if (!state.canReturnToPlayer) {
        return "";
      }
      return `
          <button
            class="player-post-play-player-window player-post-play-action focusable${this.postPlayFocusedAction === "playerWindow" ? " focused" : ""}"
            type="button"
            tabindex="-1"
            data-player-post-play-action="playerWindow"
            aria-label="${escapeAttribute(t("player_post_play_return_to_player", {}, "Return to player"))}"
          ></button>
        `;
    },
    schedulePostPlayDescriptionMeasurement() {
      if (this.postPlayDescriptionMeasureFrame) {
        cancelAnimationFrame(this.postPlayDescriptionMeasureFrame);
        this.postPlayDescriptionMeasureFrame = null;
      }
      if (typeof requestAnimationFrame !== "function") {
        return;
      }
      this.postPlayDescriptionMeasureFrame = requestAnimationFrame(() => {
        this.postPlayDescriptionMeasureFrame = null;
        const description = this.uiRefs?.postPlay?.querySelector(".player-post-play-synopsis");
        const descriptionText = description?.querySelector?.(".player-post-play-synopsis-text") || description;
        if (!descriptionText || !descriptionText.isConnected) {
          return;
        }
        const truncated = descriptionText.scrollHeight > descriptionText.clientHeight + 1;
        this.postPlayDescriptionTruncated = truncated;
        description.classList.toggle("is-truncated", truncated);
      });
    },
    getPostPlayFocusableActions() {
      return Array.from(this.uiRefs?.postPlay?.querySelectorAll?.(".focusable[data-player-post-play-action]:not([disabled])") || []);
    },
    focusPostPlayAction(action = "primary") {
      const mount = this.uiRefs?.postPlay;
      if (!mount) {
        return false;
      }
      const actions = this.getPostPlayFocusableActions();
      const requestedAction = String(action || "primary");
      const node =
        actions.find((entry) => entry.dataset.playerPostPlayAction === requestedAction) ||
        actions.find((entry) => entry.dataset.playerPostPlayAction === "primary") ||
        actions[0];
      if (!node || node.disabled) {
        return false;
      }
      this.postPlayFocusedAction = String(node.dataset.playerPostPlayAction || action);
      actions.forEach((entry) => {
        entry.classList.toggle("focused", entry === node);
      });
      focusWithoutScroll(node);
      return true;
    },
    clearPostPlayFocusTimer() {
      if (this.postPlayFocusTimer) {
        clearTimeout(this.postPlayFocusTimer);
        this.postPlayFocusTimer = null;
      }
    },
    schedulePostPlayFocus(action = "primary", delayMs = 420) {
      this.clearPostPlayFocusTimer();
      this.postPlayFocusTimer = setTimeout(
        () => {
          this.postPlayFocusTimer = null;
          if (this.isPostPlayVisible()) {
            this.focusPostPlayAction(action);
          }
        },
        Math.max(0, Number(delayMs) || 0)
      );
    },
    clearPostPlayLongPressTimer() {
      if (this.postPlayLongPressTimer) {
        clearTimeout(this.postPlayLongPressTimer);
        this.postPlayLongPressTimer = null;
      }
    },
    triggerPostPlayLongPress() {
      if (
        !this.postPlayPendingSelect ||
        this.postPlayPendingSelectAction !== "primary" ||
        this.postPlayLongPressTriggered ||
        this.getPostPlayState().recommendation?.contentType !== "movie" ||
        !this.isPostPlayManualPlayOptionEnabled()
      ) {
        return false;
      }
      this.postPlayLongPressTriggered = true;
      this.clearPostPlayLongPressTimer();
      this.openPostPlayManualDialog();
      return true;
    }
  };
}
