import { Platform } from "../index.js";
import { requestWebOsCompanionService } from "./webosCompanionService.js";

async function companion(method, parameters) {
  const result = await requestWebOsCompanionService({ method, parameters });
  const payload = result?.payload || {};
  if (payload.returnValue === false) throw new Error("Audio conversion unavailable");
  return payload;
}
function active(controller, state) {
  return controller.webOsDtsAudioState === state && !state.cancelled;
}
function setBuffering(controller, state, buffering) {
  if (!active(controller, state) || state.buffering === buffering) return;
  state.buffering = buffering;
  controller.emitVideoEvent("webosaudioconversionchanged", {});
}
function observePresentation(controller, state) {
  const video = controller.video;
  const waiting = () => {
    if (!active(controller, state) || state.fallingBack) return;
    state.presentationBaseline = video.currentTime;
    setBuffering(controller, state, true);
  };
  const seeking = () => {
    state.awaitSeeked = true;
    waiting();
  };
  const seeked = () => {
    state.awaitSeeked = false;
    state.presentationBaseline = video.currentTime;
    if (video.paused && video.readyState >= 3) setBuffering(controller, state, false);
  };
  const timeupdate = () => {
    // webOS native playback exposes requestVideoFrameCallback without firing it.
    // A ready decoder plus a post-seek clock advance is the existing TV contract.
    if (!state.buffering || state.awaitSeeked || video.seeking || video.readyState < 3) return;
    const advance = Math.abs(video.currentTime - state.presentationBaseline);
    if (advance > 0.01 && advance < 1) setBuffering(controller, state, false);
    state.presentationBaseline = video.currentTime;
  };
  const bindings = [
    ["seeking", seeking],
    ["seeked", seeked],
    ["waiting", waiting],
    ["timeupdate", timeupdate]
  ];
  bindings.forEach(([name, handler]) => video.addEventListener(name, handler));
  state.stopPresentationObserver = () => {
    bindings.forEach(([name, handler]) => video.removeEventListener(name, handler));
  };
}
function close(controller, state) {
  if (!state) return;
  state.cancelled = true;
  clearInterval(state.poll);
  state.worker?.terminate();
  state.abort?.abort();
  state.stopPresentationObserver?.();
  state.cancelReload?.();
  controller.video?.removeEventListener("error", state.onVideoError, true);
  if (state.id) void companion("audioTranscodeStop", { id: state.id }).catch(() => {});
}
async function reload(controller, state, url) {
  if (!active(controller, state)) return;
  const video = controller.video;
  const position = Math.max(
    0,
    video.readyState > 0 ? Number(video.currentTime) || 0 : state.lastPosition || 0
  );
  state.lastPosition = position;
  state.reloadPresentation = {
    position,
    duration: Number(controller.getDurationSeconds?.() || video.duration || 0)
  };
  state.presentationBaseline = position;
  setBuffering(controller, state, true);
  video.muted = true;
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("error", failed);
      state.cancelReload = null;
    };
    const failed = () => {
      cleanup();
      if (active(controller, state)) video.muted = state.originalMuted;
      reject(new Error("Audio conversion playback failed"));
    };
    const loaded = () => {
      if (!active(controller, state)) return failed();
      cleanup();
      try {
        if (position > 0) video.currentTime = position;
      } catch (_) {}
      state.preparing = false;
      if (state.resumePlayback) {
        if (controller.startupAudioGateActive) video.play()?.catch(() => {});
        else controller.resume();
      } else video.pause();
      video.muted = state.originalMuted;
      controller.emitVideoEvent("webosaudioconversionchanged", {});
      resolve();
    };
    state.cancelReload = failed;
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("error", failed);
    timer = setTimeout(failed, 30000);
    controller.resetNativeMediaState();
    controller.applyNativeSource(url, "video/x-matroska", "native-file");
    video.play()?.catch(() => {});
  });
}
function select(controller, state) {
  const converted = Boolean(state.id && !state.fallingBack);
  const convertedIndex = converted
    ? controller
        .nativeAudioTrackListToArray()
        .findIndex((track) => String(track.id) === String(state.targetIndex))
    : -1;
  // Persist the same native position used by HTML so Luna reapply cannot undo it.
  const targetIndex = convertedIndex >= 0 ? convertedIndex : state.targetIndex;
  return controller.requestConfirmedWebOsAudioTrackSelection({
    targetTrackIndex: targetIndex,
    selectedTrackIndex: state.selectedIndex,
    selectionKind: state.kind,
    applySelection: () => {
      const tracks = controller.nativeAudioTrackListToArray();
      // Source indices and native IDs are distinct; retain the existing HTML resolution.
      const identifiedIndex = tracks.findIndex(
        (track) => String(track.id) === String(state.targetIndex)
      );
      const selectedIndex = converted
        ? targetIndex
        : identifiedIndex >= 0
          ? identifiedIndex
          : state.targetIndex;
      tracks.forEach((track, index) => {
        try {
          if ("enabled" in track) track.enabled = index === selectedIndex;
        } catch (_) {}
        try {
          if ("selected" in track) track.selected = index === selectedIndex;
        } catch (_) {}
      });
      state.preparing = false;
      if (state.resumePlayback && !controller.startupAudioGateActive && controller.video.paused)
        controller.resume();
      controller.emitVideoEvent("webosaudioconversionchanged", {});
    }
  });
}
async function fallback(controller, state) {
  if (!active(controller, state) || state.fallingBack) return;
  state.fallingBack = true;
  state.preparing = false;
  state.stopPresentationObserver?.();
  setBuffering(controller, state, false);
  state.cancelReload?.();
  controller.webOsDtsAudioFailures.add(state.key);
  controller.emitVideoEvent("webosaudioconversionchanged", {});
  clearInterval(state.poll);
  state.worker?.terminate();
  state.worker = null;
  if (state.id) await companion("audioTranscodeStop", { id: state.id }).catch(() => {});
  state.id = "";
  try {
    await reload(controller, state, state.originalUrl);
    if (active(controller, state)) select(controller, state);
  } catch (_) {
    if (active(controller, state))
      controller.emitVideoEvent("webosaudiotrackselectionchanged", {
        status: "failed",
        selectionKind: state.kind,
        targetTrackIndex: state.targetIndex,
        selectedTrackIndex: state.selectedIndex
      });
  }
}
function poll(controller, state) {
  let busy = false,
    generation = 0,
    lastProgress = performance.now(),
    lastTime = controller.video.currentTime;
  state.poll = setInterval(async () => {
    if (busy || !active(controller, state) || state.fallingBack) return;
    busy = true;
    try {
      const video = controller.video;
      if (!state.cancelReload) state.originalMuted = video.muted;
      if (video.readyState > 0) state.lastPosition = Math.max(0, Number(video.currentTime) || 0);
      const response = await fetch(
        `${state.base}${state.path}/control?time=${Math.max(0, Number(video.currentTime) || 0)}`,
        { signal: state.abort.signal }
      );
      if (!response.ok) throw new Error("Audio conversion service unavailable");
      const result = await response.json();
      if (!active(controller, state)) return;
      if (result.error) throw new Error("Audio conversion failed");
      if (video.paused || video.currentTime !== lastTime) lastProgress = performance.now();
      lastTime = video.currentTime;
      if (result.g && result.g !== generation) {
        generation = result.g;
        lastProgress = performance.now();
        state.worker?.terminate();
        const currentGeneration = generation;
        const url = URL.createObjectURL(
          new Blob(
            [`importScripts(${JSON.stringify(`${state.base}/audio-transcode/assets/worker.js`)});`],
            { type: "application/javascript" }
          )
        );
        try {
          state.worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        state.worker.onerror = () => {
          if (active(controller, state) && generation === currentGeneration)
            void fallback(controller, state);
        };
        state.worker.onmessage = ({ data }) => {
          if (!active(controller, state) || generation !== currentGeneration) return;
          // LG can request its resume/seek range before the next control poll.
          // The old encoder then receives 409; the poll starts the new generation.
          if (data.superseded) return;
          if (data.type === "ready" || data.type === "progress") {
            state.heap = data.heap;
            return;
          }
          if (data.error || data.ret !== 0) void fallback(controller, state);
        };
        state.worker.postMessage({
          base: state.base,
          path: state.path,
          g: currentGeneration,
          downmix: state.downmix,
          format: state.format
        });
      }
      if (!video.paused && performance.now() - lastProgress > 30000)
        throw new Error("Audio conversion stalled");
    } catch (_) {
      if (active(controller, state)) void fallback(controller, state);
    } finally {
      busy = false;
    }
  }, 500);
}
export function createWebOsDtsAudioMethods() {
  return {
    isWebOsDtsAudioBuffering() {
      const state = this.webOsDtsAudioState;
      return (
        Platform.isWebOS() &&
        Boolean(state && !state.fallingBack && (state.preparing || (state.id && state.buffering)))
      );
    },
    hasWebOsDtsAudioConversionFailed(track, targetIndex) {
      if (!Platform.isWebOS()) return false;
      if (typeof WebAssembly !== "object" || typeof Worker !== "function") return true;
      const url = this.webOsDtsAudioState?.originalUrl || this.currentPlaybackUrl;
      return Boolean(
        this.webOsDtsAudioFailures?.has(`${url}|${track?.sourceTrackId || targetIndex}`)
      );
    },
    stopWebOsDtsAudioTranscode({ resetFailures = false } = {}) {
      const state = this.webOsDtsAudioState;
      this.webOsDtsAudioState = null;
      close(this, state);
      if (resetFailures || !this.webOsDtsAudioFailures) this.webOsDtsAudioFailures = new Set();
    },
    setWebOsAudioTrackWithDtsConversion(
      track,
      targetIndex,
      selectedIndex,
      kind = "embedded",
      attempt = false,
      resumeAfterSwitch = false
    ) {
      if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) return false;
      const previous = this.webOsDtsAudioState;
      const originalUrl = previous?.originalUrl || this.currentPlaybackUrl;
      const needsRestore = Boolean(previous?.id);
      const originalMuted = previous?.cancelReload ? previous.originalMuted : this.video.muted;
      this.stopWebOsDtsAudioTranscode();
      const state = {
        originalUrl,
        targetIndex,
        selectedIndex,
        kind,
        originalMuted,
        lastPosition: this.video.currentTime,
        cancelled: false,
        fallingBack: false,
        controlPaused: Boolean(this.video.paused),
        resumePlayback: resumeAfterSwitch || this.isPlaying || this.startupAudioGateActive,
        preparing: Boolean(
          needsRestore ||
          (attempt &&
            !this.webOsDtsAudioFailures.has(`${originalUrl}|${track.sourceTrackId || targetIndex}`))
        ),
        abort: new AbortController(),
        key: `${originalUrl}|${track.sourceTrackId || targetIndex}`
      };
      this.webOsDtsAudioState = state;
      if (resumeAfterSwitch && state.preparing) this.video.pause();
      this.emitVideoEvent("webosaudioconversionchanged", {});
      this.emitVideoEvent("webosaudiotrackselectionchanged", {
        status: "pending",
        selectionKind: kind,
        targetTrackIndex: targetIndex,
        selectedTrackIndex: selectedIndex
      });
      void (async () => {
        if (!attempt || this.webOsDtsAudioFailures.has(state.key)) {
          try {
            if (needsRestore) await reload(this, state, originalUrl);
            if (active(this, state)) select(this, state);
          } catch (_) {
            void fallback(this, state);
          }
          return;
        }
        try {
          if (typeof WebAssembly !== "object" || typeof Worker !== "function")
            throw new Error("Audio conversion unavailable");
          const health = await companion("ping", {});
          if (!active(this, state)) return;
          state.base = String(health.url || "").replace(/\/$/, "");
          if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(state.base))
            throw new Error("Local audio service unavailable");
          const created = await companion("audioTranscodeCreate", {
            url: originalUrl,
            trackNumber: Number(track.sourceTrackId) || 0,
            trackIndex: targetIndex
          });
          if (!active(this, state)) {
            if (created.id)
              void companion("audioTranscodeStop", { id: created.id }).catch(() => {});
            return;
          }
          state.id = created.id;
          state.path = created.path;
          state.downmix = created.downmix === true;
          state.format = created.format === "truehd" ? "truehd" : "dts";
          state.sourceTrackIndex = created.trackIndex;
          if (!state.id || !state.path) throw new Error("Audio conversion unavailable");
          state.onVideoError = (event) => {
            if (active(this, state) && this.video.currentSrc.includes(state.path)) {
              event.stopImmediatePropagation();
              if (!state.cancelReload) state.originalMuted = this.video.muted;
              void fallback(this, state);
            }
          };
          this.video.addEventListener("error", state.onVideoError, true);
          observePresentation(this, state);
          poll(this, state);
          await reload(this, state, `${state.base}${state.path}/media.mkv`);
          if (active(this, state)) select(this, state);
        } catch (_) {
          if (active(this, state)) void fallback(this, state);
        }
      })();
      return true;
    }
  };
}
