/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

export function createPlayerScreenMethods19() {
  const {
    PlayerSettingsStore,
    TorrentSettingsStore,
    metaRepository,
    cleanDisplayText,
    extractReleaseYear,
    extractPauseOverlayCast,
    normalizeItemType,
    isSeriesItemType
  } = internals;

  return {
    async refreshLoadingOverlayProgress() {
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (this.loadingProgressRefreshInFlight) {
        return;
      }
      const canShowLoadingProgress = Boolean(
        this.loadingVisible && this.currentEngineFsStream && !this.hasPresentedPlaybackFrame && !this.isExternalFrameMode()
      );
      const canShowTorrentOverlay = Boolean(
        this.currentEngineFsStream && !this.isExternalFrameMode() && !TorrentSettingsStore.get().hideTorrentStats
      );
      if (!canShowLoadingProgress && !canShowTorrentOverlay) {
        if (this.loadingProgress != null) {
          this.loadingProgress = null;
          this.loadingLogoFillTarget = 0;
          this.stopLoadingLogoFillAnimation();
          this.syncLoadingOverlayProgress();
        }
        if (this.loadingTorrentStatus) {
          this.loadingTorrentStatus = "";
          this.syncLoadingOverlayStatus();
        }
        if (this.torrentOverlayData) {
          this.torrentOverlayData = null;
          this.syncTorrentOverlay();
        }
        return;
      }

      this.loadingProgressRefreshInFlight = true;
      try {
        const stats = await this.fetchCurrentEngineFsStats({ timeoutMs: 1200 });
        if (!this.currentEngineFsStream || this.isExternalFrameMode() || this.isStartupErrorVisible()) {
          if (this.loadingProgress != null) {
            this.loadingProgress = null;
            this.loadingLogoFillTarget = 0;
            this.stopLoadingLogoFillAnimation();
            this.syncLoadingOverlayProgress();
          }
          if (this.loadingTorrentStatus) {
            this.loadingTorrentStatus = "";
            this.syncLoadingOverlayStatus();
          }
          if (this.torrentOverlayData) {
            this.torrentOverlayData = null;
            this.syncTorrentOverlay();
          }
          return;
        }
        const nextProgress = canShowLoadingProgress ? this.getLoadingOverlayProgress(stats) : null;
        if (nextProgress != null && nextProgress !== this.loadingProgress) {
          this.loadingProgress = nextProgress;
          this.syncLoadingOverlayProgress();
        } else if (!canShowLoadingProgress && this.loadingProgress != null) {
          this.loadingProgress = null;
          this.loadingLogoFillTarget = 0;
          this.stopLoadingLogoFillAnimation();
          this.syncLoadingOverlayProgress();
        }
        const nextStatus = this.getLoadingOverlayStatusText(stats);
        if (nextStatus !== this.loadingTorrentStatus) {
          this.loadingTorrentStatus = nextStatus;
          this.syncLoadingOverlayStatus();
        }
        const nextTorrentOverlay = canShowTorrentOverlay ? this.getTorrentOverlayData(stats) : null;
        if (JSON.stringify(nextTorrentOverlay) !== JSON.stringify(this.torrentOverlayData)) {
          this.torrentOverlayData = nextTorrentOverlay;
          this.syncTorrentOverlay();
        }
      } finally {
        this.loadingProgressRefreshInFlight = false;
      }
    },
    bindLoadingLogoFallback() {
      const identity = this.uiRefs?.loadingIdentity;
      const logo = this.uiRefs?.loadingLogoBase;
      const fill = this.uiRefs?.loadingLogoFill;
      if (!identity || !logo) {
        return;
      }

      const showLogo = () => {
        identity.classList.add("logo-loaded");
        identity.classList.remove("logo-failed");
        if (fill && logo.getAttribute("src")) {
          fill.setAttribute("src", logo.getAttribute("src"));
        }
        this.syncLoadingOverlayProgress();
      };
      const showTitleFallback = () => {
        identity.classList.add("logo-failed");
        identity.classList.remove("logo-loaded");
        if (fill) {
          fill.removeAttribute("src");
        }
        this.loadingProgress = null;
        this.loadingLogoFillActive = false;
        this.loadingLogoFillProgress = 0;
        this.loadingLogoFillTarget = 0;
        this.stopLoadingLogoFillAnimation();
        this.loadingTorrentStatus = "";
        this.torrentOverlayData = null;
        this.syncLoadingOverlayProgress();
        this.syncLoadingOverlayStatus();
        this.syncTorrentOverlay();
      };

      logo.addEventListener("load", showLogo, { once: true });
      logo.addEventListener("error", showTitleFallback, { once: true });

      if (logo.complete) {
        if (logo.naturalWidth > 0 && logo.naturalHeight > 0) {
          showLogo();
        } else {
          showTitleFallback();
        }
      }
    },
    getPlayerUiState() {
      const header = this.getPlayerHeaderData();
      return {
        isPlaying: !this.paused,
        isBuffering: Boolean(this.loadingVisible),
        currentPosition: Math.round(this.getPlaybackCurrentSeconds() * 1000),
        duration: Math.round(this.getPlaybackDurationSeconds() * 1000),
        title: header.title,
        currentSeason: this.params?.season == null ? null : Number(this.params.season),
        currentEpisode: this.params?.episode == null ? null : Number(this.params.episode),
        currentEpisodeTitle: this.getDisplayEpisodeTitle() || null,
        releaseYear: header.meta || null,
        currentStreamName: this.getCurrentStreamCandidate()?.label || null,
        currentStreamUrl: this.getCurrentStreamCandidate()?.url || null,
        showControls: Boolean(this.controlsVisible),
        showSeekOverlay: Boolean(this.seekOverlayVisible),
        pendingPreviewSeekPosition: this.seekPreviewSeconds == null ? null : Math.round(Number(this.seekPreviewSeconds || 0) * 1000),
        playbackSpeed: this.getPlaybackSpeed(),
        showAudioOverlay: Boolean(this.audioDialogVisible),
        showSubtitleOverlay: Boolean(this.subtitleDialogVisible),
        subtitleDelayMs: Number(this.subtitleDelayMs || 0),
        subtitleStyle: { ...this.subtitleStyleSettings },
        audioAmplificationDb: Number(this.audioAmplificationDb || 0),
        isAudioAmplificationAvailable: Boolean(this.audioAmplificationAvailable),
        persistAudioAmplification: Boolean(this.persistAudioAmplification),
        showPauseOverlay: Boolean(this.pauseOverlayVisible),
        showEpisodesPanel: Boolean(this.episodePanelVisible),
        episodesAll: Array.isArray(this.episodes) ? this.episodes : [],
        showSourcesPanel: Boolean(this.sourcesPanelVisible),
        isLoadingSourceStreams: Boolean(this.sourcesLoading),
        sourceStreamsError: this.sourcesError || null,
        sourceAllStreams: Array.isArray(this.streamCandidates) ? this.streamCandidates : [],
        sourceSelectedAddonFilter: this.sourceFilter === "all" ? null : this.sourceFilter,
        sourceFilteredStreams: this.getFilteredSources(),
        sourceAvailableAddons: this.getSourceFilters().filter((entry) => entry !== "all")
      };
    },
    resolvePauseOverlayEpisodeEntry(entries = []) {
      if (!Array.isArray(entries) || !entries.length) {
        return null;
      }
      const explicitVideoId = String(this.params?.videoId || "").trim();
      if (explicitVideoId) {
        const byId = entries.find((entry) => String(entry?.id || "").trim() === explicitVideoId);
        if (byId) {
          return byId;
        }
      }

      const seasonRaw = this.params?.season;
      const season = Number(seasonRaw);
      const episode = Number(this.params?.episode || 0);
      if (seasonRaw != null && Number.isFinite(season) && season >= 0 && Number.isFinite(episode) && episode > 0) {
        return entries.find((entry) => Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode) || null;
      }

      return null;
    },
    buildPauseOverlayMeta(meta = null) {
      const resolvedMeta = meta && typeof meta === "object" ? meta : {};
      const episodeEntry = this.resolvePauseOverlayEpisodeEntry(this.episodes);
      const metaEpisodeEntry = this.resolvePauseOverlayEpisodeEntry(resolvedMeta?.videos);
      const title =
        cleanDisplayText(this.params?.playerTitle || this.params?.itemTitle || resolvedMeta?.name || this.params?.itemId || "Untitled") ||
        "Untitled";
      const releaseYear = cleanDisplayText(
        this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || extractReleaseYear(resolvedMeta?.releaseInfo)
      );
      const season = Number(this.params?.season ?? episodeEntry?.season ?? metaEpisodeEntry?.season ?? 0);
      const episode = Number(this.params?.episode ?? episodeEntry?.episode ?? metaEpisodeEntry?.episode ?? 0);
      const hasEpisodeContext =
        this.params?.season != null && Number.isFinite(season) && season >= 0 && Number.isFinite(episode) && episode > 0;
      const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
      const episodeTitle = cleanDisplayText(
        this.getDisplayEpisodeTitle() ||
          this.params?.playerEpisodeTitle ||
          episodeEntry?.title ||
          metaEpisodeEntry?.title ||
          metaEpisodeEntry?.name ||
          ""
      );
      const description = cleanDisplayText(
        this.params?.playerDescription ||
          this.params?.description ||
          this.params?.overview ||
          episodeEntry?.overview ||
          episodeEntry?.description ||
          metaEpisodeEntry?.overview ||
          metaEpisodeEntry?.description ||
          resolvedMeta?.description ||
          resolvedMeta?.overview ||
          ""
      );
      const backdropUrl = cleanDisplayText(
        this.params?.playerBackdropUrl ||
          this.params?.backdrop ||
          resolvedMeta?.background ||
          resolvedMeta?.poster ||
          this.params?.poster ||
          ""
      );
      const logoUrl = cleanDisplayText(this.params?.playerLogoUrl || resolvedMeta?.logo || this.params?.logo || "");

      return {
        title,
        releaseYear,
        episodeCode,
        episodeTitle,
        description,
        backdropUrl,
        logoUrl,
        cast: extractPauseOverlayCast({
          castItems: this.params?.castItems,
          castMembers: this.params?.castMembers || resolvedMeta?.castMembers,
          cast: this.params?.cast || resolvedMeta?.cast,
          credits: this.params?.credits || resolvedMeta?.credits
        })
      };
    },
    async hydratePauseOverlayMeta() {
      const itemId = String(this.params?.itemId || "").trim();
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      if (!itemId || this.isExternalFrameMode()) {
        return;
      }

      const requestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
      this.pauseOverlayMetaRequestToken = requestToken;

      // Android TV resolves the addon meta and then applies the TMDB
      // translation over it, so the pause overlay never keeps an English
      // synopsis when the configured language has a localized overview.
      const [metaResult, tmdbMeta] = await Promise.all([
        metaRepository.getMetaFromAllAddons(itemType, itemId).catch((error) => {
          if (requestToken === this.pauseOverlayMetaRequestToken) {
            console.warn("Pause overlay metadata fetch failed", error);
          }
          return null;
        }),
        this.fetchPauseOverlayTmdbMeta(itemType, itemId)
      ]);
      if (requestToken !== this.pauseOverlayMetaRequestToken) {
        return;
      }

      const baseMeta = metaResult?.status === "success" && metaResult?.data ? metaResult.data : null;
      if (!baseMeta && !tmdbMeta) {
        return;
      }
      const meta = this.buildPauseOverlayMeta(baseMeta);
      this.pauseOverlayMeta = tmdbMeta
        ? {
            ...meta,
            title: tmdbMeta.title || meta.title,
            episodeTitle: tmdbMeta.episodeTitle || meta.episodeTitle,
            description: tmdbMeta.description || meta.description,
            logoUrl: tmdbMeta.logoUrl || meta.logoUrl,
            cast: meta.cast?.length ? meta.cast : tmdbMeta.cast
          }
        : meta;
      this.renderPauseOverlay();
    },
    async fetchPauseOverlayTmdbMeta(itemType, itemId) {
      const settings = TmdbSettingsStore.get();
      const isSeries = isSeriesItemType(itemType);
      if (!settings.enabled || !settings.useBasicInfo || (!isSeries && itemType !== "movie")) {
        return null;
      }

      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      try {
        const tmdbId = await TmdbService.ensureTmdbId(String(this.params?.tmdbId || "").trim() || itemId, itemType, {
          fallbackImdbId: this.params?.imdbId
        });
        if (!tmdbId) {
          return null;
        }
        const [enrichment, episodeEntry] = await Promise.all([
          TmdbMetadataService.fetchEnrichment({
            tmdbId,
            contentType: itemType,
            language: settings.language
          }),
          isSeries && season != null && episode > 0
            ? TmdbMetadataService.fetchEpisodeEnrichment({
                tmdbId,
                seasonNumbers: [season],
                language: settings.language
              })
                .then((episodes) => episodes.get(`${season}:${episode}`) || null)
                .catch(() => null)
            : null
        ]);
        if (!enrichment && !episodeEntry) {
          return null;
        }
        return {
          title: enrichment?.localizedTitle || "",
          episodeTitle: episodeEntry?.title || "",
          // Disabling TMDB episodes must keep the addon episode synopsis
          // instead of replacing it with the show-level description.
          description: isSeries
            ? settings.useEpisodes
              ? episodeEntry?.overview || enrichment?.description || ""
              : ""
            : enrichment?.description || "",
          logoUrl: settings.useArtwork ? enrichment?.logo || "" : "",
          cast: extractPauseOverlayCast({ credits: enrichment?.credits || null })
        };
      } catch (error) {
        console.warn("Pause overlay TMDB enrichment failed", error);
        return null;
      }
    },
    clearPauseOverlayTimer() {
      if (this.pauseOverlayTimer) {
        clearTimeout(this.pauseOverlayTimer);
        this.pauseOverlayTimer = null;
      }
    },
    canShowPauseOverlay() {
      return (
        PlayerSettingsStore.get().pauseOverlayEnabled !== false &&
        !this.isExternalFrameMode() &&
        this.paused &&
        !this.isBufferingForPauseOverlay() &&
        !this.seekOverlayVisible &&
        this.seekPreviewSeconds == null &&
        !this.isDialogOpen() &&
        !this.parentalGuideVisible &&
        !this.moreActionsVisible &&
        !this.isNextEpisodeCardVisible()
      );
    }
  };
}
