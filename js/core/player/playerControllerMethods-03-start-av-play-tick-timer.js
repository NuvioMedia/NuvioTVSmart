export function createPlayerControllerMethods03() {
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
        this.video.muted = gated;
        this.video.defaultMuted = gated;
        if (!gated && (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0)) {
          this.video.volume = 1;
        }
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
        if (this.avplayReady) {
          this.startPreparedAvPlayPlayback();
        }
        return;
      }
      if (nativePlaybackWasPausedForGate || this.video?.paused) {
        this.resumeNativePlaybackAfterStartupGate();
      }
    },
    startPreparedAvPlayPlayback({ syncTracks = true } = {}) {
      const avplay = this.getAvPlay();
      if (!avplay || !this.isUsingAvPlay()) {
        return false;
      }
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
