export const SUBTITLE_VERTICAL_OFFSET_CONTRACT = "android-v1";
export const SUBTITLE_VERTICAL_OFFSET_DEFAULT = 5;
export const SUBTITLE_VERTICAL_OFFSET_MIN = -20;
export const SUBTITLE_VERTICAL_OFFSET_MAX = 50;
export const SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP = 5;

const ANDROID_POINTS_PER_WEB_STEP = 5;

export function normalizeSubtitleVerticalOffset(
  value,
  fallback = SUBTITLE_VERTICAL_OFFSET_DEFAULT
) {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(SUBTITLE_VERTICAL_OFFSET_MAX, Math.max(SUBTITLE_VERTICAL_OFFSET_MIN, normalized));
}

export function splitSubtitleVerticalOffset(value) {
  const storedValue = normalizeSubtitleVerticalOffset(value);
  const relativeOffset =
    (storedValue - SUBTITLE_VERTICAL_OFFSET_DEFAULT) / ANDROID_POINTS_PER_WEB_STEP;
  const lineOffset = relativeOffset < 0 ? Math.ceil(relativeOffset) : Math.floor(relativeOffset);
  const residualOffset = Number((relativeOffset - lineOffset).toFixed(2));
  return {
    storedValue,
    value: relativeOffset,
    lineOffset,
    residualOffset: Object.is(residualOffset, -0) ? 0 : residualOffset
  };
}

export function formatSubtitleVerticalOffset(value) {
  return String(normalizeSubtitleVerticalOffset(value));
}
