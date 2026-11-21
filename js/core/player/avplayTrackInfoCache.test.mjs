import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("playerControllerMethods-04 reuses parsed AVPlay tracks until metadata or state changes", async () => {
  const source = stripModule(
    await readFile(
      new URL("./playerControllerMethods-04-sync-av-play-track-info.js", import.meta.url),
      "utf8"
    )
  );

  let tizenLogs = 0;
  const context = vm.createContext({
    internals: new Proxy(
      {
        Platform: { isTizen: () => true },
        logTizenAvPlayDebug: () => {
          tizenLogs += 1;
        }
      },
      {
        get(target, prop) {
          return prop in target ? target[prop] : () => {};
        }
      }
    )
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createPlayerControllerMethods04();`, context);

  let parseCalls = 0;
  let usingAvPlay = true;
  let currentAudioIndex = 1;
  let totalTracks = [
    { type: "AUDIO", index: 1, language: "eng", extra_info: '{"language":"eng"}' },
    { type: "TEXT", index: 2, extra_info: '{"language":"eng"}' },
    { type: "AUDIO", index: 3, extra_info: '{"language":"fra"}' }
  ];
  const ctrl = Object.assign(Object.create(context.api), {
    avplayAudioTracks: [],
    avplaySubtitleTracks: [],
    avplayTotalTracksSignature: null,
    avplayCachedAudioTracks: null,
    avplayCachedSubtitleTracks: null,
    selectedAvPlayAudioTrackIndex: -1,
    selectedAvPlaySubtitleTrackIndex: -1,
    pendingAvPlayAudioTrackIndex: -1,
    pendingAvPlaySubtitleTrackIndex: -1,
    desiredAvPlayAudioTrackIndex: -1,
    desiredAvPlayAudioTrackUntil: 0,
    desiredAvPlaySubtitleTrackIndex: -1,
    desiredAvPlaySubtitleTrackUntil: 0,
    avplaySubtitlesSilent: false,
    avplaySeekInFlight: false,
    avplayTrackSyncAt: 0,
    isUsingAvPlay: () => usingAvPlay,
    getAvPlay: () => ({
      getTotalTrackInfo: () => totalTracks,
      getCurrentStreamInfo: () => [{ type: "AUDIO", index: currentAudioIndex }]
    }),
    getAvPlayState: () => "PLAYING",
    normalizeAvPlayTrackType: (type) => String(type || "").toUpperCase(),
    parseAvPlayExtraInfo: (raw) => {
      parseCalls += 1;
      if (!raw) {
        return {};
      }
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    },
    pickAvPlayExtraValue: (info, keys) =>
      keys.map((key) => info?.[key]).find((value) => value != null) || "",
    pickAvPlayTrackLabel: (track, index, prefix) =>
      String(track?.name || track?.label || track?.title || `${prefix} ${index + 1}`),
    pickAvPlayTrackLanguage: (track) => String(track?.language || "")
  });

  // The AVPlay tick timer and every other production caller pass force: true.
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 3, "first sync parses every audio and text track");
  assert.equal(tizenLogs, 1);
  assert.equal(ctrl.avplayAudioTracks.length, 2);
  assert.equal(ctrl.avplaySubtitleTracks.length, 1);
  assert.equal(ctrl.selectedAvPlayAudioTrackIndex, 1);

  // Unchanged metadata reuses the arrays, but the current stream is still reconciled.
  const cachedAudioTracks = ctrl.avplayAudioTracks;
  currentAudioIndex = 3;
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 3, "unchanged totalTracks must reuse the parsed arrays");
  assert.equal(tizenLogs, 1, "unchanged totalTracks must not log a sync");
  assert.equal(ctrl.avplayAudioTracks, cachedAudioTracks);
  assert.equal(
    ctrl.selectedAvPlayAudioTrackIndex,
    3,
    "selection reconciliation still runs on cache hits"
  );

  // Direct track fields feed the label/language builders, so they invalidate too.
  totalTracks = [
    {
      type: "AUDIO",
      index: 1,
      name: "English main",
      language: "eng",
      extra_info: '{"language":"eng"}'
    },
    ...totalTracks.slice(1)
  ];
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 6, "direct label/language changes must invalidate the cache");
  assert.equal(ctrl.avplayAudioTracks[0].label, "English main");

  totalTracks = [
    ...totalTracks.slice(0, 2),
    { type: "AUDIO", index: 3, extra_info: '{"language":"spa"}' }
  ];
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 9, "extra_info changes must invalidate the cache");
  assert.equal(ctrl.avplayAudioTracks[1].extraInfo.language, "spa");

  // Externally cleared arrays (media switch / AVPlay teardown) must re-parse.
  ctrl.avplayAudioTracks = [];
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 12, "external reset of avplayAudioTracks must invalidate the cache");

  // Leaving AVPlay clears the cache so re-entry parses identical tracks again.
  usingAvPlay = false;
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(ctrl.avplayTotalTracksSignature, null);
  assert.equal(ctrl.avplayCachedAudioTracks, null);
  assert.equal(ctrl.avplayCachedSubtitleTracks, null);

  usingAvPlay = true;
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 15, "re-entering AVPlay must re-parse identical tracks");

  // Circular extra_info cannot be compared safely, so it must always rebuild.
  const circular = {};
  circular.self = circular;
  totalTracks = [{ type: "AUDIO", index: 1, extra_info: circular }];
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 16);
  ctrl.syncAvPlayTrackInfo({ force: true });
  assert.equal(parseCalls, 17, "unserializable metadata must never be treated as unchanged");
});
