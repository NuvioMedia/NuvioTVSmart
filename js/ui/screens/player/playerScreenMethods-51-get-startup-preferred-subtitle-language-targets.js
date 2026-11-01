/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods51() {
  const {
    hasOnlyImplicitStartupAudioOptions,
    PlayerSettingsStore,
    I18n,
    Environment,
    PlayerController,
    SUBTITLE_LANGUAGE_OFF_KEY,
    cleanDisplayText,
    normalizeComparableText,
    normalizeTrackLanguageCode,
    inferAudioTrackLanguageKey,
    getAudioTrackLanguageLabel,
    getTrackLanguageLabel,
    normalizeSubtitleLanguageKey,
    extractSubtitleLanguageSetting
  } = internals;

  return {
    getStartupPreferredSubtitleLanguageTargets() {
      const settings = PlayerSettingsStore.get();
      if (!settings.subtitlesEnabled) {
        return [];
      }

      const values = [
        settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off",
        settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage || "off"
      ];

      const targets = values
        .map((value) => {
          const configured = String(value || "off")
            .trim()
            .toLowerCase();
          if (!configured || configured === "off" || configured === "none" || configured === "forced") {
            return "";
          }
          if (configured === "system") {
            const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : globalThis.navigator?.language || "";
            return normalizeSubtitleLanguageKey(normalizeTrackLanguageCode(locale) || "");
          }
          return normalizeSubtitleLanguageKey(configured);
        })
        .filter(Boolean);

      return Array.from(new Set(targets));
    },
    getStartupAutoSelectSubtitleLanguageTargets() {
      // Android treats a primary "None" as no normal auto-selection target;
      // the secondary language remains useful for filtering/loading only.
      if (this.getStartupPreferredSubtitleLanguageKey() === SUBTITLE_LANGUAGE_OFF_KEY) {
        return [];
      }
      return this.getStartupPreferredSubtitleLanguageTargets();
    },
    shouldUseStartupForcedSubtitles(settings = PlayerSettingsStore.get()) {
      const preferred = extractSubtitleLanguageSetting(settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off")
        .trim()
        .toLowerCase();
      const secondary = extractSubtitleLanguageSetting(
        settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage || "off"
      )
        .trim()
        .toLowerCase();
      return (
        Boolean(settings.subtitleStyle?.useForcedSubtitles || settings.useForcedSubtitles) ||
        preferred === "forced" ||
        secondary === "forced"
      );
    },
    getStartupForcedSubtitleLanguageTarget() {
      const settings = PlayerSettingsStore.get();
      if (!settings.subtitlesEnabled || !this.shouldUseStartupForcedSubtitles(settings)) {
        return null;
      }

      const explicitTargets = this.getStartupAutoSelectSubtitleLanguageTargets();
      const selectedAudioOption = this.collectAudioOptionItems().find((entry) => entry.selected && entry.languageKey);
      const primaryTarget = explicitTargets[0] || null;
      if (primaryTarget && selectedAudioOption && this.matchesStartupAudioTargetForForced(selectedAudioOption, primaryTarget)) {
        return primaryTarget;
      }

      const preferredAudioTargets = this.getStartupPreferredAudioLanguageTargets();
      if (
        !primaryTarget &&
        selectedAudioOption &&
        preferredAudioTargets.some((target) => this.matchesStartupAudioTarget(selectedAudioOption, target))
      ) {
        return selectedAudioOption.languageKey;
      }

      return null;
    },
    getStartupSubtitlePreferenceMode() {
      const settings = PlayerSettingsStore.get();
      if (!settings.subtitlesEnabled) {
        return "off";
      }
      if (this.shouldUseStartupForcedSubtitles(settings)) {
        return "audio-forced";
      }
      const explicitTargets = this.getStartupAutoSelectSubtitleLanguageTargets();
      if (explicitTargets.length) {
        return "language";
      }
      return "off";
    },
    getStartupPreferredAudioLanguageTargets() {
      const settings = PlayerSettingsStore.get();
      const primary = String(settings.preferredAudioLanguage || "system")
        .trim()
        .toLowerCase();
      const secondary = String(settings.secondaryPreferredAudioLanguage || "none")
        .trim()
        .toLowerCase();
      const originalLanguage = normalizeTrackLanguageCode(this.contentLanguage);
      const systemLanguage = this.getStartupSystemAudioLanguageTarget();
      const resolve = (configured, { primaryPreference = false } = {}) => {
        if (!configured || ["default", "off", "none", "forced"].includes(configured)) {
          return "";
        }
        if (configured === "system" || configured === "device") {
          return primaryPreference ? systemLanguage : "";
        }
        if (configured === "original") {
          return originalLanguage || (primaryPreference ? systemLanguage : "");
        }
        return normalizeTrackLanguageCode(configured);
      };

      return Array.from(new Set([resolve(primary, { primaryPreference: true }), resolve(secondary)].filter(Boolean)));
    },
    getStartupSystemAudioLanguageTarget() {
      const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : globalThis.navigator?.language || "";
      return normalizeTrackLanguageCode(locale);
    },
    collectAudioOptionItems() {
      return this.getAudioEntries().map((entry, index) => {
        const track = entry?.track || {};
        const languageKey = inferAudioTrackLanguageKey(track, entry);
        return {
          id: entry?.id || `audio-option-${index}`,
          label: cleanDisplayText(entry?.label || ""),
          secondary: cleanDisplayText(entry?.secondary || ""),
          selected: Boolean(entry?.selected),
          supported: entry?.supported !== false || Boolean(entry?.canTryAudioConversion),
          requiresAudioConversion: Boolean(entry?.canTryAudioConversion),
          languageKey,
          languageLabel: getAudioTrackLanguageLabel(track, entry),
          entry,
          entryIndex: index
        };
      });
    },
    matchesStartupAudioTarget(option, target) {
      if (!option || !target) {
        return false;
      }
      if (option.languageKey === target) {
        return true;
      }
      const targetBase = String(target).split("-")[0];
      const optionBase = String(option.languageKey || "").split("-")[0];
      if (targetBase && optionBase && targetBase === optionBase) {
        return true;
      }
      const targetLabel = normalizeComparableText(getTrackLanguageLabel({ language: target }) || "");
      if (!targetLabel) {
        return false;
      }
      return [option.languageLabel, option.label, option.secondary]
        .map((value) => normalizeComparableText(value))
        .some((value) => value === targetLabel);
    },
    matchesStartupAudioTargetForForced(option, target) {
      if (!option || !target) {
        return false;
      }
      const normalizedTarget = normalizeTrackLanguageCode(target) || String(target).trim().toLowerCase();
      const optionLanguage =
        normalizeTrackLanguageCode(option.languageKey) ||
        String(option.languageKey || "")
          .trim()
          .toLowerCase();
      if (optionLanguage === normalizedTarget) {
        return true;
      }
      const targetBase = normalizedTarget.split("-")[0];
      if (targetBase && targetBase !== normalizedTarget) {
        return optionLanguage === targetBase;
      }
      return this.matchesStartupAudioTarget(option, normalizedTarget);
    },
    findStartupPreferredAudioOption(targets = this.getStartupPreferredAudioLanguageTargets()) {
      const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
      if (!normalizedTargets.length) {
        return null;
      }
      const options = this.collectAudioOptionItems();
      for (const target of normalizedTargets) {
        const compatibleOptions = options.filter((entry) => !entry.requiresAudioConversion);
        const compatibleMatch =
          compatibleOptions.find((entry) => entry.supported && entry.languageKey === target) ||
          compatibleOptions.find((entry) => entry.supported && this.matchesStartupAudioTarget(entry, target));
        if (compatibleMatch) return compatibleMatch;
        const exactOption = options.find((entry) => entry.supported && entry.languageKey === target);
        if (exactOption) {
          return exactOption;
        }
        const matchingOption = options.find((entry) => entry.supported && this.matchesStartupAudioTarget(entry, target));
        if (matchingOption) {
          return matchingOption;
        }
      }
      return null;
    },
    maybeReapplyTizenStartupAudioPreference() {
      if (
        !Environment.isTizen() ||
        !this.startupAudioPreferenceApplied ||
        this.userAudioTrackSelected ||
        this.tizenLateAudioPreferenceAttempted ||
        !this.embeddedAudioTracks?.length
      ) {
        return false;
      }
      const targets = this.getStartupPreferredAudioLanguageTargets();
      if (!targets.length) {
        return false;
      }
      this.invalidateTrackDialogCaches();
      const rememberedOption = this.findRememberedAudioOption();
      if (rememberedOption?.entry) {
        if (rememberedOption.entry.selected) {
          return false;
        }
        this.tizenLateAudioPreferenceAttempted = true;
        this.startupAudioPreferenceApplied = false;
        return true;
      }
      const selectedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
      if (selectedOption?.supported && targets.some((target) => this.matchesStartupAudioTarget(selectedOption, target))) {
        return false;
      }
      // Metadata arrived after the bounded fallback had already settled startup.
      // Re-open the normal preference pass once, unless the viewer chose a track.
      this.tizenLateAudioPreferenceAttempted = true;
      this.startupAudioPreferenceApplied = false;
      return true;
    },
    applyStartupAudioPreference() {
      if (this.startupAudioPreferenceApplied || this.startupAudioPreferenceApplying) {
        return false;
      }

      const preferredTargets = this.getStartupPreferredAudioLanguageTargets();
      const selectionReady = (option) =>
        Boolean(option?.selected) && (!option.requiresAudioConversion || Boolean(PlayerController.webOsDtsAudioState));
      // `loadedmetadata` fires before Tizen AVPlay publishes `getTotalTrackInfo`,
      // so the option list can still hold nothing but the synthetic startup entry.
      // Concluding there means falling back to the runtime's first audio track and
      // latching that choice, which is why the preferred language never applied.
      const isStillLoading = this.isAudioPreferenceDiscoveryPending() || hasOnlyImplicitStartupAudioOptions(this.collectAudioOptionItems());
      const matchedRememberedOption = this.findRememberedAudioOption();
      const rememberedOption = isStillLoading && matchedRememberedOption?.entry?.implicitAudioTrack ? null : matchedRememberedOption;
      if (rememberedOption?.entry && Number.isFinite(rememberedOption.entryIndex)) {
        this.startupAudioFallbackApplied = false;
        if (selectionReady(rememberedOption)) {
          this.clearStartupAudioPreferenceRetry();
          this.startupAudioPreferenceApplied = true;
          return true;
        }
        this.startupAudioPreferenceApplying = true;
        try {
          this.applyAudioTrack(rememberedOption.entryIndex);
        } finally {
          this.startupAudioPreferenceApplying = false;
        }
        if (Environment.isWebOS() && this.pendingWebOsAudioSelection) {
          this.startupAudioPreferenceApplied = false;
          this.scheduleStartupAudioPreferenceRetry();
          return false;
        }
        if (selectionReady(this.findRememberedAudioOption())) {
          this.clearStartupAudioPreferenceRetry();
          this.startupAudioPreferenceApplied = true;
          return true;
        }
        if (this.scheduleStartupAudioPreferenceRetry()) {
          return false;
        }
      } else if (this.rememberedAudioTrackPreference && isStillLoading) {
        const retryingTrackDiscovery = this.scheduleStartupAudioPreferenceRetry();
        if (retryingTrackDiscovery || this.isAudioPreferenceDiscoveryPending()) {
          return false;
        }
      }
      if (!preferredTargets.length) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioFallbackApplied = false;
        this.startupAudioPreferenceApplied = true;
        return true;
      }

      const getPreferredTargetIndex = (option) =>
        option?.supported && !(isStillLoading && option.entry?.implicitAudioTrack)
          ? preferredTargets.findIndex((target) => this.matchesStartupAudioTarget(option, target))
          : -1;
      const hasHigherPriorityPreferredOption = (targetIndex) =>
        targetIndex > 0 && Boolean(this.findStartupPreferredAudioOption(preferredTargets.slice(0, targetIndex)));
      const selectedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
      const selectedTargetIndex = getPreferredTargetIndex(selectedOption);
      const bestPreferredOption = this.findStartupPreferredAudioOption(preferredTargets);
      const compatiblePreferredAvailable =
        selectedOption?.requiresAudioConversion &&
        bestPreferredOption &&
        !bestPreferredOption.requiresAudioConversion &&
        getPreferredTargetIndex(bestPreferredOption) <= selectedTargetIndex;
      if (
        selectionReady(selectedOption) &&
        selectedTargetIndex >= 0 &&
        !compatiblePreferredAvailable &&
        !hasHigherPriorityPreferredOption(selectedTargetIndex)
      ) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioFallbackApplied = false;
        this.startupAudioPreferenceApplied = true;
        return true;
      }

      const matchedPreferredOption = this.findStartupPreferredAudioOption(preferredTargets);
      const preferredOption = isStillLoading && matchedPreferredOption?.entry?.implicitAudioTrack ? null : matchedPreferredOption;
      if (!preferredOption?.entry || !Number.isFinite(preferredOption.entryIndex)) {
        if (isStillLoading) {
          const retryingTrackDiscovery = this.scheduleStartupAudioPreferenceRetry();
          if (retryingTrackDiscovery || this.isAudioPreferenceDiscoveryPending()) {
            return false;
          }
        }
        return this.applyStartupAudioFallback();
      }

      this.startupAudioPreferenceApplying = true;
      this.startupAudioFallbackApplied = false;
      try {
        this.applyAudioTrack(preferredOption.entryIndex);
      } finally {
        this.startupAudioPreferenceApplying = false;
      }

      if (Environment.isWebOS() && this.pendingWebOsAudioSelection) {
        this.startupAudioPreferenceApplied = false;
        this.scheduleStartupAudioPreferenceRetry();
        return false;
      }

      const appliedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
      const appliedTargetIndex = getPreferredTargetIndex(appliedOption);
      const applied = appliedTargetIndex >= 0 && !hasHigherPriorityPreferredOption(appliedTargetIndex);
      this.startupAudioPreferenceApplied = applied;
      if (applied) {
        this.clearStartupAudioPreferenceRetry();
      } else {
        const retryingTizenAvPlay = this.scheduleStartupAudioPreferenceRetry();
        if (!retryingTizenAvPlay && !this.isAudioPreferenceDiscoveryPending()) {
          return this.applyStartupAudioFallback();
        }
      }
      return applied;
    }
  };
}
