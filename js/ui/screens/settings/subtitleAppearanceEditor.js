import {
  SUBTITLE_APPEARANCE_DEFAULTS,
  SUBTITLE_BACKGROUND_RADIUS_MAX,
  SUBTITLE_BACKGROUND_RADIUS_STEP,
  SUBTITLE_BASE_TEXT_UNITS,
  SUBTITLE_SHADOW_SIZE_MAX,
  SUBTITLE_SHADOW_SIZE_MIN,
  normalizeSubtitleAppearance,
  subtitleBackgroundRadiusCss,
  subtitleDropShadowCss,
  subtitleFontFamilyCss
} from "../../../core/player/subtitleAppearance.js";

// Android SubtitleAppearanceEditor swatches (settings, not the in-player presets).
export const SUBTITLE_SETTINGS_TEXT_COLORS = [
  "#FFFFFF",
  "#D9D9D9",
  "#FFFF00",
  "#00FFFF",
  "#00FF00",
  "#FF00FF",
  "#FF6B6B",
  "#FFA500",
  "#90EE90"
];
export const SUBTITLE_SETTINGS_OUTLINE_COLORS = ["#000000", "#1A1A1A", "#333333", "#FFFFFF"];
export const SUBTITLE_BACKGROUND_COLOR_PRESETS = [
  "#000000",
  "#3A3A3A",
  "#FFFFFF",
  "#FFD700",
  "#1E3A8A"
];
export const SUBTITLE_BACKGROUND_DEFAULT_OPACITY = 75;
// Android ranges for size, offset and opacity sliders.
export const SUBTITLE_SIZE_RANGE = { min: 50, max: 200, step: 10 };
export const SUBTITLE_OFFSET_RANGE = { min: -20, max: 50, step: 1 };
export const SUBTITLE_OPACITY_RANGE = { min: 0, max: 100, step: 5 };
// Android bodyLarge (16sp) is 28px in Smart settings, so a 24sp subtitle is 42px.
const PREVIEW_BASE_FONT_PX = 42;

export function rangeValues({ min, max, step }) {
  const values = [];
  for (let value = min; value <= max; value += step) {
    values.push(value);
  }
  return values;
}

function hexChannel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** "#RRGGBB" or "#RRGGBBAA" split into its color and an opacity in percent. */
export function splitBackgroundColor(value = "") {
  const hex = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(hex)) {
    return { color: "#000000", opacity: 0 };
  }
  const alpha = hex.length === 9 ? parseInt(hex.slice(7), 16) : 255;
  return { color: hex.slice(0, 7), opacity: Math.round((alpha / 255) * 100) };
}

export function joinBackgroundColor(color = "#000000", opacity = 0) {
  const alpha = Math.round((Math.min(100, Math.max(0, Number(opacity) || 0)) / 100) * 255);
  return `${String(color).slice(0, 7).toUpperCase()}${alpha.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Android subtitleBackgroundColorFor: a new background color keeps the opacity, or 75% when it had none. */
export function backgroundColorFor(color, currentBackground) {
  const { opacity } = splitBackgroundColor(currentBackground);
  return joinBackgroundColor(color, opacity > 0 ? opacity : SUBTITLE_BACKGROUND_DEFAULT_OPACITY);
}

function rgba(hex, alpha) {
  return `rgba(${hexChannel(hex, 0)}, ${hexChannel(hex, 1)}, ${hexChannel(hex, 2)}, ${alpha})`;
}

/** The values "Reset Appearance" restores (Android resetSubtitleAppearance). */
export function subtitleAppearanceResetValues(defaults = {}) {
  return {
    fontSize: defaults.fontSize,
    verticalOffset: defaults.verticalOffset,
    bold: defaults.bold,
    textColor: defaults.textColor,
    textOpacity: defaults.textOpacity,
    backgroundColor: defaults.backgroundColor,
    outlineEnabled: defaults.outlineEnabled,
    outlineColor: defaults.outlineColor,
    ...SUBTITLE_APPEARANCE_DEFAULTS
  };
}

/** Android SubtitleAppearancePreview: the sample text drawn with the current style. */
export function buildSubtitleAppearancePreviewHtml(style = {}, { t, escapeHtml }) {
  const appearance = normalizeSubtitleAppearance(style);
  const sizePercent = Math.min(200, Math.max(50, Number(style.fontSize) || 120));
  const textColor = /^#[0-9A-F]{6}$/i.test(style.textColor || "") ? style.textColor : "#FFFFFF";
  const outlineColor = /^#[0-9A-F]{6}$/i.test(style.outlineColor || "")
    ? style.outlineColor
    : "#000000";
  const textAlpha = Math.min(100, Math.max(0, Number(style.textOpacity ?? 100))) / 100;
  const background = splitBackgroundColor(style.backgroundColor);
  const outline = (2 / SUBTITLE_BASE_TEXT_UNITS).toFixed(4);
  const outlineShadow = style.outlineEnabled
    ? [`-${outline}em 0`, `${outline}em 0`, `0 -${outline}em`, `0 ${outline}em`]
        .map((offset) => `${offset} 0 ${rgba(outlineColor, textAlpha)}`)
        .join(", ")
    : "";
  const dropShadow = subtitleDropShadowCss(appearance);
  const shadow =
    [outlineShadow, dropShadow === "none" ? "" : dropShadow].filter(Boolean).join(", ") || "none";
  const textStyle = [
    `font-size:${Math.round((PREVIEW_BASE_FONT_PX * sizePercent) / 100)}px`,
    `font-weight:${style.bold ? 700 : 400}`,
    subtitleFontFamilyCss(appearance.fontId)
      ? `font-family:${subtitleFontFamilyCss(appearance.fontId)}`
      : "",
    `color:${rgba(textColor, textAlpha)}`,
    `text-shadow:${shadow}`,
    background.opacity > 0 ? `background:${rgba(background.color, background.opacity / 100)}` : "",
    `border-radius:${subtitleBackgroundRadiusCss(appearance)}`
  ]
    .filter(Boolean)
    .join(";");
  return `
    <div class="settings-subtitle-appearance-hint">${escapeHtml(
      t(
        "sub_appearance_hint",
        {},
        "Applies to text subtitles. Styled ASS and image subtitles keep their original appearance."
      )
    )}</div>
    <div class="settings-subtitle-preview" aria-hidden="true">
      <div class="settings-subtitle-preview-label">${escapeHtml(t("sub_preview", {}, "Preview"))}</div>
      <div class="settings-subtitle-preview-text-wrap">
        <span class="settings-subtitle-preview-text" style="${escapeHtml(textStyle)}">${escapeHtml(
          t("sub_preview_text", {}, "Every story begins with a little curiosity.")
        )}</span>
      </div>
    </div>`;
}

export const SUBTITLE_APPEARANCE_LIMITS = {
  radiusMax: SUBTITLE_BACKGROUND_RADIUS_MAX,
  radiusStep: SUBTITLE_BACKGROUND_RADIUS_STEP,
  shadowSizeMin: SUBTITLE_SHADOW_SIZE_MIN,
  shadowSizeMax: SUBTITLE_SHADOW_SIZE_MAX
};
