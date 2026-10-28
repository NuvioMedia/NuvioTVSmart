/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function registerPlaybackActionsPart02(model) {
  const {
    PlayerSettingsStore,
    SUBTITLE_VERTICAL_OFFSET_DEFAULT,
    TorrentSettingsStore,
    TizenCapabilities,
    PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
    PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
    SECONDARY_PLAYBACK_LANGUAGE_OPTIONS,
    SUBTITLE_SIZE_OPTIONS,
    SUBTITLE_OFFSET_OPTIONS,
    SUBTITLE_TEXT_COLOR_OPTIONS,
    SUBTITLE_TEXT_OPACITY_OPTIONS,
    SUBTITLE_OUTLINE_COLOR_OPTIONS,
    normalizeSubtitleStyleHex,
    clampSubtitleSize,
    clampSubtitleTextOpacity,
    clampSubtitleOffset,
    SECTION_META,
    t,
    escapeHtml,
    normalizeSelectableSubtitleLanguageCode
  } = internals;
  this.actionMap.set("playback:audioLanguage", () => {
    this.openOptionDialog({
      title: t("settings.dialogs.preferredAudioLanguage"),
      options: PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
      selectedId: PlayerSettingsStore.get().preferredAudioLanguage,
      returnFocusKey: "playback:audioLanguage",
      onSelect: (option) => {
        PlayerSettingsStore.set({ preferredAudioLanguage: option.id });
      }
    });
  });
  this.actionMap.set("playback:secondaryAudioLanguage", () => {
    this.openOptionDialog({
      title: t("sub_secondary_lang", {}, "Secondary Preferred Language"),
      options: SECONDARY_PLAYBACK_LANGUAGE_OPTIONS,
      selectedId: PlayerSettingsStore.get().secondaryPreferredAudioLanguage,
      returnFocusKey: "playback:secondaryAudioLanguage",
      onSelect: (option) => {
        PlayerSettingsStore.set({ secondaryPreferredAudioLanguage: option.id });
      }
    });
  });
  this.actionMap.set("playback:useForcedSubtitles", () => {
    const currentSettings = PlayerSettingsStore.get();
    PlayerSettingsStore.set({
      subtitleStyle: {
        ...currentSettings.subtitleStyle,
        useForcedSubtitles: !currentSettings.subtitleStyle?.useForcedSubtitles
      }
    });
  });
  this.actionMap.set("playback:showOnlyPreferredSubtitleLanguages", () => {
    const currentSettings = PlayerSettingsStore.get();
    const enabled = !currentSettings.subtitleStyle?.showOnlyPreferredLanguages;
    PlayerSettingsStore.set({
      subtitleStyle: {
        ...currentSettings.subtitleStyle,
        showOnlyPreferredLanguages: enabled
      }
    });
  });
  this.actionMap.set("playback:subtitleLanguage", () => {
    const currentSettings = PlayerSettingsStore.get();
    const currentLanguage = normalizeSelectableSubtitleLanguageCode(
      currentSettings.subtitleStyle?.preferredLanguage || currentSettings.subtitleLanguage
    );
    this.openOptionDialog({
      title: t("settings.dialogs.preferredSubtitleLanguage"),
      options: PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
      selectedId: currentLanguage === "system" ? "off" : currentLanguage,
      returnFocusKey: "playback:subtitleLanguage",
      dialogClassName: "settings-language-dialog",
      optionRenderer: "subtitle-language",
      onSelect: (option) => {
        const normalized = normalizeSelectableSubtitleLanguageCode(option.id);
        PlayerSettingsStore.set({
          subtitlesEnabled: true,
          subtitleLanguage: normalized,
          subtitleStyle: {
            ...currentSettings.subtitleStyle,
            preferredLanguage: normalized
          }
        });
      }
    });
  });
  this.actionMap.set("playback:secondarySubtitleLanguage", () => {
    const currentSettings = PlayerSettingsStore.get();
    this.openOptionDialog({
      title: t("sub_secondary_lang", {}, "Secondary subtitle language"),
      options: PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
      selectedId: currentSettings.secondarySubtitleLanguage || "off",
      returnFocusKey: "playback:secondarySubtitleLanguage",
      dialogClassName: "settings-language-dialog",
      optionRenderer: "subtitle-language",
      onSelect: (option) =>
        PlayerSettingsStore.set({
          secondarySubtitleLanguage: option.id,
          subtitleStyle: {
            ...currentSettings.subtitleStyle,
            secondaryPreferredLanguage: option.id
          }
        })
    });
  });
  this.actionMap.set("playback:renderMode", () => {
    this.openOptionDialog({
      title: t("settings.dialogs.subtitleRenderMode"),
      options: [
        { id: "native", labelKey: "common.native" },
        { id: "html", labelKey: "common.htmlOverlay" }
      ],
      selectedId: String(PlayerSettingsStore.get().subtitleRenderMode || "native").toLowerCase(),
      returnFocusKey: "playback:renderMode",
      onSelect: (option) => {
        PlayerSettingsStore.set({ subtitleRenderMode: option.id });
      }
    });
  });
  const updateSubtitleStyle = (partial) => {
    const current = PlayerSettingsStore.get();
    PlayerSettingsStore.set({
      subtitleStyle: { ...current.subtitleStyle, ...partial }
    });
  };
  this.actionMap.set("playback:subtitleSize", () => {
    this.openOptionDialog({
      title: t("settings.playback.subtitleSize.title", {}, "Subtitle size"),
      options: SUBTITLE_SIZE_OPTIONS,
      selectedId: clampSubtitleSize(PlayerSettingsStore.get().subtitleStyle?.fontSize ?? 120),
      returnFocusKey: "playback:subtitleSize",
      onSelect: (option) => {
        updateSubtitleStyle({ fontSize: clampSubtitleSize(option.id) });
      }
    });
  });
  this.actionMap.set("playback:subtitleOffset", () => {
    this.openOptionDialog({
      title: t("settings.playback.subtitleOffset.title", {}, "Subtitle position"),
      options: SUBTITLE_OFFSET_OPTIONS,
      selectedId: clampSubtitleOffset(PlayerSettingsStore.get().subtitleStyle?.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT),
      returnFocusKey: "playback:subtitleOffset",
      onSelect: (option) => {
        updateSubtitleStyle({ verticalOffset: clampSubtitleOffset(option.id) });
      }
    });
  });
  this.actionMap.set("playback:subtitleStripSdh", () => {
    updateSubtitleStyle({ stripSdh: !PlayerSettingsStore.get().subtitleStyle?.stripSdh });
  });
  this.actionMap.set("playback:subtitleBold", () => {
    updateSubtitleStyle({ bold: !PlayerSettingsStore.get().subtitleStyle?.bold });
  });
  this.actionMap.set("playback:subtitleTextColor", () => {
    this.openOptionDialog({
      title: t("settings.playback.subtitleTextColor.title", {}, "Subtitle color"),
      options: SUBTITLE_TEXT_COLOR_OPTIONS,
      selectedId: normalizeSubtitleStyleHex(PlayerSettingsStore.get().subtitleStyle?.textColor, "#FFFFFF"),
      returnFocusKey: "playback:subtitleTextColor",
      onSelect: (option) => {
        updateSubtitleStyle({ textColor: normalizeSubtitleStyleHex(option.id, "#FFFFFF") });
      }
    });
  });
  this.actionMap.set("playback:subtitleTextOpacity", () => {
    this.openOptionDialog({
      title: t("subtitle_style_text_opacity", {}, "Text Opacity"),
      options: SUBTITLE_TEXT_OPACITY_OPTIONS,
      selectedId: clampSubtitleTextOpacity(PlayerSettingsStore.get().subtitleStyle?.textOpacity),
      returnFocusKey: "playback:subtitleTextOpacity",
      onSelect: (option) => {
        updateSubtitleStyle({ textOpacity: clampSubtitleTextOpacity(option.id) });
      }
    });
  });
  this.actionMap.set("playback:subtitleBackgroundColor", () =>
    this.openOptionDialog({
      title: t("sub_bg_color", {}, "Subtitle background color"),
      options: [
        { id: "#00000000", labelKey: "common_off" },
        { id: "#00000080", label: "50%" },
        { id: "#000000CC", label: "80%" },
        { id: "#000000", label: "100%" }
      ],
      selectedId: PlayerSettingsStore.get().subtitleStyle?.backgroundColor || "#00000000",
      returnFocusKey: "playback:subtitleBackgroundColor",
      onSelect: (option) => updateSubtitleStyle({ backgroundColor: option.id })
    })
  );
  this.actionMap.set("playback:subtitleOutline", () => {
    updateSubtitleStyle({
      outlineEnabled: !PlayerSettingsStore.get().subtitleStyle?.outlineEnabled
    });
  });
  this.actionMap.set("playback:subtitleOutlineColor", () => {
    this.openOptionDialog({
      title: t("settings.playback.subtitleOutlineColor.title", {}, "Outline color"),
      options: SUBTITLE_OUTLINE_COLOR_OPTIONS,
      selectedId: normalizeSubtitleStyleHex(PlayerSettingsStore.get().subtitleStyle?.outlineColor, "#000000"),
      returnFocusKey: "playback:subtitleOutlineColor",
      onSelect: (option) => {
        updateSubtitleStyle({ outlineColor: normalizeSubtitleStyleHex(option.id, "#000000") });
      }
    });
  });
  this.actionMap.set("playback:p2pEnabled", () => {
    if (TizenCapabilities.isP2pUnsupported()) {
      return;
    }
    const current = TorrentSettingsStore.get();
    if (current.p2pEnabled) {
      TorrentSettingsStore.setP2pEnabled(false);
      return;
    }
    this.openOptionDialog({
      title: t("settings_p2p_title"),
      message: t("p2p_consent_body"),
      options: [
        { id: "cancel", labelKey: "p2p_consent_cancel" },
        { id: "enable", labelKey: "p2p_consent_enable" }
      ],
      selectedId: "enable",
      returnFocusKey: "playback:p2pEnabled",
      dialogClassName: "settings-p2p-consent-dialog",
      optionColumns: 2,
      onSelect: (option) => {
        if (String(option.id) === "enable") {
          TorrentSettingsStore.setP2pEnabled(true);
        }
      }
    });
  });
  this.actionMap.set("playback:hideTorrentStats", () => {
    if (TizenCapabilities.isP2pUnsupported()) {
      return;
    }
    TorrentSettingsStore.setHideTorrentStats(!TorrentSettingsStore.get().hideTorrentStats);
  });

  if (model.experience?.mode === "ESSENTIAL") {
    const torrentSettings = model.torrent || TorrentSettingsStore.get();
    const tizenP2pUnsupported = TizenCapabilities.isP2pUnsupported();
    const p2pUnavailableSubtitle = tizenP2pUnsupported
      ? t("settings_p2p_unsupported_subtitle", {}, "Not supported on this TV.")
      : t("settings_p2p_subtitle");
    this.actionMap.set("playback:autoStreamMode", () => {
      const current = String(PlayerSettingsStore.get().streamAutoPlayMode || "MANUAL");
      PlayerSettingsStore.set({
        streamAutoPlayMode: current === "MANUAL" ? "FIRST_STREAM" : "MANUAL"
      });
    });
    const preferredSubtitle = model.player.subtitleStyle?.preferredLanguage || model.player.subtitleLanguage || "off";
    return `
            ${this.renderSectionHeader({
              ...SECTION_META.find((item) => item.id === "playback"),
              labelKey: "essential_playback_header_title",
              subtitleKey: "essential_playback_header_subtitle"
            })}
            <div class="settings-group-heading"><div class="settings-group-title">${escapeHtml(t("essential_playback_basics", {}, "Playback basics"))}</div></div>
            <div class="settings-group-card"><div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "playback:autoStreamMode",
                title: t("essential_stream_selection", {}, "Stream selection"),
                subtitle: t("essential_stream_selection_subtitle", {}, "Choose streams manually or play the first available stream."),
                value:
                  String(model.player.streamAutoPlayMode || "MANUAL") === "FIRST_STREAM"
                    ? t("stream_auto_play_first_stream", {}, "First stream")
                    : t("stream_auto_play_manual_short", {}, "Manual")
              })}
              ${this.renderToggleRow({
                focusKey: "playback:autoplay",
                title: t("essential_autoplay_next_episode", {}, "Autoplay next episode"),
                subtitle: t("essential_autoplay_next_episode_subtitle", {}, "Automatically continue to the next episode."),
                checked: Boolean(model.player.autoplayNextEpisode)
              })}
              ${this.renderToggleRow({
                focusKey: "playback:postPlayRecommendations",
                title: t("autoplay_post_play_recommendations", {}, "Post-play Recommendations"),
                subtitle: t("autoplay_post_play_recommendations_sub", {}, "Show recommendations near the end of movies and series."),
                checked: model.player.postPlayRecommendationsEnabled !== false
              })}
              ${this.renderToggleRow({
                focusKey: "playback:p2pEnabled",
                title: t("essential_p2p_streams", {}, "P2P streams"),
                subtitle: tizenP2pUnsupported
                  ? p2pUnavailableSubtitle
                  : t("essential_p2p_streams_subtitle", {}, "Allow peer-to-peer stream playback."),
                checked: tizenP2pUnsupported ? false : Boolean(torrentSettings.p2pEnabled),
                disabled: tizenP2pUnsupported
              })}
            </div></div>
            <div class="settings-group-heading"><div class="settings-group-title">${escapeHtml(t("essential_subtitles_and_audio", {}, "Subtitles & audio"))}</div></div>
            <div class="settings-group-card"><div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "playback:subtitleLanguage",
                title: t("essential_subtitle_language", {}, "Subtitle language"),
                subtitle: t("essential_subtitle_language_subtitle", {}, "Choose your preferred subtitle language."),
                value: preferredSubtitle
              })}
              ${this.renderToggleRow({
                focusKey: "playback:useForcedSubtitles",
                title: t("sub_use_forced_subtitles", {}, "Use forced subtitles"),
                subtitle: t("sub_use_forced_subtitles_desc", {}, "Prefer forced subtitles when available."),
                checked: Boolean(model.player.subtitleStyle?.useForcedSubtitles)
              })}
              ${this.renderActionRow({
                focusKey: "playback:audioLanguage",
                title: t("essential_audio_language", {}, "Audio language"),
                subtitle: t("essential_audio_language_subtitle", {}, "Choose your preferred audio language."),
                value: String(model.player.preferredAudioLanguage || "")
              })}
            </div></div>`;
  }
}
