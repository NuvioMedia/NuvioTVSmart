/* eslint-disable no-unused-vars */
import * as internals from "./folderDetailScreen.js";

export function createFolderDetailScreenMethods03() {
  const {
    ScreenUtils,
    HomeScreen,
    buildModernHomeSizingStyle,
    buildModernHeroPresentation,
    createPosterCardMarkup,
    createSeeAllCardMarkup,
    escapeAttribute,
    escapeHtml,
    formatCatalogRowTitle,
    renderContinueWatchingSection,
    renderModernHomeLayout,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    renderLoadingIndicator,
    escapeFolderHtml,
    folderPosterLoadingMode,
    buildHeroDisplay,
    buildFolderHeroSeed,
    sourceType,
    buildFolderSourceRows
  } = internals;

  return {
    render() {
      this.cancelScheduledRender();
      if (this.useHomeFollowLayout) {
        this.renderFollowLayout();
        return;
      }
      const enterClass = ScreenUtils.routeEnterClass(this, this.folderRouteEnterPending, " nuvio-route-slide-enter");
      this.folderRouteEnterPending = false;
      const sourceRows = this.viewMode === "TABBED_GRID" ? this.sourceTabs || [] : this.tabs.filter((tab) => !tab.isAllTab);
      const heroDisplay = buildHeroDisplay(this.heroItem) || buildHeroDisplay(buildFolderHeroSeed(this.folder));
      const selectedTab = this.getSelectedTab();
      const items = selectedTab?.items || [];
      const cards = items.length
        ? items
            .map(
              (item, index) => `
              <article class="seeall-card focusable"
                       data-action="openDetail"
                       data-item-id="${escapeHtml(item.id || "")}"
                       data-item-type="${escapeHtml(item.type || item.catalogType || "movie")}"
                       data-item-title="${escapeHtml(item.name || "Untitled")}"
                       data-poster-src="${escapeHtml(item.poster || "")}"
                       data-backdrop-src="${escapeHtml(item.background || item.poster || "")}"
                       data-addon-base-url="${escapeHtml(item.addonBaseUrl || selectedTab?.source?.addonBaseUrl || "")}"
                       data-addon-id="${escapeHtml(item.addonId || selectedTab?.source?.addonId || "")}"
                       data-addon-name="${escapeHtml(item.addonName || selectedTab?.source?.addonName || "")}"
                       data-catalog-type="${escapeHtml(item.catalogType || sourceType(selectedTab?.source || {}) || "")}"
                       data-focus-key="item:${escapeHtml(item.id || index)}"
                       data-item-index="${index}">
                <div class="seeall-card-poster-wrap">
                  ${
                    item.poster
                      ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="${folderPosterLoadingMode()}" decoding="async" />`
                      : `<div class="seeall-card-poster placeholder"></div>`
                  }
                  ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
                </div>
                ${
                  this.layoutPrefs?.posterLabelsEnabled !== false
                    ? `
                  <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                  <div class="seeall-card-year">${escapeHtml(item.releaseInfo || "")}</div>
                `
                    : ""
                }
              </article>
            `
            )
            .join("")
        : `<div class="seeall-empty">${escapeFolderHtml(selectedTab?.error || "No items available.")}</div>`;

      const rowsMarkup = sourceRows
        .map((tab, index) => {
          const mediaTypeLabel = sourceType(tab.source || {}) === "series" ? "Series" : "Movie";
          const rowTitle = tab.label !== mediaTypeLabel ? `${tab.label} - ${mediaTypeLabel}` : tab.label;
          const rowCards = (tab.items || [])
            .map(
              (item, itemIndex) => `
            <article class="seeall-card focusable"
                     data-action="openDetail"
                     data-item-id="${escapeHtml(item.id || "")}"
                     data-item-type="${escapeHtml(item.type || item.catalogType || "movie")}"
                     data-item-title="${escapeHtml(item.name || "Untitled")}"
                     data-poster-src="${escapeHtml(item.poster || "")}"
                     data-backdrop-src="${escapeHtml(item.background || item.poster || "")}"
                     data-logo-src="${escapeHtml(item.logo || "")}"
                     data-addon-base-url="${escapeHtml(item.addonBaseUrl || tab.source?.addonBaseUrl || "")}"
                     data-addon-id="${escapeHtml(item.addonId || tab.source?.addonId || "")}"
                     data-addon-name="${escapeHtml(item.addonName || tab.source?.addonName || "")}"
                     data-catalog-type="${escapeHtml(item.catalogType || sourceType(tab.source || {}) || "")}"
                     data-release-info="${escapeHtml(item.releaseInfo || "")}"
                     data-description="${escapeHtml(item.description || "")}"
                     data-focus-key="row:${index}:item:${escapeHtml(item.id || itemIndex)}"
                     data-item-index="${itemIndex}">
              <div class="seeall-card-poster-wrap">
                ${
                  item.poster
                    ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="${folderPosterLoadingMode()}" decoding="async" />`
                    : `<div class="seeall-card-poster placeholder"></div>`
                }
                ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
              </div>
              ${
                this.layoutPrefs?.posterLabelsEnabled !== false
                  ? `
                <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                <div class="seeall-card-year">${escapeHtml(item.releaseInfo || "")}</div>
              `
                  : ""
              }
            </article>
          `
            )
            .join("");
          const loading = tab.loading
            ? `
              <div class="seeall-loading folder-row-loading">
                ${renderLoadingIndicator()}
                <span>Loading...</span>
              </div>
            `
            : "";
          const error = tab.error && !tab.loading ? `<div class="seeall-empty">${escapeHtml(tab.error)}</div>` : "";
          return `
            <section class="folder-detail-row">
              <h2 class="folder-detail-row-title">${escapeHtml(rowTitle)}</h2>
              <div class="folder-row-track" data-row-key="${escapeHtml(tab.key)}">
                ${rowCards}
              </div>
              ${error}
              ${loading}
            </section>
          `;
        })
        .join("");

      this.container.innerHTML =
        this.viewMode === "TABBED_GRID"
          ? `
              <div class="seeall-shell folder-detail-shell${enterClass}">
              <header class="seeall-header folder-detail-header">
                <div class="folder-detail-eyebrow">${escapeHtml(this.collection?.title || "Collection")}</div>
                <h2 class="seeall-title">${escapeHtml(this.folder?.title || "Folder")}</h2>
                ${
                  this.tabs.length > 1
                    ? `
                  <div class="folder-detail-tabs">
                    ${this.tabs
                      .map(
                        (tab, index) => `
                      <button type="button"
                              class="folder-detail-tab focusable${index === this.selectedTabIndex ? " is-selected" : ""}"
                              data-action="selectTab"
                              data-tab-index="${index}"
                              data-focus-key="tab:${index}">${escapeHtml(tab.label || "Tab")}</button>
                    `
                      )
                      .join("")}
                  </div>
                `
                    : ""
                }
              </header>
              <section class="seeall-grid">
                ${cards}
              </section>
              ${
                selectedTab?.loading
                  ? `
                <div class="seeall-loading">
                  ${renderLoadingIndicator()}
                  <span>Loading...</span>
                </div>
              `
                  : ""
              }
            </div>
          `
          : `
            <div class="seeall-shell folder-detail-shell folder-detail-follow-layout">
              <section class="folder-follow-hero">
                <div class="folder-follow-hero-media">
                  <img class="folder-follow-hero-backdrop" src="${escapeHtml(heroDisplay?.backdrop || "")}" alt="" />
                </div>
                <div class="folder-follow-hero-copy">
                  <img class="folder-follow-hero-logo" src="${escapeHtml(heroDisplay?.logo || "")}" alt=""${heroDisplay?.logo ? "" : ' hidden="hidden"'} />
                  <h1 class="folder-follow-hero-title${heroDisplay?.logo ? " is-hidden" : ""}">${escapeHtml(heroDisplay?.title || this.folder?.title || "")}</h1>
                  <div class="folder-follow-hero-meta">${escapeHtml((heroDisplay?.meta || []).join("  •  "))}</div>
                  <p class="folder-follow-hero-description">${escapeHtml(heroDisplay?.description || " ")}</p>
                </div>
              </section>
              <section class="folder-detail-rows">
                ${rowsMarkup}
              </section>
            </div>
          `;

      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      this.restoreFocus();
      this.applyHeroToDom();
    },
    renderFollowLayout() {
      this.renderedLayoutMode = "modern";
      // Catalog sources resolve independently. Preserve the live TV-navigation state
      // before replacing the layout so an arriving row cannot send focus to the top.
      const liveFocusState = HomeScreen.captureCurrentContentFocusState.call(this);
      HomeScreen.cancelModernCameraFollow.call(this, { stopAnimations: true });
      HomeScreen.teardownModernTrackScrollPagination.call(this);
      HomeScreen.cancelFocusedPosterFlow.call(this);
      const enterClass = ScreenUtils.routeEnterClass(this, this.folderRouteEnterPending, " nuvio-route-slide-enter");
      this.folderRouteEnterPending = false;
      this.expandedPosterNode = null;
      this.rows = buildFolderSourceRows(this.tabs || []);
      const modernLandscapePostersEnabled = Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
      const rowItems = this.rows.flatMap((row) => row?.result?.data?.items || []);
      this.heroCandidates = [this.heroItem, ...rowItems].filter((item) => item?.id);
      const heroItem = this.heroItem || this.heroCandidates[0] || null;
      const payload = renderModernHomeLayout({
        rows: this.rows,
        heroItem,
        heroCandidates: this.heroCandidates,
        continueWatchingItems: [],
        continueWatchingLoading: false,
        continueWatchingLoadingCount: 0,
        rowItemLimit: 50,
        showHeroSection: Boolean(heroItem),
        showPosterLabels: false,
        showCatalogTypeSuffix: this.layoutPrefs?.catalogTypeSuffixEnabled !== false,
        preferLandscapePosters: modernLandscapePostersEnabled,
        focusedRowKey: "",
        focusedItemIndex: -1,
        expandFocusedPoster: false,
        buildModernHeroPresentation,
        renderContinueWatchingSection,
        createPosterCardMarkup,
        createSeeAllCardMarkup,
        formatCatalogRowTitle,
        watchedTitleIds: this.watchedTitleIds,
        escapeHtml,
        escapeAttribute
      });
      this.catalogSeeAllMap = payload.catalogSeeAllMap;
      const sizingStyle = buildModernHomeSizingStyle(this.layoutPrefs);
      const fullScreenBackdropClass = this.layoutPrefs?.modernHeroFullScreenBackdropEnabled ? " home-modern-fullscreen-backdrop" : "";
      this.container.innerHTML = `
          <div class="home-shell home-screen-shell home-layout-modern${modernLandscapePostersEnabled ? " home-modern-landscape-posters" : ""}${fullScreenBackdropClass} folder-detail-home-shell" style="${escapeAttribute(sizingStyle)}">
            <main class="home-main home-screen-main">
              <div class="home-route-content${enterClass}">
                ${payload.markup}
              </div>
            </main>
          </div>
        `;
      ScreenUtils.indexFocusables(this.container);
      HomeScreen.buildNavigationModel.call(this);
      HomeScreen.bindHomeViewportEvents.call(this);
      if (modernLandscapePostersEnabled) {
        HomeScreen.applyCachedModernLandscapePosterMetrics.call(
          this,
          this.container.querySelector(".home-screen-shell.home-modern-landscape-posters")
        );
      } else {
        HomeScreen.applyCachedModernPortraitPosterMetrics.call(
          this,
          this.container.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)")
        );
      }
      const restoredLiveFocus = liveFocusState && HomeScreen.restoreModernFocusState.call(this, liveFocusState);
      if (!restoredLiveFocus) {
        this.restoreFocus();
      }
      this.setupModernTrackScrollPagination();
      HomeScreen.applyHeroToDom.call(this);
      HomeScreen.ensureHomeTruncationObservers.call(this);
      HomeScreen.scheduleHomeTruncationUpdate.call(this);
    },
    setupModernTrackScrollPagination() {
      HomeScreen.teardownModernTrackScrollPagination.call(this);
      if (!this.useHomeFollowLayout || !this.container) {
        return;
      }
      const tracks = Array.from(this.container.querySelectorAll(".home-modern-row .home-track"));
      this._trackScrollHandlers = this._trackScrollHandlers || new Map();
      tracks.forEach((track) => {
        const rowKey = String(track.dataset.trackRowKey || "");
        if (!rowKey || this._trackScrollHandlers.has(track)) {
          return;
        }
        const handler = () => {
          if (this._trackPaginationInFlight?.has(rowKey)) {
            return;
          }
          const cards = track.querySelectorAll(".home-content-card:not(.home-poster-card-loading)");
          const firstCard = cards[0];
          const cardWidth = firstCard ? firstCard.offsetWidth : 230;
          const nearEndThreshold = (cardWidth + 24) * 4;
          const distanceFromEnd = track.scrollWidth - (track.scrollLeft + track.clientWidth);
          if (distanceFromEnd > nearEndThreshold) {
            return;
          }
          void this.loadMoreFollowLayoutRow(rowKey, track);
        };
        this._trackScrollHandlers.set(track, handler);
        track.addEventListener("scroll", handler, { passive: true });
        handler();
      });
    }
  };
}
