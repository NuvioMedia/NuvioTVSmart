import { resolveContinueWatchingEpisodeRating } from "./continueWatchingEpisodeRating.js";
import {
  dedupeContinueWatchingInProgress,
  isServerContentId,
  resolveContinueWatchingSeriesContentId
} from "./continueWatchingSeriesIdentity.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods27() {
  const {
    Router,
    mapWithConcurrency,
    TmdbService,
    TmdbMetadataService,
    TmdbSettingsStore,
    TMDB_API_KEY,
    CW_MAX_ENRICHMENT_CONCURRENCY,
    CW_MAX_VISIBLE_ITEMS,
    firstNonEmpty,
    prettyId,
    resolveImdbRating,
    parseRuntimeMinutes,
    isCollectionFolderItem,
    normalizeCollectionFolderItem,
    normalizeHomeRowItem,
    withTimeout,
    isSeriesTypeForContinueWatching,
    findEpisodeEntry,
    sortContinueWatchingItemsForDisplay,
    normalizeCatalogItem,
    isCloudContinueWatchingItem,
    needsContinueWatchingMetadataRefresh,
    applyCachedContinueWatchingEnrichment,
    saveContinueWatchingEnrichment
  } = internals;

  return {
    async enrichContinueWatching(items = [], options = {}) {
      const [enrichedInProgressItems, nextUpItems] = await Promise.all([
        mapWithConcurrency(items || [], CW_MAX_ENRICHMENT_CONCURRENCY, async (item) => {
          if (isCloudContinueWatchingItem(item)) {
            return {
              ...item,
              title: firstNonEmpty(item.title, item.name, item.contentId),
              description: firstNonEmpty(item.description),
              continueWatchingMetaResolved: true
            };
          }
          const cachedItem = applyCachedContinueWatchingEnrichment(item);
          const needsEpisodeRating =
            isSeriesTypeForContinueWatching(cachedItem.contentType || cachedItem.type) &&
            !Object.prototype.hasOwnProperty.call(cachedItem, "episodeImdbRating");
          // An episode id stored as a series content id can only be resolved by
          // the media server, so check each server series once before trusting
          // its cached enrichment.
          const needsServerSeriesIdentity =
            isSeriesTypeForContinueWatching(cachedItem.contentType || cachedItem.type) &&
            isServerContentId(cachedItem.contentId) &&
            cachedItem.serverSeriesIdentityChecked !== true;
          if (
            !options?.forceRefreshMetadata &&
            !needsEpisodeRating &&
            !needsServerSeriesIdentity &&
            !needsContinueWatchingMetadataRefresh([cachedItem])
          ) {
            return cachedItem;
          }
          try {
            let meta =
              item.enrichedMeta ||
              (await this.fetchMetaForContinueWatching(item.contentType || "movie", item.contentId, options?.metaTimeoutMs || 1800, [
                item.imdbId
              ]));
            const resolvedMeta = Boolean(meta);
            if (!meta) {
              meta = {
                id: item.contentId,
                type: item.contentType || "movie",
                name: item.title || prettyId(item.contentId)
              };
            }
            if (meta) {
              const enrichedMeta = await this.enrichContinueWatchingMetaWithTmdb(meta, item);
              const contentId = resolveContinueWatchingSeriesContentId(item.contentId, enrichedMeta);
              const episodeEntry = findEpisodeEntry(enrichedMeta.videos, item.season, item.episode);
              const runtimeMinutes = parseRuntimeMinutes(
                episodeEntry?.runtimeMinutes ?? enrichedMeta.episodeRuntime ?? enrichedMeta.runtimeMinutes ?? enrichedMeta.runtime ?? 0
              );
              const episodeImdbRating = isSeriesTypeForContinueWatching(item.contentType || item.type)
                ? await resolveContinueWatchingEpisodeRating(item, episodeEntry?.imdbRating ?? item.episodeImdbRating, enrichedMeta.videos)
                : null;
              const enriched = {
                ...item,
                contentId,
                title: enrichedMeta.name || prettyId(item.contentId),
                landscapePoster:
                  enrichedMeta.landscapePoster || enrichedMeta.thumbnail || enrichedMeta.backdrop || enrichedMeta.background || null,
                episodeThumbnail: episodeEntry?.thumbnail || enrichedMeta.episodeThumbnail || item.episodeThumbnail || null,
                poster: enrichedMeta.poster || enrichedMeta.thumbnail || enrichedMeta.background || enrichedMeta.backdrop || null,
                background: enrichedMeta.background || enrichedMeta.backdrop || enrichedMeta.thumbnail || enrichedMeta.poster || null,
                backdrop: enrichedMeta.backdrop || enrichedMeta.background || null,
                thumbnail: enrichedMeta.thumbnail || enrichedMeta.poster || null,
                logo: enrichedMeta.logo || null,
                description: enrichedMeta.description || "",
                releaseInfo: enrichedMeta.releaseInfo || "",
                imdbRating: resolveImdbRating(enrichedMeta),
                episodeImdbRating,
                genres: Array.isArray(enrichedMeta.genres) ? enrichedMeta.genres : [],
                runtimeMinutes,
                durationMs:
                  Number(item.durationMs || 0) > 0
                    ? Number(item.durationMs || 0)
                    : runtimeMinutes > 0
                      ? Math.round(runtimeMinutes * 60000)
                      : 0,
                ageRating: firstNonEmpty(enrichedMeta.ageRating, enrichedMeta.age_rating),
                status: firstNonEmpty(enrichedMeta.status),
                language: firstNonEmpty(enrichedMeta.language),
                country: firstNonEmpty(enrichedMeta.country),
                episodeTitle: firstNonEmpty(enrichedMeta.episodeTitle, episodeEntry?.title, item.episodeTitle, item.subtitle),
                episodeDescription: firstNonEmpty(
                  enrichedMeta.episodeDescription,
                  episodeEntry?.overview,
                  item.episodeDescription,
                  item.episode_description
                ),
                continueWatchingMetaResolved: true,
                serverSeriesIdentityChecked:
                  resolvedMeta && isServerContentId(item.contentId) ? true : cachedItem.serverSeriesIdentityChecked === true
              };
              saveContinueWatchingEnrichment(enriched);
              return enriched;
            }
          } catch (error) {
            console.warn("Continue watching enrichment failed", error);
          }
          return {
            ...cachedItem,
            title: firstNonEmpty(cachedItem.title, cachedItem.name),
            landscapePoster: cachedItem.landscapePoster || cachedItem.thumbnail || cachedItem.backdrop || cachedItem.background || null,
            episodeThumbnail: cachedItem.episodeThumbnail || null,
            poster: cachedItem.poster || cachedItem.thumbnail || null,
            background: cachedItem.background || cachedItem.backdrop || cachedItem.poster || null,
            backdrop: cachedItem.backdrop || cachedItem.background || null,
            thumbnail: cachedItem.thumbnail || cachedItem.poster || null,
            logo: cachedItem.logo || null,
            description: cachedItem.description || "",
            releaseInfo: cachedItem.releaseInfo || "",
            genres: Array.isArray(cachedItem.genres) ? cachedItem.genres : [],
            runtimeMinutes: Number(cachedItem.runtimeMinutes ?? cachedItem.runtime ?? 0) || 0,
            ageRating: firstNonEmpty(cachedItem.ageRating, cachedItem.age_rating),
            status: firstNonEmpty(cachedItem.status),
            language: firstNonEmpty(cachedItem.language),
            country: firstNonEmpty(cachedItem.country),
            episodeTitle: firstNonEmpty(cachedItem.episodeTitle, cachedItem.subtitle)
          };
        }),
        this.buildNextUpItems({
          allProgress: options?.allProgress || [],
          inProgressItems: items || [],
          nextUpProgressCandidates: options?.nextUpProgressCandidates || [],
          watchedItems: options?.watchedItems || []
        })
      ]);

      const inProgressItems = dedupeContinueWatchingInProgress(enrichedInProgressItems);
      const inProgressSeriesIds = new Set(
        inProgressItems
          .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
          .map((item) => String(item?.contentId || "").trim())
          .filter(Boolean)
      );

      const combinedItems = [
        ...inProgressItems,
        ...nextUpItems.filter((item) => !inProgressSeriesIds.has(String(item?.contentId || "").trim()))
      ];

      return sortContinueWatchingItemsForDisplay(combinedItems, this.layoutPrefs?.continueWatchingSortMode).slice(0, CW_MAX_VISIBLE_ITEMS);
    },
    pickHeroItem(rows) {
      for (const row of rows) {
        const first = row.result?.data?.items?.[0];
        if (first) {
          return normalizeHomeRowItem(row, first);
        }
      }
      return null;
    },
    collectHeroCandidates(rows) {
      const flat = [];
      const selectedKeys = new Set(this.layoutPrefs?.heroCatalogKeys || []);
      const eligibleRows = selectedKeys.size ? (rows || []).filter((row) => selectedKeys.has(String(row?.homeCatalogKey || ""))) : rows;
      eligibleRows.forEach((row) => {
        (row?.result?.data?.items || []).slice(0, 4).forEach((item) => {
          const normalized = normalizeHomeRowItem(row, item);
          if (!normalized?.id || flat.some((entry) => entry.id === normalized.id)) {
            return;
          }
          flat.push(normalized);
        });
      });
      return flat.slice(0, 10);
    },
    async enrichHero(baseHero = null) {
      const nextBaseHero = baseHero || this.pickHeroItem(this.rows);
      const hero = isCollectionFolderItem(nextBaseHero)
        ? normalizeCollectionFolderItem(nextBaseHero)
        : normalizeCatalogItem(nextBaseHero, "movie");
      if (!hero) {
        this.heroItem = null;
        return;
      }

      if (isCollectionFolderItem(hero)) {
        this.heroItem = hero;
        return;
      }

      const settings = TmdbSettingsStore.get();
      const tmdbEnabledForCurrentLayout = settings.enabled && (this.layoutMode !== "modern" || settings.modernHomeEnabled);
      if (!tmdbEnabledForCurrentLayout || !TMDB_API_KEY) {
        this.heroItem = hero;
        return;
      }

      try {
        const tmdbId = await withTimeout(TmdbService.ensureTmdbId(hero.id, hero.type), 2200, null);
        if (!tmdbId) {
          this.heroItem = hero;
          return;
        }

        const enriched = await withTimeout(
          TmdbMetadataService.fetchEnrichment({
            tmdbId,
            contentType: hero.type,
            language: settings.language
          }),
          2400,
          null
        );

        if (!enriched) {
          this.heroItem = hero;
          return;
        }

        this.heroItem = normalizeCatalogItem(
          {
            ...hero,
            name: settings.useBasicInfo ? enriched.localizedTitle || hero.name : hero.name,
            description: settings.useBasicInfo ? enriched.description || hero.description : hero.description,
            background: settings.useArtwork ? enriched.backdrop || hero.background : hero.background,
            poster: settings.useArtwork ? enriched.poster || hero.poster : hero.poster,
            logo: settings.useArtwork ? enriched.logo : hero.logo,
            genres: settings.useBasicInfo ? enriched.genres || hero.genres : hero.genres
          },
          hero.type || "movie"
        );
      } catch (error) {
        console.warn("Hero TMDB enrichment failed", error);
        this.heroItem = hero;
      }
    },
    openDetailFromNode(node) {
      if (this.resolveCollectionFolderTargetFromNode(node)) {
        this.openCollectionFolderFromNode(node);
        return;
      }
      const itemId = node.dataset.itemId;
      if (!itemId) {
        return;
      }
      this.rememberReturnFocusForNode(node);
      const itemType = node.dataset.itemType || node.dataset.catalogType || "movie";
      const trailerHandoff = this.getTrailerHandoffForNode(node, { itemId, itemType });
      Router.navigate("detail", {
        itemId,
        itemType,
        fallbackTitle: node.dataset.itemTitle || "Untitled",
        fallbackPoster: node.dataset.posterSrc || "",
        fallbackBackground: node.dataset.backdropSrc || "",
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogType: node.dataset.catalogType || node.dataset.itemType || "movie",
        ...(trailerHandoff ? { trailerHandoff } : {})
      });
    },
    openCollectionFolderFromNode(node) {
      const target = this.resolveCollectionFolderTargetFromNode(node);
      const collectionId = String(target?.collectionId || "").trim();
      const folderId = String(target?.folderId || "").trim();
      if (!collectionId || !folderId) {
        return;
      }
      this.rememberReturnFocusForNode(node);
      Router.navigate("folderDetail", {
        collectionId,
        folderId,
        collectionTitle: node?.dataset?.collectionTitle || ""
      });
    },
    openCatalogSeeAllFromNode(node) {
      if (!node) {
        return;
      }
      this.rememberReturnFocusForNode(node);
      const seeAllId = String(node.dataset.seeAllId || "");
      const mapped = this.catalogSeeAllMap?.get?.(seeAllId) || null;
      if (mapped) {
        Router.navigate("catalogSeeAll", mapped);
        return;
      }
      Router.navigate("catalogSeeAll", {
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogId: node.dataset.catalogId || "",
        catalogName: node.dataset.catalogName || "",
        type: node.dataset.catalogType || "movie",
        initialItems: [],
        initialHasMore: Object.prototype.hasOwnProperty.call(node.dataset, "catalogHasMore")
          ? node.dataset.catalogHasMore === "true"
          : undefined,
        supportsSkip: node.dataset.catalogSupportsSkip !== "false",
        skipStep: Number(node.dataset.catalogSkipStep || 100)
      });
    }
  };
}
