import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSubtitleStyleControlAvailability } from "./subtitlePresentationCapabilities.js";
import {
  HDR_BRIGHTNESS_STEP,
  hdrBrightnessFactor,
  isEditingHdrSubtitleStyle,
  normalizeHdrBrightness,
  normalizeHdrTextColor,
  resolveHdrSubtitleStyle
} from "./hdrSubtitleStyle.js";
import * as SubtitleAppearance from "./subtitleAppearance.js";

function loadPlayerMethods(fileName, exportName, internals, extraBindings = {}) {
  const source = readFileSync(
    new URL(`../../ui/screens/player/${fileName}`, import.meta.url),
    "utf8"
  );
  const stripped = source
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/export function /g, "function ");
  const extraKeys = Object.keys(extraBindings);
  const extraValues = Object.values(extraBindings);
  return new Function(
    "internals",
    ...extraKeys,
    `"use strict";\n${stripped}\nreturn ${exportName}();`
  )(internals, ...extraValues);
}

function createStyleRecorder() {
  const map = new Map();
  return {
    setProperty(name, value) {
      map.set(name, String(value));
    },
    removeProperty(name) {
      map.delete(name);
    },
    getPropertyValue(name) {
      return map.get(name) ?? "";
    },
    snapshot() {
      return Object.fromEntries(map);
    }
  };
}

