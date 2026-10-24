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
    hudOpacity: 1.0,
    modalOpacity: 1.0,
    labelKey: "subtitle_style_hdr_preset_dark",
    fallback: "Dark Room (~100–120 nits)"
  },
  REFERENCE: {
    id: "REFERENCE",
    factor: 0.78,
    hudFactor: 0.82,
    hudOpacity: 1.0,
    modalOpacity: 1.0,
    labelKey: "subtitle_style_hdr_preset_reference",
    fallback: "Reference (~180–200 nits)"
  },
  BRIGHT: {
    id: "BRIGHT",
    factor: 0.90,
    hudFactor: 0.92,
    hudOpacity: 1.0,
    modalOpacity: 1.0,
    labelKey: "subtitle_style_hdr_preset_bright",
    fallback: "Bright Room (~250–280 nits)"
  },
  OFF: {
    id: "OFF",
    factor: 1.0,
    hudFactor: 1.0,
    hudOpacity: 1.0,
    modalOpacity: 1.0,
    labelKey: "subtitle_style_hdr_preset_off",
    fallback: "Off (Max Panel)"
  }
};

export const HDR_PRESET_ORDER = ["DARK", "REFERENCE", "BRIGHT", "OFF"];
export const HDR_PRESET_STORAGE_KEY = "nuvio_hdr_brightness_preset";

// Prekompilowane tablice Look-Up Table (statyczne 256 bajtów, zero GC w pętli 60 FPS dla dekodera PGS)
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
  return entry ? (entry.hudFactor ?? 1.0) : 1.0;
}

export function getHdrHudOpacity(preset) {
  const entry = HDR_BRIGHTNESS_PRESETS[String(preset || "").toUpperCase()];
  return entry ? (entry.hudOpacity ?? 1.0) : 1.0;
}

export function getHdrModalOpacity(preset) {
  const entry = HDR_BRIGHTNESS_PRESETS[String(preset || "").toUpperCase()];
  return entry ? (entry.modalOpacity ?? 1.0) : 1.0;
}

export function normalizeHdrBrightnessPreset(preset) {
  const upper = String(preset || "").toUpperCase();
  return HDR_BRIGHTNESS_PRESETS[upper] ? upper : "REFERENCE";
}

export function getNextHdrPreset(preset) {
  const current = normalizeHdrBrightnessPreset(preset);
  const index = HDR_PRESET_ORDER.indexOf(current);
  const nextIndex = (index + 1) % HDR_PRESET_ORDER.length;
  return HDR_PRESET_ORDER[nextIndex];
}

export function getSavedHdrBrightnessPreset(store = null) {
  try {
    if (store?.get) {
      const fromStore = store.get()?.subtitleStyle?.hdrBrightnessPreset;
      if (fromStore) return normalizeHdrBrightnessPreset(fromStore);
    }
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(HDR_PRESET_STORAGE_KEY);
      if (saved) return normalizeHdrBrightnessPreset(saved);
    }
  } catch (_) {}
  return "REFERENCE";
}

export function saveHdrBrightnessPreset(preset, store = null) {
  const normalized = normalizeHdrBrightnessPreset(preset);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(HDR_PRESET_STORAGE_KEY, normalized);
    }
  } catch (_) {}
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hdr-preset-changed", { detail: normalized }));
    }
  } catch (_) {}
  try {
    if (store?.update) {
      store.update({ subtitleStyle: { hdrBrightnessPreset: normalized } });
    }
  } catch (_) {}
  return normalized;
}

/**
 * Kompensacja chromatyczna BT.709 z pełną obsługą kanału alfa.
 * Obsługuje #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgba(...), rgb(...), black, white, transparent.
 */
