// Tizen HTML5/MSE playback renders HLS text tracks natively inside the
// <video> element. Samsung positions those cues against the player viewport,
// so resizing the element to the letterboxed content rect clipped the bottom
// cue line. Keep the element fullscreen and let object-fit handle the aspect.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "tizen";

const { PlayerController } = await import("../js/core/player/playerController.js");
const { ASPECT_MODE_DEFINITIONS } = await import("../js/core/player/playerAspect.js");
const { createPlayerScreenMethods64 } =
  await import("../js/ui/screens/player/playerScreenMethods-64-move-sources-focus.js");

PlayerController.video = { style: {}, videoWidth: 1920, videoHeight: 800 };
PlayerController.getPlayerViewportSize = () => ({ width: 1920, height: 1080 });
PlayerController.setAvPlayDisplayRect = () => {};
PlayerController.isUsingAvPlay = () => false;

const screen = {
  ...createPlayerScreenMethods64(),
  aspectModes: ASPECT_MODE_DEFINITIONS.map((definition) => ({ ...definition })),
  aspectModeIndex: 0,
  renderBitmapSubtitleAtCurrentTime() {}
};

const styleFor = (modeId) => {
  PlayerController.video.style = {};
  screen.aspectModeIndex = screen.aspectModes.findIndex((mode) => mode.id === modeId);
  screen.applyAspectMode();
  return PlayerController.video.style;
};

for (const mode of ASPECT_MODE_DEFINITIONS) {
  const style = styleFor(mode.id);
  assert.equal(style.width, "100vw", `${mode.id} keeps the native cue plane fullscreen`);
  assert.equal(style.height, "100vh", `${mode.id} keeps the native cue plane fullscreen`);
  assert.equal(style.left, "0px");
  assert.equal(style.top, "0px");
  if (mode.id === "STRETCH") {
    // object-fit alone stretches the frame, matching the previous transform.
    assert.equal(style.objectFit, "fill");
    assert.equal(style.transform, "none");
  } else {
    assert.equal(style.objectFit, "contain");
  }
}

assert.equal(styleFor("ORIGINAL").transform, "none");
assert.match(styleFor("FULL_SCREEN").transform, /^scale\(/);
assert.match(styleFor("STRETCH").transform, /none/);

// AVPlay keeps its own native display rect and does not touch the video plane.
PlayerController.isUsingAvPlay = () => true;
const avplayStyle = styleFor("ORIGINAL");
assert.equal(avplayStyle.width, "1920px");
assert.equal(avplayStyle.height, "1080px");
assert.equal(avplayStyle.objectFit, "fill");
assert.equal(avplayStyle.transform, "none");

console.log("Tizen HLS subtitle viewport fixtures passed.");
