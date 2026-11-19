import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const proxySource = await readFile("docs/youtube-proxy.html", "utf8");
const captionFunction = proxySource.slice(
  proxySource.indexOf("function setCaptionsEnabled("),
  proxySource.indexOf("function handleCommand(")
);
const calls = [];
const player = {
  getOptions: () => [],
  loadModule: (name) => calls.push("load:" + name),
  unloadModule: (name) => calls.push("unload:" + name)
};
const captionContext = vm.createContext({
  player,
  captionsEnabled: false,
  safeCall: (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }
});
vm.runInContext(captionFunction, captionContext);
captionContext.setCaptionsEnabled(false);
assert.equal(calls.length, 0, "do not unload modules already absent on API-change callbacks");
player.getOptions = () => ["captions"];
captionContext.setCaptionsEnabled(false);
assert.deepEqual(calls.splice(0), ["unload:captions"]);
player.getOptions = () => {
  throw new Error("unsupported");
};
captionContext.setCaptionsEnabled(false);
assert.deepEqual(
  calls.splice(0),
  ["unload:captions", "unload:cc"],
  "retain the legacy fallback if module discovery fails"
);
captionContext.setCaptionsEnabled(true);
assert.deepEqual(calls, ["load:captions", "load:cc"], "enabling captions must remain unchanged");

// Verify onError posts an explicit error event rather than swapping in a raw youtube.com/embed iframe.
const apiReadySource = proxySource.slice(
  proxySource.indexOf("window.onYouTubeIframeAPIReady ="),
  proxySource.indexOf("if (directEmbedRequested)")
);
const postedEvents = [];
const clearedTimeouts = [];
let playerConfig = null;
let fallbackCalled = 0;
const apiReadyContext = vm.createContext({
  window: {},
  videoId: "m8vcBN8uza8",
  autoplay: true,
  captionsEnabled: false,
  loop: false,
  pageOriginIsHttp: true,
  pageOrigin: "https://nuviomedia.github.io",
  widgetReferrer: "https://nuviomedia.github.io/NuvioTVSmart/",
  startMuted: false,
  ready: false,
  readyWatchdog: null,
  stateTimer: null,
  player: null,
  setTimeout: () => 1,
  clearTimeout: (id) => clearedTimeouts.push(id),
  setCaptionsEnabled: () => {},
  ensureStateTimer: () => {},
  pushState: () => {},
  fallbackToDirectEmbed: () => {
    fallbackCalled += 1;
  },
  postToParent: (type, payload) => {
    postedEvents.push({ type, ...payload });
  },
  YT: {
    Player: function MockPlayer(_id, config) {
      playerConfig = config;
    }
  }
});
vm.runInContext(apiReadySource, apiReadyContext);
apiReadyContext.window.onYouTubeIframeAPIReady();
assert.ok(playerConfig?.events?.onError, "YT.Player config must define onError");
playerConfig.events.onError({ data: 150 });
assert.equal(
  fallbackCalled,
  0,
  "onError must not replace the proxy with a raw youtube.com/embed iframe"
);
assert.deepEqual(clearedTimeouts, [1], "onError must disarm the pre-ready direct-embed watchdog");
assert.deepEqual(postedEvents, [{ type: "error", videoId: "m8vcBN8uza8", code: 150 }]);

// Verify MetaDetailsScreen stops trailer playback on explicit error or post-ready controllable:false fallback,
// and reclaims focus if the trailer iframe ever becomes document.activeElement.
const detail01Source = (
  await readFile("js/ui/screens/detail/metaDetailsScreenMethods-01-get-route-state-key.js", "utf8")
)
  .replace(/^import [\s\S]*?;$/gm, "")
  .replace(/^export /gm, "");
const detail18Source = (
  await readFile(
    "js/ui/screens/detail/metaDetailsScreenMethods-18-stop-trailer-progress-timer.js",
    "utf8"
  )
)
  .replace(/^import [\s\S]*?;$/gm, "")
  .replace(/^export /gm, "");

