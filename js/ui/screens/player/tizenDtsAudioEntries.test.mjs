import assert from "node:assert/strict";
import test from "node:test";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__ = true;
globalThis.Worker = class Worker {};

const { PlayerController } = await import("../../../core/player/playerController.js");
const { createPlayerScreenMethods40 } =
  await import("./playerScreenMethods-40-wait-for-initial-embedded-track-bootstrap.js");
const { withTizenConvertibleAudioEntries, findTizenAvPlayAudioTrackIndex } =
  await import("./tizenDtsAudioEntries.js");

// The issue #1645 layout: DTS original first, AC3 commentary second. AVPlay on
// a TV without DTS lists only the commentary, renumbered after the video track.
const embeddedAudioTracks = [
  {
    embeddedTrackIndex: 0,
    sourceTrackId: 2,
    nativeTrackIndex: 0,
    label: "Original",
    language: "en",
    codec: "A_DTS"
  },
  {
    embeddedTrackIndex: 1,
    sourceTrackId: 3,
    nativeTrackIndex: 1,
    label: "Commentary",
    language: "en",
    codec: "A_AC3"
  }
];
const commentary = { avplayTrackIndex: 1, codec: "ac3", channels: "2", language: "en" };
const screen = { embeddedAudioTracks, ...createPlayerScreenMethods40() };
const avplayEntries = [
  { id: "audio-avplay-1", label: "Commentary", selected: true, avplayAudioTrackIndex: 1 }
];

function withPlayback({ tracks, state = null, avplayUrl = "http://source/movie.mkv" }) {
  PlayerController.getAvPlayAudioTracks = () => tracks;
  PlayerController.tizenDtsAudioState = state;
  PlayerController.avplayUrl = avplayUrl;
}

test("lists the DTS track AVPlay hides, in container order", () => {
  withPlayback({ tracks: [commentary] });
  const entries = withTizenConvertibleAudioEntries(screen, avplayEntries);
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.selected, entry.canTryAudioConversion === true]),
    [
      ["audio-embedded-0", false, true],
      ["audio-avplay-1", true, false]
    ]
  );
  assert.equal(entries[0].supported, false);
  assert.equal(entries[0].embeddedAudioTrackIndex, 0);
});

test("marks a pending conversion as the selection", () => {
  withPlayback({ tracks: [commentary], state: { targetIndex: 0 } });
  const entries = withTizenConvertibleAudioEntries(screen, avplayEntries);
  assert.deepEqual(
    entries.map((entry) => entry.selected),
    [true, false]
  );
  PlayerController.tizenDtsAudioState = { targetIndex: 0, fallingBack: true };
  assert.deepEqual(
    withTizenConvertibleAudioEntries(screen, avplayEntries).map((entry) => entry.selected),
    [false, true]
  );
});

test("keeps the source list while AVPlay plays the converted file", () => {
  const converted = [
    { avplayTrackIndex: 1, codec: "ac3", channels: "6", language: "en" },
    { avplayTrackIndex: 2, codec: "ac3", channels: "2", language: "en" }
  ];
  withPlayback({
    tracks: converted,
    state: { targetIndex: 0, mediaUrl: "http://127.0.0.1:2715/m.mkv" },
    avplayUrl: "http://127.0.0.1:2715/m.mkv"
  });
  const entries = withTizenConvertibleAudioEntries(screen, []);
  assert.deepEqual(
    entries.map((entry) => [
      entry.embeddedAudioTrackIndex,
      entry.selected,
      entry.canTryAudioConversion
    ]),
    [
      [0, true, true],
      [1, false, false]
    ]
  );
  // On the rewritten file the target counts as AC3, so both tracks resolve.
  assert.equal(findTizenAvPlayAudioTrackIndex(screen, 0, 0), 1);
  assert.equal(findTizenAvPlayAudioTrackIndex(screen, 1, 0), 2);
});

test("finds the AVPlay track of a supported track on the original file", () => {
  withPlayback({ tracks: [commentary] });
  assert.equal(findTizenAvPlayAudioTrackIndex(screen, 1), 1);
  assert.equal(findTizenAvPlayAudioTrackIndex(screen, 0), -1);
});

test("leaves the AVPlay list untouched without a hidden DTS or TrueHD track", () => {
  const supportedOnly = { ...screen, embeddedAudioTracks: [embeddedAudioTracks[1]] };
  withPlayback({ tracks: [commentary] });
  assert.equal(withTizenConvertibleAudioEntries(supportedOnly, avplayEntries), avplayEntries);
  const previousWorker = globalThis.Worker;
  delete globalThis.Worker;
  try {
    assert.equal(withTizenConvertibleAudioEntries(screen, avplayEntries), avplayEntries);
  } finally {
    globalThis.Worker = previousWorker;
  }
});
