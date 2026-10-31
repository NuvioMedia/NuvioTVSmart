import assert from "node:assert/strict";
import test from "node:test";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

const { createPlayerScreenMethods41 } =
  await import("./playerScreenMethods-41-build-subtitle-track-signature.js");
const { getEmbeddedSubtitleSupportState } =
  await import("./playerScreenHelpers-04-format-subtitle-codec-label.js");
const { normalizeTrackLanguageCode, inferTrackLanguageCodeFromText, getTrackLanguageValue } =
  await import("./playerScreenHelpers-05-normalize-track-language-code.js");
const { isForcedSubtitleTrack } =
  await import("./playerScreenHelpers-06-get-track-flag-candidates.js");
const { formatSubtitleTrackDisplay } =
  await import("./playerScreenHelpers-10-format-subtitle-track-display.js");
const { subtitleLabel, cleanDisplayText } =
  await import("./playerScreenHelpers-02-language-code-aliases.js");
const { isGenericSubtitleTrackLabel } =
  await import("./playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js");

const embeddedTracks = [
  {
    embeddedTrackIndex: 0,
    sourceTrackId: 4,
    nativeTrackIndex: 0,
    language: "en",
    label: "English",
    codec: "TEXT/ASS"
  },
  {
    embeddedTrackIndex: 1,
    sourceTrackId: 5,
    nativeTrackIndex: 1,
    language: "en",
    label: "English(CC)",
    codec: "TEXT/ASS"
  },
  {
    embeddedTrackIndex: 2,
    sourceTrackId: 6,
    nativeTrackIndex: 2,
    language: "it",
    label: "Italian",
    codec: "TEXT/ASS"
  },
  {
    embeddedTrackIndex: 3,
    sourceTrackId: 7,
    nativeTrackIndex: 3,
    language: "de",
    label: "German",
    codec: "TEXT/ASS"
  }
];

function createContext(avplayTracks) {
  const context = {
    Environment: { isWebOS: () => false, isTizen: () => true },
    getEmbeddedSubtitleSupportState,
    isForcedSubtitleTrack,
    subtitleLabel,
    cleanDisplayText,
    normalizeTrackLanguageCode,
    inferTrackLanguageCodeFromText,
    getTrackLanguageValue,
    isGenericSubtitleTrackLabel,
    embeddedSubtitleTracks: embeddedTracks,
    getEmbeddedSubtitleTrackByEmbeddedIndex(index) {
      return this.embeddedSubtitleTracks[Number(index)] || null;
    },
    getEmbeddedSubtitleTrackByNativeIndex(index) {
      const target = Number(index);
      if (!this.Environment.isTizen()) {
        return this.embeddedSubtitleTracks[target] || null;
      }
      const avplayOrdinal = avplayTracks.findIndex(
        (track) => Number(track.avplayTrackIndex) === target
      );
      return avplayOrdinal >= 0 ? this.embeddedSubtitleTracks[avplayOrdinal] || null : null;
    }
  };
  return Object.assign(context, createPlayerScreenMethods41());
}

test("AVPlay track_num keeps Italian aligned when an earlier TEXT track is omitted", () => {
  // English(CC) is missing from AVPlay, so the exposed-list position of Italian
  // is shifted; extra_info.track_num still points at the container text ordinal.
  const avplayTracks = [
    { avplayTrackIndex: 2, language: "en", label: "English", extraInfo: { track_num: "0" } },
    { avplayTrackIndex: 3, language: "", label: "Subtitle 2", extraInfo: { track_num: "2" } },
    { avplayTrackIndex: 4, language: "de", label: "German", extraInfo: { track_num: "3" } }
  ];
  const context = createContext(avplayTracks);
  const italian = context.mergeAvPlaySubtitleTrackMetadata(avplayTracks[1], 1);
  const display = formatSubtitleTrackDisplay(italian, 1);
  assert.equal(display.languageKey, "it");
  assert.equal(display.label, "Italian");
});

test("metadata matching still falls back to the AVPlay text order without track_num", () => {
  const avplayTracks = [
    { avplayTrackIndex: 2, language: "en", label: "English" },
    { avplayTrackIndex: 3, language: "en", label: "English(CC)" },
    { avplayTrackIndex: 4, language: "", label: "Subtitle 3" },
    { avplayTrackIndex: 5, language: "de", label: "German" }
  ];
  const context = createContext(avplayTracks);
  const italian = context.mergeAvPlaySubtitleTrackMetadata(avplayTracks[2], 2);
  const display = formatSubtitleTrackDisplay(italian, 2);
  assert.equal(display.languageKey, "it");
});

test("out-of-range track_num does not replace the AVPlay text order", () => {
  const avplayTracks = [
    { avplayTrackIndex: 2, language: "en", label: "English", extraInfo: { track_num: "0" } },
    { avplayTrackIndex: 3, language: "", label: "Subtitle 2", extraInfo: { track_num: "9" } },
    { avplayTrackIndex: 4, language: "it", label: "Italian", extraInfo: { track_num: "2" } }
  ];
  const context = createContext(avplayTracks);
  const second = context.mergeAvPlaySubtitleTrackMetadata(avplayTracks[1], 1);
  const display = formatSubtitleTrackDisplay(second, 1);
  // The ordinal fallback resolves the second exposed TEXT track, English(CC).
  assert.equal(display.languageKey, "en");
});
