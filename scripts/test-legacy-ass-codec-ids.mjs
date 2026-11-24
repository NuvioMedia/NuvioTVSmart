import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const require = createRequire(import.meta.url);
const service = require("../services/webos/src/bitmapSubtitles.js")._test;
const { isAssSubtitleCodec, isEmbeddedTextSubtitleSourceTrack } =
  await import("../js/ui/screens/player/playerScreenHelpers-04-format-subtitle-codec-label.js");

// Android EmbeddedSubtitleTimelineLoader.isMatroskaAssCodec accepts the deprecated ids.
test("deprecated S_ASS and S_SSA Matroska ids are ASS text subtitles", () => {
  for (const codecId of ["S_ASS", "S_SSA", "s_ass", "S_TEXT/ASS", "S_TEXT/SSA"]) {
    assert.equal(isAssSubtitleCodec(codecId), true, codecId);
    assert.equal(isEmbeddedTextSubtitleSourceTrack({ codec: codecId }), true, codecId);
    const track = { type: 0x11, codecId };
    assert.equal(service.isTextSubtitleTrack(track), true, codecId);
    assert.equal(service.isAssTextSubtitleTrack(track), true, codecId);
  }
  for (const codecId of ["S_VOBSUB", "S_HDMV/PGS", "S_DVBSUB", "S_ASSX"]) {
    assert.equal(isAssSubtitleCodec(codecId), false, codecId);
    assert.equal(service.isTextSubtitleTrack({ type: 0x11, codecId }), false, codecId);
  }
});
