/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods49() {
  const {
    I18n,
    SUBTITLE_LANGUAGE_OFF_KEY,
    SUBTITLE_LANGUAGE_UNKNOWN_KEY,
    t,
    subtitleLabel,
    cleanDisplayText,
    stableSubtitleTextKey,
    pushUniqueText,
    getSubtitleCodecDisplayLabel,
    getBitmapSubtitleFormatLabel,
    getTx3gSubtitleSupportMessage,
    getBitmapSubtitleSupportMessage,
    isBitmapSubtitleSupportReason,
    isForcedSubtitleTrack,
    isForcedAddonSubtitle,
    getSubtitleEntryLanguageSource,
    clamp,
    normalizeSubtitleLanguageKey,
    subtitleLanguageLabel
  } = internals;

  return {
    collectSubtitleOptionItems() {
      const cachedOptions = this.trackDialogCache?.subtitleOptions;
      if (cachedOptions) {
        return cachedOptions;
      }
      const builtInEntries = this.getSubtitleEntries("builtIn").filter(
        (entry) => !entry?.disabled || entry?.id === "subtitle-off" || entry?.unsupportedReason
      );
      const addonEntries = this.getSubtitleEntries("addons").filter((entry) => !entry?.disabled);
      const options = [];

      builtInEntries.forEach((entry) => {
        if (!entry) {
          return;
        }
        if (entry.id === "subtitle-off") {
          options.push({
            id: entry.id,
            languageKey: SUBTITLE_LANGUAGE_OFF_KEY,
            languageLabel: t("subtitle_none", {}, "Off"),
            title: entry.label,
            secondary: "",
            selected: Boolean(entry.selected),
            sourceType: "off",
            isForced: false,
            entry
          });
          return;
        }
        const languageSource = getSubtitleEntryLanguageSource(entry);
        const languageKey = normalizeSubtitleLanguageKey(languageSource);
        const languageLabel = subtitleLanguageLabel(languageKey);
        const track = entry.track || entry;
        const isForced = Boolean(entry.isForced) || isForcedSubtitleTrack(track);
        const title =
          cleanDisplayText(track?.name) ||
          cleanDisplayText(track?.label) ||
          cleanDisplayText(track?.title) ||
          entry.label ||
          subtitleLabel(options.length);
        const metaParts = [];
        pushUniqueText(metaParts, getSubtitleCodecDisplayLabel(track));
        if (isForced) {
          pushUniqueText(metaParts, t("sub_forced_lang", {}, "Forced"));
        }
        if (entry.unsupportedReason === "tizen-tx3g") {
          pushUniqueText(metaParts, getTx3gSubtitleSupportMessage("tizen-tx3g"));
        } else if (entry.unsupportedReason === "tx3g-runtime") {
          pushUniqueText(metaParts, getTx3gSubtitleSupportMessage("tx3g-runtime"));
        } else if (entry.unsupportedReason === "tizen-dash-text") {
          pushUniqueText(
            metaParts,
            t("player_subtitle_tizen_dash_unsupported", {}, "Subtitle switching for DASH streams may not be supported by this TV.")
          );
        } else if (isBitmapSubtitleSupportReason(entry.unsupportedReason)) {
          pushUniqueText(metaParts, getBitmapSubtitleFormatLabel(track));
          pushUniqueText(metaParts, getBitmapSubtitleSupportMessage());
        }
        options.push({
          id: entry.id,
          languageKey,
          languageLabel,
          title,
          sourceLabel: t("subtitle_built_in", {}, "Built in"),
          meta: metaParts.join(" • "),
          secondary: metaParts.join(" • "),
          selected: Boolean(entry.selected),
          disabled: Boolean(entry.disabled),
          sourceType: "internal",
          isForced,
          entry
        });
      });

      addonEntries.forEach((entry) => {
        if (!entry) {
          return;
        }
        const languageSource = getSubtitleEntryLanguageSource(entry);
        const languageKey = normalizeSubtitleLanguageKey(languageSource);
        const languageLabel = subtitleLanguageLabel(languageKey);
        const track = entry.track || entry;
        const isForced = isForcedAddonSubtitle(track);
        const trackId = cleanDisplayText(track?.id);
        const normalizedTrackId = normalizeSubtitleLanguageKey(trackId);
        const meta = trackId && normalizedTrackId !== languageKey ? trackId : "";
        const optionId = this.getSubtitleOptionStableId({
          id: entry.id,
          sourceLabel: entry.secondary || track?.addonName,
          sourceType: "addon",
          entry
        });
        options.push({
          id: optionId,
          languageKey,
          languageLabel,
          title: languageLabel,
          sourceLabel: entry.secondary || track?.addonName || t("subtitle_tab_addons", {}, "Addons"),
          meta,
          secondary: meta,
          selected: Boolean(entry.selected),
          sourceType: "addon",
          isForced,
          entry
        });
      });

      this.trackDialogCache.subtitleOptions = options;
      return options;
    },
    getSubtitleOptionStableId(entry) {
      if (!entry || entry.sourceType !== "addon") {
        return String(entry?.id || "subtitle-option");
      }
      const track = entry.entry?.track || entry.entry || {};
      const identity = [track?.addonName || entry.sourceLabel || "addon", track?.id || "", track?.url || "", entry.id || ""].join("\u0001");
      return `addon:${stableSubtitleTextKey(identity)}`;
    },
    getSelectedSubtitleLanguageKey() {
      const selected = this.collectSubtitleOptionItems().find((entry) => entry.selected);
      return selected?.languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
    },
    getSubtitleLanguageRailItems() {
      const cachedLanguageRail = this.trackDialogCache?.subtitleLanguageRail;
      if (cachedLanguageRail) {
        return cachedLanguageRail;
      }
      const options = this.collectSubtitleOptionItems();
      const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
      const groups = new Map();
      options.forEach((option) => {
        if (option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
          return;
        }
        if (!groups.has(option.languageKey)) {
          groups.set(option.languageKey, {
            key: option.languageKey,
            label: option.languageLabel || subtitleLanguageLabel(option.languageKey),
            selected: false,
            count: 0,
            hasInternalTracks: false
          });
        }
        const group = groups.get(option.languageKey);
        group.count += 1;
        group.selected = group.selected || Boolean(option.selected);
        group.hasInternalTracks = group.hasInternalTracks || option.sourceType === "internal";
      });
      groups.set(SUBTITLE_LANGUAGE_OFF_KEY, {
        key: SUBTITLE_LANGUAGE_OFF_KEY,
        label: t("subtitle_none", {}, "Off"),
        selected: selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY,
        count: 0
      });
      const preferredTargets = this.getStartupPreferredSubtitleLanguageTargets();
      const preferredRankCache = new Map();
      const getPreferredRank = (entry) => {
        const key = String(entry?.key || "");
        if (!key || key === SUBTITLE_LANGUAGE_OFF_KEY) {
          return Number.MAX_SAFE_INTEGER;
        }
        if (preferredRankCache.has(key)) {
          return preferredRankCache.get(key);
        }
        const keyBase = key.split("-")[0];
        const rank = preferredTargets.findIndex((target) => {
          const targetKey = String(target || "");
          const targetBase = targetKey.split("-")[0];
          return key === targetKey || (keyBase && targetBase && keyBase === targetBase);
        });
        const resolvedRank = rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
        preferredRankCache.set(key, resolvedRank);
        return resolvedRank;
      };
      const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
      const matchesPreferredLanguage = (languageKey) =>
        preferredTargets.some((target) => languageKey === target || (languageKey && target.startsWith(`${languageKey}-`)));
      const showOnlyPreferredLanguages = Boolean(this.subtitleStyleSettings?.showOnlyPreferredLanguages);
      const values = Array.from(groups.values())
        .filter(
          (entry) =>
            !showOnlyPreferredLanguages ||
            entry.key === SUBTITLE_LANGUAGE_OFF_KEY ||
            entry.key === selectedLanguageKey ||
            (entry.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY && entry.hasInternalTracks) ||
            matchesPreferredLanguage(entry.key)
        )
        .sort((left, right) => {
          if (left.key === right.key) return 0;
          if (left.key === SUBTITLE_LANGUAGE_OFF_KEY) return -1;
          if (right.key === SUBTITLE_LANGUAGE_OFF_KEY) return 1;
          // Sink the "Unknown" group below the real languages instead of letting
          // its label sort it into the middle of the alphabetical list.
          const leftUnknown = left.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
          const rightUnknown = right.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
          if (leftUnknown !== rightUnknown) {
            return leftUnknown ? 1 : -1;
          }
          const preferredDelta = getPreferredRank(left) - getPreferredRank(right);
          if (preferredDelta !== 0) {
            return preferredDelta;
          }
          const labelDelta = String(left.label || "").localeCompare(String(right.label || ""), locale, { sensitivity: "base" });
          if (labelDelta !== 0) {
            return labelDelta;
          }
          return String(left.key || "").localeCompare(String(right.key || ""), "en", {
            sensitivity: "base"
          });
        });
      this.trackDialogCache.subtitleLanguageRail = values;
      return values;
    },
    syncSubtitleOptionIndexForFocusedLanguage() {
      const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
      const options = this.getSubtitleOptionsForLanguage(selectedLanguageKey);
      const rememberedOptionId = this.subtitleOptionFocusMemory?.get(selectedLanguageKey);
      const rememberedIndex = options.findIndex((item) => item.id === rememberedOptionId);
      const selectedIndex = options.findIndex((item) => item.selected);
      this.subtitleOptionRailIndex = Math.max(0, rememberedIndex >= 0 ? rememberedIndex : selectedIndex >= 0 ? selectedIndex : 0);
      this.rememberSubtitleOptionFocus(selectedLanguageKey, options, this.subtitleOptionRailIndex);
    },
    rememberSubtitleOptionFocus(languageKey, options = [], index = 0) {
      const option = options[clamp(Number(index || 0), 0, Math.max(0, options.length - 1))];
      if (!option?.id || !languageKey || languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
        return;
      }
      if (!(this.subtitleOptionFocusMemory instanceof Map)) {
        this.subtitleOptionFocusMemory = new Map();
      }
      this.subtitleOptionFocusMemory.set(languageKey, option.id);
    },
    selectSubtitleOption(option, { focusOptions = true } = {}) {
      if (!option?.entry || option.disabled || !option.languageKey || option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
        return false;
      }
      const languages = this.getSubtitleLanguageRailItems();
      const languageIndex = languages.findIndex((item) => item.key === option.languageKey);
      if (languageIndex >= 0) {
        this.subtitleLanguageRailIndex = languageIndex;
        this.subtitleFocusedLanguageKey = option.languageKey;
      }

      const options = this.getSubtitleOptionsForLanguage(option.languageKey);
      const optionIndex = options.findIndex((item) => item.id === option.id);
      this.subtitleOptionRailIndex = Math.max(0, optionIndex >= 0 ? optionIndex : 0);
      this.rememberSubtitleOptionFocus(option.languageKey, options, this.subtitleOptionRailIndex);
      if (focusOptions) {
        this.subtitleFocusedRail = "options";
      }

      this.applySubtitleEntry(option.entry);
      if (!this.startupSubtitlePreferenceApplying) {
        this.rememberSubtitleTrackSelection(option);
      }
      return true;
    },
    selectFirstSubtitleOptionForLanguage(languageKey, { focusOptions = true } = {}) {
      if (!languageKey || languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
        return false;
      }
      const options = this.getSubtitleOptionsForLanguage(languageKey);
      if (!options.length) {
        return false;
      }
      const rememberedOptionId = this.subtitleOptionFocusMemory?.get(languageKey);
      const targetOption =
        options.find((option) => option.selected && !option.disabled) ||
        options.find((option) => option.id === rememberedOptionId && !option.disabled) ||
        options.find((option) => !option?.disabled);
      return this.selectSubtitleOption(targetOption, { focusOptions });
    }
  };
}
