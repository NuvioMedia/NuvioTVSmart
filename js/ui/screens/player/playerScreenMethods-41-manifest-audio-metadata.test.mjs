import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};

const { Environment } = await import("../../../platform/environment.js");
const { PlayerController } = await import("../../../core/player/playerController.js");
const { createPlayerScreenMethods12 } =
  await import("./playerScreenMethods-12-normalize-embedded-audio-tracks.js");
const { createPlayerScreenMethods40 } =
  await import("./playerScreenMethods-40-wait-for-initial-embedded-track-bootstrap.js");
const { createPlayerScreenMethods41 } =
  await import("./playerScreenMethods-41-build-subtitle-track-signature.js");
const { createPlayerScreenMethods60 } =
  await import("./playerScreenMethods-60-get-audio-entries.js");
const { formatAudioTrackDisplay } =
  await import("./playerScreenHelpers-07-detect-track-language-variant.js");

const avplayTracks = Array.from({ length: 5 }, (_, index) => ({
  avplayTrackIndex: index,
  label: `Track ${index + 1}`,
  language: "",
  codec: "eac3",
  channels: 6,
  sampleRate: 48000
}));

const manifestTracks = [
  { groupId: "audio", name: "English", language: "en", channels: "6" },
  { groupId: "audio", name: "Swedish", language: "sv", channels: "6" },
  { groupId: "audio", name: "German", language: "de", channels: "6" },
  { groupId: "audio", name: "French", language: "fr", channels: "6" },
  { groupId: "audio", name: "Spanish", language: "es", channels: "6" }
];

function createContext(tracks = manifestTracks) {
  return Object.assign({ manifestAudioTracks: tracks }, createPlayerScreenMethods41());
}

test("manifest audio names fill AVPlay HLS tracks that expose no language", () => {
  const context = createContext();
  const displays = avplayTracks.map((track, index) =>
    formatAudioTrackDisplay(
      context.mergeManifestAudioTrackMetadata(track, index, avplayTracks.length),
      index
    )
  );

  assert.deepEqual(
    displays.map((display) => display.languageText),
    ["English", "Swedish", "German", "French", "Spanish"]
  );
  assert.deepEqual(
    displays.map((display) => display.label),
    [
      "English (E-AC-3 5.1)",
      "Swedish (E-AC-3 5.1)",
      "German (E-AC-3 5.1)",
      "French (E-AC-3 5.1)",
      "Spanish (E-AC-3 5.1)"
    ]
  );
  assert.equal(displays[0].metadata, "E-AC-3 | 6 ch | 48 kHz");
});

test("a count mismatch never labels tracks by position", () => {
  const context = createContext(manifestTracks.slice(0, 4));
  const display = formatAudioTrackDisplay(
    context.mergeManifestAudioTrackMetadata(avplayTracks[4], 4, avplayTracks.length),
    4
  );

  assert.equal(display.languageText, "");
  assert.equal(display.label, "Audio 5 (E-AC-3 5.1)");
});

test("a flattened multi-group manifest is not mapped by position", () => {
  const multiGroup = manifestTracks.map((track, index) => ({
    ...track,
    groupId: `audio-${index}`
  }));
  const context = createContext(multiGroup);
  const display = formatAudioTrackDisplay(
    context.mergeManifestAudioTrackMetadata(avplayTracks[0], 0, avplayTracks.length),
    0
  );

  assert.equal(display.languageText, "");
  assert.equal(display.label, "Audio 1 (E-AC-3 5.1)");
});

test("AVPlay's own language is matched to the manifest and never replaced", () => {
  const context = createContext();
  const track = { ...avplayTracks[0], language: "swe" };
  const display = formatAudioTrackDisplay(
    context.mergeManifestAudioTrackMetadata(track, 0, avplayTracks.length),
    0
  );

  assert.equal(display.languageText, "Swedish");
  assert.equal(display.label, "Swedish (E-AC-3 5.1)");
});

test("an AVPlay language missing from the manifest leaves the track untouched", () => {
  const context = createContext();
  const track = { ...avplayTracks[0], language: "fi" };
  const merged = context.mergeManifestAudioTrackMetadata(track, 0, avplayTracks.length);
  const display = formatAudioTrackDisplay(merged, 0);

  assert.equal(merged.label, "Track 1");
  assert.equal(display.languageText, "Finnish");
  assert.equal(display.label, "Finnish (E-AC-3 5.1)");
});

test("the AVPlay audio entry list uses the manifest names on Tizen", () => {
  Environment.isTizen = () => true;
  Environment.isWebOS = () => false;
  PlayerController.getAvPlayAudioTracks = () => avplayTracks;
  PlayerController.getSelectedAvPlayAudioTrackIndex = () => 1;
  PlayerController.getDashAudioTracks = () => [];
  PlayerController.getHlsAudioTracks = () => [];
  const screen = Object.assign(
    {},
    createPlayerScreenMethods12(),
    createPlayerScreenMethods40(),
    createPlayerScreenMethods41(),
    createPlayerScreenMethods60(),
    {
      manifestAudioTracks: manifestTracks,
      embeddedAudioTracks: [],
      selectedAudioTrackIndex: 0,
      trackDialogCache: {},
      isTizenDashAudioSwitchingUnsupported: () => false,
      pendingWebOsAudioSelection: null,
      audioDialogVisible: false
    }
  );

  const entries = screen.getAudioEntries();

  assert.deepEqual(
    entries.map((entry) => entry.languageText),
    ["English", "Swedish", "German", "French", "Spanish"]
  );
  assert.equal(entries[1].selected, true, "selection still uses AVPlay's native index");
});
