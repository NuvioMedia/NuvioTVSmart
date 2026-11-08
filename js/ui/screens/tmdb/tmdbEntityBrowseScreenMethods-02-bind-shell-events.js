/* eslint-disable no-unused-vars */
import * as internals from "./tmdbEntityBrowseScreen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";

export function createTmdbEntityBrowseScreenMethods02() {
  const { Router, TmdbMetadataService, TmdbSettingsStore, POSTER_HOLD_DELAY_MS, normalizeEntityKind, normalizeEntityId, getDirection } =
    internals;

  return {
    bindShellEvents() {
      const shell = this.container?.querySelector(".tmdb-entity-shell");
      if (!(shell instanceof HTMLElement) || shell.__tmdbEntityShellBound) {
        return;
      }
      shell.__tmdbEntityShellBound = true;
      shell.addEventListener(
        "scroll",
        () => {
          this.savedScrollTop = Number(shell.scrollTop || 0);
        },
        { passive: true }
      );
    },
    getCardNodes(railKey = "") {
      const escapedRailKey =
        typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(railKey) : railKey.replace(/(["\\])/g, "\\$1");
      const selector = railKey
        ? `.tmdb-entity-rail[data-rail-key="${escapedRailKey}"] .tmdb-entity-card.focusable`
        : ".tmdb-entity-card.focusable";
      try {
        return Array.from(this.container?.querySelectorAll(selector) || []);
      } catch (_) {
        return Array.from(this.container?.querySelectorAll(".tmdb-entity-card.focusable") || []).filter(
          (node) => !railKey || String(node.dataset.railKey || "") === railKey
        );
      }
    },
    rememberFocusedCard(node) {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      this.lastFocusedRailKey = String(node.dataset.railKey || "");
      this.lastFocusedItemId = String(node.dataset.itemId || "");
      const index = Number(node.dataset.itemIndex || 0);
      if (this.lastFocusedRailKey) {
        this.railFocusIndexByKey[this.lastFocusedRailKey] = Number.isFinite(index) ? index : 0;
      }
    },
    captureViewState() {
      const shell = this.container?.querySelector(".tmdb-entity-shell");
      if (shell instanceof HTMLElement) {
        this.savedScrollTop = Number(shell.scrollTop || 0);
      }
      this.trackScrollLeftByKey = { ...(this.trackScrollLeftByKey || {}) };
      this.container?.querySelectorAll(".tmdb-entity-track[data-scroll-key]").forEach((track) => {
        const key = String(track.dataset.scrollKey || "").trim();
        if (key) {
          this.trackScrollLeftByKey[key] = Number(track.scrollLeft || 0);
        }
      });
      const focused = this.container?.querySelector(".tmdb-entity-card.focusable.focused");
      if (focused) {
        this.rememberFocusedCard(focused);
      }
    },
    syncFocusedCardScroll(node, { instant = false } = {}) {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const track = node.closest(".tmdb-entity-track");
      if (track instanceof HTMLElement) {
        const trackRect = track.getBoundingClientRect();
        const cardRect = node.getBoundingClientRect();
        const padding = 26;
        let nextLeft = track.scrollLeft;
        if (cardRect.left < trackRect.left + padding) {
          nextLeft -= trackRect.left + padding - cardRect.left;
        } else if (cardRect.right > trackRect.right - padding) {
          nextLeft += cardRect.right - (trackRect.right - padding);
        }
        const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
        nextLeft = Math.max(0, Math.min(maxLeft, nextLeft));
        if (Math.abs(nextLeft - track.scrollLeft) > 1) {
          if (!instant && typeof track.scrollTo === "function") {
            track.scrollTo({ left: nextLeft, behavior: "smooth" });
          } else {
            track.scrollLeft = nextLeft;
          }
        }
        const key = String(track.dataset.scrollKey || "").trim();
        if (key) {
          this.trackScrollLeftByKey[key] = nextLeft;
        }
      }

      const shell = this.container?.querySelector(".tmdb-entity-shell");
      if (!(shell instanceof HTMLElement)) {
        return;
      }

      // Keep the Android-style entity header visible when focus returns to the
      // first content rail. The Web shell scrolls the hero and rails together;
      // generic visibility padding would otherwise stop with the first card
      // near the top and leave the studio logo partially clipped.
      const firstRail = this.container?.querySelector(".tmdb-entity-rail");
      const focusedRail = node.closest(".tmdb-entity-rail");
      if (firstRail && focusedRail === firstRail) {
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
      const cardRect = node.getBoundingClientRect();
      const focusedRailRect = focusedRail instanceof HTMLElement ? focusedRail.getBoundingClientRect() : cardRect;
      const topPadding = 36;
      const bottomPadding = 56;
      let nextTop = shell.scrollTop;
      // Scroll the containing rail, not only its card. Android's bring-into-view
      // keeps the rail heading visible when focus moves back to an upper row.
      if (focusedRailRect.top < shellRect.top + topPadding) {
        nextTop -= shellRect.top + topPadding - focusedRailRect.top;
      } else if (cardRect.bottom > shellRect.bottom - bottomPadding) {
        nextTop += cardRect.bottom - (shellRect.bottom - bottomPadding);
      }
      const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
      nextTop = Math.max(0, Math.min(maxTop, nextTop));
      if (Math.abs(nextTop - shell.scrollTop) > 1) {
        if (!instant && typeof shell.scrollTo === "function") {
          shell.scrollTo({ top: nextTop, behavior: "smooth" });
        } else {
          shell.scrollTop = nextTop;
        }
      }
      this.savedScrollTop = nextTop;
    },
    focusNode(node, { instant = false } = {}) {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      this.container?.querySelectorAll(".focusable.focused").forEach((current) => {
        if (current !== node) {
          current.classList.remove("focused");
        }
      });
      node.classList.add("focused");
      focusWithoutScroll(node);
      this.rememberFocusedCard(node);
      this.syncFocusedCardScroll(node, { instant });
      const rail = (this.data?.rails || []).find((entry) => String(entry?.key || "") === String(node.dataset.railKey || ""));
      const index = Number(node.dataset.itemIndex || 0);
      if (rail?.hasMore && !rail?.isLoading && index >= (rail.items?.length || 0) - 4) {
        void this.loadMoreRail(String(node.dataset.railKey || ""));
      }
      return true;
    },
    restoreFocusedCard() {
      const shell = this.container?.querySelector(".tmdb-entity-shell");
      if (shell instanceof HTMLElement) {
        shell.scrollTop = Math.max(0, Math.min(shell.scrollHeight - shell.clientHeight, Number(this.savedScrollTop || 0)));
      }
      Object.entries(this.trackScrollLeftByKey || {}).forEach(([key, value]) => {
        const track = Array.from(this.container?.querySelectorAll(".tmdb-entity-track") || []).find(
          (node) => String(node.dataset.scrollKey || "") === key
        );
        if (track instanceof HTMLElement) {
          track.scrollLeft = Math.max(0, Number(value || 0));
        }
      });

      const cards = this.getCardNodes();
      const target =
        cards.find(
          (node) =>
            String(node.dataset.railKey || "") === this.lastFocusedRailKey && String(node.dataset.itemId || "") === this.lastFocusedItemId
        ) || cards[0];
      if (!target) {
        return;
      }
      this.focusNode(target, { instant: true });
    },
    handleDpad(event) {
      const direction = getDirection(event);
      if (!direction) {
        return false;
      }
      const current = this.container?.querySelector(".tmdb-entity-card.focusable.focused");
      if (!(current instanceof HTMLElement)) {
        return false;
      }
      event?.preventDefault?.();
      const railKey = String(current.dataset.railKey || "");
      const cards = this.getCardNodes(railKey);
      const currentIndex = cards.indexOf(current);
      const railIndex = (this.data?.rails || []).findIndex((rail) => String(rail?.key || "") === railKey);
      if (currentIndex < 0 || railIndex < 0) {
        return true;
      }

      if (direction === "left" || direction === "right") {
        const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
        if (cards[nextIndex]) {
          this.focusNode(cards[nextIndex]);
        } else if (direction === "right") {
          void this.loadMoreRail(railKey);
        }
        return true;
      }

      const targetRail = this.data?.rails?.[railIndex + (direction === "up" ? -1 : 1)];
      if (!targetRail) {
        return true;
      }
      const targetCards = this.getCardNodes(String(targetRail.key || ""));
      if (targetCards.length) {
        const targetRailKey = String(targetRail.key || "");
        const rememberedIndex = Number(this.railFocusIndexByKey?.[targetRailKey]);
        // Keep focus local to each rail, matching Android TV's per-row
        // focusRestorer. A rail that has not been visited must start at index 0;
        // it must not inherit the source rail's horizontal position.
        const targetIndex = Number.isInteger(rememberedIndex) && rememberedIndex >= 0 ? rememberedIndex : 0;
        const preferred = Math.min(targetIndex, targetCards.length - 1);
        this.focusNode(targetCards[preferred]);
      }
      return true;
    },
    async loadMoreRail(railKey) {
      const key = String(railKey || "").trim();
      if (!key || this.loadingRails.has(key)) {
        return;
      }
      const rail = (this.data?.rails || []).find((entry) => String(entry?.key || "") === key);
      if (!rail?.hasMore) {
        return;
      }
      const [mediaType, railType] = key.split(":");
      if (!mediaType || !railType) {
        return;
      }
      this.captureViewState();
      this.pendingRestoreFocus = true;
      this.loadingRails.add(key);
      rail.isLoading = true;
      const token = this.loadToken;
      try {
        const settings = TmdbSettingsStore.get();
        const result = await TmdbMetadataService.fetchEntityRailPage({
          entityKind: normalizeEntityKind(this.params?.entityKind),
          entityId: normalizeEntityId(this.params?.entityId),
          mediaType,
          railType,
          language: settings.language,
          page: Number(rail.currentPage || 1) + 1
        });
        if (token !== this.loadToken) {
          return;
        }
        const seen = new Set((rail.items || []).map((item) => String(item?.id || "")));
        (result.items || []).forEach((item) => {
          if (item?.id && !seen.has(String(item.id))) {
            seen.add(String(item.id));
            rail.items.push(item);
          }
        });
        rail.currentPage = Number(rail.currentPage || 1) + 1;
        rail.hasMore = Boolean(result.hasMore);
      } catch (error) {
        console.warn("TMDB entity rail pagination failed", error);
        rail.hasMore = false;
      } finally {
        this.loadingRails.delete(key);
        rail.isLoading = false;
        if (token === this.loadToken) {
          this.render();
          void this.refreshWatchedTitleIds().then(() => {
            if (token === this.loadToken && Router.getCurrent() === "tmdbEntityBrowse") {
              this.render();
            }
          });
        }
      }
    },
    isPosterHoldTarget(node) {
      return Boolean(node?.matches?.(".tmdb-entity-card.focusable[data-action='openDetail']"));
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
    }
  };
}
