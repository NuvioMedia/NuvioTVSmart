import { PlayerController } from "../../../core/player/playerController.js";

import {
  audioTrackLabelConflictsWithCodec,
  formatAudioCodecName,
  getAuthoritativeAudioCodecValue,
  getAudioTrackCodecCompatibilityText,
  getAudioTrackLabelPrefix,
  mapAudioTrackNativeIndexes
} from "../../../core/player/audioTrackCodecMetadata.js";

import {
  canReleasePlayingNativeStartupAudioGate,
  hasOnlyImplicitStartupAudioOptions,
  selectStartupAudioFallbackOption,
  shouldAllowNativePlaybackDuringStartupAudioGate
} from "../../../core/player/startupAudioGatePolicy.js";

import {
  isRecoverableHlsFragmentTimeout,
  isExpiredStreamUrl,
  isTerminalHlsHttpStatus
} from "../../../core/player/hlsNetworkErrorPolicy.js";

import { deltaMsForKeyRepeat } from "../../../core/player/playerScrubRates.js";

import {
  ASPECT_MODE_DEFINITIONS,
  aspectModeIndex,
  normalizeAspectMode,
  parseAspectRatio,
  resolveAspectRender
} from "../../../core/player/playerAspect.js";

import { buildClockFormatOptions, resolveSystemHour12 } from "../../../core/player/clockFormat.js";

import { calculateRemainingPlaybackMilliseconds } from "../../../core/player/playbackEndTime.js";

import { resolveSubtitleStyleControlAvailability } from "../../../core/player/subtitlePresentationCapabilities.js";

import { shouldTreatAsNaturalPlaybackCompletion } from "../../../core/player/naturalPlaybackCompletion.js";

import { ensureWebOsImageProxyReady, normalizeImageUrl, onWebOsImageProxyReady } from "../../../core/media/imageProxy.js";

import {
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoUrl,
  preloadAddonLogoImages,
  requestAddonLogo
} from "../../../core/media/addonLogoCache.js";

import { localMediaTracksRepository } from "../../../data/repository/localMediaTracksRepository.js";

import { localMediaSubtitleRepository } from "../../../data/repository/localMediaSubtitleRepository.js";

import { localMediaBitmapSubtitleRepository } from "../../../data/repository/localMediaBitmapSubtitleRepository.js";

import { localMediaEmbeddedSubtitleRepository } from "../../../data/repository/localMediaEmbeddedSubtitleRepository.js";

import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";

import { streamRepository } from "../../../data/repository/streamRepository.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { parentalGuideRepository } from "../../../data/repository/parentalGuideRepository.js";

import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import { DeviceLocalPlayerPreferences } from "../../../data/local/deviceLocalPlayerPreferences.js";

import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";

import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";

import { matchStreamBadges } from "../../../core/streams/streamBadgeRules.js";

import { hasReleaseToken } from "../../../core/streams/releaseToken.js";

import { isAutoPlayEffectivelyEnabled, selectAutoPlayStream } from "../../../core/streams/streamAutoPlaySelector.js";

import { orderStreamsByAddonOrder } from "../../../core/streams/streamOrdering.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { I18n } from "../../../i18n/index.js";

import { Environment } from "../../../platform/environment.js";

import { TizenCapabilities } from "../../../platform/tizen/tizenCapabilities.js";

import { Router } from "../../navigation/routerState.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";

import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";

import { TrackingScrobbleService } from "../../../data/repository/trackingScrobbleService.js";

import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";

import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";

import { TizenEngineFsService } from "../../../platform/tizen/tizenEngineFsService.js";

import { requestWebOsCompanionService, subscribeWebOsCompanionService } from "../../../platform/webos/webosCompanionService.js";

import { WebOsLunaService } from "../../../platform/webos/webosLunaService.js";

import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";

import { TrackPreferencesStore } from "../../../data/local/trackPreferencesStore.js";

import { SubtitleDelayPreferencesStore } from "../../../data/local/subtitleDelayPreferencesStore.js";

