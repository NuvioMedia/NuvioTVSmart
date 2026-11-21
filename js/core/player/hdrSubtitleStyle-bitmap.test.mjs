import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hdrBrightnessFactor,
  hdrSubtitleBrightnessFactor,
  resolveHdrSubtitleStyle,
  scaleHexColorBrightness,
  scaleRgbaBrightness
} from "./hdrSubtitleStyle.js";
import * as SubtitleAppearance from "./subtitleAppearance.js";

function loadPlayerMethods(fileName, exportName, internals, extraBindings = {}) {
  const source = readFileSync(
    new URL(`../../ui/screens/player/${fileName}`, import.meta.url),
    "utf8"
  );
  const stripped = source
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/export function /g, "function ");
  const extraKeys = Object.keys(extraBindings);
  const extraValues = Object.values(extraBindings);
  return new Function(
    "internals",
    ...extraKeys,
    `"use strict";\n${stripped}\nreturn ${exportName}();`
  )(internals, ...extraValues);
}

function hexBytes(hex) {
  const clean = hex.slice(1, 7);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function createFakeCanvasPair() {
  const events = [];
  const createContext = (role) => ({
    clearRect(x, y, width, height) {
      events.push({ role, op: "clearRect", x, y, width, height });
    },
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      };
    },
    putImageData(imageData, x, y) {
      events.push({
        role,
        op: "putImageData",
        x,
        y,
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data)
      });
    },
    drawImage(source, dx, dy, dw, dh) {
      events.push({ role, op: "drawImage", source, dx, dy, dw, dh });
    }
  });

  const makeCanvas = (role) => {
    const classes = new Set(["hidden"]);
    const attributes = new Map([["aria-hidden", "true"]]);
    const context = createContext(role);
    return {
      width: 0,
      height: 0,
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        }
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      getContext() {
        return context;
      }
    };
  };

  return {
    mainCanvas: makeCanvas("main"),
    scratchCanvas: makeCanvas("scratch"),
    events
  };
}

