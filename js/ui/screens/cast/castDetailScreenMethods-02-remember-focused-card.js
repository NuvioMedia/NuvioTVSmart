/* eslint-disable no-unused-vars */
import * as internals from "./castDetailScreen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

export function createCastDetailScreenMethods02() {
  const { Router, ScreenUtils, posterItemFromNode, PosterOptionsDialogController, POSTER_HOLD_DELAY_MS, isBackEvent, getDirection } =
    internals;

  return {
    rememberFocusedCard(node) {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const section = node.closest(".cast-credit-section");
      const sectionKey = String(section?.dataset?.creditSection || "");
      if (!sectionKey) {
        return;
      }
      const index = this.getCreditCardNodes(section).indexOf(node);
      if (index >= 0) {
        this.sectionFocusIndexByKey[sectionKey] = index;
      }
      this.lastFocusedSectionKey = sectionKey;
      this.lastFocusedItemId = String(node.dataset.itemId || "");
    },
    focusNode(node, { instant = false } = {}) {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      this.container?.querySelectorAll(".cast-credit-card.focusable.focused").forEach((current) => {
        if (current !== node) {
          current.classList.remove("focused");
        }
      });
      node.classList.add("focused");
      focusWithoutScroll(node);
      this.rememberFocusedCard(node);
      this.syncFocusedCardScroll({ instant });
      return true;
    },
    restoreFocusedCard() {
      const cards = this.getCreditCardNodes();
      const target =
        cards.find((node) => {
          const section = node.closest(".cast-credit-section");
          return (
            String(section?.dataset?.creditSection || "") === this.lastFocusedSectionKey &&
            String(node.dataset.itemId || "") === this.lastFocusedItemId
          );
        }) || cards[0];
      return target ? this.focusNode(target, { instant: true }) : false;
    },
    handleDpad(event) {
      const direction = getDirection(event);
      if (!direction) {
        return false;
      }
      const current = this.container?.querySelector(".cast-credit-card.focusable.focused");
      if (!(current instanceof HTMLElement)) {
        return false;
      }

      const currentSection = current.closest(".cast-credit-section");
      const currentCards = this.getCreditCardNodes(currentSection);
      const currentIndex = currentCards.indexOf(current);
      if (!(currentSection instanceof HTMLElement) || currentIndex < 0) {
        return false;
      }

      if (direction === "left" || direction === "right") {
        const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
        event?.preventDefault?.();
        if (currentCards[nextIndex]) {
          this.focusNode(currentCards[nextIndex]);
        }
        return true;
      }

      const sections = Array.from(this.container?.querySelectorAll(".cast-credit-section") || []);
      const sectionIndex = sections.indexOf(currentSection);
      const targetSection = sections[sectionIndex + (direction === "up" ? -1 : 1)];
      if (!(targetSection instanceof HTMLElement)) {
        return false;
      }
      const targetCards = this.getCreditCardNodes(targetSection);
      if (!targetCards.length) {
        return false;
      }
      event?.preventDefault?.();
      const targetKey = String(targetSection.dataset.creditSection || "");
      const rememberedIndex = Number(this.sectionFocusIndexByKey?.[targetKey]);
      // Keep focus local to each filmography section. This prevents the
      // scroll position of Popular from selecting a later card in Latest.
      const targetIndex = Number.isInteger(rememberedIndex) && rememberedIndex >= 0 ? rememberedIndex : 0;
      this.focusNode(targetCards[Math.min(targetIndex, targetCards.length - 1)]);
      return true;
    },
    syncFocusedCardScroll({ instant = false } = {}) {
      const shell = this.container?.querySelector(".cast-detail-shell");
      const focused = this.container?.querySelector(".cast-credit-card.focusable.focused");
      if (!(shell instanceof HTMLElement) || !(focused instanceof HTMLElement)) {
        return;
      }
      const track = focused.closest(".cast-credit-track");
      if (track instanceof HTMLElement) {
        const trackRect = track.getBoundingClientRect();
        const focusRect = focused.getBoundingClientRect();
        const padSide = 28;
        let nextScrollLeft = track.scrollLeft;
        if (focusRect.left < trackRect.left + padSide) {
          nextScrollLeft -= trackRect.left + padSide - focusRect.left;
        } else if (focusRect.right > trackRect.right - padSide) {
          nextScrollLeft += focusRect.right - (trackRect.right - padSide);
        }
        nextScrollLeft = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, nextScrollLeft));
        if (Math.abs(nextScrollLeft - track.scrollLeft) >= 1) {
          if (!instant && typeof track.scrollTo === "function") {
            track.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
          } else {
            track.scrollLeft = nextScrollLeft;
          }
        }
      }

      // Keep the Android-style hero context visible while entering the first
      // filmography row. Constrained TV viewports cannot show the whole poster
      // and the hero at once; scrolling to the card bottom would hide the
      // actor's name and biography before the user can read them.
      const firstSection = this.container?.querySelector(".cast-credit-section");
      const focusedSection = focused.closest(".cast-credit-section");
      if (firstSection && focusedSection === firstSection) {
        if (shell.scrollTop > 0) {
          if (!instant && typeof shell.scrollTo === "function") {
            shell.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            shell.scrollTop = 0;
          }
        }
        this.savedScrollTop = 0;
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const focusRect = focused.getBoundingClientRect();
      const focusedSectionRect = focusedSection instanceof HTMLElement ? focusedSection.getBoundingClientRect() : focusRect;
      const padTop = 40;
      const padBottom = 58;
      let nextScrollTop = shell.scrollTop;
      // Keep the section heading visible with the focused card. This matches
      // Android's rail-level bring-into-view behavior when moving upward.
      if (focusedSectionRect.top < shellRect.top + padTop) {
        nextScrollTop -= shellRect.top + padTop - focusedSectionRect.top;
      } else if (focusRect.bottom > shellRect.bottom - padBottom) {
        nextScrollTop += focusRect.bottom - (shellRect.bottom - padBottom);
      }
      nextScrollTop = Math.max(0, Math.min(shell.scrollHeight - shell.clientHeight, nextScrollTop));
      if (Math.abs(nextScrollTop - shell.scrollTop) < 1) {
        return;
      }
      if (!instant && typeof shell.scrollTo === "function") {
        shell.scrollTo({ top: nextScrollTop, behavior: "smooth" });
      } else {
        shell.scrollTop = nextScrollTop;
      }
    },
    isPosterHoldTarget(node) {
      return (
        node instanceof HTMLElement && node.classList.contains("cast-credit-card") && String(node.dataset.action || "") === "openDetail"
      );
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
      this.rememberFocusedCard(node);
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
            const target = itemId
              ? this.container?.querySelector(`.cast-credit-card.focusable[data-item-id="${String(itemId).replace(/["\\]/g, "\\$&")}"]`)
              : null;
            if (!target) {
              return;
            }
            this.container.querySelectorAll(".focusable.focused").forEach((current) => {
              if (current !== target) current.classList.remove("focused");
            });
            target.classList.add("focused");
            focusWithoutScroll(target);
            this.rememberFocusedCard(target);
            this.syncFocusedCardScroll({ instant: true });
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
      this.rememberFocusedCard(node);
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled"
      });
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
        Router.back();
        return;
      }
      if (this.handleDpad(event)) {
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (code !== 13) {
        return;
      }
      if (!current) {
        return;
      }
      if (code === 13 && isPosterHoldTarget) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingPosterHold(current)) {
          this.startPendingPosterHold(current);
        }
        return;
      }
      const action = String(current.dataset.action || "");
      if (action === "back") {
        Router.back();
        return;
      }
      if (action === "openDetail") {
        this.openDetailFromNode(current);
      }
    },
    onKeyUp(event) {
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      const current = this.container?.querySelector(".cast-credit-card.focusable.focused") || null;
      if (this.completePendingPosterHold(current, event)) {
        event?.preventDefault?.();
      }
    },
    onPointerFocus(target) {
      if (this.isPosterHoldTarget(target)) {
        this.rememberFocusedCard(target);
      }
    },
    consumeBackRequest() {
      return this.closePosterOptionsMenu();
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      this.cancelPendingPosterHold();
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      ScreenUtils.hide(this.container);
    }
  };
}
