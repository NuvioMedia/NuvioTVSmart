import { ensureHeroMdbListRatings } from "./homeHeroMdbListLoad.js";
import { registerHomeDomNodes } from "./homeDomUpdate.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods05() {
  const {
    getTvHeroTransitionMode,
    focusWithoutAutoScroll,
    setLegacySidebarExpanded,
    HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS,
    HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS,
    escapeAttribute,
    escapeHtml,
    animateHeroBackdropSwap,
    animateHeroLogoSwap,
    normalizeHomeRowItem,
    normalizeContinueWatchingItem,
    buildHeroDisplayModel,
    buildModernHeroPresentation,
    renderModernHeroPrimary,
    renderModernHeroSecondary,
    renderMetaTokens,
    buildHeroIndicators
  } = internals;

  return {
    applyHeroToDom() {
      const heroNode = this.container?.querySelector(".home-hero-card");
      if (!heroNode) {
        return;
      }
      const hero = this.heroItem || this.heroCandidates?.[0] || null;
      if (!hero) {
        return;
      }

      const display = this.layoutMode === "modern" ? buildModernHeroPresentation(hero) : buildHeroDisplayModel(hero, this.layoutMode);
      if (!display) {
        return;
      }
      heroNode.dataset.itemId = hero?.id || "";
      heroNode.dataset.itemType = hero?.type || "movie";
      heroNode.dataset.itemTitle = hero?.name || "Untitled";
      heroNode.classList.toggle("is-hero-meta-enriching", Boolean(hero?.heroMetaEnriching));
      heroNode.classList.remove("is-hero-focus-pending");
      const heroCrossfadeMs =
        this.layoutMode === "modern" ? HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS : HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS;
      const heroTransitionMode = getTvHeroTransitionMode();

      const backdrop = heroNode.querySelector(".home-hero-backdrop:not(.home-hero-backdrop-transition-ghost)");
      if (backdrop) {
        const src = display.backdrop || "";
        if (backdrop instanceof HTMLImageElement) {
          const shouldFreezeBackdrop = Boolean(hero?.heroMetaEnriching) && String(backdrop.getAttribute("src") || "").trim();
          if (!shouldFreezeBackdrop) {
            animateHeroBackdropSwap(backdrop, src, display.title || "featured", heroCrossfadeMs, {
              transitionMode: heroTransitionMode
            });
          } else {
            backdrop.setAttribute("alt", "");
          }
        } else if (src) {
          backdrop.setAttribute("src", src);
          backdrop.setAttribute("alt", "");
          backdrop.classList.remove("placeholder");
        } else {
          backdrop.removeAttribute("src");
          backdrop.classList.add("placeholder");
        }
      }

      const logoNode = heroNode.querySelector(".home-hero-logo:not(.home-hero-logo-transition-ghost)");
      const brandNode = heroNode.querySelector(".home-hero-brand");
      if (display.logo) {
        if (logoNode) {
          animateHeroLogoSwap(logoNode, display.logo, display.title || "logo", heroCrossfadeMs, {
            transitionMode: heroTransitionMode
          });
        } else if (brandNode) {
          brandNode.insertAdjacentHTML(
            "afterbegin",
            `<img class="home-hero-logo home-hero-logo-transition-enter" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title || "logo")}" decoding="async" fetchpriority="high" />`
          );
          const insertedLogo = brandNode.querySelector(".home-hero-logo");
          // The logo belongs to the rendered hero, unlike temporary transition
          // ghosts. Let incremental refreshes reuse or remove it.
          registerHomeDomNodes([insertedLogo]);
          requestAnimationFrame(() => {
            insertedLogo?.classList?.add("is-visible");
            setTimeout(() => insertedLogo?.classList?.remove("home-hero-logo-transition-enter", "is-visible"), heroCrossfadeMs);
          });
        }
      } else if (logoNode) {
        logoNode.remove();
      }

      const titleNode = heroNode.querySelector(".home-hero-title-text");
      if (titleNode) {
        titleNode.textContent = display.title || "Untitled";
        titleNode.classList.toggle("is-hidden", Boolean(display.logo));
      }

      if (this.layoutMode === "modern") {
        const primaryNode = heroNode.querySelector(".home-modern-hero-meta-line");
        if (primaryNode) {
          primaryNode.innerHTML = renderModernHeroPrimary(display);
          primaryNode.classList.toggle("is-empty", !display.leadingMeta.length && !display.trailingMeta.length && !display.showImdbPrimary);
        }

        const secondaryNode = heroNode.querySelector(".home-modern-hero-secondary");
        if (secondaryNode) {
          secondaryNode.innerHTML = renderModernHeroSecondary(display);
          secondaryNode.classList.toggle(
            "is-empty",
            !display.secondaryHighlightText &&
              !display.badges.length &&
              !display.showImdbSecondary &&
              !display.languageText &&
              !display.mdbListMarkup
          );
        }
      } else {
        const primaryNode = heroNode.querySelector(".home-hero-meta-primary");
        if (primaryNode) {
          primaryNode.innerHTML = renderMetaTokens(display.metaPrimary);
          primaryNode.classList.toggle("is-empty", !display.metaPrimary.length);
        }

        const secondaryNode = heroNode.querySelector(".home-hero-meta-secondary");
        if (secondaryNode) {
          secondaryNode.innerHTML = renderMetaTokens(display.metaSecondary);
          secondaryNode.classList.toggle("is-empty", !display.metaSecondary.length);
        }

        const chipNode = heroNode.querySelector(".home-hero-chip-row");
        if (chipNode) {
          chipNode.innerHTML = display.chips.map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`).join("");
          chipNode.classList.toggle("is-empty", !display.chips.length);
        }
      }

      const descriptionNode = heroNode.querySelector(".home-hero-description");
      if (descriptionNode) {
        descriptionNode.textContent = display.description || " ";
        descriptionNode.classList.toggle("is-empty", !display.description);
      }
      const mdbRow = heroNode.querySelector(".home-hero-mdb-ratings");
      if (mdbRow) {
        mdbRow.innerHTML = display.mdbListMarkup || "";
        mdbRow.classList.toggle("is-empty", !display.mdbListMarkup);
      }
      this.scheduleHomeTruncationUpdate({ scope: heroNode });
      this.syncCollectionHeroMedia(hero);

      const indicators = heroNode.querySelector(".home-hero-indicators");
      if (indicators) {
        indicators.innerHTML = buildHeroIndicators(this.heroCandidates, hero);
      }
      // These nodes were replaced outside the incremental renderer. Register
      // their new children so the next refresh replaces them instead of appending.
      registerHomeDomNodes(
        Array.from(
          heroNode.querySelectorAll(
            ".home-hero-title-text, .home-modern-hero-meta-line, .home-modern-hero-secondary, .home-hero-meta-primary, .home-hero-meta-secondary, .home-hero-chip-row, .home-hero-description, .home-hero-mdb-ratings, .home-hero-indicators"
          )
        )
      );
      void ensureHeroMdbListRatings.call(this);
    },
    setSidebarExpanded(expanded) {
      const nextExpanded = Boolean(expanded);
      this.sidebarExpanded = nextExpanded;
      if (this.layoutPrefs?.modernSidebar) {
        return;
      }
      const sidebar = this.container?.querySelector(".home-sidebar");
      const needsTransition = nextExpanded
        ? Boolean(!sidebar?.classList.contains("expanded") || !sidebar?.classList.contains("content-expanded"))
        : Boolean(
            sidebar?.classList.contains("expanded") ||
            sidebar?.classList.contains("opening") ||
            sidebar?.classList.contains("content-expanded")
          );
      if (!needsTransition) {
        return;
      }
      setLegacySidebarExpanded(this.container, nextExpanded);
    },
    isSidebarNode(node) {
      return String(node?.dataset?.navZone || "") === "sidebar";
    },
    isMainNode(node) {
      return String(node?.dataset?.navZone || "") === "main";
    },
    getNodeRowKey(node) {
      if (!node) {
        return "";
      }
      if (node.classList?.contains("home-hero-card")) {
        return "__hero__";
      }
      return String(node.dataset?.navRowKey || node.dataset?.rowKey || node.closest?.("[data-row-key]")?.dataset?.rowKey || "");
    },
    getNavigationTrackNodes() {
      if (this.layoutMode === "grid") {
        return Array.from(this.container?.querySelectorAll("[data-track-row-key]") || []);
      }
      if (
        this.navModel?.domVersion === Number(this.navigationDomVersion || 0) &&
        Array.isArray(this.navModel?.tracks) &&
        this.navModel.tracks.length
      ) {
        return this.navModel.tracks.filter((node) => node?.isConnected);
      }
      return Array.from(this.container?.querySelectorAll("[data-track-row-key]") || []);
    },
    getNavigationRowSection(rowKey = "") {
      const key = String(rowKey || "").trim();
      if (!key) {
        return null;
      }
      const cached =
        this.navModel?.domVersion === Number(this.navigationDomVersion || 0) ? this.navModel?.rowSectionByKey?.get(key) || null : null;
      if (cached?.isConnected) {
        return cached;
      }
      return (
        Array.from(this.container?.querySelectorAll("[data-row-key]") || []).find((node) => String(node.dataset.rowKey || "") === key) ||
        null
      );
    },
    getNavigationRowNodes(rowKey = "") {
      const key = String(rowKey || "").trim();
      if (!key) {
        return [];
      }
      const cached =
        this.navModel?.domVersion === Number(this.navigationDomVersion || 0) ? this.navModel?.rowNodesByRowKey?.get(key) : null;
      if (Array.isArray(cached) && cached.length) {
        return cached.filter((node) => node?.isConnected);
      }
      const rowSection = this.getNavigationRowSection(key);
      const track = rowSection?.querySelector?.(".home-track, .home-grid-track") || null;
      return Array.from(track?.querySelectorAll(".home-content-card.focusable") || []);
    },
    rememberMainRowFocus(node) {
      if (!this.isMainNode(node)) {
        return;
      }
      const rowKey = this.getNodeRowKey(node);
      if (!rowKey || rowKey === "__hero__") {
        return;
      }
      this.lastFocusedItemIndexByRowKey = {
        ...(this.lastFocusedItemIndexByRowKey || {}),
        [rowKey]: Math.max(0, Number(node.dataset?.navCol || 0))
      };
    },
    resolvePreferredNodeForRow(rowNodes = [], _fallbackCol = 0) {
      if (!Array.isArray(rowNodes) || !rowNodes.length) {
        return null;
      }
      const rowKey = this.getNodeRowKey(rowNodes[0]);
      const storedIndex = rowKey ? Number(this.lastFocusedItemIndexByRowKey?.[rowKey]) : Number.NaN;
      const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
      return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
    },
    focusWithoutAutoScroll(target, { suppressDelegatedFocus = false } = {}) {
      if (suppressDelegatedFocus && target) {
        this.pendingDelegatedFocusTarget = target;
      }
      focusWithoutAutoScroll(target);
    },
    getCurrentFocusedNode() {
      if (this.currentFocusedNode && this.container?.contains(this.currentFocusedNode)) {
        return this.currentFocusedNode;
      }
      const focused = this.container?.querySelector(".focusable.focused") || null;
      this.currentFocusedNode = focused;
      return focused;
    },
    setCurrentFocusedNode(node = null) {
      this.currentFocusedNode = node instanceof HTMLElement ? node : null;
    },
    setFocusedNode(target, { suppressDelegatedFocus = false } = {}) {
      if (this.homeHoldFocusLocked) {
        return target instanceof HTMLElement ? target : null;
      }
      const current = this.getCurrentFocusedNode();
      if (current && current !== target && current.isConnected) {
        current.classList.remove("focused");
      }
      if (!(target instanceof HTMLElement)) {
        this.setCurrentFocusedNode(null);
        return null;
      }
      target.classList.add("focused");
      this.setCurrentFocusedNode(target);
      this.focusWithoutAutoScroll(target, { suppressDelegatedFocus });
      this.scheduleHomeLazyImageHydration(target);
      return target;
    },
    markUserInteractionSinceHomePaint() {
      this.hasUserInteractedSinceHomePaint = true;
      this.forceInitialContinueWatchingFocus = false;
      if (this.isRestoringFocusFromBack || this.pendingBackFocusState) {
        this.isRestoringFocusFromBack = false;
        this.clearStoredReturnFocusState();
      }
    },
    getInitialFocusSelector() {
      if (this.layoutMode === "grid") {
        return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-grid-track .home-content-card.focusable";
      }
      if (this.layoutMode === "classic") {
        return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
      }
      if (this.layoutMode === "modern") {
        return ".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
      }
      return ".home-main .focusable";
    },
    getNodeHeroSource(node) {
      if (!node) {
        return null;
      }
      if (node.classList.contains("home-hero-card")) {
        return this.heroItem || this.heroCandidates?.[0] || null;
      }
      if (node.dataset.cwIndex != null) {
        return normalizeContinueWatchingItem(
          this.continueWatchingRenderedItems?.[Number(node.dataset.cwIndex)] ||
            this.continueWatchingDisplay?.[Number(node.dataset.cwIndex)] ||
            null
        );
      }
      if (node.dataset.rowIndex != null && node.dataset.itemIndex != null) {
        const row = this.rows?.[Number(node.dataset.rowIndex)] || null;
        const item = row?.result?.data?.items?.[Number(node.dataset.itemIndex)] || null;
        return normalizeHomeRowItem(row, item);
      }
      return null;
    }
  };
}
