/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods05() {
  const {
    Platform,
    WebOsLunaService,
    WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS,
    logTizenAvPlayDebug,
    isValidAvPlaySubtitleTrackSelectionState,
    normalizeAvPlaySubtitleRenderMode
  } = internals;

  return {
    getAvPlaySubtitleDiagnosticSnapshot() {
      if (this.avplaySeekInFlight) {
        return {
          state: "SEEKING",
          rawTrackIndex: -1,
          canonicalTrackIndex: -1
        };
      }
      const avplay = this.getAvPlay();
      const snapshot = {
        state: this.getAvPlayState(),
        rawTrackIndex: -1,
        canonicalTrackIndex: -1
      };
      if (!avplay || typeof avplay.getCurrentStreamInfo !== "function") {
        return snapshot;
      }
      try {
        const streams = avplay.getCurrentStreamInfo();
        const text = Array.isArray(streams) ? streams.find((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT") : null;
        const rawTrackIndex = Number(text?.index);
        snapshot.rawTrackIndex = Number.isFinite(rawTrackIndex) ? rawTrackIndex : -1;
        snapshot.canonicalTrackIndex = this.resolveAvPlaySubtitleTrackIndex(rawTrackIndex);
      } catch (error) {
        snapshot.error = error?.message || String(error || "");
      }
      return snapshot;
    },
    logAvPlaySubtitleDiagnostic(stage, detail = {}) {
      // Selection requests and successful state transitions are normal player
      // activity. Keep a warning only when the native selection actually fails.
      if (stage !== "select-error" || !Platform.isTizen() || !this.isUsingAvPlay()) {
        return;
      }
      console.warn("[Nuvio AVPlay subtitle selection failed]", {
        stage,
        ...detail,
        current: this.getAvPlaySubtitleDiagnosticSnapshot(),
        outputDisabled: Boolean(this.avplaySubtitlesSilent),
        renderMode: this.avplaySubtitleRenderMode,
        nativeRendering: Boolean(this.avplayNativeSubtitleRendering),
        selectedTrackIndex: Number(this.selectedAvPlaySubtitleTrackIndex),
        pendingTrackIndex: Number(this.pendingAvPlaySubtitleTrackIndex),
        desiredTrackIndex: Number(this.desiredAvPlaySubtitleTrackIndex)
      });
    },
    clearAvPlayExternalSubtitlePath() {
      this.avplayExternalSubtitlePath = "";
      this.avplayExternalSubtitleDelayMs = 0;
      this.appliedAvPlayExternalSubtitleDelayKey = "";
      // AVPlay has no documented "clear" value: the API accepts only an
      // absolute local path. Track selection and setSilentSubtitle control the
      // active output without sending an invalid empty path to the player.
      return true;
    },
    applyAvPlaySubtitleRenderMode(renderMode = this.avplaySubtitleRenderMode) {
      if (this.avplaySeekInFlight) {
        return false;
      }
      const mode = normalizeAvPlaySubtitleRenderMode(renderMode);
      this.avplaySubtitleRenderMode = mode;
      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }
      let applied = false;
      try {
        if (typeof avplay.setSilentSubtitle === "function") {
          // AVPlay emits subtitle callbacks for the HTML overlay only while its
          // own renderer is silent. Native mode restores Samsung's renderer.
          avplay.setSilentSubtitle(mode === "html");
          applied = true;
        }
      } catch (_) {
        // Track selection can still succeed when this toggle is unavailable.
      }
      this.avplaySubtitlesSilent = false;
      this.avplayNativeSubtitleRendering = mode === "native" && applied;
      return applied;
    },
    trySelectAvPlaySubtitleTrackIndex(
      trackIndex,
      { nudge = false, reactivate = false, renderMode = this.avplaySubtitleRenderMode, keepSilent = false } = {}
    ) {
      const avplay = this.getAvPlay();
      const targetIndex = Number(trackIndex);
      if (!avplay || typeof avplay.setSelectTrack !== "function" || !Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
      }
      const state = this.getAvPlayState();
      if (!isValidAvPlaySubtitleTrackSelectionState(state)) {
        logTizenAvPlayDebug("Tizen AVPlay subtitle selection deferred; invalid state", {
          state,
          targetIndex
        });
        return false;
      }
      const mode = normalizeAvPlaySubtitleRenderMode(renderMode);
      // Native AVPlay subtitles must be selected while the subtitle output is
      // muted and unmuted again immediately after setSelectTrack(); otherwise
      // some TVs report the new TEXT index without reactivating the native
      // subtitle renderer. For the HTML callback path, keep AVPlay visible
      // during selection and switch it back to silent immediately afterward.
      // A hidden -> hidden reselect can leave affected TVs reporting the track
      // while never re-arming onsubtitlechange (the callback source for HTML).
      // Bitmap tracks pass keepSilent so AVPlay never flashes its own output
      // during selection; they own the presentation through the local decoder.
      const preselectSilent = keepSilent || mode === "native";
      const debugCaptureStartedAt = Number(globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY_STARTED_AT__ || 0);
      this.avplaySubtitleDiagnosticCallbackPendingAt =
        globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true ? Math.max(Date.now(), debugCaptureStartedAt) : 0;
      try {
        avplay.setSilentSubtitle?.(preselectSilent);
      } catch (_) {
        // Track selection can still succeed when this toggle is unavailable.
      }
      try {
        logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(TEXT)", {
          state,
          targetIndex,
          subtitleTracks: this.avplaySubtitleTracks
        });
        avplay.setSelectTrack("TEXT", targetIndex);
      } catch (error) {
        this.avplaySubtitleDiagnosticCallbackPendingAt = 0;
        logTizenAvPlayDebug("Tizen AVPlay subtitle selection failed", {
          state,
          targetIndex,
          error: error?.message || String(error || "")
        });
        this.applyAvPlaySubtitleRenderMode(mode);
        this.logAvPlaySubtitleDiagnostic("select-error", {
          targetIndex,
          mode,
          reactivate: Boolean(reactivate),
          preselectSilent,
          error: error?.message || String(error || "")
        });
        return false;
      }
      this.applyAvPlaySubtitleRenderMode(mode);
      const selectedTrack = this.avplaySubtitleTracks.find((track) => Number(track?.avplayTrackIndex) === targetIndex);
      const selectedTrackExtraInfo = selectedTrack?.extraInfo || {};
      const selectedTrackFourCC = this.pickAvPlayExtraValue(selectedTrackExtraInfo, ["fourCC", "fourcc"]);
      if (nudge) {
        this.nudgeAvPlayAfterTrackSwitch();
      }
      this.reapplyTizenAvPlayDisplayRect();
      this.reapplyTizenAvPlayDisplayRect(250);
      logTizenAvPlayDebug("Tizen AVPlay subtitle selection requested", {
        state: this.getAvPlayState(),
        targetIndex,
        selectedTrack: selectedTrack
          ? {
              index: Number(selectedTrack.avplayTrackIndex),
              language: String(selectedTrack.language || ""),
              fourCC: String(selectedTrackFourCC || selectedTrack.codec || ""),
              trackNumber: this.pickAvPlayExtraValue(selectedTrackExtraInfo, ["track_num", "trackNumber", "track_number"]),
              subtitleType: this.pickAvPlayExtraValue(selectedTrackExtraInfo, ["subtitle_type", "subtitleType"])
            }
          : null
      });
      this.logAvPlaySubtitleDiagnostic("select-issued", {
        targetIndex,
        mode,
        reactivate: Boolean(reactivate),
        preselectSilent
      });
      return true;
    },
    retryAvPlaySubtitleTrackSelection(
      trackIndex,
      { force = false, nudge = false, renderMode = this.avplaySubtitleRenderMode, keepSilent = false } = {}
    ) {
      if (this.avplaySeekInFlight) {
        return false;
      }
      const canonicalIndex = this.resolveAvPlaySubtitleTrackIndex(trackIndex);
      if (canonicalIndex < 0) {
        return false;
      }
      const currentIndex = this.getCurrentAvPlaySubtitleTrackIndex();
      if (currentIndex === canonicalIndex && !force) {
        // Selection and rendering are separate AVPlay states. Reapply the
        // renderer even when Samsung already reports the requested track.
        this.applyAvPlaySubtitleRenderMode(renderMode);
        return true;
      }
      const attempted = this.trySelectAvPlaySubtitleTrackIndex(canonicalIndex, {
        nudge,
        reactivate: force,
        renderMode,
        keepSilent
      });
      return attempted || this.getCurrentAvPlaySubtitleTrackIndex() === canonicalIndex;
    },
    getSelectedWebOsEmbeddedAudioTrackIndex() {
      return Number.isFinite(this.selectedWebOsEmbeddedAudioTrackIndex) ? this.selectedWebOsEmbeddedAudioTrackIndex : -1;
    },
    cancelWebOsAudioTrackSelection() {
      this.webOsAudioSelectionRequestToken = Number(this.webOsAudioSelectionRequestToken || 0) + 1;
    },
    requestConfirmedWebOsAudioTrackSelection({
      targetTrackIndex,
      selectedTrackIndex = targetTrackIndex,
      selectionKind = "native",
      applySelection = null
    } = {}) {
      if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
        return false;
      }

      const targetIndex = Number(targetTrackIndex);
      const selectedIndex = Number(selectedTrackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
      }

      const requestToken = Number(this.webOsAudioSelectionRequestToken || 0) + 1;
      this.webOsAudioSelectionRequestToken = requestToken;
      const detail = {
        requestToken,
        selectionKind,
        targetTrackIndex: targetIndex,
        selectedTrackIndex: Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : targetIndex
      };

      const emitSelectionState = (status, extra = {}) => {
        if (requestToken !== this.webOsAudioSelectionRequestToken) {
          return;
        }
        const selectionState = {
          ...detail,
          status,
          ...extra
        };
        this.emitVideoEvent("webosaudiotrackselectionchanged", selectionState);
      };

      const commitSelection = () => {
        if (typeof applySelection === "function") {
          applySelection();
        }
        this.selectedWebOsAudioTrackIndex = detail.targetTrackIndex;
        this.webOsAudioSelectionExplicit = true;
        this.selectedWebOsEmbeddedAudioTrackIndex = selectionKind === "embedded" ? detail.selectedTrackIndex : -1;
      };

      emitSelectionState("pending");

      if (!WebOsLunaService.isAvailable()) {
        commitSelection();
        emitSelectionState("confirmed");
        return true;
      }

      void (async () => {
        try {
          const mediaId = this.syncNativeMediaId() || (await this.waitForNativeMediaId());
          if (requestToken !== this.webOsAudioSelectionRequestToken) {
            return;
          }
          if (!mediaId) {
            throw new Error("webOS media id unavailable");
          }

          let timeoutId = 0;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("webOS audio track selection timed out"));
            }, WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS);
          });
          let result;
          try {
            result = await Promise.race([
              this.requestWebOsMediaCommand("selectTrack", {
                type: "audio",
                mediaId,
                index: targetIndex
              }),
              timeoutPromise
            ]);
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }
          if (requestToken !== this.webOsAudioSelectionRequestToken) {
            return;
          }
          if (result?.returnValue === false || result?.errorCode) {
            throw new Error(result?.errorText || "webOS audio track selection failed");
          }

          commitSelection();
          emitSelectionState("confirmed");
        } catch (error) {
          emitSelectionState("failed", {
            error: String(error?.errorText || error?.message || error || "webOS audio track selection failed")
          });
        }
      })();

      return true;
    },
    getSelectedWebOsEmbeddedSubtitleTrackIndex() {
      return Number.isFinite(this.selectedWebOsEmbeddedSubtitleTrackIndex) ? this.selectedWebOsEmbeddedSubtitleTrackIndex : -1;
    }
  };
}
