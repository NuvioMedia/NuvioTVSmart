// LG's native file player settles currentTime at the preceding keyframe only
// after emitting seeked. Decode silently to the requested position to provide
// the exact-seek contract used by Android's Watch Party player.
const SEEK_TIMEOUT_MS = 30000;
const POLL_MS = 50;
const HELD_EVENTS = [
  "seeking",
  "seeked",
  "waiting",
  "playing",
  "pause",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "timeupdate"
];

export function createWebOsExactSeekMethods({
  every = (callback, ms) => setInterval(callback, ms),
  stopEvery = (id) => clearInterval(id),
  later = (callback, ms) => setTimeout(callback, ms),
  stopLater = (id) => clearTimeout(id)
} = {}) {
  const operations = new WeakMap();

  function notifyVisual(controller, operation, moving) {
    if (operation.visualMoving === moving) return;
    operation.visualMoving = moving;
    controller.emitVideoEvent("webosexactseekvisual", { moving });
  }

  function cleanup(controller, operation) {
    if (operations.get(controller) !== operation) return false;
    operations.delete(controller);
    stopEvery(operation.poll);
    stopLater(operation.timeout);
    for (const event of HELD_EVENTS)
      operation.video.removeEventListener(event, operation.hold, true);
    operation.video.removeEventListener("error", operation.error, true);
    operation.video.removeEventListener("emptied", operation.emptied, true);
    operation.video.removeEventListener("ended", operation.ended, true);
    return true;
  }

  function resolveRestoreMuted(controller, operation) {
    if (
      operation.startedGated &&
      !controller.startupAudioGateActive &&
      !controller.startupPresentationAudioMuted
    ) {
      return false;
    }
    return operation.muted;
  }

  function complete(controller, operation) {
    if (!cleanup(controller, operation)) return;
    const video = operation.video;
    if (operation.paused) video.pause();
    controller.isPlaying = !operation.paused && !video.ended;
    video.muted = resolveRestoreMuted(controller, operation);
    controller.syncWebOsPlaybackKeepAwake?.();
    controller.emitVideoEvent("seeked", { exactNativeSeek: true });
    controller.emitVideoEvent("canplay", { exactNativeSeek: true });
    if (controller.isPlaying) controller.emitVideoEvent("playing", { exactNativeSeek: true });
    controller.scheduleProgressSyncAfterSeek?.();
  }

  function fail(controller, operation, timeout = false) {
    if (!cleanup(controller, operation)) return;
    // Never leave the internal decode pass audible or playing after failure.
    operation.video.pause();
    operation.video.muted = resolveRestoreMuted(controller, operation);
    controller.isPlaying = false;
    controller.syncWebOsPlaybackKeepAwake?.();
    controller.lastPlaybackErrorCode = 2;
    controller.emitVideoEvent("error", {
      playbackEngine: controller.playbackEngine,
      mediaErrorCode: 2,
      seekTimeout: timeout
    });
  }

  return {
    isWebOsExactSeekInFlight() {
      return operations.has(this);
    },
    getWebOsExactSeekTargetSeconds() {
      return operations.get(this)?.target ?? null;
    },
    setWebOsExactSeekPaused(paused) {
      const operation = operations.get(this);
      if (!operation) return false;
      operation.paused = Boolean(paused);
      this.isPlaying = !operation.paused;
      return true;
    },
    syncWebOsExactSeekMuted(muted) {
      const operation = operations.get(this);
      if (!operation) return false;
      const nextMuted = Boolean(muted);
      operation.muted = nextMuted;
      operation.startedGated = nextMuted;
      operation.video.muted = true;
      return true;
    },
    cancelWebOsExactSeek({ pause } = {}) {
      const operation = operations.get(this);
      if (!operation || !cleanup(this, operation)) return;
      if (pause ?? operation.paused) operation.video.pause();
      operation.video.muted = resolveRestoreMuted(this, operation);
    },
    seekWebOsExactly(seconds, { paused = this.video?.paused } = {}) {
      const video = this.video;
      if (!video || !Number.isFinite(seconds) || seconds < 0) return false;
      this.cancelProgressSyncAfterSeek?.();
      const previous = operations.get(this);
      const startedGated = Boolean(
        this.startupAudioGateActive || this.startupPresentationAudioMuted
      );
      const muted = previous ? previous.muted : video.muted;
      if (previous) cleanup(this, previous);
      const duration = Number(video.duration);
      const target =
        Number.isFinite(duration) && duration > 0 ? Math.min(seconds, duration) : seconds;
      const operation = {
        video,
        target,
        paused: Boolean(paused),
        muted,
        startedGated: previous ? Boolean(previous.startedGated) : startedGated,
        generation: this.playRequestToken,
        last: target,
        advanced: false,
        visualAdvanced: false,
        visualMoving: false,
        poll: null,
        timeout: null
      };
      operations.set(this, operation);
      // Native transport events describe the decode pass, not user play intent.
      // Publish settled events only after the decoder reaches the exact target.
      operation.hold = (event) => {
        if (event.type === "seeking") operation.advanced = false;
        if (event.type === "seeking" || event.type === "waiting") {
          operation.visualAdvanced = false;
          notifyVisual(this, operation, false);
        }
        event.stopImmediatePropagation();
      };
      operation.error = () => {
        if (cleanup(this, operation)) {
          video.pause();
          video.muted = resolveRestoreMuted(this, operation);
          this.isPlaying = false;
        }
      };
      operation.emptied = () => this.cancelWebOsExactSeek({ pause: true });
      operation.ended = () => {
        if (video.ended && Number.isFinite(duration) && target >= duration)
          complete(this, operation);
      };
      for (const event of HELD_EVENTS) video.addEventListener(event, operation.hold, true);
      video.addEventListener("error", operation.error, true);
      video.addEventListener("emptied", operation.emptied, true);
      video.addEventListener("ended", operation.ended, true);
      video.muted = true;
      try {
        video.currentTime = target;
      } catch (_) {
        this.cancelWebOsExactSeek();
        return false;
      }
      operation.poll = every(() => {
        if (operations.get(this) !== operation) return;
        if (this.video !== video || this.playRequestToken !== operation.generation) {
          this.cancelWebOsExactSeek({ pause: true });
          return;
        }
        const current = Number(video.currentTime);
        const step = current - operation.last;
        operation.last = current;
        if (!Number.isFinite(current) || step < 0 || step >= 1) operation.advanced = false;
        if (!Number.isFinite(current) || step < 0 || step >= 1) operation.visualAdvanced = false;
        if (!video.seeking && video.readyState >= 3 && step > 0.01 && step < 1)
          operation.advanced = true;
        if (!video.seeking && video.readyState >= 3 && step > 0.01 && step < 1)
          operation.visualAdvanced = true;
        // Presentation only: earlier keyframes may already be moving while the
        // exact seek remains pending and muted. Do not publish readiness here.
        notifyVisual(
          this,
          operation,
          operation.visualAdvanced && !video.seeking && video.readyState >= 3
        );
        if (operation.advanced && !video.seeking && video.readyState >= 3 && current >= target) {
          complete(this, operation);
        }
      }, POLL_MS);
      operation.timeout = later(() => fail(this, operation, true), SEEK_TIMEOUT_MS);
      if (video.paused) {
        try {
          const result = video.play();
          result?.catch?.(() => fail(this, operation));
        } catch (_) {
          fail(this, operation);
          return false;
        }
      }
      return true;
    }
  };
}
