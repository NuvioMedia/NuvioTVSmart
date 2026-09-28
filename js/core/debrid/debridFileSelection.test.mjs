import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDvdPayloadKind,
  hasDvdOnlyPayload,
  isDvdImageFile,
  isDvdVideoFile,
  selectDebridFile
} from "./debridFileSelection.js";

test("single ISO file is detected as DVD image payload", () => {
  const files = [{ name: "BIRTADBIRDOKU.iso", size: 4294967296 }];

  assert.equal(isDvdImageFile(files[0]), true);
  assert.equal(getDvdPayloadKind(files), "iso");
  assert.equal(hasDvdOnlyPayload(files), true);
  assert.equal(selectDebridFile(files, {}, {}), null);
});

test("extracted VIDEO_TS files are detected as DVD video payload", () => {
  const files = [
    { name: "VIDEO_TS/VIDEO_TS.IFO", size: 12288 },
    { name: "VIDEO_TS/VTS_01_1.VOB", size: 1073741824 },
    { name: "AUDIO_TS/AUDIO_TS.IFO", size: 12288 }
  ];

  assert.equal(isDvdVideoFile(files[1]), true);
  assert.equal(getDvdPayloadKind(files), "video_ts");
  assert.equal(hasDvdOnlyPayload(files), true);
  assert.equal(selectDebridFile(files, {}, {}), null);
});

test("playable mkv alongside ISO does not count as DVD-only", () => {
  const files = [{ name: "movie.iso", size: 100 }, { name: "movie.mkv", size: 200 }];

  assert.equal(getDvdPayloadKind(files), "iso");
  assert.equal(hasDvdOnlyPayload(files), false);
  assert.equal(selectDebridFile(files, {}, {}).name, "movie.mkv");
});

test("regular non-video files are not DVD payloads", () => {
  const files = [{ name: "readme.nfo", size: 10 }];

  assert.equal(getDvdPayloadKind(files), null);
  assert.equal(hasDvdOnlyPayload(files), false);
});
