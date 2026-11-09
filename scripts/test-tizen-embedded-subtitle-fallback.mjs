import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// A Tizen SubRip track is not drawn by AVPlay natively, and the local
// extractor may be unavailable (the packaged service does not start). AVPlay
// still delivers onsubtitlechange, so the player must keep the HTML callback
// overlay armed instead of switching to native rendering.

async function loadMethods(number, name, context) {
  const files = await readdir(new URL("../js/ui/screens/player/", import.meta.url));
  const file = files.find((entry) => entry.startsWith(`playerScreenMethods-${number}-`));
  const source = await readFile(
    new URL(`../js/ui/screens/player/${file}`, import.meta.url),
    "utf8"
  );
  vm.runInContext(
    source.replace(/^import .*$/gm, "").replace(/^export /gm, "") + `\nthis.loaded = ${name}();`,
    context
  );
  return context.loaded;
}

async function createHarness({ isTizen = true, track, getWindow }) {
  let windowCalls = 0;
  let unsupportedMarks = 0;
  const avPlaySelections = [];
  const nativeVisibility = [];
  const internals = {
    Environment: { isTizen: () => isTizen, isWebOS: () => !isTizen },
    PlayerController: {
      setAvPlaySubtitleTrack(index, options) {
        avPlaySelections.push({ index, options });
        return true;
      },
      setWebOsEmbeddedSubtitleNativeVisibility(visible, index) {
        nativeVisibility.push({ visible, index });
        return Promise.resolve(true);
      },
      applyAvPlaySubtitleRenderMode() {
        return true;
      }
    },
    localMediaEmbeddedSubtitleRepository: {
      getWindow() {
        windowCalls += 1;
        return getWindow();
      }
    },
    WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES: 3,
    EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS: 120,
    EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS: 20,
    EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS: 30,
    isTx3gSubtitleTrack: (value) => Boolean(value?.tx3g),
    isTizenTx3gEmbeddedSubtitleTrack: (value) => isTizen && Boolean(value?.tx3g),
    isTizenSubRipEmbeddedSubtitleTrack: (value) => isTizen && Boolean(value?.subrip),
    isTizenEmbeddedTextSubtitleFallbackTrack: (value) =>
      isTizen && Boolean(value?.subrip || value?.tx3g),
    isAssSubtitleCodec: () => false,
    getEmbeddedSubtitleSupportState: () => ({ supported: true })
  };
  const context = vm.createContext({ internals, console: { ...console, warn() {} } });
  const methods = await loadMethods("44", "createPlayerScreenMethods44", context);
  const screen = {
    ...methods,
    webOsEmbeddedTextSubtitleTrack: track,
    webOsEmbeddedTextSubtitleUsingHtml: false,
    webOsEmbeddedTextSubtitleUsingAss: false,
    webOsEmbeddedTextSubtitleLoading: false,
    webOsEmbeddedTextSubtitleLoadToken: 0,
    webOsEmbeddedTextSubtitleWindowFailureCount: 0,
    webOsEmbeddedTextSubtitleLastErrorAt: 0,
    webOsEmbeddedTextSubtitleFallbackUnavailable: false,
    webOsEmbeddedTextSubtitleWindowStart: 0,
    webOsEmbeddedTextSubtitleWindowEnd: 0,
    selectedSubtitleTrackIndex: 3,
    selectedEmbeddedSubtitleTrackIndex: 1,
    subtitleDelayMs: 0,
    getTrackProbeUrl: () => "https://example.test/video.mkv",
    getPlaybackCurrentSeconds: () => 30,
    parseSubtitleCues: () => [],
    renderHtmlSubtitleOverlayCue: () => {},
    clearHtmlSubtitleOverlay: () => {},
    scheduleHtmlSubtitleOverlayRender: () => {},
    markEmbeddedTextSubtitleUnsupported() {
      unsupportedMarks += 1;
    }
  };
  return {
    screen,
    get windowCalls() {
      return windowCalls;
    },
    get unsupportedMarks() {
      return unsupportedMarks;
    },
    avPlaySelections,
    nativeVisibility
  };
}

test("Tizen SubRip keeps the AVPlay callback overlay when the extractor is unavailable", async () => {
  const harness = await createHarness({
    track: { subrip: true, sourceTrackId: 4, sourceTrackOrdinal: 1 },
    getWindow: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  const { screen } = harness;

  assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(30), false);
  assert.equal(screen.webOsEmbeddedTextSubtitleFallbackUnavailable, true);
  assert.equal(screen.webOsEmbeddedTextSubtitleUsingHtml, false);
  assert.equal(screen.webOsEmbeddedTextSubtitleWindowFailureCount, 1);
  assert.equal(harness.avPlaySelections.length, 1);
  assert.equal(harness.avPlaySelections[0].index, 3);
  assert.equal(harness.avPlaySelections[0].options.renderMode, "html");
  assert.equal(harness.windowCalls, 1);

  // The failed service must not be retried for the whole playback.
  assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(60), false);
  assert.equal(harness.windowCalls, 1);
});

test("Tizen TX3G still falls back to native AVPlay and stops after bounded failures", async () => {
  const harness = await createHarness({
    track: { tx3g: true, sourceTrackId: 4, sourceTrackOrdinal: 1 },
    getWindow: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  const { screen } = harness;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(30), false);
    assert.equal(screen.webOsEmbeddedTextSubtitleWindowFailureCount, attempt);
    assert.equal(screen.webOsEmbeddedTextSubtitleFallbackUnavailable, attempt === 3);
  }
  assert.doesNotThrow(() => screen.markEmbeddedTextSubtitleUnsupported);
  assert.equal(harness.unsupportedMarks, 3);
  assert.deepEqual(
    Array.from(harness.avPlaySelections, (entry) => entry.options.renderMode),
    ["native", "native", "native"]
  );

  assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(70), false);
  assert.equal(harness.windowCalls, 3);
});

test("webOS first-window failures keep the existing native visibility fallback", async () => {
  const harness = await createHarness({
    isTizen: false,
    track: { subrip: true, sourceTrackId: 4, sourceTrackOrdinal: 1 },
    getWindow: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  const { screen } = harness;

  assert.equal(await screen.loadWebOsEmbeddedTextSubtitleWindow(30), false);
  assert.equal(screen.webOsEmbeddedTextSubtitleFallbackUnavailable, false);
  assert.equal(harness.nativeVisibility.length, 1);
  assert.equal(harness.nativeVisibility[0].visible, true);
  assert.equal(harness.nativeVisibility[0].index, 1);
  assert.deepEqual(harness.avPlaySelections, []);
});
