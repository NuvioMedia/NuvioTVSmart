import assert from "node:assert/strict";
import test from "node:test";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

const { isEditingHdrSubtitleStyle, resolveHdrSubtitleStyle } =
  await import("../../../core/player/hdrSubtitleStyle.js");
const { SUBTITLE_TEXT_COLORS } = await import("./playerScreenHelpers-02-language-code-aliases.js");
const { PlayerController } = await import("../../../core/player/playerController.js");
const { Environment } = await import("../../../platform/environment.js");
const { TizenCapabilities } = await import("../../../platform/tizen/tizenCapabilities.js");
const { createPlayerScreenMethods24 } =
  await import("./playerScreenMethods-24-open-next-episode-stream-picker.js");
const { createPlayerScreenMethods52 } =
  await import("./playerScreenMethods-52-apply-startup-audio-fallback.js");
const { createPlayerScreenMethods53 } =
  await import("./playerScreenMethods-53-render-subtitle-style-control-in-place.js");
const { createPlayerScreenMethods75 } =
  await import("./playerScreenMethods-75-hdr-presentation.js");

function withPatchedEnvironment({
  isTizen = false,
  isWebOS = false,
  usingAvPlay = false,
  avplayOutputMode = "none",
  usingNativePlayback = false,
  advancedStylingLimited = false
} = {}) {
  const originals = {
    isTizen: Environment.isTizen,
    isWebOS: Environment.isWebOS,
    isUsingAvPlay: PlayerController.isUsingAvPlay,
    getAvPlaySubtitleOutputMode: PlayerController.getAvPlaySubtitleOutputMode,
    isUsingNativePlayback: PlayerController.isUsingNativePlayback,
    isAdvancedSubtitleStylingLimited: TizenCapabilities.isAdvancedSubtitleStylingLimited
  };
  Environment.isTizen = () => isTizen;
  Environment.isWebOS = () => isWebOS;
  PlayerController.isUsingAvPlay = () => usingAvPlay;
  PlayerController.getAvPlaySubtitleOutputMode = () => avplayOutputMode;
  PlayerController.isUsingNativePlayback = () => usingNativePlayback;
  TizenCapabilities.isAdvancedSubtitleStylingLimited = () => advancedStylingLimited;
  return () => {
    Environment.isTizen = originals.isTizen;
    Environment.isWebOS = originals.isWebOS;
    PlayerController.isUsingAvPlay = originals.isUsingAvPlay;
    PlayerController.getAvPlaySubtitleOutputMode = originals.getAvPlaySubtitleOutputMode;
    PlayerController.isUsingNativePlayback = originals.isUsingNativePlayback;
    TizenCapabilities.isAdvancedSubtitleStylingLimited = originals.isAdvancedSubtitleStylingLimited;
  };
}

function createFakeDialog(controls) {
  const rows = new Map();
  for (const item of controls) {
    const mainNode = { textContent: item.label };
    const subNode = { textContent: item.value };
    const rowNode = {
      querySelector(selector) {
        if (selector === ".player-dialog-item-main") return mainNode;
        if (selector === ".player-dialog-item-sub") return subNode;
        return null;
      }
    };
    const buttonNode = {
      closest(selector) {
        return selector === ".player-dialog-style-item" ? rowNode : null;
      }
    };
    rows.set(item.id, { rowNode, mainNode, subNode, buttonNode });
  }
  return {
    rows,
    querySelector(selector) {
      const match = selector.match(/^button\[data-style-id="([^"]+)"\]$/);
      return match ? rows.get(match[1])?.buttonNode || null : null;
    }
  };
}

