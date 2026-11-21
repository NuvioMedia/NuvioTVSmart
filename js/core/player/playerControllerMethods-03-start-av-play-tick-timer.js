import * as internals from "./playerController.js";

// getCurrentTime()/getDuration() are synchronous bridge calls; one UI tick reads
// the position many times. Reuse a poll that is younger than this.
const AVPLAY_TIMELINE_POLL_REUSE_MS = 40;

export function createPlayerControllerMethods03() {
  const { logTizenAvPlayDebug } = internals;
  return {
    startAvPlayTickTimer() {
      this.stopAvPlayTickTimer();
      let trackPollTicks = 0;
      this.avplayTickTimer = setInterval(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.refreshAvPlayTimeline();
        trackPollTicks += 1;
        if ((trackPollTicks <= 15 || trackPollTicks % 5 === 0) && ["PLAYING", "PAUSED"].includes(this.getAvPlayState())) {
          const fingerprint = () =>
            JSON.stringify([
              this.avplayAudioTracks,
              this.avplaySubtitleTracks,
              this.selectedAvPlayAudioTrackIndex,
              this.selectedAvPlaySubtitleTrackIndex
            ]);
          const previous = fingerprint();
          this.syncAvPlayTrackInfo({ force: true });
          if (previous !== fingerprint()) {
            this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
          }
        }
        this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
      }, 1000);
    },
    applyStartupAudioGateToVideo() {
      if (!this.video) {
        return;
      }
      try {
        const gated = Boolean(this.startupAudioGateActive || this.startupPresentationAudioMuted);
        // A pending conversion reload must restore the latest startup mute state.
        if (this.webOsDtsAudioState) this.webOsDtsAudioState.originalMuted = gated;
        this.video.defaultMuted = gated;
        if (!gated && (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0)) {
          this.video.volume = 1;
        }
        if (this.syncWebOsExactSeekMuted?.(gated)) {
          return;
        }
        this.video.muted = gated;
      } catch (_) {
        // Ignore unsupported volume/mute operations.
      }
    },
    setStartupPresentationAudioMuted(muted) {
      this.startupPresentationAudioMuted = Boolean(muted);
      this.applyStartupAudioGateToVideo();
    },
    pauseNativePlaybackForStartupGate() {
      if (!this.video || this.isUsingAvPlay() || !this.startupAudioGateActive) {
        return;
      }
      try {
        this.video.pause();
        this.isPlaying = false;
        this.syncWebOsPlaybackKeepAwake();
      } catch (_) {
        // Ignore pause failures while the media element is still loading.
      }
    },
    resumeNativePlaybackAfterStartupGate() {
      if (!this.video || this.isUsingAvPlay()) {
        return;
      }
      try {
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((error) => {
            if (this.isExpectedPlayInterruption(error)) {
              return;
            }
            console.warn("Playback start after startup gate rejected", error);
          });
        }
        this.isPlaying = true;
        this.syncWebOsPlaybackKeepAwake();
      } catch (error) {
        if (!this.isExpectedPlayInterruption(error)) {
          console.warn("Playback start after startup gate rejected", error);
        }
      }
    },
    handleNativePlayStartedUnderStartupGate(playPromise = null) {
      if (!this.startupAudioGateActive || this.isUsingAvPlay() || !this.startupAudioGatePausesNativePlayback) {
        return playPromise;
      }
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            this.pauseNativePlaybackForStartupGate();
          })
          .catch(() => {
            // The normal playback-start rejection handler reports real failures.
          });
        return playPromise;
      }
      this.pauseNativePlaybackForStartupGate();
      return playPromise;
    },
    setStartupAudioGate(active, { resume = true, pauseNativePlayback = true } = {}) {
      const shouldGate = Boolean(active);
      const wasGated = Boolean(this.startupAudioGateActive);
      const nativePlaybackWasPausedForGate = Boolean(this.startupAudioGatePausesNativePlayback);
      this.startupAudioGateActive = shouldGate;
      this.startupAudioGatePausesNativePlayback = shouldGate ? Boolean(pauseNativePlayback) : true;
      this.applyStartupAudioGateToVideo();

      if (shouldGate) {
        if (this.isUsingAvPlay() && this.isPlaying) {
          const avplay = this.getAvPlay();
          try {
            avplay?.pause?.();
            this.isPlaying = false;
            this.syncWebOsPlaybackKeepAwake();
            this.stopAvPlayTickTimer();
          } catch (_) {
            // Ignore AVPlay pause failures while replacing the source.
          }
        }
        return;
      }

      if (!resume || !wasGated) {
        return;
      }
      if (this.isUsingAvPlay()) {
        // A startup resume seek clears avplayReady while it is in flight;
        // startPreparedAvPlayPlayback() queues the start until it settles.
        if (this.avplayReady || this.avplaySeekInFlight) {
          this.startPreparedAvPlayPlayback();
        }
        return;
      }
      if (nativePlaybackWasPausedForGate || this.video?.paused) {
        this.resumeNativePlaybackAfterStartupGate();
      }
    },
    // Samsung allows setSelectTrack(AUDIO) in PLAYING only, so a startup
    // language chosen behind the loading logo needs playback to begin first.
    // Tizen 6.5+ documents disableAudioStream(): play silently, switch in
    // PLAYING as the API requires, then pause and restore audio, so the first
    // audible frame is already the chosen track. Older TVs have no silent
    // start; a play/pause hop reaches PAUSED, where tested firmware (Tizen 5.0)
    // accepts the switch. If either path fails, the pending index stays for
    // the PLAYING retries.
    selectPendingAvPlayAudioTrackBeforeStart(avplay) {
      const targetIndex = this.resolveAvPlayAudioTrackIndex(this.pendingAvPlayAudioTrackIndex);
      const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(targetIndex);
      if (selectionIndex < 0 || this.getAvPlayState() !== "READY" || this.getCurrentAvPlayAudioTrackIndex() === targetIndex) {
        return false;
      }
      const silentStart = typeof avplay.disableAudioStream === "function" && typeof avplay.enableAudioStream === "function";
      let audioDisabled = false;
      try {
        if (silentStart) {
          avplay.disableAudioStream();
          audioDisabled = true;
          avplay.play();
          avplay.setSelectTrack("AUDIO", selectionIndex);
          avplay.pause();
        } else {
          avplay.play();
          avplay.pause();
          avplay.setSelectTrack("AUDIO", selectionIndex);
        }
      } catch (error) {
        logTizenAvPlayDebug("Tizen AVPlay pre-start audio selection failed", {
          targetIndex,
          silentStart,
          error: error?.message || String(error || "")
        });
        try {
          // The normal start below calls play(), which PLAYING would reject.
          if (this.getAvPlayState() === "PLAYING") avplay.pause();
        } catch (_) {
          // Playback start reports any remaining state problem.
        }
        return false;
      } finally {
        if (audioDisabled) {
          try {
            avplay.enableAudioStream();
          } catch (_) {
            // Nothing else can restore it; the PLAYING retries keep the selection.
          }
        }
      }
      this.selectedAvPlayAudioTrackIndex = targetIndex;
      this.pendingAvPlayAudioTrackIndex = -1;
      this.desiredAvPlayAudioTrackIndex = targetIndex;
      this.desiredAvPlayAudioTrackUntil = Date.now() + 5000;
      return true;
    },
    startPreparedAvPlayPlayback({ syncTracks = true } = {}) {
      const avplay = this.getAvPlay();
      if (!avplay || !this.isUsingAvPlay()) {
        return false;
      }
      if (this.avplaySeekInFlight) {
        // Samsung forbids other AVPlay calls until seekTo() reports back.
        // Calling play() here (resume seek issued from the prepared events)
        // left the native player rejecting later seeks with INVALID_STATE.
        this.avplayStartAfterSeek = { syncTracks };
        logTizenAvPlayDebug("Tizen AVPlay seek in flight; delaying playback start until it settles");
        return true;
      }
      this.selectPendingAvPlayAudioTrackBeforeStart(avplay);
      try {
        avplay.play?.();
        // AVPlay can report a startup error and still complete preparation. A
        // successful play call means that transient code must not remain fatal.
        this.lastPlaybackErrorCode = 0;
        this.isPlaying = true;
        this.syncWebOsPlaybackKeepAwake();
        this.reapplyAvPlayPlaybackRate();
        this.reapplyTizenAvPlayDisplayRect();
        this.reapplyTizenAvPlayDisplayRect(250);
        this.startAvPlayTickTimer();
        this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
        [0, 250, 750, 1500].forEach((delayMs) => {
          setTimeout(() => {
            if (!this.isUsingAvPlay()) {
              return;
            }
            this.reapplyAvPlayPlaybackRate();
            this.applyPendingAvPlayAudioTrackSelection();
            this.applyPendingAvPlaySubtitleTrackSelection();
          }, delayMs);
        });
        setTimeout(
          () => {
            if (!this.isUsingAvPlay()) {
              return;
            }
            this.reapplyAvPlayPlaybackRate();
            this.applyPendingAvPlayAudioTrackSelection();
            this.applyPendingAvPlaySubtitleTrackSelection();
            if (syncTracks) {
              this.syncAvPlayTrackInfo({ force: true });
              this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
            }
          },
          syncTracks ? 500 : 300
        );
        return true;
      } catch (error) {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(error?.name || error?.message || error);
        this.isPlaying = false;
        this.syncWebOsPlaybackKeepAwake();
        this.emitVideoEvent("error", {
          playbackEngine: this.playbackEngine,
          mediaErrorCode: this.lastPlaybackErrorCode
        });
        return false;
      }
    },
    refreshAvPlayTimeline() {
      if (!this.isUsingAvPlay() || this.avplaySeekInFlight) {
        return;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      const now = Date.now();
      if (now - Number(this.avplayTimelinePolledAt || 0) < AVPLAY_TIMELINE_POLL_REUSE_MS) {
        return;
      }
      this.avplayTimelinePolledAt = now;
      try {
        const currentMs = Number(avplay.getCurrentTime?.() || 0);
        if (Number.isFinite(currentMs) && currentMs >= 0) {
          this.avplayCurrentTimeMs = currentMs;
        }
      } catch (_) {
        // Ignore current-time polling failures.
      }
      try {
        const durationMs = Number(avplay.getDuration?.() || 0);
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          this.avplayDurationMs = durationMs;
        }
      } catch (_) {
        // Ignore duration polling failures.
      }
    },
    parseAvPlayExtraInfo(extraInfoValue) {
      if (!extraInfoValue) {
        return null;
      }
      if (typeof extraInfoValue === "object") {
        return extraInfoValue;
      }

      const source = String(extraInfoValue)
        .replace(/^\uFEFF/, "")
        .split(String.fromCharCode(0))
        .join("")
        .trim();
      let candidate = source;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
          if (typeof parsed === "string" && parsed !== candidate) {
            candidate = parsed.trim();
            continue;
          }
        } catch (_) {
          break;
        }
        break;
      }

      // Some AVPlay firmware returns JSON-like metadata with single quotes or
      // stray bytes. Preserve the language/title fields even when JSON.parse fails.
      const recovered = {};
      ["track_lang", "trackLang", "language", "language_code", "lang", "track_name", "track_title", "title", "name", "label"].forEach(
        (key) => {
          const match = source.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, "i"));
          if (match?.[1]) {
            recovered[key] = match[1].trim();
          }
        }
      );
      return Object.keys(recovered).length ? recovered : null;
    },
    normalizeAvPlayTrackType(typeValue) {
      const type = String(typeValue || "")
        .trim()
        .toUpperCase();
      if (type === "SUBTITLE") {
        return "TEXT";
      }
      if (type === "AUDIO" || type === "TEXT" || type === "VIDEO") {
        return type;
      }
      if (type.includes("AUDIO")) {
        return "AUDIO";
      }
      if (type.includes("TEXT") || type.includes("SUBTITLE")) {
        return "TEXT";
      }
      if (type.includes("VIDEO")) {
        return "VIDEO";
      }
      return type;
    },
    pickAvPlayTrackLabel(track = {}, trackIndex = 0, prefix = "Track") {
      const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
      return String(
        track.name ||
          track.label ||
          track.title ||
          extraInfo.name ||
          extraInfo.label ||
          extraInfo.track_name ||
          extraInfo.track_title ||
          extraInfo.title ||
          extraInfo.track_lang ||
          extraInfo.trackLang ||
          extraInfo.language ||
          extraInfo.language_code ||
          extraInfo.lang ||
          `${prefix} ${trackIndex + 1}`
      ).trim();
    },
    pickAvPlayTrackLanguage(track = {}) {
      const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
      const candidates = [
        track.language,
        track.lang,
        track.track_lang,
        track.trackLang,
        track.language_code,
        extraInfo.track_lang,
        extraInfo.trackLang,
        extraInfo.language,
        extraInfo.language_code,
        extraInfo.lang
      ].map((value) => String(value || "").trim());
      return candidates.find((value) => value && !/^(unknown(?: language)?|undetermined|undefined|und|unk|zxx)$/i.test(value)) || "";
    },
    pickAvPlayExtraValue(extraInfo = {}, keys = []) {
      for (const key of keys) {
        const value = extraInfo?.[key];
        if (value === null || value === undefined) {
          continue;
        }
        const text = String(value).trim();
        if (text) {
          return text;
        }
      }
      return "";
    }
  };
}
