import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// The startup audio preference can pick a track while AVPlay is still READY
// (held by the startup audio gate). setSelectTrack only works in PLAYING, so the
// choice waits as a pending index. READY keeps reporting the default track, and
// a track sync must not treat that as the viewer's final choice.

async function loadControllerMethods04(clock) {
  const source = await readFile(
    new URL(
      "../js/core/player/playerControllerMethods-04-sync-av-play-track-info.js",
      import.meta.url
    ),
    "utf8"
  );
  const context = vm.createContext({
    internals: {
      Platform: { isTizen: () => false },
      logTizenAvPlayDebug: () => {},
      isValidAvPlayAudioTrackSelectionState: (state) => state === "PLAYING"
    },
    Date: { now: () => clock.now },
    Number,
    Array
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.exports = { createPlayerControllerMethods04 };",
    context
  );
  return context.exports.createPlayerControllerMethods04();
}

const tracks = ["en", "fr", "it"].map((language, index) => ({
  type: "AUDIO",
  index: index + 1,
  extra_info: JSON.stringify({ language })
}));

function createController(methods, clock, currentIndex) {
  return {
    ...methods,
    avplayAudioTracks: [],
    avplaySubtitleTracks: [],
    selectedAvPlayAudioTrackIndex: -1,
    selectedAvPlaySubtitleTrackIndex: -1,
    pendingAvPlayAudioTrackIndex: -1,
    pendingAvPlaySubtitleTrackIndex: -1,
    desiredAvPlayAudioTrackIndex: -1,
    desiredAvPlayAudioTrackUntil: 0,
    desiredAvPlaySubtitleTrackUntil: 0,
    avplayTrackSyncAt: 0,
    avplaySeekInFlight: false,
    isUsingAvPlay: () => true,
    getAvPlay: () => ({
      getTotalTrackInfo: () => tracks,
      getCurrentStreamInfo: () => [{ type: "AUDIO", index: currentIndex() }]
    }),
    normalizeAvPlayTrackType: (type) => String(type || "").toUpperCase(),
    parseAvPlayExtraInfo: (value) => (value ? JSON.parse(value) : {}),
    pickAvPlayExtraValue: (info, keys) =>
      keys.map((key) => info?.[key]).find((value) => value != null) ?? "",
    pickAvPlayTrackLabel: (_track, index) => `Track ${index + 1}`,
    pickAvPlayTrackLanguage: (track) => JSON.parse(track.extra_info).language
  };
}

test("a selection pending while READY survives syncs that still report the default track", async () => {
  const clock = { now: 1000 };
  let current = 1;
  const controller = createController(await loadControllerMethods04(clock), clock, () => current);
  controller.syncAvPlayTrackInfo({ force: true });
  assert.equal(controller.selectedAvPlayAudioTrackIndex, 1);

  // Preference chose Italian in READY: deferred, with the 5 s desired window.
  controller.pendingAvPlayAudioTrackIndex = 3;
  controller.desiredAvPlayAudioTrackIndex = 3;
  controller.desiredAvPlayAudioTrackUntil = clock.now + 5000;

  clock.now += 30000; // the startup gate keeps AVPlay READY well past the window
  controller.syncAvPlayTrackInfo({ force: true });
  assert.equal(controller.pendingAvPlayAudioTrackIndex, 3, "pending Italian is kept");
  assert.equal(controller.selectedAvPlayAudioTrackIndex, 3);

  // Once AVPlay reports the requested track, the pending state is settled.
  current = 3;
  clock.now += 1000;
  controller.syncAvPlayTrackInfo({ force: true });
  assert.equal(controller.pendingAvPlayAudioTrackIndex, -1);
  assert.equal(controller.selectedAvPlayAudioTrackIndex, 3);

  // Without anything pending, the reported track is the truth.
  current = 2;
  clock.now += 1000;
  controller.syncAvPlayTrackInfo({ force: true });
  assert.equal(controller.selectedAvPlayAudioTrackIndex, 2);
});

async function loadControllerMethods06() {
  const source = await readFile(
    new URL(
      "../js/core/player/playerControllerMethods-06-set-av-play-audio-track.js",
      import.meta.url
    ),
    "utf8"
  );
  const context = vm.createContext({
    internals: {
      logTizenAvPlayDebug: () => {},
      isValidAvPlayAudioTrackSelectionState: (state) => state === "PLAYING",
      isValidAvPlaySubtitleTrackSelectionState: () => true,
      normalizeAvPlaySubtitleRenderMode: (value) => value
    },
    Date,
    Number
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.exports = { createPlayerControllerMethods06 };",
    context
  );
  return context.exports.createPlayerControllerMethods06();
}

test("a startup selection does not expire while AVPlay is still READY", async () => {
  let state = "READY";
  let applied = 0;
  const controller = {
    ...(await loadControllerMethods06()),
    pendingAvPlayAudioTrackIndex: 3,
    desiredAvPlayAudioTrackUntil: Date.now() - 1000,
    getAvPlayState: () => state,
    applyPendingAvPlayAudioTrackSelection() {
      applied += 1;
      return state === "PLAYING";
    }
  };
  assert.equal(controller.retryPendingAvPlayStartupAudioTrackSelection(), false);
  assert.equal(controller.pendingAvPlayAudioTrackIndex, 3, "kept through READY past the window");
  assert.equal(applied, 0);

  state = "PLAYING";
  assert.equal(controller.retryPendingAvPlayStartupAudioTrackSelection(), true);
  assert.equal(applied, 1, "applied once PLAYING, even past the window");

  // A selection that still cannot be applied in PLAYING after the window is dropped.
  controller.applyPendingAvPlayAudioTrackSelection = () => false;
  assert.equal(controller.retryPendingAvPlayStartupAudioTrackSelection(), false);
  assert.equal(controller.pendingAvPlayAudioTrackIndex, -1);
});

async function loadControllerMethods03() {
  const source = await readFile(
    new URL(
      "../js/core/player/playerControllerMethods-03-start-av-play-tick-timer.js",
      import.meta.url
    ),
    "utf8"
  );
  const context = vm.createContext({
    internals: { logTizenAvPlayDebug: () => {} },
    Date,
    Number,
    String
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.exports = { createPlayerControllerMethods03 };",
    context
  );
  return context.exports.createPlayerControllerMethods03();
}

function createStartController(methods, avplay) {
  return {
    ...methods,
    pendingAvPlayAudioTrackIndex: 3,
    selectedAvPlayAudioTrackIndex: 3,
    desiredAvPlayAudioTrackIndex: -1,
    desiredAvPlayAudioTrackUntil: 0,
    resolveAvPlayAudioTrackIndex: (index) => ([1, 2, 3].includes(index) ? index : -1),
    getAvPlayAudioTrackSelectionIndex: (index) => index,
    getAvPlayState: () => avplay.state,
    getCurrentAvPlayAudioTrackIndex: () => avplay.current
  };
}

test("the startup language is switched in PAUSED before playback is heard", async () => {
  const calls = [];
  const avplay = {
    state: "READY",
    current: 1,
    play() {
      calls.push("play");
      this.state = "PLAYING";
    },
    pause() {
      calls.push("pause");
      this.state = "PAUSED";
    },
    setSelectTrack(type, index) {
      if (this.state === "READY") throw new Error("PLAYER_ERROR_INVALID_STATE");
      calls.push(`${type}:${index}`);
      this.current = index;
    }
  };
  const controller = createStartController(await loadControllerMethods03(), avplay);
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), true);
  assert.deepEqual(calls, ["play", "pause", "AUDIO:3"]);
  assert.equal(controller.pendingAvPlayAudioTrackIndex, -1);
  assert.equal(avplay.current, 3);
});

test("a firmware that refuses the PAUSED switch keeps the pending index", async () => {
  const avplay = {
    state: "READY",
    current: 1,
    play() {
      this.state = "PLAYING";
    },
    pause() {
      this.state = "PAUSED";
    },
    setSelectTrack() {
      throw new Error("PLAYER_ERROR_INVALID_STATE");
    }
  };
  const controller = createStartController(await loadControllerMethods03(), avplay);
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), false);
  assert.equal(controller.pendingAvPlayAudioTrackIndex, 3, "left for the PLAYING retries");
});

