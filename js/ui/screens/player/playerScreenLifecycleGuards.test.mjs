import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [m11Source, m15Source, m16Source, m30Source, m55Source, videoErrSource] = await Promise.all([
  readFile(
    new URL(
      "./playerScreenMethods-11-release-current-engine-fs-stream-best-effort.js",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL("./playerScreenMethods-15-apply-manifest-track-selection.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerScreenMethods-16-refresh-loading-overlay-presentation.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerScreenMethods-30-schedule-buffering-spinner-refresh.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./playerScreenMethods-55-apply-fallback-addon-subtitle.js", import.meta.url),
    "utf8"
  ),
  readFile(new URL("./playerVideoEventHandlers.js", import.meta.url), "utf8")
]);

test("PlayerScreen guards loading logo/backdrop escaping, stale subtitle object URLs, and stale EngineFS error retry", async () => {
  let capturedHtml = "";
  let retryScheduled = 0;
  let createdObjectUrls = 0;

  class FakeElement {
    constructor() {
      this.attrs = new Map();
      this.classList = { toggle() {}, add() {}, remove() {} };
      this.style = {};
      this.textContent = "";
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
    }
    getAttribute(k) {
      return this.attrs.get(k) ?? null;
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
  }

  const loadingLogoBase = new FakeElement();
  const loadingLogoFill = new FakeElement();

  const ctx = vm.createContext({
    HTMLElement: FakeElement,
    document: {
      createElement: () => ({
        id: "",
        className: "",
        tabIndex: -1,
        set innerHTML(v) {
          capturedHtml = String(v);
        },
        get innerHTML() {
          return capturedHtml;
        }
      })
    },
    URL: {
      createObjectURL: () => {
        createdObjectUrls += 1;
        return "blob:sub-1";
      },
      revokeObjectURL: () => {}
    },
    Blob: class FakeBlob {},
    PlayerController: { video: null },
    parseVttCueLayout: () => ({ line: null, position: null, align: null }),
    console,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    internals: {
      PlayerController: { video: {}, isUsingAvPlay: () => false, lastPlaybackErrorCode: 2 },
      PlayerSettingsStore: { get: () => ({ osdClockEnabled: false, autoSyncSubtitles: false }) },
      TorrentSettingsStore: { get: () => ({}) },
      Environment: { isWebOS: () => false, isTizen: () => false },
      Platform: { isTizen: () => false, isWebOS: () => false },
      isAssSubtitle: () => false,
      SUBTITLE_LANGUAGE_OFF_KEY: "off",
      SUBTITLE_VIRTUAL_ROW_GAP: 8,
      createSubtitleOptionVirtualState: () => ({}),
      renderLoadingIndicator: () => "",
      t: (_k, _p, f) => f || "",
      escapeHtml: (v) =>
        String(v || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]),
      escapeAttribute: (v) =>
        String(v || "").replace(
          /[&<>"']/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
        ),
      isExpiredStreamUrl: () => false,
      isTerminalHlsHttpStatus: () => false,
      logEngineFsDebug: () => {},
      claimEngineFsPlayback: () => 1,
      subtitleLabel: (i) => `Sub ${i}`,
      normalizeTrackLanguageCode: (l) => l || "en",
      parseVttCueLayout: () => ({ line: null, position: null, align: null }),
      normalizePlaybackDisplayLineBreaks: (s) => s,
      clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
      formatBytes: () => "0 B",
      formatBytesPerSecond: () => "0 B/s"
    }
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${stripModule(m11Source)}\n${stripModule(m15Source)}\n${stripModule(m16Source)}\n${stripModule(m30Source)}\n${stripModule(m55Source)}\n${stripModule(videoErrSource)}\nglobalThis.api = { ...createPlayerScreenMethods11(), ...createPlayerScreenMethods15(), ...createPlayerScreenMethods16(), ...createPlayerScreenMethods30(), ...createPlayerScreenMethods55() };`,
    ctx
  );

  const player = Object.assign(Object.create(ctx.api), {
    params: { playerTitle: "Movie", itemId: "tt1" },
    externalFrameMode: false,
    playerRouteActive: true,
    playerMountToken: 1,
    activePlaybackUrl: "http://127.0.0.1:8000/stream",
    currentEngineFsStream: { url: "http://127.0.0.1:8000/stream" },
    hasPresentedPlaybackFrame: false,
    subtitleSelectionToken: 1,
    externalTrackNodes: [],
    externalSubtitleObjectUrls: [],
    container: { querySelector: () => null, appendChild() {} },
    isExternalFrameMode: () => false,
    isLivePlayback: () => false,
    getPlayerHeaderData: () => ({ title: "Movie", subtitle: "" }),
    getLoadingOverlayMeta: () => ({
      title: "Movie",
      subtitle: "",
      logoUrl: "https://example.com/logo-new.png",
      backdropUrl: 'https://example.com/bg"injected.jpg'
    }),
    syncLoadingOverlayProgress() {},
    syncTorrentOverlay() {},
    cachePlayerUiRefs() {},
    syncPlayerOverlayLayoutState() {},
    bindLoadingLogoFallback() {},
    renderControlButtons() {},
    renderSubtitleDialog() {},
    renderSubtitleDelayOverlay() {},
    renderSubtitleTimingDialog() {},
    renderAudioDialog() {},
    renderSpeedDialog() {},
    renderSourcesPanel() {},
    renderParentalGuideOverlay() {},
    renderSkipIntroButton() {},
    renderSeekOverlay() {},
    renderPauseOverlay() {},
    renderNextEpisodeCard() {},
    renderSourcesDialog() {},
    renderStreamInfoModal() {},
    syncPauseOverlay() {},
    syncControlsOverlayVisibility() {},
    syncControlButtonIcons() {},
    syncPlayPauseUi() {},
    renderProgress() {},
    syncLoadingOverlayStatus() {},
    shouldKeepEngineFsRetryErrorHidden: () => false,
    isStartupErrorVisible: () => false,
    getPlaybackEventErrorDetail: () => "",
    getStreamCandidateByUrl: () => null,
    getCurrentStreamCandidate: () => null,
    getCurrentEngineFsState: () => player.currentEngineFsStream,
    findPublicEngineFsPlaybackUrl: () => "",
    retryCurrentStreamFromStartAfter416: () => false,
    shouldRetryEngineFsStartupError: () => true,
    scheduleEngineFsStartupRetry() {
      retryScheduled += 1;
    },
    async fetchCurrentEngineFsStats() {
      player.activePlaybackUrl = "https://cdn.example.com/switched.mp4";
      return { peers: 1 };
    },
    revokeExternalSubtitleObjectUrls() {
      this.externalSubtitleObjectUrls.length = 0;
    },
    createSubtitleObjectUrl() {
      createdObjectUrls += 1;
      return "blob:sub-created";
    },
    convertSrtToVtt: (s) => s,
    parseSubtitleTimestamp: (v) => (String(v).includes("03") ? 3 : 1),
    parseSubtitleCueText: (s) => s.trim(),
    getTextTracks: () => [],
    disableEmbeddedSubtitleSelection() {},
    clearMountedExternalSubtitleTracks() {},
    clearHtmlSubtitleOverlay() {},
    fetchSubtitleRawBody: async () => {
      player.subtitleSelectionToken += 1;
      return { body: "1\n00:00:01,000 --> 00:00:02,000\nHi\n", contentType: "text/plain" };
    },
    normalizeSubtitleSelectionToken: (t) => Number(t || 0)
  });

  // 1. Escape backdropUrl in renderPlayerUi() + reset renderedSubtitleAutoSyncStatusMarkup.
  player.renderedSubtitleAutoSyncStatusMarkup = "<span>stale</span>";
  player.renderPlayerUi();
  assert.equal(player.renderedSubtitleAutoSyncStatusMarkup, "");
  assert.equal(
    capturedHtml.includes('bg"injected.jpg'),
    false,
    "renderPlayerUi must escape quotes in loadingMeta.backdropUrl"
  );

  // 2. refreshLoadingOverlayPresentation updates both loadingLogoBase and loadingLogoFill.
  player.uiRefs = {
    loadingOverlay: { querySelector: () => null },
    loadingIdentity: new FakeElement(),
    loadingLogoBase,
    loadingLogoFill,
    loadingTitle: new FakeElement(),
    loadingSubtitle: new FakeElement()
  };
  player.refreshLoadingOverlayPresentation();
  assert.equal(loadingLogoBase.getAttribute("src"), "https://example.com/logo-new.png");
  assert.equal(
    loadingLogoFill.getAttribute("src"),
    "https://example.com/logo-new.png",
    "refreshLoadingOverlayPresentation must update loadingLogoFill in addition to loadingLogoBase"
  );

  // 3. Stale fetchCurrentEngineFsStats after stream switch must not schedule retry.
  let handlers = null;
  vm.runInContext("globalThis.__makeHandlers = createPlayerVideoEventHandlers;", ctx);
  handlers = ctx.__makeHandlers.call(player, {}, () => false);
  await handlers.onError({ detail: { mediaErrorCode: 2 } });
  assert.equal(
    retryScheduled,
    0,
    "stale EngineFS error callback after switching stream must not call scheduleEngineFsStartupRetry"
  );

  // 4. A superseded external subtitle load must not allocate a blob URL.
  await player.applyFallbackAddonSubtitle(0, 1, {
    id: "sub-1",
    url: "https://example.com/sub.srt",
    lang: "en"
  });
  assert.equal(
    createdObjectUrls,
    0,
    "superseded external subtitle load must not create object URLs that would never be mounted"
  );
});
