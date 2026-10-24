/**
 * hdrColorCalibration.js
 * Universal Pure Calibration Core for Nuvio TV & Stremio Web.
 * Zero-dependency, purely functional, zero runtime allocations.
 */

export const HDR_BRIGHTNESS_PRESETS = {
  DARK: {
    id: "DARK",
    factor: 0.60,
    hudFactor: 0.70,
    labelKey: "subtitle_style_hdr_preset_dark",
    fallback: "Dark Room (~100–120 nits)"
  },
  REFERENCE: {
    id: "REFERENCE",
    factor: 0.78,
    hudFactor: 0.82,
    labelKey: "subtitle_style_hdr_preset_reference",
    fallback: "Reference (~180–200 nits)"
  },
  BRIGHT: {
    id: "BRIGHT",
    factor: 0.90,
    hudFactor: 0.92,
    labelKey: "subtitle_style_hdr_preset_bright",
    fallback: "Bright Room (~250–280 nits)"
  },
  OFF: {
    id: "OFF",
    factor: 1.0,
    hudFactor: 1.0,
    labelKey: "subtitle_style_hdr_preset_off",
    fallback: "Off (Max Panel)"
  }
};

export const HDR_PRESET_ORDER = ["DARK", "REFERENCE", "BRIGHT", "OFF"];

// Prekompilowane tablice Look-Up Table (statyczne 256 bajtów, zero GC w pętli 60 FPS)
const LUT_DARK = new Uint8Array(256);
const LUT_REFERENCE = new Uint8Array(256);
const LUT_BRIGHT = new Uint8Array(256);

for (let i = 0; i < 256; i += 1) {
  LUT_DARK[i] = Math.round(i * 0.60);
  LUT_REFERENCE[i] = Math.round(i * 0.78);
  LUT_BRIGHT[i] = Math.round(i * 0.90);
}

export function getHdrBitmapLut(preset) {
  switch (String(preset || "").toUpperCase()) {
    case "DARK": return LUT_DARK;
    case "REFERENCE": return LUT_REFERENCE;
    case "BRIGHT": return LUT_BRIGHT;
    default: return null; // OFF lub SDR (kopiowanie 1:1)
  }
}

export function getHdrBrightnessFactor(preset) {
  const entry = HDR_BRIGHTNESS_PRESETS[String(preset || "").toUpperCase()];
  return entry ? entry.factor : 1.0;
}

export function getHdrHudBrightnessFactor(preset) {
  const entry = HDR_BRIGHTNESS_PRESETS[String(preset || "").toUpperCase()];
  return entry ? entry.hudFactor : 1.0;
}

export function normalizeHdrBrightnessPreset(preset) {
  const upper = String(preset || "").toUpperCase();
  return HDR_BRIGHTNESS_PRESETS[upper] ? upper : "REFERENCE";
}

