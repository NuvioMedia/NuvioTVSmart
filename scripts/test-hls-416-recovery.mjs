import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { createPlayerControllerMethods13 } =
  await import("../js/core/player/playerControllerMethods-13-resolve-remote-media-source-type.js");

// hls.js retries a 416 fragment for about a minute before it turns fatal. The
// startup watchdog on Tizen is 45 s, so the player must surface the 416 at the
// first response for its existing replay-from-start recovery to run (#1431).
const HLS_EVENTS = {
  ERROR: "hlsError",
  MEDIA_ATTACHED: "mediaAttached",
  MANIFEST_LOADED: "manifestLoaded",
  MANIFEST_PARSED: "manifestParsed",
  FRAG_BUFFERED: "fragBuffered"
};

class FakeHls {
  static Events = HLS_EVENTS;
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };

  static isSupported() {
    return true;
  }

  constructor() {
    this.handlers = new Map();
    this.loadedUrl = "";
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  attachMedia() {
    this.handlers.get(HLS_EVENTS.MEDIA_ATTACHED)?.();
  }

  loadSource(url) {
    this.loadedUrl = url;
  }

  startLoad() {}
  stopLoad() {}
  destroy() {}

  emit(event, data) {
    this.handlers.get(event)?.({}, data);
  }
}

function createController() {
  return {
    video: {
      removeAttribute() {},
      play: () => Promise.resolve()
    },
    events: [],
    hlsInstance: null,
    lastPlaybackErrorCode: 0,
    playbackEngine: "none",
    canUseHlsJs: () => true,
    isPlaybackRequestActive: () => true,
    teardownHlsInstance() {
      this.hlsInstance = null;
    },
    teardownDashInstance() {},
    buildHlsConfig: () => ({}),
    captureHlsErrorDiagnostic(data) {
      this.hlsDiagnostic = data;
    },
    emitVideoEvent(name, detail) {
      this.events.push({ name, detail });
    },
    isExpectedPlayInterruption: () => false,
    handleNativePlayStartedUnderStartupGate() {},
    applyStartupAudioGateToVideo() {}
  };
}

function startPlayback(controller) {
  globalThis.Hls = FakeHls;
  const started = createPlayerControllerMethods13().playWithHlsJs.call(
    controller,
    "http://129.225.106.195/d/master.m3u8?d=live.mpd&h_x_cnc_plugin=PlayFyProvider",
    {},
    1
  );
  assert.equal(started, true);
  return controller.hlsInstance;
}

test("a non-fatal HLS 416 is surfaced immediately for replay-from-start recovery", () => {
  const controller = createController();
  const hls = startPlayback(controller);

  hls.emit(HLS_EVENTS.ERROR, {
    fatal: false,
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details: "fragLoadError",
    response: { code: 416 }
  });

  assert.equal(controller.lastPlaybackErrorCode, 2);
  assert.equal(controller.hlsInstance, null);
  assert.deepEqual(
    controller.events.map((entry) => entry.name),
    ["error"]
  );
  assert.equal(controller.events[0].detail.hlsResponseCode, 416);
  assert.equal(controller.events[0].detail.hlsErrorDetails, "fragLoadError");
});

test("a transient HLS 500 still goes through the normal retry budget", () => {
  const controller = createController();
  const hls = startPlayback(controller);

  hls.emit(HLS_EVENTS.ERROR, {
    fatal: false,
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details: "fragLoadError",
    response: { code: 500 }
  });

  assert.equal(controller.hlsInstance, hls);
  assert.equal(controller.events.length, 0);
});

// #1614: a TV that cannot decode the stream audio reports a decode error on the
// audio SourceBuffer and hls.js keeps resetting it without a fatal event, which
// left the player frozen on the first frame instead of running the engine ladder.
function emitAudioAppendFailure(hls) {
  hls.emit(HLS_EVENTS.ERROR, {
    fatal: false,
    type: FakeHls.ErrorTypes.MEDIA_ERROR,
    details: "bufferAppendingError",
    sourceBufferName: "audio",
    parent: "audio"
  });
}

test("repeated audio append failures with no buffered media surface the media error", () => {
  const controller = createController();
  const hls = startPlayback(controller);

  emitAudioAppendFailure(hls);
  emitAudioAppendFailure(hls);
  assert.equal(controller.events.length, 0, "the first retries stay with hls.js");

  emitAudioAppendFailure(hls);

  assert.equal(controller.lastPlaybackErrorCode, 3);
  assert.equal(controller.hlsInstance, null);
  assert.deepEqual(
    controller.events.map((entry) => entry.name),
    ["error"]
  );
  assert.equal(controller.events[0].detail.mediaErrorCode, 3);
  assert.equal(controller.events[0].detail.hlsErrorDetails, "bufferAppendingError");
});

test("audio append failures stop counting as soon as a fragment is buffered", () => {
  const controller = createController();
  const hls = startPlayback(controller);

  emitAudioAppendFailure(hls);
  emitAudioAppendFailure(hls);
  hls.emit(HLS_EVENTS.FRAG_BUFFERED, {});
  emitAudioAppendFailure(hls);
  emitAudioAppendFailure(hls);

  assert.equal(controller.events.length, 0);
  assert.equal(controller.hlsInstance, hls);
});

test("an audio append failure while media is already buffered is left to hls.js", () => {
  const controller = createController();
  const hls = startPlayback(controller);
  controller.video.readyState = 2;

  emitAudioAppendFailure(hls);
  emitAudioAppendFailure(hls);
  emitAudioAppendFailure(hls);

  assert.equal(controller.events.length, 0);
  assert.equal(controller.hlsInstance, hls);
});