test("nothing pending or already on the chosen track starts untouched", async () => {
  const calls = [];
  const avplay = {
    state: "READY",
    current: 3,
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    setSelectTrack: () => calls.push("sel")
  };
  const controller = createStartController(await loadControllerMethods03(), avplay);
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), false);
  controller.pendingAvPlayAudioTrackIndex = -1;
  avplay.current = 1;
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), false);
  assert.deepEqual(calls, []);
});

test("Tizen 6.5+ switches the startup track in PLAYING with the audio stream disabled", async () => {
  const calls = [];
  const avplay = {
    state: "READY",
    current: 1,
    disableAudioStream() {
      calls.push("disable");
    },
    enableAudioStream() {
      calls.push("enable");
    },
    play() {
      calls.push("play");
      this.state = "PLAYING";
    },
    pause() {
      calls.push("pause");
      this.state = "PAUSED";
    },
    setSelectTrack(type, index) {
      if (this.state !== "PLAYING") throw new Error("PLAYER_ERROR_INVALID_STATE");
      calls.push(`${type}:${index}`);
      this.current = index;
    }
  };
  const controller = createStartController(await loadControllerMethods03(), avplay);
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), true);
  assert.deepEqual(calls, ["disable", "play", "AUDIO:3", "pause", "enable"]);
  assert.equal(avplay.state, "PAUSED", "the normal start can call play()");
});

test("a failed silent switch restores audio and leaves AVPlay startable", async () => {
  const calls = [];
  const avplay = {
    state: "READY",
    current: 1,
    disableAudioStream() {
      calls.push("disable");
    },
    enableAudioStream() {
      calls.push("enable");
    },
    play() {
      this.state = "PLAYING";
    },
    pause() {
      calls.push("pause");
      this.state = "PAUSED";
    },
    setSelectTrack() {
      throw new Error("UnknownError");
    }
  };
  const controller = createStartController(await loadControllerMethods03(), avplay);
  assert.equal(controller.selectPendingAvPlayAudioTrackBeforeStart(avplay), false);
  assert.deepEqual(calls, ["disable", "pause", "enable"]);
  assert.equal(controller.pendingAvPlayAudioTrackIndex, 3);
});