function createStyleHarness({
  styleOverrides = {},
  isHdr = false,
  assActive = false,
  bitmapTrack = null,
  htmlSelectedId = "addon-1",
  htmlCues = [{ start: 0, end: 2, text: "Hello" }]
} = {}) {
  const cssVars = new Map();
  const rootClasses = new Set();
  const subtitleClasses = new Set();
  let persistCalls = 0;
  let cueStyleRefreshes = 0;
  let trackRenderRefreshes = 0;
  let bitmapRenders = 0;
  let dialogRenders = 0;
  const video = PlayerController.video;
  PlayerController.video = {
    style: {
      setProperty(k, v) {
        cssVars.set(`video:${k}`, v);
      },
      removeProperty(k) {
        cssVars.delete(`video:${k}`);
      }
    }
  };
  const screen = Object.assign(
    createPlayerScreenMethods24(),
    createPlayerScreenMethods52(),
    createPlayerScreenMethods53(),
    createPlayerScreenMethods75(),
    {
      subtitleDelayMs: 0,
      subtitleDialogVisible: true,
      selectedEmbeddedSubtitleTrackIndex: -1,
      selectedAddonSubtitleId: assActive ? "addon-ass" : htmlSelectedId,
      htmlSubtitleSelectedId: htmlSelectedId,
      htmlSubtitleCues: htmlCues,
      webOsEmbeddedTextSubtitleTrack: null,
      webOsEmbeddedTextSubtitleUsingAss: false,
      assSubtitleRenderer: assActive ? { active: true } : null,
      bitmapSubtitleTrack: bitmapTrack,
      subtitleStyleSettings: {
        fontSize: 100,
        textColor: "#FFFFFF",
        textOpacity: 100,
        bold: false,
        stripSdh: false,
        outlineEnabled: true,
        outlineColor: "#000000",
        backgroundColor: "#00000000",
        verticalOffset: 5,
        hdrStyleEnabled: false,
        hdrTextColor: "#FFFFFF",
        hdrBrightness: 40,
        hdrDimPlayerControls: false,
        ...styleOverrides
      },
      uiRefs: {
        root: {
          style: {
            setProperty(k, v) {
              cssVars.set(`root:${k}`, v);
            },
            removeProperty(k) {
              cssVars.delete(`root:${k}`);
            },
            getPropertyValue(k) {
              return cssVars.get(`root:${k}`) || "";
            }
          },
          classList: {
            toggle(name, force) {
              if (force) rootClasses.add(name);
              else rootClasses.delete(name);
            }
          }
        },
        htmlSubtitles: {
          classList: {
            toggle(name, force) {
              if (force) subtitleClasses.add(name);
              else subtitleClasses.delete(name);
            }
          }
        },
        subtitleDialog: null
      },
      isCurrentPlaybackHdr: () => isHdr,
      isAssAddonSubtitleActive: () => assActive,
      schedulePersistPlayerPresentationSettings() {
        persistCalls += 1;
      },
      refreshSubtitleCueStyles() {
        cueStyleRefreshes += 1;
      },
      refreshSubtitleTrackRendering() {
        trackRenderRefreshes += 1;
      },
      renderBitmapSubtitleAtCurrentTime() {
        bitmapRenders += 1;
      },
      renderHtmlSubtitleOverlayAtCurrentTime() {},
      renderSubtitleDialog() {
        dialogRenders += 1;
      }
    }
  );
  screen.uiRefs.subtitleDialog = createFakeDialog(screen.getSubtitleStyleControls());
  const restoreVideo = () => {
    PlayerController.video = video;
  };
  return {
    screen,
    cssVars,
    rootClasses,
    restoreVideo,
    counts: () => ({
      persistCalls,
      cueStyleRefreshes,
      trackRenderRefreshes,
      bitmapRenders,
      dialogRenders
    })
  };
}

test("isEditingHdrSubtitleStyle is active only when video is HDR and HDR override is enabled", () => {
  assert.equal(isEditingHdrSubtitleStyle({ hdrStyleEnabled: true }, false), false);
  assert.equal(isEditingHdrSubtitleStyle({ hdrStyleEnabled: false }, true), false);
  assert.equal(isEditingHdrSubtitleStyle(undefined, true), false);
  assert.equal(isEditingHdrSubtitleStyle({ hdrStyleEnabled: true }, true), true);
  assert.equal(
    resolveHdrSubtitleStyle(
      { textColor: "#FFFFFF", hdrStyleEnabled: true, hdrTextColor: "#FFD700", hdrBrightness: 40 },
      true
    ).textColor,
    "#947D00"
  );
});