import {
  SUBTITLE_AUTO_SYNC_MARGIN_MS,
  SUBTITLE_AUTO_SYNC_MAX_VISIBLE_CUES,
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
  SUBTITLE_DELAY_OVERLAY_TIMEOUT_MS,
  SUBTITLE_DELAY_STEP_MS,
  calculateSubtitleAutoSyncDelayMs,
  formatSubtitleAutoSyncDelay,
  formatSubtitleAutoSyncTimestamp,
  sanitizeSubtitleAutoSyncCueText,
  selectSubtitleAutoSyncVisibleCues
} from "../../../core/player/subtitleAutoSync.js";

import { buildSubtitleRequestHeaders } from "../../../core/player/subtitleRequestHeaders.js";

import { normalizeSubtitleLanguageAlias } from "../../../core/player/subtitleLanguageAliases.js";

import { mdbListRatingIcon } from "../../../core/util/mdbListRatingStatus.js";

import {
  hasEpisodeAired as hasEpisodeAiredRule,
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard as shouldShowNextEpisodeCardRule
} from "./playerNextEpisodeRules.js";

import {
  findActiveSkipInterval as findActiveSkipIntervalRule,
  findFollowingPostCreditsScene,
  getSkipIntervalTargetSeconds
} from "../../../core/player/skipIntervalRules.js";

import { normalizePlaybackDisplayLineBreaks, resolvePlaybackSourceName } from "./playbackDisplayText.js";

import { formatHeroRuntime } from "../detail/episodeCardMetadata.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { contentTextDirection } from "../../../core/util/contentTextDirection.js";

import {
  buildInlineYoutubePlayerUrl,
  PostPlayRecommendationController,
  POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED
} from "./postPlayRecommendationController.js";

import { normalizePlayerEpisodeMetadata, resolvePostPlayEpisodeMetadataResolved } from "../../../core/player/playerEpisodeMetadata.js";

import {
  buildHtmlSubtitleCue,
  getSubtitleAssAlignment,
  getSubtitleAssAlignmentSettings,
  parseVttCueLayout
} from "../../../core/player/subtitleCueLayout.js";

import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP,
  formatSubtitleVerticalOffset,
  getSubtitleVerticalOffsetVh,
  getSubtitleVerticalResidualOffsetVh,
  normalizeSubtitleVerticalOffset,
  splitSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

import {
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity,
  subtitleTextColorWithOpacity
} from "../../../core/player/subtitleTextOpacity.js";

import {
  isHdrStream,
  getHdrBrightnessFactor,
  getHdrHudBrightnessFactor,
  calibrateHdrColorHex,
  getHdrBitmapLut,
  HDR_BRIGHTNESS_PRESETS,
  HDR_PRESET_ORDER,
  getHdrPresetLabelKey,
  getHdrPresetDefaultFallback,
  normalizeHdrBrightnessPreset
} from "../../../core/player/hdrColorCalibration.js";

import {
  BitmapSubtitleDecoder,
  normalizeBitmapSubtitleFormat,
  supportsBitmapSubtitleDecoding,
  warmBitmapSubtitleDecoder
} from "../../../core/player/bitmapSubtitleDecoder.js";

import { isAssSubtitle, convertAssBodyToVtt } from "../../../core/player/assSubtitle.js";

import { createAssRenderer } from "../../../core/player/assRenderer.js";

import { decodeSubtitleResponseBody } from "../../../core/player/subtitleCharsetDetector.js";

import { sanitizeSubtitleMojibake } from "../../../core/player/subtitleMojibakeSanitizer.js";

import {
  SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  SUBTITLE_VIRTUALIZATION_MIN_WINDOW,
  SUBTITLE_VIRTUALIZATION_OVERSCAN_PX,
  SUBTITLE_VIRTUALIZATION_THRESHOLD,
  buildSubtitleVirtualModel,
  getSubtitleScrollTopForIndex,
  getSubtitleVirtualWindow
} from "./subtitleVirtualizer.js";

