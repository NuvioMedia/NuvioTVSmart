import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

function createMockElement(tagName = "div") {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    tagName: String(tagName).toUpperCase(),
    dataset: {},
    style: {},
    children: [],
    isConnected: true,
    parentElement: null,
    _muted: false,
    defaultMuted: false,
    volume: 1,
    paused: false,
    ended: false,
    readyState: 0,
    currentTime: 0,
    duration: 30,
    className: "",
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          }
          classes.add(name);
          return true;
        }
        if (force) {
          classes.add(name);
          return true;
        }
        classes.delete(name);
        return false;
      },
      contains: (name) => classes.has(name)
    },
    setAttribute(k, v) {
      attrs.set(String(k), String(v));
      if (k === "muted") {
        this._muted = true;
      }
    },
    removeAttribute(k) {
      attrs.delete(String(k));
      if (k === "muted") {
        this._muted = false;
      }
    },
    hasAttribute(k) {
      return attrs.has(String(k));
    },
    getAttribute(k) {
      return attrs.has(String(k)) ? attrs.get(String(k)) : null;
    },
    get muted() {
      return this._muted;
    },
    set muted(value) {
      this._muted = Boolean(value);
      this.onMutedChange?.(this._muted);
    },
    addEventListener(name, fn, opts = {}) {
      if (!listeners.has(name)) {
        listeners.set(name, []);
      }
      listeners.get(name).push({ fn, once: Boolean(opts?.once) });
    },
    removeEventListener(name, fn) {
      const list = listeners.get(name);
      if (!list) {
        return;
      }
      listeners.set(
        name,
        list.filter((entry) => entry.fn !== fn)
      );
    },
    dispatchEvent(name, eventObj = {}) {
      const list = [...(listeners.get(name) || [])];
      for (const entry of list) {
        if (entry.once) {
          this.removeEventListener(name, entry.fn);
        }
        entry.fn(eventObj);
      }
    },
    appendChild(child) {
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (el.parentElement) {
        el.parentElement.children = el.parentElement.children.filter((c) => c !== el);
        el.parentElement = null;
      }
    },
    querySelector(sel) {
      if (sel === "iframe") {
        return el.children.find((c) => c.tagName === "IFRAME") || null;
      }
      if (sel === "video") {
        return el.children.find((c) => c.tagName === "VIDEO") || null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    get firstElementChild() {
      return el.children[0] || null;
    },
    set innerHTML(val) {
      if (val === "") {
        el.children.forEach((c) => {
          c.parentElement = null;
        });
        el.children = [];
      }
    }
  };
  return el;
}

