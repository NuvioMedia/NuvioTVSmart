/* eslint-disable no-unused-vars */
import * as internals from "./folderDetailScreen.js";

export function createFolderDetailScreenMethods02() {
  const { Router, ScreenUtils, HomeScreen, normalizeItem, buildHeroDisplay, groupNodesByOffsetTop, fetchSourceItems } = internals;

  return {
    async loadTab(tabIndex, { append = false, background = false, loadToken = null } = {}) {
      const token = loadToken == null ? this.folderLoadToken : loadToken;
      if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
        return;
      }
      const tab = this.tabs[tabIndex];
      if (!tab || tab.isAllTab || (tab.loading && !background)) {
        return;
      }
      if (!background) {
        this.tabs[tabIndex] = { ...tab, loading: true, error: "" };
        this.rebuildAllTab();
        if (append) {
          this.scheduleRender();
        } else {
          this.render();
        }
      }
      try {
        const nextPage = append ? Math.max(1, Number(tab.page || 1) + 1) : 1;
        const requestSkip = append ? Number(tab.nextSkip || 0) : 0;
        const result = await fetchSourceItems(tab.source, nextPage, requestSkip);
        if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
          return;
        }
        const existing = append ? this.tabs[tabIndex].items || [] : [];
        const seen = new Set(existing.map((item) => `${item.type}:${item.id}`));
        const incoming = (result.items || []).filter((item) => {
          const key = `${item.type}:${item.id}`;
          if (!item.id || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
        this.tabs[tabIndex] = {
          ...this.tabs[tabIndex],
          items: append ? [...existing, ...incoming] : incoming,
          hasMore: Boolean(result.hasMore && incoming.length),
          supportsSkip: result.supportsSkip !== false,
          skipStep: Number(result.skipStep || this.tabs[tabIndex].skipStep || 100),
          page: Number(result.page || nextPage),
          nextSkip: Number.isFinite(Number(result.nextSkip))
            ? Math.max(0, Math.trunc(Number(result.nextSkip)))
            : append
              ? Number(this.tabs[tabIndex].nextSkip || 0)
              : 0,
          loading: false,
          error: ""
        };
        if (!this.heroItem) {
          this.heroItem = this.tabs[tabIndex].items[0] || null;
        }
      } catch (error) {
        if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
          return;
        }
        this.tabs[tabIndex] = {
          ...this.tabs[tabIndex],
          loading: false,
          error: String(error?.message || "Could not load source")
        };
      }
      if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
        return;
      }
      this.rebuildAllTab();
      const refreshWatchedPromise = background ? null : this.refreshWatchedTitleIds();
      if (background || append) {
        this.scheduleRender();
      } else {
        this.render();
      }
      void refreshWatchedPromise?.then(() => {
        if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
          return;
        }
        if (background || append) {
          this.scheduleRender();
        } else {
          this.render();
        }
      });
    },
    getSelectedTab() {
      return this.tabs[this.selectedTabIndex] || null;
    },
    buildNavigationModel() {
      if (this.useHomeFollowLayout) {
        return HomeScreen.buildNavigationModel.call(this);
      }
      const rows = [];
      if (this.viewMode === "TABBED_GRID") {
        const tabNodes = Array.from(this.container?.querySelectorAll(".folder-detail-tab.focusable") || []);
        if (tabNodes.length) {
          rows.push(tabNodes);
        }
        const cardNodes = Array.from(this.container?.querySelectorAll(".seeall-card.focusable") || []);
        groupNodesByOffsetTop(cardNodes).forEach((rowNodes) => {
          if (rowNodes.length) {
            rows.push(rowNodes);
          }
        });
      } else {
        const rowTracks = Array.from(this.container?.querySelectorAll(".folder-row-track") || []);
        rowTracks.forEach((track) => {
          const cards = Array.from(track.querySelectorAll(".seeall-card.focusable"));
          if (cards.length) {
            rows.push(cards);
          }
        });
      }
      rows.forEach((rowNodes, rowIndex) => {
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
        });
      });
      this.navModel = { rows };
    },
    focusNode(target) {
      if (this.useHomeFollowLayout && arguments.length > 1) {
        return HomeScreen.focusNode.call(this, ...arguments);
      }
      if (!target) {
        return false;
      }
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      target.classList.add("focused");
      target.focus();
      if (String(target.dataset.action || "") === "openDetail") {
        const item = normalizeItem({
          id: target.dataset.itemId || "",
          type: target.dataset.itemType || "movie",
          name: target.dataset.itemTitle || "Untitled",
          poster: target.querySelector(".seeall-card-poster-image")?.getAttribute("src") || "",
          background: target.dataset.backdropSrc || target.querySelector(".seeall-card-poster-image")?.getAttribute("src") || "",
          logo: target.dataset.logoSrc || "",
          releaseInfo: target.dataset.releaseInfo || "",
          description: target.dataset.description || ""
        });
        if (item?.id) {
          this.heroItem = item;
          this.applyHeroToDom();
        }
      }
      const shell = this.container?.querySelector(".seeall-shell");
      const rowTrack = target.closest(".folder-row-track");
      if (rowTrack instanceof HTMLElement) {
        const left = target.offsetLeft;
        const right = left + target.offsetWidth;
        if (left < rowTrack.scrollLeft + 40) {
          rowTrack.scrollLeft = Math.max(0, left - 40);
        } else if (right > rowTrack.scrollLeft + rowTrack.clientWidth - 40) {
          rowTrack.scrollLeft = right - rowTrack.clientWidth + 40;
        }
      }
      if (shell && (target.closest(".seeall-grid") || target.closest(".folder-detail-rows"))) {
        const top = target.offsetTop;
        const bottom = top + target.offsetHeight;
        if (top < shell.scrollTop + 100) {
          shell.scrollTop = Math.max(0, top - 100);
        } else if (bottom > shell.scrollTop + shell.clientHeight - 100) {
          shell.scrollTop = bottom - shell.clientHeight + 100;
        }
        this.savedScrollTop = shell.scrollTop;
      }
      this.lastFocusedKey = String(target.dataset.focusKey || this.lastFocusedKey || "");
      return true;
    },
    applyHeroToDom() {
      if (this.useHomeFollowLayout) {
        return HomeScreen.applyHeroToDom.call(this);
      }
      const hero = buildHeroDisplay(this.heroItem);
      if (!hero) {
        return;
      }
      const root = this.container;
      const backdrop = root?.querySelector?.(".folder-follow-hero-backdrop");
      const logo = root?.querySelector?.(".folder-follow-hero-logo");
      const title = root?.querySelector?.(".folder-follow-hero-title");
      const meta = root?.querySelector?.(".folder-follow-hero-meta");
      const description = root?.querySelector?.(".folder-follow-hero-description");
      if (backdrop) {
        if (hero.backdrop) {
          backdrop.setAttribute("src", hero.backdrop);
        } else {
          backdrop.removeAttribute("src");
        }
      }
      if (logo) {
        if (hero.logo) {
          logo.setAttribute("src", hero.logo);
          logo.removeAttribute("hidden");
        } else {
          logo.setAttribute("hidden", "hidden");
        }
      }
      if (title) {
        title.textContent = hero.title || "Untitled";
        title.classList.toggle("is-hidden", Boolean(hero.logo));
      }
      if (meta) {
        meta.textContent = hero.meta.join("  •  ");
      }
      if (description) {
        description.textContent = hero.description || " ";
      }
    },
    restoreFocus() {
      if (this.useHomeFollowLayout) {
        const current = this.container?.querySelector(".home-main .focusable.focused") || null;
        if (current) {
          return;
        }
        const identityTarget = this.findRestoredFocusedItem();
        if (identityTarget) {
          HomeScreen.setFocusedNode.call(this, identityTarget);
          this.lastMainFocus = identityTarget;
          HomeScreen.rememberMainRowFocus.call(this, identityTarget);
          HomeScreen.ensureTrackHorizontalVisibility.call(this, identityTarget);
          HomeScreen.scheduleModernHeroUpdate.call(this, identityTarget);
          HomeScreen.scheduleFocusedPosterFlow.call(this, identityTarget);
          this.restoredFocusedItem = null;
          this.restoredFollowLayoutFocusState = null;
          return;
        }
        if (this.restoredFollowLayoutFocusState && HomeScreen.restoreModernFocusState.call(this, this.restoredFollowLayoutFocusState)) {
          this.restoredFollowLayoutFocusState = null;
          return;
        }
        ScreenUtils.setInitialFocus(this.container, HomeScreen.getInitialFocusSelector.call(this));
        const target = this.container?.querySelector(".home-main .focusable.focused") || null;
        if (target) {
          this.lastMainFocus = target;
          HomeScreen.scheduleModernHeroUpdate.call(this, target);
          HomeScreen.scheduleFocusedPosterFlow.call(this, target);
        }
        return;
      }
      const target =
        this.findRestoredFocusedItem() ||
        (this.lastFocusedKey ? this.container?.querySelector(`.focusable[data-focus-key="${this.lastFocusedKey}"]`) : null) ||
        this.container?.querySelector(".folder-detail-tab.focusable") ||
        this.container?.querySelector(".seeall-card.focusable") ||
        null;
      if (!target) {
        return;
      }
      const shell = this.container?.querySelector(".seeall-shell");
      if (shell) {
        shell.scrollTop = Number(this.savedScrollTop || 0);
      }
      Object.entries(this.restoredTrackScrollStates || {}).forEach(([rowKey, scrollLeft]) => {
        const track = Array.from(this.container?.querySelectorAll(".folder-row-track[data-row-key]") || []).find(
          (node) => String(node.dataset.rowKey || "") === String(rowKey)
        );
        if (track) {
          track.scrollLeft = Number(scrollLeft || 0);
        }
      });
      this.focusNode(target);
      this.restoredFocusedItem = null;
      if (shell) {
        shell.scrollTop = Number(this.savedScrollTop || 0);
      }
    },
    findRestoredFocusedItem() {
      const descriptor = this.restoredFocusedItem;
      if (!descriptor?.itemId || !this.container) {
        return null;
      }
      const candidates = Array.from(this.container.querySelectorAll(".focusable[data-item-id]")).filter(
        (node) =>
          String(node.dataset.itemId || "") === descriptor.itemId &&
          (!descriptor.itemType || String(node.dataset.itemType || "") === descriptor.itemType)
      );
      if (!candidates.length) {
        return null;
      }
      if (descriptor.rowKey) {
        const sameRow = candidates.find((node) => String(node.closest("[data-row-key]")?.dataset?.rowKey || "") === descriptor.rowKey);
        if (sameRow) {
          return sameRow;
        }
      }
      return candidates[0];
    }
  };
}
