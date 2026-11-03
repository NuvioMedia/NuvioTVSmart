/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function registerPlaybackActionsPart01(model) {
  const {
    addonRepository,
    PlayerSettingsStore,
    PluginManager,
    NEXT_EPISODE_THRESHOLD_MODE_OPTIONS,
    NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS,
    NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS,
    STILL_WATCHING_THRESHOLD_OPTIONS,
    STREAM_AUTOPLAY_MODE_OPTIONS,
    STREAM_AUTOPLAY_SOURCE_OPTIONS,
    STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
    STREAM_REUSE_CACHE_HOURS_OPTIONS,
    formatReuseCacheDuration,
    t,
    arePluginsSupported
  } = internals;
  this.actionMap.set("playback:toggle:general", () => {
    this.toggleExpandedSection("playback", "general");
  });
  this.actionMap.set("playback:toggle:audio", () => {
    this.toggleExpandedSection("playback", "audio");
  });
  this.actionMap.set("playback:toggle:subtitles", () => {
    this.toggleExpandedSection("playback", "subtitles");
  });
  this.actionMap.set("playback:toggle:p2p", () => {
    this.toggleExpandedSection("playback", "p2p");
  });

  this.actionMap.set("playback:autoplay", () => {
    PlayerSettingsStore.set({
      autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode
    });
  });
  this.actionMap.set("playback:postPlayRecommendations", () => {
    PlayerSettingsStore.set({
      postPlayRecommendationsEnabled: !PlayerSettingsStore.get().postPlayRecommendationsEnabled
    });
  });
  this.actionMap.set("playback:postPlayMovieThreshold", () => {
    const current = PlayerSettingsStore.get().postPlayMovieThresholdPercent ?? 90;
    this.openOptionDialog({
      title: t("autoplay_post_play_movie_threshold", {}, "Movie Recommendation Timing"),
      options: Array.from({ length: 21 }, (_, index) => {
        const value = 80 + index;
        return { id: value, label: `${value}%` };
      }),
      selectedId: current,
      returnFocusKey: "playback:postPlayMovieThreshold",
      onSelect: (option) => {
        PlayerSettingsStore.set({ postPlayMovieThresholdPercent: Number(option.id) });
      }
    });
  });
  this.actionMap.set("playback:preferBingeGroup", () => {
    PlayerSettingsStore.set({
      streamAutoPlayPreferBingeGroupForNextEpisode: !PlayerSettingsStore.get().streamAutoPlayPreferBingeGroupForNextEpisode
    });
  });
  this.actionMap.set("playback:reuseBingeGroup", () => {
    PlayerSettingsStore.set({
      streamAutoPlayReuseBingeGroup: !PlayerSettingsStore.get().streamAutoPlayReuseBingeGroup
    });
  });
  this.actionMap.set("playback:reuseLastLink", () => {
    PlayerSettingsStore.set({
      streamReuseLastLinkEnabled: !PlayerSettingsStore.get().streamReuseLastLinkEnabled
    });
  });
  this.actionMap.set("playback:reuseLastLinkCache", () => {
    this.openOptionDialog({
      title: t("autoplay_last_link_cache", {}, "Last Link Cache Duration"),
      options: STREAM_REUSE_CACHE_HOURS_OPTIONS.map((option) => ({
        ...option,
        label: formatReuseCacheDuration(option.id)
      })),
      selectedId: PlayerSettingsStore.get().streamReuseLastLinkCacheHours,
      returnFocusKey: "playback:reuseLastLinkCache",
      onSelect: (option) => {
        PlayerSettingsStore.set({ streamReuseLastLinkCacheHours: Number(option.id) });
      }
    });
  });
  this.actionMap.set("playback:trailer", () => {
    PlayerSettingsStore.set({ trailerAutoplay: !PlayerSettingsStore.get().trailerAutoplay });
  });
  this.actionMap.set("playback:trailerDelay", () =>
    this.openOptionDialog({
      title: t("audio_trailer_delay", {}, "Trailer delay"),
      options: Array.from({ length: 16 }, (_, value) => ({
        id: String(value),
        label: `${value}s`
      })),
      selectedId: String(model.player.trailerDelaySeconds ?? 7),
      returnFocusKey: "playback:trailerDelay",
      onSelect: (option) => PlayerSettingsStore.set({ trailerDelaySeconds: Number(option.id) })
    })
  );
  this.actionMap.set("playback:skipIntro", () => {
    PlayerSettingsStore.set({ skipIntroEnabled: !PlayerSettingsStore.get().skipIntroEnabled });
  });
  const togglePlayerSetting = (focusKey, field) =>
    this.actionMap.set(focusKey, () => PlayerSettingsStore.set({ [field]: !PlayerSettingsStore.get()[field] }));
  togglePlayerSetting("playback:loadingOverlay", "loadingOverlayEnabled");
  togglePlayerSetting("playback:loadingStatus", "showPlayerLoadingStatus");
  togglePlayerSetting("playback:pauseOverlay", "pauseOverlayEnabled");
  togglePlayerSetting("playback:tizenMp4NativeFile", "tizenMp4NativeFile");
  togglePlayerSetting("playback:parentalGuide", "parentalGuideEnabled");
  ["intro", "recap", "outro", "movie-credits"].forEach((type) =>
    this.actionMap.set(`playback:autoSkip:${type}`, () => {
      const current = PlayerSettingsStore.get().autoSkipSegmentTypes || [];
      PlayerSettingsStore.set({
        autoSkipSegmentTypes: current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]
      });
    })
  );
  this.actionMap.set("playback:osdClock", () => {
    PlayerSettingsStore.set({
      osdClockEnabled: !PlayerSettingsStore.get().osdClockEnabled
    });
  });
  this.actionMap.set("playback:nextEpisodeThresholdMode", () => {
    this.openOptionDialog({
      title: t("settings.playback.nextEpisodeThresholdMode.title", {}, "Next episode threshold"),
      options: NEXT_EPISODE_THRESHOLD_MODE_OPTIONS,
      selectedId: PlayerSettingsStore.get().nextEpisodeThresholdMode,
      returnFocusKey: "playback:nextEpisodeThresholdMode",
      onSelect: (option) => {
        PlayerSettingsStore.set({ nextEpisodeThresholdMode: String(option.id) });
      }
    });
  });
  this.actionMap.set("playback:nextEpisodeThresholdValue", () => {
    const mode = String(PlayerSettingsStore.get().nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase();
    const options = mode === "MINUTES_BEFORE_END" ? NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS : NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS;
    const selectedId =
      mode === "MINUTES_BEFORE_END"
        ? PlayerSettingsStore.get().nextEpisodeThresholdMinutesBeforeEnd
        : PlayerSettingsStore.get().nextEpisodeThresholdPercent;
    this.openOptionDialog({
      title:
        mode === "MINUTES_BEFORE_END"
          ? t("settings.playback.nextEpisodeThresholdMinutes.title", {}, "Next episode minutes before end")
          : t("settings.playback.nextEpisodeThresholdPercent.title", {}, "Next episode percentage"),
      options,
      selectedId,
      returnFocusKey: "playback:nextEpisodeThresholdValue",
      onSelect: (option) => {
        const value = Number(option.id);
        if (mode === "MINUTES_BEFORE_END") {
          PlayerSettingsStore.set({ nextEpisodeThresholdMinutesBeforeEnd: value });
        } else {
          PlayerSettingsStore.set({ nextEpisodeThresholdPercent: value });
        }
      }
    });
  });
  this.actionMap.set("playback:stillWatching", () => {
    PlayerSettingsStore.set({
      stillWatchingEnabled: !PlayerSettingsStore.get().stillWatchingEnabled
    });
  });
  this.actionMap.set("playback:stillWatchingThreshold", () => {
    this.openOptionDialog({
      title: t("settings.playback.stillWatchingThreshold.title", {}, "Still watching threshold"),
      options: STILL_WATCHING_THRESHOLD_OPTIONS,
      selectedId: PlayerSettingsStore.get().stillWatchingEpisodeThreshold,
      returnFocusKey: "playback:stillWatchingThreshold",
      onSelect: (option) => {
        PlayerSettingsStore.set({ stillWatchingEpisodeThreshold: Number(option.id) });
      }
    });
  });
  this.actionMap.set("playback:autoStreamMode", () => {
    this.openOptionDialog({
      title: t("autoplay_stream_selection", {}, "Auto Stream Selection"),
      options: STREAM_AUTOPLAY_MODE_OPTIONS,
      selectedId: PlayerSettingsStore.get().streamAutoPlayMode,
      returnFocusKey: "playback:autoStreamMode",
      onSelect: (option) => {
        PlayerSettingsStore.set({ streamAutoPlayMode: option.id });
      }
    });
  });
  this.actionMap.set("playback:autoStreamTimeout", () => {
    this.openOptionDialog({
      title: t("autoplay_timeout_title", {}, "Stream Selection Timeout"),
      options: STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
      selectedId: PlayerSettingsStore.get().streamAutoPlayTimeoutSeconds,
      returnFocusKey: "playback:autoStreamTimeout",
      onSelect: (option) => {
        PlayerSettingsStore.set({ streamAutoPlayTimeoutSeconds: Number(option.id) });
      }
    });
  });
  this.actionMap.set("playback:autoStreamSource", () => {
    this.openOptionDialog({
      title: t("autoplay_scope", {}, "Auto-play Source Scope"),
      options: STREAM_AUTOPLAY_SOURCE_OPTIONS,
      selectedId: PlayerSettingsStore.get().streamAutoPlaySource,
      returnFocusKey: "playback:autoStreamSource",
      onSelect: (option) => {
        PlayerSettingsStore.set({ streamAutoPlaySource: option.id });
      }
    });
  });
  this.actionMap.set("playback:autoStreamRegex", () => {
    this.openTextDialog({
      title: t("autoplay_regex_title", {}, "Regex Pattern"),
      value: PlayerSettingsStore.get().streamAutoPlayRegex || "",
      returnFocusKey: "playback:autoStreamRegex",
      onSubmit: (value) => {
        PlayerSettingsStore.set({ streamAutoPlayRegex: String(value || "").trim() });
        return true;
      }
    });
  });
  this.actionMap.set("playback:autoStreamAddons", async () => {
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    const options = addons
      .map((addon) => String(addon?.displayName || addon?.name || "").trim())
      .filter(Boolean)
      .map((name) => ({ id: name, label: name }));
    this.openMultiChoiceDialog({
      title: t("autoplay_allowed_addons", {}, "Allowed Addons"),
      options,
      selectedIds: PlayerSettingsStore.get().streamAutoPlaySelectedAddons,
      returnFocusKey: "playback:autoStreamAddons",
      onToggle: (selectedIds) => PlayerSettingsStore.set({ streamAutoPlaySelectedAddons: selectedIds })
    });
  });
  if (arePluginsSupported()) {
    this.actionMap.set("playback:autoStreamPlugins", () => {
      const options = (PluginManager.pluginsEnabled ? PluginManager.listScrapers() : [])
        .filter((scraper) => scraper?.type === "NUVIO_JS" && scraper?.enabled !== false)
        .map((scraper) => String(scraper?.name || "").trim())
        .filter(Boolean)
        .filter((name, index, names) => names.indexOf(name) === index)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ id: name, label: name }));
      this.openMultiChoiceDialog({
        title: t("autoplay_allowed_plugins", {}, "Allowed Plugins"),
        options,
        selectedIds: PlayerSettingsStore.get().streamAutoPlaySelectedPlugins,
        returnFocusKey: "playback:autoStreamPlugins",
        onToggle: (selectedIds) => PlayerSettingsStore.set({ streamAutoPlaySelectedPlugins: selectedIds })
      });
    });
  }
}
