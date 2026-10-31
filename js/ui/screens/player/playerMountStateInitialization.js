import { LivePlaybackWatchClock } from "./livePlaybackUi.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function initializePlayerMountState(params, initialStreamUrl) {
  const {
    aspectModeIndex,
    DeviceLocalPlayerPreferences,
    PostPlayRecommendationController,
    normalizePlayerEpisodeMetadata,
    resolvePostPlayEpisodeMetadataResolved,
    buildPendingPlaybackRestore,
    SUBTITLE_LANGUAGE_OFF_KEY,
    PLAYER_SPEEDS,
    PAUSE_OVERLAY_DELAY_MS,
    isSeriesItemType,
    createTrackDialogCache,
    createSubtitleOptionVirtualState,
    normalizeParentalWarnings
  } = internals;
  this.livePlaybackLatched = false;
  this.liveWatchClock = new LivePlaybackWatchClock();
  this.subtitles = [];
  this.embeddedSubtitleTracks = [];
  this.nextEpisodeTransitionMeta = null;
  this.subtitleDialogVisible = false;
  this.subtitleDelayOverlayVisible = false;
  this.subtitleDelayFocusTarget = "slider";
  this.subtitleDelayOverlayStatus = "";
  this.subtitleDelayOverlayTimer = null;
  this.subtitleTimingDialogVisible = false;
  this.subtitleTimingStage = "wait";
  this.subtitleAutoSyncCues = [];
  this.subtitleAutoSyncCapturedVideoMs = null;
  this.subtitleAutoSyncStatus = "";
  this.subtitleAutoSyncError = "";
  this.subtitleAutoSyncLoading = false;
  this.subtitleAutoSyncLoadedTrackKey = "";
  this.subtitleAutoSyncLoadToken = 0;
  this.subtitleAutoSyncCueFocusIndex = 0;
  this.automaticSubtitleSyncRunToken = 0;
  this.automaticSubtitleSyncTimer = null;
  this.automaticSubtitleSyncStartupKey = "";
  this.autoSyncedSubtitleUrl = "";
  this.currentAddonSubtitleSource = null;
  this.subtitleDialogTab = "builtIn";
  this.subtitleDialogIndex = 0;
  this.subtitleLanguageRailIndex = 0;
  this.subtitleOptionRailIndex = 0;
  this.subtitleStyleRailIndex = 0;
  this.subtitleStyleControlSide = "minus";
  this.subtitleFocusedRail = "language";
  this.subtitleFocusedLanguageKey = SUBTITLE_LANGUAGE_OFF_KEY;
  this.subtitleDialogScrollMode = "nearest";
  this.subtitleDialogScrollTimer = null;
  this.subtitleDialogSession = null;
  this.subtitleOptionFocusMemory = new Map();
  this.subtitleOptionVirtualState = createSubtitleOptionVirtualState();
  this.subtitleOptionVirtualMeasureTimer = null;
  this.renderedSubtitleDialogMarkup = "";
  this.selectedSubtitleTrackIndex = -1;
  this.selectedEmbeddedSubtitleTrackIndex = -1;
  this.selectedAddonSubtitleId = null;
  this.webOsAddonSubtitleRestoreRequestId = 0;
  this.pendingWebOsAddonSubtitleRestore = null;
  this.startupSubtitlePreferenceApplied = false;
  this.startupSubtitlePreferenceApplying = false;
  this.startupAudioPreferenceApplied = false;
  this.startupAudioPreferenceApplying = false;
  this.startupAudioFallbackApplied = false;
  this.startupAudioTrackSetSignature = "";
  this.startupAudioPreferenceRetryTimer = null;
  this.startupAudioPreferenceRetryDeadline = 0;
  this.startupTrackPreferenceReady = false;
  this.trackDialogCache = createTrackDialogCache();
  this.builtInSubtitleCount = 0;
  this.externalTrackNodes = [];
  this.externalSubtitleObjectUrls = [];
  this.htmlSubtitleCues = [];
  this.htmlSubtitleRenderFrame = null;
  this.htmlSubtitleRenderTimer = null;
  this.avPlaySubtitleOverlayTimer = null;
  this.htmlSubtitleActiveCueKey = "";
  this.htmlSubtitleSelectedId = null;
  this.webOsEmbeddedHtmlSubtitleTrack = null;
  this.webOsEmbeddedHtmlSubtitleCueCount = 0;
  this.webOsEmbeddedHtmlSubtitleActivationKey = "";
  this.assSubtitleRenderer = null;
  this.bitmapSubtitleDecoder = null;
  this.bitmapSubtitleTrack = null;
  this.bitmapSubtitleLoadToken = 0;
  this.bitmapSubtitleLoading = false;
  this.bitmapSubtitleWindowStart = 0;
  this.bitmapSubtitleWindowEnd = 0;
  this.bitmapSubtitleLastFrameKey = "";
  this.bitmapSubtitleLastErrorAt = 0;
  this.bitmapSubtitleScratchCanvas = null;
  this.webOsEmbeddedTextSubtitleTrack = null;
  this.webOsEmbeddedTextSubtitleLoadToken = 0;
  this.webOsEmbeddedTextSubtitleLoading = false;
  this.webOsEmbeddedTextSubtitleUsingHtml = false;
  this.webOsEmbeddedTextSubtitleUsingAss = false;
  this.webOsEmbeddedTextSubtitleWindowStart = 0;
  this.webOsEmbeddedTextSubtitleWindowEnd = 0;
  this.webOsEmbeddedTextSubtitleWindowFailureCount = 0;
  this.webOsEmbeddedTextSubtitleLastErrorAt = 0;
  this.webOsEmbeddedTextSubtitleFallbackUnavailable = false;
  this.embeddedTextSubtitleSupportNotice = "";
  this.embeddedBitmapSubtitleSupportNotice = "";
  this.subtitleCueStyleBindings = new Map();
  this.subtitleCueOriginalState = new WeakMap();
  this.embeddedSubtitleCueRefreshTimers = new Set();
  this.webOsEmbeddedCueRefreshApplied = false;

  this.audioDialogVisible = false;
  this.audioDialogIndex = 0;
  this.audioMixFocusIndex = 0;
  this.audioFocusedColumn = "tracks";
  this.selectedAudioTrackIndex = -1;
  this.embeddedAudioTracks = [];
  this.selectedEmbeddedAudioTrackIndex = -1;
  this.audioFallbackApplying = false;
  this.pendingWebOsAudioSelection = null;
  this.failedAutomaticAudioFallbackEntryId = "";

  this.sourcesPanelVisible = false;
  this.sourcesLoading = false;
  this.sourcesError = "";
  this.sourceFilter = "all";
  this.sourcesFocus = { zone: "filter", index: 0 };
  this.sourceLoadToken = 0;
  this.sourceLoadAbortController = null;
  this.completedSourceRequestKey = "";
  this.sourcePanelRenderFrame = null;
  this.sourcePanelRenderFrameType = null;
  this.sourcesLastNavigationRepeatAt = 0;
  this.renderedSourcesMarkup = null;
  this.streamCandidatesByVideoId = new Map();
  this.streamCandidatesLoadPromises = new Map();

  this.aspectModeIndex = aspectModeIndex(DeviceLocalPlayerPreferences.getAspectMode());
  this.aspectToastTimer = null;
  this.speedDialogVisible = false;
  this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.indexOf(1));

  this.postPlayEpisodeMetadataProvided = Array.isArray(params.episodes);
  this.episodes = isSeriesItemType(params?.itemType || "movie")
    ? normalizePlayerEpisodeMetadata(params.episodes, { fallbackSeason: params?.season })
    : this.postPlayEpisodeMetadataProvided
      ? params.episodes
      : [];
  this.postPlayEpisodeMetadataResolved = resolvePostPlayEpisodeMetadataResolved({
    explicitResolution: params.nextEpisodeMetadataResolved,
    episodes: this.episodes,
    nextEpisodeVideoId: params.nextEpisodeVideoId
  });
  this.episodePanelVisible = false;
  const explicitEpisodeIndex = this.episodes.findIndex((entry) => entry.id === params.videoId);
  const fallbackEpisodeIndex = this.episodes.findIndex((entry) => {
    const seasonMatch = params.season == null || Number(entry?.season) === Number(params.season);
    const episodeMatch = params.episode == null || Number(entry?.episode) === Number(params.episode);
    return seasonMatch && episodeMatch;
  });
  this.episodePanelIndex = Math.max(0, explicitEpisodeIndex >= 0 ? explicitEpisodeIndex : fallbackEpisodeIndex);
  this.episodePanelFocusZone = "episodes";
  this.episodePanelSeason = null;
  this.episodePanelSeasonIndex = 0;
  this.episodePanelMode = "episodes";
  this.episodePanelStreams = [];
  this.episodePanelStreamsLoading = false;
  this.episodePanelStreamsError = "";
  this.episodePanelStreamFilter = "all";
  this.episodePanelStreamFocus = { zone: "actions", index: 0 };
  this.episodePanelStreamVideoId = "";
  this.episodePanelStreamLoadToken = 0;
  this.episodePanelExitTimer = null;
  this.switchingEpisode = false;

  this.seekOverlayVisible = false;
  this.seekPreviewSeconds = null;
  this.seekPreviewDirection = 0;
  this.seekRepeatCount = 0;
  this.seekCommitTimer = null;
  this.seekOverlayTimer = null;
  this.seekOverlaySuppressControlsUntil = 0;
  this.pauseOverlayVisible = false;
  this.pauseOverlayTimer = null;
  this.pauseOverlayDelayMs = PAUSE_OVERLAY_DELAY_MS;
  this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0);
  this.pauseOverlayMeta = null;
  this.nextEpisodeLaunching = false;
  this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
  this.nextEpisodeCardTriggered = false;
  this.nextEpisodeCardRenderedKey = "";
  this.nextEpisodeCardSearching = false;
  this.nextEpisodeCardSourceName = "";
  this.nextEpisodeCardCountdownSec = null;
  this.nextEpisodeAutoplayAttemptedKey = "";
  this.consecutiveAutoPlayCount = Math.max(0, Math.trunc(Number(params.consecutiveAutoPlayCount || 0) || 0));
  this.stillWatchingPromptVisible = false;
  this.stillWatchingPromptCountdownSec = 0;
  this.stillWatchingPromptTimer = null;
  this.stillWatchingPromptFocusArmed = false;
  this.stillWatchingPromptFocus = "continue";
  this.playerBackNavigationInProgress = false;
  this.nextEpisodeCardDismissed = false;
  this.nextEpisodeBackExitArmed = false;
  this.postPlayPlaybackEnded = false;
  this.postPlayNaturalEndPending = false;
  this.postPlayNaturalCompletionPrepared = false;
  this.postPlayDescriptionTruncated = false;
  this.postPlayFocusedAction = "primary";
  this.postPlayPendingSelect = false;
  this.postPlayPendingSelectAction = "";
  this.postPlayLastRecommendationIndex = -1;
  this.postPlayLastVisible = false;
  this.postPlayLastTrailerPlaying = false;
  this.postPlayRenderedSignature = "";
  this.postPlayBackdropTransitionTimer = null;
  this.postPlaySummaryTransitionTimer = null;
  this.postPlayTrailerActionTransitionFrame = null;
  this.postPlayTrailerLabelTimer = null;
  this.postPlayPlayerSurfaceStateKey = "";
  this.postPlayPlayerSurfaceAnimationFrame = null;
  this.postPlayPlayerSurfaceAnimationUsesRaf = false;
  this.postPlayPlayerSurfaceRect = null;
  this.postPlayTrailerMedia = null;
  this.postPlayTrailerMessageHandler = null;
  this.postPlayTrailerGeneration = 0;
  this.postPlayTrailerExitTimer = null;
  this.postPlayFocusTimer = null;
  this.postPlayDescriptionMeasureFrame = null;
  this.postPlayManualDialogVisible = false;
  this.postPlaySynopsisVisible = false;
  this.postPlaySynopsisScrollFrame = null;
  this.postPlaySynopsisScrollTarget = null;
  this.postPlaySynopsisScrollPreviousFrameAt = 0;
  this.postPlayLongPressTimer = null;
  this.postPlayLongPressTriggered = false;
  this.postPlayRecommendationController?.stop?.();
  this.postPlayRecommendationController = new PostPlayRecommendationController({
    onStateChange: (state) => this.onPostPlayRecommendationStateChange(state),
    onStartTrailer: (recommendation, options) => this.startPostPlayTrailer(recommendation, options),
    onStopTrailer: () => this.stopPostPlayTrailer()
  });

  // Match Android: only show localized warnings resolved by the parental guide API.
  this.parentalWarnings = [];
  this.parentalGuideVisible = false;
  this.parentalGuideExiting = false;
  this.parentalGuideShown = false;
  this.parentalGuideTimer = null;
  this.parentalGuideExitTimer = null;
  this.parentalGuideLineEnterTimer = null;
  this.parentalGuideLineExitTimer = null;
  this.parentalGuideLineAnimationFrame = null;
  this.parentalGuideLineProgress = 0;
  this.skipIntervals = [];
  this.activeSkipInterval = null;
  this.skipIntervalDismissed = false;
  this.skipIntroAutoHidden = false;
  this.skipIntroCountdownProgress = 0;
  this.skipIntroCountdownLastTickAt = 0;
  this.skipIntroCountdownStartAt = 0;
  this.skipIntroAnimationFrame = null;
  this.skipIntroFocusFrame = null;
  this.skipIntroRenderedKey = "";
  this.skipIntroSuppressedKey = "";
  this.skipIntroSuppressedUntil = 0;
  this.lastActionOverlayBottomPx = null;
  this.subtitleSelectionTimer = null;
  this.subtitleSelectionToken = 0;
  this.subtitleLoadToken = 0;
  this.subtitleLoading = false;
  this.embeddedSubtitleLoadToken = 0;
  this.embeddedSubtitleLoading = false;
  this.embeddedAudioLoading = false;
  this.initialEmbeddedTrackBootstrapPromise = null;
  this.embeddedTrackRequestPromise = null;
  this.embeddedTrackRequestUrl = "";
  this.lastEmbeddedTrackProbeUrl = "";
  this.lastEmbeddedTrackRetryAt = 0;
  this.manifestLoadToken = 0;
  this.manifestLoadAbortController = null;
  this.manifestLoading = false;
  this.manifestAudioTracks = [];
  this.manifestSubtitleTracks = [];
  this.manifestVariants = [];
  this.manifestMasterUrl = "";
  this.selectedManifestAudioTrackId = null;
  this.selectedManifestSubtitleTrackId = null;
  this.hlsManifestSubtitlePromotionUrls = new Set();
  this.activePlaybackUrl = initialStreamUrl || null;
  this.pendingPlaybackRestore = buildPendingPlaybackRestore(params);
  this.trackDiscoveryToken = 0;
  this.trackDiscoveryInProgress = false;
  this.trackDiscoveryTimer = null;
  this.trackDiscoveryStartedAt = 0;
  this.trackDiscoveryDeadline = 0;
  this.lastTrackWarmupAt = 0;
  this.silentAudioFallbackAttempts = new Set();
  this.silentAudioFallbackCount = 0;
  this.maxSilentAudioFallbackCount = 1;
  this.lastPlaybackErrorAt = 0;
  this.failedPlaybackUrls = new Set();
  this.failedPlaybackStreamIds = new Set();
  this.playbackStallTimer = null;
  this.playbackEngineValidationEngine = "";
  this.playbackEngineValidationStartedAt = 0;
  this.playbackEngineValidationStartSeconds = null;
  this.playbackEngineValidationLastSeconds = null;
  this.playbackEngineValidationProgressSeconds = 0;
  this.playbackEngineValidated = false;
  this.postValidationRecoveryValidationActive = false;
  this.postValidationSameEngineRecoveryAttempts = 0;
  this.engineFsStartupRetryTimer = null;
  this.engineFsStartupErrorRetries = 0;
  this.engineFsStallExtensions = 0;
  this.webOsNativeStartupLoadingExtended = false;
  this.webOsNativeReadyStartupRetries = 0;
  this.playbackRecoveryActive = false;
  this.playbackRecoveryAttempts = 0;
  this.tizenAvPlayConnectionRetryAttempts = 0;
  this.tizenAvPlayConnectionRetryTimer = null;
  this.tizenAvPlayConnectionRetryBudgetResetTimer = null;
  this.lastEngineFsStallStats = null;
  this.lastEngineFsStartupErrorStats = null;
  this.engineFsKeepAliveHandle = null;
  this.engineFsKeepAliveToken = "";
  this.engineFsRemovalRequests = new Map();
  this.engineFsPlaybackToken = "";
  this.playerExitCleanupHandler = null;
  this.lastPlaybackProgressAt = Date.now();
  this.hasPresentedPlaybackFrame = false;
  this.startupErrorMessage = "";
  this.startupErrorMediaCode = 0;
  this.startupErrorDetails = [];
  this.startupPlaybackBaselineSeconds = null;
  this.startupPlaybackHasAdvanced = false;
  this.paused = false;
  this.controlsVisible = true;
  this.loadingVisible = true;
  this.bufferingActive = false;
  this.loadingProgress = null;
  this.loadingLogoFillActive = false;
  this.loadingLogoFillProgress = 0;
  this.loadingLogoFillTarget = 0;
  this.loadingLogoFillFrame = null;
  this.loadingTorrentStatus = "";
  this.torrentOverlayData = null;
  this.loadingProgressRefreshInFlight = false;
  this.seekLoading = false;
  this.seekLoadingBaselineSeconds = null;
  this.seekLoadingTargetSeconds = null;
  this.startupAudioGateActive = false;
  this.startupAudioGateAllowsNativePlayback = false;
  this.startupAudioGateDeadline = 0;
  this.loadingCompletionTimer = null;
  this.loadingCompletionToken = 0;
  this.bufferingSpinnerTimer = null;
  this.bufferingSpinnerBaselineSeconds = null;
  this.moreActionsVisible = false;
  this.controlFocusZone = "buttons";
  this.stickyProgressFocus = false;
  this.autoHideControlsAfterSeek = false;
  this.controlFocusIndex = 0;
  this.controlsHideTimer = null;
  this.tickTimer = null;
  this.skipIntervalCheckTimer = null;
  this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0);
  this.videoListeners = [];
  this.mediaSessionHandlersBound = false;
  this.mediaSessionActions = [];
}