test("in-player subtitle dialog displays and edits hdrTextColor during HDR without altering SDR textColor", () => {
  const restoreEnv = withPatchedEnvironment();
  const { screen, cssVars, restoreVideo, counts } = createStyleHarness({
    isHdr: true,
    styleOverrides: {
      hdrStyleEnabled: true,
      textColor: "#FFFFFF",
      hdrTextColor: "#d9d9d9",
      hdrBrightness: 40
    }
  });
  try {
    const initialControls = screen.getSubtitleStyleControls();
    const textColorControl = initialControls.find((item) => item.id === "textColor");
    assert.equal(textColorControl.label, "HDR Text Color");
    assert.equal(textColorControl.value, "D9D9D9");
    assert.equal(textColorControl.disabled, false);
    assert.ok(initialControls.some((item) => item.id === "hdrBrightness"));

    const adjusted = screen.adjustSubtitleStyleControl("textColor", 1);
    assert.equal(adjusted, true);
    assert.equal(screen.subtitleStyleSettings.hdrTextColor, "#FFD700");
    assert.equal(screen.subtitleStyleSettings.textColor, "#FFFFFF");
    assert.equal(cssVars.get("root:--player-subtitle-color"), "#947D00");
    assert.equal(cssVars.get("root:--player-subtitle-text-color"), "#947D00");
    assert.equal(screen.uiRefs.subtitleDialog.rows.get("textColor").subNode.textContent, "FFD700");
    assert.equal(
      screen.uiRefs.subtitleDialog.rows.get("textColor").mainNode.textContent,
      "HDR Text Color"
    );
    assert.equal(counts().persistCalls, 1);
    assert.equal(counts().cueStyleRefreshes, 1);
    assert.equal(counts().trackRenderRefreshes, 1);
  } finally {
    restoreVideo();
    restoreEnv();
  }
});

test("in-player subtitle dialog still edits base textColor on SDR playback or when HDR override is off", () => {
  const restoreEnv = withPatchedEnvironment();
  for (const scenario of [
    { isHdr: false, hdrStyleEnabled: true },
    { isHdr: true, hdrStyleEnabled: false }
  ]) {
    const { screen, restoreVideo } = createStyleHarness({
      isHdr: scenario.isHdr,
      styleOverrides: {
        hdrStyleEnabled: scenario.hdrStyleEnabled,
        textColor: "#FFFFFF",
        hdrTextColor: "#00E5FF"
      }
    });
    try {
      const controls = screen.getSubtitleStyleControls();
      const textColorControl = controls.find((item) => item.id === "textColor");
      assert.equal(textColorControl.label, "Text Color");
      assert.equal(textColorControl.value, "FFFFFF");
      assert.equal(
        controls.some((item) => item.id === "hdrBrightness"),
        false
      );

      assert.equal(screen.adjustSubtitleStyleControl("textColor", 1), true);
      assert.equal(screen.subtitleStyleSettings.textColor, "#D9D9D9");
      assert.equal(screen.subtitleStyleSettings.hdrTextColor, "#00E5FF");
    } finally {
      restoreVideo();
    }
  }
  restoreEnv();
});

test("non-palette synced hdrTextColor moves cleanly onto Smart TV preset colors", () => {
  const restoreEnv = withPatchedEnvironment();
  const { screen, restoreVideo } = createStyleHarness({
    isHdr: true,
    styleOverrides: {
      hdrStyleEnabled: true,
      textColor: "#00FF88",
      hdrTextColor: "#ffa500"
    }
  });
  try {
    const control = screen.getSubtitleStyleControls().find((item) => item.id === "textColor");
    assert.equal(control.value, "FFA500");
    assert.equal(screen.adjustSubtitleStyleControl("textColor", 1), true);
    assert.equal(screen.subtitleStyleSettings.hdrTextColor, SUBTITLE_TEXT_COLORS[1]);
    assert.equal(screen.subtitleStyleSettings.textColor, "#00FF88");
  } finally {
    restoreVideo();
    restoreEnv();
  }
});

