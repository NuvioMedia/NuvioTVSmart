/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderPlaybackSubtitleBody(model) {
  const {
    SUBTITLE_VERTICAL_OFFSET_DEFAULT,
    labelForOptionId,
    SUBTITLE_SIZE_OPTIONS,
    SUBTITLE_OFFSET_OPTIONS,
    SUBTITLE_TEXT_COLOR_OPTIONS,
    SUBTITLE_TEXT_OPACITY_OPTIONS,
    SUBTITLE_OUTLINE_COLOR_OPTIONS,
    normalizeSubtitleStyleHex,
    clampSubtitleSize,
    clampSubtitleTextOpacity,
    clampSubtitleOffset,
    t,
    labelForSubtitlePlaybackLanguage,
    renderModeLabel
  } = internals;
  return `
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "playback:subtitleLanguage",
              title: t("settings.playback.subtitleLanguage.title"),
              subtitle: t("settings.playback.subtitleLanguage.subtitle"),
              value: labelForSubtitlePlaybackLanguage(model.player.subtitleLanguage)
            })}
            ${this.renderActionRow({ focusKey: "playback:secondarySubtitleLanguage", title: t("sub_secondary_lang", {}, "Secondary subtitle language"), subtitle: t("sub_secondary_lang_sub", {}, "Fallback language when the preferred language is unavailable"), value: labelForSubtitlePlaybackLanguage(model.player.secondarySubtitleLanguage) })}
            ${this.renderToggleRow({
              focusKey: "playback:useForcedSubtitles",
              title: t("settings.playback.useForcedSubtitles.title", {}, "Use forced subtitles"),
              subtitle: t(
                "settings.playback.useForcedSubtitles.subtitle",
                {},
                "Prefer forced subtitles when the audio matches the selected subtitle language."
              ),
              checked: Boolean(model.player.subtitleStyle?.useForcedSubtitles)
            })}
            ${this.renderToggleRow({
              focusKey: "playback:showOnlyPreferredSubtitleLanguages",
              title: t("sub_show_only_preferred_languages", {}, "Show Only Preferred Languages"),
              subtitle: t("sub_show_only_preferred_languages_desc", {}, "Hide all other subtitles languages from selection list"),
              checked: Boolean(model.player.subtitleStyle?.showOnlyPreferredLanguages)
            })}
            ${this.renderActionRow({
              focusKey: "playback:subtitleSize",
              title: t("settings.playback.subtitleSize.title", {}, "Subtitle size"),
              subtitle: t("settings.playback.subtitleSize.subtitle", {}, "Text size used for subtitles during playback."),
              value: labelForOptionId(
                SUBTITLE_SIZE_OPTIONS,
                clampSubtitleSize(model.player.subtitleStyle?.fontSize ?? 120),
                `${clampSubtitleSize(model.player.subtitleStyle?.fontSize ?? 120)}%`
              )
            })}
            ${this.renderActionRow({
              focusKey: "playback:subtitleOffset",
              title: t("settings.playback.subtitleOffset.title", {}, "Subtitle position"),
              subtitle: t("settings.playback.subtitleOffset.subtitle", {}, "Move subtitles up or down on the screen."),
              value: labelForOptionId(
                SUBTITLE_OFFSET_OPTIONS,
                clampSubtitleOffset(model.player.subtitleStyle?.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT),
                `${SUBTITLE_VERTICAL_OFFSET_DEFAULT}%`
              )
            })}
            ${this.renderToggleRow({
              focusKey: "playback:subtitleStripSdh",
              title: t("sub_strip_sdh", {}, "Strip SDH subtitles"),
              subtitle: t("sub_strip_sdh_desc", {}, "Hide sound descriptions and speaker labels from text subtitles"),
              checked: Boolean(model.player.subtitleStyle?.stripSdh)
            })}
            ${this.renderToggleRow({
              focusKey: "playback:subtitleBold",
              title: t("settings.playback.subtitleBold.title", {}, "Bold subtitles"),
              subtitle: t("settings.playback.subtitleBold.subtitle", {}, "Show subtitle text in bold."),
              checked: Boolean(model.player.subtitleStyle?.bold)
            })}
            ${this.renderActionRow({
              focusKey: "playback:subtitleTextColor",
              title: t("settings.playback.subtitleTextColor.title", {}, "Subtitle color"),
              subtitle: t("settings.playback.subtitleTextColor.subtitle", {}, "Color of the subtitle text."),
              value: labelForOptionId(
                SUBTITLE_TEXT_COLOR_OPTIONS,
                normalizeSubtitleStyleHex(model.player.subtitleStyle?.textColor, "#FFFFFF"),
                normalizeSubtitleStyleHex(model.player.subtitleStyle?.textColor, "#FFFFFF")
              )
            })}
            ${this.renderActionRow({
              focusKey: "playback:subtitleTextOpacity",
              title: t("subtitle_style_text_opacity", {}, "Text Opacity"),
              subtitle: "Opacity applied to subtitle text independently of its color and background.",
              value: labelForOptionId(
                SUBTITLE_TEXT_OPACITY_OPTIONS,
                clampSubtitleTextOpacity(model.player.subtitleStyle?.textOpacity),
                `${clampSubtitleTextOpacity(model.player.subtitleStyle?.textOpacity)}%`
              )
            })}
            ${this.renderActionRow({ focusKey: "playback:subtitleBackgroundColor", title: t("sub_bg_color", {}, "Subtitle background color"), subtitle: t("sub_bg_color", {}, "Background behind subtitle text"), value: String(model.player.subtitleStyle?.backgroundColor || "#00000000") })}
            ${this.renderToggleRow({
              focusKey: "playback:subtitleOutline",
              title: t("settings.playback.subtitleOutline.title", {}, "Subtitle outline"),
              subtitle: t("settings.playback.subtitleOutline.subtitle", {}, "Draw an outline around subtitle text for readability."),
              checked: Boolean(model.player.subtitleStyle?.outlineEnabled)
            })}
            ${
              model.player.subtitleStyle?.outlineEnabled
                ? this.renderActionRow({
                    focusKey: "playback:subtitleOutlineColor",
                    title: t("settings.playback.subtitleOutlineColor.title", {}, "Outline color"),
                    subtitle: t("settings.playback.subtitleOutlineColor.subtitle", {}, "Color of the subtitle outline."),
                    value: labelForOptionId(
                      SUBTITLE_OUTLINE_COLOR_OPTIONS,
                      normalizeSubtitleStyleHex(model.player.subtitleStyle?.outlineColor, "#000000"),
                      normalizeSubtitleStyleHex(model.player.subtitleStyle?.outlineColor, "#000000")
                    )
                  })
                : ""
            }
            ${this.renderActionRow({
              focusKey: "playback:renderMode",
              title: t("settings.playback.renderMode.title"),
              subtitle: t("settings.playback.renderMode.subtitle"),
              value: renderModeLabel(model.player.subtitleRenderMode)
            })}
          </div>
        `;
}
