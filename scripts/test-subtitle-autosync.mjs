import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  buildAutoSyncReferenceTimeline,
  findAutoSyncTimeline,
  normalizeAutoSyncCues
} from "../js/core/player/subtitleAutoSyncEngine.js";
import { retimeAutoSyncSubtitleText } from "../js/core/player/subtitleAutoSyncRetimer.js";

const require = createRequire(import.meta.url);
const subtitles = require("../services/webos/src/bitmapSubtitles.js");
const tx3g = require("../services/tizen/runtime/tx3g-subtitle-parser.cjs");
const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
const { createPlayerScreenMethods74 } =
  await import("../js/ui/screens/player/playerScreenMethods-74-automatic-subtitle-sync.js");

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function makeCues(count, { seed = 1, durationMs = 2200, offsetMs = 0 } = {}) {
  const random = createRandom(seed);
  let timeMs = 1200;
  const cues = [];
  for (let index = 0; index < count; index += 1) {
    timeMs += 800 + Math.floor(random() * 11000);
    const cueDurationMs = durationMs + Math.floor(random() * 2500);
    cues.push({
      startTimeMs: timeMs + offsetMs,
      endTimeMs: timeMs + offsetMs + cueDurationMs,
      text: `line ${index}`
    });
  }
  return cues;
}

function assertConfident(result, label) {
  assert.ok(result, `${label}: expected a timeline`);
  assert.equal(result.confident, true, `${label}: expected confident match`);
}

function testTimelineNormalization() {
  const seconds = normalizeAutoSyncCues([
    { start: 12.5, end: 14.25, text: "second" },
    { start: 10, end: 11, text: "first" }
  ]);
  assert.equal(seconds.length, 2);
  assert.equal(seconds[0].startTimeMs, 10000);
  assert.equal(seconds[1].startTimeMs, 12500);

  const reference = buildAutoSyncReferenceTimeline([
    { startMs: 5000, durationMs: null },
    { startMs: 6500, durationMs: null },
    { startMs: 30000, durationMs: 1200 }
  ]);
  assert.equal(reference[0].endTimeMs, 6500);
  assert.equal(reference[1].endTimeMs, 10500);
  assert.equal(reference[2].endTimeMs, 31200);
}

function testConstantDelay() {
  const reference = makeCues(220, { seed: 11 });
  const target = reference.map((cue) => ({
    startTimeMs: cue.startTimeMs + 4200,
    endTimeMs: cue.endTimeMs + 4200,
    text: cue.text
  }));
  const result = findAutoSyncTimeline(reference, target);
  assertConfident(result, "constant delay");
  assert.equal(result.source, "delay-only");
  assert.equal(result.interceptMs, -4200);
  assert.equal(result.scale, 1);
  assert.equal(result.cues[0].startTimeMs, reference[0].startTimeMs);
  assert.equal(result.maxShiftMs, 4200);
}

function testFrameRateDrift() {
  const reference = makeCues(260, { seed: 23 });
  const scale = 25 / 23.976;
  const offsetMs = 2500;
  const target = reference.map((cue) => ({
    startTimeMs: Math.round(cue.startTimeMs / scale) + offsetMs,
    endTimeMs: Math.round(cue.endTimeMs / scale) + offsetMs,
    text: cue.text
  }));
  const result = findAutoSyncTimeline(reference, target);
  assertConfident(result, "frame-rate drift");
  assert.equal(result.source, "activity");
  assert.ok(Math.abs(result.scale - scale) < 0.001, `scale ${result.scale}`);
  assert.ok(Math.abs(result.interceptMs + Math.round(offsetMs * scale)) < 400);
  assert.ok(result.maxShiftMs > 1000);
}

function testWrongSubtitleIsRejected() {
  for (let seed = 1; seed <= 6; seed += 1) {
    const reference = makeCues(220, { seed: seed * 17 });
    const target = makeCues(220, { seed: seed * 31 + 5 });
    const result = findAutoSyncTimeline(reference, target);
    assert.ok(!result || !result.confident, `seed ${seed}: unrelated subtitle was accepted`);
  }
}

