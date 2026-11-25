import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { StreamInfoMethods } = await import("../js/ui/screens/player/streamInfoOverlay.js");
const { createPlayerScreenMethods70 } = await import("../js/ui/screens/player/playerScreenMethods-70-on-pointer-activate.js");

// Back reaches the player through FocusEngine.consumeBackRequest(), never
// onKeyDown. Like Android, it must close the stream info overlay first and
// keep playback running (#1637).
test("Back closes the stream info overlay instead of leaving the player", () => {
  let removed = false;
  let controls = null;
  const screen = {
    ...StreamInfoMethods,
    consumeBackRequest: createPlayerScreenMethods70().consumeBackRequest,
    streamInfoVisible: true,
    streamInfoOverlay: { remove: () => { removed = true; } },
    streamInfoRestore: { controlsVisible: true, controlFocusZone: "buttons", controlFocusIndex: 2 },
    chaptersPanelVisible: true,
    setControlsVisible(visible) { controls = visible; },
    resetControlsAutoHide() {},
    isStartupErrorVisible() { throw new Error("Back fell through to player exit logic"); }
  };
  assert.equal(screen.consumeBackRequest(), true);
  assert.equal(screen.streamInfoVisible, false);
  assert.equal(removed, true);
  assert.equal(controls, true);
  assert.equal(screen.controlFocusIndex, 2);
  assert.equal(screen.chaptersPanelVisible, true);
});
