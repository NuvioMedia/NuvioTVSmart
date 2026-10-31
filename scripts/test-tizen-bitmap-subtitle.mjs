import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
globalThis.__NUVIO_PLATFORM__ = "tizen";
globalThis.__NUVIO_TIZEN_VERSION__ = "6.0";
globalThis.document = {
  createElement: (tagName) =>
    String(tagName).toLowerCase() === "canvas"
      ? { getContext: () => ({ createImageData: () => ({ data: [] }) }) }
      : {}
};

const bitmapWindowCalls = [];
const embeddedParserPath =
  require.resolve("../services/tizen/runtime/embedded-text-subtitle-parser.cjs");
require.cache[embeddedParserPath] = {
  id: embeddedParserPath,
  filename: embeddedParserPath,
  loaded: true,
  exports: {
    getBitmapSubtitleWindow(options) {
      bitmapWindowCalls.push(options);
      return Promise.resolve({
        format: "vobsub",
        cueCount: 2,
        idxContent: "timestamp: 00:00:10:000, filepos: 00000000\n",
        subBase64: "AAAA",
        windowStartSeconds: 10,
        windowEndSeconds: 40,
        contextStartSeconds: 0,
        contextType: "vobsub"
      });
    }
  }
};
const subtitleService = require("../services/tizen/runtime/tx3g-subtitle-service.cjs");

function invokeService(url) {
  return new Promise((resolve) => {
    const request = { method: "GET", url };
    const response = {
      statusCode: 0,
      headers: null,
      body: "",
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(body) {
        this.body = String(body || "");
        resolve({ statusCode: this.statusCode, headers: this.headers, body: this.body });
      }
    };
    subtitleService.handleRequest(request, response);
  });
}

test("Tizen subtitle service extracts a VobSub window by container track number", async () => {
  const response = await invokeService(
    "/bitmap-subtitle?url=https%3A%2F%2Fexample.test%2Fvideo.mkv&trackNumber=4&startSeconds=10&endSeconds=40"
  );
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.format, "vobsub");
  assert.equal(payload.cueCount, 2);
  assert.deepEqual(bitmapWindowCalls.at(-1), {
    url: "https://example.test/video.mkv",
    trackNumber: 4,
    startSeconds: 10,
    endSeconds: 40
  });
});

test("Tizen subtitle service rejects a bitmap request without a track number", async () => {
  const callsBefore = bitmapWindowCalls.length;
  const response = await invokeService(
    "/bitmap-subtitle?url=https%3A%2F%2Fexample.test%2Fvideo.mkv&startSeconds=10&endSeconds=40"
  );
  assert.equal(response.statusCode, 400);
  assert.equal(bitmapWindowCalls.length, callsBefore);
});

const { createPlayerScreenMethods41 } =
  await import("../js/ui/screens/player/playerScreenMethods-41-build-subtitle-track-signature.js");
const { getEmbeddedSubtitleSupportState } =
  await import("../js/ui/screens/player/playerScreenHelpers-04-format-subtitle-codec-label.js");
const { normalizeTrackLanguageCode, inferTrackLanguageCodeFromText, getTrackLanguageValue } =
  await import("../js/ui/screens/player/playerScreenHelpers-05-normalize-track-language-code.js");
const { isForcedSubtitleTrack } =
  await import("../js/ui/screens/player/playerScreenHelpers-06-get-track-flag-candidates.js");
const { subtitleLabel, cleanDisplayText } =
  await import("../js/ui/screens/player/playerScreenHelpers-02-language-code-aliases.js");
const { isGenericSubtitleTrackLabel } =
  await import("../js/ui/screens/player/playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js");

function createMetadataContext(embeddedTracks) {
  return Object.assign(
    {
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
        return this.embeddedSubtitleTracks[Number(index)] || null;
      }
    },
    createPlayerScreenMethods41()
  );
}

test("AVPlay metadata keeps the VobSub container identity for the software path", () => {
  const embedded = [
    {
      embeddedTrackIndex: 0,
      sourceTrackId: 4,
      nativeTrackIndex: 2,
      language: "en",
      label: "English",
      codec: "S_VOBSUB",
      bitmapSubtitle: true,
      bitmapSubtitleFormat: "vobsub"
    }
  ];
  const context = createMetadataContext(embedded);
  const merged = context.mergeAvPlaySubtitleTrackMetadata(
    {
      avplayTrackIndex: 2,
      language: "",
      label: "Subtitle 1",
      codec: "text/plain",
      extraInfo: { track_num: "0" }
    },
    0
  );
  assert.equal(merged.bitmapSubtitle, true);
  assert.equal(merged.bitmapSubtitleFormat, "vobsub");
  assert.equal(merged.sourceTrackId, 4);
  assert.equal(merged.codec, "S_VOBSUB");
  assert.equal(getEmbeddedSubtitleSupportState(merged).supported, true);
});

const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods53 } =
  await import("../js/ui/screens/player/playerScreenMethods-53-render-subtitle-style-control-in-place.js");
const { createPlayerScreenMethods46 } =
  await import("../js/ui/screens/player/playerScreenMethods-46-schedule-html-subtitle-overlay-render.js");

