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
    renderModeLabel,
    escapeHtml
  } = internals;
  const autoSyncEnabled = Boolean(model.player.subtitleStyle?.autoSyncEnabled);
  const hdrStyleEnabled = model.player.subtitleStyle?.hdrStyleEnabled === true;
  const autoSyncToleranceMs = Math.trunc(Number(model.player.subtitleStyle?.autoSyncToleranceMs || 0));
  const autoSyncToleranceValue =
    autoSyncToleranceMs > 0
      ? t("autosync_tolerance_value", [autoSyncToleranceMs], `${autoSyncToleranceMs} ms`)
      : t("autosync_tolerance_off", {}, "Off");
  return `
          <div class="settings-stack">
            <div class="settings-section-label">${escapeHtml(t("sub_languages_label", {}, "Languages"))}</div>
            ${this.renderActionRow({
              focusKey: "playback:subtitleLanguage",
              title: t("settings.playback.subtitleLanguage.title"),
              subtitle: t("settings.playback.subtitleLanguage.subtitle"),
              value: labelForSubtitlePlaybackLanguage(model.player.subtitleLanguage)
            })}
            ${this.renderActionRow({ focusKey: "playback:secondarySubtitleLanguage", title: t("sub_secondary_lang", {}, "Secondary subtitle language"), subtitle: t("sub_secondary_lang_sub", {}, "Fallback language when the preferred language is unavailable"), value: labelForSubtitlePlaybackLanguage(model.player.secondarySubtitleLanguage) })}
            ${this.renderToggleRow({
              focusKey: "playback:subtitleAutoSync",
              title: t("autosync_setting_title", {}, "Auto Sync Subtitles"),
              subtitle: t(
                "autosync_setting_description",
                {},
                "Match the selected add-on subtitle to the timing of the subtitles embedded in the video."
              ),
              checked: autoSyncEnabled
            })}
            ${
              autoSyncEnabled
                ? `
                  ${this.renderActionRow({
                    focusKey: "playback:subtitleAutoSyncTolerance",
                    title: t("autosync_tolerance_title", {}, "Auto Sync Tolerance"),
                    subtitle: t(
                      "autosync_tolerance_description",
                      {},
                      "Keep the original timing when the correction needed is this small or smaller."
                    ),
                    value: autoSyncToleranceValue
                  })}
                  ${this.renderToggleRow({
                    focusKey: "playback:subtitleAutoSyncThorough",
                    title: t("autosync_thorough_title", {}, "Thorough Auto Sync Search"),
                    subtitle: t(
                      "autosync_thorough_description",
                      {},
                      "Keep comparing other subtitles and embedded tracks for a closer match before syncing. When off, the first strong match is used sooner. Only confident matches are ever applied."
                    ),
                    checked: model.player.subtitleStyle?.autoSyncThorough !== false
                  })}
                `
                : ""
            }
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
            ${this.renderToggleRow({
              focusKey: "playback:subtitleStripSdh",
              title: t("sub_strip_sdh", {}, "Strip SDH subtitles"),
              subtitle: t("sub_strip_sdh_desc", {}, "Hide sound descriptions and speaker labels from text subtitles"),
              checked: Boolean(model.player.subtitleStyle?.stripSdh)
            })}
            <div class="settings-section-label">${escapeHtml(t("sub_style_label", {}, "Style"))}</div>
            ${this.renderActionRow({
              focusKey: "playback:subtitleAppearance",
              title: t("sub_appearance", {}, "Subtitle Appearance"),
              subtitle: t("sub_appearance_desc", {}, "Font, colors, background and shadow")
            })}
            ${this.renderToggleRow({
              focusKey: "playback:subtitleHdrStyle",
              title: t("sub_hdr_style", {}, "Separate HDR / Dolby Vision style"),
              subtitle: t(
                "sub_hdr_style_sub",
                {},
                "Use a different text color and a dimmer brightness for subtitles on HDR and Dolby Vision video"
              ),
              checked: hdrStyleEnabled
            })}
            ${
              hdrStyleEnabled
                ? `
                  ${this.renderActionRow({
                    focusKey: "playback:subtitleHdrTextColor",
                    title: t("sub_hdr_text_color", {}, "HDR Text Color"),
                    subtitle: t("settings.playback.subtitleTextColor.subtitle", {}, "Color of the subtitle text."),
                    value: labelForOptionId(
                      SUBTITLE_TEXT_COLOR_OPTIONS,
                      normalizeSubtitleStyleHex(model.player.subtitleStyle?.hdrTextColor, "#FFFFFF"),
                      normalizeSubtitleStyleHex(model.player.subtitleStyle?.hdrTextColor, "#FFFFFF")
                    )
                  })}
                  ${this.renderActionRow({
                    focusKey: "playback:subtitleHdrBrightness",
                    title: t("sub_hdr_brightness", {}, "HDR Brightness"),
                    subtitle: t("sub_hdr_brightness_sub", {}, "Brightness of subtitles and menus on HDR video"),
                    value: `${Math.round(Number(model.player.subtitleStyle?.hdrBrightness ?? 40) || 0)}%`
                  })}
                  ${this.renderToggleRow({
                    focusKey: "playback:subtitleHdrDimPlayerControls",
                    title: t("sub_hdr_dim_player_controls", {}, "Dim player controls on HDR"),
                    subtitle: t(
                      "sub_hdr_dim_player_controls_sub",
                      {},
                      "Apply the HDR brightness to the player controls and menus shown over HDR and Dolby Vision video"
                    ),
                    checked: model.player.subtitleStyle?.hdrDimPlayerControls === true
                  })}
                `
                : ""
            }
            <div class="settings-section-label">${escapeHtml(t("sub_advanced_section", {}, "Advanced Subtitle Rendering"))}</div>
            ${this.renderActionRow({
              focusKey: "playback:renderMode",
              title: t("settings.playback.renderMode.title"),
              subtitle: t("settings.playback.renderMode.subtitle"),
              value: renderModeLabel(model.player.subtitleRenderMode)
            })}
          </div>
        `;
}
