// Software AAC audio path for the Tizen MP4 MSE engine.
//
// Decodes AAC-LC elementary streams with WebAudio decodeAudioData (Chromium's
// software decoder) and plays the resulting PCM, so the TV's failing hardware
// AAC decoder used by MSE/AVPlay never receives these frames. Picture stays on
// the existing MSE pipeline.

const ADTS_HEADER_BYTES = 7;

const SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350
];

const DECODE_AHEAD_LIMIT_SECONDS = 30;
const PENDING_LIMIT_SECONDS = 45;
const SCHEDULE_LEAD_SECONDS = 0.12;
const DRIFT_LIMIT_SECONDS = 0.15;
const LATE_DROP_SECONDS = 0.25;
const SYNC_INTERVAL_MS = 250;

export function resolveAacConfig(track) {
  if (!track || typeof track !== "object") return null;
  const codec = track.codec;
  const audio = track.audio && typeof track.audio === "object" ? track.audio : null;
  if (!audio) return null;
  const sampleRate = Number(audio.sample_rate);
  const channelCount = Number(audio.channel_count);
  const frequencyIndex = SAMPLE_RATES.indexOf(sampleRate);
  if (typeof codec !== "string" || !/^mp4a\.40\.2$/.test(codec)) return null;
  if (frequencyIndex < 0) return null;
  if (channelCount !== 1 && channelCount !== 2) return null;
  return { objectType: 2, frequencyIndex, channelConfig: channelCount, sampleRate };
}

export function buildAdtsHeader({ objectType, frequencyIndex, channelConfig, frameLength }) {
  if (frameLength > 0x1fff) {
    throw new Error("AAC frame too large");
  }
  const profile = objectType - 1;
  const b0 = 0xff;
  const b1 = 0xf1;
  const b2 = (profile << 6) | (frequencyIndex << 2) | (channelConfig >> 2);
  const b3 = ((channelConfig & 3) << 6) | (frameLength >> 11);
  const b4 = (frameLength >> 3) & 0xff;
  const b5 = ((frameLength & 0x07) << 5) | 0x1f;
  const b6 = 0xfc;
  return new Uint8Array([b0, b1, b2, b3, b4, b5, b6]);
}

export function buildAdtsChunk(samples, config) {
  const list = Array.isArray(samples) ? samples : [];
  const used = list.filter((sample) => sample && sample.data);
  if (!used.length) return null;

  const parts = [];
  let total = 0;
  for (const sample of used) {
    const frameLength = ADTS_HEADER_BYTES + sample.data.length;
    const header = buildAdtsHeader({
      objectType: config.objectType,
      frequencyIndex: config.frequencyIndex,
      channelConfig: config.channelConfig,
      frameLength
    });
    const combined = new Uint8Array(frameLength);
    combined.set(header, 0);
    combined.set(sample.data, ADTS_HEADER_BYTES);
    parts.push(combined);
    total += frameLength;
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }

  const first = used[0];
  const startTime = first.cts / first.timescale;
  const duration = used.reduce((sum, sample) => sum + sample.duration, 0) / first.timescale;
  return { data, startTime, duration };
}

export function computeSchedule({ anchorCtxTime, anchorMediaTime, mediaTime, ctxTime, rate }) {
  const r = Number(rate) > 0 ? Number(rate) : 1;
  const when = anchorCtxTime + (mediaTime - anchorMediaTime) / r;
  if (when >= ctxTime) {
    return { when, offset: 0, late: 0 };
  }
  const late = ctxTime - when;
  return { when: ctxTime, offset: late * r, late };
}

export class Mp4MseAudioPlayer {
  constructor({ video, config, timestampOffset, onFatalError }) {
    this.video = video;
    this.config = config;
    this.timestampOffset = timestampOffset;
    this.onFatalError = onFatalError;
    this.destroyed = false;
    this.ctx = null;
    this.gain = null;
    this.anchor = null;
    this.decoded = [];
    this.pending = [];
    this.decoding = false;
    this.stalled = false;
    this.timer = null;
  }

  static isSupported() {
    return (
      typeof globalThis.AudioContext === "function" ||
      typeof globalThis.webkitAudioContext === "function"
    );
  }

  _createContext() {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new Ctor();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.setVolume(this.video?.muted, this.video?.volume);
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
  }

  rate() {
    const r = Number(this.video?.playbackRate);
    return r > 0 ? r : 1;
  }

  pushSamples(samples) {
    if (this.destroyed) return;
    if (!this.ctx) this._createContext();

    const chunk = buildAdtsChunk(samples, this.config);
    if (!chunk) return;

    this.pending.push({
      mediaTime: chunk.startTime + this.timestampOffset,
      duration: chunk.duration,
      data: chunk.data,
      buffer: null,
      node: null,
      startCtx: null,
      dead: false
    });

    let total = this.pending.reduce((sum, item) => sum + item.duration, 0);
    while (total > PENDING_LIMIT_SECONDS && this.pending.length > 1) {
      const removed = this.pending.shift();
      total -= removed.duration;
    }

    this.decodeNext();
  }

  decodedAhead() {
    const ct = Number(this.video?.currentTime || 0);
    let sum = 0;
    for (const item of this.decoded) {
      if (item.dead) continue;
      if (item.mediaTime + item.duration > ct) sum += item.duration;
    }
    return sum;
  }

