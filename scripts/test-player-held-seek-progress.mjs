import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { deltaMsForKeyRepeat } from "../js/core/player/playerScrubRates.js";

async function loadSeekMethods() {
  const source = await readFile(
    new URL("../js/ui/screens/player/playerScreenMethods-32-update-ui-tick.js", import.meta.url),
    "utf8"
  );
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const context = vm.createContext({
    internals: {
      deltaMsForKeyRepeat,
      clamp,
      formatTime,
      PlayerController: {},
      t: (key, params, fallback) => fallback
    },
    syncHtmlSubtitleClearance: () => {},
    setTimeout,
    clearTimeout
  });
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") +
      "\nthis.methods = createPlayerScreenMethods32();",
    context
  );
  return context.methods;
}

function node() {
  return { textContent: "", style: {}, classList: { toggle() {} }, setAttribute() {} };
}

test("A held seek redraws the controls bar and time on every step, like Android's timeline", async () => {
  const methods = await loadSeekMethods();
  const screen = Object.assign(Object.create(methods), {
    controlsVisible: true,
    controlFocusZone: "progress",
    seekPreviewSeconds: null,
    seekPreviewDirection: 0,
    seekRepeatCount: 0,
    uiRefs: {
      progressFill: node(),
      timeLabel: node(),
      progressShell: node(),
      seekOverlay: node(),
      seekDirection: node(),
      seekPreview: node(),
      seekFill: node()
    },
    isSeekBarAvailable: () => true,
    isLivePlayback: () => false,
    getPlaybackCurrentSeconds: () => 600,
    getPlaybackDisplayCurrentSeconds: () => 600,
    getPlaybackDurationSeconds: () => 3600,
    getPlaybackDisplayDurationSeconds: () => 3600
  });

  const seen = [];
  for (let step = 0; step < 4; step += 1) {
    screen.beginSeekPreview(1, step > 0, true);
    const expected = screen.seekPreviewSeconds;
    assert.equal(
      screen.uiRefs.timeLabel.textContent,
      `${Math.floor(expected / 60)}:${String(expected % 60).padStart(2, "0")} / 60:00`
    );
    assert.equal(
      screen.uiRefs.progressFill.style.width,
      `${Math.round((expected / 3600) * 10000) / 100}%`
    );
    seen.push(expected);
  }
  assert.deepEqual(
    seen,
    [610, 620, 630, 650],
    "Android scrub rates: 10s steps, then 20s after the third repeat"
  );

  screen.controlFocusZone = "controls";
  screen.beginSeekPreview(1, true, false);
  assert.match(
    screen.uiRefs.timeLabel.textContent,
    /^11:10 \//,
    "media-key previews show on the bar outside the progress zone too"
  );
  clearTimeout(screen.seekCommitTimer);

  screen.cancelSeekPreview();
  assert.equal(
    screen.uiRefs.timeLabel.textContent,
    "10:00 / 60:00",
    "cancelling returns the bar to the playback position"
  );
});