function testSparseReferenceRejected() {
  const reference = makeCues(3, { seed: 3 });
  const target = makeCues(30, { seed: 4 });
  assert.equal(findAutoSyncTimeline(reference, target), null);
}

function testRetimerSrtAndVtt() {
  const timeline = {
    scale: 1,
    interceptMs: 2500,
    cues: [
      {
        originalStartTimeMs: 1000,
        originalEndTimeMs: 3000,
        startTimeMs: 3500,
        endTimeMs: 5500
      }
    ]
  };
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello\n";
  const retimedSrt = retimeAutoSyncSubtitleText(srt, timeline);
  assert.match(retimedSrt, /00:00:03,500 --> 00:00:05,500/);
  assert.match(retimedSrt, /Hello/);

  const vtt = "WEBVTT\n\n00:01.000 --> 00:03.000 align:middle\nHello\n";
  const retimedVtt = retimeAutoSyncSubtitleText(vtt, timeline);
  assert.match(retimedVtt, /00:03\.500 --> 00:05\.500 align:middle/);
}

function testRetimerAss() {
  const timeline = {
    scale: 1,
    interceptMs: 2500,
    cues: [
      {
        originalStartTimeMs: 1000,
        originalEndTimeMs: 3000,
        startTimeMs: 3500,
        endTimeMs: 5500
      }
    ]
  };
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello, world"
  ].join("\n");
  const retimed = retimeAutoSyncSubtitleText(ass, timeline);
  assert.match(retimed, /Dialogue: 0,0:00:03\.50,0:00:05\.50,Default,,0,0,0,,Hello, world/);
}

function testWebOsTimelinePayload() {
  const metadata = {
    timecodeScaleNs: 1000000,
    tracks: [
      { number: 1, type: 0x02, codecId: "A_AAC", language: "eng", name: "" },
      { number: 2, type: 0x11, codecId: "S_TEXT/UTF8", language: "eng", name: "Full" },
      { number: 3, type: 0x11, codecId: "S_TEXT/ASS", language: "spa", name: "Forced" }
    ],
    cues: [
      { timeMs: 1000, track: 2, clusterPosition: 10, relativePosition: 0, durationTicks: null },
      { timeMs: 2500, track: 2, clusterPosition: 11, relativePosition: 0, durationTicks: 750 },
      { timeMs: 5000, track: 2, clusterPosition: 12, relativePosition: 0, durationTicks: null },
      { timeMs: 10000, track: 2, clusterPosition: 13, relativePosition: 0, durationTicks: null },
      { timeMs: 20000, track: 2, clusterPosition: 14, relativePosition: 0, durationTicks: null },
      { timeMs: 30000, track: 2, clusterPosition: 15, relativePosition: 0, durationTicks: null },
      { timeMs: 40000, track: 2, clusterPosition: 16, relativePosition: 0, durationTicks: null },
      { timeMs: 50000, track: 2, clusterPosition: 17, relativePosition: 0, durationTicks: null },
      { timeMs: 1500, track: 3, clusterPosition: 10, relativePosition: 1, durationTicks: null }
    ]
  };
  const track = subtitles._test.selectTimelineTextTrack(metadata);
  assert.equal(track.number, 2);
  const payload = subtitles._test.buildTextSubtitleTimelinePayload(metadata, track);
  assert.equal(payload.cueCount, 8);
  assert.equal(payload.cues[0].durationMs, null);
  assert.equal(payload.cues[1].durationMs, 750);
  assert.equal(payload.cues[2].durationMs, null);
  assert.equal(payload.codecId, "S_TEXT/UTF8");
}

function testTx3gTimelinePayload() {
  const payload = tx3g.buildTx3gTimelinePayload({
    id: 4,
    timescale: 1000,
    duration: 10000,
    language: "eng",
    starts: [1000, 4000, 9000],
    durations: [1500, 0, 0],
    samples: [
      { offset: 1, size: 1 },
      { offset: 2, size: 1 },
      { offset: 3, size: 1 }
    ]
  });
  assert.equal(payload.trackNumber, 4);
  assert.equal(payload.cueCount, 3);
  assert.deepEqual(payload.cues[0], { startMs: 1000, durationMs: 1500 });
  assert.deepEqual(payload.cues[1], { startMs: 4000, durationMs: 5000 });
  assert.deepEqual(payload.cues[2], { startMs: 9000, durationMs: 1000 });
}

