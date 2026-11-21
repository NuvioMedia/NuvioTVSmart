import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWebOsExactSeekMethods } from "./webosExactSeek.js";

function loadControllerMethods03() {
  const source = readFileSync(
    new URL(
      "../../core/player/playerControllerMethods-03-start-av-play-tick-timer.js",
      import.meta.url
    ),
    "utf8"
  )
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/export function /g, "function ");
  return new Function(
    "internals",
    `"use strict";\n${source}\nreturn createPlayerControllerMethods03();`
  )({
    logTizenAvPlayDebug: () => {}
  });
}

test("syncWebOsExactSeekMuted keeps decode pass muted and unmutes when startup audio gate releases mid-seek", () => {
  let pollFn = null;
  const exactSeekMethods = createWebOsExactSeekMethods({
    every: (fn) => {
      pollFn = fn;
      return 1;
    },
    stopEvery: () => {
      pollFn = null;
    },
    later: () => 2,
    stopLater: () => {}
  });
  const controllerMethods03 = loadControllerMethods03();

  const video = {
    duration: 120,
    currentTime: 10,
    paused: false,
    seeking: false,
    readyState: 4,
    muted: true,
    defaultMuted: true,
    volume: 1,
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const controller = Object.assign(
    {
      video,
      playRequestToken: 1,
      startupAudioGateActive: true,
      startupPresentationAudioMuted: false,
      webOsDtsAudioState: { originalMuted: true },
      isPlaying: true,
      cancelProgressSyncAfterSeek() {},
      syncWebOsPlaybackKeepAwake() {},
      emitVideoEvent() {}
    },
    exactSeekMethods,
    controllerMethods03
  );

  // Start exact seek while startup audio gate is holding video muted.
  assert.equal(controller.seekWebOsExactly(45), true);
  assert.equal(video.muted, true);

  // Startup audio gate releases mid-seek: applyStartupAudioGateToVideo must update exact-seek
  // restore state while keeping the internal decode pass muted until seek completes.
  controller.startupAudioGateActive = false;
  controller.applyStartupAudioGateToVideo();
  assert.equal(video.muted, true, "decode pass stays muted during active exact seek");
  assert.equal(controller.webOsDtsAudioState.originalMuted, false);

  // Advance decoder past target with small forward step (0 < step < 1) and complete exact seek.
  video.currentTime = 44.5;
  pollFn();
  video.currentTime = 45.0;
  pollFn();
  assert.equal(video.muted, false, "unmutes once exact seek finishes after gate release");
});
