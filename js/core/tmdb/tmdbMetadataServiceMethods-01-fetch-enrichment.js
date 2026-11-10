/* eslint-disable no-unused-vars */
import * as internals from "./tmdbMetadataService.js";
import { fetchTmdbJson } from "./tmdbService.js";

export function createTmdbMetadataServiceMethods01() {
  const {
    normalizeTmdbLanguageCode,
    TmdbSettingsStore,
    TMDB_API_KEY,
    tmdbShowReleaseInfo,
    TMDB_BASE_URL,
    TMDB_METADATA_MAX_RESPONSE_BYTES,
    TMDB_TRAILER_FALLBACK_LANGUAGE,
    ENTITY_RAIL_MAX_ITEMS,
    TOP_RATED_VOTE_COUNT_FLOOR,
    ENTITY_RAIL_TYPES,
    entityHeaderCache,
    entityRailCache,
    entityBrowseCache,
    resolveType,
    languageBase,
    normalizeMoreLikeThisLanguage,
    containsCjkOrHangul,
    resolveDisplayLabel,
    fetchEnglishPersonNames,
    fetchEnglishTitle,
    resolveCredits,
    resolveTmdbCredits,
    toImageUrl,
    buildTmdbImageLanguageFilter,
    selectBestLocalizedLogoPath,
    resolveTrailerCandidates,
    mapTrailerCandidates,
    mapCompanies,
    selectAgeRating,
    normalizeEntityKind,
    normalizeEntityId,
    normalizeEntitySourceType,
    buildEntityMediaOrder,
    entitySortBy,
    mapEntityDiscoverResult,
    fallbackEntityHeader
  } = internals;

  return {
    // includeCredits: false is for callers that never show people (the Home
    // hero). A series' aggregate credits are hundreds of entries to localise:
    // about 90 ms per newly focused card on a 2019 Tizen set.
    async fetchEnrichment({ tmdbId, contentType, language = null, includeCredits = true } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !apiKey || !tmdbId) {
        return null;
      }

      const type = resolveType(contentType);
      const lang = normalizeMoreLikeThisLanguage(language || settings.language);
      const imageLanguages = buildTmdbImageLanguageFilter(lang);
      const creditType = type === "tv" ? "aggregate_credits" : "credits";
      const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,${includeCredits ? `${creditType},` : ""}release_dates,content_ratings,videos,external_ids&include_image_language=${encodeURIComponent(imageLanguages)}`;
      const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;

      const data = await fetchTmdbJson(url, { maxResponseBytes: TMDB_METADATA_MAX_RESPONSE_BYTES });
      if (!data) {
        return null;
      }

      let resolvedCredits = null;
      if (includeCredits) {
        data.credits = resolveTmdbCredits(data, type);
        const englishPersonNames = await fetchEnglishPersonNames({
          type,
          tmdbId,
          apiKey,
          data,
          language: lang
        });
        resolvedCredits = resolveCredits(data?.credits, englishPersonNames, lang);
      }
      const logoPath = selectBestLocalizedLogoPath(data?.images?.logos, lang);
      const releaseInfoValue =
        type === "tv"
          ? tmdbShowReleaseInfo(data.first_air_date, data.last_air_date, data.status)
          : String(data.release_date || "").slice(0, 4);
      const companies = mapCompanies(data?.production_companies);
      const networks = mapCompanies(data?.networks);
      const spokenLanguage = Array.isArray(data?.spoken_languages) ? data.spoken_languages[0] : null;
      const productionCountryValue = Array.isArray(data?.production_countries)
        ? data.production_countries
            .map((item) => item?.iso_3166_1 || "")
            .filter(Boolean)
            .join(", ")
        : "";
      const originCountryValue = Array.isArray(data?.origin_country) && data.origin_country.length ? data.origin_country.join(", ") : "";
      const countryValue = productionCountryValue || originCountryValue;
      const rawLocalizedTitle = String(data?.title || data?.name || "").trim();
      const originalTitle = String(data?.original_title || data?.original_name || "").trim();
      const originalLanguage = String(data?.original_language || "")
        .trim()
        .toLowerCase();
      const droppedUntranslatedTitle =
        rawLocalizedTitle &&
        originalTitle &&
        rawLocalizedTitle === originalTitle &&
        !lang.startsWith("en") &&
        originalLanguage &&
        !lang.startsWith(originalLanguage);
      let localizedTitle = droppedUntranslatedTitle ? "" : rawLocalizedTitle;
      const isCjkLanguage = ["ja", "ko", "zh"].includes(languageBase(lang));
      if (lang !== "en" && !isCjkLanguage && containsCjkOrHangul(localizedTitle || originalTitle)) {
        const englishTitle = await fetchEnglishTitle({ type, tmdbId, apiKey });
        localizedTitle =
          resolveDisplayLabel({
            localized: rawLocalizedTitle,
            original: originalTitle,
            fallbackEnglish: englishTitle,
            preferredLanguage: lang
          }) || "";
      }
      const runtimeValue =
        type === "tv" ? Number((Array.isArray(data?.episode_run_time) ? data.episode_run_time[0] : 0) || 0) : Number(data?.runtime || 0);
      const trailerCandidates = await resolveTrailerCandidates({
        type,
        tmdbId,
        apiKey,
        language: lang,
        initialResults: Array.isArray(data?.videos?.results) ? data.videos.results : []
      });
      const trailers = mapTrailerCandidates(trailerCandidates);

      return {
        localizedTitle: localizedTitle || null,
        description: data.overview || null,
        backdrop: toImageUrl(data.backdrop_path, "backdrop"),
        poster: toImageUrl(data.poster_path, "poster"),
        logo: toImageUrl(logoPath, "titleLogo"),
        genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).filter(Boolean) : [],
        rating: typeof data.vote_average === "number" ? data.vote_average : null,
        releaseInfo: releaseInfoValue || null,
        released: type === "tv" ? data.first_air_date || null : data.release_date || null,
        runtime: Number.isFinite(runtimeValue) && runtimeValue > 0 ? `${runtimeValue} min` : null,
        status: data?.status || null,
        ageRating: selectAgeRating(data, type),
        country: countryValue || null,
        language: spokenLanguage?.iso_639_1 || spokenLanguage?.english_name || null,
        originalLanguage: data?.original_language || null,
        imdbId: data?.external_ids?.imdb_id || null,
        credits: resolvedCredits,
        companies,
        productionCompanies: companies,
        networks,
        trailers,
        trailerYtIds: trailers.map((entry) => entry.ytId).filter(Boolean),
        collectionId: data?.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null,
        collectionName: data?.belongs_to_collection?.name || null
      };
    },
    async fetchTrailerCandidates({ tmdbId, contentType, language = null } = {}) {
      const apiKey = String(TMDB_API_KEY || "").trim();
      const numericId = String(tmdbId || "").trim();
      if (!apiKey || !/^\d+$/.test(numericId)) {
        return [];
      }
      const type = resolveType(contentType);
      const settings = TmdbSettingsStore.get();
      const lang = normalizeMoreLikeThisLanguage(language || settings.language || TMDB_TRAILER_FALLBACK_LANGUAGE);
      try {
        const candidates = await resolveTrailerCandidates({
          type,
          tmdbId: numericId,
          apiKey,
          language: lang
        });
        return mapTrailerCandidates(candidates);
      } catch (error) {
        console.warn("TMDB post-play trailer lookup failed", error);
        return [];
      }
    },
    async fetchEntityBrowse({ entityKind, entityId, sourceType, fallbackName = "", language = null } = {}) {
      const apiKey = String(TMDB_API_KEY || "").trim();
      const normalizedId = normalizeEntityId(entityId);
      if (!apiKey || !normalizedId) {
        return null;
      }

      const kind = normalizeEntityKind(entityKind);
      const source = normalizeEntitySourceType(sourceType);
      const settings = TmdbSettingsStore.get();
      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const cacheKey = `${kind}:${normalizedId}:${source}:${lang}`;
      if (entityBrowseCache.has(cacheKey)) {
        return entityBrowseCache.get(cacheKey);
      }

      const header = await this.fetchEntityHeader({
        entityKind: kind,
        entityId: normalizedId,
        fallbackName,
        apiKey
      });
      const rails = [];
      for (const mediaType of buildEntityMediaOrder(kind, source)) {
        for (const railType of ENTITY_RAIL_TYPES) {
          const pageResult = await this.fetchEntityRailPage({
            entityKind: kind,
            entityId: normalizedId,
            mediaType,
            railType,
            language: lang,
            apiKey,
            page: 1
          });
          if (!pageResult.items.length) {
            continue;
          }
          rails.push({
            key: `${mediaType}:${railType}`,
            mediaType,
            railType,
            items: pageResult.items,
            currentPage: 1,
            hasMore: pageResult.hasMore,
            isLoading: false
          });
        }
      }

      if (!header && !rails.length) {
        return null;
      }

      const data = {
        header: header || fallbackEntityHeader(kind, normalizedId, fallbackName),
        rails
      };
      entityBrowseCache.set(cacheKey, data);
      return data;
    },
    async fetchEntityHeader({ entityKind, entityId, fallbackName = "", apiKey } = {}) {
      const kind = normalizeEntityKind(entityKind);
      const normalizedId = normalizeEntityId(entityId);
      const key = `${kind}:${normalizedId}:header`;
      if (entityHeaderCache.has(key)) {
        return entityHeaderCache.get(key);
      }

      const fallback = String(fallbackName || "").trim();
      try {
        const url = `${TMDB_BASE_URL}/${kind}/${encodeURIComponent(normalizedId)}?api_key=${encodeURIComponent(apiKey || TMDB_API_KEY)}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const originCountry = Array.isArray(data?.origin_country)
            ? data.origin_country.filter(Boolean).join(", ")
            : String(data?.origin_country || "").trim();
          const header = {
            id: Number(data?.id || normalizedId),
            kind,
            name: String(data?.name || fallback || "Unknown").trim() || "Unknown",
            logo: toImageUrl(data?.logo_path || data?.logo || null, "entityLogo"),
            originCountry: originCountry || null,
            secondaryLabel: String(data?.headquarters || "").trim() || null,
            description: kind === "company" ? String(data?.description || "").trim() || null : null
          };
          entityHeaderCache.set(key, header);
          return header;
        }
      } catch (error) {
        console.warn("TMDB entity header load failed", error);
      }

      if (fallback) {
        const fallbackHeader = fallbackEntityHeader(kind, normalizedId, fallback);
        entityHeaderCache.set(key, fallbackHeader);
        return fallbackHeader;
      }
      return null;
    },
    async fetchEntityRailPage({ entityKind, entityId, mediaType, railType, language = null, apiKey, page = 1 } = {}) {
      const kind = normalizeEntityKind(entityKind);
      const normalizedId = normalizeEntityId(entityId);
      const normalizedMediaType = mediaType === "tv" ? "tv" : "movie";
      const normalizedRailType = ENTITY_RAIL_TYPES.includes(railType) ? railType : "popular";
      const normalizedPage = Math.max(1, Number(page) || 1);
      if (!normalizedId || (kind === "network" && normalizedMediaType === "movie")) {
        return { items: [], hasMore: false };
      }

      const settings = TmdbSettingsStore.get();
      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const key = `${kind}:${normalizedId}:${normalizedMediaType}:${normalizedRailType}:${lang}:${normalizedPage}`;
      if (entityRailCache.has(key)) {
        return entityRailCache.get(key);
      }

      const params = new URLSearchParams({
        api_key: String(apiKey || TMDB_API_KEY || ""),
        language: lang,
        page: String(normalizedPage),
        sort_by: entitySortBy(normalizedMediaType, normalizedRailType)
      });
      if (kind === "company") {
        params.set("with_companies", normalizedId);
      } else {
        params.set("with_networks", normalizedId);
        params.set("with_status", "0|3|4");
      }

      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (normalizedMediaType === "tv" && (normalizedRailType === "recent" || kind === "network")) {
        params.set("first_air_date.lte", today);
      } else if (normalizedRailType === "recent") {
        params.set("primary_release_date.lte", today);
      }
      if (normalizedRailType === "top_rated") {
        params.set("vote_count.gte", String(TOP_RATED_VOTE_COUNT_FLOOR));
      }

      const result = { items: [], hasMore: false };
      try {
        const response = await fetch(`${TMDB_BASE_URL}/discover/${normalizedMediaType}?${params}`);
        if (!response.ok) {
          return result;
        }
        const data = await response.json();
        const items = (Array.isArray(data?.results) ? data.results : [])
          .map((item) => mapEntityDiscoverResult(item, normalizedMediaType))
          .filter(Boolean)
          .slice(0, ENTITY_RAIL_MAX_ITEMS);
        result.items = items;
        result.hasMore = normalizedPage < Number(data?.total_pages || normalizedPage) && items.length > 0;
      } catch (error) {
        console.warn("TMDB entity rail load failed", error);
      }
      if (result.items.length) {
        entityRailCache.set(key, result);
      }
      return result;
    },
    async fetchSeasonRatings({ tmdbId, seasonNumber, language = null } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !apiKey || !tmdbId || !Number.isFinite(Number(seasonNumber))) {
        return [];
      }

      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
      return episodes
        .map((episode) => ({
          episode: Number(episode?.episode_number || 0),
          rating: typeof episode?.vote_average === "number" ? Number(episode.vote_average.toFixed(1)) : null
        }))
        .filter((item) => item.episode > 0);
    }
  };
}