function createScreenHarness({
  isTizen = false,
  isWebOS = false,
  usingAvPlay = false,
  usingNativePlayback = false,
  avplayOutputMode = "none",
  avplayCallbackHtml = false,
  supportsExternalDelay = false,
  advancedStylingLimited = false,
  assActive = false,
  supportsAssPlacement = false,
  htmlSubtitleCues = [],
  htmlSubtitleSelectedId = null,
  webOsEmbeddedTextSubtitleUsingAss = false,
  selectedEmbeddedSubtitleTrackIndex = -1,
  webOsEmbeddedTextSubtitleTrack = null,
  bitmapSubtitleTrack = null,
  isHdr = true,
  subtitleStyleSettings = {}
} = {}) {
  const uiRootStyle = createStyleRecorder();
  const videoStyle = createStyleRecorder();
  let applyCalls = 0;
  let persistCalls = 0;

  const PlayerController = {
    video: { style: videoStyle },
    isUsingAvPlay: () => usingAvPlay,
    isUsingNativePlayback: () => usingNativePlayback,
    getAvPlaySubtitleOutputMode: () => avplayOutputMode,
    shouldRenderAvPlaySubtitleCallbacksInHtml: () => avplayCallbackHtml,
    supportsAvPlayExternalSubtitleDelay: () => supportsExternalDelay,
    setWebOsSubtitleFontSize() {},
    setAvPlayExternalSubtitleDelay() {}
  };

  const baseStyle = {
    fontId: "default",
    fontSize: 120,
    bold: false,
    stripSdh: true,
    textColor: "#FFFFFF",
    textOpacity: 100,
    backgroundColor: "#00000080",
    backgroundRadius: 0,
    outlineEnabled: true,
    outlineColor: "#000000",
    shadowEnabled: false,
    shadowOpacity: 75,
    shadowSize: 2,
    verticalOffset: 5,
    hdrStyleEnabled: true,
    hdrTextColor: "#FFD700",
    hdrBrightness: 40,
    hdrDimPlayerControls: false,
    ...subtitleStyleSettings
  };

  const internals = {
    SubtitleAppearance,
    PlayerController,
    PlayerSettingsStore: {
      getDefaults: () => ({ subtitleStyle: { ...baseStyle } })
    },
    Environment: {
      isTizen: () => isTizen,
      isWebOS: () => isWebOS
    },
    TizenCapabilities: {
      isAdvancedSubtitleStylingLimited: () => advancedStylingLimited
    },
    resolveSubtitleStyleControlAvailability,
    resolveHdrSubtitleStyle,
    Router: {},
    selectStartupAudioFallbackOption: () => null,
    formatSubtitleVerticalOffset: (v) => `${v ?? 5}%`,
    normalizeSubtitleTextOpacity: (v) => Math.max(0, Math.min(100, Number(v ?? 100))),
    subtitleTextColorWithOpacity: (color, opacity) => `${color}@${opacity}`,
    getSubtitleVerticalOffsetVh: (v) => -Number(v ?? 5) * 0.25,
    getSubtitleVerticalResidualOffsetVh: (v) => -Number(v ?? 5) * 0.25,
    normalizeSubtitleFontSize: (v) => Number(v ?? 120),
    formatHtmlSubtitleFontSize: (v) => `${v}%`,
    dbToGain: () => 1,
    supportsTvWebAudioAmplification: () => false,
    streamDirectPlaybackUrl: () => "",
    ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS: 0,
    SUBTITLE_LANGUAGE_OFF_KEY: "off",
    SUBTITLE_DELAY_MAX_MS: 10000,
    SUBTITLE_DELAY_MIN_MS: -10000,
    SUBTITLE_DELAY_STEP_MS: 250,
    SUBTITLE_VERTICAL_OFFSET_DEFAULT: 5,
    normalizeSubtitleVerticalOffset: (v) => Number(v ?? 5),
    SUBTITLE_TEXT_OPACITY_STEP: 10,
    SUBTITLE_TEXT_COLORS: ["#FFFFFF", "#FFFF00", "#FFD700", "#00FFFF", "#B0B0B0"],
    SUBTITLE_OUTLINE_COLORS: ["#000000", "#202020"],
    SUBTITLE_FONT_STEP: 10,
    SUBTITLE_VERTICAL_OFFSET_STEP: 1,
    isAssSubtitleCodec: (codec) => /ass|ssa/i.test(String(codec || "")),
    t: (_key, _params, fallback) => fallback,
    normalizeComparableText: (value) => String(value || "").toLowerCase(),
    formatSubtitleDelay: (ms) => `${ms} ms`,
    normalizeSubtitleLanguageKey: (lang) => String(lang || ""),
    subtitleLanguageLabel: (lang) => String(lang || ""),
    styleChipLabel: (value) => String(value || ""),
    getEmbeddedSubtitleSupportState: () => ({ supported: true }),
    isTizenEmbeddedTextSubtitleFallbackTrack: () => false,
    canUseEmbeddedBitmapSubtitles: () => false,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value))
  };

  const methods52 = loadPlayerMethods(
    "playerScreenMethods-52-apply-startup-audio-fallback.js",
    "createPlayerScreenMethods52",
    internals,
    { isEditingHdrSubtitleStyle, normalizeHdrBrightness, normalizeHdrTextColor }
  );
  const methods53 = loadPlayerMethods(
    "playerScreenMethods-53-render-subtitle-style-control-in-place.js",
    "createPlayerScreenMethods53",
    internals,
    {
      HDR_BRIGHTNESS_STEP,
      isEditingHdrSubtitleStyle,
      normalizeHdrBrightness,
      normalizeHdrTextColor
    }
  );
  const methods24 = loadPlayerMethods(
    "playerScreenMethods-24-open-next-episode-stream-picker.js",
    "createPlayerScreenMethods24",
    internals,
    { syncHtmlSubtitleClearance: () => {} }
  );

  const screen = {
    ...methods52,
    ...methods53,
    ...methods24,
    subtitleStyleSettings: { ...baseStyle },
    subtitleDelayMs: 0,
    subtitleDialogVisible: true,
    uiRefs: {
      root: { style: uiRootStyle },
      htmlSubtitles: { classList: { toggle() {} } },
      subtitleDialog: null
    },
    htmlSubtitleCues,
    htmlSubtitleLastActiveCues: [],
    htmlSubtitleSelectedId,
    webOsEmbeddedTextSubtitleUsingAss,
    selectedEmbeddedSubtitleTrackIndex,
    webOsEmbeddedTextSubtitleTrack,
    bitmapSubtitleTrack,
    assSubtitleRenderer: assActive
      ? { active: true, supportsPlacement: supportsAssPlacement }
      : null,
    isAssAddonSubtitleActive: () => assActive,
    isCurrentPlaybackHdr: () => isHdr,
    schedulePersistPlayerPresentationSettings() {
      persistCalls += 1;
    },
    persistSubtitleDelayPreference() {},
    renderHtmlSubtitleOverlayAtCurrentTime() {},
    refreshSubtitleCueStyles() {},
    renderBitmapSubtitleAtCurrentTime() {},
    refreshSubtitleTrackRendering() {},
    renderSubtitleDialog() {}
  };

  const originalApply = screen.applySubtitlePresentationSettings;
  screen.applySubtitlePresentationSettings = function wrappedApply(options) {
    applyCalls += 1;
    return originalApply.call(this, options);
  };

  return {
    screen,
    uiRootStyle,
    videoStyle,
    get applyCalls() {
      return applyCalls;
    },
    get persistCalls() {
      return persistCalls;
    }
  };
}

