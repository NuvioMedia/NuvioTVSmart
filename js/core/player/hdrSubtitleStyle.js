// HDR subtitle style and control dimming, ported from Android NuvioTV
// PlayerSettingsDataStore.SubtitleStyleSettings. On HDR/Dolby Vision video the optional
// style replaces the text color and dims every subtitle color, and the player controls
// and menus can follow the same brightness.

export const HDR_BRIGHTNESS_MIN = 0;
export const HDR_BRIGHTNESS_MAX = 100;
export const HDR_BRIGHTNESS_DEFAULT = 40;
export const HDR_BRIGHTNESS_STEP = 10;

const DV_CODEC_PATTERN = /^(dvhe|dvh1|dvav|dva1|dav1)[.-]/i;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeHdrBrightness(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return HDR_BRIGHTNESS_DEFAULT;
  }
  return Math.min(HDR_BRIGHTNESS_MAX, Math.max(HDR_BRIGHTNESS_MIN, parsed));
}

/** 0-100 maps onto 30%-100% of full brightness, so 0 still leaves readable text. */
export function hdrBrightnessFactor(brightness) {
  return (0.7 * normalizeHdrBrightness(brightness) + 30) / 100;
}

export function normalizeHdrTextColor(value, fallback = "#FFFFFF") {
  const hex = String(value || "")
    .trim()
    .toUpperCase();
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}

function normalizeHexColor(value, fallback) {
  const hex = String(value || "")
    .trim()
    .toUpperCase();
  return HEX_COLOR.test(hex) ? hex : fallback;
}

function expandShortHex(hex) {
  if (hex.length !== 4) {
    return hex;
  }
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

/** Scale the RGB channels of a CSS hex color, keeping alpha and the original format. */
export function scaleHexColorBrightness(color, factor) {
  const raw = normalizeHexColor(color, "#FFFFFF");
  const expanded = expandShortHex(raw);
  const hasAlpha = expanded.length === 9;
  const rgb = expanded.slice(1, 7);
  const alpha = hasAlpha ? expanded.slice(7) : "";
  const scaled = [0, 2, 4]
    .map((offset) =>
      Math.max(0, Math.min(255, Math.round(parseInt(rgb.slice(offset, offset + 2), 16) * factor)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
    .toUpperCase();
  if (raw.length === 4) {
    return `#${scaled}`;
  }
  return `#${scaled}${hasAlpha ? alpha : ""}`;
}

export function isHdrMediaInfo(info = {}) {
  const hdr = Array.isArray(info?.hdr) ? info.hdr.filter(Boolean) : [];
  if (hdr.length) {
    return true;
  }
  return DV_CODEC_PATTERN.test(String(info?.videoCodec || "").trim());
}

/**
 * Colors to render subtitles with: on HDR video with the override enabled the HDR text
 * color replaces the text color and every color is scaled by the HDR brightness.
 */
export function resolveHdrSubtitleStyle(style = {}, isHdrVideo = false) {
  const colors = {
    textColor: normalizeHexColor(style?.textColor, "#FFFFFF"),
    backgroundColor: normalizeHexColor(style?.backgroundColor, "#00000000"),
    outlineColor: normalizeHexColor(style?.outlineColor, "#000000")
  };
  if (!isHdrVideo || style?.hdrStyleEnabled !== true) {
    return colors;
  }
  const factor = hdrBrightnessFactor(style?.hdrBrightness);
  return {
    textColor: scaleHexColorBrightness(normalizeHdrTextColor(style?.hdrTextColor), factor),
    backgroundColor: scaleHexColorBrightness(colors.backgroundColor, factor),
    outlineColor: scaleHexColorBrightness(colors.outlineColor, factor)
  };
}

/** Brightness for the player controls and menus over the video; 1 means no dimming. */
export function playerControlsBrightness(style = {}, isHdrVideo = false) {
  if (!isHdrVideo || style?.hdrStyleEnabled !== true || style?.hdrDimPlayerControls !== true) {
    return 1;
  }
  return hdrBrightnessFactor(style?.hdrBrightness);
}
