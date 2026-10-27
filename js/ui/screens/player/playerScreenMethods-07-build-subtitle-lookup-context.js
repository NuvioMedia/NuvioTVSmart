import { resolveStreamFilename } from "./streamFilename.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods07() {
  const {
    parentalGuideRepository,
    skipIntroRepository,
    PlayerSettingsStore,
    TrackPreferencesStore,
    cleanDisplayText,
    normalizeComparableText,
    normalizeTrackLanguageCode,
    inferAudioTrackLanguageKey,
    normalizeItemType,
    isSeriesItemType,
    buildLocalizedParentalWarnings,
    normalizePlayableImdbId,
    normalizePlayableTmdbId,
    normalizePlayableTraktId
  } = internals;

  return {
    buildSubtitleLookupContext() {
      const type = normalizeItemType(this.params?.itemType || "movie");
      const identity = this.buildPlaybackIdentityContext();
      const rawItemId = String(this.params?.itemId || "").trim();
      const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
      const imdbItemId = normalizePlayableImdbId(identity.imdbId);
      const id = imdbItemId || baseItemId || rawItemId || "";
      const currentStream = this.getCurrentStreamCandidate();
      const rawStream = currentStream?.raw || currentStream || {};
      const behaviorHints = {
        ...(rawStream?.behaviorHints || {}),
        ...(currentStream?.behaviorHints || {})
      };

      let videoId = null;
      if (type === "series") {
        const routeVideoId = String(this.params?.videoId || "").trim();
        const season = Number(this.params?.season);
        const episode = Number(this.params?.episode);
        // The exact episode id used by the player is authoritative, matching Android TV.
        if (routeVideoId) {
          videoId = routeVideoId;
        } else if (id && Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
          videoId = `${id}:${season}:${episode}`;
        }
      }

      return {
        type,
        id,
        videoId,
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null,
        title: this.params?.playerTitle || this.params?.itemTitle || null,
        year: this.params?.playerReleaseYear || this.params?.year || null,
        videoHash: behaviorHints.videoHash || currentStream?.videoHash || rawStream.videoHash || this.params?.videoHash || null,
        videoSize: behaviorHints.videoSize || currentStream?.videoSize || rawStream.videoSize || this.params?.videoSize || null,
        filename: resolveStreamFilename(currentStream, this.initialFilenameStreamCandidate, this.params?.filename)
      };
    },
    buildPlaybackIdentityContext() {
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      const rawImdbId = String(this.params?.imdbId || this.params?.imdb_id || "").trim();
      const rawItemId = String(this.params?.itemId || "").trim();
      const rawVideoId = String(this.params?.videoId || "").trim();
      const seasonRaw = this.params?.season;
      const season = Number(seasonRaw);
      const episode = Number(this.params?.episode || 0);
      const imdbId =
        [normalizePlayableImdbId(rawImdbId), normalizePlayableImdbId(rawVideoId), normalizePlayableImdbId(rawItemId)].find(Boolean) || "";
      const tmdbId =
        [
          normalizePlayableTmdbId(this.params?.tmdbId || this.params?.tmdb_id),
          normalizePlayableTmdbId(rawItemId),
          normalizePlayableTmdbId(rawVideoId)
        ].find(Boolean) || 0;
      const traktId =
        [
          normalizePlayableTraktId(this.params?.traktId || this.params?.trakt_id),
          normalizePlayableTraktId(rawItemId),
          normalizePlayableTraktId(rawVideoId)
        ].find(Boolean) || 0;
      return {
        itemType,
        imdbId,
        tmdbId,
        traktId,
        season: seasonRaw != null && Number.isFinite(season) && season >= 0 ? season : null,
        episode: Number.isFinite(episode) && episode > 0 ? episode : null
      };
    },
    getTrackPreferenceContentId() {
      const identity = this.buildPlaybackIdentityContext();
      const itemId = String(this.params?.itemId || "").trim();
      if (itemId) {
        return itemId;
      }
      if (identity.imdbId) {
        return identity.imdbId;
      }
      if (identity.tmdbId) {
        return `tmdb:${identity.itemType}:${identity.tmdbId}`;
      }
      if (identity.traktId) {
        return `trakt:${identity.itemType}:${identity.traktId}`;
      }
      return "";
    },
    getAudioTrackPreference(entry = {}) {
      const track = entry?.track || {};
      const sourceTrackId = Number(track?.sourceTrackId);
      const trackId =
        [
          track?.trackId,
          Number.isFinite(sourceTrackId) && sourceTrackId >= 0 ? sourceTrackId : null,
          track?.raw?.id,
          track?.id,
          entry?.manifestAudioTrackId
        ]
          .map((value) => cleanDisplayText(value))
          .find(Boolean) || "";
      const name = [track?.name, track?.label, track?.title, entry?.label].map((value) => cleanDisplayText(value)).find(Boolean) || "";
      return {
        language: inferAudioTrackLanguageKey(track, entry),
        name,
        trackId
      };
    },
    getSubtitleTrackPreference(option = {}) {
      const entry = option?.entry || {};
      const track = entry?.track || entry;
      const type = String(option?.sourceType || "")
        .trim()
        .toLowerCase();
      if (type === "off") {
        return { type: "DISABLED" };
      }

      const language =
        [option?.languageKey, entry?.languageKey, track?.lang, track?.language, track?.languageCode]
          .map((value) => cleanDisplayText(value))
          .find(Boolean) || "";
      if (type === "addon") {
        return {
          type: "ADDON",
          language,
          addonId:
            [entry?.subtitleId, track?.id, track?.trackId, track?.raw?.id].map((value) => cleanDisplayText(value)).find(Boolean) || "",
          addonUrl: cleanDisplayText(track?.url || track?.raw?.url || ""),
          addonName: cleanDisplayText(track?.addonName || track?.raw?.addonName || "")
        };
      }

      const sourceTrackId = Number(track?.sourceTrackId);
      return {
        type: "INTERNAL",
        language,
        name:
          [track?.name, track?.label, track?.title, entry?.label, option?.title].map((value) => cleanDisplayText(value)).find(Boolean) ||
          "",
        trackId:
          [
            entry?.manifestSubtitleTrackId,
            track?.trackId,
            Number.isFinite(sourceTrackId) && sourceTrackId >= 0 ? sourceTrackId : null,
            track?.raw?.id,
            track?.id
          ]
            .map((value) => cleanDisplayText(value))
            .find(Boolean) || "",
        isForced: Boolean(option?.isForced)
      };
    },
    rememberSubtitleTrackSelection(option = null) {
      if (!option || !this.trackPreferenceContentId) {
        return;
      }
      const preference = this.getSubtitleTrackPreference(option);
      if (!preference) {
        return;
      }
      TrackPreferencesStore.setSubtitle(this.trackPreferenceContentId, preference);
      this.rememberedSubtitleTrackPreference = { ...preference };
    },
    rememberAudioTrackSelection(preference = null) {
      if (!preference || !this.trackPreferenceContentId) {
        return;
      }
      TrackPreferencesStore.setAudio(this.trackPreferenceContentId, preference);
      this.rememberedAudioTrackPreference = { ...preference };
    },
    findRememberedAudioOption(preference = this.rememberedAudioTrackPreference) {
      if (!preference) {
        return null;
      }
      const options = this.collectAudioOptionItems().filter((option) => option.supported);
      const targetId = normalizeComparableText(preference.trackId || "");
      const targetName = normalizeComparableText(preference.name || "");
      const targetLanguage = normalizeTrackLanguageCode(preference.language || "") || normalizeComparableText(preference.language || "");
      const describe = (option) => {
        const current = this.getAudioTrackPreference(option.entry);
        return {
          id: normalizeComparableText(current.trackId || ""),
          name: normalizeComparableText(current.name || ""),
          language: normalizeTrackLanguageCode(current.language || "") || normalizeComparableText(current.language || "")
        };
      };
      const languageMatchesExactly = (current) => !targetLanguage || current.language === targetLanguage;
      const nameMatches = (current) => !targetName || current.name === targetName || current.name.includes(targetName);

      if (targetId) {
        const exactId = options.find((option) => {
          const current = describe(option);
          return current.id === targetId && languageMatchesExactly(current) && nameMatches(current);
        });
        if (exactId) {
          return exactId;
        }
      }

      if (targetName) {
        const exactName = options.find((option) => {
          const current = describe(option);
          return current.name === targetName && languageMatchesExactly(current);
        });
        if (exactName) {
          return exactName;
        }
        const containedName = options.find((option) => {
          const current = describe(option);
          return current.name.includes(targetName) && languageMatchesExactly(current);
        });
        if (containedName) {
          return containedName;
        }
      }

      if (!targetLanguage) {
        return null;
      }
      const exactLanguage = options.find((option) => describe(option).language === targetLanguage);
      if (exactLanguage) {
        return exactLanguage;
      }
      const targetBase = targetLanguage.split("-")[0];
      return options.find((option) => describe(option).language.split("-")[0] === targetBase) || null;
    },
    buildScrobbleContext() {
      const identity = this.buildPlaybackIdentityContext();
      const currentSec = this.getPlaybackCurrentSeconds();
      const durationSec = this.getPlaybackDurationSeconds();
      const progress = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;
      return {
        serverPlayback: this.getCurrentStreamCandidate()?.serverPlayback || this.getCurrentStreamCandidate()?.raw?.serverPlayback || null,
        contentId: String(this.params?.itemId || identity.imdbId || ""),
        videoId: String(this.params?.videoId || this.params?.playerVideoId || ""),
        contentType: isSeriesItemType(identity.itemType) ? "series" : "movie",
        imdbId: identity.imdbId,
        tmdbId: identity.tmdbId || null,
        traktId: identity.traktId || null,
        title: String(this.params?.playerTitle || this.params?.itemTitle || this.params?.title || ""),
        year: Number(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || 0) || null,
        seasonNumber: identity.season,
        episodeNumber: identity.episode,
        episodeTitle: String(this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || ""),
        positionMs: Math.round(currentSec * 1000),
        durationMs: Math.round(durationSec * 1000),
        isLive: this.isLivePlayback(),
        progressPercent: progress
      };
    },
    maybeShowParentalGuideOverlay() {
      if (
        PlayerSettingsStore.get().parentalGuideEnabled === false ||
        this.parentalGuideShown ||
        !this.parentalWarnings.length ||
        this.paused ||
        this.loadingVisible ||
        this.isBufferingForPauseOverlay() ||
        this.startupAudioGateActive ||
        !this.hasPresentedPlaybackFrame
      ) {
        return;
      }
      this.showParentalGuideOverlay();
    },
    async fetchParentalGuide() {
      if (PlayerSettingsStore.get().parentalGuideEnabled === false) return;
      const mountToken = this.playerMountToken;
      const { itemType, imdbId, season, episode } = this.buildPlaybackIdentityContext();
      if (!imdbId) {
        return;
      }
      const response =
        isSeriesItemType(itemType) && season && episode
          ? await parentalGuideRepository.getTvGuide(imdbId, season, episode)
          : await parentalGuideRepository.getMovieGuide(imdbId);
      if (!this.isActiveMountToken(mountToken) || PlayerSettingsStore.get().parentalGuideEnabled === false) return;
      const warnings = buildLocalizedParentalWarnings(response?.parentalGuide || {});
      if (!warnings.length) {
        return;
      }
      if (JSON.stringify(this.parentalWarnings || []) === JSON.stringify(warnings)) {
        return;
      }
      const hasAlreadyShown = Boolean(this.parentalGuideShown);
      this.parentalWarnings = warnings;
      if (!hasAlreadyShown) {
        this.parentalGuideShown = false;
      }
      this.renderParentalGuideOverlay();
      if (!hasAlreadyShown) {
        this.maybeShowParentalGuideOverlay();
      }
    },
    async fetchSkipIntervals() {
      const requestToken = (this.skipIntervalsRequestToken || 0) + 1;
      this.skipIntervalsRequestToken = requestToken;
      if (!PlayerSettingsStore.get().skipIntroEnabled) {
        this.skipIntervals = [];
        this.activeSkipInterval = null;
        this.skipIntervalDismissed = false;
        this.skipIntroAutoHidden = false;
        this.skipIntroCountdownProgress = 0;
        this.skipIntroCountdownLastTickAt = Date.now();
        this.skipIntroCountdownStartAt = 0;
        this.skipIntroSuppressedKey = "";
        this.skipIntroSuppressedUntil = 0;
        this.stopSkipIntroCountdownAnimation();
        this.renderSkipIntroButton();
        return;
      }
      const identity = this.buildPlaybackIdentityContext();
      const contentId = this.params?.itemId || this.params?.contentId || this.params?.videoId || "";
      const videoId = this.params?.videoId || "";
      const isSeries = isSeriesItemType(identity.itemType);
      const hasIdentity = isSeries
        ? Boolean(identity.imdbId && identity.season && identity.episode)
        : Boolean(identity.imdbId || identity.tmdbId || contentId || videoId);
      if (!hasIdentity) {
        this.skipIntervals = [];
        this.activeSkipInterval = null;
        this.skipIntervalDismissed = false;
        this.skipIntroAutoHidden = false;
        this.skipIntroCountdownProgress = 0;
        this.skipIntroCountdownLastTickAt = Date.now();
        this.skipIntroCountdownStartAt = 0;
        this.skipIntroSuppressedKey = "";
        this.skipIntroSuppressedUntil = 0;
        this.stopSkipIntroCountdownAnimation();
        this.renderSkipIntroButton();
        return;
      }
      const intervals = isSeries
        ? await skipIntroRepository.getSkipIntervals(identity.imdbId, identity.season, identity.episode)
        : await skipIntroRepository.getMovieSkipIntervals({
            imdbId: identity.imdbId,
            tmdbId: identity.tmdbId,
            contentId,
            videoId
          });
      if (this.skipIntervalsRequestToken !== requestToken) {
        return;
      }
      this.skipIntervals = Array.isArray(intervals) ? intervals : [];
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
    }
  };
}
