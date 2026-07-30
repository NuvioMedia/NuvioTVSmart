const SUBTITLE_STYLE_CONTROL_IDS = [
  "delay",
  "fontSize",
  "bold",
  "textColor",
  "outlineEnabled",
  "outlineColor",
  "verticalOffset",
  "reset"
];

export function resolveSubtitleStyleControlAvailability({
  isTizenAvPlay = false,
  rendererMode = "none",
  supportsExternalDelay = false
} = {}) {
  const availability = Object.fromEntries(
    SUBTITLE_STYLE_CONTROL_IDS.map((controlId) => [controlId, true])
  );
  if (
    !isTizenAvPlay ||
    rendererMode === "html" ||
    rendererMode === "html-callback" ||
    rendererMode === "none"
  ) {
    return availability;
  }
  if (rendererMode === "embedded-native") {
    SUBTITLE_STYLE_CONTROL_IDS.forEach((controlId) => {
      availability[controlId] = false;
    });
    return availability;
  }
  if (rendererMode === "external-native") {
    SUBTITLE_STYLE_CONTROL_IDS.forEach((controlId) => {
      availability[controlId] = false;
    });
    availability.delay = Boolean(supportsExternalDelay);
    availability.reset = availability.delay;
  }
  return availability;
}