test("HDR text color control respects Tizen native, Tizen HTML callback, webOS, and ASS capabilities", () => {
  const cases = [
    {
      name: "Tizen AVPlay HTML callback",
      env: { isTizen: true, usingAvPlay: true, avplayOutputMode: "html-callback" },
      htmlSelectedId: null,
      htmlCues: [],
      expectedDisabled: false
    },
    {
      name: "Tizen AVPlay embedded-native (modern Tizen)",
      env: {
        isTizen: true,
        usingAvPlay: true,
        avplayOutputMode: "embedded-native",
        advancedStylingLimited: false
      },
      htmlSelectedId: null,
      htmlCues: [],
      expectedDisabled: true
    },
    {
      name: "Tizen AVPlay external-native (legacy Tizen 4.0 / no ResizeObserver)",
      env: {
        isTizen: true,
        usingAvPlay: true,
        avplayOutputMode: "external-native",
        advancedStylingLimited: true
      },
      htmlSelectedId: null,
      htmlCues: [],
      expectedDisabled: true
    },
    {
      name: "LG webOS native VTT cues",
      env: { isWebOS: true, usingNativePlayback: true, avplayOutputMode: "none" },
      htmlSelectedId: null,
      htmlCues: [],
      expectedDisabled: false
    },
    {
      name: "ASS/SSA subtitles preserving authored styles",
      env: { isWebOS: true },
      assActive: true,
      expectedDisabled: true
    }
  ];

  for (const scenario of cases) {
    const restoreEnv = withPatchedEnvironment(scenario.env);
    const { screen, restoreVideo } = createStyleHarness({
      isHdr: true,
      assActive: scenario.assActive,
      htmlSelectedId: scenario.htmlSelectedId,
      htmlCues: scenario.htmlCues,
      styleOverrides: {
        hdrStyleEnabled: true,
        textColor: "#FFFFFF",
        hdrTextColor: "#FFD700"
      }
    });
    try {
      const control = screen.getSubtitleStyleControls().find((item) => item.id === "textColor");
      assert.equal(control.label, "HDR Text Color", scenario.name);
      assert.equal(control.disabled, scenario.expectedDisabled, scenario.name);
      const changed = screen.adjustSubtitleStyleControl("textColor", 1);
      assert.equal(changed, !scenario.expectedDisabled, scenario.name);
      assert.equal(
        screen.subtitleStyleSettings.hdrTextColor,
        scenario.expectedDisabled ? "#FFD700" : "#00E5FF",
        scenario.name
      );
    } finally {
      restoreVideo();
      restoreEnv();
    }
  }
});

test("syncHdrPresentation re-renders an open subtitle dialog when HDR state transitions", () => {
  let hdrActive = false;
  let applyCount = 0;
  let dialogRenderCount = 0;
  const video = PlayerController.video;
  const props = new Map();
  PlayerController.video = { videoWidth: 3840, videoHeight: 2160 };
  const screen = Object.assign(createPlayerScreenMethods75(), {
    activePlaybackUrl: "https://example.com/movie.mkv",
    currentStreamIndex: 0,
    subtitleDialogVisible: true,
    subtitleStyleSettings: {
      hdrStyleEnabled: true,
      hdrTextColor: "#FFD700",
      hdrBrightness: 40,
      hdrDimPlayerControls: true
    },
    uiRefs: {
      root: {
        style: {
          getPropertyValue: (k) => props.get(k) || "",
          setProperty: (k, v) => props.set(k, v)
        },
        classList: { toggle() {} }
      }
    },
    isCurrentPlaybackHdr() {
      this.currentPlaybackIsHdr = hdrActive;
      return hdrActive;
    },
    applySubtitlePresentationSettings() {
      applyCount += 1;
    },
    renderSubtitleDialog() {
      dialogRenderCount += 1;
    }
  });
  try {
    screen.syncHdrPresentation();
    assert.equal(applyCount, 1);
    assert.equal(dialogRenderCount, 0);

    hdrActive = true;
    screen.syncHdrPresentation();
    assert.equal(applyCount, 2);
    assert.equal(dialogRenderCount, 1);

    screen.subtitleDialogVisible = false;
    hdrActive = false;
    screen.syncHdrPresentation();
    assert.equal(applyCount, 3);
    assert.equal(dialogRenderCount, 1);
  } finally {
    PlayerController.video = video;
  }
});
