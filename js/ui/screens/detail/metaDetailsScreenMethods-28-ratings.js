/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";
import { ratingMediaReference, TrackingRatings } from "../../../core/tracking/trackingRatings.js";
import { formatRating, openRatingDialog, ratingProviderName } from "../../components/ratingDialog.js";
import { SimklSyncService } from "../../../data/repository/simklSyncService.js";
import { MdbListTracking } from "../../../data/repository/mdbListTracking.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

// Android Icons.Rounded.Star and StarOutline.
const STAR = "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
const STAR_OUTLINE =
  "m22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z";
// Android MetaDetailsScreen userMessage: shown for 2.5 s at the top.
const MESSAGE_DURATION_MS = 2500;

export function createMetaDetailsScreenMethods28() {
  const { t, escapeHtml, escapeAttribute, resolveMetaImdbId, resolveMetaTmdbId } = internals;

  return {
    titleRatingMedia() {
      return ratingMediaReference(
        { ...(this.meta || {}), imdbId: resolveMetaImdbId(this.meta, this.params), tmdbId: resolveMetaTmdbId(this.meta, this.params) },
        this.params || {}
      );
    },
    episodeRatingMedia(episode) {
      return ratingMediaReference(
        { ...(this.meta || {}), imdbId: resolveMetaImdbId(this.meta, this.params), tmdbId: resolveMetaTmdbId(this.meta, this.params) },
        this.params || {},
        episode
      );
    },
    /** Android RatingActionButton, between Mark watched and the trailer button. */
    renderRatingButton() {
      if (!this.meta) return "";
      const state = TrackingRatings.current(this.titleRatingMedia());
      if (!state.provider) return "";
      const rated = state.rating != null;
      const label = rated
        ? t("rating_value", [formatRating(state.rating)], `${formatRating(state.rating)} out of 10`)
        : t("rating_rate", {}, "Rate");
      return `<button class="series-circle-btn series-rating-btn focusable${rated ? " is-rated" : ""}" data-action="rateTitle" aria-label="${escapeAttribute(`${t("rating_your_rating", {}, "Your rating")}, ${label}`)}"><svg class="series-btn-svg series-rating-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${rated ? STAR : STAR_OUTLINE}" fill="currentColor"/></svg>${rated ? `<span class="series-rating-value">${escapeHtml(formatRating(state.rating))}</span>` : ""}</button>`;
    },
    /** Re-render the rate button in place, keeping focus, and twirl the star on a new rating. */
    syncRatingButton({ animate = false } = {}) {
      if (!this.container || !this.meta) return;
      const current = this.container.querySelector('[data-action="rateTitle"]');
      const markup = this.renderRatingButton();
      if (!current && !markup) return;
      if (!current || !markup) {
        // The button appears or disappears: re-render the hero so the action row stays in order.
        this.render(this.meta, this.captureDetailFocus());
        return;
      }
      const wasFocused = current.classList.contains("focused");
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      const next = holder.firstElementChild;
      if (wasFocused) next.classList.add("focused");
      if (animate && next.classList.contains("is-rated")) next.classList.add("is-twirling");
      current.replaceWith(next);
      if (wasFocused) focusWithoutScroll(next);
    },
    /** Android: ratings come from the provider's sync, so refresh it once the page is open. */
    refreshRatingSource() {
      const source = TrackingRatings.source();
      const token = this.detailLoadToken;
      const refresh = source === "simkl" ? SimklSyncService.refresh() : source === "mdblist" ? MdbListTracking.refresh() : null;
      if (!refresh) return;
      void Promise.resolve(refresh)
        .catch(() => false)
        .then(() => {
          if (token === this.detailLoadToken) this.syncRatingButton();
        });
    },
    /** Android MetaDetailsScreen rating results: Rating saved / removed / Couldn't update. */
    showRatingResult(result) {
      const message = !result.saved
        ? t("rating_failed", [ratingProviderName(result.provider)], `Couldn't update your rating on ${ratingProviderName(result.provider)}`)
        : result.removed
          ? t("rating_removed", {}, "Rating removed")
          : t("rating_saved", {}, "Rating saved");
      this.showDetailMessage(message, !result.saved);
    },
    showDetailMessage(message, isError = false) {
      if (!this.container) return;
      let node = this.container.querySelector(".detail-user-message");
      if (!node) {
        node = document.createElement("div");
        node.className = "detail-user-message";
        node.setAttribute("role", "status");
        this.container.appendChild(node);
      }
      node.textContent = String(message || "");
      node.classList.toggle("is-error", Boolean(isError));
      node.classList.add("visible");
      clearTimeout(this.detailMessageTimer);
      this.detailMessageTimer = setTimeout(() => node.classList.remove("visible"), MESSAGE_DURATION_MS);
    },
    openTitleRatingDialog() {
      const media = this.titleRatingMedia();
      const state = TrackingRatings.current(media);
      if (!state.provider) return false;
      const focusRestore = this.captureDetailFocus();
      const token = this.detailLoadToken;
      openRatingDialog({
        media,
        title: this.meta?.name || this.params?.fallbackTitle || "",
        state,
        onBack: () => {
          if (token === this.detailLoadToken) this.restoreDetailFocusAfterRating(focusRestore);
        },
        onFinished: (result) => {
          if (token !== this.detailLoadToken) return;
          this.syncRatingButton({ animate: true });
          this.restoreDetailFocusAfterRating(focusRestore);
          this.showRatingResult(result);
        }
      });
      return true;
    },
    restoreDetailFocusAfterRating(focusRestore) {
      const button = this.container?.querySelector('[data-action="rateTitle"]');
      if (button) {
        this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
        button.classList.add("focused");
        focusWithoutScroll(button);
        return;
      }
      this.focusDetailDescriptor?.(focusRestore);
    },
    /** Android EpisodeOptionsOverlay: Rate episode opens the rating panel; Back returns to the actions. */
    openEpisodeRatingDialog(episode) {
      const media = this.episodeRatingMedia(episode);
      const state = TrackingRatings.current(media);
      if (!state.provider) return false;
      const token = this.detailLoadToken;
      const optionIndex = Number(this.episodeHoldMenu?.optionIndex || 0);
      const videoId = String(episode.id || "");
      this.episodeHoldMenu = null;
      this.destroyDetailHoldDialog();
      // The OK keyup that would settle the long press goes to the rating panel instead.
      this.cancelPendingEpisodeHold();
      openRatingDialog({
        media,
        title: this.meta?.name || this.params?.fallbackTitle || "",
        subtitle: [`S${Number(episode.season || 0)}E${Number(episode.episode || 0)}`, episode.title || ""].filter(Boolean).join(" - "),
        state,
        onBack: () => {
          if (token !== this.detailLoadToken) return;
          this.episodeHoldMenu = { videoId, optionIndex, episode: { ...episode } };
          this.mountEpisodeHoldDialog({ focusIndex: optionIndex, reopened: true });
        },
        onFinished: (result) => {
          if (token !== this.detailLoadToken) return;
          this.focusDetailDescriptor(this.getEpisodeFocusDescriptor(videoId));
          this.showRatingResult(result);
        }
      });
      return true;
    }
  };
}