function createBitmapHarness({
  isHdr = true,
  subtitleStyleSettings = {},
  bitmapFormat = "pgs"
} = {}) {
  const { mainCanvas, scratchCanvas, events } = createFakeCanvasPair();
  let hdrCheckCalls = 0;
  let currentHdr = isHdr;

  // Source RGBA buffer: opaque white pixel, dimmed grey pixel, semi-transparent AA pixel,
  // and transparent pixel with non-zero RGB (edge bilinear safety check).
  const sourceRgba = new Uint8ClampedArray([
    255, 255, 255, 255, 128, 128, 128, 255, 255, 215, 0, 128, 255, 255, 255, 0
  ]);

  const frame = {
    key: `${bitmapFormat}:0:1000:3000`,
    startMs: 1000,
    endMs: 3000,
    screenWidth: 1920,
    screenHeight: 1080,
    compositions: [
      {
        x: 760,
        y: 900,
        width: 2,
        height: 2,
        rgba: sourceRgba
      }
    ]
  };

  const uiStyle = {
    props: new Map(),
    setProperty(k, v) {
      this.props.set(k, String(v));
    },
    removeProperty(k) {
      this.props.delete(k);
    },
    getPropertyValue(k) {
      return this.props.get(k) ?? "";
    }
  };

  const internals = {
    SubtitleAppearance,
    PlayerController: {
      video: { style: uiStyle },
      getPlayerViewportSize: () => ({ width: 1920, height: 1080 }),
      setWebOsSubtitleFontSize() {},
      setAvPlayExternalSubtitleDelay() {}
    },
    PlayerSettingsStore: {},
    Environment: { isTizen: () => false, isWebOS: () => false },
    Router: {},
    resolveHdrSubtitleStyle,
    localMediaBitmapSubtitleRepository: {},
    getSubtitleVerticalOffsetVh: () => 0,
    getSubtitleVerticalResidualOffsetVh: () => 0,
    normalizeSubtitleTextOpacity: (v) => Number(v ?? 100),
    subtitleTextColorWithOpacity: (color) => color,
    normalizeSubtitleFontSize: (v) => Number(v ?? 100),
    formatHtmlSubtitleFontSize: (v) => `${v}%`,
    dbToGain: () => 1,
    supportsTvWebAudioAmplification: () => false,
    streamDirectPlaybackUrl: () => "",
    ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS: 0,
    BitmapSubtitleDecoder: class {},
    BITMAP_SUBTITLE_WINDOW_SECONDS: 60,
    BITMAP_SUBTITLE_PREFETCH_SECONDS: 10,
    BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS: 30,
    normalizeWebOsHtmlSubtitleText: (v) => v,
    getEmbeddedSubtitleSupportState: () => ({ supported: true }),
    isBitmapSubtitleSupportError: () => false,
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    t: (_k, _p, f) => f
  };

  const methods45 = loadPlayerMethods(
    "playerScreenMethods-45-load-bitmap-subtitle-window.js",
    "createPlayerScreenMethods45",
    internals,
    {
      buildHtmlSubtitleCueIndex: () => null,
      findActiveHtmlSubtitleCues: () => ({ activeCues: [], nextBoundarySeconds: 0 }),
      hdrSubtitleBrightnessFactor,
      scaleRgbaBrightness
    }
  );
  const methods24 = loadPlayerMethods(
    "playerScreenMethods-24-open-next-episode-stream-picker.js",
    "createPlayerScreenMethods24",
    internals,
    { syncHtmlSubtitleClearance: () => {} }
  );

  const screen = {
    ...methods45,
    ...methods24,
    bitmapSubtitleTrack: {
      bitmapSubtitle: true,
      bitmapSubtitleFormat: bitmapFormat,
      sourceTrackId: 4
    },
    bitmapSubtitleWindowStart: 0,
    bitmapSubtitleWindowEnd: 60,
    bitmapSubtitleLoading: false,
    bitmapSubtitleLastFrameKey: "",
    bitmapSubtitleScratchCanvas: scratchCanvas,
    bitmapSubtitleDecoder: {
      renderAtSeconds: () => frame
    },
    subtitleDelayMs: 0,
    subtitleStyleSettings: {
      fontSize: 100,
      verticalOffset: 5,
      textColor: "#FFFFFF",
      backgroundColor: "#00000000",
      outlineColor: "#000000",
      hdrStyleEnabled: true,
      hdrTextColor: "#FFFFFF",
      hdrBrightness: 40,
      ...subtitleStyleSettings
    },
    uiRefs: {
      root: { style: uiStyle },
      bitmapSubtitles: mainCanvas,
      htmlSubtitles: { classList: { toggle() {} } }
    },
    getPlaybackCurrentSeconds: () => 1.5,
    getAspectModeDefinition: () => ({ id: "fit" }),
    calculateAspectRect: () => ({ x: 0, y: 0, width: 1920, height: 1080, scaleX: 1, scaleY: 1 }),
    refreshSubtitleCueStyles() {},
    refreshSubtitleTrackRendering() {},
    isCurrentPlaybackHdr() {
      hdrCheckCalls += 1;
      return currentHdr;
    }
  };

  return {
    screen,
    sourceRgba,
    mainCanvas,
    events,
    get hdrCheckCalls() {
      return hdrCheckCalls;
    },
    setHdr(value) {
      currentHdr = value;
    },
    lastPutPixels() {
      return events.filter((e) => e.op === "putImageData").at(-1)?.data || null;
    }
  };
}

test("hdrSubtitleBrightnessFactor returns 1 on SDR or disabled override and hdrBrightnessFactor otherwise", () => {
  assert.equal(hdrSubtitleBrightnessFactor({ hdrStyleEnabled: false, hdrBrightness: 0 }, true), 1);
  assert.equal(hdrSubtitleBrightnessFactor({ hdrStyleEnabled: true, hdrBrightness: 0 }, false), 1);
  assert.equal(hdrSubtitleBrightnessFactor({ hdrStyleEnabled: true, hdrBrightness: 0 }, true), 0.3);
  assert.equal(
    hdrSubtitleBrightnessFactor({ hdrStyleEnabled: true, hdrBrightness: 40 }, true),
    0.58
  );
  assert.equal(hdrSubtitleBrightnessFactor({ hdrStyleEnabled: true, hdrBrightness: 100 }, true), 1);
});

test("scaleRgbaBrightness matches scaleHexColorBrightness byte-for-byte without custom LUT divergence", () => {
  for (const brightness of [0, 40, 70, 100]) {
    const factor = hdrBrightnessFactor(brightness);
    for (const [hex, alpha] of [
      ["#FFFFFF", 255],
      ["#FFD700", 128],
      ["#808080", 255],
      ["#D9D9D9", 200]
    ]) {
      const [r, g, b] = hexBytes(hex);
      const expectedRgb = hexBytes(scaleHexColorBrightness(hex, factor));
      const source = new Uint8ClampedArray([r, g, b, alpha, 255, 255, 255, 0]);
      const scaled = scaleRgbaBrightness(source, factor);

      assert.deepEqual(
        [scaled[0], scaled[1], scaled[2], scaled[3]],
        [...expectedRgb, alpha],
        `brightness=${brightness} color=${hex}`
      );
      assert.equal(scaled[7], 0);
      if (factor < 1) {
        assert.deepEqual([scaled[4], scaled[5], scaled[6], scaled[7]], [0, 0, 0, 0]);
      } else {
        assert.deepEqual(Array.from(scaled), Array.from(source));
      }
      // Input pixel bytes are never mutated in place.
      assert.deepEqual([source[0], source[1], source[2], source[3]], [r, g, b, alpha]);
    }
  }
});

