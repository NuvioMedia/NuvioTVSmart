/* eslint-disable no-unused-vars */
import * as internals from "./castDetailScreen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { FILMOGRAPHY_FILTERS } from "../../../core/tmdb/personCredits.js";

// Android HeroSection: D-pad up/down scrolls an open biography by 160 px.
const BIOGRAPHY_SCROLL_STEP_PX = 160;
// Keep the focused poster clear of the row's 48dp start/end padding.
const ROW_EDGE_PADDING_PX = 96;

export function createCastDetailScreenMethods02() {
  const { Router, posterItemFromNode, PosterOptionsDialogController, POSTER_HOLD_DELAY_MS, isBackEvent, getDirection } = internals;

  return {
    getPortrait() {
      return this.container?.querySelector(".cast-detail-portrait.focusable") || null;
    },
    getTabs() {
      return Array.from(this.container?.querySelectorAll(".cast-filmography-tab.focusable") || []);
    },
    getRowCards() {
      return Array.from(this.container?.querySelectorAll(".cast-film-card.focusable") || []);
    },
    getFocusTarget() {
      if (this.focusZone === "error") {
        return this.container?.querySelector(".cast-detail-retry") || null;
      }
      if (this.focusZone === "portrait") {
        return this.getPortrait();
      }
      if (this.focusZone === "tabs") {
        return this.getTabs()[Math.max(0, FILMOGRAPHY_FILTERS.indexOf(this.filmographyFilter))] || null;
      }
      const cards = this.getRowCards();
      return cards[Math.min(this.rowFocusIndex || 0, Math.max(0, cards.length - 1))] || null;
    },
    applyFocus({ instant = false } = {}) {
      const target = this.getFocusTarget() || this.getRowCards()[0] || this.getPortrait();
      if (!target) {
        return false;
      }
      this.container.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      focusWithoutScroll(target);
      this.container.querySelector(".cast-filmography-tabs")?.classList.toggle("has-focus", this.focusZone === "tabs");
      if (target.classList.contains("cast-film-card")) {
        this.focusZone = "row";
        this.rowFocusIndex = Number(target.dataset.cardIndex || 0);
        this.lastFocusedItemId = String(target.dataset.itemId || "");
        this.syncFocusedCardScroll({ instant });
      }
      return true;
    },
    setFocusZone(zone, { instant = false } = {}) {
      this.focusZone = zone;
      return this.applyFocus({ instant });
    },
    /** Android TabRow: a tab is selected as soon as it gets focus, and the row starts over. */
    selectFilter(filter) {
      if (!FILMOGRAPHY_FILTERS.includes(filter) || filter === this.filmographyFilter) {
        return;
      }
      this.filmographyFilter = filter;
      this.rowFocusIndex = 0;
      this.container.querySelectorAll(".cast-filmography-tab").forEach((tab) => {
        const selected = tab.dataset.filter === filter;
        tab.classList.toggle("is-selected", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
      });
      this.renderFilmographyRow();
      const track = this.container.querySelector(".cast-filmography-track");
      if (track) track.scrollLeft = 0;
    },
    setBiographyExpanded(expanded) {
      if (Boolean(this.biographyExpanded) === Boolean(expanded)) {
        return;
      }
      this.biographyExpanded = Boolean(expanded);
      // Android keeps focus on the portrait both while the biography opens and after it closes.
      this.focusZone = "portrait";
      this.render();
      const bioWrap = this.container.querySelector(".cast-detail-bio-wrap");
      if (bioWrap) bioWrap.scrollTop = 0;
    },
    scrollBiography(direction) {
      const bioWrap = this.container?.querySelector(".cast-detail-bio-wrap");
      if (!bioWrap) return false;
      const max = bioWrap.scrollHeight - bioWrap.clientHeight;
      const next = Math.max(0, Math.min(max, bioWrap.scrollTop + direction * BIOGRAPHY_SCROLL_STEP_PX));
      if (next === bioWrap.scrollTop) return false;
      if (typeof bioWrap.scrollTo === "function") {
        bioWrap.scrollTo({ top: next, behavior: "smooth" });
      } else {
        bioWrap.scrollTop = next;
      }
      return true;
    },
    handleDpad(event) {
      const direction = getDirection(event);
      if (!direction) {
        return false;
      }
      event?.preventDefault?.();
      const zone = this.focusZone;
      if (zone === "error") {
        return true;
      }
      if (zone === "portrait") {
        if (this.biographyExpanded) {
          if (direction === "up" || direction === "down") this.scrollBiography(direction === "down" ? 1 : -1);
          return true;
        }
        if (direction === "down") {
          if (this.getRowCards().length) this.setFocusZone("row");
          else if (this.getTabs().length) this.setFocusZone("tabs");
        }
        return true;
      }
      if (zone === "tabs") {
        if (direction === "left" || direction === "right") {
          const index = FILMOGRAPHY_FILTERS.indexOf(this.filmographyFilter) + (direction === "left" ? -1 : 1);
          if (FILMOGRAPHY_FILTERS[index]) {
            this.selectFilter(FILMOGRAPHY_FILTERS[index]);
            this.setFocusZone("tabs");
          }
          return true;
        }
        if (direction === "down" && this.getRowCards().length) {
          this.setFocusZone("row");
        } else if (direction === "up" && this.getPortrait()) {
          this.setFocusZone("portrait");
        }
        return true;
      }
      const cards = this.getRowCards();
      if (direction === "left" || direction === "right") {
        const next = (this.rowFocusIndex || 0) + (direction === "left" ? -1 : 1);
        if (cards[next]) {
          this.rowFocusIndex = next;
          this.applyFocus();
        }
        return true;
      }
      if (direction === "up") {
        // Android: the posters sit under the portrait, so Up goes to the selected tab first.
        if (this.getTabs().length) this.setFocusZone("tabs");
        else if (this.getPortrait()) this.setFocusZone("portrait");
      }
      return true;
    },
    syncFocusedCardScroll({ instant = false } = {}) {
      const focused = this.container?.querySelector(".cast-film-card.focusable.focused");
      const track = focused?.closest(".cast-filmography-track");
      if (!(track instanceof HTMLElement) || !(focused instanceof HTMLElement)) {
        return;
      }
      const trackRect = track.getBoundingClientRect();
      const focusRect = focused.getBoundingClientRect();
      let nextScrollLeft = track.scrollLeft;
      if (focusRect.left < trackRect.left + ROW_EDGE_PADDING_PX) {
        nextScrollLeft -= trackRect.left + ROW_EDGE_PADDING_PX - focusRect.left;
      } else if (focusRect.right > trackRect.right - ROW_EDGE_PADDING_PX) {
        nextScrollLeft += focusRect.right - (trackRect.right - ROW_EDGE_PADDING_PX);
      }
      nextScrollLeft = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, nextScrollLeft));
      if (Math.abs(nextScrollLeft - track.scrollLeft) < 1) {
        return;
      }
      if (!instant && typeof track.scrollTo === "function") {
        track.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
      } else {
        track.scrollLeft = nextScrollLeft;
      }
    },
    isPosterHoldTarget(node) {
      return node instanceof HTMLElement && node.classList.contains("cast-film-card") && String(node.dataset.action || "") === "openDetail";
    },
    cancelPendingPosterHold() {
      if (this.pendingPosterHoldTimer) {
        clearTimeout(this.pendingPosterHoldTimer);
        this.pendingPosterHoldTimer = null;
      }
      this.pendingPosterHoldTarget = null;
    },
    hasPendingPosterHold(node) {
      return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
    },
    startPendingPosterHold(node) {
      this.cancelPendingPosterHold();
      if (!this.isPosterHoldTarget(node)) {
        return;
      }
      this.pendingPosterHoldTarget = node;
      this.pendingPosterHoldTimer = setTimeout(() => {
        this.pendingPosterHoldTimer = null;
        const target = this.pendingPosterHoldTarget;
        this.pendingPosterHoldTarget = null;
        if (target?.isConnected && target.classList.contains("focused")) {
          void this.openPosterOptionsMenu(target);
        }
      }, POSTER_HOLD_DELAY_MS);
    },
    completePendingPosterHold(node, event = null) {
      if (!this.pendingPosterHoldTarget) {
        return false;
      }
      const target = this.pendingPosterHoldTarget;
      const hadTimer = Boolean(this.pendingPosterHoldTimer);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
      this.cancelPendingPosterHold();
      if (hadTimer && target === node) {
        if (heldLongEnough) {
          void this.openPosterOptionsMenu(target);
        } else {
          this.openDetailFromNode(target);
        }
      }
      return true;
    },
    async openPosterOptionsMenu(node) {
      const item = posterItemFromNode(node);
      if (!item?.id) {
        return false;
      }
      this.posterOptionsFocusRestore = String(item.id || "").trim();
      if (!this.posterOptionsController) {
        this.posterOptionsController = new PosterOptionsDialogController({
          onDetails: (target) => {
            Router.navigate("detail", {
              itemId: target.id,
              itemType: target.type || "movie",
              fallbackTitle: target.title || "Untitled",
              fallbackPoster: target.poster || "",
              fallbackBackground: target.background || "",
              addonBaseUrl: target.addonBaseUrl || "",
              addonId: target.addonId || "",
              addonName: target.addonName || "",
              catalogType: target.catalogType || target.type || "movie"
            });
          },
          onDismiss: () => {
            const itemId = this.posterOptionsFocusRestore;
            this.posterOptionsFocusRestore = null;
            const index = this.getRowCards().findIndex((card) => card.dataset.itemId === itemId);
            if (index < 0) {
              return;
            }
            this.rowFocusIndex = index;
            this.setFocusZone("row", { instant: true });
          }
        });
      }
      return this.posterOptionsController.open(item);
    },
    closePosterOptionsMenu() {
      if (!this.posterOptionsController?.dialog) {
        return false;
      }
      this.posterOptionsController.destroy();
      this.posterOptionsFocusRestore = null;
      return true;
    },
    openDetailFromNode(node) {
      this.lastFocusedItemId = String(node.dataset.itemId || "");
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled",
        fallbackPoster: node.dataset.posterSrc || "",
        fallbackBackground: node.dataset.backdropSrc || ""
      });
    },
    activate(node) {
      const action = String(node?.dataset?.action || "");
      if (action === "retry") {
        this.retryLoad();
      } else if (action === "toggleBiography") {
        this.setBiographyExpanded(!this.biographyExpanded);
      } else if (action === "selectFilter") {
        this.selectFilter(node.dataset.filter);
        this.setFocusZone("tabs");
      } else if (action === "openDetail") {
        this.openDetailFromNode(node);
      }
    },
    async onKeyDown(event) {
      const code = Number(event?.keyCode || 0);
      const current = this.container?.querySelector(".focusable.focused") || null;
      const isPosterHoldTarget = this.isPosterHoldTarget(current);
      if (!isPosterHoldTarget || code !== 13) {
        this.cancelPendingPosterHold();
      }

      if (isBackEvent(event)) {
        event?.preventDefault?.();
        // Android BackHandler: Back first closes an open biography.
        if (this.biographyExpanded) {
          this.setBiographyExpanded(false);
          return;
        }
        Router.back();
        return;
      }
      if (this.handleDpad(event)) {
        return;
      }
      if (code !== 13 || !current) {
        return;
      }
      event?.preventDefault?.();
      if (isPosterHoldTarget) {
        if (!event?.repeat && !this.hasPendingPosterHold(current)) {
          this.startPendingPosterHold(current);
        }
        return;
      }
      this.activate(current);
    },
    onKeyUp(event) {
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      const current = this.container?.querySelector(".cast-film-card.focusable.focused") || null;
      if (this.completePendingPosterHold(current, event)) {
        event?.preventDefault?.();
      }
    },
    onPointerFocus(target) {
      const zone = String(target?.dataset?.castZone || "");
      if (!zone || !target.classList.contains("focusable")) {
        return false;
      }
      if (zone === "row") {
        this.rowFocusIndex = Number(target.dataset.cardIndex || 0);
      } else if (zone === "tabs") {
        this.selectFilter(target.dataset.filter);
      }
      this.setFocusZone(zone);
      return true;
    },
    onPointerActivate(target) {
      const node = target?.closest?.(".focusable");
      if (!node || !this.container?.contains(node)) {
        return false;
      }
      this.activate(node);
      return true;
    },
    consumeBackRequest() {
      if (this.closePosterOptionsMenu()) {
        return true;
      }
      if (this.biographyExpanded) {
        this.setBiographyExpanded(false);
        return true;
      }
      return false;
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      this.cancelPendingPosterHold();
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      internals.ScreenUtils.hide(this.container);
    }
  };
}
