import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";
import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { selectShuffleEpisode } from "../../../core/player/episodeShuffleSelection.js";
import { episodeKey } from "../../../core/player/episodeShuffle.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { resolveContinueWatchingEpisodeRating } from "./continueWatchingEpisodeRating.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods26() {
  const {
    watchProgressRepository,
    ContinueWatchingPreferences,
    TmdbService,
    TmdbMetadataService,
    TmdbSettingsStore,
    LocalStore,
    TMDB_API_KEY,
    shouldKeepNextUpForAiringSetting,
    CW_DISPLAY_SNAPSHOT_KEY,
    CW_MAX_NEXT_UP_CONCURRENCY,
    CW_MAX_NEXT_UP_LOOKUPS,
    CW_NEXT_UP_META_TIMEOUT_MS,
    resolveNextUpCandidates,
    shouldSurfaceNextUpForUntrackedSeries,
    firstNonEmpty,
    prettyId,
    resolveImdbRating,
    withTimeout,
    isSeriesTypeForContinueWatching,
    findEpisodeEntry,
    hasEpisodeAiredForContinueWatching,
    resolveNextUpReleaseState,
    getContinueWatchingNextUpSeedOptions,
    writeContinueWatchingDisplaySnapshot
  } = internals;

  return {
    async buildNextUpItems({ allProgress = [], inProgressItems = [], nextUpProgressCandidates = [], watchedItems = [] } = {}) {
      const shuffleProfileId = ProfileManager.getActiveProfileId();
      const shuffleVisit = this.shuffleVisit;
      const resolvedCandidates =
        Array.isArray(nextUpProgressCandidates) && nextUpProgressCandidates.length
          ? nextUpProgressCandidates
          : this.selectNextUpProgressCandidates(allProgress, inProgressItems, watchedItems, {
              ...getContinueWatchingNextUpSeedOptions(),
              nextUpFromFurthestEpisode: this.layoutPrefs?.nextUpFromFurthestEpisode
            });

      if (!resolvedCandidates.length) {
        return [];
      }

      const dismissedNextUpKeys = new Set(ContinueWatchingPreferences.getDismissedNextUpKeys());
      const activeCandidates = resolvedCandidates.filter((entry) => {
        const contentId = String(entry?.contentId || "").trim();
        return contentId && !dismissedNextUpKeys.has(contentId) && !watchProgressRepository.isHiddenForContinueWatching?.(contentId);
      });
      if (!activeCandidates.length) {
        return [];
      }

      const watchedEpisodeIndex = this.buildWatchedEpisodeIndex(watchedItems);

      const nextUpItems = await resolveNextUpCandidates(
        activeCandidates,
        async (progressEntry) => {
          const contentType = String(progressEntry?.contentType || "series").toLowerCase();
          const contentId = String(progressEntry?.contentId || "").trim();
          if (!contentId || !isSeriesTypeForContinueWatching(contentType)) {
            return null;
          }

          let meta = null;
          try {
            meta = await this.fetchMetaForContinueWatching(contentType, contentId, CW_NEXT_UP_META_TIMEOUT_MS, [progressEntry?.imdbId]);
          } catch (error) {
            console.warn("Next up meta lookup failed", error);
          }

          if (!meta) {
            return null;
          }
          const watchedEpisodeKeys = watchedEpisodeIndex.get(contentId) || new Set();
          if (ProfileManager.getActiveProfileId() !== shuffleProfileId || this.shuffleVisit !== shuffleVisit) return null;
          const shuffleSettings = EpisodeShuffleStore.get(contentId, contentType, shuffleProfileId);
          const resolvedNextEpisode = shuffleSettings.enabled
            ? selectShuffleEpisode({
                contentId,
                contentType,
                videos: meta.videos || [],
                surface: "home",
                watched: new Set(
                  watchedItems
                    .filter((p) => p.season != null && p.episode != null && watchedItemsShareIdentity(p, { ...meta, contentId }))
                    .map(episodeKey)
                ),
                progress: new Map(
                  allProgress.filter((p) => watchedItemsShareIdentity(p, { ...meta, contentId })).map((p) => [episodeKey(p), p])
                ),
                useLocalState: false,
                visit: shuffleVisit || 0,
                reference: meta,
                profileId: shuffleProfileId
              })
            : this.resolveNextUpEpisode(meta, progressEntry, allProgress, watchedEpisodeKeys, {
                showUnairedNextUp: this.layoutPrefs?.showUnairedNextUp
              });
          if (!resolvedNextEpisode || watchProgressRepository.isHiddenForContinueWatching?.(contentId, resolvedNextEpisode.season)) {
            return null;
          }

          // Android resolves the next episode from addon metadata first, then
          // enriches that exact season/episode. This also keeps season rollover
          // release dates on the same TMDB path as mid-season episodes.
          meta = await this.enrichContinueWatchingMetaWithTmdb(meta, {
            contentId,
            contentType,
            season: resolvedNextEpisode.season,
            episode: resolvedNextEpisode.episode
          });
          const nextEpisode =
            findEpisodeEntry(meta?.videos, resolvedNextEpisode.season, resolvedNextEpisode.episode) || resolvedNextEpisode;
          if (!nextEpisode) {
            return null;
          }
          if (
            !shuffleSettings.enabled &&
            !watchProgressRepository.isTrackedAsWatching(contentId) &&
            !shouldSurfaceNextUpForUntrackedSeries({
              seedUpdatedAt: progressEntry?.updatedAt,
              released: nextEpisode.released
            })
          ) {
            return null;
          }
          const hasAired = hasEpisodeAiredForContinueWatching(nextEpisode.released);
          const releaseState = resolveNextUpReleaseState({
            released: nextEpisode.released,
            hasAired,
            seedUpdatedAt: progressEntry?.updatedAt,
            seedSeason: progressEntry?.season,
            season: nextEpisode.season
          });

          return {
            contentId,
            contentType,
            videoId: nextEpisode.id || null,
            season: Number(nextEpisode.season || 0) || null,
            episode: Number(nextEpisode.episode || 0) || null,
            episodeTitle: firstNonEmpty(nextEpisode.title),
            positionMs: 0,
            durationMs: 0,
            updatedAt: Number(progressEntry?.updatedAt || Date.now()),
            seedUpdatedAt: Number(progressEntry?.updatedAt || 0) || 0,
            seedSeason: Number(progressEntry?.season || 0) || null,
            isNextUp: true,
            shufflePlayback: shuffleSettings.enabled,
            ...releaseState,
            title: meta.name || prettyId(contentId),
            landscapePoster: firstNonEmpty(
              meta.landscapePoster,
              meta.thumbnail,
              meta.backdrop,
              meta.background,
              nextEpisode.thumbnail,
              meta.poster
            ),
            episodeThumbnail: firstNonEmpty(nextEpisode.thumbnail),
            poster: firstNonEmpty(meta.poster, nextEpisode.thumbnail, meta.thumbnail, meta.background, meta.backdrop),
            background: firstNonEmpty(meta.background, meta.backdrop, nextEpisode.thumbnail, meta.poster),
            backdrop: firstNonEmpty(meta.backdrop, meta.background, nextEpisode.thumbnail),
            thumbnail: firstNonEmpty(nextEpisode.thumbnail, meta.thumbnail, meta.poster, meta.background),
            logo: firstNonEmpty(meta.logo),
            description: firstNonEmpty(nextEpisode.overview, meta.description),
            released: firstNonEmpty(nextEpisode.released),
            releaseInfo: firstNonEmpty(nextEpisode.released, meta.releaseInfo),
            imdbRating: resolveImdbRating(meta),
            episodeImdbRating: await resolveContinueWatchingEpisodeRating(
              { ...progressEntry, contentId, season: nextEpisode.season, episode: nextEpisode.episode },
              nextEpisode.imdbRating
            ),
            genres: Array.isArray(meta.genres) ? meta.genres : [],
            runtimeMinutes: Number(meta.runtimeMinutes ?? meta.runtime ?? 0) || 0,
            ageRating: firstNonEmpty(meta.ageRating, meta.age_rating),
            status: firstNonEmpty(meta.status),
            language: firstNonEmpty(meta.language),
            country: firstNonEmpty(meta.country)
          };
        },
        {
          maxLookups: CW_MAX_NEXT_UP_LOOKUPS,
          concurrency: CW_MAX_NEXT_UP_CONCURRENCY
        }
      );

      // The episode search already applied this setting to the addon release
      // date. Check it again here because TMDB release dates are merged in after
      // that, so this is the first point where the card's final release state is
      // known.
      const showUnairedNextUp = this.layoutPrefs?.showUnairedNextUp !== false;
      return nextUpItems
        .filter((item) => shouldKeepNextUpForAiringSetting(item, showUnairedNextUp))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    },
    persistContinueWatchingSnapshot() {
      writeContinueWatchingDisplaySnapshot(watchProgressRepository.getContinueWatchingSourceKey(), this.continueWatchingDisplay);
    },
    clearContinueWatchingSnapshot() {
      const scopeKey = watchProgressRepository.getContinueWatchingSourceKey();
      if (!scopeKey) {
        return;
      }
      const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
      if (!store || typeof store !== "object" || !Object.prototype.hasOwnProperty.call(store, scopeKey)) {
        return;
      }
      const next = { ...store };
      delete next[scopeKey];
      LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, next);
      this.continueWatchingHydratedFromSnapshot = false;
    },
    async enrichContinueWatchingMetaWithTmdb(meta = {}, item = {}) {
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.enrichContinueWatching || !TMDB_API_KEY || !meta) {
        return meta;
      }
      const contentType = item.contentType || meta.type || "movie";
      try {
        const explicitTmdbId = Number(item.tmdbId || 0);
        const tmdbLookupId = explicitTmdbId > 0 ? `tmdb:${explicitTmdbId}` : firstNonEmpty(item.imdbId, item.contentId, meta.id);
        const tmdbId = await withTimeout(TmdbService.ensureTmdbId(tmdbLookupId, contentType), 1800, null);
        if (!tmdbId) {
          return meta;
        }
        const isSeries = isSeriesTypeForContinueWatching(contentType);
        const enrichmentPromise = withTimeout(
          TmdbMetadataService.fetchEnrichment({
            tmdbId,
            contentType,
            language: settings.language
          }),
          2200,
          null
        ).catch(() => null);
        const episodeMapPromise =
          isSeries && settings.useEpisodes && item.season != null && Number(item.season) >= 0
            ? withTimeout(
                TmdbMetadataService.fetchEpisodeEnrichment({
                  tmdbId,
                  seasonNumbers: [Number(item.season)],
                  language: settings.language
                }),
                1800,
                new Map()
              ).catch(() => new Map())
            : Promise.resolve(new Map());
        const [enrichment, episodeMap] = await Promise.all([enrichmentPromise, episodeMapPromise]);
        if (!enrichment && !episodeMap.size) {
          return meta;
        }
        const showEnrichment = enrichment || {};
        const videos =
          episodeMap.size && Array.isArray(meta.videos)
            ? meta.videos.map((video) => {
                const key =
                  (video?.season != null || video?.seasonNumber != null) &&
                  Number(video?.season ?? video?.seasonNumber) >= 0 &&
                  Number(video?.episode ?? video?.episodeNumber ?? 0) > 0
                    ? `${Number(video.season ?? video.seasonNumber)}:${Number(video.episode ?? video.episodeNumber)}`
                    : "";
                const episode = key ? episodeMap.get(key) : null;
                if (!episode) {
                  return video;
                }
                return {
                  ...video,
                  title: settings.useEpisodes ? episode.title || video.title : video.title,
                  overview: settings.useEpisodes ? episode.overview || video.overview : video.overview,
                  thumbnail: settings.useEpisodes ? episode.thumbnail || video.thumbnail : video.thumbnail,
                  runtime: settings.useEpisodes ? episode.runtime || video.runtime : video.runtime
                };
              })
            : meta.videos;
        const currentEpisode = episodeMap.get(`${Number(item.season || 0)}:${Number(item.episode || 0)}`);
        return {
          ...meta,
          name: settings.useBasicInfo ? showEnrichment.localizedTitle || meta.name : meta.name,
          description: settings.useBasicInfo ? showEnrichment.description || meta.description : meta.description,
          background: settings.useArtwork ? showEnrichment.backdrop || meta.background : meta.background,
          backdrop: settings.useArtwork ? showEnrichment.backdrop || meta.backdrop : meta.backdrop,
          poster: settings.useArtwork ? showEnrichment.poster || meta.poster : meta.poster,
          thumbnail: settings.useArtwork ? showEnrichment.poster || meta.thumbnail : meta.thumbnail,
          logo: settings.useArtwork ? showEnrichment.logo || meta.logo : meta.logo,
          genres: settings.useBasicInfo && showEnrichment.genres?.length ? showEnrichment.genres : meta.genres,
          runtime: settings.useDetails ? showEnrichment.runtime || meta.runtime : meta.runtime,
          country: settings.useDetails ? showEnrichment.country || meta.country : meta.country,
          language: settings.useDetails ? showEnrichment.language || meta.language : meta.language,
          ageRating: settings.useDetails ? showEnrichment.ageRating || meta.ageRating : meta.ageRating,
          status: settings.useDetails ? showEnrichment.status || meta.status : meta.status,
          tmdbRating:
            settings.useBasicInfo && typeof showEnrichment.rating === "number" ? Number(showEnrichment.rating.toFixed(1)) : meta.tmdbRating,
          episodeThumbnail: settings.useArtwork ? currentEpisode?.thumbnail || meta.episodeThumbnail : meta.episodeThumbnail,
          episodeTitle: settings.useEpisodes ? currentEpisode?.title || meta.episodeTitle : meta.episodeTitle,
          episodeDescription: settings.useEpisodes ? currentEpisode?.overview || meta.episodeDescription : meta.episodeDescription,
          episodeRuntime: settings.useEpisodes ? currentEpisode?.runtime || meta.episodeRuntime : meta.episodeRuntime,
          videos
        };
      } catch (error) {
        console.warn("Continue watching TMDB enrichment failed", error);
        return meta;
      }
    }
  };
}
