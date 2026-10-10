import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods22() {
  const {
    Router,
    catalogRepository,
    filterReleasedItems,
    HomeCatalogStore,
    buildModernRowKey,
    buildCatalogDisableKey,
    buildCatalogOrderKey,
    HOME_ROW_RETRY_TIMEOUT_MS,
    HOME_ROW_TIMEOUT_MS,
    uniqueById,
    buildCollectionHomeRow,
    withTimeout,
    buildCatalogLoadingItems,
    normalizeContinueWatchingItem,
    isPresentableContinueWatchingItem
  } = internals;

  return {
    pickInitialHero() {
      if (this.layoutMode === "modern" && this.layoutPrefs?.continueWatchingEnabled !== false) {
        if (
          this.continueWatchingLoading &&
          Array.isArray(this.continueWatching) &&
          this.continueWatching.length &&
          !this.continueWatchingDisplay?.length
        ) {
          return null;
        }
        const continueHero = normalizeContinueWatchingItem(this.continueWatchingDisplay?.[0] || null);
        if (continueHero && isPresentableContinueWatchingItem(continueHero, { requireArtwork: true })) {
          return continueHero;
        }
      }
      return this.heroCandidates[0] || this.pickHeroItem(this.rows);
    },
    filterUnreleasedResult(result) {
      if (!this.layoutPrefs?.hideUnreleasedContent || result?.status !== "success") {
        return result;
      }
      const items = result.data?.items;
      if (!Array.isArray(items)) {
        return result;
      }
      const filtered = filterReleasedItems(items);
      if (filtered === items) {
        return result;
      }
      return { ...result, data: { ...result.data, items: filtered } };
    },
    async fetchCatalogRows(descriptors = [], options = {}) {
      const allowLoading = Boolean(options?.allowLoading);
      const timeoutMs = Number(options?.timeoutMs || HOME_ROW_TIMEOUT_MS);
      const loadingCount = this.getLoadingRowItemCount();
      const batchSize = Math.max(0, Number(options?.batchSize || 0));
      const onBatch = typeof options?.onBatch === "function" ? options.onBatch : null;
      const onRow = typeof options?.onRow === "function" ? options.onRow : null;
      const fetchedRows = [];
      const normalizedDescriptors = Array.isArray(descriptors) ? descriptors : [];

      const fetchBatch = async (batchDescriptors = []) => {
        const rowResults = await Promise.all(
          batchDescriptors.map(async (catalog) => {
            const result = this.filterUnreleasedResult(
              await withTimeout(
                options.prefetchedResults?.get(catalog) ??
                  catalogRepository.getCatalog({
                    addonBaseUrl: catalog.addonBaseUrl,
                    addonId: catalog.addonId,
                    addonName: catalog.addonName,
                    catalogId: catalog.catalogId,
                    catalogName: catalog.catalogName,
                    type: catalog.type,
                    skip: 0,
                    skipStep: catalog.skipStep,
                    supportsSkip: catalog.supportsSkip !== false
                  }),
                timeoutMs,
                { status: "error", message: "timeout" }
              )
            );
            const rowKey = buildModernRowKey(catalog);
            const row = {
              ...catalog,
              result: result?.status === "success" ? result : allowLoading ? { status: "loading" } : result,
              loadingItems: allowLoading && result?.status !== "success" ? buildCatalogLoadingItems(rowKey, loadingCount) : null,
              homeCatalogKey: buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId),
              homeCatalogDisableKey: buildCatalogDisableKey(catalog.addonBaseUrl, catalog.type, catalog.catalogId, catalog.catalogName)
            };
            if (onRow && (row.result?.status === "success" || allowLoading)) {
              onRow(row);
            }
            return row;
          })
        );
        const mappedRows = rowResults.filter((row) => row.result?.status === "success" || allowLoading);
        fetchedRows.push(...mappedRows);
        if (onBatch && mappedRows.length) {
          onBatch(mappedRows);
        }
      };

      if (batchSize > 0 && normalizedDescriptors.length > batchSize) {
        for (let index = 0; index < normalizedDescriptors.length; index += batchSize) {
          await fetchBatch(normalizedDescriptors.slice(index, index + batchSize));
          if (index + batchSize < normalizedDescriptors.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        return fetchedRows;
      }

      await fetchBatch(normalizedDescriptors);
      return fetchedRows;
    },
    sortAndFilterRows(rows = [], collections = []) {
      const collectionRows = (Array.isArray(collections) ? collections : [])
        .map((collection) => buildCollectionHomeRow(collection))
        .filter((row) => Array.isArray(row?.result?.data?.items) && row.result.data.items.length);
      const catalogRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.rowKind !== "collection");
      const rowMap = new Map([...catalogRows, ...collectionRows].map((row) => [row.homeCatalogKey, row]));
      const allKeys = Array.from(rowMap.keys());
      const orderedKeys = HomeCatalogStore.ensureOrderKeys(allKeys);
      const homeCatalogPrefs = HomeCatalogStore.get();
      const disabledKeys = new Set(homeCatalogPrefs.disabled || []);
      const customTitles = homeCatalogPrefs.customTitles || {};
      const applyCustomTitle = (row) => {
        const customTitle = String(customTitles[row?.homeCatalogKey] || "").trim();
        return customTitle ? { ...row, catalogName: customTitle } : row;
      };
      const isRowDisabled = (row) => disabledKeys.has(row.homeCatalogDisableKey) || disabledKeys.has(row.homeCatalogKey);
      const pinnedTopRows = collectionRows.filter((row) => row.pinToTop && !isRowDisabled(row)).map(applyCustomTitle);
      const pinnedKeys = new Set(pinnedTopRows.map((row) => row.homeCatalogKey));
      const orderedRows = orderedKeys
        .filter((key) => !pinnedKeys.has(key))
        .map((key) => rowMap.get(key))
        .filter(Boolean)
        .filter((row) => !isRowDisabled(row))
        .map(applyCustomTitle);
      return [...pinnedTopRows, ...orderedRows];
    },
    retryPendingCatalogRows() {
      if (this.catalogRetryInFlight) {
        return;
      }
      const pendingRows = (this.rows || []).filter((row) => row?.result?.status === "loading");
      if (!pendingRows.length) {
        return;
      }
      const token = this.homeLoadToken;
      this.catalogRetryInFlight = true;
      const retryBatchSize = Math.max(1, Number(this.getDeferredCatalogBatchSize() || pendingRows.length || 1));
      (async () => {
        for (let index = 0; index < pendingRows.length; index += retryBatchSize) {
          const batch = pendingRows.slice(index, index + retryBatchSize);
          const settled = await Promise.allSettled(
            batch.map(async (row) => {
              const result = this.filterUnreleasedResult(
                await withTimeout(
                  catalogRepository.getCatalog({
                    addonBaseUrl: row.addonBaseUrl,
                    addonId: row.addonId,
                    addonName: row.addonName,
                    catalogId: row.catalogId,
                    catalogName: row.catalogName,
                    type: row.type,
                    skip: 0,
                    skipStep: row.skipStep,
                    supportsSkip: row.supportsSkip !== false
                  }),
                  HOME_ROW_RETRY_TIMEOUT_MS,
                  { status: "error", message: "timeout" }
                )
              );
              if (result?.status !== "success") {
                return null;
              }
              if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
                return null;
              }
              const updatedRow = { ...row, result };
              const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
              combinedByKey.set(updatedRow.homeCatalogKey, updatedRow);
              this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
              this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
              if (!this.heroItem) {
                this.heroItem = this.pickInitialHero();
              }
              this.requestBackgroundRender();
              return updatedRow;
            })
          );
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          settled
            .filter((entry) => entry?.status === "rejected")
            .forEach((entry) => console.warn("Retry catalog row load failed", entry.reason));
          if (index + retryBatchSize < pendingRows.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      })().finally(() => {
        if (token === this.homeLoadToken) {
          this.catalogRetryInFlight = false;
        }
      });
    }
  };
}
