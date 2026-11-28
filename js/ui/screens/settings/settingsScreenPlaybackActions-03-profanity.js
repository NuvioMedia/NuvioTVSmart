/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import {
  PROFANITY_FILTER_ACTIONS,
  PROFANITY_FILTER_MODES,
  PROFANITY_PADDING_OPTIONS_MS,
  ProfanityFilterStore
} from "../../../data/local/profanityFilterStore.js";
import {
  PROFANITY_CATEGORIES,
  PROFANITY_MASK_STYLES,
  PROFANITY_MUTE_PRECISIONS,
  PROFANITY_RATING_OPTIONS,
  normalizeWordList
} from "../../../core/player/profanityFilter.js";
import {
  profanityActionLabel,
  profanityCategoryLabel,
  profanityMaskStyleLabel,
  profanityModeLabel,
  profanityPrecisionLabel
} from "./settingsScreenPlaybackMarkup-07-profanity.js";

const CLEAR_ALL_ID = "__clear_all__";

export function registerPlaybackActionsPart03(model) {
  const { t } = internals;

  this.actionMap.set("playback:toggle:profanity", () => {
    this.toggleExpandedSection("playback", "profanity");
  });
  this.actionMap.set("playback:profanityEnabled", () => {
    ProfanityFilterStore.set({ enabled: !ProfanityFilterStore.get().enabled });
  });
  this.actionMap.set("playback:profanityMode", () => {
    this.openOptionDialog({
      title: t("profanity_mode_title", {}, "Filter titles"),
      options: PROFANITY_FILTER_MODES.map((mode) => ({ id: mode, label: profanityModeLabel(t, mode) })),
      selectedId: ProfanityFilterStore.get().mode,
      returnFocusKey: "playback:profanityMode",
      onSelect: (option) => {
        ProfanityFilterStore.set({ mode: option.id });
      }
    });
  });
  this.actionMap.set("playback:profanityRatings", () => {
    this.openMultiChoiceDialog({
      title: t("profanity_ratings_title", {}, "Mature ratings"),
      options: PROFANITY_RATING_OPTIONS.map((rating) => ({ id: rating, label: rating })),
      selectedIds: ProfanityFilterStore.get().ratings,
      returnFocusKey: "playback:profanityRatings",
      onToggle: (selectedIds) => {
        ProfanityFilterStore.set({ ratings: selectedIds });
      }
    });
  });
  this.actionMap.set("playback:profanityTitles", () => {
    const overrides = ProfanityFilterStore.get().titleOverrides || {};
    const entries = Object.keys(overrides)
      .map((key) => ({ key, ...overrides[key] }))
      .sort((left, right) => Number(right.at || 0) - Number(left.at || 0));
    if (!entries.length) {
      return;
    }
    this.openOptionDialog({
      title: t("profanity_titles_title", {}, "Per-title choices"),
      message: t("profanity_titles_dialog_message", {}, "Select a title to go back to the automatic choice."),
      options: [
        ...entries.map((entry) => ({
          id: entry.key,
          label: `${entry.name || entry.key} · ${entry.enabled ? t("profanity_on", {}, "On") : t("profanity_off", {}, "Off")}`
        })),
        { id: CLEAR_ALL_ID, label: t("profanity_titles_clear_all", {}, "Reset all titles"), destructive: true }
      ],
      selectedId: null,
      returnFocusKey: "playback:profanityTitles",
      onSelect: (option) => {
        if (option.id === CLEAR_ALL_ID) {
          ProfanityFilterStore.clearTitleOverrides();
          return true;
        }
        ProfanityFilterStore.setTitleOverride(option.id, null);
        return true;
      }
    });
  });
  this.actionMap.set("playback:profanityAction", () => {
    this.openOptionDialog({
      title: t("profanity_action_title", {}, "When a word is found"),
      options: PROFANITY_FILTER_ACTIONS.map((action) => ({ id: action, label: profanityActionLabel(t, action) })),
      selectedId: ProfanityFilterStore.get().action,
      returnFocusKey: "playback:profanityAction",
      onSelect: (option) => {
        ProfanityFilterStore.set({ action: option.id });
      }
    });
  });
  this.actionMap.set("playback:profanityMaskStyle", () => {
    this.openOptionDialog({
      title: t("profanity_style_title", {}, "Subtitle censoring"),
      options: PROFANITY_MASK_STYLES.map((style) => ({ id: style, label: profanityMaskStyleLabel(t, style) })),
      selectedId: ProfanityFilterStore.get().maskStyle,
      returnFocusKey: "playback:profanityMaskStyle",
      onSelect: (option) => {
        ProfanityFilterStore.set({ maskStyle: option.id });
      }
    });
  });
  this.actionMap.set("playback:profanityFirstLetter", () => {
    ProfanityFilterStore.set({ showFirstLetter: !ProfanityFilterStore.get().showFirstLetter });
  });
  this.actionMap.set("playback:profanityCategories", () => {
    this.openMultiChoiceDialog({
      title: t("profanity_categories_title", {}, "Word lists"),
      options: PROFANITY_CATEGORIES.map((category) => ({ id: category, label: profanityCategoryLabel(t, category) })),
      selectedIds: ProfanityFilterStore.get().categories,
      returnFocusKey: "playback:profanityCategories",
      onToggle: (selectedIds) => {
        ProfanityFilterStore.set({ categories: selectedIds });
      }
    });
  });
  const openWordListDialog = (focusKey, field, title, placeholder) => {
    this.openTextDialog({
      title,
      value: ProfanityFilterStore.get()[field].join(", "),
      multiline: true,
      placeholder,
      returnFocusKey: focusKey,
      clearLabel: t("common.clear", {}, "Clear"),
      onClear: () => {
        ProfanityFilterStore.set({ [field]: [] });
        return true;
      },
      onSubmit: (value) => {
        ProfanityFilterStore.set({ [field]: normalizeWordList(value) });
        return true;
      }
    });
  };
  this.actionMap.set("playback:profanityCustomWords", () => {
    openWordListDialog(
      "playback:profanityCustomWords",
      "customWords",
      t("profanity_custom_title", {}, "Extra words"),
      t("profanity_custom_placeholder", {}, "Separate words with commas, e.g. frak*, smeg")
    );
  });
  this.actionMap.set("playback:profanityAllowedWords", () => {
    openWordListDialog(
      "playback:profanityAllowedWords",
      "allowedWords",
      t("profanity_allowed_title", {}, "Allowed words"),
      t("profanity_allowed_placeholder", {}, "Separate words with commas, e.g. hell, dick")
    );
  });
  this.actionMap.set("playback:profanityPrecision", () => {
    this.openOptionDialog({
      title: t("profanity_precision_title", {}, "Mute length"),
      options: PROFANITY_MUTE_PRECISIONS.map((precision) => ({ id: precision, label: profanityPrecisionLabel(t, precision) })),
      selectedId: ProfanityFilterStore.get().mutePrecision,
      returnFocusKey: "playback:profanityPrecision",
      onSelect: (option) => {
        ProfanityFilterStore.set({ mutePrecision: option.id });
      }
    });
  });
  this.actionMap.set("playback:profanityPadding", () => {
    this.openOptionDialog({
      title: t("profanity_padding_title", {}, "Extra mute time"),
      options: PROFANITY_PADDING_OPTIONS_MS.map((value) => ({
        id: String(value),
        label: t("profanity_padding_value", [value], `${value} ms`)
      })),
      selectedId: String(ProfanityFilterStore.get().mutePaddingMs),
      returnFocusKey: "playback:profanityPadding",
      onSelect: (option) => {
        ProfanityFilterStore.set({ mutePaddingMs: Math.trunc(Number(option.id)) || 0 });
      }
    });
  });
  this.actionMap.set("playback:profanityWithoutSubtitles", () => {
    ProfanityFilterStore.set({ muteWithoutSubtitles: !ProfanityFilterStore.get().muteWithoutSubtitles });
  });
  this.actionMap.set("playback:profanityIndicator", () => {
    ProfanityFilterStore.set({ showIndicator: !ProfanityFilterStore.get().showIndicator });
  });
}
