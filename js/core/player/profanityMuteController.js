import { findMuteState } from "./profanityFilter.js";

// Never sleep longer than this between checks: it bounds the error after a
// pause, a stalled clock or a rate change that did not trigger a resync.
const MAX_SLEEP_MS = 1000;
const MIN_SLEEP_MS = 30;
// Mute a little early: setting the audio state is not instant on every TV.
const LEAD_SECONDS = 0.05;

/**
 * Audio output control used by the profanity filter.
 *
 * Samsung AVPlay has no per-player volume, so the TV audio control is used.
 * Its `tv.audio` privilege is deprecated since Tizen 5.0 and some models
 * accept setMute() without muting, so every strategy is verified and the
 * next one is tried:
 *   1. tizen.tvaudiocontrol.setMute(true), checked with isMute();
 *   2. tizen.tvaudiocontrol.setVolume(0), checked with getVolume(), and the
 *      previous volume restored afterwards.
 * HTML5 <video> (webOS, Tizen hls.js/dash.js) uses the Web Audio gain node
 * when the audio boost graph owns the output, plus the element volume.
 *
 * The driver only undoes its own change: if the user muted the TV
 * themselves, it stays muted. `getLastError()` explains a failed mute.
 */
export function createProfanityMuteDriver({
  isUsingAvPlay = () => false,
  getVideo = () => null,
  getGainNode = () => null,
  getGainValue = () => 1
} = {}) {
  let mutedBy = null;
  let restoreVolume = 1;
  let lastError = "";
  const tvAudio = () => {
    try {
      return globalThis.tizen?.tvaudiocontrol || null;
    } catch (_) {
      return null;
    }
  };
  const describe = (error) => String(error?.name || error?.message || error || "unknown error");

  function muteTv() {
    const audio = tvAudio();
    if (!audio) {
      lastError = "TV audio control is not available";
      return false;
    }
    const errors = [];
    try {
      if (typeof audio.isMute === "function" && audio.isMute()) {
        lastError = "TV is already muted";
        return false;
      }
    } catch (error) {
      errors.push(`isMute: ${describe(error)}`);
    }
    if (typeof audio.setMute === "function") {
      try {
        audio.setMute(true);
        const verified = typeof audio.isMute !== "function" || audio.isMute() === true;
        if (verified) {
          mutedBy = "tv-mute";
          lastError = "";
          return true;
        }
        errors.push("setMute had no effect");
        audio.setMute(false);
      } catch (error) {
        errors.push(`setMute: ${describe(error)}`);
      }
    }
    if (typeof audio.setVolume === "function" && typeof audio.getVolume === "function") {
      try {
        const before = Number(audio.getVolume());
        if (before > 0) {
          audio.setVolume(0);
          if (Number(audio.getVolume()) === 0) {
            restoreVolume = before;
            mutedBy = "tv-volume";
            lastError = "";
            return true;
          }
          errors.push("setVolume had no effect");
          audio.setVolume(before);
        } else {
          errors.push("TV volume is already 0");
        }
      } catch (error) {
        errors.push(`setVolume: ${describe(error)}`);
      }
    }
    lastError = errors.join("; ") || "TV audio control cannot mute";
    return false;
  }

  function muteVideo() {
    const video = getVideo();
    const gain = getGainNode();
    if (!video && !gain) {
      lastError = "no video element";
      return false;
    }
    try {
      if (gain?.gain) {
        gain.gain.value = 0;
      }
      if (video) {
        restoreVolume = Number.isFinite(Number(video.volume)) ? Number(video.volume) : 1;
        video.volume = 0;
      }
      mutedBy = "video";
      lastError = "";
      return true;
    } catch (error) {
      lastError = `video volume: ${describe(error)}`;
      return false;
    }
  }

  return {
    isMuted() {
      return mutedBy !== null;
    },
    getLastError() {
      return lastError;
    },
    setMuted(muted) {
      if (muted) {
        if (mutedBy) {
          return true;
        }
        return isUsingAvPlay() ? muteTv() : muteVideo();
      }
      if (!mutedBy) {
        return true;
      }
      const owner = mutedBy;
      mutedBy = null;
      try {
        if (owner === "tv-mute") {
          tvAudio()?.setMute?.(false);
        } else if (owner === "tv-volume") {
          tvAudio()?.setVolume?.(restoreVolume);
        } else {
          const gain = getGainNode();
          if (gain?.gain) {
            gain.gain.value = Number(getGainValue()) || 1;
          }
          const video = getVideo();
          if (video) {
            video.volume = restoreVolume > 0 ? restoreVolume : 1;
          }
        }
      } catch (_) {
        // Ignore: the player may already be torn down.
      }
      return true;
    }
  };
}

