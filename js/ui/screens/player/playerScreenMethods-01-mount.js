import { canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
import { loadPlayerShuffleWatched } from "./playerEpisodeShuffle.js";
import { activeStreamLinkProfile } from "../../../data/local/streamLinkCacheStore.js";
/* global __NUVIO_APP_VERSION__ */
import * as internals from "./playerScreenContext.js";
import { initializePlayerMountState } from "./playerMountStateInitialization.js";

export function createPlayerScreenMethods01() {
  const {
    PlayerController,
    shouldAllowNativePlaybackDuringStartupAudioGate,
    ASPECT_MODE_DEFINITIONS,
    ensureWebOsImageProxyReady,
    onWebOsImageProxyReady,
    streamRepository,
    PlayerSettingsStore,
    Environment,
    DirectDebridResolver,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    WebOsLunaService,
    TrackPreferencesStore,
    SubtitleDelayPreferencesStore,
    WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS,
    claimEngineFsPlayback,
    AUDIO_AMPLIFICATION_MIN_DB,
    AUDIO_AMPLIFICATION_MAX_DB,
    t,
    normalizeSubtitleRenderMode,
    resolveRouteContentLanguage,
    clamp,
    extractSubtitleLanguageSetting,
    supportsTvWebAudioAmplification,
    directPlaybackUrl,
    streamDirectPlaybackUrl
  } = internals;

  return {
    async mount(params = {}, navigationContext = {}) {
      streamRepository.setLocalPluginSearchPaused(false);
      this.container = document.getElementById("player");
      this.container.style.display = "block";
      this.container.classList.toggle("player-platform-webos", Environment.isWebOS());
      const mountToken = Number(this.playerMountToken || 0) + 1;
      this.playerMountToken = mountToken;
      this.shuffleNextCache = null;
      this.shuffleRemoteWatched = new Set();
      this.playerRouteActive = true;
      this.webOsClockLocaleInfo = null;
      this.webOsClockSettingsSubscription?.cancel?.();
      this.webOsClockSettingsSubscription = null;
      if (Environment.isWebOS() && WebOsLunaService.isAvailable()) {
        try {
          this.webOsClockSettingsSubscription = WebOsLunaService.subscribe("luna://com.webos.settingsservice", {
            method: "getSystemSettings",
            parameters: { keys: ["localeInfo"] },
            onSuccess: (result) => {
              if (!this.playerRouteActive || this.playerMountToken !== mountToken) {
                return;
              }
              const localeInfo = result?.settings?.localeInfo;
              if (!localeInfo || typeof localeInfo !== "object") {
                return;
              }
              this.webOsClockLocaleInfo = localeInfo;
              if (this.lastUiTickState) {
                this.lastUiTickState.clockMinuteKey = null;
                this.lastUiTickState.endsAtMinuteBucket = null;
              }
              this.updateUiTick();
            }
          });
        } catch (_) {
          this.webOsClockSettingsSubscription = null;
        }
      }
      this.params = params;
      this.streamLinkCacheProfileId = activeStreamLinkProfile();
      this.trackPreferenceContentId = this.getTrackPreferenceContentId();
      this.subtitleDelayPreferenceVideoId = this.getSubtitleDelayPreferenceVideoId();
      this.rememberedAudioTrackPreference = TrackPreferencesStore.getAudio(this.trackPreferenceContentId);
      this.rememberedSubtitleTrackPreference = TrackPreferencesStore.getSubtitle(this.trackPreferenceContentId);
      if (Environment.isWebOS()) {
        void PlayerController.refreshWebOsDeviceInfo?.();
      }
      this.contentLanguage = resolveRouteContentLanguage(params);
      this.externalFrameUrl = String(params.externalFrameUrl || "").trim();
      if (this.releaseImageProxyReadyListener) {
        this.releaseImageProxyReadyListener();
        this.releaseImageProxyReadyListener = null;
      }
      if (Environment.isWebOS()) {
        this.releaseImageProxyReadyListener = onWebOsImageProxyReady(() => {
          this.renderControlButtons();
          void this.preloadPlayerSourceLogos();
          this.scheduleSourceLogoRender();
        });
        void ensureWebOsImageProxyReady();
      }

      this.aspectModes = ASPECT_MODE_DEFINITIONS.map((definition) => ({
        ...definition,
        label: t(definition.labelKey, {}, definition.fallbackLabel)
      }));

      this.streamCandidates = this.normalizeStreamCandidates(Array.isArray(params.streamCandidates) ? params.streamCandidates : []);
      const preferredStreamId = String(params?.preferredStreamId || "").trim();
      const preferredStreamCandidate = preferredStreamId
        ? this.streamCandidates.find((stream) => String(stream?.id || "") === preferredStreamId) || null
        : null;
      const initialStreamCandidate = preferredStreamCandidate || this.selectBestStreamCandidate(this.streamCandidates);
      const initialStreamLocator = params.streamUrl || initialStreamCandidate?.url || initialStreamCandidate?.externalUrl || null;
      const initialStreamUrl = directPlaybackUrl(params.streamUrl) || streamDirectPlaybackUrl(initialStreamCandidate);
      if (!this.streamCandidates.length && initialStreamLocator) {
        this.streamCandidates = this.normalizeStreamCandidates([
          {
            url: initialStreamLocator,
            title: "Current source",
            addonName: "Current",
            isSynthetic: true
          }
        ]);
      }

      this.currentStreamIndex = this.streamCandidates.findIndex(
        (stream) =>
          (preferredStreamCandidate && String(stream?.id || "") === String(preferredStreamCandidate.id || "")) ||
          stream.url === initialStreamLocator ||
          stream.externalUrl === initialStreamLocator ||
          (initialStreamUrl && streamDirectPlaybackUrl(stream) === initialStreamUrl)
      );
      if (this.currentStreamIndex < 0) {
        this.currentStreamIndex = 0;
      }
      this.initialFilenameStreamCandidate = this.streamCandidates[this.currentStreamIndex] || null;
      // Remember the stream that actually plays so the stream list can focus it on
      // the next visit. Only persist when the caller provided a real candidate list
      // (this skips trailers and synthetic single-url playback).
      if (Array.isArray(params.streamCandidates) && params.streamCandidates.length) {
        const playingStreamCandidate = this.streamCandidates[this.currentStreamIndex] || null;
        this.rememberSelectedStreamPreference(playingStreamCandidate);
      }
      this.activePlaybackSourceContext =
        this.getPlaybackSourceContext(
          preferredStreamCandidate || initialStreamCandidate || this.streamCandidates[this.currentStreamIndex] || null
        ) || this.normalizePlaybackSourceContext(params.playbackSourceContext || params.sourceContext || null);
      this.currentEngineFsStream = null;
      this.engineFsCleanupInFlight = new Set();

      initializePlayerMountState.call(this, params, initialStreamUrl);
      const playerSettings = PlayerSettingsStore.get();
      this.subtitleRenderMode = normalizeSubtitleRenderMode(playerSettings.subtitleRenderMode);
      this.subtitleDelayMs = SubtitleDelayPreferencesStore.get(this.subtitleDelayPreferenceVideoId);
      this.subtitleStyleSettings = {
        ...playerSettings.subtitleStyle,
        preferredLanguage: extractSubtitleLanguageSetting(
          playerSettings.subtitleStyle?.preferredLanguage || playerSettings.subtitleLanguage || "off"
        ),
        secondaryPreferredLanguage: extractSubtitleLanguageSetting(
          playerSettings.subtitleStyle?.secondaryPreferredLanguage || playerSettings.secondarySubtitleLanguage || "off"
        )
      };
      this.audioAmplificationDb = clamp(
        Number(playerSettings.audioAmplificationDb || 0),
        AUDIO_AMPLIFICATION_MIN_DB,
        AUDIO_AMPLIFICATION_MAX_DB
      );
      this.persistAudioAmplification = Boolean(playerSettings.persistAudioAmplification);
      this.audioAmplificationAvailable =
        supportsTvWebAudioAmplification() && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
      this.audioContext = null;
      this.audioGainNode = null;
      this.audioMediaSource = null;

      this.renderPlayerUi();
      this.bindPlayerExitCleanup();
      if (!this.isExternalFrameMode()) {
        this.bindParty(navigationContext);
        this.loadPartyProfile();
      }
      this.pauseOverlayMeta = this.buildPauseOverlayMeta();
      if (!this.isExternalFrameMode()) {
        this.bindVideoEvents();
        this.bindMediaSessionHandlers();
        this.applyAudioAmplification();
        this.applySubtitlePresentationSettings();
        void this.fetchParentalGuide();
        void this.fetchSkipIntervals();
        void this.hydratePauseOverlayMeta();
        void loadPlayerShuffleWatched(this, mountToken);
        void this.loadPostPlayEpisodeMetadata(mountToken);
      }
      this.renderEpisodePanel();
      this.applyAspectMode({ showToast: false });
      if (!this.isExternalFrameMode()) {
        this.updateUiTick();
      }

      if (initialStreamUrl && !this.isExternalFrameMode()) {
        const sourceCandidate = this.getStreamCandidateByUrl(initialStreamUrl) || this.getCurrentStreamCandidate();
        this.activePlaybackUrl = initialStreamUrl;
        this.currentEngineFsStream = this.getEngineFsStateForStream(sourceCandidate);
        const prioritizeWebOsRemoteMkvPlayback =
          Environment.isWebOS() && !this.currentEngineFsStream && this.isCurrentSourceLikelyMkv(initialStreamUrl, sourceCandidate);
        const allowNativePlaybackDuringStartupAudioGate = shouldAllowNativePlaybackDuringStartupAudioGate({
          isHlsPlayback: this.isCurrentSourceLikelyHls(initialStreamUrl, sourceCandidate),
          isPrioritizedWebOsRemoteMkvPlayback: prioritizeWebOsRemoteMkvPlayback
        });
        if (prioritizeWebOsRemoteMkvPlayback) {
          // The probe must start only after webOS has accepted the media request,
          // but startup preference checks must already know discovery is pending.
          this.trackDiscoveryInProgress = true;
        }
        if (this.currentEngineFsStream) {
          this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
          this.releaseStartupAudioGate({ resume: false });
          this.startEngineFsKeepAlive(this.currentEngineFsStream);
        } else {
          this.engineFsPlaybackToken = "";
          this.enableStartupAudioGate({
            allowNativePlayback: allowNativePlaybackDuringStartupAudioGate,
            maxWaitMs: prioritizeWebOsRemoteMkvPlayback ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS : 0
          });
        }
        const playbackStartPromise = this.startPlayerControllerPlayback(
          this.activePlaybackUrl,
          this.buildPlaybackContext(sourceCandidate),
          { mountToken, sourceCandidate }
        );
        if (prioritizeWebOsRemoteMkvPlayback) {
          await playbackStartPromise;
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
        }
        this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
        this.startTrackDiscoveryWindow({
          durationMs: prioritizeWebOsRemoteMkvPlayback ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS : 7000
        });
        this.schedulePlaybackStallGuard();
      } else if (!this.isExternalFrameMode()) {
        const sourceCandidate = initialStreamCandidate || this.getCurrentStreamCandidate();
        if (
          sourceCandidate &&
          (canResolveMediaServerStream(sourceCandidate) ||
            DirectDebridResolver.canResolveStream(sourceCandidate) ||
            WebOsEngineFsResolver.canResolveStream(sourceCandidate) ||
            TizenStreamingServerResolver.canResolveStream(sourceCandidate))
        ) {
          void this.playStreamCandidate(sourceCandidate, {
            preservePendingRestore: true,
            mountToken
          });
        }
      }

      if (!this.isExternalFrameMode()) {
        this.loadSubtitles();
        this.syncTrackState();
        this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
        this.startSkipIntervalCheckTimer();
        this.endedHandler = () => {
          if (PlayerController.isLivePlaybackItemType?.()) {
            return;
          }
          this.handlePlaybackEnded();
        };
        PlayerController.video?.addEventListener("ended", this.endedHandler);
        this.setControlsVisible(true, { focus: true });
      } else {
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        this.setControlsVisible(false);
      }
    }
  };
}
