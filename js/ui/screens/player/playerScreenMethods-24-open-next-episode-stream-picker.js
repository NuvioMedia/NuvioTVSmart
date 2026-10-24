import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods24() {
  const {
    PlayerController,
    PlayerSettingsStore,
    Environment,
    Router,
    getSubtitleVerticalOffsetVh,
    getSubtitleVerticalResidualOffsetVh,
    normalizeSubtitleTextOpacity,
    subtitleTextColorWithOpacity,
    isHdrStream,
    getHdrBrightnessFactor,
    getHdrHudBrightnessFactor,
    calibrateHdrColorHex,
    ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS,
    t,
    normalizeItemType,
    isSeriesItemType,
    normalizeSubtitleFontSize,
    formatHtmlSubtitleFontSize,
    dbToGain,
    supportsTvWebAudioAmplification,
    streamDirectPlaybackUrl
  } = internals;

  return {
    async openNextEpisodeStreamPicker(nextEpisode, { streamItems = null, forceReload = true, error = null } = {}) {
      let episodeIndex = this.episodes.findIndex((episode) => String(episode?.id || "") === String(nextEpisode?.videoId || ""));
      if (episodeIndex < 0) {
        this.episodes = [
          ...this.episodes,
          {
            id: nextEpisode.videoId,
            season: nextEpisode.season ?? null,
            episode: nextEpisode.episode ?? null,
            title: nextEpisode.episodeTitle || nextEpisode.episodeLabel || ""
          }
        ];
        episodeIndex = this.episodes.length - 1;
      }

      this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
      this.nextEpisodeLaunching = false;
      this.resetNextEpisodeLaunchPresentation();
      this.loadingVisible = false;
      this.nextEpisodeTransitionMeta = null;
      this.updateLoadingVisibility();
      this.refreshLoadingOverlayPresentation();
      this.setControlsVisible(true, { focus: false });
      this.episodePanelIndex = episodeIndex;
      this.episodePanelVisible = true;
      this.episodePanelMode = "streams";
      this.episodePanelStreamVideoId = String(nextEpisode.videoId || "");
      this.episodePanelStreamFilter = "all";
      this.episodePanelStreamsError = error ? t("panel_failed_load_streams", {}, "Failed to load streams") : "";
      this.episodePanelStreamsLoading = !Array.isArray(streamItems);
      this.episodePanelStreams = Array.isArray(streamItems) ? streamItems : [];
      this.episodePanelStreamFocus = this.episodePanelStreams.length ? { zone: "streams", index: 0 } : { zone: "actions", index: 0 };
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.sourcesPanelVisible = false;
      this.syncEpisodePanelSeasonToIndex();
      this.updateModalBackdrop();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.renderEpisodePanel();

      if (!Array.isArray(streamItems)) {
        await this.openEpisodeStreamsView({ forceReload });
      }
      return true;
    },
    async playNextEpisode({ userInitiated = false } = {}) {
      if (this.isPartyControlLocked?.()) {
        if (userInitiated) this.partyBlocksControl();
        return false;
      }
      const nextEpisode = this.resolveNextEpisodeInfo();
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      if (!nextEpisode?.videoId || !isSeriesItemType(itemType) || nextEpisode.hasAired === false || this.nextEpisodeLaunching) {
        return false;
      }

      const settings = PlayerSettingsStore.get();
      const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
      const shouldAutoSelectInManualMode =
        mode === "MANUAL" && (Boolean(settings.autoplayNextEpisode) || Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode));
      if (mode === "MANUAL" && !shouldAutoSelectInManualMode) {
        return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true });
      }

      const launchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
      this.nextEpisodeLaunchToken = launchToken;
      this.nextEpisodeLaunching = true;
      this.nextEpisodeCardTriggered = true;
      this.nextEpisodeCardSearching = true;
      this.nextEpisodeCardSourceName = "";
      this.nextEpisodeCardCountdownSec = null;
      if (userInitiated) {
        this.consecutiveAutoPlayCount = 0;
      }
      this.nextEpisodeTransitionMeta = {
        title: this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio",
        subtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
        logoUrl: this.params?.playerLogoUrl || this.params?.logo || "",
        backdropUrl: this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || ""
      };
      this.renderNextEpisodeCard();

      try {
        const resolution = await this.resolveNextEpisodeStreamByAutoPlayPolicy(nextEpisode, itemType, settings);
        if (!this.isNextEpisodeLaunchActive(launchToken)) {
          return false;
        }
        const streamItems = Array.isArray(resolution.streamItems) ? resolution.streamItems : [];
        const selectedStream = resolution.selectedStream || null;

        if (!selectedStream) {
          console.warn("Next episode auto-selection did not find a stream; opening picker", {
            videoId: nextEpisode.videoId,
            totalStreams: streamItems.length,
            mode,
            preferBingeGroup: Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode),
            error: resolution.error?.message || null
          });
          return this.openNextEpisodeStreamPicker(nextEpisode, {
            streamItems: resolution.error ? null : streamItems,
            forceReload: Boolean(resolution.error),
            error: resolution.error
          });
        }
        const bestStreamCandidate = selectedStream;
        const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
        if (!(await this.runNextEpisodeCountdown(launchToken, bestStreamCandidate))) {
          return false;
        }
        const nextEpisodeIndex = this.episodes.findIndex((episode) => String(episode?.id || "") === String(nextEpisode.videoId || ""));
        const followingEpisode = nextEpisodeIndex >= 0 ? this.episodes[nextEpisodeIndex + 1] || null : null;
        this.consecutiveAutoPlayCount = userInitiated ? 0 : Number(this.consecutiveAutoPlayCount || 0) + 1;
        this.loadingVisible = true;
        this.updateLoadingVisibility();
        this.refreshLoadingOverlayPresentation();
        this.setControlsVisible(false);
        this.renderNextEpisodeCard();
        await PlayerController.flushCurrentProgress({ allowCloudSync: false });
        if (!this.isNextEpisodeLaunchActive(launchToken)) {
          return false;
        }
        void PlayerController.pushProgressIfDue?.(true);
        this.releaseCurrentEngineFsStreamBestEffort("next-episode", {
          removeTorrent: true,
          deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
        });
        await Router.navigate(
          "player",
          {
            streamUrl: bestStream,
            itemId: this.params?.itemId,
            itemType,
            imdbId: this.params?.imdbId || null,
            tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
            traktId: this.params?.traktId || this.params?.trakt_id || null,
            contentLanguage: this.contentLanguage || null,
            videoId: nextEpisode.videoId,
            season: nextEpisode.season,
            episode: nextEpisode.episode,
            episodeLabel: nextEpisode.episodeLabel || null,
            playerTitle: this.params?.playerTitle || this.params?.itemId,
            playerSubtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
            playerEpisodeTitle: nextEpisode.episodeTitle || "",
            playerBackdropUrl: this.params?.playerBackdropUrl || null,
            playerLogoUrl: this.params?.playerLogoUrl || null,
            episodes: this.episodes || [],
            streamCandidates: streamItems,
            preferredStreamId: bestStreamCandidate.id || null,
            playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
            returnToStreamOnBack: false,
            returnHomeOnBack: this.buildDetailRouteParamsFromPlayer().returnHomeOnBack,
            nextEpisodeVideoId: followingEpisode?.id || null,
            nextEpisodeLabel: followingEpisode ? `S${followingEpisode.season}E${followingEpisode.episode}` : null,
            nextEpisodeSeason: followingEpisode?.season ?? null,
            nextEpisodeEpisode: followingEpisode?.episode ?? null,
            nextEpisodeTitle: followingEpisode?.title || "",
            nextEpisodeReleased: followingEpisode?.released || "",
            consecutiveAutoPlayCount: this.consecutiveAutoPlayCount
          },
          {
            replaceHistory: true
          }
        );
        return true;
      } catch (error) {
        if (!this.isNextEpisodeLaunchActive(launchToken)) {
          return false;
        }
        console.warn("Next episode play failed", error);
        return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true, error });
      }
    },
    persistPlayerPresentationSettings() {
      PlayerSettingsStore.set({
        subtitleStyle: { ...this.subtitleStyleSettings },
        subtitleLanguage: this.subtitleStyleSettings?.preferredLanguage || "off",
        secondarySubtitleLanguage: this.subtitleStyleSettings?.secondaryPreferredLanguage || "off",
        audioAmplificationDb: Number(this.audioAmplificationDb || 0),
        persistAudioAmplification: Boolean(this.persistAudioAmplification)
      });
    },
    ensureAudioAmplificationGraph() {
      const video = PlayerController.video;
      if (!supportsTvWebAudioAmplification()) {
        this.audioAmplificationAvailable = false;
        return false;
      }
      if (!video || this.audioGainNode) {
        return Boolean(this.audioGainNode);
      }
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof AudioContextCtor !== "function") {
        return false;
      }
      try {
        this.audioContext = this.audioContext || new AudioContextCtor();
        this.audioMediaSource = this.audioMediaSource || this.audioContext.createMediaElementSource(video);
        this.audioGainNode = this.audioGainNode || this.audioContext.createGain();
        this.audioMediaSource.connect(this.audioGainNode);
        this.audioGainNode.connect(this.audioContext.destination);
        this.audioAmplificationAvailable = true;
        return true;
      } catch (_) {
        this.audioAmplificationAvailable = false;
        return false;
      }
    },
    applyAudioAmplification() {
      if (Number(this.audioAmplificationDb || 0) <= 0) {
        this.audioAmplificationAvailable =
          supportsTvWebAudioAmplification() && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
        if (this.audioGainNode) {
          try {
            this.audioGainNode.gain.value = 1;
          } catch (_) {
            // Best effort.
          }
        }
        return;
      }
      if (!this.ensureAudioAmplificationGraph()) {
        this.audioAmplificationAvailable = false;
        return;
      }
      try {
        if (this.audioContext?.state === "suspended") {
          void this.audioContext.resume().catch(() => {});
        }
        this.audioGainNode.gain.value = dbToGain(this.audioAmplificationDb);
        this.audioAmplificationAvailable = true;
      } catch (_) {
        this.audioAmplificationAvailable = false;
      }
    },
    isCurrentStreamHdr() {
      const video = PlayerController.video;
      if (video?.hdrInfo && (video.hdrInfo.gamma === "pq" || video.hdrInfo.gamma === "hlg")) {
        return true;
      }
      const candidate = this.getCurrentStreamCandidate?.() || this.getStreamCandidateByUrl?.(this.activePlaybackUrl);
      const rawStream = candidate?.raw || candidate;
      return Boolean(
        isHdrStream(rawStream) ||
        isHdrStream(this.streamCandidates?.[this.currentStreamIndex]) ||
        isHdrStream(this.streamCandidates?.[this.currentStreamIndex]?.raw) ||
        isHdrStream(this.activePlaybackUrl) ||
        isHdrStream(this.params?.streamUrl) ||
        isHdrStream(this.params?.filename) ||
        isHdrStream(this.params?.title) ||
        isHdrStream(this.params?.playerTitle) ||
        isHdrStream(this.params?.playerSubtitle) ||
        isHdrStream(this.params?.stream) ||
        isHdrStream(this.params?.streamCandidate) ||
        isHdrStream(this.params?.streamCandidate?.raw) ||
        isHdrStream(this.initialFilenameStreamCandidate) ||
        isHdrStream(this.currentEngineFsStream?.name || this.currentEngineFsStream?.filename)
      );
    },
    applySubtitlePresentationSettings({ refreshTrackRendering = false } = {}) {
      const uiRoot = this.uiRefs?.root;
      const video = PlayerController.video;
      if (!uiRoot || !video) {
        return;
      }
      const style = this.subtitleStyleSettings || {};
      const isHdr = this.isCurrentStreamHdr();
      const factor = isHdr ? getHdrBrightnessFactor(style.hdrBrightnessPreset) : 1.0;
      const hudFactor = isHdr ? getHdrHudBrightnessFactor(style.hdrBrightnessPreset) : 1.0;
      const hudWhite = isHdr && hudFactor < 1.0 ? calibrateHdrColorHex("#FFFFFF", hudFactor) : "#FFFFFF";
      const hudSecondary = isHdr && hudFactor < 1.0 ? calibrateHdrColorHex("#B3B3B3", hudFactor) : "#B3B3B3";
      const hudTertiary = isHdr && hudFactor < 1.0 ? calibrateHdrColorHex("#808080", hudFactor) : "#808080";
      const hudTrackBg = isHdr && hudFactor < 1.0
        ? `rgba(${Math.round(255 * hudFactor)}, ${Math.round(255 * hudFactor)}, ${Math.round(255 * hudFactor)}, 0.3)`
        : "rgba(255, 255, 255, 0.3)";

      uiRoot.style.setProperty("--player-hud-white", hudWhite);
      uiRoot.style.setProperty("--player-atv-text-primary", hudWhite);
      uiRoot.style.setProperty("--player-atv-text-secondary", hudSecondary);
      uiRoot.style.setProperty("--player-atv-text-tertiary", hudTertiary);
      uiRoot.style.setProperty("--player-hud-track-bg", hudTrackBg);

      if (this.container && this.container.style) {
        this.container.style.setProperty("--player-hud-white", hudWhite);
        this.container.style.setProperty("--player-atv-text-primary", hudWhite);
        this.container.style.setProperty("--player-atv-text-secondary", hudSecondary);
        this.container.style.setProperty("--player-atv-text-tertiary", hudTertiary);
        this.container.style.setProperty("--player-hud-track-bg", hudTrackBg);
      }

      const verticalOffsetVh = getSubtitleVerticalOffsetVh(style.verticalOffset);
      const residualOffsetVh = getSubtitleVerticalResidualOffsetVh(style.verticalOffset);
      const subtitleTextOpacity = normalizeSubtitleTextOpacity(style.textOpacity);
      const rawTextColor = String(style.textColor || "#FFFFFF");
      const subtitleTextColor = isHdr && factor < 1.0 ? calibrateHdrColorHex(rawTextColor, factor) : rawTextColor;
      const subtitleColor = subtitleTextColorWithOpacity(subtitleTextColor, subtitleTextOpacity);
      const rawOutlineColor = String(style.outlineColor || "#000000").trim();
      const isBlack =
        /^#0{3,6}$/i.test(rawOutlineColor) ||
        rawOutlineColor.toLowerCase() === "black" ||
        /^rgba?\(0,\s*0,\s*0(?:,\s*1)?\)$/i.test(rawOutlineColor);
      const outlineColor = isHdr && factor < 1.0 && !isBlack
        ? calibrateHdrColorHex(rawOutlineColor, factor)
        : rawOutlineColor;
      const subtitleFontWeight = style.bold ? "800" : Environment.isWebOS() ? "400" : "500";
      const boldShadow = style.bold
        ? `0.45px 0 0 ${subtitleColor}, -0.45px 0 0 ${subtitleColor}, 0 0.45px 0 ${subtitleColor}, 0 -0.45px 0 ${subtitleColor}`
        : "";
      const outlineShadow = style.outlineEnabled
        ? Environment.isWebOS()
          ? `-2px -2px 0 ${outlineColor}, 0 -2px 0 ${outlineColor}, 2px -2px 0 ${outlineColor}, -2px 0 0 ${outlineColor}, 2px 0 0 ${outlineColor}, -2px 2px 0 ${outlineColor}, 0 2px 0 ${outlineColor}, 2px 2px 0 ${outlineColor}`
          : `0 0 2px ${outlineColor}, 0 0 4px ${outlineColor}`
        : "";
      const subtitleShadow = [outlineShadow, boldShadow].filter(Boolean).join(", ") || "none";
      const htmlSubtitleShadow = Environment.isWebOS() ? outlineShadow || "none" : subtitleShadow;
      const htmlSubtitleFontFamily = Environment.isWebOS()
        ? style.bold
          ? '"NuvioSubtitleBold", "Roboto", Arial, sans-serif'
          : '"NuvioSubtitleRegular", "Roboto", Arial, sans-serif'
        : "";
      const subtitleFontSize = normalizeSubtitleFontSize(style.fontSize);
      const htmlSubtitleFontSize = formatHtmlSubtitleFontSize(subtitleFontSize);
      PlayerController.setWebOsSubtitleFontSize?.(subtitleFontSize);
      if (Environment.isTizen() && PlayerController.isUsingAvPlay?.()) {
        PlayerController.setAvPlayExternalSubtitleDelay?.(this.subtitleDelayMs);
      }
      uiRoot.style.setProperty("--player-subtitle-color", subtitleColor);
      // HTML subtitles need the alpha composited over the complete text run.
      // Applying it in rgba() makes overlapping Arabic glyphs accumulate alpha
      // on affected TV browser engines; native cues keep the Android-equivalent
      // rgba color below.
      uiRoot.style.setProperty("--player-subtitle-text-color", subtitleTextColor);
      uiRoot.style.setProperty("--player-subtitle-text-opacity", String(subtitleTextOpacity / 100));
      uiRoot.style.setProperty("--player-subtitle-background", String(style.backgroundColor || "#00000000"));
      uiRoot.style.setProperty("--player-subtitle-outline-color", outlineColor);
      uiRoot.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
      uiRoot.style.setProperty("--player-html-subtitle-font-size", htmlSubtitleFontSize);
      if (Environment.isWebOS()) {
        uiRoot.style.setProperty("--player-html-subtitle-font-family", htmlSubtitleFontFamily);
      } else {
        uiRoot.style.removeProperty("--player-html-subtitle-font-family");
      }
      uiRoot.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
      uiRoot.style.setProperty("--player-subtitle-shadow", htmlSubtitleShadow);
      uiRoot.style.setProperty("--player-subtitle-offset", `${verticalOffsetVh.toFixed(2)}vh`);
      video.style.setProperty("--player-subtitle-color", subtitleColor);
      video.style.setProperty("--player-subtitle-background", String(style.backgroundColor || "#00000000"));
      video.style.setProperty("--player-subtitle-outline-color", outlineColor);
      video.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
      video.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
      video.style.setProperty("--player-subtitle-shadow", subtitleShadow);
      video.style.setProperty("--player-subtitle-offset", `${residualOffsetVh.toFixed(2)}vh`);
      this.refreshSubtitleCueStyles();
      syncHtmlSubtitleClearance(this);
      this.renderBitmapSubtitleAtCurrentTime({ force: true });
      if (refreshTrackRendering) {
        this.refreshSubtitleTrackRendering();
      }
    }
  };
}
