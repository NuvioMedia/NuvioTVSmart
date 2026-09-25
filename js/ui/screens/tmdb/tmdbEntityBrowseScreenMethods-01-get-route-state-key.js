/* eslint-disable no-unused-vars */
import * as internals from "./tmdbEntityBrowseScreen.js";

export function createTmdbEntityBrowseScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    TmdbMetadataService,
    TmdbSettingsStore,
    LayoutPreferences,
    watchedItemsRepository,
    watchedTitleStateRepository,
    I18n,
    buildWatchedTitleIdSet,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    renderLoadingIndicator,
    t,
    escapeHtml,
    bindLogoContrast,
    normalizeEntityKind,
    normalizeEntityId,
    normalizeSourceType,
    releaseYear,
    mediaLabel,
    railLabel,
    entityKindLabel,
    routeStateClone
  } = internals;

  return {
    getRouteStateKey(params = {}) {
      const entityId = normalizeEntityId(params?.entityId);
      if (!entityId) {
        return null;
      }
      return `tmdbEntityBrowse:${normalizeEntityKind(params?.entityKind)}:${entityId}:${normalizeSourceType(params?.sourceType)}`;
    },
    captureRouteState() {
      this.captureViewState();
      return {
        params: this.params ? { ...this.params } : {},
        data: routeStateClone(this.data),
        watchedTitleIds: Array.from(this.watchedTitleIds || []),
        savedScrollTop: Number(this.savedScrollTop || 0),
        trackScrollLeftByKey: { ...(this.trackScrollLeftByKey || {}) },
        railFocusIndexByKey: { ...(this.railFocusIndexByKey || {}) },
        lastFocusedRailKey: this.lastFocusedRailKey || "",
        lastFocusedItemId: this.lastFocusedItemId || ""
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      if (!snapshot?.params || !snapshot?.data) {
        return false;
      }
      const currentKey = this.getRouteStateKey(params);
      const snapshotKey = this.getRouteStateKey(snapshot.params);
      if (!currentKey || currentKey !== snapshotKey) {
        return false;
      }
      const data = routeStateClone(snapshot.data);
      if (!data?.header || !Array.isArray(data.rails)) {
        return false;
      }
      this.params = params || {};
      this.data = data;
      this.watchedTitleIds = new Set(Array.isArray(snapshot.watchedTitleIds) ? snapshot.watchedTitleIds.map(String) : []);
      this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
      this.trackScrollLeftByKey = { ...(snapshot.trackScrollLeftByKey || {}) };
      this.railFocusIndexByKey = { ...(snapshot.railFocusIndexByKey || {}) };
      this.lastFocusedRailKey = String(snapshot.lastFocusedRailKey || "");
      this.lastFocusedItemId = String(snapshot.lastFocusedItemId || "");
      this.pendingRestoreFocus = true;
      return true;
    },
    async refreshWatchedTitleIds(items = null) {
      const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
      const railItems = Array.isArray(items)
        ? items
        : (this.data?.rails || []).flatMap((rail) => (Array.isArray(rail?.items) ? rail.items : []));
      const projectedItems = await watchedTitleStateRepository
        .getTitleWatchedItems(railItems, {
          baseWatchedItems: watchedItems,
          limit: 5000
        })
        .catch(() => watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(projectedItems);
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("tmdbEntityBrowse");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.layoutPrefs = LayoutPreferences.get();
      this.loadToken = (this.loadToken || 0) + 1;
      this.data = null;
      this.error = "";
      this.loading = false;
      this.savedScrollTop = 0;
      this.trackScrollLeftByKey = {};
      this.railFocusIndexByKey = {};
      this.lastFocusedRailKey = "";
      this.lastFocusedItemId = "";
      this.pendingRestoreFocus = false;
      this.loadingRails = new Set();
      this.posterOptionsController = null;
      this.posterOptionsFocusKey = "";
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;

      if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
        this.render();
        return;
      }

      const routeLoadToken = this.loadToken;
      const watchedTitleIdsPromise = this.refreshWatchedTitleIds();
      this.renderLoading();

      // Android starts the browse ViewModel from the composed screen. Waiting
      // for the local watched snapshot must not keep Router.navigate() pending;
      // metadata remains responsible for publishing the loaded/error state.
      void (async () => {
        await watchedTitleIdsPromise;
        if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "tmdbEntityBrowse") {
          return;
        }
        await this.load();
      })().catch((error) => {
        if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "tmdbEntityBrowse") {
          return;
        }
        console.warn("TMDB entity browse background start failed", error);
        this.renderError(t("tmdb_entity_error_load", {}, "Could not load this selection"));
      });
    },
    async load() {
      const token = this.loadToken;
      const settings = TmdbSettingsStore.get();
      const entityKind = normalizeEntityKind(this.params?.entityKind);
      const entityId = normalizeEntityId(this.params?.entityId);
      const sourceType = normalizeSourceType(this.params?.sourceType);
      const fallbackName = String(this.params?.entityName || this.params?.fallbackTitle || "").trim();
      if (!entityId) {
        this.renderError(t("tmdb_entity_error_load_named", [fallbackName || entityKindLabel(entityKind)], "Could not load %1$s"));
        return;
      }

      this.loading = true;
      this.error = "";
      try {
        const data = await TmdbMetadataService.fetchEntityBrowse({
          entityKind,
          entityId,
          sourceType,
          fallbackName,
          language: settings.language
        });
        if (token !== this.loadToken) {
          return;
        }
        this.loading = false;
        if (!data) {
          this.renderError(t("tmdb_entity_error_load_named", [fallbackName || entityKindLabel(entityKind)], "Could not load %1$s"));
          return;
        }
        this.data = data;
        this.pendingRestoreFocus = false;
        this.render();
        void this.refreshWatchedTitleIds().then(() => {
          if (token === this.loadToken && Router.getCurrent() === "tmdbEntityBrowse") {
            this.render();
          }
        });
      } catch (error) {
        if (token !== this.loadToken) {
          return;
        }
        console.warn("TMDB entity browse load failed", error);
        this.loading = false;
        this.renderError(t("tmdb_entity_error_load_named", [fallbackName || entityKindLabel(entityKind)], "Could not load %1$s"));
      }
    },
    renderLoading() {
      this.container.innerHTML = `
          <div class="tmdb-entity-shell tmdb-entity-shell-state">
            <div class="tmdb-entity-state">
              ${renderLoadingIndicator()}
              <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
            </div>
          </div>
        `;
    },
    renderError(message) {
      this.error = String(message || "");
      this.container.innerHTML = `
          <div class="tmdb-entity-shell tmdb-entity-shell-state">
            <div class="tmdb-entity-state">
              <div class="tmdb-entity-state-title">${escapeHtml(message)}</div>
              <button class="tmdb-entity-retry focusable" data-action="retry">
                ${escapeHtml(t("action_retry", {}, "Retry"))}
              </button>
            </div>
          </div>
        `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container, ".tmdb-entity-retry.focusable");
    },
    getHeroBackdrop() {
      const rails = Array.isArray(this.data?.rails) ? this.data.rails : [];
      for (const rail of rails) {
        const item = Array.isArray(rail?.items) ? rail.items.find((entry) => entry?.background) : null;
        if (item?.background) {
          return item.background;
        }
      }
      return "";
    },
    renderHero() {
      const header = this.data?.header || {};
      const meta = [header.originCountry, header.secondaryLabel].filter(Boolean).join(" • ");
      const backdrop = this.getHeroBackdrop();
      const description = String(header.description || "").trim();
      const direction = I18n.isRtl() ? "rtl" : "ltr";
      const heroClass = header.logo ? "tmdb-entity-hero tmdb-entity-hero-has-logo" : "tmdb-entity-hero";
      return `
          <section class="${heroClass}">
            ${
              backdrop
                ? `<img class="tmdb-entity-hero-backdrop" src="${escapeHtml(backdrop)}" alt="" aria-hidden="true" onerror="this.hidden=true" />`
                : ""
            }
            <div class="tmdb-entity-hero-scrim" aria-hidden="true"></div>
            <div class="tmdb-entity-hero-copy" dir="${direction}">
              <div class="tmdb-entity-eyebrow">${escapeHtml(entityKindLabel(header.kind))}</div>
              ${
                header.logo
                  ? `<img class="tmdb-entity-logo" src="${escapeHtml(header.logo)}" alt="${escapeHtml(header.name || "")}" loading="${ScreenUtils.shouldSkipRouteEnter(this) ? "lazy" : "eager"}" decoding="async" onerror="this.hidden=true" />`
                  : ""
              }
              <h1 class="tmdb-entity-title">${escapeHtml(header.name || "Unknown")}</h1>
              ${meta ? `<div class="tmdb-entity-meta">${escapeHtml(meta)}</div>` : ""}
              ${description ? `<p class="tmdb-entity-description">${escapeHtml(description)}</p>` : ""}
            </div>
          </section>
        `;
    },
    renderRail(rail) {
      const railKey = String(rail?.key || `${rail?.mediaType || "movie"}:${rail?.railType || "popular"}`);
      const items = Array.isArray(rail?.items) ? rail.items : [];
      const cards = items
        .map((item, index) => {
          const poster = String(item?.poster || "").trim();
          const background = String(item?.background || item?.backdrop || "").trim();
          const title = item?.name || "Untitled";
          const itemId = String(item?.id || "").trim();
          return `
              <article class="tmdb-entity-card focusable"
                       data-action="openDetail"
                       data-item-id="${escapeHtml(itemId)}"
                       data-item-type="${escapeHtml(item?.type || (rail?.mediaType === "tv" ? "series" : "movie"))}"
                       data-item-title="${escapeHtml(title)}"
                       data-poster-src="${escapeHtml(poster)}"
                       data-backdrop-src="${escapeHtml(background)}"
                       data-focus-key="${escapeHtml(`${railKey}:${itemId || index}`)}"
                       data-rail-key="${escapeHtml(railKey)}"
                       data-item-index="${index}"
                       aria-label="${escapeHtml(title)}">
                <div class="tmdb-entity-card-poster-wrap">
                  ${
                    poster
                      ? `<img class="tmdb-entity-card-poster" src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" onerror="this.hidden=true; this.nextElementSibling.hidden=false" />`
                      : ""
                  }
                  <div class="tmdb-entity-card-placeholder"${poster ? " hidden" : ""}></div>
                  ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
                </div>
                ${
                  this.layoutPrefs?.posterLabelsEnabled !== false
                    ? `
                  <div class="tmdb-entity-card-title">${escapeHtml(title)}</div>
                  <div class="tmdb-entity-card-year">${escapeHtml(releaseYear(item))}</div>
                `
                    : ""
                }
              </article>
            `;
        })
        .join("");

      return `
          <section class="tmdb-entity-rail" data-rail-key="${escapeHtml(railKey)}">
            <h2 class="tmdb-entity-rail-title" dir="${I18n.isRtl() ? "rtl" : "ltr"}">${escapeHtml(`${mediaLabel(rail?.mediaType)} • ${railLabel(rail?.railType)}`)}</h2>
            <div class="tmdb-entity-track" data-scroll-key="${escapeHtml(railKey)}">
              ${cards}
              ${rail?.isLoading ? `<div class="tmdb-entity-rail-loading">${renderLoadingIndicator()}</div>` : ""}
            </div>
          </section>
        `;
    },
    render() {
      if (!this.data) {
        this.renderLoading();
        return;
      }
      const rails = Array.isArray(this.data.rails) ? this.data.rails : [];
      const shellContent = rails.length
        ? `${this.renderHero()}<div class="tmdb-entity-rails">${rails.map((rail) => this.renderRail(rail)).join("")}</div>`
        : `
            <div class="tmdb-entity-empty">
              <div class="tmdb-entity-state-title">${escapeHtml(t("tmdb_entity_empty_title", {}, "No titles found"))}</div>
              <div class="tmdb-entity-state-subtitle">${escapeHtml(t("tmdb_entity_empty_subtitle", {}, "TMDB does not currently have browseable titles for this selection."))}</div>
            </div>
          `;
      this.container.innerHTML = `<div class="tmdb-entity-shell">${shellContent}</div>`;
      bindLogoContrast(this.container.querySelector(".tmdb-entity-logo"));
      ScreenUtils.indexFocusables(this.container, ".tmdb-entity-card.focusable");
      this.bindShellEvents();

      if (this.pendingRestoreFocus) {
        this.pendingRestoreFocus = false;
        this.restoreFocusedCard();
        return;
      }
      ScreenUtils.setInitialFocus(this.container, ".tmdb-entity-card.focusable");
      const initial = this.container.querySelector(".tmdb-entity-card.focusable.focused");
      if (initial) {
        this.rememberFocusedCard(initial);
        this.syncFocusedCardScroll(initial, { instant: true });
      }
    }
  };
}