test("resolveSubtitleStyleControlAvailability gates hdrBrightness consistently across renderers", () => {
  // Browser / CSS text tracks & HTML overlay
  assert.equal(resolveSubtitleStyleControlAvailability({}).hdrBrightness, true);
  assert.equal(
    resolveSubtitleStyleControlAvailability({ rendererMode: "html" }).hdrBrightness,
    true
  );

  // LG webOS native cues & HTML overlay
  assert.equal(
    resolveSubtitleStyleControlAvailability({ isWebOsNative: true, rendererMode: "none" })
      .hdrBrightness,
    true
  );
  assert.equal(
    resolveSubtitleStyleControlAvailability({ isWebOsNative: true, rendererMode: "html" })
      .hdrBrightness,
    true
  );

  // Tizen AVPlay HTML overlay & callback overlay
  assert.equal(
    resolveSubtitleStyleControlAvailability({ isTizenAvPlay: true, rendererMode: "html" })
      .hdrBrightness,
    true
  );
  assert.equal(
    resolveSubtitleStyleControlAvailability({ isTizenAvPlay: true, rendererMode: "html-callback" })
      .hdrBrightness,
    true
  );

  // Tizen AVPlay native renderers cannot apply CSS HDR brightness dimming
  assert.equal(
    resolveSubtitleStyleControlAvailability({
      isTizenAvPlay: true,
      rendererMode: "embedded-native"
    }).hdrBrightness,
    false
  );
  const externalNative = resolveSubtitleStyleControlAvailability({
    isTizenAvPlay: true,
    rendererMode: "external-native",
    supportsExternalDelay: true
  });
  assert.equal(externalNative.hdrBrightness, false);
  assert.equal(externalNative.delay, true);
  assert.equal(externalNative.reset, true);

  // ASS / libass preserves authored ASS colors across all platforms (Android parity)
  const assLocked = resolveSubtitleStyleControlAvailability({
    preserveAssStyles: true,
    supportsAssPlacement: true,
    rendererMode: "html"
  });
  assert.equal(assLocked.hdrBrightness, false);
  assert.equal(assLocked.textColor, false);
  assert.equal(assLocked.verticalOffset, true);

  // Bitmap aligns hdrBrightness with color/outline controls (only stripSdh is disabled)
  const bitmap = resolveSubtitleStyleControlAvailability({ bitmap: true });
  assert.equal(bitmap.stripSdh, false);
  assert.equal(bitmap.hdrBrightness, bitmap.textColor);
});

test("Tizen AVPlay embedded-native and external-native disable hdrBrightness across Tizen versions", () => {
  for (const scenario of [
    {
      name: "Tizen 5.5+ embedded-native (PGS / native TX3G)",
      avplayOutputMode: "embedded-native",
      advancedStylingLimited: false,
      expectedValue: "Unavailable with native subtitles",
      expectedDelayDisabled: true
    },
    {
      name: "Legacy Tizen 4.0/5.0 chrome56 embedded-native",
      avplayOutputMode: "embedded-native",
      advancedStylingLimited: true,
      expectedValue: "Not fully supported on this TV",
      expectedDelayDisabled: true
    },
    {
      name: "Tizen 5.5+ external-native",
      avplayOutputMode: "external-native",
      supportsExternalDelay: true,
      advancedStylingLimited: false,
      expectedValue: "Unavailable with native subtitles",
      expectedDelayDisabled: false
    },
    {
      name: "Legacy Tizen <5.5 external-native",
      avplayOutputMode: "external-native",
      supportsExternalDelay: true,
      advancedStylingLimited: true,
      expectedValue: "Not fully supported on this TV",
      expectedDelayDisabled: false
    }
  ]) {
    const harness = createScreenHarness({
      isTizen: true,
      usingAvPlay: true,
      avplayOutputMode: scenario.avplayOutputMode,
      supportsExternalDelay: Boolean(scenario.supportsExternalDelay),
      advancedStylingLimited: scenario.advancedStylingLimited
    });
    const controls = harness.screen.getSubtitleStyleControls();
    const hdrBrightness = controls.find((item) => item.id === "hdrBrightness");
    const delay = controls.find((item) => item.id === "delay");

    assert.ok(hdrBrightness, `${scenario.name}: hdrBrightness control should be listed during HDR`);
    assert.equal(hdrBrightness.disabled, true, scenario.name);
    assert.equal(hdrBrightness.value, scenario.expectedValue, scenario.name);
    assert.equal(delay.disabled, scenario.expectedDelayDisabled, scenario.name);
    assert.equal(
      harness.screen.adjustSubtitleStyleControl("hdrBrightness", 1),
      false,
      scenario.name
    );
    assert.equal(harness.screen.subtitleStyleSettings.hdrBrightness, 40, scenario.name);
    assert.equal(harness.applyCalls, 0, scenario.name);
    assert.equal(harness.persistCalls, 0, scenario.name);
  }
});