export function applyHdrDimmingToHex(hexColor = "#FFFFFF", factor = 0.78) {
  if (factor >= 1.0) return hexColor;
  const trimmed = String(hexColor || "#FFFFFF").trim();
  if (!trimmed) return "#C7C7C7";

  const lower = trimmed.toLowerCase();
  // Zachowaj kolory przezroczyste lub brak tła bez przeliczania
  if (lower === "transparent" || lower === "none" || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0/i.test(lower)) {
    return hexColor;
  }
  // Zachowaj czerń bez zmiany na szarość (np. obrys czcionki, czarne tło dialogu)
  if (lower === "black" || /^#000000(?:[0-9a-f]{2})?$/i.test(lower) || /^rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*[0-9.]+)?\s*\)$/i.test(lower)) {
    return hexColor;
  }
  // Bezpieczna konwersja nazwanej bieli
  if (lower === "white") {
    return applyHdrDimmingToHex("#FFFFFF", factor);
  }

  // Obsługa notacji funkcyjnej rgba(...) oraz rgb(...)
  const rgbaMatch = lower.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (rgbaMatch) {
    const r = Math.min(255, parseInt(rgbaMatch[1], 10));
    const g = Math.min(255, parseInt(rgbaMatch[2], 10));
    const b = Math.min(255, parseInt(rgbaMatch[3], 10));
    const a = rgbaMatch[4] !== undefined ? rgbaMatch[4].trim() : "1";
    if (parseFloat(a) === 0) return hexColor;

    const lum = (r * 54 + g * 183 + b * 19) >> 8;
    const scale = lum > 30 ? Math.min(1.0, factor * (255 / Math.sqrt(lum * 255))) : factor;
    const adjR = Math.min(255, Math.round(r * scale));
    const adjG = Math.min(255, Math.round(g * scale));
    const adjB = Math.min(255, Math.round(b * scale));
    return `rgba(${adjR}, ${adjG}, ${adjB}, ${a})`;
  }

  const raw = trimmed.replace(/^#/, "").trim();
  if (!raw) return "#C7C7C7";

  // Obsługa formatów: 3 znaki (RGB), 4 znaki (RGBA), 6 znaków (RRGGBB), 8 znaków (RRGGBBAA)
  let hex = raw;
  let alphaSuffix = "";
  if (raw.length === 3) {
    hex = raw.split("").map((c) => c + c).join("");
  } else if (raw.length === 4) {
    const parts = raw.split("").map((c) => c + c);
    hex = parts.slice(0, 3).join("");
    alphaSuffix = parts[3];
  } else if (raw.length === 8) {
    hex = raw.slice(0, 6);
    alphaSuffix = raw.slice(6, 8);
  } else {
    hex = raw.slice(0, 6);
  }

  // Jeśli kanał alfa wynosi 00 (w 100% przezroczysty), zachowaj go bez zmian
  if (alphaSuffix.toLowerCase() === "00") {
    return hexColor;
  }

  const num = parseInt(hex, 16);
  if (Number.isNaN(num)) return "#C7C7C7";

  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Kompensacja chromatyczna BT.709: zachowuje czystość żółtego (#FFD700) bez oliwkowego odcienia
  const lum = (r * 54 + g * 183 + b * 19) >> 8;
  const scale = lum > 30 ? Math.min(1.0, factor * (255 / Math.sqrt(lum * 255))) : factor;

  const adjR = Math.min(255, Math.round(r * scale));
  const adjG = Math.min(255, Math.round(g * scale));
  const adjB = Math.min(255, Math.round(b * scale));

  return `#${((1 << 24) + (adjR << 16) + (adjG << 8) + adjB).toString(16).slice(1).toUpperCase()}${alphaSuffix.toUpperCase()}`;
}

export const calibrateHdrColorHex = applyHdrDimmingToHex;
export const getHdrLut = getHdrBitmapLut;

/**
 * Sprawdza czy metadane sprzętowe dekodera (AVPlay, webOS Media, HTML5 video.hdrInfo)
 * wskazują na aktywny sygnał HDR / Dolby Vision / HLG / BT.2020.
 */
export function isDecoderHdr(hdrInfo) {
  if (!hdrInfo) return false;
  const gamma = String(hdrInfo.gamma || "").toLowerCase();
  const eotf = String(hdrInfo.eotf || hdrInfo.transfer || "").toLowerCase();
  const colorSpace = String(hdrInfo.colorSpace || hdrInfo.primaries || "").toLowerCase();

  return (
    gamma === "pq" ||
    gamma === "hlg" ||
    eotf === "pq" ||
    eotf === "hlg" ||
    eotf === "smpte2084" ||
    eotf === "arib-b67" ||
    colorSpace === "bt2020" ||
    colorSpace === "rec2020" ||
    Boolean(hdrInfo.dovi || hdrInfo.dolbyVision) ||
    colorSpace.includes("dovi") ||
    colorSpace.includes("ictcp") ||
    hdrInfo.isHdr === true
  );
}

/**
 * Wielopoziomowa analiza deskryptorów strumienia i nazwy pliku (Tier 2 do 6).
 */
export function isHdrStream(streamCandidate, fallbackFilename = null) {
  if (!streamCandidate && !fallbackFilename) return false;

  // Tier 2: Ustrukturyzowane pola parsera torrentów/dodatków
  const parsed = streamCandidate?.parsed || streamCandidate?.raw?.parsed;
  if (parsed) {
    if (Array.isArray(parsed.hdr) && parsed.hdr.length > 0) return true;
    if (typeof parsed.hdr === "string" && parsed.hdr.length > 0) return true;
    if (parsed.hdr === true) return true;
  }

  // Tier 3: Tagi wizualne addona i strumienia z filtrem wykluczającym DVD (obsługa tablic i ciągów znaków)
  const toArray = (val) => (Array.isArray(val) ? val : typeof val === "string" ? val.split(/[,\s]+/) : []);
  const tagsArray = [
    ...toArray(streamCandidate?.tags),
    ...toArray(streamCandidate?.visualTags),
    ...toArray(streamCandidate?.presentation?.visualTags),
    ...toArray(streamCandidate?.raw?.tags),
    ...toArray(streamCandidate?.raw?.visualTags),
    ...toArray(streamCandidate?.raw?.presentation?.visualTags)
  ];

  if (
    tagsArray.some(
      (tag) =>
        typeof tag === "string" &&
        /(?:^|[^a-z0-9])(hdr10(\+|[ ._-]?plus)?|hdr|dovi|dv|dolby[ ._-]?vision|hlg|bt[ ._-]?2020)(?:[^a-z0-9]|$)/i.test(tag) &&
        !/dvd/i.test(tag)
    )
  ) {
    return true;
  }

  // Tier 4: Zaawansowane kodeki wideo (Dolby Vision dvhe/dvh1/dva1/dvav/dvc1, HDR10, BT.2020, SMPTE ST 2084, ARIB B67, VP9.2)
  const codec = [
    streamCandidate?.videoCodec,
    streamCandidate?.raw?.videoCodec,
    streamCandidate?.codec,
    streamCandidate?.raw?.codec,
    streamCandidate?.videoParams?.videoCodec,
    streamCandidate?.videoParams?.codec,
    streamCandidate?.streamInfo?.videoCodec
  ].filter(Boolean).join(" ");

  if (/\b(dvhe|dvh1|dva1|dvav|dvc1|hdr10|bt2020|smpte2084|aribb67|vp09\.02|vp9\.2)\b/i.test(codec)) {
    return true;
  }

  // Tier 5: Dekodowanie encji URL (%2B, %20) w parametrach i nazwach plików
  let streamString = "";
  if (typeof streamCandidate === "string") {
    try {
      streamString = decodeURIComponent(streamCandidate);
    } catch (_) {
      streamString = streamCandidate;
    }
  }

  const rawTextToCheck = [
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
    streamCandidate?.filename,
    streamCandidate?.raw?.filename,
    streamCandidate?.videoParams?.filename,
    streamCandidate?.behaviorHints?.filename,
    codec,
    tagsArray.join(" "),
    fallbackFilename
  ].filter(Boolean).join(" ");

  let decodedUrlText = "";
  try {
    decodedUrlText = decodeURIComponent(rawTextToCheck);
  } catch (_) {}

  const textToCheck = `${rawTextToCheck} ${decodedUrlText}`;

  // Tier 6: Twarde wykluczenie wydań SDR tonemapped oraz HDRip
  if (/(?:^|[^a-z0-9])(hdr[ ._-]?to[ ._-]?sdr|to[ ._-]?sdr|hdr2sdr|tone[ ._-]?mapped|hdr[ ._-]?rip)(?:[^a-z0-9]|$)/i.test(textToCheck)) {
    return false;
  }

  // Bezpieczne granice dopasowania z uwzględnieniem znaków specjalnych (np. HDR10+, DoVi, DV)
  return /(?:^|[^a-z0-9])(hdr10(\+|[ ._-]?plus)?|hdr|dovi|dv|dolby[ ._-]?vision|hlg|bt[ ._-]?2020)(?:[^a-z0-9]|$)/i.test(textToCheck);
}

/**
 * Zintegrowana, scentralizowana weryfikacja stanu HDR (dekoder + strumień).
 */
export function isHdrActive(streamCandidate, hdrInfo, fallbackFilename = null) {
  return isDecoderHdr(hdrInfo) || isHdrStream(streamCandidate, fallbackFilename);
}

/**
 * Precyzyjna klasyfikacja nazwy formatu sygnału HDR dla OSD i nakładki Info.
 */
export function detectHdrFormatTitle(streamCandidate, hdrInfo, fallbackFilename = null) {
  if (hdrInfo) {
    const hdrType = String(hdrInfo.hdrType || hdrInfo.hdr_type || "").toLowerCase();
    if (Boolean(hdrInfo.dovi || hdrInfo.dolbyVision) || hdrType.includes("dolby") || hdrType.includes("dovi")) return "Dolby Vision";
    const cs = String(hdrInfo.colorSpace || hdrInfo.primaries || "").toLowerCase();
    if (cs.includes("dovi") || cs.includes("ictcp")) return "Dolby Vision";
    if (hdrType.includes("hdr10+") || hdrType.includes("plus")) return "HDR10+";
    const gm = String(hdrInfo.gamma || hdrInfo.eotf || hdrInfo.transfer || "").toLowerCase();
    if (gm === "hlg" || gm === "arib-b67" || hdrType.includes("hlg")) return "HLG";
  }

  const toArray = (val) => (Array.isArray(val) ? val : typeof val === "string" ? val.split(/[,\s]+/) : []);
  const tagsArray = [
    ...toArray(streamCandidate?.tags),
    ...toArray(streamCandidate?.visualTags),
    ...toArray(streamCandidate?.presentation?.visualTags)
  ];

  const rawText = [
    streamCandidate?.name,
    streamCandidate?.title,
    streamCandidate?.description,
    streamCandidate?.filename,
    streamCandidate?.videoParams?.filename,
    fallbackFilename,
    ...tagsArray
  ].filter(Boolean).join(" ");

  if (/(?:^|[^a-z0-9])(dovi|dv|dolby[ ._-]?vision)(?:[^a-z0-9]|$)/i.test(rawText) && !/dvd/i.test(rawText)) {
    return "Dolby Vision";
  }
  if (/(?:^|[^a-z0-9])(hdr10(\+|[ ._-]?plus))(?:[^a-z0-9]|$)/i.test(rawText)) {
    return "HDR10+";
  }
  if (/(?:^|[^a-z0-9])(hlg)(?:[^a-z0-9]|$)/i.test(rawText)) {
    return "HLG";
  }
  return "HDR10";
}

/**
 * Wykrywanie sprzętowych możliwości obsługi HDR ekranu Smart TV / monitora.
 */
export function isDisplayHdrCapable() {
  try {
    if (typeof window !== "undefined") {
      if (typeof window.matchMedia === "function" && window.matchMedia("(dynamic-range: high)").matches) {
        return true;
      }
      if (window.screen && (window.screen.colorDepth >= 30 || window.screen.pixelDepth >= 30)) {
        return true;
      }
      if (typeof tizen !== "undefined") {
        return true;
      }
      if (typeof window.webOS !== "undefined" || typeof window.PalmSystem !== "undefined") {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

export const getHdrPresetLabelKey = (preset) =>
  HDR_BRIGHTNESS_PRESETS[normalizeHdrBrightnessPreset(preset)]?.labelKey || "subtitle_style_hdr_preset_reference";

export const getHdrPresetDefaultFallback = (preset) =>
  HDR_BRIGHTNESS_PRESETS[normalizeHdrBrightnessPreset(preset)]?.fallback || "Reference (~180–200 nits)";

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HDR_BRIGHTNESS_PRESETS,
    HDR_PRESET_ORDER,
    HDR_PRESET_STORAGE_KEY,
    getHdrBitmapLut,
    getHdrBrightnessFactor,
    getHdrHudBrightnessFactor,
    getHdrHudOpacity,
    getHdrModalOpacity,
    normalizeHdrBrightnessPreset,
    getNextHdrPreset,
    getSavedHdrBrightnessPreset,
    saveHdrBrightnessPreset,
    applyHdrDimmingToHex,
    calibrateHdrColorHex,
    isDecoderHdr,
    isHdrStream,
    isHdrActive,
    detectHdrFormatTitle,
    getHdrLut,
    getHdrPresetLabelKey,
    getHdrPresetDefaultFallback,
    isDisplayHdrCapable
  };
}
