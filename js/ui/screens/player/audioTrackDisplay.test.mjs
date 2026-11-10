import test from "node:test";
import assert from "node:assert/strict";

// The player helper pulls profile-scoped stores at import time; the display
// rules under test never read them, so an empty storage keeps the import quiet.
globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};

const { formatAudioTrackDisplay } =
  await import("./playerScreenHelpers-07-detect-track-language-variant.js");

test("audio track metadata matches Android's codec | channels | sample rate line", () => {
  assert.equal(
    formatAudioTrackDisplay({ codec: "eac3", channelCount: 6, sampleRate: 48000 }, 0).metadata,
    "E-AC-3 | 6 ch | 48 kHz"
  );
  assert.equal(
    formatAudioTrackDisplay({ codec: "ac3", channels: "2", audioSampleRate: 44100 }, 0).metadata,
    "AC-3 | 2 ch | 44 kHz"
  );
});

test("audio track metadata omits fields the stream does not expose", () => {
  assert.equal(formatAudioTrackDisplay({ codec: "aac" }, 0).metadata, "AAC");
  assert.equal(formatAudioTrackDisplay({ sel: true }, 0).metadata, "");
});
