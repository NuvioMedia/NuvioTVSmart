/* eslint-disable no-unused-vars */
import * as internals from "./catalogSeeAllScreen.js";

export function createCatalogSeeAllScreenMethods02() {
  const {
    Router,
    ScreenUtils,
    focusWithoutAutoScroll,
    posterItemFromNode,
    PosterOptionsDialogController,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    renderLoadingIndicator,
    POSTER_HOLD_DELAY_MS,
    escapeHtml,
    t,
    extractReleaseYear,
    setContainerScrollTop,
    scrollNodeIntoContainerView
  } = internals;

  return {
    handleGridDpad(event) {
      const code = Number(event?.keyCode || 0);
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : code === 39 ? "right" : null;
      if (!direction) {
        return false;
      }

      const nav = this.navModel;
      const current = this.container?.querySelector(".seeall-card.focused") || null;
      if (!nav?.rows?.length || !current) {
        return false;
      }

      event?.preventDefault?.();

      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows[row] || [];

      if (direction === "left") {
        return this.focusNode(rowNodes[col - 1] || current) || true;
      }

      if (direction === "right") {
        return this.focusNode(rowNodes[col + 1] || current) || true;
      }

      if (direction === "up" || direction === "down") {
        const delta = direction === "up" ? -1 : 1;
        const targetRowNodes = nav.rows[row + delta] || null;
        if (!targetRowNodes?.length) {
          if (direction === "up" && row === 0) {
            const shell = this.container?.querySelector(".seeall-shell") || null;
            this.savedScrollTop = setContainerScrollTop(shell, 0, "smooth");
          }
          return true;
        }
        return this.focusNode(this.resolvePreferredNodeForRow(targetRowNodes)) || true;
      }

      return false;
    },
    restoreFocusedCard({ scrollMode = "center" } = {}) {
      const shell = this.container?.querySelector(".seeall-shell");
      const target =
        (this.lastFocusedKey ? this.container?.querySelector(`.seeall-card[data-focus-key="${this.lastFocusedKey}"]`) : null) ||
        this.container?.querySelector(".seeall-card.focusable") ||
        null;

      if (shell) {
        this.savedScrollTop = setContainerScrollTop(shell, this.savedScrollTop, "auto");
      }

      if (!target) {
        return;
      }

      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      this.rememberRowFocus(target);
      if (scrollMode !== "none") {
        scrollNodeIntoContainerView(target, shell, {
          center: scrollMode === "center",
          padding: 20
        });
      }
      this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
    },
    isPosterHoldTarget(node) {
      return Boolean(node?.matches?.(".seeall-card.focusable[data-action='openDetail']"));
    },
    cancelPendingPosterHold() {
      if (this.pendingPosterHoldTimer) {
        clearTimeout(this.pendingPosterHoldTimer);
        this.pendingPosterHoldTimer = null;
      }
      this.pendingPosterHoldTarget = null;
    },
    hasPendingPosterHold(node) {
      const pending = this.pendingPosterHoldTarget;
      if (!pending || !node) {
        return false;
      }
      return String(node.dataset.focusKey || "") === String(pending.focusKey || "");
    },
    startPendingPosterHold(node) {
      if (!this.isPosterHoldTarget(node)) {
        return false;
      }
      this.cancelPendingPosterHold();
      this.pendingPosterHoldTarget = {
        focusKey: String(node.dataset.focusKey || "")
      };
      this.pendingPosterHoldTimer = setTimeout(() => {
        this.pendingPosterHoldTimer = null;
        const current = this.container?.querySelector(".seeall-card.focusable.focused[data-action='openDetail']") || null;
        if (!this.hasPendingPosterHold(current)) {
          return;
        }
        this.pendingPosterHoldTarget.holdTriggered = true;
        void this.openPosterOptionsMenu(current);
      }, POSTER_HOLD_DELAY_MS);
      return true;
    },
    completePendingPosterHold(node, event = null) {
      const pending = this.pendingPosterHoldTarget;
      if (!pending) {
        return false;
      }
      const holdTriggered = Boolean(pending.holdTriggered);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingPosterHold(node);
      this.cancelPendingPosterHold();
      if (holdTriggered || shouldOpenHoldMenu) {
        if (shouldOpenHoldMenu) {
          void this.openPosterOptionsMenu(node);
        }
        return true;
      }
      if (!this.isPosterHoldTarget(node)) {
        return false;
      }
      this.openDetailFromNode(node);
      return true;
    },
    async openPosterOptionsMenu(node) {
      const item = posterItemFromNode(node, this.params?.type || "movie");
      if (!item?.id) {
        return false;
      }
      this.captureViewState();
      this.posterOptionsFocusKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
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
            this.lastFocusedKey = this.posterOptionsFocusKey || this.lastFocusedKey;
            this.posterOptionsFocusKey = "";
            this.pendingRestoreFocus = true;
            this.preserveViewportOnNextRender = true;
            this.render();
          },
          onChanged: () => {
            void this.refreshWatchedTitleIds(this.items).then(() => {
              this.updateRenderedWatchedBadges();
            });
          }
        });
      }
      return this.posterOptionsController.open(item, {
        focusKey: this.posterOptionsFocusKey,
        itemIndex: Number(node.dataset.itemIndex || -1)
      });
    },
    closePosterOptionsMenu() {
      if (!this.posterOptionsController?.dialog) {
        return false;
      }
      this.posterOptionsController.destroy();
      this.posterOptionsFocusKey = "";
      return true;
    },
    openDetailFromNode(node) {
      if (!node) {
        return false;
      }
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled",
        fallbackPoster: node.dataset.posterSrc || "",
        fallbackBackground: node.dataset.backdropSrc || "",
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
      });
      return true;
    },
    render() {
      const descriptor = this.params || {};
      const title = descriptor.catalogName || "Catalog";
      // Keep large paged catalogs windowed on constrained TVs. The window
      // expands as focus approaches its end, while original item indices stay stable.
      const allItems = Array.isArray(this.items) ? this.items : [];
      const currentRenderLimit = Number(this.renderedItemsLimit);
      const renderLimit = Number.isFinite(currentRenderLimit) ? Math.max(48, currentRenderLimit) : 48;
      const renderItems =
        allItems.length > 48 && this.hasMore && ScreenUtils.shouldSkipRouteEnter(this)
          ? allItems.slice(0, Math.min(allItems.length, renderLimit))
          : allItems;
      const cards = renderItems.length
        ? renderItems
            .map(
              (item, index) => `
              <article class="seeall-card focusable"
                       data-action="openDetail"
                       data-item-id="${item.id || ""}"
                        data-item-type="${item.type || item.catalogType || descriptor.type || "movie"}"
                       data-item-title="${escapeHtml(item.name || "Untitled")}"
                        data-poster-src="${escapeHtml(item.poster || "")}"
                        data-backdrop-src="${escapeHtml(item.background || item.backdrop || "")}"
                        data-addon-base-url="${escapeHtml(descriptor.addonBaseUrl || item.addonBaseUrl || "")}"
                        data-addon-id="${escapeHtml(descriptor.addonId || item.addonId || "")}"
                        data-addon-name="${escapeHtml(descriptor.addonName || item.addonName || "")}"
                        data-catalog-type="${escapeHtml(descriptor.type || item.catalogType || "")}"
                        data-focus-key="item:${item.id || index}"
                        data-item-index="${index}">
                <div class="seeall-card-poster-wrap">
                  ${
                    item.poster
                      ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async" />`
                      : `<div class="seeall-card-poster placeholder"></div>`
                  }
                  ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
                </div>
                ${
                  this.layoutPrefs?.posterLabelsEnabled !== false
                    ? `
                  <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                  <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
                `
                    : ""
                }
              </article>
            `
            )
            .join("")
        : `<div class="seeall-empty">${escapeHtml(t("catalog_see_all_empty_title", {}, "No items available"))}</div>`;

      this.container.innerHTML = `
          <div class="seeall-shell">
            <header class="seeall-header">
              <h2 class="seeall-title">${escapeHtml(title)}</h2>
              ${
                this.layoutPrefs?.catalogAddonNameEnabled !== false && descriptor.addonName
                  ? `<div class="seeall-subtitle">${escapeHtml(t("catalog_see_all_from", [descriptor.addonName], "from %1$s"))}</div>`
                  : ""
              }
            </header>
            <section class="seeall-grid">
              ${cards}
            </section>
            ${
              this.loading
                ? `
              <div class="seeall-loading">
                ${renderLoadingIndicator()}
                <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
              </div>
            `
                : ""
            }
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      this.bindCardEvents();
      this.bindShellEvents();
      if (this.pendingRestoreFocus) {
        const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
        this.pendingRestoreFocus = false;
        this.preserveViewportOnNextRender = false;
        this.restoreFocusedCard({ scrollMode });
        return;
      }
      ScreenUtils.setInitialFocus(this.container);
    },
    bindCardEvents() {
      this.container?.querySelectorAll(".seeall-card.focusable").forEach((node) => {
        if (node.__boundFocusHandlers) return;
        node.__boundFocusHandlers = true;
        node.addEventListener("focus", () => {
          this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
          this.savedScrollTop = this.container?.querySelector(".seeall-shell")?.scrollTop || 0;
        });
        node.addEventListener("mouseenter", () => {
          this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        });
      });
    },
    bindShellEvents() {
      const shell = this.container?.querySelector(".seeall-shell") || null;
      if (!shell || shell.__catalogSeeAllShellBound) {
        return;
      }
      shell.__catalogSeeAllShellBound = true;
      shell.addEventListener(
        "scroll",
        () => {
          this.savedScrollTop = Number(shell.scrollTop || 0);
          if (this.shouldAutoLoadMoreFromScroll(shell)) {
            if (this.maybeExpandRenderedItems(this.renderedItemsLimit - 1)) {
              this.render();
            }
          }
          const currentShell = this.container?.querySelector(".seeall-shell") || null;
          if (this.shouldAutoLoadMoreFromScroll(currentShell)) {
            this.loadNextPage({ preserveViewport: true });
          }
        },
        { passive: true }
      );
    }
  };
}