test("ASS/SSA preserved styles disable hdrBrightness like Android while legacy VTT fallback keeps it enabled", () => {
  for (const assScenario of [
    {
      name: "Browser ass.js active",
      assActive: true,
      supportsAssPlacement: true
    },
    {
      name: "LG webOS embedded ASS track",
      isWebOS: true,
      usingNativePlayback: true,
      selectedEmbeddedSubtitleTrackIndex: 0,
      webOsEmbeddedTextSubtitleTrack: { codec: "ass" }
    },
    {
      name: "Tizen 5.5+ ass.js active",
      isTizen: true,
      usingAvPlay: true,
      assActive: true,
      supportsAssPlacement: true
    }
  ]) {
    const harness = createScreenHarness(assScenario);
    const controls = harness.screen.getSubtitleStyleControls();
    const hdrBrightness = controls.find((item) => item.id === "hdrBrightness");

    assert.equal(hdrBrightness.disabled, true, assScenario.name);
    assert.equal(hdrBrightness.value, "ASS/SSA styles are preserved", assScenario.name);
    assert.equal(
      harness.screen.adjustSubtitleStyleControl("hdrBrightness", 1),
      false,
      assScenario.name
    );
    assert.equal(harness.screen.subtitleStyleSettings.hdrBrightness, 40, assScenario.name);
  }

  // Legacy Tizen (<5.5, no ResizeObserver): .ass falls back to VTT in #playerHtmlSubtitles.
  const legacyFallback = createScreenHarness({
    isTizen: true,
    usingAvPlay: true,
    advancedStylingLimited: true,
    assActive: false,
    htmlSubtitleSelectedId: "ass-addon",
    htmlSubtitleCues: [{ start: 0, end: 2, text: "Hello" }]
  });
  const fallbackControl = legacyFallback.screen
    .getSubtitleStyleControls()
    .find((item) => item.id === "hdrBrightness");
  assert.equal(fallbackControl.disabled, false);
  assert.equal(fallbackControl.value, "40%");
  assert.equal(legacyFallback.screen.adjustSubtitleStyleControl("hdrBrightness", 1), true);
  assert.equal(legacyFallback.screen.subtitleStyleSettings.hdrBrightness, 50);
});

test("Supported CSS/HTML/callback HDR renderers adjust hdrBrightness and update scaled subtitle CSS colors", () => {
  for (const supportedScenario of [
    {
      name: "Browser native cue rendering"
    },
    {
      name: "LG webOS native cue rendering",
      isWebOS: true,
      usingNativePlayback: true
    },
    {
      name: "LG webOS HTML overlay",
      isWebOS: true,
      usingNativePlayback: true,
      htmlSubtitleSelectedId: "addon-1",
      htmlSubtitleCues: [{ start: 0, end: 2, text: "Line" }]
    },
    {
      name: "Tizen AVPlay html-callback",
      isTizen: true,
      usingAvPlay: true,
      avplayOutputMode: "html-callback",
      avplayCallbackHtml: true
    },
    {
      name: "Tizen AVPlay extracted HTML overlay",
      isTizen: true,
      usingAvPlay: true,
      htmlSubtitleSelectedId: "tizen-embedded-text-0",
      htmlSubtitleCues: [{ start: 0, end: 2, text: "Line" }]
    }
  ]) {
    const harness = createScreenHarness(supportedScenario);
    const initial = harness.screen
      .getSubtitleStyleControls()
      .find((item) => item.id === "hdrBrightness");
    assert.equal(initial.disabled, false, supportedScenario.name);
    assert.equal(initial.value, "40%", supportedScenario.name);

    assert.equal(
      harness.screen.adjustSubtitleStyleControl("hdrBrightness", 1),
      true,
      supportedScenario.name
    );
    assert.equal(harness.screen.subtitleStyleSettings.hdrBrightness, 50, supportedScenario.name);
    assert.equal(harness.applyCalls, 1, supportedScenario.name);
    assert.equal(harness.persistCalls, 1, supportedScenario.name);

    const expected = resolveHdrSubtitleStyle(harness.screen.subtitleStyleSettings, true);
    assert.equal(
      harness.uiRootStyle.getPropertyValue("--player-subtitle-text-color"),
      expected.textColor,
      supportedScenario.name
    );
    assert.equal(
      harness.uiRootStyle.getPropertyValue("--player-subtitle-background"),
      expected.backgroundColor,
      supportedScenario.name
    );
    assert.equal(
      harness.uiRootStyle.getPropertyValue("--player-subtitle-outline-color"),
      expected.outlineColor,
      supportedScenario.name
    );
    // Brightness factor at 50%: (0.7 * 50 + 30) / 100 = 0.65
    assert.equal(hdrBrightnessFactor(50), 0.65);
  }
});

test("hdrBrightness is omitted on SDR playback or when HDR subtitle override is disabled", () => {
  for (const config of [
    { isHdr: false, hdrStyleEnabled: true },
    { isHdr: true, hdrStyleEnabled: false }
  ]) {
    const harness = createScreenHarness({
      isHdr: config.isHdr,
      subtitleStyleSettings: { hdrStyleEnabled: config.hdrStyleEnabled }
    });
    const controls = harness.screen.getSubtitleStyleControls();
    assert.equal(
      controls.some((item) => item.id === "hdrBrightness"),
      false
    );
  }
});
