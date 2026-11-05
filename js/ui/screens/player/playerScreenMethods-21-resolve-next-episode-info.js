import { ProfileManager } from "../../../core/profile/profileManager.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { selectShuffleEpisode } from "../../../core/player/episodeShuffleSelection.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods21() {
  const { PlayerController, Router, ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS, normalizeItemType, isSeriesItemType } = internals;

  return {
    resolveNextEpisodeInfo() {
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      if (!isSeriesItemType(itemType)) {
        return null;
      }

      const shuffleSettings = EpisodeShuffleStore.get(this.params?.itemId || this.params?.contentId, itemType);
      const shuffleCacheKey = JSON.stringify([
        ProfileManager.getActiveProfileId(),
        this.params?.itemId || this.params?.contentId,
        this.params?.videoId,
        this.params?.season,
        this.params?.episode,
        this.params?.nextEpisodeVideoId,
        shuffleSettings.enabled,
        shuffleSettings.includeWatched,
        LocalStore.revision("watchedItems"),
        LocalStore.revision("watchProgressItems")
      ]);
      if (this.shuffleNextCache?.key !== shuffleCacheKey || this.shuffleNextCache?.episodes !== this.episodes) {
        const shuffleCurrent =
          this.resolveCurrentEpisodeEntry() ||
          (this.params?.season != null && Number(this.params?.season) >= 0 && Number(this.params?.episode) > 0
            ? { season: this.params.season, episode: this.params.episode }
            : null);
        const selected = shuffleSettings.enabled
          ? selectShuffleEpisode({
              contentId: this.params?.itemId || this.params?.contentId,
              contentType: itemType,
              videos: this.episodes || [],
              surface: "playback",
              watched: this.shuffleRemoteWatched || new Set(),
              current: shuffleCurrent,
              preferredVideoId: this.params?.nextEpisodeVideoId || null,
              reference: this.params || {}
            })
          : null;
        this.shuffleNextCache = { key: shuffleCacheKey, episodes: this.episodes, selected };
      }
      const shuffled = this.shuffleNextCache.selected;
      if (shuffleSettings.enabled && !shuffled) return null;
      let nextEpisode = shuffled;
      const explicitVideoId = String(this.params?.nextEpisodeVideoId || "").trim();
      if (!nextEpisode && explicitVideoId && this.episodes.length) {
        nextEpisode = this.episodes.find((episode) => String(episode?.id || "") === explicitVideoId) || null;
      }

      if (!nextEpisode && this.params?.videoId && this.episodes.length) {
        const currentEpisode = this.episodes.find((episode) => String(episode?.id || "") === String(this.params?.videoId || ""));
        nextEpisode = this.getNextEpisodeInSequence(currentEpisode);
      }

      if (!nextEpisode && this.episodes.length) {
        const currentSeasonRaw = this.params?.season;
        const currentSeason = Number(currentSeasonRaw);
        const hasCurrentSeason = currentSeasonRaw != null && Number.isFinite(currentSeason) && currentSeason >= 0;
        const currentEpisode = Number(this.params?.episode || 0);
        if (currentEpisode > 0 && (currentSeasonRaw == null || hasCurrentSeason)) {
          const currentEntry = this.episodes.find(
            (episode) =>
              (!hasCurrentSeason || Number(episode?.season) === currentSeason) && Number(episode?.episode || 0) === currentEpisode
          );
          nextEpisode = this.getNextEpisodeInSequence(currentEntry);
        }
      }

      const nextVideoId = String(nextEpisode?.id || explicitVideoId || "").trim();
      if (!nextVideoId) {
        return null;
      }

      const season = nextEpisode?.season ?? this.params?.nextEpisodeSeason ?? null;
      const episode = nextEpisode?.episode ?? this.params?.nextEpisodeEpisode ?? null;
      const episodeLabel = nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : this.params?.nextEpisodeLabel || "";
      const released = String(nextEpisode?.released || this.params?.nextEpisodeReleased || "").trim() || null;
      return {
        videoId: nextVideoId,
        season: season == null ? null : Number(season),
        episode: episode == null ? null : Number(episode),
        episodeLabel: episodeLabel || null,
        episodeTitle: String(nextEpisode?.title || this.params?.nextEpisodeTitle || "").trim() || null,
        released,
        hasAired: this.hasEpisodeAired(released)
      };
    },
    getNextEpisodeInSequence(currentEpisode = null) {
      if (!currentEpisode || !Array.isArray(this.episodes) || !this.episodes.length) {
        return null;
      }
      const currentSeason = Number(currentEpisode?.season);
      const hasCurrentSeason = currentEpisode?.season != null && Number.isFinite(currentSeason) && currentSeason >= 0;
      const sequence = hasCurrentSeason
        ? this.episodes.filter((episode) => (currentSeason === 0 ? Number(episode?.season) === 0 : Number(episode?.season) > 0))
        : [...this.episodes]
            .filter((episode) => Number(episode?.episode || 0) > 0)
            .sort(
              (left, right) =>
                (Number(left?.season) || 0) - (Number(right?.season) || 0) || Number(left?.episode || 0) - Number(right?.episode || 0)
            );
      const currentIndex = sequence.findIndex(
        (episode) =>
          String(episode?.id || "") === String(currentEpisode?.id || "") ||
          ((!hasCurrentSeason || Number(episode?.season) === currentSeason) &&
            Number(episode?.episode || 0) === Number(currentEpisode?.episode || 0))
      );
      return currentIndex >= 0 ? sequence[currentIndex + 1] || null : null;
    },
    resolveCurrentEpisodeEntry() {
      if (!Array.isArray(this.episodes) || !this.episodes.length) {
        return null;
      }
      const currentVideoId = String(this.params?.videoId || "").trim();
      if (currentVideoId) {
        const byVideoId = this.episodes.find((episode) => String(episode?.id || "") === currentVideoId);
        if (byVideoId) {
          return byVideoId;
        }
      }

      const currentSeasonRaw = this.params?.season;
      const currentSeason = Number(currentSeasonRaw);
      const currentEpisode = Number(this.params?.episode || 0);
      if (currentSeasonRaw == null || !Number.isFinite(currentSeason) || currentSeason < 0 || currentEpisode <= 0) {
        return null;
      }
      return (
        this.episodes.find(
          (episode) => Number(episode?.season || 0) === currentSeason && Number(episode?.episode || 0) === currentEpisode
        ) || null
      );
    },
    buildStreamRouteParamsFromPlayer() {
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      const seriesItem = isSeriesItemType(itemType);
      const currentEpisode = seriesItem ? this.resolveCurrentEpisodeEntry() : null;
      const nextEpisode = seriesItem ? this.resolveNextEpisodeInfo() : null;
      const currentPositionMs = Math.round(this.getPlaybackCurrentSeconds() * 1000);
      const title = this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
      const backdrop = this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
      const logo = this.params?.playerLogoUrl || this.params?.logo || null;
      const videoId = seriesItem ? this.params?.videoId || currentEpisode?.id || null : this.params?.videoId || this.params?.itemId || null;

      return {
        itemId: this.params?.itemId || null,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        returnToDetail: true,
        fromDetailRoute: Boolean(this.params?.fromDetailRoute),
        itemTitle: title,
        itemSubtitle: seriesItem ? "" : this.params?.playerSubtitle || "",
        year: this.params?.playerReleaseYear || this.params?.year || "",
        backdrop,
        poster: this.params?.poster || backdrop,
        logo,
        parentalWarnings: this.params?.parentalWarnings || null,
        parentalGuide: this.params?.parentalGuide || null,
        videoId,
        season: seriesItem ? (this.params?.season ?? currentEpisode?.season ?? null) : null,
        episode: seriesItem ? (this.params?.episode ?? currentEpisode?.episode ?? null) : null,
        episodeTitle: seriesItem ? this.params?.playerEpisodeTitle || this.params?.playerSubtitle || currentEpisode?.title || "" : "",
        episodes: Array.isArray(this.episodes) ? this.episodes : [],
        nextEpisodeVideoId: nextEpisode?.videoId || null,
        nextEpisodeLabel: nextEpisode?.episodeLabel || null,
        nextEpisodeSeason: nextEpisode?.season ?? null,
        nextEpisodeEpisode: nextEpisode?.episode ?? null,
        nextEpisodeTitle: nextEpisode?.episodeTitle || "",
        nextEpisodeReleased: nextEpisode?.released || "",
        resumePositionMs: Number.isFinite(currentPositionMs) && currentPositionMs > 0 ? currentPositionMs : 0
      };
    },
    buildReturnStreamRouteParamsFromPlayer() {
      const derivedParams = this.buildStreamRouteParamsFromPlayer();
      const originalParams =
        this.params?.streamRouteParams && typeof this.params.streamRouteParams === "object" ? { ...this.params.streamRouteParams } : null;
      if (!originalParams) {
        return derivedParams;
      }
      return {
        ...derivedParams,
        ...originalParams,
        resumePositionMs: derivedParams.resumePositionMs,
        startFromBeginning: false
      };
    },
    shouldReturnToStreamOnBack() {
      if (this.params?.returnToStreamOnBack === false) {
        return false;
      }
      const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
      return Boolean(this.params?.returnToStreamOnBack || this.params?.streamRouteParams || streamParams.itemId || streamParams.videoId);
    },
    buildDetailRouteParamsFromPlayer() {
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      const seriesItem = isSeriesItemType(itemType);
      const streamRouteParams =
        this.params?.streamRouteParams && typeof this.params.streamRouteParams === "object" ? this.params.streamRouteParams : null;
      const currentEpisode = seriesItem ? this.resolveCurrentEpisodeEntry() : null;
      const preferredSeasonRaw = seriesItem ? (this.params?.season ?? currentEpisode?.season) : null;
      const preferredSeason = Number(preferredSeasonRaw);
      return {
        itemId: this.params?.itemId || null,
        itemType,
        fallbackTitle: this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled",
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack || streamRouteParams?.returnToSearchOnBack),
        returnHomeOnBack: Boolean(
          this.params?.returnHomeOnBack || streamRouteParams?.continueWatchingBackHome || streamRouteParams?.returnHomeOnBack
        ),
        preferredSeason: preferredSeasonRaw != null && Number.isFinite(preferredSeason) && preferredSeason >= 0 ? preferredSeason : null
      };
    },
    buildStreamRouteParamsForEpisode(episode = null) {
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      const seriesItem = isSeriesItemType(itemType);
      const targetEpisode = episode || null;
      const title = this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
      const backdrop = this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
      const logo = this.params?.playerLogoUrl || this.params?.logo || null;
      return {
        itemId: this.params?.itemId || null,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        returnToDetail: true,
        fromDetailRoute: Boolean(this.params?.fromDetailRoute),
        itemTitle: title,
        itemSubtitle: seriesItem ? "" : this.params?.playerSubtitle || "",
        year: this.params?.playerReleaseYear || this.params?.year || "",
        backdrop,
        poster: this.params?.poster || backdrop,
        logo,
        parentalWarnings: this.params?.parentalWarnings || null,
        parentalGuide: this.params?.parentalGuide || null,
        videoId: targetEpisode?.videoId || targetEpisode?.id || null,
        season: targetEpisode?.season == null ? null : Number(targetEpisode.season),
        episode: targetEpisode?.episode == null ? null : Number(targetEpisode.episode),
        episodeTitle: seriesItem ? targetEpisode?.episodeTitle || targetEpisode?.title || "" : "",
        episodes: Array.isArray(this.episodes) ? this.episodes : []
      };
    },
    navigateBackToStreamScreen({ forceDetail = false } = {}) {
      if (this.playerBackNavigationInProgress) {
        // The first Back already requested the browser pop that reveals the
        // existing route. A duplicate Tizen key must not make FocusEngine call
        // suppressNextPopstate(), otherwise it can swallow that traversal.
        return "history";
      }
      this.playerBackNavigationInProgress = true;
      this.releaseCurrentEngineFsStreamBestEffort("back-to-stream", {
        removeTorrent: true,
        deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
      });
      const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
      this.stopTrackingBeforeTeardown();
      try {
        PlayerController.stop();
      } catch (_) {
        // Route cleanup will make a second best-effort stop if native teardown throws.
      }
      const shouldReturnToLibrary = !forceDetail && this.params?.returnToLibraryOnBack === true;
      const shouldReturnToHome = !forceDetail && this.params?.returnToHomeOnBack === true;
      const shouldReturnToStream = !shouldReturnToLibrary && !shouldReturnToHome && !forceDetail && this.shouldReturnToStreamOnBack();
      const targetRoute = shouldReturnToHome
        ? "home"
        : shouldReturnToLibrary
          ? "library"
          : shouldReturnToStream
            ? "stream"
            : this.params?.itemId
              ? "detail"
              : "home";
      const targetParams =
        targetRoute === "library"
          ? {}
          : targetRoute === "stream"
            ? streamParams
            : targetRoute === "detail"
              ? this.buildDetailRouteParamsFromPlayer()
              : {};

      // Android returns to the existing NavController destination with
      // popBackStack(). Use the matching Web history/Router stack entry when it
      // exists so the previous Sources/Library/Home/Detail screen is restored in
      // place instead of being reconstructed with replaceHistory.
      if (
        Router.popToExistingRoute?.(targetRoute, targetParams, {
          allowSingleIntermediateRoute: targetRoute === "detail"
        })
      ) {
        return "history";
      }

      // Keep a conservative fallback for direct-player and recovered sessions
      // whose browser history no longer contains the expected destination.
      // Router's back-navigation guard still protects this replacement from a
      // late Tizen popstate without masking a legitimate history traversal.
      void Router.navigate(targetRoute, targetParams, {
        skipStackPush: true,
        replaceHistory: true,
        isBackNavigation: true
      });
      return true;
    }
  };
}