function runYoutubeProxyHarness({ search = "?v=dQw4w9WgXcQ&muted=0&autoplay=1", onUnmute } = {}) {
  return readFile(new URL("../docs/youtube-proxy.html", import.meta.url), "utf8").then((html) => {
    const match = html.match(/<script>([\s\S]*?)<\/script>/i);
    assert.ok(match, "youtube-proxy.html script must exist");

    const posted = [];
    const intervals = new Map();
    let nextTimerId = 1;
    let messageHandler = null;
    let playerConfig = null;

    const doc = {
      body: { innerHTML: "" },
      head: { appendChild: () => {} },
      getElementById: () => null,
      createElement: () => ({})
    };
    const parentWin = {
      postMessage: (msg) => posted.push(msg)
    };
    const win = {
      location: {
        origin: "https://proxy.example.test",
        href: `https://proxy.example.test/youtube-proxy.html${search}`,
        search
      },
      parent: parentWin,
      document: doc,
      addEventListener: (name, fn) => {
        if (name === "message") {
          messageHandler = fn;
        }
      },
      removeEventListener: () => {}
    };

    const ctx = vm.createContext({
      window: win,
      document: doc,
      location: win.location,
      encodeURIComponent,
      decodeURIComponent,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Date,
      JSON,
      Math,
      setTimeout,
      clearTimeout,
      setInterval: (fn, ms) => {
        const id = nextTimerId++;
        intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => {
        intervals.delete(id);
      }
    });

    vm.runInContext(match[1], ctx);

    const mockPlayer = {
      playerState: -1,
      currentTime: 0,
      duration: 120,
      muted: false,
      muteCalls: 0,
      unMuteCalls: 0,
      playCalls: 0,
      pauseCalls: 0,
      getPlayerState: () => mockPlayer.playerState,
      getCurrentTime: () => mockPlayer.currentTime,
      getDuration: () => mockPlayer.duration,
      isMuted: () => mockPlayer.muted,
      mute: () => {
        mockPlayer.muteCalls += 1;
        mockPlayer.muted = true;
      },
      unMute: () => {
        mockPlayer.unMuteCalls += 1;
        mockPlayer.muted = false;
        onUnmute?.(mockPlayer);
      },
      playVideo: () => {
        mockPlayer.playCalls += 1;
        if (mockPlayer.playerState !== 1) {
          mockPlayer.playerState = 1;
        }
      },
      pauseVideo: () => {
        mockPlayer.pauseCalls += 1;
        mockPlayer.playerState = 2;
      },
      seekTo: () => {},
      getOptions: () => [],
      loadModule: () => {},
      unloadModule: () => {}
    };

    ctx.YT = {
      Player: function MockPlayer(_id, config) {
        playerConfig = config;
        return mockPlayer;
      }
    };
    win.onYouTubeIframeAPIReady();

    return {
      playerConfig,
      mockPlayer,
      posted,
      tickIntervals: () => {
        for (const entry of intervals.values()) {
          entry.fn();
        }
      },
      sendCommand: (command, payload = {}) => {
        messageHandler({
          source: parentWin,
          data: {
            source: "nuvio-detail-trailer",
            type: "command",
            command,
            payload
          }
        });
      }
    };
  });
}

test("youtube-proxy stays muted until firstFrame (playerState===1 && currentTime>0) and then unmutes", async () => {
  const h = await runYoutubeProxyHarness({ search: "?v=dQw4w9WgXcQ&muted=0&autoplay=1" });
  assert.equal(h.playerConfig.playerVars.mute, 1, "playerVars must always initialize mute: 1");

  h.playerConfig.events.onReady({ target: h.mockPlayer });
  assert.equal(h.mockPlayer.muteCalls, 1, "onReady must mute unconditionally");
  assert.equal(h.mockPlayer.unMuteCalls, 0, "onReady must never unMute before firstFrame");
  assert.equal(h.mockPlayer.muted, true);

  const readyStateMsg = h.posted.filter((m) => m.type === "state").at(-1);
  assert.equal(
    readyStateMsg?.state?.muted,
    false,
    "pre-reveal state must report desiredMuted (false) so parent overlay stays truthful"
  );

  h.sendCommand("setMuted", { muted: false });
  assert.equal(h.mockPlayer.unMuteCalls, 0, "setMuted(false) before firstFrame must be deferred");
  assert.equal(h.mockPlayer.muted, true);

  // Buffering / pre-roll at currentTime === 0 must stay muted and not emit firstFrame.
  h.mockPlayer.playerState = 1;
  h.mockPlayer.currentTime = 0;
  h.playerConfig.events.onStateChange({ target: h.mockPlayer, data: 1 });
  assert.equal(
    h.posted.some((m) => m.type === "firstFrame"),
    false,
    "must not emit firstFrame at currentTime === 0"
  );
  assert.equal(h.mockPlayer.unMuteCalls, 0, "must stay muted at currentTime === 0");

  // Real playback frame arrives (currentTime > 0).
  h.mockPlayer.currentTime = 0.25;
  h.tickIntervals();
  const firstFrameMsg = h.posted.find((m) => m.type === "firstFrame");
  assert.ok(firstFrameMsg, "must emit firstFrame when playerState===1 and currentTime>0");
  assert.equal(h.mockPlayer.unMuteCalls, 1, "must unMute on firstFrame when desiredMuted is false");
  assert.equal(h.mockPlayer.muted, false);
});

test("youtube-proxy holds audio for layers that reveal after the chrome settles", async () => {
  const h = await runYoutubeProxyHarness({
    search: "?v=dQw4w9WgXcQ&muted=0&autoplay=1&hold_muted=1"
  });
  h.playerConfig.events.onReady({ target: h.mockPlayer });
  h.mockPlayer.playerState = 1;
  h.mockPlayer.currentTime = 0.25;
  h.tickIntervals();

  assert.ok(
    h.posted.some((m) => m.type === "firstFrame"),
    "firstFrame must still be reported"
  );
  assert.equal(
    h.mockPlayer.unMuteCalls,
    0,
    "hold_muted must keep playback silent after the first frame"
  );
  const heldState = h.posted.filter((m) => m.type === "state").at(-1);
  assert.equal(heldState?.state?.muted, true, "state must report the held mute");

  h.sendCommand("setMuted", { muted: false });
  assert.equal(h.mockPlayer.unMuteCalls, 1, "reveal must unmute through setMuted");
  assert.equal(h.mockPlayer.muted, false);
  const revealedState = h.posted.filter((m) => m.type === "state").at(-1);
  assert.equal(revealedState?.state?.muted, false, "state must report the revealed unmute");
});

test("youtube-proxy re-mutes and resumes playback if unmuting on firstFrame triggers autoplay policy pause", async () => {
  const h = await runYoutubeProxyHarness({
    search: "?v=dQw4w9WgXcQ&muted=0&autoplay=1",
    onUnmute: (player) => {
      // Simulate browser autoplay policy pausing unmuted playback without user gesture.
      player.playerState = 2;
    }
  });
  h.playerConfig.events.onReady({ target: h.mockPlayer });
  h.mockPlayer.playerState = 1;
  h.mockPlayer.currentTime = 0.2;
  h.tickIntervals();

  assert.equal(h.mockPlayer.muted, true, "must re-mute when browser pauses unmuted playback");
  assert.equal(h.mockPlayer.playerState, 1, "must resume playback after re-muting");
  const latestState = h.posted.filter((m) => m.type === "state").at(-1);
  assert.equal(
    latestState?.state?.muted,
    true,
    "state must truthfully report muted: true after fallback"
  );
});

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("home mountTrailerLayer holds YouTube audio until the chrome-settled reveal, waits for frame readiness for video, unmutes with autoplay fallback, and tracks handoff", async () => {
  const source13 = stripModule(
    await readFile(
      new URL("../js/ui/screens/home/homeScreenMethods-13-mount-trailer-layer.js", import.meta.url),
      "utf8"
    )
  );
  let messageListener = null;
  const scheduledTimeouts = [];
  const context = vm.createContext({
    console,
    Date,
    Number,
    String,
    Boolean,
    Set,
    Map,
    WeakMap,
    HTMLElement: function HTMLElement() {},
    setTimeout: (fn, ms) => {
      const timer = { fn, ms };
      scheduledTimeouts.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      const index = scheduledTimeouts.indexOf(timer);
      if (index >= 0) {
        scheduledTimeouts.splice(index, 1);
      }
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    internals: {
      metaRepository: {},
      isCollectionFolderItem: () => false,
      resolveTrailerSource: () => null,
      withTimeout: (p) => p,
      resolveTrailerMetaWithTmdbFallback: async () => null,
      LayoutPreferences: {
        get: () => ({ focusedPosterTrailerContinueInDetails: true })
      }
    },
    window: {
      addEventListener: (name, fn) => {
        if (name === "message") {
          messageListener = fn;
        }
      },
      removeEventListener: () => {}
    },
    document: {
      activeElement: null,
      createElement: (tag) => createMockElement(tag)
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source13}\nglobalThis.api = createHomeScreenMethods13();`, context);

  // Part A: unmuted YouTube layers stay muted, and hidden, until the chrome settles.
  const ytContainer = createMockElement("div");
  const screen = Object.assign(Object.create(context.api), {
    clearTrailerLayer() {},
    cancelTrailerLayerCleanup() {},
    getFocusedPosterFlowKey: () => "movie:tt1",
    homeTrailerLayerHideTimers: new WeakMap(),
    mountedHomeTrailerLayers: new Set()
  });

  let ytReady = false;
  const posted = [];
  screen.mountTrailerLayer(
    ytContainer,
    {
      kind: "youtube",
      ytId: "abc123",
      embedUrl: "https://proxy.example.test/?v=abc123",
      muted: false
    },
    () => {
      ytReady = true;
    }
  );
  const frame = ytContainer.querySelector("iframe");
  assert.ok(frame);
  frame.contentWindow = { postMessage: (message) => posted.push(message) };
  scheduledTimeouts.length = 0;

  messageListener({
    source: frame.contentWindow,
    data: { source: "nuvio-youtube-proxy", type: "firstFrame", videoId: "abc123", currentTime: 0.2 }
  });
  assert.equal(scheduledTimeouts.length, 1, "firstFrame must schedule the chrome-settled reveal");
  assert.equal(scheduledTimeouts[0].ms, 4500, "reveal must wait for YouTube's startup chrome");
  assert.equal(
    ytContainer.classList.contains("is-active"),
    false,
    "layer must stay hidden while muted"
  );
  assert.equal(ytReady, false);
  assert.equal(posted.length, 0, "audio must stay muted until the visual reveal");

  scheduledTimeouts.shift().fn();
  assert.equal(ytReady, true);
  assert.equal(ytContainer.classList.contains("is-active"), true);
  assert.equal(
    JSON.stringify(posted),
    JSON.stringify([
      {
        source: "nuvio-detail-trailer",
        type: "command",
        command: "setMuted",
        payload: { muted: false }
      }
    ]),
    "unmute must happen with the visual reveal"
  );

  // Part B: <video> starts muted, ignores loadedmetadata/canplay/loadeddata, activates on frame, unmutes, and tracks handoff.
  const card = createMockElement("div");
  card.classList.add("home-poster-card");
  const videoContainer = createMockElement("div");
  videoContainer.closest = (sel) => (sel === ".home-poster-card" ? card : null);

  let videoReady = false;
  screen.mountTrailerLayer(
    videoContainer,
    { kind: "video", url: "https://cdn.example/trailer.mp4", muted: false },
    () => {
      videoReady = true;
    }
  );
  const video = videoContainer.querySelector("video");
  assert.ok(video);
  let rVfcCallback = null;
  video.requestVideoFrameCallback = (cb) => {
    rVfcCallback = cb;
  };
  let playCalls = 0;
  video.play = () => {
    playCalls += 1;
    return Promise.resolve();
  };

  // Remount with rVFC present on created video element by intercepting createElement.
  const origCreate = context.document.createElement;
  let capturedVideo = null;
  let rvfcCb = null;
  context.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === "video") {
      capturedVideo = el;
      el.requestVideoFrameCallback = (cb) => {
        rvfcCb = cb;
      };
      el.play = () => {
        playCalls += 1;
        return Promise.resolve();
      };
    }
    return el;
  };

  videoReady = false;
  playCalls = 0;
  const videoContainer2 = createMockElement("div");
  videoContainer2.closest = (sel) => (sel === ".home-poster-card" ? card : null);
  screen.mountTrailerLayer(
    videoContainer2,
    { kind: "video", url: "https://cdn.example/trailer.mp4", muted: false },
    () => {
      videoReady = true;
    }
  );
  assert.ok(capturedVideo);
  assert.equal(capturedVideo.defaultMuted, true, "home <video> must initialize defaultMuted=true");
  assert.equal(capturedVideo.muted, true, "home <video> must initialize muted=true");
  assert.equal(capturedVideo.hasAttribute("muted"), true, "home <video> must have muted attribute");

  // Premature readiness events and resolved play() promise must NOT activate or unmute.
  capturedVideo.readyState = 4;
  capturedVideo.paused = false;
  capturedVideo.dispatchEvent("loadedmetadata");
  capturedVideo.dispatchEvent("loadeddata");
  capturedVideo.dispatchEvent("canplay");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    videoContainer2.classList.contains("is-active"),
    false,
    "must not reveal on premature events"
  );
  assert.equal(capturedVideo.muted, true, "must stay muted before first frame");
  assert.equal(videoReady, false);

  // Actual first frame via requestVideoFrameCallback activates and unmutes in same turn.
  assert.equal(typeof rvfcCb, "function", "must register requestVideoFrameCallback when available");
  rvfcCb();
  assert.equal(
    videoContainer2.classList.contains("is-active"),
    true,
    "must reveal on first video frame"
  );
  assert.equal(videoReady, true);
  assert.equal(capturedVideo.muted, false, "must unmute on reveal when source.muted === false");

  // timeupdate populates homeTrailerHandoff for kind:"video".
  capturedVideo.currentTime = 4.5;
  capturedVideo.paused = false;
  capturedVideo.dispatchEvent("timeupdate");
  const handoff = screen.getTrailerHandoffForNode(card, { itemId: "tt1", itemType: "movie" });
  assert.ok(handoff, "getTrailerHandoffForNode must work for kind:video");
  assert.equal(handoff.currentTime, 4.5);
  assert.equal(handoff.muted, false);

  // Part C: autoplay policy pause fallback on <video> unmute.
  let policyVideo = null;
  let policyRvfc = null;
  let policyPlayCalls = 0;
  context.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === "video") {
      policyVideo = el;
      el.requestVideoFrameCallback = (cb) => {
        policyRvfc = cb;
      };
      el.play = () => {
        policyPlayCalls += 1;
        el.paused = false;
        return Promise.resolve();
      };
      el.onMutedChange = (isMuted) => {
        if (!isMuted && policyRvfc === "fired") {
          el.paused = true;
        }
      };
    }
    return el;
  };
  const policyContainer = createMockElement("div");
  screen.mountTrailerLayer(policyContainer, {
    kind: "video",
    url: "https://cdn.example/policy.mp4",
    muted: false
  });
  policyVideo.readyState = 4;
  policyVideo.paused = false;
  const triggerPolicyRvfc = policyRvfc;
  policyRvfc = "fired";
  triggerPolicyRvfc();
  assert.equal(policyVideo.muted, true, "must revert to muted if unmuting triggers browser pause");
  assert.ok(policyPlayCalls >= 2, "must retry video.play() after reverting to muted");
});

test("detail syncTrailerDom + bindTrailerVideoEvents starts <video> muted and unmutes on markReady without clobbering trailerMuted", async () => {
  const source18 = stripModule(
    await readFile(
      new URL(
        "../js/ui/screens/detail/metaDetailsScreenMethods-18-stop-trailer-progress-timer.js",
        import.meta.url
      ),
      "utf8"
    )
  );
  const source19 = stripModule(
    await readFile(
      new URL(
        "../js/ui/screens/detail/metaDetailsScreenMethods-19-toggle-active-trailer-playback.js",
        import.meta.url
      ),
      "utf8"
    )
  );

  const context = vm.createContext({
    console,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    shouldContinueTrailerInBackgroundOnBack: () => false,
    focusWithoutScroll: () => {},
    internals: {
      t: (_k, _p, fallback) => fallback,
      formatPlaybackTime: (s) => String(Math.floor(Number(s || 0))),
      Router: { getCurrent: () => "detail" },
      escapeHtml: (s) => String(s || ""),
      buildInlineYoutubePlayerUrl: () => "",
      LayoutPreferences: { get: () => ({}) },
      PlayerSettingsStore: { get: () => ({}) }
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source18}\n${source19}\nglobalThis.api = Object.assign(createMetaDetailsScreenMethods18(), createMetaDetailsScreenMethods19());`,
    context
  );

  let renderedMarkup = "";
  const shell = createMockElement("div");
  shell.classList.add("series-detail-shell");
  const overlay = createMockElement("div");
  overlay.focus = () => {};
  const progressFill = createMockElement("div");
  const timeLabel = createMockElement("div");
  const statusEl = createMockElement("div");
  let mockVideo = null;

  const layer = {
    set innerHTML(html) {
      renderedMarkup = String(html);
      mockVideo = createMockElement("video");
      mockVideo.muted = /\bmuted\b/.test(renderedMarkup);
      mockVideo.defaultMuted = mockVideo.muted;
      mockVideo.play = () => Promise.resolve();
    },
    querySelector(sel) {
      if (sel === ".detail-trailer-controls-overlay") return overlay;
      if (sel === ".detail-trailer-video") return mockVideo;
      if (sel === "[data-trailer-progress-fill]") return progressFill;
      if (sel === "[data-trailer-time-label]") return timeLabel;
      if (sel === "[data-trailer-status]") return statusEl;
      return null;
    }
  };

  const screen = Object.assign(Object.create(context.api), {
    isTrailerPlaying: true,
    trailerPlaybackMode: "manual",
    trailerMuted: false,
    trailerVisualReady: false,
    trailerSource: { kind: "video", url: "https://cdn.example/detail-trailer.mp4" },
    container: {
      querySelector(sel) {
        if (sel === ".series-detail-shell") return shell;
        if (sel === ".detail-trailer-layer") return layer;
        return null;
      }
    },
    detachTrailerMediaListeners() {
      (this.trailerMediaListeners || []).forEach(({ target, eventName, handler }) => {
        target?.removeEventListener?.(eventName, handler);
      });
      this.trailerMediaListeners = [];
    }
  });

  screen.syncTrailerDom();
  assert.match(
    renderedMarkup,
    /<video[^>]*\bmuted\b/,
    "detail <video> markup must always start muted"
  );
  assert.equal(mockVideo.muted, true, "detail <video> must start muted before visual reveal");

  // Pre-reveal events (loadedmetadata, canplay) must NOT overwrite trailerMuted = false -> true.
  mockVideo.readyState = 1;
  mockVideo.paused = false;
  mockVideo.dispatchEvent("loadedmetadata");
  mockVideo.dispatchEvent("canplay");
  assert.equal(
    screen.trailerMuted,
    false,
    "updateTrailerOverlay before trailerVisualReady must preserve trailerMuted=false"
  );
  assert.equal(screen.getTrailerPlaybackSnapshot().muted, false);
  assert.equal(mockVideo.muted, true, "video element must stay muted until markReady");

  // Playing triggers markReady -> trailerVisualReady=true and video unmutes.
  mockVideo.readyState = 4;
  mockVideo.paused = false;
  mockVideo.dispatchEvent("playing");
  assert.equal(screen.trailerVisualReady, true);
  assert.equal(mockVideo.muted, false, "detail <video> must unmute when markReady fires");
  assert.equal(screen.trailerMuted, false);

  // Autoplay policy pause fallback on detail <video> unmute.
  let detailPolicyPlayCalls = 0;
  screen.trailerVisualReady = false;
  screen.trailerMuted = false;
  screen.syncTrailerDom();
  mockVideo.play = () => {
    detailPolicyPlayCalls += 1;
    mockVideo.paused = false;
    return Promise.resolve();
  };
  mockVideo.onMutedChange = (isMuted) => {
    if (!isMuted) {
      mockVideo.paused = true;
    }
  };
  mockVideo.readyState = 4;
  mockVideo.paused = false;
  mockVideo.dispatchEvent("playing");
  assert.equal(
    mockVideo.muted,
    true,
    "detail <video> must revert to muted on autoplay policy pause"
  );
  assert.equal(screen.trailerMuted, true);
  assert.ok(
    detailPolicyPlayCalls >= 1,
    "detail <video> must retry play() after reverting to muted"
  );
});
