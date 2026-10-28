/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods06() {
  const {
    TmdbService,
    TmdbMetadataService,
    imdbEpisodeRatingsRepository,
    TmdbSettingsStore,
    TMDB_API_KEY,
    TMDB_BASE_URL,
    isSeriesDetailMeta,
    resolveMetaImdbId,
    resolveMetaTmdbId,
    extractCast,
    mergeGenreLists,
    resolveTrailerSource,
    resolveTmdbTrailerSource
  } = internals;

  return {
    async enrichMeta(meta) {
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !TMDB_API_KEY || !meta?.id) {
        return meta;
      }

      try {
        const lookupOptions = { fallbackImdbId: meta.imdbId };
        const tmdbId =
          (await TmdbService.ensureTmdbId(meta.id, meta.type, lookupOptions)) ||
          (await TmdbService.ensureTmdbId(this.params?.itemId, this.params?.itemType, lookupOptions));
        if (!tmdbId) {
          return meta;
        }
        const isSeries = isSeriesDetailMeta(meta, meta?.videos || this.episodes);
        const [enrichment, episodeMap] = await Promise.all([
          TmdbMetadataService.fetchEnrichment({
            tmdbId,
            contentType: meta.type,
            language: settings.language
          }).catch((error) => {
            console.warn("Meta TMDB enrichment failed", error);
            return null;
          }),
          settings.useEpisodes && isSeries
            ? TmdbMetadataService.fetchEpisodeEnrichment({
                tmdbId,
                seasonNumbers: (Array.isArray(meta.videos) ? meta.videos : [])
                  .map((video) => Number(video?.season ?? NaN))
                  .filter((season) => Number.isInteger(season) && season >= 0),
                language: settings.language
              })
            : new Map()
        ]);
        const videos =
          episodeMap.size && Array.isArray(meta.videos)
            ? meta.videos.map((video) => {
                const key =
                  Number(video?.season ?? NaN) >= 0 && Number(video?.episode || 0) > 0
                    ? `${Number(video.season)}:${Number(video.episode)}`
                    : "";
                const episode = key ? episodeMap.get(key) : null;
                if (!episode) {
                  return video;
                }
                return {
                  ...video,
                  title: episode.title || video.title,
                  overview: episode.overview || video.overview,
                  thumbnail: episode.thumbnail || video.thumbnail,
                  runtime: episode.runtime || video.runtime
                };
              })
            : meta.videos;

        if (!enrichment) {
          return { ...meta, videos };
        }

        return {
          ...meta,
          name: settings.useBasicInfo ? enrichment.localizedTitle || meta.name : meta.name,
          description: settings.useBasicInfo ? enrichment.description || meta.description : meta.description,
          background: settings.useArtwork ? enrichment.backdrop || meta.background : meta.background,
          poster: settings.useArtwork ? enrichment.poster || meta.poster : meta.poster,
          // TMDB enrichment deliberately returns no logo when only unrelated
          // languages are available; show the localized text title in that case.
          logo: settings.useArtwork ? enrichment.logo : meta.logo,
          genres: settings.useBasicInfo ? mergeGenreLists(meta.genres, enrichment.genres) : meta.genres,
          // Preserve addon dates, matching Android's TMDB enrichment policy.
          released: meta.released || meta.releaseDate || meta.release_date || null,
          runtime: settings.useDetails ? enrichment.runtime || meta.runtime : meta.runtime,
          country: settings.useDetails ? enrichment.country || meta.country : meta.country,
          language: settings.useDetails ? enrichment.language || meta.language : meta.language,
          originalLanguage: enrichment.originalLanguage || meta.originalLanguage || meta.original_language || null,
          imdbId: enrichment.imdbId || meta.imdbId || meta.imdb_id || null,
          tmdbRating:
            settings.useBasicInfo && typeof enrichment.rating === "number" ? Number(enrichment.rating.toFixed(1)) : meta.tmdbRating || null,
          credits: settings.useCredits ? enrichment.credits || meta.credits || null : meta.credits || null,
          companies:
            settings.useProductions && Array.isArray(enrichment.companies) && enrichment.companies.length
              ? enrichment.companies
              : meta.companies || [],
          productionCompanies:
            settings.useProductions && Array.isArray(enrichment.productionCompanies) && enrichment.productionCompanies.length
              ? enrichment.productionCompanies
              : Array.isArray(meta.productionCompanies)
                ? meta.productionCompanies
                : [],
          networks:
            settings.useNetworks && Array.isArray(enrichment.networks) && enrichment.networks.length
              ? enrichment.networks
              : Array.isArray(meta.networks)
                ? meta.networks
                : [],
          trailers:
            Array.isArray(meta.trailers) && meta.trailers.length
              ? meta.trailers
              : settings.useTrailers && Array.isArray(enrichment.trailers)
                ? enrichment.trailers
                : [],
          trailerYtIds:
            Array.isArray(meta.trailerYtIds) && meta.trailerYtIds.length
              ? meta.trailerYtIds
              : settings.useTrailers && Array.isArray(enrichment.trailerYtIds)
                ? enrichment.trailerYtIds
                : [],
          collectionId:
            (settings.useCollections ? enrichment.collectionId : null) ||
            meta.collectionId ||
            meta?.belongsToCollection?.id ||
            meta?.belongs_to_collection?.id ||
            null,
          collectionName:
            (settings.useCollections ? enrichment.collectionName : null) ||
            meta.collectionName ||
            meta?.belongsToCollection?.name ||
            meta?.belongs_to_collection?.name ||
            "",
          belongsToCollection:
            settings.useCollections && enrichment.collectionId
              ? { id: enrichment.collectionId, name: enrichment.collectionName || "" }
              : meta.belongsToCollection || meta.belongs_to_collection || null,
          videos
        };
      } catch (error) {
        console.warn("Meta TMDB enrichment failed", error);
        return meta;
      }
    },
    async searchTmdbIdByTitle(meta = {}, contentType = "movie") {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !apiKey) {
        return null;
      }
      const name = String(meta?.name || "").trim();
      if (!name) {
        return null;
      }
      const type = contentType === "series" || contentType === "tv" ? "tv" : "movie";
      const releaseYear = String(meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
      const yearParam = releaseYear
        ? type === "tv"
          ? `&first_air_date_year=${encodeURIComponent(releaseYear)}`
          : `&year=${encodeURIComponent(releaseYear)}`
        : "";
      const url = `${TMDB_BASE_URL}/search/${type}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.language || "en")}&query=${encodeURIComponent(name)}${yearParam}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      return first?.id ? String(first.id) : null;
    },
    async fetchTmdbCastFallback(meta = {}) {
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.useCredits) {
        return [];
      }
      const contentType = String(meta?.type || this.params?.itemType || "movie").toLowerCase();
      const normalizedType = contentType === "tv" ? "series" : contentType;
      let tmdbId = await TmdbService.ensureTmdbId(meta?.id, normalizedType);
      if (!tmdbId) {
        tmdbId = await this.searchTmdbIdByTitle(meta, normalizedType);
      }
      if (!tmdbId) {
        return [];
      }
      const enrichment = await TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: normalizedType,
        language: settings.language
      });
      const fallbackCast = extractCast({ credits: enrichment?.credits || null });
      return Array.isArray(fallbackCast) ? fallbackCast : [];
    },
    async fetchSeriesRatingsBySeason(meta, episodes = this.episodes) {
      try {
        if (!meta?.id || !episodes?.length) {
          return {};
        }
        const imdbId = resolveMetaImdbId(meta, this.params);
        const knownTmdbId = resolveMetaTmdbId(meta, this.params);
        const tmdbId =
          knownTmdbId ||
          (await TmdbService.ensureTmdbId(meta.id, "series", {
            // Episode IMDb ratings are independent from optional TMDB metadata
            // enrichment, matching Android TV's detail-screen behavior.
            requireEnabled: false
          }));
        if (!imdbId && !tmdbId) {
          return {};
        }
        return await imdbEpisodeRatingsRepository.getEpisodeRatings({ imdbId, tmdbId });
      } catch (error) {
        console.warn("Series ratings enrichment failed", error);
        return {};
      }
    },
    async resolvePreferredTrailerSource(meta = this.meta) {
      if (!meta) {
        return null;
      }
      const settings = TmdbSettingsStore.get();
      const fallbackSource = resolveTrailerSource(meta);
      if (!settings.enabled || !settings.useTrailers || !TMDB_API_KEY) {
        return fallbackSource;
      }
      const itemType = String(meta?.type || this.params?.itemType || "movie");
      const resolutionKey = [meta?.id, itemType, settings.language, settings.enabled, settings.useTrailers].join("|");
      if (this.trailerSourceResolutionKey === resolutionKey) {
        if (this.trailerSourceResolutionPromise) {
          return this.trailerSourceResolutionPromise;
        }
        if (this.trailerSourceResolutionResult) {
          return this.trailerSourceResolutionResult;
        }
      }
      const resolutionPromise = resolveTmdbTrailerSource(meta, itemType);
      this.trailerSourceResolutionKey = resolutionKey;
      this.trailerSourceResolutionPromise = resolutionPromise;
      try {
        const source = await resolutionPromise;
        this.trailerSourceResolutionResult = source;
        return source;
      } finally {
        if (this.trailerSourceResolutionKey === resolutionKey) {
          this.trailerSourceResolutionPromise = null;
        }
      }
    },
    async refreshTrailerSource(meta = this.meta, token = this.detailLoadToken) {
      const nextSource = await this.resolvePreferredTrailerSource(meta);
      if (token !== this.detailLoadToken) {
        return;
      }
      const currentKey = JSON.stringify(this.trailerSource || null);
      const nextKey = JSON.stringify(nextSource || null);
      if (currentKey === nextKey) {
        return;
      }
      this.trailerSource = nextSource;
      if (!this.isTrailerPlaying) {
        this.updateRenderedDetailSections(this.meta || meta);
      }
    },
    flattenStreams(streamResult) {
      if (!streamResult || streamResult.status !== "success") {
        return [];
      }

      const flattened = [];
      (streamResult.data || []).forEach((group) => {
        const groupName = group.addonName || "Addon";
        (group.streams || []).forEach((stream, index) => {
          const streamOrigin = {
            ...(group.streamOrigin || {}),
            ...(stream.streamOrigin || {}),
            addonId: stream.addonId || group.addonId || group.streamOrigin?.addonId || stream.streamOrigin?.addonId || null,
            addonBaseUrl:
              stream.addonBaseUrl || group.addonBaseUrl || group.streamOrigin?.addonBaseUrl || stream.streamOrigin?.addonBaseUrl || null,
            addonName: stream.addonName || group.addonName || group.streamOrigin?.addonName || stream.streamOrigin?.addonName || groupName,
            sourceProviderId:
              stream.sourceProviderId ||
              group.sourceProviderId ||
              stream.streamOrigin?.sourceProviderId ||
              group.streamOrigin?.sourceProviderId ||
              null
          };
          const entry = {
            id: `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
            label: stream.title || stream.name || `${groupName} stream`,
            description: stream.description || stream.name || "",
            addonId: stream.addonId || group.addonId || null,
            addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
            addonName: groupName,
            addonLogo: group.addonLogo || stream.addonLogo || null,
            addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
              ? Number(stream.addonOrderIndex)
              : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
            sourceProviderId: stream.sourceProviderId || group.sourceProviderId || null,
            streamOrigin,
            sourceType: stream.type || stream.source || "",
            url: stream.url || stream.externalUrl || "",
            ytId: stream.ytId || null,
            infoHash: stream.infoHash || null,
            fileIdx: stream.fileIdx ?? null,
            externalUrl: stream.externalUrl || null,
            behaviorHints: stream.behaviorHints || null,
            subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
            raw: stream
          };
          if (entry.url) {
            flattened.push(entry);
          }
        });
      });
      return flattened;
    }
  };
}