import { CLOCK_FORMATTER_CACHE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LANGUAGE_DISPLAY_NAME_CACHE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { BUFFERING_SPINNER_STALL_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LOADING_LOGO_FILL_TARGET_LERP } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LOADING_LOGO_FILL_IDLE_STEP } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LOADING_LOGO_FILL_FRAME_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { STARTUP_AUDIO_PREFERENCE_RETRY_INTERVAL_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { WEBOS_HLS_REBUFFER_STALL_TIMEOUT_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { TIZEN_NATIVE_HLS_STARTUP_STALL_TIMEOUT_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { PLAYBACK_ENGINE_VALIDATION_WINDOW_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { PLAYBACK_ENGINE_VALIDATION_MAX_PROGRESS_GAP_SECONDS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { POST_VALIDATION_SAME_ENGINE_RECOVERY_MAX_ATTEMPTS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { SOURCE_NAVIGATION_REPEAT_THROTTLE_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { EPISODE_PANEL_TRANSITION_MS } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { activeEngineFsPlaybackClaims } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { deferredEngineFsRemovalTimers } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { isBackEvent } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { isSelectKeyCode } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { logEngineFsDebug } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { isLocalEngineFsUrl } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { getP2pInfoHash } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { buildPendingPlaybackRestore } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { getEngineFsClaimKey } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { createEngineFsClaimToken } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { clearDeferredEngineFsRemoval } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { claimEngineFsPlayback } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { releaseEngineFsPlaybackClaim } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { hasActiveEngineFsPlaybackClaim } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { scheduleDeferredEngineFsRemoval } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { AUDIO_TRACK_LANGUAGE_KEY_BY_CODE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LANGUAGE_DISPLAY_OVERRIDES } from "./playerScreenHelpers-01-clock-formatter-cache.js";

import { LANGUAGE_CODE_ALIASES } from "./playerScreenHelpers-02-language-code-aliases.js";

import { LANGUAGE_NAME_ALIASES } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_LANGUAGE_OFF_KEY } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_LANGUAGE_UNKNOWN_KEY } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_TEXT_COLORS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_OUTLINE_COLORS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_FONT_STEP } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SUBTITLE_VERTICAL_OFFSET_STEP } from "./playerScreenHelpers-02-language-code-aliases.js";

import { AUDIO_AMPLIFICATION_MIN_DB } from "./playerScreenHelpers-02-language-code-aliases.js";

import { AUDIO_AMPLIFICATION_MAX_DB } from "./playerScreenHelpers-02-language-code-aliases.js";

import { PLAYER_SPEEDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { NEXT_EPISODE_PREFETCH_PERCENT } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SKIP_INTERVAL_CHECK_MS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { SKIP_INTERVAL_SEEK_SUPPRESSION_MS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { BITMAP_SUBTITLE_WINDOW_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { BITMAP_SUBTITLE_PREFETCH_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS } from "./playerScreenHelpers-02-language-code-aliases.js";

import { PARENTAL_GUIDE_ROW_HEIGHT } from "./playerScreenHelpers-02-language-code-aliases.js";

import { PARENTAL_GUIDE_ROW_GAP } from "./playerScreenHelpers-02-language-code-aliases.js";

import { PAUSE_OVERLAY_DELAY_MS } from "./playerScreenHelpers-02-language-code-aliases.js";

export {
  PlayerController,
  audioTrackLabelConflictsWithCodec,
  formatAudioCodecName,
  getAuthoritativeAudioCodecValue,
  getAudioTrackCodecCompatibilityText,
  getAudioTrackLabelPrefix,
  mapAudioTrackNativeIndexes,
  canReleasePlayingNativeStartupAudioGate,
  hasOnlyImplicitStartupAudioOptions,
  selectStartupAudioFallbackOption,
  shouldAllowNativePlaybackDuringStartupAudioGate,
  isRecoverableHlsFragmentTimeout,
  isExpiredStreamUrl,
  isTerminalHlsHttpStatus,
  deltaMsForKeyRepeat,
  ASPECT_MODE_DEFINITIONS,
  aspectModeIndex,
  normalizeAspectMode,
  parseAspectRatio,
  resolveAspectRender,
  buildClockFormatOptions,
  resolveSystemHour12,
  calculateRemainingPlaybackMilliseconds,
  resolveSubtitleStyleControlAvailability,
  shouldTreatAsNaturalPlaybackCompletion,
  ensureWebOsImageProxyReady,
  normalizeImageUrl,
  onWebOsImageProxyReady,
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoUrl,
  preloadAddonLogoImages,
  requestAddonLogo,
  localMediaTracksRepository,
  localMediaSubtitleRepository,
  localMediaBitmapSubtitleRepository,
  localMediaEmbeddedSubtitleRepository,
  subtitleRepository,
  streamRepository,
  addonRepository,
  parentalGuideRepository,
  skipIntroRepository,
  PlayerSettingsStore,
  DeviceLocalPlayerPreferences,
  StreamBadgeSettingsStore,
  TorrentSettingsStore,
  matchStreamBadges,
  hasReleaseToken,
  isAutoPlayEffectivelyEnabled,
  selectAutoPlayStream,
  orderStreamsByAddonOrder,
  metaRepository,
  I18n,
  Environment,
  TizenCapabilities,
  Router,
  renderLoadingIndicator,
  DirectDebridResolver,
  DebridStreamPresentation,
  TrackingScrobbleService,
  WebOsEngineFsResolver,
  TizenStreamingServerResolver,
  TizenEngineFsService,
  requestWebOsCompanionService,
  subscribeWebOsCompanionService,
  WebOsLunaService,
  StreamPreferencesStore,
  buildStreamResumeIdentity,
  TrackPreferencesStore,
  SubtitleDelayPreferencesStore,
  SUBTITLE_AUTO_SYNC_MARGIN_MS,
  SUBTITLE_AUTO_SYNC_MAX_VISIBLE_CUES,
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
  SUBTITLE_DELAY_OVERLAY_TIMEOUT_MS,
  SUBTITLE_DELAY_STEP_MS,
  calculateSubtitleAutoSyncDelayMs,
  formatSubtitleAutoSyncDelay,
  formatSubtitleAutoSyncTimestamp,
  sanitizeSubtitleAutoSyncCueText,
  selectSubtitleAutoSyncVisibleCues,
  buildSubtitleRequestHeaders,
  normalizeSubtitleLanguageAlias,
  mdbListRatingIcon,
  hasEpisodeAiredRule,
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCardRule,
  findActiveSkipIntervalRule,
  findFollowingPostCreditsScene,
  getSkipIntervalTargetSeconds,
  normalizePlaybackDisplayLineBreaks,
  resolvePlaybackSourceName,
  formatHeroRuntime,
  localizedGenreLabel,
  contentTextDirection,
  buildInlineYoutubePlayerUrl,
  PostPlayRecommendationController,
  POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED,
  normalizePlayerEpisodeMetadata,
  resolvePostPlayEpisodeMetadataResolved,
  buildHtmlSubtitleCue,
  getSubtitleAssAlignment,
  getSubtitleAssAlignmentSettings,
  parseVttCueLayout,
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP,
  formatSubtitleVerticalOffset,
  getSubtitleVerticalOffsetVh,
  getSubtitleVerticalResidualOffsetVh,
  normalizeSubtitleVerticalOffset,
  splitSubtitleVerticalOffset,
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity,
  subtitleTextColorWithOpacity,
  isHdrStream,
  getHdrBrightnessFactor,
  getHdrHudBrightnessFactor,
  calibrateHdrColorHex,
  getHdrBitmapLut,
  HDR_BRIGHTNESS_PRESETS,
  HDR_PRESET_ORDER,
  getHdrPresetLabelKey,
  getHdrPresetDefaultFallback,
  normalizeHdrBrightnessPreset,
  BitmapSubtitleDecoder,
  normalizeBitmapSubtitleFormat,
  supportsBitmapSubtitleDecoding,
  warmBitmapSubtitleDecoder,
  isAssSubtitle,
  convertAssBodyToVtt,
  createAssRenderer,
  decodeSubtitleResponseBody,
  sanitizeSubtitleMojibake,
  SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  SUBTITLE_VIRTUALIZATION_MIN_WINDOW,
  SUBTITLE_VIRTUALIZATION_OVERSCAN_PX,
  SUBTITLE_VIRTUALIZATION_THRESHOLD,
  buildSubtitleVirtualModel,
  getSubtitleScrollTopForIndex,
  getSubtitleVirtualWindow,
  CLOCK_FORMATTER_CACHE,
  LANGUAGE_DISPLAY_NAME_CACHE,
  ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS,
  STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS,
  BUFFERING_SPINNER_STALL_MS,
  LOADING_LOGO_FILL_TARGET_LERP,
  LOADING_LOGO_FILL_IDLE_STEP,
  LOADING_LOGO_FILL_FRAME_MS,
  NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS,
  STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS,
  STARTUP_AUDIO_PREFERENCE_RETRY_INTERVAL_MS,
  WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS,
  WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS,
  WEBOS_HLS_REBUFFER_STALL_TIMEOUT_MS,
  WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS,
  WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES,
  TIZEN_NATIVE_HLS_STARTUP_STALL_TIMEOUT_MS,
  PLAYBACK_ENGINE_VALIDATION_WINDOW_MS,
  PLAYBACK_ENGINE_VALIDATION_MAX_PROGRESS_GAP_SECONDS,
  POST_VALIDATION_SAME_ENGINE_RECOVERY_MAX_ATTEMPTS,
  SOURCE_NAVIGATION_REPEAT_THROTTLE_MS,
  EPISODE_PANEL_TRANSITION_MS,
  activeEngineFsPlaybackClaims,
  deferredEngineFsRemovalTimers,
  isBackEvent,
  isSelectKeyCode,
  logEngineFsDebug,
  isLocalEngineFsUrl,
  getP2pInfoHash,
  buildPendingPlaybackRestore,
  getEngineFsClaimKey,
  createEngineFsClaimToken,
  clearDeferredEngineFsRemoval,
  claimEngineFsPlayback,
  releaseEngineFsPlaybackClaim,
  hasActiveEngineFsPlaybackClaim,
  scheduleDeferredEngineFsRemoval,
  AUDIO_TRACK_LANGUAGE_KEY_BY_CODE,
  LANGUAGE_DISPLAY_OVERRIDES,
  LANGUAGE_CODE_ALIASES,
  LANGUAGE_NAME_ALIASES,
  SUBTITLE_LANGUAGE_OFF_KEY,
  SUBTITLE_LANGUAGE_UNKNOWN_KEY,
  SUBTITLE_TEXT_COLORS,
  SUBTITLE_OUTLINE_COLORS,
  SUBTITLE_FONT_STEP,
  SUBTITLE_VERTICAL_OFFSET_STEP,
  AUDIO_AMPLIFICATION_MIN_DB,
  AUDIO_AMPLIFICATION_MAX_DB,
  PLAYER_SPEEDS,
  NEXT_EPISODE_PREFETCH_PERCENT,
  SKIP_INTERVAL_CHECK_MS,
  SKIP_INTERVAL_SEEK_SUPPRESSION_MS,
  BITMAP_SUBTITLE_WINDOW_SECONDS,
  BITMAP_SUBTITLE_PREFETCH_SECONDS,
  BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS,
  EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS,
  EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS,
  EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS,
  PARENTAL_GUIDE_ROW_HEIGHT,
  PARENTAL_GUIDE_ROW_GAP,
  PAUSE_OVERLAY_DELAY_MS
};
