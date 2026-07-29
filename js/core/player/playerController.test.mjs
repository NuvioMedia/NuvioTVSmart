import assert from "node:assert/strict";
import test from "node:test";

import { PlayerController } from "./playerController.js";

function createController(renderMode) {
  const calls = [];
  const avplay = {
    setSilentSubtitle(silent) {
      calls.push(["setSilentSubtitle", silent]);
    },
    setSelectTrack(type, index) {
      calls.push(["setSelectTrack", type, index]);
    }
  };
  const controller = Object.create(PlayerController);
  Object.assign(controller, {
    avplaySubtitleRenderMode: renderMode,
    avplaySubtitleTracks: [{ avplayTrackIndex: 4 }],
    getAvPlay: () => avplay,
    getAvPlayState: () => "PLAYING",
    reapplyTizenAvPlayDisplayRect() {}
  });
  return { calls, controller };
}

test("AVPlay re-arms native subtitles before selecting a track", () => {
  const { calls, controller } = createController("native");

  assert.equal(controller.trySelectAvPlaySubtitleTrackIndex(4), true);
  assert.deepEqual(calls, [
    ["setSilentSubtitle", true],
    ["setSelectTrack", "TEXT", 4],
    ["setSilentSubtitle", false]
  ]);
  assert.equal(controller.avplaySubtitlesSilent, false);
  assert.equal(controller.avplayNativeSubtitleRendering, true);
});

test("AVPlay re-arms HTML subtitle callbacks before selecting a track", () => {
  const { calls, controller } = createController("html");

  assert.equal(controller.trySelectAvPlaySubtitleTrackIndex(4), true);
  assert.deepEqual(calls, [
    ["setSilentSubtitle", false],
    ["setSelectTrack", "TEXT", 4],
    ["setSilentSubtitle", true]
  ]);
  assert.equal(controller.avplaySubtitlesSilent, false);
  assert.equal(controller.avplayNativeSubtitleRendering, false);
});