/**
 * Schedules mutes from precomputed ranges (look-ahead, addon/extracted
 * subtitles) and from live cues (AVPlay subtitle callbacks, where the text is
 * only known as it is shown).
 */
export class ProfanityMuteController {
  constructor({
    driver,
    getSubtitleTime,
    getPlaybackRate = () => 1,
    isPlaying = () => true,
    onMuteChange = () => {},
    onMuteFailed = () => {}
  }) {
    this.driver = driver;
    this.getSubtitleTime = getSubtitleTime;
    this.getPlaybackRate = getPlaybackRate;
    this.isPlaying = isPlaying;
    this.onMuteChange = onMuteChange;
    this.onMuteFailed = onMuteFailed;
    this.ranges = [];
    this.liveUntil = 0;
    this.liveTimers = [];
    this.timer = null;
    this.muted = false;
    this.enabled = true;
    this.destroyed = false;
  }

  setRanges(ranges) {
    this.ranges = Array.isArray(ranges) ? ranges : [];
    this.sync();
  }

  hasRanges() {
    return this.ranges.length > 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.clearLive();
    }
    this.sync();
  }

  clearLive() {
    this.liveTimers.forEach((timer) => clearTimeout(timer));
    this.liveTimers = [];
    this.liveUntil = 0;
  }

  /**
   * Live windows, in milliseconds from now, for a cue that is on screen right
   * now. Used when no look-ahead cue list exists.
   */
  muteLive(windows = []) {
    if (!this.enabled || this.destroyed) {
      return;
    }
    const rate = this.safeRate();
    windows.forEach(({ startMs, endMs }) => {
      const begin = Math.max(0, startMs / rate);
      const finish = Math.max(begin + 50, endMs / rate);
      this.liveTimers.push(
        setTimeout(() => {
          this.liveUntil = Math.max(this.liveUntil, Date.now() + (finish - begin));
          this.sync();
        }, begin)
      );
    });
  }

  safeRate() {
    const rate = Number(this.getPlaybackRate());
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  applyMuted(muted) {
    if (muted === this.muted) {
      return;
    }
    const applied = this.driver?.setMuted(muted);
    if (muted && !applied) {
      this.onMuteFailed(this.driver?.getLastError?.() || "");
      return;
    }
    this.muted = muted;
    this.onMuteChange(muted);
  }

  /** Re-evaluate now; call on timeupdate, seek, play, pause and rate change. */
  sync() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.destroyed) {
      return;
    }
    if (!this.enabled || !this.isPlaying()) {
      this.applyMuted(false);
      if (!this.enabled) this.clearLive();
      return;
    }
    const now = Date.now();
    const liveMuted = this.liveUntil > now;
    const time = Number(this.getSubtitleTime());
    const state = findMuteState(this.ranges, time + LEAD_SECONDS);
    this.applyMuted(liveMuted || state.muted);
    const rate = this.safeRate();
    let sleepMs = MAX_SLEEP_MS;
    if (Number.isFinite(state.nextBoundary)) {
      sleepMs = Math.min(sleepMs, ((state.nextBoundary - LEAD_SECONDS - time) * 1000) / rate);
    }
    if (liveMuted) {
      sleepMs = Math.min(sleepMs, this.liveUntil - now);
    }
    if (!this.ranges.length && !liveMuted && !this.muted) {
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.sync();
      },
      Math.max(MIN_SLEEP_MS, Math.min(MAX_SLEEP_MS, Math.ceil(sleepMs)))
    );
  }

  destroy() {
    this.destroyed = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearLive();
    if (this.muted) {
      this.driver?.setMuted(false);
      this.muted = false;
      this.onMuteChange(false);
    }
  }
}
