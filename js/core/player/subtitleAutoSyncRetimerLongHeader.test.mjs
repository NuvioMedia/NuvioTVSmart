import assert from "node:assert/strict";
import test from "node:test";

import { retimeAutoSyncSubtitleText } from "./subtitleAutoSyncRetimer.js";

test("retimeAutoSyncSubtitleText detects ASS [Events] past 4KB header", () => {
  const longHeader = "; " + "header-padding-line\n; ".repeat(300);
  const ass = [
    "[Script Info]",
    "Title: Long Header Fixture",
    longHeader,
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Line"
  ].join("\n");
  assert.ok(ass.indexOf("[Events]") > 4096);

  const retimed = retimeAutoSyncSubtitleText(ass, {
    scale: 1,
    interceptMs: 2000,
    cues: [
      {
        originalStartTimeMs: 5000,
        originalEndTimeMs: 8000,
        startTimeMs: 7000,
        endTimeMs: 10000
      }
    ]
  });
  assert.ok(retimed);
  assert.match(retimed, /Dialogue: 0,0:00:07\.00,0:00:10\.00/);
});
