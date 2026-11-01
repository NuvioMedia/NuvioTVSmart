import { customPosterForItem, posterFallbackAttributes } from "../../../core/poster/customPoster.js";
/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods02() {
  const {
    addonRepository,
    catalogRepository,
    I18n,
    contentTextDirection,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    filterReleasedItems,
    buildSearchScheduleIndices,
    buildSearchTargets,
    catalogSkipStep,
    catalogSupportsExtra,
    escapeHtml,
    t,
    formatCatalogRowTitle,
    isSearchableCatalogType,
    getSearchResultsPerRow,
    getSearchDiscoverResultsPerRow,
    getSearchCatalogBatchSize,
    getSearchCatalogTimeoutMs,
    formatReleaseYear,
    withTimeout,
    buildRowStateKey
  } = internals;

  return {
    async loadDiscoverRows() {
      const addons = await addonRepository.getInstalledAddons({ includeMediaServers: true });
      const sections = [];
      const itemLimit = getSearchDiscoverResultsPerRow();
      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          const requiresSearch =
            Array.isArray(catalog.extra) &&
            catalog.extra.some(
              (extra) =>
                String(extra?.name || "")
                  .trim()
                  .toLowerCase() === "search" && Boolean(extra?.isRequired)
            );
          if (requiresSearch) return;
          if (!isSearchableCatalogType(catalog.apiType) && !catalogSupportsExtra(catalog, "search")) return;
          sections.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType,
            supportsSkip: catalogSupportsExtra(catalog, "skip"),
            skipStep: catalogSkipStep(catalog)
          });
        });
      });

      const picked = sections.slice(0, 8);
      const batchSize = getSearchCatalogBatchSize();
      const resolved = [];
      const loadSection = async (section) => {
        try {
          const result = await withTimeout(
            catalogRepository.getCatalog({
              addonBaseUrl: section.addonBaseUrl,
              addonId: section.addonId,
              addonName: section.addonName,
              catalogId: section.catalogId,
              catalogName: section.catalogName,
              type: section.type,
              skip: 0,
              skipStep: section.skipStep,
              supportsSkip: section.supportsSkip !== false
            }),
            getSearchCatalogTimeoutMs(),
            { status: "error", message: "timeout" }
          );
          return { ...section, result };
        } catch (err) {
          console.warn(`fail on load catalog ${section.catalogName}:`, err);
          return {
            ...section,
            result: { status: "error", message: "fetch_failed" }
          };
        }
      };

      if (batchSize > 0 && picked.length > batchSize) {
        for (let index = 0; index < picked.length; index += batchSize) {
          const batch = picked.slice(index, index + batchSize);
          resolved.push(...(await Promise.all(batch.map(loadSection))));
          if (index + batchSize < picked.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      } else {
        resolved.push(...(await Promise.all(picked.map(loadSection))));
      }

      return resolved
        .filter((entry) => entry.result?.status === "success" && entry.result?.data?.items?.length)
        .map((entry) => {
          const rawItems = entry.result?.data?.items || [];
          const items = this.layoutPrefs?.hideUnreleasedContent ? filterReleasedItems(rawItems) : rawItems;
          return {
            title: formatCatalogRowTitle(
              entry.catalogName,
              entry.addonName,
              entry.type,
              this.layoutPrefs?.catalogTypeSuffixEnabled !== false
            ),
            subtitle: this.layoutPrefs?.catalogAddonNameEnabled !== false ? `from ${entry.addonName || "Addon"}` : "",
            type: entry.type,
            addonBaseUrl: entry.addonBaseUrl,
            addonId: entry.addonId,
            addonName: entry.addonName,
            catalogId: entry.catalogId,
            catalogName: entry.catalogName,
            nextSkip: Number(entry.result?.data?.nextSkip || 0),
            hasMore: Boolean(items.length > itemLimit || entry.result?.data?.hasMore),
            initialItems: items,
            supportsSkip: entry.supportsSkip !== false && entry.result?.data?.supportsSkip !== false,
            skipStep: Number(entry.skipStep || entry.result?.data?.skipStep || 100),
            items: items.slice(0, itemLimit)
          };
        })
        .filter((row) => row.items.length);
    },
    cancelActiveSearchRequests() {
      const controllers = this.activeSearchControllers;
      this.activeSearchControllers = new Set();
      controllers?.forEach((controller) => controller.abort());
    },
    async searchRows(query, { token = this.loadToken, onFirstResults = null } = {}) {
      const addons = await addonRepository.getInstalledAddons({ includeMediaServers: true });
      if (token !== this.loadToken) return [];
      const searchableCatalogs = buildSearchTargets(addons);
      const scheduleIndices = buildSearchScheduleIndices(searchableCatalogs);
      const batchSize = getSearchCatalogBatchSize();
      const itemLimit = getSearchResultsPerRow();
      const responses = new Array(searchableCatalogs.length);
      let nextScheduleIndex = 0;
      let publishedFirstResults = false;
      const runCatalogSearch = async (catalog) => {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const controllers = (this.activeSearchControllers ||= new Set());
        if (controller) controllers.add(controller);
        try {
          const result = await withTimeout(
            catalogRepository.getCatalog({
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              type: catalog.type,
              skip: 0,
              skipStep: catalog.skipStep,
              extraArgs: { search: query },
              supportsSkip: catalog.supportsSkip,
              signal: controller?.signal || null
            }),
            getSearchCatalogTimeoutMs(),
            { status: "error", message: "timeout" },
            () => controller?.abort()
          );
          return { catalog, result };
        } catch (err) {
          console.warn(`fail on search catalog ${catalog.catalogName}:`, err);
          return {
            catalog,
            result: { status: "error", message: "fetch_failed" }
          };
        } finally {
          if (controller) controllers.delete(controller);
        }
      };

      const buildRows = () =>
        responses
          .filter(({ result } = {}) => result?.status === "success" && result?.data?.items?.length)
          .map(({ catalog, result }) => {
            const rawItems = result?.data?.items || [];
            const items = this.layoutPrefs?.hideUnreleasedContent ? filterReleasedItems(rawItems) : rawItems;
            return {
              title: formatCatalogRowTitle(
                catalog.catalogName,
                catalog.addonName,
                catalog.type,
                this.layoutPrefs?.catalogTypeSuffixEnabled !== false
              ),
              subtitle: this.layoutPrefs?.catalogAddonNameEnabled !== false ? `from ${catalog.addonName || "Addon"}` : "",
              type: catalog.type,
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              nextSkip: Number(result?.data?.nextSkip || 0),
              hasMore: Boolean(items.length > itemLimit || result?.data?.hasMore),
              initialItems: items,
              supportsSkip: catalog.supportsSkip !== false && result?.data?.supportsSkip !== false,
              extraArgs: { search: query },
              skipStep: Number(catalog.skipStep || result?.data?.skipStep || 100),
              items: items.slice(0, itemLimit)
            };
          })
          .filter((row) => row.items.length);

      const publishFirstResults = () => {
        if (publishedFirstResults || token !== this.loadToken || typeof onFirstResults !== "function") {
          return;
        }
        const rows = buildRows();
        if (!rows.length) return;
        publishedFirstResults = true;
        onFirstResults(rows);
      };

      const runWorker = async () => {
        while (token === this.loadToken) {
          const index = scheduleIndices[nextScheduleIndex];
          nextScheduleIndex += 1;
          if (typeof index !== "number") return;
          responses[index] = await runCatalogSearch(searchableCatalogs[index]);
          publishFirstResults();
        }
      };
      const workerCount = Math.min(batchSize > 0 ? batchSize : searchableCatalogs.length, searchableCatalogs.length);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      return buildRows();
    },
    renderRows() {
      if (!Array.isArray(this.rows) || !this.rows.length) {
        if (this.mode === "search") {
          return `
              <div class="search-empty-state search-empty-state-results">
                <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
                <h2>${escapeHtml(t("search_no_results_title", {}, "No Results"))}</h2>
                <p>${escapeHtml(t("search_no_results_subtitle", {}, "Try searching with different keywords"))}</p>
              </div>
            `;
        }
        if (!String(this.query || "").trim() && this.recentSearches?.length) {
          return this.renderRecentSearches();
        }
        return `
            <div class="search-empty-state">
              <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
              <h2>${escapeHtml(t("search_start_title", {}, "Start Searching"))}</h2>
              <p>${escapeHtml(
                this.layoutPrefs?.discoverLocation === "in_search"
                  ? t("search_start_subtitle", {}, "Enter at least 2 characters")
                  : t("search_start_subtitle_no_discover", {}, "Discover is disabled. Enter at least 2 characters")
              )}</p>
            </div>
          `;
      }

      return this.rows
        .map((row, rowIndex) => {
          const rowKey = row.stateKey || buildRowStateKey(row, rowIndex);
          const seeAllLabel = t("action_see_all", {}, "See All");
          const seeAllArrowClass = I18n.isRtl() ? " is-rtl" : "";
          const seeAllItems = Array.isArray(row.initialItems) ? row.initialItems : row.items || [];
          const hasEnoughForSeeAll = seeAllItems.length >= 15;
          return `
          <section class="search-results-row" data-row-key="${escapeHtml(rowKey)}">
            <h3 class="search-results-title" dir="${contentTextDirection(row.title)}">${row.title}</h3>
            ${row.subtitle ? `<div class="search-results-subtitle" dir="${contentTextDirection(row.subtitle)}">${row.subtitle}</div>` : ""}
            <div class="search-results-track">
              ${(row.items || [])
                .map((item) => customPosterForItem(item, "search"))
                .map(
                  (item) => `
                <article class="search-result-card focusable"
                         data-action="openDetail"
                         data-item-id="${item.id || ""}"
                         data-item-type="${item.type || row.type || "movie"}"
                         data-item-title="${item.name || "Untitled"}"
                         data-poster-src="${escapeHtml(item.poster || "")}"
                         data-backdrop-src="${escapeHtml(item.background || item.backdrop || item.landscapePoster || "")}"
                         data-addon-base-url="${escapeHtml(row.addonBaseUrl || item.addonBaseUrl || "")}"
                         data-addon-id="${escapeHtml(row.addonId || item.addonId || "")}"
                         data-addon-name="${escapeHtml(row.addonName || item.addonName || "")}"
                         data-catalog-type="${escapeHtml(row.type || item.catalogType || "")}"
                         data-row-key="${escapeHtml(rowKey)}">
                  <div class="search-result-poster-wrap">
                    ${item.poster ? `<img class="search-result-poster" ${posterFallbackAttributes(item)} src="${item.poster}" alt="" loading="lazy" decoding="async" />` : `<div class="search-result-poster placeholder"></div>`}
                    ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
                  </div>
                  <div class="search-result-name" dir="${contentTextDirection(item.name || "Untitled")}">${item.name || "Untitled"}</div>
                  <div class="search-result-date">${formatReleaseYear(item)}</div>
                </article>
              `
                )
                .join("")}
              ${
                hasEnoughForSeeAll
                  ? `
                <article class="search-result-card search-seeall-card focusable"
                         data-action="openCatalogSeeAll"
                         data-addon-base-url="${row.addonBaseUrl || ""}"
                         data-addon-id="${row.addonId || ""}"
                         data-addon-name="${row.addonName || ""}"
                         data-catalog-id="${row.catalogId || ""}"
                         data-catalog-name="${row.catalogName || ""}"
                         data-catalog-type="${row.type || "movie"}"
                         data-row-index="${rowIndex}"
                         data-row-key="${escapeHtml(rowKey)}">
                  <div class="search-seeall-inner">
                    <div class="search-seeall-arrow${seeAllArrowClass}" aria-hidden="true">&#8594;</div>
                    <div class="search-seeall-label">${escapeHtml(seeAllLabel)}</div>
                  </div>
                </article>
              `
                  : ""
              }
            </div>
          </section>
        `;
        })
        .join("");
    }
  };
}
