import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// The AVPlay tick timer polls getTotalTrackInfo()/getCurrentStreamInfo() with
// two JSON fingerprints every second for 15 s, then every 5 s: AVPlay publishes
// late audio tracks asynchronously (issue #990), so the cadence must not be
// stretched. getCurrentTime()/getDuration() are reused for 40 ms instead.

async function loadControllerMethods03(clock) {
  const source = await readFile(
    new URL(
      "../js/core/player/playerControllerMethods-03-start-av-play-tick-timer.js",
      import.meta.url
    ),
    "utf8"
  );
  const intervals = [];
  const context = vm.createContext({
    internals: { logTizenAvPlayDebug: () => {} },
    Date: { now: () => clock.now },
    JSON,
    Number,
    setInterval: (callback, delay) => {
      const interval = { callback, delay };
      intervals.push(interval);
      return interval;
    },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {}
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.exports = { createPlayerControllerMethods03 };",
    context
  );
  return { ...context.exports, intervals };
}

function createController(methods, overrides = {}) {
  const controller = {
    ...methods,
    avplayTickTimer: null,
    avplayAudioTracks: [],
    avplaySubtitleTracks: [],
    selectedAvPlayAudioTrackIndex: -1,
    selectedAvPlaySubtitleTrackIndex: -1,
    pendingAvPlayAudioTrackIndex: -1,
    pendingAvPlaySubtitleTrackIndex: -1,
    desiredAvPlayAudioTrackUntil: 0,
    desiredAvPlaySubtitleTrackUntil: 0,
    avplaySeekInFlight: false,
    playbackEngine: "avplay",
    timelineRefreshes: 0,
    trackSyncs: 0,
    events: [],
    isUsingAvPlay: () => true,
    getAvPlayState: () => "PLAYING",
    stopAvPlayTickTimer() {},
    refreshAvPlayTimeline() {
      this.timelineRefreshes += 1;
    },
    syncAvPlayTrackInfo() {
      this.trackSyncs += 1;
    },
    emitVideoEvent(name) {
      this.events.push(name);
    },
    ...overrides
  };
  return controller;
}

test("the tick timer polls tracks every second for 15 s, then every 5 s", async () => {
  const clock = { now: 50_000 };
  const { createPlayerControllerMethods03, intervals } = await loadControllerMethods03(clock);
  const controller = createController(createPlayerControllerMethods03());
  controller.startAvPlayTickTimer();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 1000);
  for (let tick = 1; tick <= 60; tick += 1) {
    clock.now += 1000;
    intervals[0].callback();
  }
  assert.equal(controller.timelineRefreshes, 60, "position refresh runs every tick");
  assert.equal(controller.events.filter((name) => name === "timeupdate").length, 60);
  assert.equal(controller.trackSyncs, 15 + 9, "15 startup polls plus ticks 20,25,...,60");
  assert.equal(
    controller.events.includes("avplaytrackschanged"),
    false,
    "unchanged tracks emit no change event"
  );
});

test("the tick timer reports a late track found by the 5 s poll", async () => {
  const clock = { now: 50_000 };
  const { createPlayerControllerMethods03, intervals } = await loadControllerMethods03(clock);
  const controller = createController(createPlayerControllerMethods03(), {
    syncAvPlayTrackInfo() {
      this.trackSyncs += 1;
      if (this.trackSyncs === 16) {
        this.avplayAudioTracks = [{ id: "avplay-audio-1" }];
      }
    }
  });
  controller.startAvPlayTickTimer();
  for (let tick = 1; tick <= 30; tick += 1) {
    clock.now += 1000;
    intervals[0].callback();
  }
  assert.equal(controller.trackSyncs, 18, "ticks 1-15 and 20,25,30");
  assert.equal(controller.events.filter((name) => name === "avplaytrackschanged").length, 1);
});

test("refreshAvPlayTimeline reuses a poll younger than 40 ms and polls again afterwards", async () => {
  const clock = { now: 1_000 };
  const { createPlayerControllerMethods03 } = await loadControllerMethods03(clock);
  let nativeCurrentTimeCalls = 0;
  let nativeDurationCalls = 0;
  const avplay = {
    getCurrentTime() {
      nativeCurrentTimeCalls += 1;
      return 12_345 + nativeCurrentTimeCalls;
    },
    getDuration() {
      nativeDurationCalls += 1;
      return 5_400_000;
    }
  };
  const methods = createPlayerControllerMethods03();
  const controller = createController(methods, {
    avplayCurrentTimeMs: 0,
    avplayDurationMs: 0,
    avplayTimelinePolledAt: 0,
    getAvPlay: () => avplay,
    refreshAvPlayTimeline: methods.refreshAvPlayTimeline
  });
  // One UI tick reads the position several times within the same task.
  controller.refreshAvPlayTimeline();
  controller.refreshAvPlayTimeline();
  clock.now += 39;
  controller.refreshAvPlayTimeline();
  assert.equal(nativeCurrentTimeCalls, 1);
  assert.equal(nativeDurationCalls, 1);
  assert.equal(controller.avplayCurrentTimeMs, 12_346);
  assert.equal(controller.avplayDurationMs, 5_400_000);
  clock.now += 1;
  controller.refreshAvPlayTimeline();
  assert.equal(nativeCurrentTimeCalls, 2, "a 40 ms old poll is refreshed");
  assert.equal(controller.avplayCurrentTimeMs, 12_347);
  // A seek resets the reuse window so the next read polls the native clock.
  controller.avplayTimelinePolledAt = 0;
  controller.refreshAvPlayTimeline();
  assert.equal(nativeCurrentTimeCalls, 3);
});

test("refreshAvPlayTimeline still skips polling while a seek is in flight", async () => {
  const clock = { now: 1_000 };
  const { createPlayerControllerMethods03 } = await loadControllerMethods03(clock);
  let calls = 0;
  const methods = createPlayerControllerMethods03();
  const controller = createController(methods, {
    refreshAvPlayTimeline: methods.refreshAvPlayTimeline,
    avplaySeekInFlight: true,
    avplayCurrentTimeMs: 777,
    getAvPlay: () => ({
      getCurrentTime() {
        calls += 1;
        return 1;
      },
      getDuration: () => 2
    })
  });
  controller.refreshAvPlayTimeline();
  assert.equal(calls, 0);
  assert.equal(controller.avplayCurrentTimeMs, 777);
});
