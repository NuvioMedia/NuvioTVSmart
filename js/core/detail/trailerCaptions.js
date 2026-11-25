const CAPTION_LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;
// Player-side placeholders that must not be sent as a language code.
const NON_LANGUAGE_VALUES = new Set(["off", "none", "forced", "auto", "system"]);

/** YouTube player caption parameters, matching Android's preferred-language pick. */
export function applyTrailerCaptionParams(
  params,
  { captionsEnabled = false, captionsLanguage = "" } = {}
) {
  params.set("cc_load_policy", captionsEnabled ? "1" : "0");
  const language = String(captionsLanguage || "").trim();
  if (
    captionsEnabled &&
    !NON_LANGUAGE_VALUES.has(language.toLowerCase()) &&
    CAPTION_LANGUAGE_PATTERN.test(language)
  ) {
    params.set("cc_lang_pref", language);
  } else {
    params.delete("cc_lang_pref");
  }
}

export function trailerCaptionOptions(settings = {}) {
  return {
    captionsEnabled: settings.trailerSubtitles === true,
    captionsLanguage: String(
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || ""
    ).trim()
  };
}
