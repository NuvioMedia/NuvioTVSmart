/* eslint-disable no-unused-vars */
import * as internals from "./folderDetailScreen.js";

export function createFolderDetailScreenMethods04() {
  const {
    Router,
    ScreenUtils,
    TmdbService,
    TmdbSettingsStore,
    TmdbMetadataService,
    HomeScreen,
    createPosterCardMarkup,
    firstNonEmpty,
    hasTmdbItemId,
    buildEnrichedTmdbItem,
    fetchSourceItems
  } = internals;

  return {
    async loadMoreFollowLayoutRow(rowKey, track) {
      const rowIndex = (this.rows || []).findIndex((row) => String(row?.homeCatalogKey || "") === String(rowKey || ""));
      const rowData = rowIndex >= 0 ? this.rows[rowIndex] : null;
      const tabIndex = Number(rowData?.folderTabIndex ?? -1);
      const tab = this.tabs?.[tabIndex] || null;
      if (!rowData || !tab || tab.isAllTab || tab.loading || !tab.hasMore) {
        return;
      }
      this._trackPaginationInFlight = this._trackPaginationInFlight || new Set();
      this._trackPaginationInFlight.add(rowKey);
      const token = this.folderLoadToken;
      this.tabs[tabIndex] = { ...tab, loading: true, error: "" };
      try {
        const nextPage = Math.max(1, Number(tab.page || 1) + 1);
        const result = await fetchSourceItems(tab.source, nextPage, Number(tab.nextSkip || 0));
        if (token !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
          return;
        }
        const existing = Array.isArray(tab.items) ? tab.items : [];
        const seen = new Set(existing.map((item) => `${item.type}:${item.id}`));
        const incoming = (result.items || []).filter((item) => {
          const key = `${item.type}:${item.id}`;
          if (!item.id || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
        const merged = [...existing, ...incoming];
        const hasMore = Boolean(result.hasMore && incoming.length);
        this.tabs[tabIndex] = {
          ...this.tabs[tabIndex],
          items: merged,
          hasMore,
          supportsSkip: result.supportsSkip !== false,
          skipStep: Number(result.skipStep || tab.skipStep || 100),
          page: Number(result.page || nextPage),
          nextSkip: Number.isFinite(Number(result.nextSkip)) ? Math.max(0, Math.trunc(Number(result.nextSkip))) : Number(tab.nextSkip || 0),
          loading: false,
          error: ""
        };
        this.rebuildAllTab();
        if (rowData?.result?.data) {
          rowData.result.data.items = merged;
          rowData.result.data.hasMore = hasMore;
          rowData.result.data.supportsSkip = result.supportsSkip !== false;
          rowData.result.data.skipStep = Number(result.skipStep || tab.skipStep || 100);
          rowData.result.data.currentPage = Number(result.page || nextPage);
          rowData.result.data.nextSkip = Number.isFinite(Number(result.nextSkip))
            ? Math.max(0, Math.trunc(Number(result.nextSkip)))
            : Number(tab.nextSkip || 0);
        }
        if (incoming.length && track?.isConnected) {
          const modernLandscapePostersEnabled = Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
          const startIndex = existing.length;
          const newMarkup = incoming
            .map((item, index) =>
              createPosterCardMarkup(
                item,
                rowIndex,
                startIndex + index,
                rowData.type || "movie",
                rowData,
                false,
                "modern",
                false,
                modernLandscapePostersEnabled,
                false,
                this.watchedTitleIds
              )
            )
            .join("");
          const fragment = document.createRange().createContextualFragment(newMarkup);
          track.appendChild(fragment);
          ScreenUtils.indexFocusables(track);
          HomeScreen.buildNavigationModel.call(this);
          this.heroCandidates = [this.heroItem, ...(this.rows || []).flatMap((row) => row?.result?.data?.items || [])].filter(
            (item) => item?.id
          );
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
        if (rowData?.result) {
          rowData.result.status = "error";
        }
        console.warn("Folder track pagination failed", rowKey, error);
      } finally {
        this._trackPaginationInFlight?.delete(rowKey);
      }
    },
    mergeHeroIntoFolderTabs(itemId, mergedHero) {
      const mergeItems = (items = []) =>
        (Array.isArray(items) ? items : []).map((item) => {
          return String(item?.id || "") === String(itemId || "") ? { ...item, ...mergedHero } : item;
        });
      this.tabs = (this.tabs || []).map((tab) => ({
        ...tab,
        items: mergeItems(tab.items)
      }));
      this.sourceTabs = (this.sourceTabs || []).map((tab) => ({
        ...tab,
        items: mergeItems(tab.items)
      }));
    },
    async enrichCurrentHeroAsync(hero, focusToken = Number(this.heroFocusToken || 0), options = {}) {
      if (!this.useHomeFollowLayout) {
        return;
      }
      if (!hero || !hero.id || hero.heroSource === "continueWatching" || hero.heroSource === "collection" || hero.heroMetaEnriched) {
        return;
      }
      if (!hasTmdbItemId(hero)) {
        return HomeScreen.enrichCurrentHeroAsync.call(this, hero, focusToken, {
          ...options,
          routeName: "folderDetail"
        });
      }

      const itemId = String(hero.id || "");
      const itemType = String(hero.type || hero.apiType || "movie");
      const deferCommit = Boolean(options?.deferCommit);
      const token = (this.heroEnrichmentToken = Number(this.heroEnrichmentToken || 0) + 1);
      const matchesHero = (candidate) => {
        return String(candidate?.id || "") === itemId && String(candidate?.type || candidate?.apiType || "movie") === itemType;
      };
      const canCommitHero = () => {
        if (Number(this.heroEnrichmentToken) !== token || Number(this.heroFocusToken || 0) !== Number(focusToken || 0)) {
          return false;
        }
        if (!deferCommit) {
          return matchesHero(this.heroItem);
        }
        return Router.getCurrent() === "folderDetail" && matchesHero(this.getNodeHeroSource(this.getCurrentFocusedNode()));
      };
      const commitHero = (resolvedHero, { merge = false } = {}) => {
        if (!canCommitHero()) {
          return false;
        }
        this.heroItem = resolvedHero;
        if (merge) {
          HomeScreen.mergeHeroIntoCatalogState.call(this, itemId, resolvedHero);
          this.mergeHeroIntoFolderTabs(itemId, resolvedHero);
        }
        HomeScreen.applyHeroToDom.call(this);
        return true;
      };
      try {
        const settings = TmdbSettingsStore.get();
        const tmdbId = await TmdbService.ensureTmdbId(firstNonEmpty(hero.tmdbId, hero.id), itemType);
        if (!tmdbId) {
          commitHero({
            ...(deferCommit ? hero : this.heroItem),
            heroMetaEnriched: true,
            heroMetaEnriching: false
          });
          return;
        }
        const enriched = await TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType: itemType,
          language: settings.language
        });
        if (!canCommitHero()) {
          return;
        }
        const sourceHero = deferCommit ? hero : this.heroItem;
        const mergedHero = enriched
          ? {
              ...sourceHero,
              ...buildEnrichedTmdbItem(sourceHero, enriched, settings),
              heroMetaEnriched: true,
              heroMetaEnriching: false
            }
          : { ...sourceHero, heroMetaEnriched: true, heroMetaEnriching: false };
        commitHero(mergedHero, { merge: true });
      } catch (_error) {
        commitHero({
          ...(deferCommit ? hero : this.heroItem),
          heroMetaEnriched: true,
          heroMetaEnriching: false
        });
      }
    }
  };
}