test("bitmap canvas applies linear HDR brightness consistently across PGS/VobSub and matches text CSS brightness", () => {
  const harness = createBitmapHarness({ bitmapFormat: "vobsub" });
  const beforeSource = new Uint8ClampedArray(harness.sourceRgba);

  assert.equal(harness.screen.renderBitmapSubtitleAtCurrentTime(), true);
  assert.equal(harness.mainCanvas.classList.contains("hidden"), false);

  const pixelsAt40 = harness.lastPutPixels();
  const expectedWhiteAt40 = hexBytes(
    resolveHdrSubtitleStyle(harness.screen.subtitleStyleSettings, true).textColor
  );
  assert.deepEqual(
    [pixelsAt40[0], pixelsAt40[1], pixelsAt40[2], pixelsAt40[3]],
    [...expectedWhiteAt40, 255]
  );
  // Mid-grey (128, 128, 128) at factor 0.58 => Math.round(74.24) = 74
  assert.deepEqual([pixelsAt40[4], pixelsAt40[5], pixelsAt40[6], pixelsAt40[7]], [74, 74, 74, 255]);
  // Gold (#FFD700) with semi-transparent AA alpha preserves alpha 128
  assert.deepEqual(
    [pixelsAt40[8], pixelsAt40[9], pixelsAt40[10], pixelsAt40[11]],
    [148, 125, 0, 128]
  );
  // Transparent pixels are cleared cleanly so edge interpolation never bleeds white halos
  assert.deepEqual([pixelsAt40[12], pixelsAt40[13], pixelsAt40[14], pixelsAt40[15]], [0, 0, 0, 0]);

  // Changing hdrBrightness to 0% -> applySubtitlePresentationSettings re-renders from intact source
  harness.screen.subtitleStyleSettings.hdrBrightness = 0;
  harness.screen.applySubtitlePresentationSettings();
  const pixelsAt0 = harness.lastPutPixels();
  const expectedWhiteAt0 = hexBytes(
    resolveHdrSubtitleStyle(harness.screen.subtitleStyleSettings, true).textColor
  );
  assert.deepEqual(
    [pixelsAt0[0], pixelsAt0[1], pixelsAt0[2], pixelsAt0[3]],
    [...expectedWhiteAt0, 255]
  );

  // Increasing back to 100% restores full original brightness without rounding drift
  harness.screen.subtitleStyleSettings.hdrBrightness = 100;
  harness.screen.applySubtitlePresentationSettings();
  const pixelsAt100 = harness.lastPutPixels();
  assert.deepEqual(Array.from(pixelsAt100), Array.from(beforeSource));
  assert.deepEqual(Array.from(harness.sourceRgba), Array.from(beforeSource));
});

test("HDR->SDR transition busts renderKey cache even on normal timeupdate ticks", () => {
  const harness = createBitmapHarness({ bitmapFormat: "pgs" });

  assert.equal(harness.screen.renderBitmapSubtitleAtCurrentTime(), true);
  assert.equal(harness.lastPutPixels()[0], 148);
  const putCountAfterHdr = harness.events.filter((e) => e.op === "putImageData").length;

  // Same frame & time with no change uses cache (does not redraw unnecessarily)
  assert.equal(harness.screen.renderBitmapSubtitleAtCurrentTime(), true);
  assert.equal(harness.events.filter((e) => e.op === "putImageData").length, putCountAfterHdr);

  // Switching video metadata to SDR must bust cache on next renderBitmapSubtitleAtCurrentTime()
  harness.setHdr(false);
  assert.equal(harness.screen.renderBitmapSubtitleAtCurrentTime(), true);
  assert.equal(harness.events.filter((e) => e.op === "putImageData").length, putCountAfterHdr + 1);
  assert.equal(harness.lastPutPixels()[0], 255);
});

test("disabled hdrStyleEnabled skips isCurrentPlaybackHdr check and leaves source RGBA untouched", () => {
  const harness = createBitmapHarness({
    subtitleStyleSettings: { hdrStyleEnabled: false, hdrBrightness: 0 }
  });
  assert.equal(harness.screen.renderBitmapSubtitleAtCurrentTime(), true);
  assert.equal(harness.hdrCheckCalls, 0);
  assert.deepEqual(Array.from(harness.lastPutPixels()), Array.from(harness.sourceRgba));
});
