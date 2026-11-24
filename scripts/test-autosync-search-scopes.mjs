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

function load(qualityByUrl, { noFit = false } = {}) {
  const source = readFileSync(
    path.join(ROOT, "js/ui/screens/player/playerScreenMethods-74-automatic-subtitle-sync.js"),
    "utf8"
  )
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export (function|const)/gm, "$1");
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
    Object,
    AUTO_SYNC_TOLERANCE_OPTIONS_MS: [0],
    AUTO_SYNC_DEFAULT_TOLERANCE_MS: 300,
    retimeAutoSyncSubtitleText: () => "",
    confirmsAutoSyncNoFit: () => false,
    isConfirmedAutoSyncNoFit: () => noFit,
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

async function runScope(
  scope,
  qualityByUrl,
  {
    noFit = false,
    referenceRequests = [{ trackNumber: 1, trackOrdinal: 0 }],
    applied: applyResult = true,
    toleranceMs = 0
  } = {}
) {
  const { methods, aligned } = load(qualityByUrl, { noFit });
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
    getAutomaticSubtitleSyncSettings: () => ({ enabled: true, thorough: false, toleranceMs }),
    isLivePlayback: () => false,
    getTrackProbeUrl: () => "https://video.example/v.mkv",
    getSubtitleAutoSyncReferenceRequests: () => referenceRequests,
    fetchSubtitleRawBody: async (url) => ({ body: url }),
    parseSubtitleCues: (body) => cuesFor(body),
    switchToAutoSyncAlternative: (candidate) => switched.push(candidate.url),
    applyAutomaticSubtitleSyncTimeline: async () => applied.push("a") > 0 && applyResult,
    invalidateTrackDialogCaches() {},
    renderSubtitleDialog() {}
  };
  screen.maybeRunAutomaticSubtitleSync(selected, { scope });
  const startState = screen.autoSyncStatus?.state || null;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const option = (url, selectedOption = true) => ({
    selected: selectedOption,
    entry: { track: { url } }
  });
  return {
    aligned,
    switched,
    applied,
    startState,
    state: screen.getSelectedSubtitleAutoSyncState(),
    chip: screen.isSubtitleOptionAutoSynced(option("a")),
    chipWhenNotSelected: screen.isSubtitleOptionAutoSynced(option("a", false))
  };
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

// Android AutoSyncStatusIndicator states and the "Auto synced" chip (be2f5dbdd, 09223b898).
test("a corrected subtitle shows Synced and the chip only while selected", async () => {
  const result = await runScope("selected", { a: 0.9 });
  assert.equal(result.startState, "in_progress");
  assert.equal(result.state, "synced");
  assert.equal(result.chip, true);
  assert.equal(result.chipWhenNotSelected, false);
});

test("a correction within the tolerance shows Not needed and no chip", async () => {
  const result = await runScope("selected", { a: 0.9 }, { toleranceMs: 500 });
  assert.deepEqual(result.applied, []);
  assert.equal(result.state, "not_needed");
  assert.equal(result.chip, false);
});

test("a confirmed mismatch shows May not match instead of a toast", async () => {
  const result = await runScope("selected", {}, { noFit: true });
  assert.equal(result.state, "no_fit");
  assert.equal(result.chip, false);
});

test("an inconclusive comparison shows Failed", async () => {
  const result = await runScope("selected", {});
  assert.equal(result.state, "failed");
});

test("a video without embedded text subtitles shows No embedded subtitles", async () => {
  const result = await runScope("selected", { a: 0.9 }, { referenceRequests: [] });
  assert.deepEqual(result.aligned, []);
  assert.equal(result.state, "no_reference");
});

test("a timeline that cannot be applied shows Failed", async () => {
  const result = await runScope("selected", { a: 0.9 }, { applied: false });
  assert.equal(result.state, "failed");
});

test("switching to a better same-language subtitle leaves no stale In progress", async () => {
  const result = await runScope("startup", { a: 0.5, b: 0.9 });
  assert.deepEqual(result.switched, ["b"]);
  assert.equal(result.state, null);
});