export function applyHdrDimmingToHex(hexColor = "#FFFFFF", factor = 0.78) {
  if (factor >= 1.0) return hexColor;
  const raw = String(hexColor || "#FFFFFF").replace(/^#/, "").trim();
  const hex = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  // Odrzuć ewentualny kanał alfa (np. z formatu #RRGGBBAA), operujemy na 24-bit RGB
  const cleanHex = hex.slice(0, 6);
  const num = parseInt(cleanHex, 16);
  if (Number.isNaN(num)) return "#C7C7C7";

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Kompensacja chromatyczna BT.709: zachowuje czystość żółtego (#FFD700) bez brudnego oliwkowego odcienia
  const lum = (r * 54 + g * 183 + b * 19) >> 8;
  const scale = lum > 30 ? Math.min(1.0, factor * (255 / Math.sqrt(lum * 255))) : factor;

  const adjR = Math.min(255, Math.round(r * scale));
  const adjG = Math.min(255, Math.round(g * scale));
  const adjB = Math.min(255, Math.round(b * scale));

  return `#${((1 << 24) + (adjR << 16) + (adjG << 8) + adjB).toString(16).slice(1).toUpperCase()}`;
}

export function isHdrStream(streamCandidate, fallbackFilename = null) {
  if (!streamCandidate && !fallbackFilename) return false;

  let streamString = "";
  if (typeof streamCandidate === "string") {
    try {
      streamString = decodeURIComponent(streamCandidate);
    } catch (_) {
      streamString = streamCandidate;
    }
  }

  const textToCheck = [
    streamString,
    streamCandidate?.name,
    streamCandidate?.title,
    streamCandidate?.description,
    streamCandidate?.label,
    streamCandidate?.details,
    streamCandidate?.url,
    streamCandidate?.quality,
    streamCandidate?.videoRange,
    streamCandidate?.colorSpace,
    streamCandidate?.transferCharacteristics,
    Array.isArray(streamCandidate?.tags) ? streamCandidate.tags.join(" ") : streamCandidate?.tags,
    Array.isArray(streamCandidate?.visualTags) ? streamCandidate.visualTags.join(" ") : streamCandidate?.visualTags,
    Array.isArray(streamCandidate?.presentation?.visualTags) ? streamCandidate.presentation.visualTags.join(" ") : null,
    streamCandidate?.raw?.description,
    streamCandidate?.raw?.title,
    streamCandidate?.raw?.name,
    streamCandidate?.raw?.label,
    streamCandidate?.raw?.details,
    streamCandidate?.raw?.url,
    streamCandidate?.raw?.quality,
    streamCandidate?.raw?.videoRange,
    streamCandidate?.raw?.colorSpace,
    streamCandidate?.raw?.transferCharacteristics,
    Array.isArray(streamCandidate?.raw?.tags) ? streamCandidate.raw.tags.join(" ") : streamCandidate?.raw?.tags,
    Array.isArray(streamCandidate?.raw?.visualTags) ? streamCandidate.raw.visualTags.join(" ") : streamCandidate?.raw?.visualTags,
    Array.isArray(streamCandidate?.raw?.presentation?.visualTags) ? streamCandidate.raw.presentation.visualTags.join(" ") : null,
    streamCandidate?.filename,
    streamCandidate?.raw?.filename,
    streamCandidate?.behaviorHints?.filename,
    streamCandidate?.videoCodec,
    streamCandidate?.raw?.videoCodec,
    fallbackFilename
  ].filter(Boolean).join(" ");

  // Eliminacja wydań SDR po tonemappingu lub wydań HD-Rip (np. "HDR to SDR", "HDRtoSDR", "HDR2SDR", "Tonemapped", "HDRip", "HDR-Rip")
  if (/(?:^|[^a-z0-9])(hdr[ ._-]?to[ ._-]?sdr|to[ ._-]?sdr|hdr2sdr|tone[ ._-]?mapped|hdr[ ._-]?rip)(?:[^a-z0-9]|$)/i.test(textToCheck)) {
    return false;
  }

  const parsed = streamCandidate?.parsed || streamCandidate?.raw?.parsed;
  if (Array.isArray(parsed?.hdr) && parsed.hdr.length > 0) return true;

  const presentation = streamCandidate?.presentation || streamCandidate?.raw?.presentation;
  if (Array.isArray(presentation?.visualTags)) {
    if (presentation.visualTags.some((tag) => /(?:^|[^a-z0-9])(hdr10(\+|[ ._-]?plus)?|hdr|dovi|dv|dolby[ ._-]?vision|hlg)(?:[^a-z0-9]|$)/i.test(tag) && !/dvd/i.test(tag))) {
      return true;
    }
  }

  // Bezpieczne granice dopasowania z uwzględnieniem znaków specjalnych (np. HDR10+, HDR10Plus, DoVi, DV)
  return /(?:^|[^a-z0-9])(hdr10(\+|[ ._-]?plus)?|hdr|dovi|dv|dolby[ ._-]?vision|hlg)(?:[^a-z0-9]|$)/i.test(textToCheck);
}

export const calibrateHdrColorHex = applyHdrDimmingToHex;
export const getHdrPresetLabelKey = (preset) =>
  HDR_BRIGHTNESS_PRESETS[normalizeHdrBrightnessPreset(preset)]?.labelKey || "subtitle_style_hdr_preset_reference";
export const getHdrPresetDefaultFallback = (preset) =>
  HDR_BRIGHTNESS_PRESETS[normalizeHdrBrightnessPreset(preset)]?.fallback || "Reference (~180–200 nits)";