  decodeNext() {
    if (this.destroyed || this.decoding || !this.ctx) return;
    if (this.decodedAhead() >= DECODE_AHEAD_LIMIT_SECONDS) return;

    const chunk = this.pending.shift();
    if (!chunk) return;
    if (!chunk.data) {
      this.decodeNext();
      return;
    }

    this.decoding = true;
    this.ctx
      .decodeAudioData(chunk.data.slice().buffer)
      .then((buffer) => {
        if (this.destroyed) return;
        chunk.buffer = buffer;
        this.decoded.push(chunk);
        chunk.data = null;
        this.scheduleDecoded();
        this.decoding = false;
        this.decodeNext();
      })
      .catch((error) => {
        if (this.destroyed) return;
        this.decoding = false;
        this.fail(error);
      });
  }

  scheduleDecoded() {
    if (!this.anchor || !this.ctx || this.ctx.state !== "running") return;
    const rate = this.rate();
    const ct = Number(this.video?.currentTime || 0);
    for (const item of this.decoded) {
      if (item.node || item.dead || !item.buffer) continue;
      const { when, offset, late } = computeSchedule({
        anchorCtxTime: this.anchor.ctxTime,
        anchorMediaTime: this.anchor.mediaTime,
        mediaTime: item.mediaTime,
        ctxTime: this.ctx.currentTime,
        rate
      });
      if (late * rate > item.duration + LATE_DROP_SECONDS) {
        item.dead = true;
        continue;
      }
      if (offset >= item.duration) {
        item.dead = true;
        continue;
      }
      const node = this.ctx.createBufferSource();
      node.buffer = item.buffer;
      node.playbackRate.value = rate;
      node.connect(this.gain);
      node.onended = () => {
        try {
          node.disconnect();
        } catch (_) {}
      };
      node.start(when, offset);
      item.node = node;
      item.startCtx = when;
    }
    this.decoded = this.decoded.filter((item) => !(item.mediaTime + item.duration < ct - 1));
  }

  reanchor() {
    if (!this.ctx) return;
    this.stopNodes();
    const r = this.rate();
    const videoTime = Number(this.video?.currentTime || 0);
    this.anchor = {
      ctxTime: this.ctx.currentTime + SCHEDULE_LEAD_SECONDS,
      mediaTime: videoTime + SCHEDULE_LEAD_SECONDS * r
    };
    this.scheduleDecoded();
  }

  sync() {
    if (this.destroyed || !this.ctx) return;
    const video = this.video;
    if (!video || video.paused || video.seeking || this.stalled) return;
    const r = this.rate();
    if (
      !this.anchor ||
      Math.abs(
        Number(video.currentTime || 0) -
          (this.anchor.mediaTime + (this.ctx.currentTime - this.anchor.ctxTime) * r)
      ) > DRIFT_LIMIT_SECONDS
    ) {
      this.reanchor();
    }
    this.scheduleDecoded();
    this.decodeNext();
  }

  onPlaybackEvent(name) {
    const video = this.video;
    switch (name) {
      case "playing":
        this.stalled = false;
        this.ctx?.resume?.().catch?.(() => {});
        if (this.ctx) this.reanchor();
        break;
      case "play":
        this.ctx?.resume?.().catch?.(() => {});
        break;
      case "pause":
        this.anchor = null;
        this.stopNodes();
        this.ctx?.suspend?.().catch?.(() => {});
        break;
      case "waiting":
        this.stalled = true;
        this.anchor = null;
        this.stopNodes();
        this.ctx?.suspend?.().catch?.(() => {});
        break;
      case "seeking":
        this.anchor = null;
        this.stalled = false;
        this.stopNodes();
        this.decoded.length = 0;
        this.pending.length = 0;
        break;
      case "seeked":
        this.stalled = false;
        if (!video?.paused) {
          this.ctx?.resume?.().catch?.(() => {});
          if (this.ctx) this.reanchor();
        }
        break;
      case "ratechange":
        if (this.ctx) this.reanchor();
        break;
      case "volumechange":
        this.setVolume(video?.muted, video?.volume);
        break;
      default:
        break;
    }
  }

  setVolume(muted, volume) {
    if (!this.gain) return;
    this.gain.gain.value = muted ? 0 : Math.max(0, Math.min(1, Number(volume)));
  }

  state() {
    return this.ctx?.state || "none";
  }

  stopNodes() {
    if (!this.ctx) return;
    for (const item of this.decoded) {
      if (item.node) {
        try {
          item.node.stop();
        } catch (_) {}
        try {
          item.node.disconnect();
        } catch (_) {}
        const started = item.startCtx !== null && item.startCtx <= this.ctx.currentTime;
        if (started) item.dead = true;
        item.node = null;
        item.startCtx = null;
      }
    }
    this.decoded = this.decoded.filter((item) => !item.dead);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopNodes();
    this.decoded.length = 0;
    this.pending.length = 0;
    this.ctx?.close?.()?.catch?.(() => {});
    this.ctx = null;
    this.gain = null;
  }

  fail(error) {
    if (this.destroyed) return;
    const cb = this.onFatalError;
    this.onFatalError = null;
    this.destroy();
    try {
      cb?.(error);
    } catch (_) {}
  }
}
