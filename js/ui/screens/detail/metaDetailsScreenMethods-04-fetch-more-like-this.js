import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { selectShuffleEpisode } from "../../../core/player/episodeShuffleSelection.js";
/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods04() {
  const {
    watchedItemsShareIdentity,
    TmdbService,
    TmdbMetadataService,
    TmdbSettingsStore,
    MoreLikeThisSourcePreference,
    TraktSettingsStore,
    traktRequestJson,
    TraktAuthService,
    TRAKT_API_URL,
    TRAKT_CLIENT_ID,
    TRAKT_COMMENTS_LIMIT,
    t,
    isDetailProgressCompleted,
    isSeriesDetailMeta,
    buildDetailContentReference,
    resolveMetaImdbId,
    normalizePreviewItem,
    traktRelatedPreview,
    stripTraktSpoilerMarkup,
    containsTraktInlineSpoiler
  } = internals;

  return {
    async fetchMoreLikeThis(meta) {
      try {
        const trackingSettings = TraktSettingsStore.get();
        if (TraktAuthService.isAuthenticated() && trackingSettings.moreLikeThisSource !== MoreLikeThisSourcePreference.TMDB) {
          this.moreLikeThisSource = "trakt";
          return await this.fetchTraktRelated(meta);
        }
        const settings = TmdbSettingsStore.get();
        if (!settings.enabled || !settings.useMoreLikeThis) {
          this.moreLikeThisSource = null;
          return [];
        }
        this.moreLikeThisSource = "tmdb";
        // Android resolves the route type first, then the meta type, and treats
        // both `tv` and `series` as TMDB TV content even when episodes are absent.
        const routeType = String(this.params?.itemType || "").toLowerCase();
        const metaType = String(meta?.type || "").toLowerCase();
        const seriesTypes = ["series", "tv", "show", "tvshow"];
        const movieTypes = ["movie", "film"];
        const resolvedType = [...seriesTypes, ...movieTypes].includes(routeType)
          ? routeType
          : [...seriesTypes, ...movieTypes].includes(metaType)
            ? metaType
            : "movie";
        const type = seriesTypes.includes(resolvedType) ? "series" : "movie";
        const tmdbId =
          (await TmdbService.ensureTmdbId(meta?.id, type)) ||
          (await TmdbService.ensureTmdbId(this.params?.itemId, type)) ||
          (await this.searchTmdbIdByTitle(meta, type));
        if (!tmdbId) {
          return [];
        }
        const recommendations = await TmdbMetadataService.fetchRecommendations({
          tmdbId,
          contentType: type,
          language: settings.language
        });
        return (Array.isArray(recommendations) ? recommendations : [])
          .map((item) => normalizePreviewItem(item, type))
          .filter((item) => item.id && item.id !== String(meta?.id || ""))
          .slice(0, 12);
      } catch (error) {
        console.warn("More like this load failed", error);
        this.moreLikeThisSource = null;
        return [];
      }
    },
    async fetchTraktRelated(meta) {
      const routeType = String(this.params?.itemType || meta?.type || meta?.apiType || "")
        .trim()
        .toLowerCase();
      const type = ["series", "tv", "show", "tvshow"].includes(routeType) ? "series" : "movie";
      const apiType = type === "series" ? "show" : "movie";
      const token = await TraktAuthService.getValidAccessToken();
      if (!token) return [];

      const rawIds = [meta?.id, this.params?.itemId].map((value) => String(value || "").trim());
      const directImdb = resolveMetaImdbId(meta, this.params);
      const directTrakt = rawIds.map((value) => value.match(/^trakt:(.+)$/i)?.[1] || null).find(Boolean);
      let pathId = directImdb || directTrakt || String(meta?.slug || "").trim();
      if (!pathId) {
        const tmdbId = meta?.tmdbId || rawIds.map((value) => value.match(/^tmdb:(\d+)$/i)?.[1] || null).find(Boolean);
        if (tmdbId) {
          const search = await traktRequestJson(`/search/tmdb/${encodeURIComponent(String(tmdbId))}?type=${apiType}`, {
            authorization: `Bearer ${token}`
          });
          if (search.response.ok) {
            const result = (Array.isArray(search.payload) ? search.payload : []).find(
              (entry) => String(entry?.type || "").toLowerCase() === apiType
            );
            const ids = (type === "series" ? result?.show : result?.movie)?.ids || {};
            pathId = ids.imdb || ids.trakt || ids.slug || "";
          }
        }
      }
      if (!pathId) return [];

      const target = type === "series" ? "shows" : "movies";
      const result = await traktRequestJson(
        `/${target}/${encodeURIComponent(String(pathId))}/related?extended=full%2Cimages&page=1&limit=20`,
        { authorization: `Bearer ${token}` }
      );
      if (result.response.status === 404) return [];
      if (!result.response.ok) {
        throw new Error(`Trakt related titles failed (${result.response.status})`);
      }
      return (Array.isArray(result.payload) ? result.payload : [])
        .map((item) => traktRelatedPreview(item, type))
        .filter((item) => item?.id && item.id !== String(meta?.id || ""))
        .slice(0, 20);
    },
    getAvailableSeasons(episodes = this.episodes) {
      const seasons = Array.from(
        new Set(
          (Array.isArray(episodes) ? episodes : [])
            .map((episode) => Number(episode?.season || 0))
            .filter((season) => Number.isFinite(season) && season >= 0)
        )
      );
      const regular = seasons.filter((season) => season > 0).sort((left, right) => left - right);
      const specials = seasons.filter((season) => season === 0);
      return [...regular, ...specials];
    },
    supportsTraktComments(meta = this.meta) {
      const type = String(meta?.type || meta?.apiType || this.params?.itemType || "")
        .trim()
        .toLowerCase();
      return ["movie", "series", "tv", "show"].includes(type) || isSeriesDetailMeta(meta, this.episodes);
    },
    resolveTraktCommentsTarget(meta = this.meta) {
      if (!this.supportsTraktComments(meta)) return null;
      const isEpisode = this.commentsMode === "episode" && this.commentsEpisodeTarget;
      const directId =
        resolveMetaImdbId(meta, this.params) ||
        String(meta?.slug || "").trim() ||
        String(meta?.id || this.params?.itemId || "")
          .split(":")
          .find((part) => /^tt\d+$/i.test(part)) ||
        String(this.params?.itemId || meta?.id || "").trim();
      if (!directId) return null;
      const isSeries = isSeriesDetailMeta(meta, this.episodes);
      if (isEpisode && isSeries) {
        const season = Number(this.commentsEpisodeTarget?.season || 0);
        const episode = Number(this.commentsEpisodeTarget?.episode || 0);
        if (season > 0 && episode > 0) {
          return {
            path: `/shows/${encodeURIComponent(directId)}/seasons/${season}/episodes/${episode}/comments/likes`
          };
        }
      }
      return {
        path: `/${isSeries ? "shows" : "movies"}/${encodeURIComponent(directId)}/comments/likes`
      };
    },
    async fetchTraktCommentsPage(page = 1, { target = this.resolveTraktCommentsTarget(this.meta), signal = null } = {}) {
      if (!target || !TRAKT_CLIENT_ID) {
        return { items: [], page: 0, pageCount: 0 };
      }
      const token = await TraktAuthService.getValidAccessToken().catch(() => null);
      if (!token || signal?.aborted) {
        return { items: [], page: 0, pageCount: 0 };
      }
      const url = new URL(`${String(TRAKT_API_URL || "https://api.trakt.tv").replace(/\/+$/, "")}${target.path}`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(TRAKT_COMMENTS_LIMIT));
      const response = await fetch(url.toString(), {
        ...(signal ? { signal } : {}),
        headers: {
          "Content-Type": "application/json",
          "trakt-api-version": "2",
          "trakt-api-key": TRAKT_CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      });
      if (response.status === 404) {
        return { items: [], page, pageCount: 0 };
      }
      if (!response.ok) {
        throw new Error(`Trakt comments failed (${response.status})`);
      }
      const payload = await response.json();
      const items = (Array.isArray(payload) ? payload : [])
        .filter((entry) => String(entry?.comment || "").trim())
        .map((entry) => ({
          id: Number(entry.id || 0),
          authorDisplayName: entry.user?.name || entry.user?.username || "Trakt user",
          authorUsername: entry.user?.username || "",
          comment: stripTraktSpoilerMarkup(entry.comment),
          spoiler: Boolean(entry.spoiler),
          containsInlineSpoilers: containsTraktInlineSpoiler(entry.comment),
          review: Boolean(entry.review),
          likes: Number(entry.likes || 0),
          rating: entry.user_stats?.rating ?? entry.userStats?.rating ?? null,
          createdAt: entry.created_at || entry.createdAt || "",
          updatedAt: entry.updated_at || entry.updatedAt || ""
        }));
      return {
        items,
        page,
        pageCount: Number(response.headers.get("X-Pagination-Page-Count") || page || 0)
      };
    },
    cancelTraktCommentsRequest() {
      this.commentsRequestToken = (this.commentsRequestToken || 0) + 1;
      this.commentsRequestController?.abort();
      this.commentsRequestController = null;
    },
    async loadTraktComments({ force: _force = false, append = false } = {}) {
      if (!TraktSettingsStore.get().showMetaComments || !TraktAuthService.isAuthenticated() || !this.supportsTraktComments(this.meta)) {
        this.cancelTraktCommentsRequest();
        this.commentsItems = [];
        this.commentsPage = 0;
        this.commentsPageCount = 0;
        this.commentsError = "";
        this.commentsLoading = false;
        this.commentsLoadingMore = false;
        return;
      }
      const page = append ? Number(this.commentsPage || 0) + 1 : 1;
      if (append && this.commentsPageCount > 0 && page > this.commentsPageCount) return;
      this.cancelTraktCommentsRequest();
      const requestToken = this.commentsRequestToken;
      const detailToken = this.detailLoadToken;
      const target = this.resolveTraktCommentsTarget(this.meta);
      const mode = this.commentsMode;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      this.commentsRequestController = controller;
      const isCurrent = () =>
        requestToken === this.commentsRequestToken &&
        detailToken === this.detailLoadToken &&
        mode === this.commentsMode &&
        target?.path === this.resolveTraktCommentsTarget(this.meta)?.path;
      this.commentsLoading = false;
      this.commentsLoadingMore = false;
      if (append) this.commentsLoadingMore = true;
      else this.commentsLoading = true;
      this.commentsError = "";
      this.updateRenderedDetailSections(this.meta);
      try {
        const result = await this.fetchTraktCommentsPage(page, { target, signal: controller?.signal || null });
        if (!isCurrent()) return;
        const existingIds = new Set((append ? this.commentsItems : []).map((item) => Number(item.id || 0)));
        const nextItems = result.items.filter((item) => !existingIds.has(Number(item.id || 0)));
        this.commentsItems = append ? [...this.commentsItems, ...nextItems] : nextItems;
        this.commentsPage = result.page;
        this.commentsPageCount = result.pageCount;
        this.commentsError = "";
      } catch (error) {
        if (!isCurrent()) return;
        console.warn("Trakt comments load failed", error);
        this.commentsError = t("detail_comments_error", {}, "Could not load Trakt comments.");
      } finally {
        if (isCurrent()) {
          this.commentsRequestController = null;
          this.commentsLoading = false;
          this.commentsLoadingMore = false;
          this.updateRenderedDetailSections(this.meta);
        }
      }
    },
    hasAvailableSeason(season, episodes = this.episodes) {
      const wanted = Number(season || 0);
      return wanted >= 0 && this.getAvailableSeasons(episodes).includes(wanted);
    },
    findEpisodeFromProgress(progress = {}) {
      if (!this.episodes?.length || !progress) {
        return null;
      }
      const videoId = String(progress?.videoId || "").trim();
      if (videoId) {
        const directMatch = this.episodes.find((episode) => String(episode?.id || "") === videoId);
        if (directMatch) {
          return directMatch;
        }
      }
      const season = Number(progress?.season);
      const episode = Number(progress?.episode || 0);
      if (Number.isFinite(season) && season >= 0 && episode > 0) {
        return this.episodes.find((entry) => Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode) || null;
      }
      return null;
    },
    getNextEpisodeAfter(episode = null) {
      const contentId = this.params?.itemId || this.meta?.id;
      const contentType = this.params?.itemType || this.meta?.type;
      if (EpisodeShuffleStore.get(contentId, contentType).enabled)
        return selectShuffleEpisode({
          contentId,
          contentType,
          videos: this.episodes || [],
          current: episode,
          surface: "playback",
          watched: this.watchedEpisodeKeys || new Set(),
          progress: this.episodeProgressMap || new Map(),
          reference: this.meta || {},
          useLocalState: false
        });
      if (!episode || !this.episodes?.length) {
        return null;
      }
      const sequence = this.getEpisodeSequence(episode);
      const currentIndex = sequence.findIndex(
        (entry) =>
          String(entry?.id || "") === String(episode?.id || "") ||
          (Number(entry?.season || 0) === Number(episode?.season || 0) && Number(entry?.episode || 0) === Number(episode?.episode || 0))
      );
      return currentIndex >= 0 ? sequence[currentIndex + 1] || null : null;
    },
    getEpisodeSequence(anchorEpisode = null) {
      const episodes = Array.isArray(this.episodes) ? this.episodes : [];
      const anchorSeason = Number(anchorEpisode?.season);
      const specials = episodes.filter((episode) => Number(episode?.season) === 0);
      const regular = episodes.filter((episode) => Number(episode?.season) > 0);
      if (Number.isFinite(anchorSeason) && anchorSeason === 0) {
        return specials;
      }
      return regular.length ? regular : specials;
    },
    getLatestSeriesProgress(progress = null, progressItems = []) {
      const contentId = String(this.params?.itemId || "").trim();
      const contentReference = buildDetailContentReference(contentId, this.meta, this.params);
      const candidates = [];
      if (progress && (!String(progress?.contentId || "").trim() || watchedItemsShareIdentity(progress, contentReference))) {
        candidates.push(progress);
      }
      (Array.isArray(progressItems) ? progressItems : []).forEach((entry) => {
        if (!watchedItemsShareIdentity(entry, contentReference)) {
          return;
        }
        if ((entry?.season == null || Number(entry.season) < 0) && !String(entry?.videoId || "").trim()) {
          return;
        }
        candidates.push(entry);
      });
      return candidates.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))[0] || null;
    },
    resolvePreferredSeasonFromProgress(progress = null, progressItems = []) {
      const routeSeasonRaw = this.params?.preferredSeason ?? this.params?.resumeSeason ?? this.params?.initialSeason;
      const routeSeason = Number(routeSeasonRaw);
      if (routeSeasonRaw != null && Number.isFinite(routeSeason) && routeSeason >= 0) {
        return routeSeason;
      }

      const latestProgress = this.getLatestSeriesProgress(progress, progressItems);
      const progressEpisode = this.findEpisodeFromProgress(latestProgress);
      if (progressEpisode) {
        if (isDetailProgressCompleted(latestProgress)) {
          return Number(this.getNextEpisodeAfter(progressEpisode)?.season || progressEpisode.season || 0);
        }
        return Number(progressEpisode.season || 0);
      }

      const progressSeason = Number(latestProgress?.season);
      return latestProgress?.season != null && Number.isFinite(progressSeason) && progressSeason >= 0 ? progressSeason : null;
    }
  };
}
