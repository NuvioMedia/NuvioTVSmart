/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import { AUTO_SYNC_TOLERANCE_OPTIONS_MS } from "../../../core/player/subtitleAutoSyncEngine.js";
import { normalizeHdrBrightness } from "../../../core/player/hdrSubtitleStyle.js";
import { DEFAULT_SUBTITLE_STYLE } from "../../../data/local/playerSettingsStore.js";
import { normalizeSubtitleAppearance } from "../../../core/player/subtitleAppearance.js";
import {
  SUBTITLE_APPEARANCE_LIMITS,
  SUBTITLE_BACKGROUND_COLOR_PRESETS,
  SUBTITLE_OFFSET_RANGE,
  SUBTITLE_OPACITY_RANGE,
  SUBTITLE_SETTINGS_OUTLINE_COLORS,
  SUBTITLE_SETTINGS_TEXT_COLORS,
  SUBTITLE_SIZE_RANGE,
  backgroundColorFor,
  buildSubtitleAppearancePreviewHtml,
  joinBackgroundColor,
  rangeValues,
  splitBackgroundColor,
  subtitleAppearanceResetValues
} from "./subtitleAppearanceEditor.js";

export function registerPlaybackActionsPart02(model) {
  const {
    PlayerSettingsStore,
    SUBTITLE_VERTICAL_OFFSET_DEFAULT,
    TorrentSettingsStore,
    TORRENT_CACHE_SIZES,
    TORRENT_PROFILES,
    P2pCacheService,
    TizenCapabilities,
    PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
    PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
    SECONDARY_PLAYBACK_LANGUAGE_OPTIONS,
    SUBTITLE_SIZE_OPTIONS,
    SUBTITLE_OFFSET_OPTIONS,
    SUBTITLE_TEXT_COLOR_OPTIONS,
    SUBTITLE_TEXT_OPACITY_OPTIONS,
    SUBTITLE_OUTLINE_COLOR_OPTIONS,
    SUBTITLE_HDR_BRIGHTNESS_OPTIONS,
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
  this.actionMap.set("playback:subtitleAutoSync", () => {
    const currentSettings = PlayerSettingsStore.get();
    updateSubtitleStyle({
      autoSyncEnabled: !currentSettings.subtitleStyle?.autoSyncEnabled
    });
  });
  this.actionMap.set("playback:subtitleAutoSyncTolerance", () => {
    const current = Math.trunc(Number(PlayerSettingsStore.get().subtitleStyle?.autoSyncToleranceMs || 0));
    this.openOptionDialog({
      title: t("autosync_tolerance_title", {}, "Auto Sync Tolerance"),
      options: AUTO_SYNC_TOLERANCE_OPTIONS_MS.map((value) => ({
        id: String(value),
        label: value > 0 ? t("autosync_tolerance_value", [value], `${value} ms`) : t("autosync_tolerance_off", {}, "Off")
      })),
      selectedId: String(current),
      returnFocusKey: "playback:subtitleAutoSyncTolerance",
      onSelect: (option) => {
        updateSubtitleStyle({ autoSyncToleranceMs: Math.trunc(Number(option.id)) || 0, autoSyncToleranceChosen: true });
      }
    });
  });
  this.actionMap.set("playback:subtitleAutoSyncThorough", () => {
    updateSubtitleStyle({
      autoSyncThorough: PlayerSettingsStore.get().subtitleStyle?.autoSyncThorough === false
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
  // Android SubtitleAppearanceDialog: one editor for font, colors, background and
  // shadow, with a live preview beside the controls.
  const openSubtitleAppearanceDialog = (focusRowId = "font") => {
    const style = PlayerSettingsStore.get().subtitleStyle || {};
    const appearance = normalizeSubtitleAppearance(style);
    const background = splitBackgroundColor(style.backgroundColor);
    const onOff = (on) => (on ? t("subtitle_on", {}, "On") : t("subtitle_off", {}, "Off"));
    const fontLabel = (id) =>
      id === "serif"
        ? t("sub_font_serif", {}, "Serif")
        : id === "mono"
          ? t("sub_font_mono", {}, "Monospace")
          : t("sub_font_default", {}, "Default");
    const rows = [
      { id: "font", label: t("sub_font", {}, "Font"), value: fontLabel(appearance.fontId) },
      { id: "size", label: t("sub_size", {}, "Size"), value: `${clampSubtitleSize(style.fontSize ?? 120)}%` },
      { id: "bold", label: t("sub_bold", {}, "Bold"), value: onOff(style.bold) },
      { id: "textColor", label: t("sub_text_color", {}, "Text Color"), swatch: style.textColor || "#FFFFFF" },
      {
        id: "textOpacity",
        label: t("subtitle_style_text_opacity", {}, "Text Opacity"),
        value: `${clampSubtitleTextOpacity(style.textOpacity)}%`
      },
      {
        id: "backgroundColor",
        label: t("sub_bg_color", {}, "Background Color"),
        swatch: background.opacity > 0 ? background.color : null,
        value: background.opacity > 0 ? "" : onOff(false)
      },
      { id: "backgroundOpacity", label: t("sub_bg_opacity", {}, "Background Opacity"), value: `${background.opacity}%` },
      { id: "backgroundRadius", label: t("sub_bg_roundness", {}, "Corner Roundness"), value: String(appearance.backgroundRadius) },
      { id: "outline", label: t("sub_outline", {}, "Outline"), value: onOff(style.outlineEnabled) },
      ...(style.outlineEnabled
        ? [
            { id: "outlineColor", label: t("sub_outline_color", {}, "Outline Color"), swatch: style.outlineColor || "#000000" },
            { id: "outlineSize", label: t("sub_outline_width", {}, "Outline Width"), value: String(appearance.outlineSize) }
          ]
        : []),
      { id: "shadow", label: t("sub_shadow", {}, "Drop Shadow"), value: onOff(appearance.shadowEnabled) },
      ...(appearance.shadowEnabled
        ? [
            { id: "shadowOpacity", label: t("sub_shadow_opacity", {}, "Shadow Opacity"), value: `${appearance.shadowOpacity}%` },
            { id: "shadowSize", label: t("sub_shadow_size", {}, "Shadow Size"), value: String(appearance.shadowSize) }
          ]
        : []),
      {
        id: "verticalOffset",
        label: t("sub_vertical_offset", {}, "Vertical Offset"),
        value: `${clampSubtitleOffset(style.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT)}%`
      },
      { id: "reset", label: t("sub_reset_appearance", {}, "Reset Appearance") }
    ];
    const reopen = (rowId) => {
      openSubtitleAppearanceDialog(rowId);
      return false;
    };
    const choose = (rowId, title, options, selectedId, apply) => {
      this.openOptionDialog({
        title,
        options,
        selectedId,
        returnFocusKey: "playback:subtitleAppearance",
        optionRenderer: "single-choice",
        onSelect: (option) => {
          apply(option.id);
          return reopen(rowId);
        },
        // Back from a value list returns to the editor, as on Android.
        onClose: () => openSubtitleAppearanceDialog(rowId)
      });
      return false;
    };
    const numberOptions = (range, format = (value) => `${value}%`) =>
      rangeValues(range).map((value) => ({ id: value, label: format(value) }));
    const colorOptions = (colors) => colors.map((color) => ({ id: color, label: color, swatch: color }));
    this.openOptionDialog({
      title: t("sub_appearance", {}, "Subtitle Appearance"),
      messageHtml: buildSubtitleAppearancePreviewHtml(style, { t, escapeHtml }),
      options: rows,
      selectedId: null,
      returnFocusKey: "playback:subtitleAppearance",
      dialogClassName: "settings-subtitle-appearance-dialog",
      onSelect: (option) => {
        const current = PlayerSettingsStore.get().subtitleStyle || {};
        switch (option.id) {
          case "font":
            return choose(
              "font",
              t("sub_font", {}, "Font"),
              ["default", "serif", "mono"].map((id) => ({ id, label: fontLabel(id) })),
              normalizeSubtitleAppearance(current).fontId,
              (fontId) => updateSubtitleStyle({ fontId })
            );
          case "size":
            return choose(
              "size",
              t("sub_size", {}, "Size"),
              numberOptions(SUBTITLE_SIZE_RANGE),
              clampSubtitleSize(current.fontSize ?? 120),
              (value) => updateSubtitleStyle({ fontSize: clampSubtitleSize(value) })
            );
          case "bold":
            updateSubtitleStyle({ bold: !current.bold });
            return reopen("bold");
          case "textColor":
            return choose(
              "textColor",
              t("sub_text_color", {}, "Text Color"),
              colorOptions(SUBTITLE_SETTINGS_TEXT_COLORS),
              normalizeSubtitleStyleHex(current.textColor, "#FFFFFF"),
              (value) => updateSubtitleStyle({ textColor: value })
            );
          case "textOpacity":
            return choose(
              "textOpacity",
              t("subtitle_style_text_opacity", {}, "Text Opacity"),
              numberOptions(SUBTITLE_OPACITY_RANGE),
              clampSubtitleTextOpacity(current.textOpacity),
              (value) => updateSubtitleStyle({ textOpacity: clampSubtitleTextOpacity(value) })
            );
          case "backgroundColor":
            return choose(
              "backgroundColor",
              t("sub_bg_color", {}, "Background Color"),
              colorOptions(SUBTITLE_BACKGROUND_COLOR_PRESETS),
              splitBackgroundColor(current.backgroundColor).opacity > 0 ? splitBackgroundColor(current.backgroundColor).color : null,
              (value) => updateSubtitleStyle({ backgroundColor: backgroundColorFor(value, current.backgroundColor) })
            );
          case "backgroundOpacity":
            return choose(
              "backgroundOpacity",
              t("sub_bg_opacity", {}, "Background Opacity"),
              numberOptions(SUBTITLE_OPACITY_RANGE),
              splitBackgroundColor(current.backgroundColor).opacity,
              (value) =>
                updateSubtitleStyle({
                  backgroundColor: joinBackgroundColor(splitBackgroundColor(current.backgroundColor).color, value)
                })
            );
          case "backgroundRadius":
            // Android disables roundness while the background is fully transparent.
            if (splitBackgroundColor(current.backgroundColor).opacity <= 0) {
              return reopen("backgroundRadius");
            }
            return choose(
              "backgroundRadius",
              t("sub_bg_roundness", {}, "Corner Roundness"),
              numberOptions({ min: 0, max: SUBTITLE_APPEARANCE_LIMITS.radiusMax, step: SUBTITLE_APPEARANCE_LIMITS.radiusStep }, String),
              normalizeSubtitleAppearance(current).backgroundRadius,
              (value) => updateSubtitleStyle({ backgroundRadius: Number(value) })
            );
          case "outline":
            updateSubtitleStyle({ outlineEnabled: !current.outlineEnabled });
            return reopen("outline");
          case "outlineColor":
            return choose(
              "outlineColor",
              t("sub_outline_color", {}, "Outline Color"),
              colorOptions(SUBTITLE_SETTINGS_OUTLINE_COLORS),
              normalizeSubtitleStyleHex(current.outlineColor, "#000000"),
              (value) => updateSubtitleStyle({ outlineColor: value })
            );
          case "outlineSize":
            return choose(
              "outlineSize",
              t("sub_outline_width", {}, "Outline Width"),
              numberOptions(
                { min: SUBTITLE_APPEARANCE_LIMITS.outlineSizeMin, max: SUBTITLE_APPEARANCE_LIMITS.outlineSizeMax, step: 1 },
                String
              ),
              normalizeSubtitleAppearance(current).outlineSize,
              (value) => updateSubtitleStyle({ outlineSize: Number(value) })
            );
          case "shadow":
            updateSubtitleStyle({ shadowEnabled: !normalizeSubtitleAppearance(current).shadowEnabled });
            return reopen("shadow");
          case "shadowOpacity":
            return choose(
              "shadowOpacity",
              t("sub_shadow_opacity", {}, "Shadow Opacity"),
              numberOptions(SUBTITLE_OPACITY_RANGE),
              normalizeSubtitleAppearance(current).shadowOpacity,
              (value) => updateSubtitleStyle({ shadowOpacity: Number(value) })
            );
          case "shadowSize":
            return choose(
              "shadowSize",
              t("sub_shadow_size", {}, "Shadow Size"),
              numberOptions(
                { min: SUBTITLE_APPEARANCE_LIMITS.shadowSizeMin, max: SUBTITLE_APPEARANCE_LIMITS.shadowSizeMax, step: 1 },
                String
              ),
              normalizeSubtitleAppearance(current).shadowSize,
              (value) => updateSubtitleStyle({ shadowSize: Number(value) })
            );
          case "verticalOffset":
            return choose(
              "verticalOffset",
              t("sub_vertical_offset", {}, "Vertical Offset"),
              numberOptions(SUBTITLE_OFFSET_RANGE),
              clampSubtitleOffset(current.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT),
              (value) => updateSubtitleStyle({ verticalOffset: clampSubtitleOffset(value) })
            );
          case "reset":
            updateSubtitleStyle(subtitleAppearanceResetValues(DEFAULT_SUBTITLE_STYLE));
            return reopen("reset");
          default:
            return undefined;
        }
      }
    });
    const focusIndex = rows.findIndex((row) => row.id === focusRowId);
    this.dialogFocusIndex = focusIndex >= 0 ? focusIndex : 0;
  };
  this.actionMap.set("playback:subtitleAppearance", () => openSubtitleAppearanceDialog("font"));
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
  this.actionMap.set("playback:subtitleHdrStyle", () => {
    updateSubtitleStyle({
      hdrStyleEnabled: PlayerSettingsStore.get().subtitleStyle?.hdrStyleEnabled !== true
    });
  });
  this.actionMap.set("playback:subtitleHdrTextColor", () => {
    this.openOptionDialog({
      title: t("sub_hdr_text_color", {}, "HDR Text Color"),
      options: SUBTITLE_TEXT_COLOR_OPTIONS,
      selectedId: normalizeSubtitleStyleHex(PlayerSettingsStore.get().subtitleStyle?.hdrTextColor, "#FFFFFF"),
      returnFocusKey: "playback:subtitleHdrTextColor",
      onSelect: (option) => {
        updateSubtitleStyle({ hdrTextColor: normalizeSubtitleStyleHex(option.id, "#FFFFFF") });
      }
    });
  });
  this.actionMap.set("playback:subtitleHdrBrightness", () => {
    this.openOptionDialog({
      title: t("sub_hdr_brightness", {}, "HDR Brightness"),
      options: SUBTITLE_HDR_BRIGHTNESS_OPTIONS,
      selectedId: normalizeHdrBrightness(PlayerSettingsStore.get().subtitleStyle?.hdrBrightness),
      returnFocusKey: "playback:subtitleHdrBrightness",
      onSelect: (option) => {
        updateSubtitleStyle({ hdrBrightness: normalizeHdrBrightness(option.id) });
      }
    });
  });
  this.actionMap.set("playback:subtitleHdrDimPlayerControls", () => {
    updateSubtitleStyle({
      hdrDimPlayerControls: PlayerSettingsStore.get().subtitleStyle?.hdrDimPlayerControls !== true
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
  this.actionMap.set("playback:torrentProfile", () => {
    if (TizenCapabilities.isP2pUnsupported()) {
      return;
    }
    const current = String(TorrentSettingsStore.get().torrentProfile || "BALANCED");
    this.openOptionDialog({
      title: t("settings_p2p_profile_title", {}, "Torrent profile"),
      options: TORRENT_PROFILES.map((profile) => ({
        id: profile,
        label: t(`settings_p2p_profile_${profile.toLowerCase()}`, {}, profile),
        description: t(`settings_p2p_profile_${profile.toLowerCase()}_description`, {}, "")
      })),
      selectedId: current,
      returnFocusKey: "playback:torrentProfile",
      onSelect: (option) => TorrentSettingsStore.setTorrentProfile(option.id)
    });
  });
  this.actionMap.set("playback:torrentCacheSize", () => {
    if (TizenCapabilities.isP2pUnsupported()) {
      return;
    }
    const current = String(TorrentSettingsStore.get().torrentCacheSize || "GB_2");
    this.openOptionDialog({
      title: t("settings_p2p_cache_size_title", {}, "Torrent cache size"),
      subtitle: t("settings_p2p_cache_size_description", {}, "Downloaded torrent data kept on this device for faster replays"),
      options: Object.keys(TORRENT_CACHE_SIZES).map((size) => ({
        id: size,
        label: t(size === "NONE" ? "settings_p2p_cache_none" : `settings_p2p_cache_${size.replace("GB_", "")}_gb`, {}, size)
      })),
      selectedId: current,
      returnFocusKey: "playback:torrentCacheSize",
      onSelect: (option) => {
        TorrentSettingsStore.setTorrentCacheSize(option.id);
        if (P2pCacheService.supportsCacheControls()) {
          void P2pCacheService.setCacheSize(TORRENT_CACHE_SIZES[option.id]).catch((error) => {
            console.warn("Could not apply torrent cache size", error);
          });
        }
      }
    });
  });
  this.actionMap.set("playback:clearTorrentCache", () => this.clearP2pCache());

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
