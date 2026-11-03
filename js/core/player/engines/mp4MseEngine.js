import { Mp4MseAudioPlayer, resolveAacConfig } from "./mp4MseAudio.js";

// Plays a progressive (non-fragmented) MP4 through Media Source Extensions.
//
// Samsung Tizen hands `<video src=file.mp4>` to the same platform progressive
// player that AVPlay uses, so both drop audio on some files. MSE feeds the
// decoder elementary streams instead, the path hls.js already uses on Tizen.
// mp4box.js fragments the file on the fly from ranged reads; the session keeps
// a bounded buffer window and refetches from the matching byte offset on seek.

const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_AHEAD_SECONDS = 45;
const KEEP_BEHIND_SECONDS = 30;
const AUDIO_MEDIA_EVENTS = [
  "playing",
  "play",
  "pause",
  "waiting",
  "seeked",
  "ratechange",
  "volumechange"
];
const SEGMENT_SECONDS = 4;
const FETCH_RETRY_LIMIT = 3;
// A read that stalls (seen with a TV-local proxy) must not freeze playback;
// abort it and retry from the same offset.
const FETCH_TIMEOUT_MS = 15000;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const MAX_START_GAP_SECONDS = 10;

function getMp4Box() {
  return globalThis.MP4Box || null;
}

// mp4box emits media timestamps and ignores the edit list. Apply it the way a
// progressive player does, so a leading cut (e.g. a clip starting 4 s past a
// keyframe) or AAC priming neither leaves a gap at 0 nor shifts A/V sync.
function editListOffsetSeconds(file, trackId, movieTimescale) {
  const trak = file.getTrackById(trackId);
  const entries = trak?.edts?.elst?.entries;
  const trackTimescale = Number(trak?.mdia?.mdhd?.timescale);
  if (!Array.isArray(entries) || !(trackTimescale > 0) || !(movieTimescale > 0)) {
    return 0;
  }
  let emptyEditSeconds = 0;
  for (const edit of entries) {
    if (Number(edit.media_time) === -1) {
      emptyEditSeconds += Number(edit.segment_duration) / movieTimescale;
      continue;
    }
    return emptyEditSeconds - Number(edit.media_time) / trackTimescale;
  }
  return 0;
}

function bufferedAheadSeconds(sourceBuffer, time) {
  try {
    const ranges = sourceBuffer.buffered;
    for (let index = 0; index < ranges.length; index += 1) {
      if (time >= ranges.start(index) - 0.25 && time <= ranges.end(index)) {
        return ranges.end(index) - time;
      }
    }
  } catch (_) {
    // A removed SourceBuffer reports no buffered data.
  }
  return 0;
}

class Mp4MseSession {
  constructor(video, url, { onFatalError = null, fetchImpl = null } = {}) {
    this.video = video;
    this.url = url;
    this.onFatalError = onFatalError;
    this.fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
    this.destroyed = false;
    this.ready = false;
    this.eof = false;
    this.fetching = false;
    this.nextOffset = 0;
    this.generation = 0;
    this.retryCount = 0;
    this.abortController = null;
    this.wakeTimer = null;
    this.audio = null;
    this.onMediaAudioEvent = (event) => this.audio?.onPlaybackEvent(event.type);
    this.mediaSource = new globalThis.MediaSource();
    this.tracks = [];
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.file = getMp4Box().createFile();
    this.file.onError = (error) => this.fail(new Error(`MP4 parse error: ${error}`));
    this.file.onReady = (info) => this.handleReady(info);
    this.file.onSegment = (trackId, entry, buffer, sampleNumber) => {
      this.enqueue(entry, buffer);
      this.file.releaseUsedSamples(trackId, sampleNumber);
    };
    this.onSourceOpen = () => {
      this.mediaSource.removeEventListener("sourceopen", this.onSourceOpen);
      this.scheduleFetch(0);
    };
    this.onSeeking = () => this.handleSeeking();
    this.onTimeUpdate = () => this.scheduleFetch(0);
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
    video.addEventListener("seeking", this.onSeeking);
    video.addEventListener("timeupdate", this.onTimeUpdate);
    for (const name of AUDIO_MEDIA_EVENTS) video.addEventListener(name, this.onMediaAudioEvent);
    video.src = this.objectUrl;
  }