test("Tizen selects the AVPlay index silently and renders VobSub from the container", () => {
  const avplayCalls = [];
  PlayerController.setAvPlaySubtitleTrack = (trackIndex, options) => {
    avplayCalls.push({ trackIndex, options });
    return true;
  };
  const cleared = [];
  const loaded = [];
  const context = Object.assign(createPlayerScreenMethods53(), {
    externalTrackNodes: [],
    bitmapSubtitleTrack: null,
    selectedSubtitleTrackIndex: -1,
    selectedEmbeddedSubtitleTrackIndex: -1,
    selectedAddonSubtitleId: null,
    selectedManifestSubtitleTrackId: null,
    subtitleDelayMs: 0,
    getActiveSubtitleSelectionKey: () => "off",
    getPlaybackCurrentSeconds: () => 42,
    clearEmbeddedSubtitleCueRefreshTimers() {},
    clearWebOsEmbeddedTextSubtitleOverlay() {},
    clearHtmlSubtitleOverlay() {},
    clearBitmapSubtitleOverlay(options) {
      cleared.push(options);
      this.bitmapSubtitleTrack = null;
    },
    resetSubtitleDelayAfterSelectionChange() {},
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderSubtitleDialog() {},
    loadBitmapSubtitleWindow(timeSeconds) {
      loaded.push(timeSeconds);
      return Promise.resolve(true);
    }
  });
  const track = {
    embeddedTrackIndex: 0,
    sourceTrackId: 4,
    language: "en",
    label: "English",
    codec: "S_VOBSUB",
    bitmapSubtitle: true,
    bitmapSubtitleFormat: "vobsub"
  };
  const applied = context.applyBitmapEmbeddedSubtitleTrack(track, 0, { avplayTrackIndex: 3 });
  assert.equal(applied, true);
  assert.deepEqual(avplayCalls, [
    { trackIndex: 3, options: { renderMode: "html", keepSilent: true } }
  ]);
  assert.equal(context.bitmapSubtitleTrack, track);
  assert.equal(context.selectedSubtitleTrackIndex, 3);
  assert.equal(context.selectedEmbeddedSubtitleTrackIndex, -1);
  assert.deepEqual(cleared, [{ dispose: true }]);
  assert.deepEqual(loaded, [42]);
});

test("Tizen keeps PGS on the AVPlay native path", () => {
  PlayerController.setAvPlaySubtitleTrack = () => true;
  const context = Object.assign(createPlayerScreenMethods53(), {
    externalTrackNodes: [],
    getActiveSubtitleSelectionKey: () => "off",
    clearEmbeddedSubtitleCueRefreshTimers() {},
    clearWebOsEmbeddedTextSubtitleOverlay() {},
    clearHtmlSubtitleOverlay() {},
    clearBitmapSubtitleOverlay() {},
    resetSubtitleDelayAfterSelectionChange() {},
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderSubtitleDialog() {},
    loadBitmapSubtitleWindow() {},
    getPlaybackCurrentSeconds: () => 0
  });
  const applied = context.applyBitmapEmbeddedSubtitleTrack(
    {
      embeddedTrackIndex: 1,
      sourceTrackId: 5,
      codec: "S_HDMV/PGS",
      bitmapSubtitle: true,
      bitmapSubtitleFormat: "pgs"
    },
    1,
    { avplayTrackIndex: 4 }
  );
  assert.equal(applied, false);
});

test("Late AVPlay text callbacks do not replace the VobSub canvas", () => {
  PlayerController.isUsingAvPlay = () => true;
  let overlayRenders = 0;
  const context = Object.assign(createPlayerScreenMethods46(), {
    bitmapSubtitleTrack: { bitmapSubtitleFormat: "vobsub" },
    renderHtmlSubtitleOverlayCue() {
      overlayRenders += 1;
    }
  });
  context.renderAvPlaySubtitleChange({ subtitles: "stale text", duration: 2000 });
  assert.equal(overlayRenders, 0);
});

const { TizenEngineFsService } = await import("../js/platform/tizen/tizenEngineFsService.js");
const { localMediaBitmapSubtitleRepository } =
  await import("../js/data/repository/localMediaBitmapSubtitleRepository.js");

test("Tizen bitmap repository reads the window from the local subtitle service", async () => {
  TizenEngineFsService.getLocalBaseUrls = () => ["http://127.0.0.1:2710"];
  TizenEngineFsService.ensureStarted = async () => ({ status: "success" });
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        format: "vobsub",
        cueCount: 1,
        idxContent: "timestamp: 00:00:10:000, filepos: 00000000\n",
        subBase64: "AQID",
        windowStartSeconds: 10,
        windowEndSeconds: 40,
        contextStartSeconds: 0,
        contextType: "vobsub"
      })
    };
  };
  const windowData = await localMediaBitmapSubtitleRepository.getWindow({
    url: "https://example.test/video.mkv",
    trackNumber: 4,
    startSeconds: 10,
    endSeconds: 40
  });
  assert.match(requestedUrl, /^http:\/\/127\.0\.0\.1:2715\/bitmap-subtitle\?/);
  assert.match(requestedUrl, /trackNumber=4/);
  assert.equal(windowData.format, "vobsub");
  assert.equal(windowData.trackNumber, 4);
  assert.equal(windowData.cueCount, 1);
  assert.equal(windowData.windowStartSeconds, 10);
  assert.equal(windowData.windowEndSeconds, 40);
  assert.equal(windowData.data.length, 3);
  assert.match(windowData.idxContent, /filepos/);
});
