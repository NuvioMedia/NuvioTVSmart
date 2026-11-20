import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("playerControllerMethods-04 caches AVPlay track parsing and invalidates on resets or AVPlay exit", async () => {
  const src04 = stripModule(
    await readFile(
      new URL("./playerControllerMethods-04-sync-av-play-track-info.js", import.meta.url),
      "utf8"
    )
  );

  const context = vm.createContext({
    internals: new Proxy(
      {
        Platform: { isTizen: () => false },
        logTizenAvPlayDebug() {}
      },
      {
        get(target, prop) {
          return prop in target ? target[prop] : () => {};
        }
      }
    )
  });
  context.globalThis = context;
  vm.runInContext(`${src04}\nglobalThis.api = createPlayerControllerMethods04();`, context);

  let parseCalls = 0;
  let usingAvPlay = true;
  let tracks = [{ type: "AUDIO", index: 1, extra_info: '{"language":"eng"}' }];
  const ctrl = Object.assign(Object.create(context.api), {
    avplaySeekInFlight: false,
    isUsingAvPlay: () => usingAvPlay,
    getAvPlay: () => ({
      getTotalTrackInfo: () => tracks,
      getCurrentStreamInfo: () => [{ type: "AUDIO", index: 1 }]
    }),
    normalizeAvPlayTrackType: (t) => t,
    parseAvPlayExtraInfo: (raw) => {
      parseCalls += 1;
      return typeof raw === "string" ? JSON.parse(raw) : raw || {};
    },
    pickAvPlayExtraValue: () => "",
    pickAvPlayTrackLabel: () => "English",
    pickAvPlayTrackLanguage: () => "eng",
    resolveAvPlayAudioTrackIndex: (i) => i,
    resolveAvPlaySubtitleTrackIndex: (i) => i
  });

  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 1);

  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 1, "unchanged totalTracks must reuse parsed tracks");

  // (a) Externally resetting avplayAudioTracks (e.g. -08 / media switch) forces re-parse.
  ctrl.avplayAudioTracks = [];
  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 2, "external reset of avplayAudioTracks must invalidate cache");

  // Cached again when unchanged.
  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 2);

  // (b) Leaving AVPlay clears avplayTotalTracksSignature so re-entry re-parses identical tracks.
  usingAvPlay = false;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(ctrl.avplayTotalTracksSignature, null);
  assert.equal(ctrl.avplayCachedAudioTracks, null);
  assert.equal(ctrl.avplayCachedSubtitleTracks, null);

  usingAvPlay = true;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 3, "re-entering AVPlay must re-parse identical tracks");

  // Object extra_info is safely serialized in signature and reacts to changes.
  tracks = [{ type: "AUDIO", index: 1, extra_info: { language: "spa" } }];
  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 4);

  tracks = [{ type: "AUDIO", index: 1, extra_info: { language: "fre" } }];
  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 5, "changed object extra_info must update tracksSignature");

  // Circular object extra_info does not throw during signature serialization.
  const circular = {};
  circular.self = circular;
  tracks = [{ type: "AUDIO", index: 1, extra_info: circular }];
  ctrl.avplayTrackSyncAt = 0;
  ctrl.syncAvPlayTrackInfo({ force: false });
  assert.equal(parseCalls, 6);
});