  getStats() {
    return {
      bufferedAhead: this.bufferedAhead(),
      nextOffset: this.nextOffset,
      eof: this.eof,
      fetching: this.fetching,
      audio: this.audio ? "software" : "mse",
      audioAhead: this.audio ? this.audio.decodedAhead() : 0,
      audioState: this.audio ? this.audio.state() : null
    };
  }

  bufferedAhead() {
    const tracks = this.audio ? this.tracks.filter((track) => track.kind === "video") : this.tracks;
    if (!tracks.length) {
      return 0;
    }
    const time = Number(this.video.currentTime || 0);
    return Math.min(...tracks.map((track) => bufferedAheadSeconds(track.sourceBuffer, time)));
  }

  queuedBytes() {
    return this.tracks.reduce(
      (total, track) => total + track.queue.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      0
    );
  }

  scheduleFetch(delayMs) {
    if (this.destroyed) {
      return;
    }
    clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.fetchNext();
    }, delayMs);
  }

  async fetchNext() {
    if (this.destroyed || this.fetching || this.eof || this.mediaSource.readyState === "closed") {
      return;
    }
    if (
      this.ready &&
      (this.bufferedAhead() >= MAX_AHEAD_SECONDS || this.queuedBytes() >= MAX_QUEUED_BYTES)
    ) {
      // timeupdate and SourceBuffer updateend wake the loop again.
      return;
    }
    const generation = this.generation;
    const start = this.nextOffset;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this.fetching = true;
    this.abortController = controller;
    let continueLoop = false;
    let timedOut = false;
    const timeoutId = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, FETCH_TIMEOUT_MS)
      : null;
    try {
      const response = await this.fetchImpl(this.url, {
        headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` },
        signal: controller?.signal
      });
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      if (response.status === 416) {
        this.finishStream();
        return;
      }
      if (!response.ok) {
        throw new Error(`MP4 range request failed with HTTP ${response.status}`);
      }
      if (response.status !== 206 && start > 0) {
        throw new Error("MP4 source does not support range requests");
      }
      const data = await response.arrayBuffer();
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      this.retryCount = 0;
      if (!data.byteLength) {
        this.finishStream();
        return;
      }
      data.fileStart = start;
      const next = Number(this.file.appendBuffer(data));
      this.nextOffset = Number.isFinite(next) && next > start ? next : start + data.byteLength;
      if (response.status !== 206 || data.byteLength < CHUNK_BYTES) {
        this.finishStream();
        return;
      }
      continueLoop = true;
    } catch (error) {
      if (
        this.destroyed ||
        generation !== this.generation ||
        (error?.name === "AbortError" && !timedOut)
      ) {
        return;
      }
      this.retryCount += 1;
      if (this.retryCount > FETCH_RETRY_LIMIT) {
        this.fail(error);
        return;
      }
      this.fetching = false;
      this.scheduleFetch(1000 * 2 ** (this.retryCount - 1));
      return;
    } finally {
      clearTimeout(timeoutId);
      if (generation === this.generation) {
        this.fetching = false;
        this.abortController = null;
      }
    }
    if (continueLoop) {
      this.scheduleFetch(0);
    }
  }

  handleReady(info) {
    if (this.destroyed) {
      return;
    }
    const videoTracks = Array.isArray(info?.videoTracks) ? info.videoTracks : [];
    const audioTracks = Array.isArray(info?.audioTracks) ? info.audioTracks : [];
    const audioTrack = audioTracks[0] || null;
    const audioConfig = audioTrack ? resolveAacConfig(audioTrack) : null;
    const softwareAudio = Boolean(audioConfig && Mp4MseAudioPlayer.isSupported());
    const sources = [
      ...videoTracks.map((track) => ({ track, kind: "video" })),
      ...(softwareAudio || !audioTrack ? [] : [{ track: audioTrack, kind: "audio" }])
    ];
    if (!sources.length) {
      this.fail(new Error("MP4 has no audio or video tracks"));
      return;
    }
    try {
      for (const { track, kind } of sources) {
        const mimeType = `${kind}/mp4; codecs="${track.codec}"`;
        if (!globalThis.MediaSource.isTypeSupported(mimeType)) {
          throw new Error(`MSE does not support ${mimeType}`);
        }
        const sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
        const timestampOffset = editListOffsetSeconds(this.file, track.id, Number(info.timescale));
        if (timestampOffset) {
          sourceBuffer.timestampOffset = timestampOffset;
        }
        const seconds = Number(track.duration) / Number(track.timescale);
        const samplesPerSecond = seconds > 0 ? Number(track.nb_samples) / seconds : 25;
        const nbSamples = Math.max(
          10,
          Math.min(1000, Math.round(samplesPerSecond * SEGMENT_SECONDS))
        );
        const entry = { id: track.id, kind, mimeType, sourceBuffer, timestampOffset, queue: [] };
        sourceBuffer.addEventListener("updateend", () => this.pump(entry));
        this.file.setSegmentOptions(track.id, entry, { nbSamples });
        this.tracks.push(entry);
      }
      if (softwareAudio) {
        this.audio = new Mp4MseAudioPlayer({
          video: this.video,
          config: audioConfig,
          timestampOffset: editListOffsetSeconds(this.file, audioTrack.id, Number(info.timescale)),
          onFatalError: (error) => this.fail(error)
        });
        this.file.setExtractionOptions(audioTrack.id, null, { nbSamples: 47 });
        this.file.onSamples = (trackId, _user, samples) => {
          if (!this.audio || !samples?.length) return;
          this.audio.pushSamples(samples);
          this.file.releaseUsedSamples(trackId, Number(samples[samples.length - 1]?.number) + 1);
        };
      }
      const duration = Number(info.duration) / Number(info.timescale);
      if (Number.isFinite(duration) && duration > 0) {
        this.mediaSource.duration = duration;
      }
    } catch (error) {
      this.fail(error);
      return;
    }
    const initSegments = this.file.initializeSegmentation();
    initSegments.forEach((segment) => this.enqueue(segment.user, segment.buffer));
    this.ready = true;
    this.file.start();
    if (Number(this.video.currentTime || 0) > 0.5) {
      // A resume position was applied before the movie header arrived.
      this.handleSeeking();
    }
  }

  enqueue(entry, buffer) {
    if (this.destroyed || !entry) {
      return;
    }
    entry.queue.push(buffer);
    this.pump(entry);
  }

  evict(entry, keepSeconds) {
    const sourceBuffer = entry.sourceBuffer;
    const time = Number(this.video.currentTime || 0);
    try {
      const ranges = sourceBuffer.buffered;
      if (ranges.length && ranges.start(0) < time - keepSeconds - 1) {
        sourceBuffer.remove(ranges.start(0), time - keepSeconds);
        return true;
      }
    } catch (_) {
      // Eviction is best effort; appending continues without it.
    }
    return false;
  }

  pump(entry) {
    if (this.destroyed) {
      return;
    }
    this.jumpStartGap();
    const sourceBuffer = entry.sourceBuffer;
    if (sourceBuffer.updating || this.mediaSource.readyState === "closed") {
      return;
    }
    if (this.evict(entry, KEEP_BEHIND_SECONDS)) {
      return;
    }
    const buffer = entry.queue.shift();
    if (!buffer) {
      this.maybeEndOfStream();
      this.scheduleFetch(0);
      return;
    }
    try {
      sourceBuffer.appendBuffer(buffer);
    } catch (error) {
      if (error?.name === "QuotaExceededError") {
        entry.queue.unshift(buffer);
        if (!this.evict(entry, 5)) {
          setTimeout(() => this.pump(entry), 1000);
        }
        return;
      }
      this.fail(error);
    }
  }

  // MSE drops frames before an edit's start and resumes at the next keyframe,
  // so the first point where every track has data can sit just past 0. Jump
  // there instead of stalling at readyState 1.
  jumpStartGap() {
    const time = Number(this.video.currentTime || 0);
    if (this.video.seeking || time > 0.5 || !this.tracks.length) {
      return;
    }
    let start = 0;
    for (const track of this.tracks) {
      const ranges = track.sourceBuffer.buffered;
      if (!ranges.length) {
        return;
      }
      start = Math.max(start, ranges.start(0));
    }
    if (start > time + 0.1 && start - time <= MAX_START_GAP_SECONDS) {
      this.video.currentTime = start;
    }
  }

  finishStream() {
    this.eof = true;
    try {
      this.file.flush();
    } catch (_) {
      // Remaining samples were already segmented.
    }
    this.maybeEndOfStream();
  }

  maybeEndOfStream() {
    if (
      !this.eof ||
      this.mediaSource.readyState !== "open" ||
      this.tracks.some((track) => track.queue.length || track.sourceBuffer.updating)
    ) {
      return;
    }
    try {
      this.mediaSource.endOfStream();
    } catch (_) {
      // A later seek reopens the source; endOfStream is retried then.
    }
  }

  handleSeeking() {
    if (this.destroyed || !this.ready) {
      return;
    }
    this.audio?.onPlaybackEvent("seeking");
    const time = Number(this.video.currentTime || 0);
    if (this.tracks.every((track) => bufferedAheadSeconds(track.sourceBuffer, time) > 0.5)) {
      return;
    }
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.fetching = false;
    this.retryCount = 0;
    this.tracks.forEach((track) => {
      track.queue.length = 0;
    });
    // One media time for every track: the latest-starting track's mapping
    // makes each track's refetch begin at or before the target.
    const mediaTime = time - Math.max(0, ...this.tracks.map((track) => track.timestampOffset));
    const position = this.file.seek(Math.max(0, mediaTime), true);
    this.nextOffset = Number.isFinite(Number(position?.offset)) ? Number(position.offset) : 0;
    this.eof = false;
    this.scheduleFetch(0);
  }

  fail(error) {
    if (this.destroyed) {
      return;
    }
    const onFatalError = this.onFatalError;
    this.onFatalError = null;
    this.destroy();
    onFatalError?.(error);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.audio?.destroy();
    this.audio = null;
    this.file.onSamples = null;
    this.video.removeEventListener("seeking", this.onSeeking);
    this.video.removeEventListener("timeupdate", this.onTimeUpdate);
    for (const name of AUDIO_MEDIA_EVENTS) {
      this.video.removeEventListener(name, this.onMediaAudioEvent);
    }
    this.mediaSource.removeEventListener("sourceopen", this.onSourceOpen);
    try {
      this.file.stop?.();
    } catch (_) {
      // The parser is discarded with the session.
    }
    this.tracks.forEach((track) => {
      track.queue.length = 0;
    });
    if (this.video.src === this.objectUrl) {
      this.video.removeAttribute("src");
      try {
        this.video.load();
      } catch (_) {
        // The next source assignment resets the element.
      }
    }
    URL.revokeObjectURL(this.objectUrl);
  }
}

export const mp4MseEngine = {
  name: "mse-mp4",

  isSupported() {
    const MediaSourceCtor = globalThis.MediaSource;
    return Boolean(
      MediaSourceCtor &&
      typeof MediaSourceCtor.isTypeSupported === "function" &&
      getMp4Box()?.createFile
    );
  },

  create(video, url, options = {}) {
    return new Mp4MseSession(video, url, options);
  }
};
