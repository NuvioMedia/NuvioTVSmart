import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";
import { TizenEngineFsService } from "./tizenEngineFsService.js";

// Same conversion as webOS (services/webos/src/audioTranscode.js, packaged into
// the Tizen EngineFS service): the service rewrites the Matroska stream, this
// page decodes DTS/TrueHD and encodes AC3 in a Worker, and AVPlay plays the
// rewritten file. AVPlay omits DTS tracks on TVs without DTS support.
const SERVICE_PORT = 2715;

function serviceBase() {
  try {
    const parsed = new URL(String(TizenEngineFsService.getLocalBaseUrls?.()[0] || ""));
    parsed.port = String(SERVICE_PORT);
    return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(parsed.origin) ? parsed.origin : "";
  } catch (_) {
    return "";
  }
}
async function service(base, route) {
  const response = await fetch(`${base}${route}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.returnValue === false)
    throw new Error("Audio conversion unavailable");
  return payload;
}
function active(controller, state) {
  return controller.tizenDtsAudioState === state && !state.cancelled;
}
function emitChanged(controller) {
  controller.emitVideoEvent("tizenaudioconversionchanged", {});
}
function close(controller, state) {
  if (!state) return;
  state.cancelled = true;
  clearInterval(state.poll);
  state.worker?.terminate();
  state.cancelReload?.();
  controller.video?.removeEventListener("error", state.onVideoError, true);
  if (state.id) void service(state.base, `/audio-transcode-stop?id=${state.id}`).catch(() => {});
}
// Hold AVPlay as if a seek were in flight: startPreparedAvPlayPlayback() then
// queues the start until the real seek settles, and the clock shows `targetMs`.
function holdForSeek(controller, targetMs) {
  // AVPlay reports PLAYING while it fills its buffer: buffering lasts until the
  // clock moves past the target, as the webOS path waits for a clock advance.
  const state = controller.tizenDtsAudioState;
  if (state) state.awaitClockFromMs = targetMs;
  controller.avplaySeekInFlight = true;
  controller.avplayReady = false;
  controller.avplayCurrentTimeMs = targetMs;
}
function prepareSeek(controller, state, targetMs) {
  return service(state.base, `${state.path}/prepare?time=${targetMs / 1000}`).then(() => {
    if (!active(controller, state)) throw new Error("cancelled");
  });
}
function reload(controller, state, url) {
  if (!active(controller, state)) return Promise.reject(new Error("cancelled"));
  const position = Math.max(
    0,
    Number(controller.getCurrentTimeSeconds()) || state.lastPosition || 0
  );
  const positionMs = Math.round(position * 1000);
  const converted = url !== state.originalUrl;
  state.lastPosition = position;
  return new Promise((resolve, reject) => {
    const video = controller.video;
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("playing", playing);
      state.cancelReload = null;
    };
    const failed = () => {
      cleanup();
      reject(new Error("Audio conversion playback failed"));
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const loaded = () => {
      if (!active(controller, state)) return failed();
      video.removeEventListener("loadedmetadata", loaded);
      state.preparing = false;
      // AVPlay selects a pending audio track before play(), so the choice made
      // here is audible from the first frame.
      state.onReady?.(converted);
      emitChanged(controller);
      if (!converted || positionMs <= 0) {
        if (controller.startupAudioGateActive || state.resumePlayback) done();
        return;
      }
      prepareSeek(controller, state, positionMs).then(() => {
        if (!state.resumePlayback) controller.avplayStartAfterSeek = null;
        controller.avplaySeekInFlight = false;
        state.seekBypass = true;
        try {
          if (!controller.seekAvPlayTo(positionMs)) throw new Error("seek");
        } finally {
          state.seekBypass = false;
        }
        done();
      }, failed);
    };
    const playing = () => {
      // onPrepared starts playback after the resume seek; keep a viewer pause.
      if (active(controller, state) && !state.resumePlayback && !controller.startupAudioGateActive)
        controller.pause();
      done();
    };
    state.cancelReload = failed;
    video.addEventListener("loadedmetadata", loaded);
    if (!converted) video.addEventListener("playing", playing);
    timer = setTimeout(failed, 30000);
    const started = controller.playWithAvPlay(
      url,
      converted ? {} : controller.currentPlaybackHeaders || {},
      "video/x-matroska",
      controller.playRequestToken,
      state.originalUrl
    );
    if (!started) return failed();
    if (converted && positionMs > 0) holdForSeek(controller, positionMs);
    else if (positionMs > 0) controller.avplayDeferredSeekMs = positionMs;
  });
}
async function fallback(controller, state) {
  if (!active(controller, state) || state.fallingBack) return;
  state.fallingBack = true;
  state.preparing = false;
  controller.tizenDtsAudioFailures.add(state.key);
  clearInterval(state.poll);
  state.worker?.terminate();
  state.worker = null;
  state.cancelReload?.();
  // onVideoError stays bound: it swallows errors of the rewritten URL until
  // AVPlay is back on the original, so the screen does not restart playback.
  if (state.id) await service(state.base, `/audio-transcode-stop?id=${state.id}`).catch(() => {});
  const converted = Boolean(state.id);
  state.id = "";
  state.onReady = state.onFallback;
  emitChanged(controller);
  if (!active(controller, state)) return;
  if (!converted) {
    if (state.pausedForPrepare && controller.isPlaying) {
      try {
        controller.getAvPlay()?.play?.();
      } catch (_) {}
    }
    state.onReady?.(false);
    emitChanged(controller);
    return;
  }
  await reload(controller, state, state.originalUrl).catch(() => {});
}
function poll(controller, state) {
  let busy = false,
    generation = 0,
    lastProgress = performance.now(),
    lastTime = -1;
  state.poll = setInterval(async () => {
    if (busy || !active(controller, state) || state.fallingBack) return;
    busy = true;
    try {
      // While AVPlay prepares the rewritten file it reports 0 and holds the
      // resume position as a deferred seek; the service paces output by this.
      // The cached clock: a native AVPlay call can block while it buffers.
      const time = Math.max(
        0,
        Number(controller.avplayCurrentTimeMs || 0) / 1000,
        Number(controller.avplayDeferredSeekMs || 0) / 1000
      );
      if (time > 0) state.lastPosition = time;
      if (
        state.awaitClockFromMs != null &&
        !state.seekPreparing &&
        time * 1000 > state.awaitClockFromMs + 100
      ) {
        state.awaitClockFromMs = null;
        emitChanged(controller);
      }
      const result = await service(state.base, `${state.path}/control?time=${time}`);
      if (!active(controller, state)) return;
      if (result.error) throw new Error("Audio conversion failed");
      if (!controller.isPlaying || time !== lastTime) lastProgress = performance.now();
      lastTime = time;
      if (result.g && result.g !== generation) {
        generation = result.g;
        lastProgress = performance.now();
      }
      // One worker follows every generation: AVPlay blocks this page while it
      // seeks, so a worker started here would arrive after AVPlay gave up.
      if (result.g && !state.worker && result.g !== state.finishedGeneration) {
        const url = URL.createObjectURL(
          new Blob(
            [`importScripts(${JSON.stringify(`${state.base}/audio-transcode/assets/worker.js`)});`],
            {
              type: "application/javascript"
            }
          )
        );
        try {
          state.worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        state.worker.onerror = () => {
          if (active(controller, state)) void fallback(controller, state);
        };
        state.workerGeneration = result.g;
        state.worker.onmessage = ({ data }) => {
          if (!active(controller, state)) return;
          if (data.type === "generation") state.workerGeneration = data.g;
          if (data.type === "ready" || data.type === "progress" || data.type === "generation")
            return;
          if (data.error || data.ret !== 0) return void fallback(controller, state);
          // End of the file: a later seek starts a new generation and worker.
          state.finishedGeneration = state.workerGeneration;
          state.worker.terminate();
          state.worker = null;
        };
        state.worker.postMessage({
          base: state.base,
          path: state.path,
          g: result.g,
          downmix: state.downmix,
          format: state.format,
          follow: true
        });
      }
      if (controller.isPlaying && performance.now() - lastProgress > 30000)
        throw new Error("Audio conversion stalled");
    } catch (_) {
      if (active(controller, state)) void fallback(controller, state);
    } finally {
      busy = false;
    }
  }, 500);
}
export function canUseTizenDtsAudioConversion() {
  if (!Platform.isTizen() || typeof WebAssembly !== "object" || typeof Worker !== "function")
    return false;
  // Firmware can report web.service=false and still start the packaged service
  // through the legacy launch that ensureStarted({ purpose: "subtitle" }) uses.
  const capabilities = TizenCapabilities.get();
  return Boolean(
    capabilities.engineFsServicePackaged &&
    !(capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4)
  );
}
export function createTizenDtsAudioMethods() {
  return {
    isTizenDtsAudioBuffering() {
      const state = this.tizenDtsAudioState;
      if (!state || state.fallingBack) return false;
      const awaitingClock =
        state.awaitClockFromMs != null && (this.isPlaying || this.avplayStartAfterSeek);
      return Boolean(state.preparing || state.cancelReload || state.seekPreparing || awaitingClock);
    },
    isTizenDtsAudioPreparing() {
      const state = this.tizenDtsAudioState;
      return Boolean(state && !state.fallingBack && (state.preparing || state.cancelReload));
    },
    hasTizenDtsAudioConversionFailed(embeddedIndex) {
      if (!Platform.isTizen()) return false;
      if (!canUseTizenDtsAudioConversion()) return true;
      const url = this.tizenDtsAudioState?.originalUrl || this.currentPlaybackUrl;
      return Boolean(this.tizenDtsAudioFailures?.has(`${url}|${embeddedIndex}`));
    },
    // seekAvPlayTo() calls this first. On the rewritten file the target must be
    // converted before AVPlay.seekTo(), which blocks the page until it has data.
    prepareTizenDtsAudioSeek(targetMs) {
      const state = this.tizenDtsAudioState;
      if (
        !state?.mediaUrl ||
        state.seekBypass ||
        state.preparing ||
        state.fallingBack ||
        this.avplayUrl !== state.mediaUrl
      )
        return false;
      const target = Math.max(0, Math.floor(Number(targetMs) || 0));
      // AVPlay is still filling its buffer at this target (the seek watchdog
      // retries it): a new generation would restart that buffer from scratch.
      if (state.awaitClockFromMs != null && Math.abs(target - state.awaitClockFromMs) < 1000)
        return true;
      state.seekTarget = target;
      if (state.seekPreparing) return true;
      state.seekPreparing = true;
      if (this.isPlaying && !this.avplayStartAfterSeek) {
        try {
          this.getAvPlay()?.pause?.();
        } catch (_) {}
        this.avplayStartAfterSeek = { syncTracks: false };
      }
      this.stopAvPlayTickTimer();
      holdForSeek(this, state.seekTarget);
      this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("seeking", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
      void (async () => {
        let target;
        do {
          target = state.seekTarget;
          await prepareSeek(this, state, target);
        } while (state.seekTarget !== target);
        state.seekPreparing = false;
        this.avplaySeekInFlight = false;
        state.seekBypass = true;
        try {
          this.seekAvPlayTo(target);
        } finally {
          state.seekBypass = false;
        }
      })().catch(() => {
        state.seekPreparing = false;
        this.avplaySeekInFlight = false;
        if (active(this, state)) void fallback(this, state);
      });
      return true;
    },
    stopTizenDtsAudioTranscode({ resetFailures = false } = {}) {
      const state = this.tizenDtsAudioState;
      this.tizenDtsAudioState = null;
      close(this, state);
      if (resetFailures || !this.tizenDtsAudioFailures) this.tizenDtsAudioFailures = new Set();
    },
    // `selectTrack(converted)` picks the AVPlay audio track once the source is
    // ready; `selectFallback()` restores a supported track after a failure.
    setTizenAudioTrackWithDtsConversion({
      track,
      embeddedIndex,
      attempt = false,
      resumeAfterSwitch = false,
      selectTrack,
      selectFallback
    }) {
      if (!Platform.isTizen() || !this.video || !this.isUsingAvPlay()) return false;
      const previous = this.tizenDtsAudioState;
      const originalUrl = previous?.originalUrl || this.currentPlaybackUrl;
      const needsRestore = Boolean(previous?.id);
      this.stopTizenDtsAudioTranscode();
      const key = `${originalUrl}|${embeddedIndex}`;
      const state = {
        originalUrl,
        targetIndex: embeddedIndex,
        key,
        lastPosition: Number(this.getCurrentTimeSeconds()) || 0,
        cancelled: false,
        fallingBack: false,
        resumePlayback: Boolean(resumeAfterSwitch || this.isPlaying || this.startupAudioGateActive),
        preparing: Boolean(needsRestore || (attempt && !this.tizenDtsAudioFailures.has(key))),
        onReady: selectTrack,
        onFallback: selectFallback
      };
      this.tizenDtsAudioState = state;
      if (state.preparing && attempt && this.isPlaying) {
        // The original file plays without this track: hold it while preparing.
        try {
          this.getAvPlay()?.pause?.();
          state.pausedForPrepare = true;
        } catch (_) {}
      }
      emitChanged(this);
      void (async () => {
        if (!attempt || this.tizenDtsAudioFailures.has(key)) {
          try {
            if (needsRestore) await reload(this, state, originalUrl);
            else if (active(this, state)) {
              state.onReady?.(false);
              emitChanged(this);
            }
          } catch (_) {
            void fallback(this, state);
          }
          // A supported track needs no conversion state once it plays.
          if (active(this, state) && !state.fallingBack) this.tizenDtsAudioState = null;
          return;
        }
        try {
          if (!canUseTizenDtsAudioConversion()) throw new Error("Audio conversion unavailable");
          const started = await TizenEngineFsService.ensureStarted({ purpose: "subtitle" });
          if (!active(this, state)) return;
          if (started?.status !== "success") throw new Error("Local audio service unavailable");
          state.base = serviceBase();
          if (!state.base) throw new Error("Local audio service unavailable");
          const created = await service(
            state.base,
            `/audio-transcode-create?url=${encodeURIComponent(originalUrl)}&trackNumber=${Number(track?.sourceTrackId) || 0}&trackIndex=${embeddedIndex}&ahead=60`
          );
          if (!active(this, state)) {
            if (created.id)
              void service(state.base, `/audio-transcode-stop?id=${created.id}`).catch(() => {});
            return;
          }
          state.id = created.id;
          state.path = created.path;
          state.downmix = created.downmix === true;
          state.format = created.format === "truehd" ? "truehd" : "dts";
          if (!state.id || !state.path) throw new Error("Audio conversion unavailable");
          const mediaUrl = `${state.base}${state.path}/media.mkv`;
          state.mediaUrl = mediaUrl;
          state.onVideoError = (event) => {
            if (this.tizenDtsAudioState === state && this.avplayUrl === mediaUrl) {
              event.stopImmediatePropagation();
              void fallback(this, state);
            }
          };
          this.video.addEventListener("error", state.onVideoError, true);
          poll(this, state);
          await reload(this, state, mediaUrl);
        } catch (_) {
          if (active(this, state)) void fallback(this, state);
        }
      })();
      return true;
    }
  };
}
