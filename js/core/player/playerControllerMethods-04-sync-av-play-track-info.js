/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods04() {
  const { Platform, logTizenAvPlayDebug, isValidAvPlayAudioTrackSelectionState } = internals;

  return {
    syncAvPlayTrackInfo(options = {}) {
      if (!this.isUsingAvPlay()) {
        this.avplayAudioTracks = [];
        this.avplaySubtitleTracks = [];
        this.selectedAvPlayAudioTrackIndex = -1;
        this.selectedAvPlaySubtitleTrackIndex = -1;
        this.avplayTrackSyncAt = 0;
        return;
      }
      if (this.avplaySeekInFlight) {
        return;
      }

      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }

      const force = Boolean(options?.force);
      const now = Date.now();
      if (!force && now - Number(this.avplayTrackSyncAt || 0) < 220) {
        return;
      }
      this.avplayTrackSyncAt = now;

      const totalTracks = (() => {
        try {
          const value = avplay.getTotalTrackInfo?.();
          return Array.isArray(value) ? value : null;
        } catch (_) {
          return null;
        }
      })();

      // A failed metadata query must not erase tracks discovered earlier.
      if (totalTracks === null) {
        return;
      }

      const currentTracks = (() => {
        try {
          const value = avplay.getCurrentStreamInfo?.();
          return Array.isArray(value) ? value : [];
        } catch (_) {
          return [];
        }
      })();

      const currentAudio = currentTracks.find((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO");
      const currentText = currentTracks.find((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT");
      const selectedAudioIndex = Number(currentAudio?.index);
      const selectedTextIndex = Number(currentText?.index);

      this.avplayAudioTracks = totalTracks
        .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO")
        .map((track, index) => {
          const trackIndex = Number(track?.index);
          const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : -1;
          const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
          const forcedValue = this.pickAvPlayExtraValue(extraInfo, ["forced", "is_forced"]);
          return {
            id: `avplay-audio-${normalizedTrackIndex}`,
            label: this.pickAvPlayTrackLabel(track, index, "Track"),
            language: this.pickAvPlayTrackLanguage(track),
            channels: this.pickAvPlayExtraValue(extraInfo, [
              "channels",
              "channel",
              "audio_channel",
              "audio_channel_count",
              "channel_layout"
            ]),
            codec: this.pickAvPlayExtraValue(extraInfo, [
              "codec",
              "codec_name",
              "codec_id",
              "codec_tag_string",
              "audio_type",
              "audioType",
              "audioCodec",
              "fourCC"
            ]),
            codecProfile: this.pickAvPlayExtraValue(extraInfo, ["profile", "codecProfile", "codec_profile"]),
            mimeType: this.pickAvPlayExtraValue(extraInfo, ["mimeType", "sampleMimeType", "mime_type", "sample_mime_type"]),
            characteristics: this.pickAvPlayExtraValue(extraInfo, ["characteristics", "role", "type"]),
            sampleRate: Number(this.pickAvPlayExtraValue(extraInfo, ["sampleRate", "audioSampleRate", "sample_rate"]) || 0) || 0,
            forced: /^(1|true|yes)$/i.test(forcedValue),
            extraInfo,
            avplayTrackIndex: normalizedTrackIndex,
            avplayAudioOrdinalIndex: index
          };
        })
        .filter((track) => Number.isFinite(Number(track?.avplayTrackIndex)) && Number(track.avplayTrackIndex) >= 0);

      this.avplaySubtitleTracks = totalTracks
        .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT")
        .map((track, index) => {
          const trackIndex = Number(track?.index);
          const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
          const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
          const forcedValue = this.pickAvPlayExtraValue(extraInfo, ["forced", "is_forced"]);
          return {
            id: `avplay-sub-${normalizedTrackIndex}`,
            label: this.pickAvPlayTrackLabel(track, index, "Subtitle"),
            language: this.pickAvPlayTrackLanguage(track),
            codec: this.pickAvPlayExtraValue(extraInfo, ["codec", "codec_name", "codec_id", "codec_tag_string", "fourCC", "fourcc"]),
            forced: /^(1|true|yes)$/i.test(forcedValue),
            extraInfo,
            avplayTrackIndex: normalizedTrackIndex
          };
        });

      if (Platform.isTizen()) {
        logTizenAvPlayDebug("Tizen AVPlay tracks synced", {
          state: this.getAvPlayState(),
          totalTracks,
          currentTracks,
          audioTracks: this.avplayAudioTracks,
          selectedAudioIndex,
          selectedAudioTrackIndex: this.selectedAvPlayAudioTrackIndex
        });
      }

      const desiredAudioIndex = Number(this.desiredAvPlayAudioTrackIndex);
      const desiredAudioActive =
        Number.isFinite(desiredAudioIndex) && desiredAudioIndex >= 0 && Date.now() < Number(this.desiredAvPlayAudioTrackUntil || 0);
      const resolvedSelectedAudioIndex = this.resolveAvPlayAudioTrackIndex(selectedAudioIndex);
      const resolvedSelectedTextIndex = this.resolveAvPlaySubtitleTrackIndex(selectedTextIndex);

      if (desiredAudioActive) {
        this.selectedAvPlayAudioTrackIndex = desiredAudioIndex;
      } else if (Number.isFinite(resolvedSelectedAudioIndex) && resolvedSelectedAudioIndex >= 0) {
        this.selectedAvPlayAudioTrackIndex = resolvedSelectedAudioIndex;
        this.pendingAvPlayAudioTrackIndex = -1;
        this.desiredAvPlayAudioTrackIndex = -1;
        this.desiredAvPlayAudioTrackUntil = 0;
      } else if (Number.isFinite(this.pendingAvPlayAudioTrackIndex) && this.pendingAvPlayAudioTrackIndex >= 0) {
        this.selectedAvPlayAudioTrackIndex = this.pendingAvPlayAudioTrackIndex;
      } else if (this.avplayAudioTracks.length && this.selectedAvPlayAudioTrackIndex < 0) {
        this.selectedAvPlayAudioTrackIndex = this.avplayAudioTracks[0].avplayTrackIndex;
      } else if (!this.avplayAudioTracks.length) {
        this.selectedAvPlayAudioTrackIndex = -1;
      }

      const desiredSubtitleIndex = Number(this.desiredAvPlaySubtitleTrackIndex);
      const desiredSubtitleActive = Number.isFinite(desiredSubtitleIndex) && Date.now() < Number(this.desiredAvPlaySubtitleTrackUntil || 0);

      if (this.avplaySubtitlesSilent) {
        this.selectedAvPlaySubtitleTrackIndex = -1;
      } else if (desiredSubtitleActive) {
        this.selectedAvPlaySubtitleTrackIndex = desiredSubtitleIndex;
      } else if (Number.isFinite(resolvedSelectedTextIndex) && resolvedSelectedTextIndex >= 0) {
        this.selectedAvPlaySubtitleTrackIndex = resolvedSelectedTextIndex;
        this.pendingAvPlaySubtitleTrackIndex = -1;
        this.desiredAvPlaySubtitleTrackIndex = -1;
        this.desiredAvPlaySubtitleTrackUntil = 0;
      } else if (Number.isFinite(this.pendingAvPlaySubtitleTrackIndex) && this.pendingAvPlaySubtitleTrackIndex >= 0) {
        this.selectedAvPlaySubtitleTrackIndex = this.pendingAvPlaySubtitleTrackIndex;
      } else if (!this.avplaySubtitleTracks.length) {
        this.selectedAvPlaySubtitleTrackIndex = -1;
      }
    },
    getAvPlayAudioTracks() {
      return this.avplayAudioTracks.slice();
    },
    getAvPlaySubtitleTracks() {
      return this.avplaySubtitleTracks.slice();
    },
    getSelectedAvPlayAudioTrackIndex() {
      return Number.isFinite(this.selectedAvPlayAudioTrackIndex) ? this.selectedAvPlayAudioTrackIndex : -1;
    },
    resolveAvPlayAudioTrackIndex(trackIndex) {
      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return -1;
      }
      const exact = this.avplayAudioTracks.find((track) => Number(track?.avplayTrackIndex) === targetIndex);
      if (exact) {
        return Number(exact.avplayTrackIndex);
      }
      return -1;
    },
    getAvPlayAudioTrackSelectionIndex(trackIndex) {
      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return -1;
      }
      const track = this.avplayAudioTracks.find((entry) => Number(entry?.avplayTrackIndex) === targetIndex);
      return track ? Number(track.avplayTrackIndex) : -1;
    },
    getCurrentAvPlayAudioTrackIndex() {
      if (this.avplaySeekInFlight) {
        return -1;
      }
      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.getCurrentStreamInfo !== "function") {
        return -1;
      }
      try {
        const streams = avplay.getCurrentStreamInfo();
        const audio = Array.isArray(streams) ? streams.find((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO") : null;
        return this.resolveAvPlayAudioTrackIndex(Number(audio?.index));
      } catch (_) {
        return -1;
      }
    },
    trySelectAvPlayAudioTrackIndex(trackIndex) {
      const avplay = this.getAvPlay();
      const targetIndex = Number(trackIndex);
      if (!avplay || typeof avplay.setSelectTrack !== "function" || !Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
      }
      const state = this.getAvPlayState();
      if (!isValidAvPlayAudioTrackSelectionState(state)) {
        logTizenAvPlayDebug("Tizen AVPlay audio selection deferred; invalid state", {
          state,
          targetIndex
        });
        return false;
      }
      try {
        logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO)", {
          state,
          targetIndex,
          audioTracks: this.avplayAudioTracks
        });
        avplay.setSelectTrack("AUDIO", targetIndex);
        logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO) succeeded", {
          state: this.getAvPlayState(),
          targetIndex
        });
        return true;
      } catch (error) {
        logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO) failed", {
          state,
          targetIndex,
          error: error?.message || String(error || "")
        });
        return false;
      }
    },
    retryAvPlayAudioTrackSelection(trackIndex) {
      if (this.avplaySeekInFlight) {
        return false;
      }
      const canonicalIndex = this.resolveAvPlayAudioTrackIndex(trackIndex);
      if (canonicalIndex < 0) {
        return false;
      }
      const currentIndex = this.getCurrentAvPlayAudioTrackIndex();
      if (currentIndex === canonicalIndex) {
        return true;
      }
      const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(canonicalIndex);
      if (selectionIndex < 0) {
        return false;
      }
      const attempted = this.trySelectAvPlayAudioTrackIndex(selectionIndex);
      return attempted || this.getCurrentAvPlayAudioTrackIndex() === canonicalIndex;
    },
    getSelectedAvPlaySubtitleTrackIndex() {
      return Number.isFinite(this.selectedAvPlaySubtitleTrackIndex) ? this.selectedAvPlaySubtitleTrackIndex : -1;
    },
    resolveAvPlaySubtitleTrackIndex(trackIndex) {
      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return -1;
      }
      const exact = this.avplaySubtitleTracks.find((track) => Number(track?.avplayTrackIndex) === targetIndex);
      if (exact) {
        return Number(exact.avplayTrackIndex);
      }
      return -1;
    },
    getCurrentAvPlaySubtitleTrackIndex() {
      if (this.avplaySubtitlesSilent) {
        return -1;
      }
      return this.getAvPlaySubtitleDiagnosticSnapshot().canonicalTrackIndex;
    }
  };
}
