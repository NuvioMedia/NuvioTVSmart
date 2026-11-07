/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

export function createPlayerScreenMethods03() {
  const { POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED, t, escapeHtml, escapeAttribute } = internals;

  return {
    renderPostPlayManualDialog(recommendation = {}) {
      if (!this.postPlayManualDialogVisible) {
        return "";
      }
      return `
          <div class="nuvio-dialog-backdrop nuvio-dialog-backdrop-enter" data-player-post-play-modal="manual">
            <section class="nuvio-dialog-panel nuvio-dialog-panel-enter player-post-play-manual-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttribute(recommendation.title || "")}" style="max-width:54.2vw">
              <div class="nuvio-dialog-title">${escapeHtml(recommendation.title || "")}</div>
              <div class="nuvio-dialog-subtitle">${escapeHtml(t("hero_play", {}, { fallback: "Play" }))}</div>
              <div class="nuvio-dialog-actions">
                <button class="nuvio-dialog-button focusable focused" type="button" tabindex="-1" data-player-post-play-action="manualPlay">
                  <span class="nuvio-dialog-button-label">${escapeHtml(t("player_post_play_play_manually", {}, "Play manually"))}</span>
                </button>
              </div>
            </section>
          </div>
        `;
    },
    renderPostPlaySynopsisDialog(recommendation = {}) {
      if (!this.postPlaySynopsisVisible) {
        return "";
      }
      return `
          <section class="player-post-play-synopsis-overlay" data-player-post-play-modal="synopsis" role="dialog" aria-modal="true" aria-label="${escapeAttribute(recommendation.title || "Description")}">
            <h2 class="player-post-play-synopsis-title">${escapeHtml(recommendation.title || "")}</h2>
            <div class="player-post-play-synopsis-scroll" tabindex="-1" data-player-post-play-synopsis-content>
              <p class="player-post-play-synopsis-full-text">${escapeHtml(recommendation.description || "")}</p>
            </div>
            <div class="player-post-play-synopsis-hint">${escapeHtml(t("hero_synopsis_dismiss_hint", {}, "Press back to close"))}</div>
          </section>
        `;
    },
    clearPostPlaySynopsisScrollAnimation() {
      if (this.postPlaySynopsisScrollFrame) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.postPlaySynopsisScrollFrame);
        }
        this.postPlaySynopsisScrollFrame = null;
      }
      this.postPlaySynopsisScrollTarget = null;
      this.postPlaySynopsisScrollPreviousFrameAt = 0;
    },
    focusPostPlaySynopsisContent() {
      const content = this.uiRefs?.postPlay?.querySelector?.("[data-player-post-play-synopsis-content]");
      if (!content) {
        return false;
      }
      this.clearPostPlaySynopsisScrollAnimation();
      content.scrollTop = 0;
      this.uiRefs?.postPlay?.querySelectorAll?.(".focusable.focused")?.forEach?.((node) => {
        node.classList.remove("focused");
      });
      const focus = () => {
        if (!this.postPlaySynopsisVisible || !content.isConnected) {
          return;
        }
        focusWithoutScroll(content);
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(focus));
      } else {
        setTimeout(focus, 0);
      }
      return true;
    },
    scrollPostPlaySynopsis(direction = 1) {
      const content = this.uiRefs?.postPlay?.querySelector?.("[data-player-post-play-synopsis-content]");
      if (!content) {
        return false;
      }
      const maxScroll = Math.max(0, Number(content.scrollHeight || 0) - Number(content.clientHeight || 0));
      if (maxScroll <= 0) {
        return true;
      }
      const current = Number(content.scrollTop || 0);
      const baseTarget = Number.isFinite(this.postPlaySynopsisScrollTarget) ? this.postPlaySynopsisScrollTarget : current;
      const target = Math.max(0, Math.min(maxScroll, baseTarget + (Number(direction) >= 0 ? 260 : -260)));
      this.postPlaySynopsisScrollTarget = target;
      if (this.postPlaySynopsisScrollFrame || target === current) {
        return true;
      }
      if (typeof requestAnimationFrame !== "function") {
        content.scrollTop = target;
        return true;
      }
      this.postPlaySynopsisScrollPreviousFrameAt = 0;
      const animate = (timestamp) => {
        this.postPlaySynopsisScrollFrame = null;
        if (!this.postPlaySynopsisVisible || !content.isConnected) {
          this.clearPostPlaySynopsisScrollAnimation();
          return;
        }
        const elapsedSeconds = this.postPlaySynopsisScrollPreviousFrameAt
          ? Math.min(0.05, Math.max(0, (timestamp - this.postPlaySynopsisScrollPreviousFrameAt) / 1000))
          : 0;
        this.postPlaySynopsisScrollPreviousFrameAt = timestamp;
        const requestedTarget = Number(this.postPlaySynopsisScrollTarget ?? content.scrollTop);
        const distance = requestedTarget - Number(content.scrollTop || 0);
        if (Math.abs(distance) < 0.5) {
          content.scrollTop = requestedTarget;
          this.postPlaySynopsisScrollPreviousFrameAt = 0;
          return;
        }
        const smoothing = elapsedSeconds > 0 ? 1 - Math.exp(-12 * elapsedSeconds) : 0.16;
        content.scrollTop += distance * smoothing;
        this.postPlaySynopsisScrollFrame = requestAnimationFrame(animate);
      };
      this.postPlaySynopsisScrollFrame = requestAnimationFrame(animate);
      return true;
    },
    clearPostPlayBackdropTransition() {
      if (this.postPlayBackdropTransitionTimer) {
        clearTimeout(this.postPlayBackdropTransitionTimer);
        this.postPlayBackdropTransitionTimer = null;
      }
    },
    clearPostPlaySummaryTransition() {
      if (this.postPlaySummaryTransitionTimer) {
        clearTimeout(this.postPlaySummaryTransitionTimer);
        this.postPlaySummaryTransitionTimer = null;
      }
      this.uiRefs?.postPlay?.querySelector?.(".player-post-play-summary-previous")?.remove?.();
    },
    syncPostPlaySummaryTransition(mount, previousSummary, previousRecommendationId, recommendationId) {
      const content = mount?.querySelector?.(".player-post-play-content");
      const currentSummary = content?.querySelector?.(".player-post-play-summary:not(.player-post-play-summary-previous)");
      if (!content || !currentSummary || !previousSummary || !previousRecommendationId || previousRecommendationId === recommendationId) {
        return;
      }

      this.clearPostPlaySummaryTransition();
      const previousLayer = previousSummary.cloneNode(true);
      previousLayer.className = "player-post-play-summary player-post-play-summary-previous";
      previousLayer.setAttribute("aria-hidden", "true");
      previousLayer.querySelectorAll?.("[data-player-post-play-action]")?.forEach?.((node) => {
        node.removeAttribute("data-player-post-play-action");
        node.setAttribute("tabindex", "-1");
      });
      content.insertBefore(previousLayer, currentSummary);
      currentSummary.classList.add("is-recommendation-changing");

      const reveal = () => {
        currentSummary.classList.add("is-recommendation-visible");
        previousLayer.classList.add("is-recommendation-exiting");
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(reveal);
      } else {
        setTimeout(reveal, 0);
      }
      this.postPlaySummaryTransitionTimer = setTimeout(() => {
        previousLayer.remove?.();
        currentSummary.classList.remove("is-recommendation-changing", "is-recommendation-visible");
        this.postPlaySummaryTransitionTimer = null;
      }, 350);
    },
    clearPostPlayTrailerActionTransition() {
      if (this.postPlayTrailerActionTransitionFrame != null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.postPlayTrailerActionTransitionFrame);
        } else {
          clearTimeout(this.postPlayTrailerActionTransitionFrame);
        }
        this.postPlayTrailerActionTransitionFrame = null;
      }
      if (this.postPlayTrailerLabelTimer) {
        clearTimeout(this.postPlayTrailerLabelTimer);
        this.postPlayTrailerLabelTimer = null;
      }
    },
    syncPostPlayTrailerLabel(node, nextText) {
      if (!node) {
        return;
      }
      const text = String(nextText || "");
      if (node.textContent === text) {
        return;
      }
      if (this.postPlayTrailerLabelTimer) {
        clearTimeout(this.postPlayTrailerLabelTimer);
        this.postPlayTrailerLabelTimer = null;
      }
      node.classList.add("is-changing");
      this.postPlayTrailerLabelTimer = setTimeout(() => {
        this.postPlayTrailerLabelTimer = null;
        if (!node || node.isConnected === false) {
          return;
        }
        node.textContent = text;
        const reveal = () => node.classList.remove("is-changing");
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(reveal);
        } else {
          setTimeout(reveal, 0);
        }
      }, 100);
    },
    syncPostPlayIdentityAssets(mount) {
      const logo = mount?.querySelector?.("[data-player-post-play-logo]");
      const titleStates = mount?.querySelector?.("[data-player-post-play-title-states]");
      if (!logo) {
        if (titleStates) {
          titleStates.hidden = false;
        }
        return;
      }

      const showTitleFallback = () => {
        logo.hidden = true;
        logo.classList.remove("is-loaded");
        if (titleStates) {
          titleStates.hidden = false;
        }
      };
      const showLogo = () => {
        logo.hidden = false;
        logo.classList.add("is-loaded");
        if (titleStates) {
          titleStates.hidden = true;
        }
      };
      if (!logo.dataset.postPlayAssetBound) {
        logo.dataset.postPlayAssetBound = "true";
        logo.addEventListener("load", showLogo, { once: true });
        logo.addEventListener("error", showTitleFallback, { once: true });
      }
      if (logo.complete) {
        if (Number(logo.naturalWidth || 0) > 0) {
          showLogo();
        } else {
          showTitleFallback();
        }
      }
    },
    syncPostPlayDynamicState(mount, state, recommendation, { animateTrailerTransition = false, initialTrailerVisible = false } = {}) {
      const actions = mount?.querySelector?.(".player-post-play-actions");
      const trailerSlot = mount?.querySelector?.(".player-post-play-trailer-slot");
      const trailerButton = trailerSlot?.querySelector?.('[data-player-post-play-action="trailer"]');
      const trailerLabelNode = trailerButton?.querySelector?.("[data-player-post-play-trailer-label]");
      const targetTrailerVisible = Boolean(
        POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED &&
        !state.isTrailerPlaying &&
        (recommendation?.trailerYtId || recommendation?.trailerVideoUrl)
      );
      this.clearPostPlayTrailerActionTransition();
      const trailerLabel = state.isTrailerPlaying
        ? t("player_post_play_trailer_playing", {}, "Trailer playing")
        : state.countdownSeconds != null
          ? t("player_post_play_trailer_countdown", { seconds: state.countdownSeconds }, `Trailer in ${state.countdownSeconds}`)
          : t("player_post_play_trailer", {}, "Trailer");

      this.syncPostPlayTrailerLabel(trailerLabelNode, trailerLabel);
      this.syncPostPlayIdentityAssets(mount);
      if (!actions || !trailerSlot || !trailerButton) {
        return;
      }

      const applyVisibility = (visible, interactive = targetTrailerVisible) => {
        actions.classList.toggle("has-trailer", Boolean(visible));
        trailerSlot.classList.toggle("is-visible", Boolean(visible));
        trailerSlot.setAttribute("aria-hidden", String(!visible));
        trailerButton.disabled = !(interactive && visible);
        trailerButton.setAttribute("aria-hidden", String(!(interactive && visible)));
        trailerButton.setAttribute("aria-label", trailerLabel);
      };

      if (animateTrailerTransition && initialTrailerVisible !== targetTrailerVisible) {
        applyVisibility(initialTrailerVisible, false);
        const reveal = () => {
          this.postPlayTrailerActionTransitionFrame = null;
          applyVisibility(targetTrailerVisible, targetTrailerVisible);
        };
        if (typeof requestAnimationFrame === "function") {
          this.postPlayTrailerActionTransitionFrame = requestAnimationFrame(reveal);
        } else {
          this.postPlayTrailerActionTransitionFrame = setTimeout(reveal, 0);
        }
        return;
      }
      applyVisibility(targetTrailerVisible, targetTrailerVisible);
    }
  };
}
