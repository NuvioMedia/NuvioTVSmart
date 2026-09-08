import { test } from "node:test";
import assert from "node:assert/strict";

import { isWatchProgressCompleted, isWatchProgressInProgress } from "./watchProgress.js";

test("simkl playback at 80 percent counts as completed", () => {
  const progress = { source: "simkl_playback", progressPercent: 80 };
  assert.equal(isWatchProgressCompleted(progress), true);
  assert.equal(isWatchProgressInProgress(progress), false);
});

test("local progress at 85 percent is still in progress", () => {
  const progress = { source: "local", progressPercent: 85 };
  assert.equal(isWatchProgressCompleted(progress), false);
  assert.equal(isWatchProgressInProgress(progress), true);
});