function testReferenceRequestSelection() {
  const methods = createPlayerScreenMethods74();
  assert.deepEqual(
    methods.getSubtitleAutoSyncReferenceRequests.call(
      { embeddedSubtitleTracks: [] },
      { lang: "en" },
      true
    ),
    [{ trackNumber: 0, trackOrdinal: -1 }]
  );
  assert.deepEqual(
    methods.getSubtitleAutoSyncReferenceRequests.call(
      {
        embeddedSubtitleTracks: [
          { language: "en", forced: true, sourceTrackId: 9, bitmapSubtitle: false },
          { language: "it", forced: false, sourceTrackId: 7, bitmapSubtitle: false },
          { language: "de", forced: false, sourceTrackId: 8, bitmapSubtitle: true }
        ]
      },
      { lang: "it" },
      false
    ),
    [{ trackNumber: 7, trackOrdinal: -1 }]
  );
  assert.deepEqual(
    methods.getSubtitleAutoSyncReferenceRequests.call(
      { embeddedSubtitleTracks: [{ language: "en", bitmapSubtitle: true }] },
      { lang: "en" },
      true
    ),
    []
  );
}

function testPlayerHtmlTimelineApplication() {
  const methods = createPlayerScreenMethods74();
  const player = Object.assign(
    {
      htmlSubtitleCues: [
        { start: 10, end: 12, text: "one" },
        { start: 20, end: 22, text: "two" }
      ],
      htmlSubtitleSelectedId: "subtitle-1",
      selectedAddonSubtitleId: "subtitle-1",
      currentAddonSubtitleSource: { subtitleUrl: "https://example.test/sub.srt" },
      subtitleDelayMs: 900,
      persistedDelayMs: 900,
      persistSubtitleDelayPreference() {
        this.persistedDelayMs = this.subtitleDelayMs;
      },
      renderHtmlSubtitleOverlayAtCurrentTime() {
        this.renderedAtCurrentTime = true;
      },
      scheduleHtmlSubtitleOverlayRender() {},
      applySubtitlePresentationSettings() {}
    },
    methods
  );
  const timeline = {
    confident: true,
    scale: 1,
    interceptMs: 2000,
    cues: [
      {
        originalStartTimeMs: 10000,
        originalEndTimeMs: 12000,
        startTimeMs: 12000,
        endTimeMs: 14000
      },
      {
        originalStartTimeMs: 20000,
        originalEndTimeMs: 22000,
        startTimeMs: 22000,
        endTimeMs: 24000
      }
    ]
  };
  return methods.applyAutomaticSubtitleSyncTimeline
    .call(player, {
      subtitle: { url: "https://example.test/sub.srt" },
      source: {
        subtitleId: "subtitle-1",
        subtitleUrl: "https://example.test/sub.srt",
        cues: player.htmlSubtitleCues,
        isAss: false
      },
      timeline
    })
    .then((applied) => {
      assert.equal(applied, true);
      assert.equal(player.subtitleDelayMs, 0);
      assert.equal(player.persistedDelayMs, 0);
      assert.deepEqual(
        player.htmlSubtitleCues.map((cue) => [cue.start, cue.end]),
        [
          [12, 14],
          [22, 24]
        ]
      );
      assert.equal(player.renderedAtCurrentTime, true);
    });
}

testReferenceRequestSelection();
await testPlayerHtmlTimelineApplication();
testTimelineNormalization();
testConstantDelay();
testFrameRateDrift();
testWrongSubtitleIsRejected();
testSparseReferenceRejected();
testRetimerSrtAndVtt();
testRetimerAss();
testWebOsTimelinePayload();
testTx3gTimelinePayload();
console.log("subtitle AutoSync tests passed");
