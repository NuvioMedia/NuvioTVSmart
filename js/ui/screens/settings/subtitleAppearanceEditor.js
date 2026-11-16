import {
  SUBTITLE_APPEARANCE_DEFAULTS,
  SUBTITLE_BACKGROUND_RADIUS_MAX,
  SUBTITLE_BACKGROUND_RADIUS_STEP,
  SUBTITLE_BASE_TEXT_UNITS,
  SUBTITLE_OUTLINE_SIZE_MAX,
  SUBTITLE_OUTLINE_SIZE_MIN,
  SUBTITLE_SHADOW_SIZE_MAX,
  SUBTITLE_SHADOW_SIZE_MIN,
  normalizeSubtitleAppearance,
  subtitleBackgroundRadiusCss,
  subtitleDropShadowCss,
  subtitleFontFamilyCss,
  splitSubtitleBackground,
  joinSubtitleBackground,
  subtitleBackgroundColorFor,
  SUBTITLE_BACKGROUND_COLOR_PRESETS
} from "../../../core/player/subtitleAppearance.js";

export { SUBTITLE_BACKGROUND_COLOR_PRESETS };

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

export const splitBackgroundColor = splitSubtitleBackground;
export const joinBackgroundColor = joinSubtitleBackground;
export const backgroundColorFor = subtitleBackgroundColorFor;

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
  // Android draws a width/2 stroke on each side, so half a text unit per step.
  const outline = (appearance.outlineSize / (SUBTITLE_BASE_TEXT_UNITS * 2)).toFixed(4);
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
  shadowSizeMax: SUBTITLE_SHADOW_SIZE_MAX,
  outlineSizeMin: SUBTITLE_OUTLINE_SIZE_MIN,
  outlineSizeMax: SUBTITLE_OUTLINE_SIZE_MAX
};