let windowMessageListener = null;
let windowBlurListener = null;
const detailMockDoc = { activeElement: null };
const detailContext = vm.createContext({
  internals: {
    resolveTrailerPostMessageTargetOrigin: () => "*",
    resolveTrailerTrustedProxyOrigin: () => "https://nuviomedia.github.io",
    resolveTrailerSource: () => null,
    normalizeTrailerProxyStatePayload: (data) => ({
      currentTime: Number(data?.state?.currentTime || 0),
      duration: Number(data?.state?.duration || 0),
      paused: Boolean(data?.state?.paused),
      muted: Boolean(data?.state?.muted),
      captionsEnabled: Boolean(data?.state?.captionsEnabled),
      loading: Boolean(data?.state?.loading),
      controllable: data?.state?.controllable !== false,
      ended: Boolean(data?.state?.ended)
    }),
    captureHorizontalScrollMap: () => ({}),
    t: (_k, _p, fallback) => fallback,
    formatPlaybackTime: () => "0:00"
  },
  detailShuffleSettings: () => ({ enabled: false }),
  window: {
    addEventListener: (name, fn) => {
      if (name === "message") windowMessageListener = fn;
      if (name === "blur") windowBlurListener = fn;
    },
    removeEventListener: (name, fn) => {
      if (name === "message" && windowMessageListener === fn) windowMessageListener = null;
      if (name === "blur" && windowBlurListener === fn) windowBlurListener = null;
    }
  },
  document: detailMockDoc,
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {}
});
vm.runInContext(
  `${detail01Source}\n${detail18Source}\nglobalThis.detailMethods = Object.assign(createMetaDetailsScreenMethods01(), createMetaDetailsScreenMethods18());`,
  detailContext
);

let detailStopCalls = 0;
let overlayFocused = 0;
let frameBlurred = 0;
const mockFrameWindow = {};
const mockFrame = {
  contentWindow: mockFrameWindow,
  blur: () => {
    frameBlurred += 1;
  }
};
const mockOverlay = {
  classList: { toggle: () => {} },
  focus: () => {
    overlayFocused += 1;
    detailMockDoc.activeElement = mockOverlay;
  }
};
const detailScreen = Object.assign(Object.create(detailContext.detailMethods), {
  isTrailerPlaying: true,
  trailerPlaybackMode: "manual",
  trailerSource: { kind: "youtube", ytId: "m8vcBN8uza8" },
  trailerUiRefs: { frame: mockFrame, overlay: mockOverlay },
  stopTrailerPlayback() {
    detailStopCalls += 1;
    this.isTrailerPlaying = false;
  },
  postTrailerProxyCommand() {}
});
detailScreen.bindTrailerProxyMessaging();
await detailScreen.initYoutubeTrailerPlayer();

// 1. Focus guard reclaims focus when iframe steals it on window blur. Blink ignores
// a synchronous blur() during the focus change, so the reclaim runs on the next task.
detailMockDoc.activeElement = mockFrame;
windowBlurListener?.();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(frameBlurred, 1, "trailer iframe must be blurred when it steals focus");
assert.equal(overlayFocused, 1, "detail trailer overlay must reclaim focus");

// 2. Post-ready controllable:false fallback from legacy hosted youtube-proxy stops trailer playback
windowMessageListener({
  origin: "https://nuviomedia.github.io",
  source: mockFrameWindow,
  data: { source: "nuvio-youtube-proxy", type: "ready", videoId: "m8vcBN8uza8" }
});
assert.equal(detailScreen.trailerProxyReadyReceived, true);
windowMessageListener({
  origin: "https://nuviomedia.github.io",
  source: mockFrameWindow,
  data: {
    source: "nuvio-youtube-proxy",
    type: "state",
    state: {
      currentTime: 0,
      duration: 0,
      paused: true,
      muted: false,
      loading: true,
      controllable: false
    }
  }
});
assert.equal(
  detailStopCalls,
  1,
  "post-ready controllable:false fallback must stop trailer playback immediately"
);

// 3. Explicit error event stops trailer playback
detailScreen.isTrailerPlaying = true;
await detailScreen.initYoutubeTrailerPlayer();
windowMessageListener({
  origin: "https://nuviomedia.github.io",
  source: mockFrameWindow,
  data: { source: "nuvio-youtube-proxy", type: "error", videoId: "m8vcBN8uza8", code: 150 }
});
assert.equal(detailStopCalls, 2, "explicit proxy error event must stop trailer playback");

console.log("YouTube caption module and trailer error/focus guard fixtures passed.");
