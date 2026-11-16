import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Android AutoSync scopes: STARTUP_SEARCH weighs the picked subtitle with its
// same-language peers, SELECTED_THEN_SEARCH searches only when the restored one
// does not fit, SELECTED_ONLY never swaps a manual pick.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(qualityByUrl) {
  const source = readFileSync(
    path.join(ROOT, "js/ui/screens/player/playerScreenMethods-74-automatic-subtitle-sync.js"),
    "utf8"
  )
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export function/m, "function");
  const aligned = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    String,
    Boolean,
    Math,
    Set,
    Array,
    AUTO_SYNC_TOLERANCE_OPTIONS_MS: [0],
    retimeAutoSyncSubtitleText: () => "",
    confirmsAutoSyncNoFit: () => false,
    isConfirmedAutoSyncNoFit: () => false,
    alignSubtitleAutoSyncAsync: async ({ targetCues }) => {
      const url = targetCues[0].text;
      aligned.push(url);
      const quality = qualityByUrl[url];
      return quality == null
        ? { confident: false }
        : {
            confident: true,
            activityScore: quality,
            averageMatchCost: 0,
            targetCoverage: 0.9,
            referenceCoverage: 0.9,
            maxShiftMs: 500,
            scale: 1,
            interceptMs: 0,
            cues: [{ originalStartTimeMs: 0 }, { originalStartTimeMs: 1000 }]
          };
    },
    internals: {
      PlayerSettingsStore: {},
      Environment: { isWebOS: () => true, isTizen: () => false },
      localMediaEmbeddedSubtitleRepository: { getTimeline: async () => ({ cues: [] }) },
      convertAssBodyToVtt: (body) => body,
      isAssSubtitle: () => false,
      isTx3gSubtitleTrack: () => false,
      normalizeSubtitleLanguageKey: (value) => value,
      t: (_key, _params, fallback) => fallback
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__methods = createPlayerScreenMethods74();`, sandbox);
  return { methods: sandbox.__methods, aligned };
}

const cuesFor = (url) => Array.from({ length: 5 }, () => ({ start: 0, end: 1, text: url }));

async function runScope(scope, qualityByUrl) {
  const { methods, aligned } = load(qualityByUrl);
  const selected = { url: "a", lang: "it" };
  const switched = [];
  const applied = [];
  const screen = {
    ...methods,
    subtitles: [selected, { url: "b", lang: "it" }, { url: "c", lang: "en" }],
    subtitleSelectionToken: 1,
    selectedAddonSubtitleId: "a",
    activePlaybackUrl: "https://video.example/v.mkv",
    currentAddonSubtitleSource: { subtitleId: "a", subtitleUrl: "a", cues: cuesFor("a") },
    getAutomaticSubtitleSyncSettings: () => ({ enabled: true, thorough: false, toleranceMs: 0 }),
    isLivePlayback: () => false,
    getTrackProbeUrl: () => "https://video.example/v.mkv",
    getSubtitleAutoSyncReferenceRequests: () => [{ trackNumber: 1, trackOrdinal: 0 }],
    fetchSubtitleRawBody: async (url) => ({ body: url }),
    parseSubtitleCues: (body) => cuesFor(body),
    switchToAutoSyncAlternative: (candidate) => switched.push(candidate.url),
    applyAutomaticSubtitleSyncTimeline: async () => applied.push("a") > 0,
    markSubtitleAutoSynced() {},
    showAutomaticSubtitleSyncNoFit() {}
  };
  screen.maybeRunAutomaticSubtitleSync(selected, { scope });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { aligned, switched, applied };
}

test("start-up search switches to a same-language subtitle that fits better", async () => {
  const result = await runScope("startup", { a: 0.5, b: 0.9 });
  assert.deepEqual(result.aligned, ["a", "b"]);
  assert.deepEqual(result.switched, ["b"]);
  assert.deepEqual(result.applied, []);
});

test("start-up search keeps the picked subtitle when it fits best", async () => {
  const result = await runScope("startup", { a: 0.9, b: 0.5 });
  assert.deepEqual(result.switched, []);
  assert.deepEqual(result.applied, ["a"]);
});

test("a restored subtitle that fits is kept without searching", async () => {
  const result = await runScope("restored", { a: 0.5, b: 0.9 });
  assert.deepEqual(result.aligned, ["a"]);
  assert.deepEqual(result.applied, ["a"]);
});

test("a restored subtitle that does not fit is replaced by the search", async () => {
  const result = await runScope("restored", { b: 0.9 });
  assert.deepEqual(result.switched, ["b"]);
});

test("a manual pick is never swapped", async () => {
  const result = await runScope("selected", { b: 0.9 });
  assert.deepEqual(result.aligned, ["a"]);
  assert.deepEqual(result.switched, []);
});
