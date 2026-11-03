/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderPlaybackGeneralBody(model) {
  const {
    Platform,
    formatHalfStepSettingValue,
    STREAM_AUTOPLAY_MODE_OPTIONS,
    STREAM_AUTOPLAY_SOURCE_OPTIONS,
    STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
    labelForOptionId,
    formatReuseCacheDuration,
    t,
    arePluginsSupported,
    translateOptionCaption
  } = internals;
  return `
          <div class="settings-stack">
            ${this.renderToggleRow({
              focusKey: "playback:autoplay",
              title: t("settings.playback.autoplayNextEpisode.title"),
              subtitle: t("settings.playback.autoplayNextEpisode.subtitle"),
              checked: Boolean(model.player.autoplayNextEpisode)
            })}
            ${this.renderToggleRow({
              focusKey: "playback:postPlayRecommendations",
              title: t("autoplay_post_play_recommendations", {}, "Post-play Recommendations"),
              subtitle: t("autoplay_post_play_recommendations_sub", {}, "Show recommendations near the end of movies and series."),
              checked: model.player.postPlayRecommendationsEnabled !== false
            })}
            ${
              model.player.postPlayRecommendationsEnabled !== false
                ? this.renderActionRow({
                    focusKey: "playback:postPlayMovieThreshold",
                    title: t("autoplay_post_play_movie_threshold", {}, "Movie Recommendation Timing"),
                    subtitle: t(
                      "autoplay_post_play_movie_threshold_sub",
                      {},
                      "Choose when movie recommendations appear. Episodes follow the Next Episode Threshold setting."
                    ),
                    value: `${model.player.postPlayMovieThresholdPercent ?? 90}%`
                  })
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "playback:preferBingeGroup",
              title: t("autoplay_prefer_binge_group", {}, "Prefer Binge Group (Next Episode)"),
              subtitle: t("autoplay_prefer_binge_group_sub", {}, "Try the same source profile first before normal auto-play rules."),
              checked: Boolean(model.player.streamAutoPlayPreferBingeGroupForNextEpisode)
            })}
            ${
              model.player.streamAutoPlayPreferBingeGroupForNextEpisode
                ? this.renderToggleRow({
                    focusKey: "playback:reuseBingeGroup",
                    title: t("autoplay_reuse_binge_group", {}, "Reuse Binge Group"),
                    subtitle: t("autoplay_reuse_binge_group_sub", {}, "Remember and reuse the last binge group across sessions."),
                    checked: Boolean(model.player.streamAutoPlayReuseBingeGroup)
                  })
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "playback:skipIntro",
              title: t("settings.playback.skipIntro.title", {}, "Skip Intro"),
              subtitle: t(
                "settings.playback.skipIntro.subtitle",
                {},
                "Use IntroDB to detect intro, recap, outro and movie-credit segments when available."
              ),
              checked: Boolean(model.player.skipIntroEnabled)
            })}
            ${this.renderToggleRow({ focusKey: "playback:loadingOverlay", title: t("playback_loading_overlay"), subtitle: t("playback_loading_overlay_sub"), checked: model.player.loadingOverlayEnabled !== false })}
            ${this.renderToggleRow({ focusKey: "playback:loadingStatus", title: t("playback_show_loading_status", {}, "Detailed loading status"), subtitle: t("playback_show_loading_status_sub", {}, "Show detailed player loading progress"), checked: model.player.showPlayerLoadingStatus !== false })}
            ${this.renderToggleRow({ focusKey: "playback:pauseOverlay", title: t("playback_pause_overlay"), subtitle: t("playback_pause_overlay_sub"), checked: model.player.pauseOverlayEnabled !== false })}
            ${this.renderToggleRow({ focusKey: "playback:parentalGuide", title: t("playback_parental_guide"), subtitle: t("playback_parental_guide_sub"), checked: model.player.parentalGuideEnabled !== false })}
            ${["intro", "recap", "outro", "movie-credits"]
              .map((type) => {
                const translationType = type.replace(/-/g, "_");
                return this.renderToggleRow({
                  focusKey: `playback:autoSkip:${type}`,
                  title: t(`auto_skip_${translationType}`, {}, `Auto-skip ${type}`),
                  subtitle: t(`auto_skip_${translationType}_sub`, {}, `Skip ${type} segments automatically`),
                  checked: model.player.autoSkipSegmentTypes?.includes(type)
                });
              })
              .join("")}
            ${this.renderToggleRow({
              focusKey: "playback:osdClock",
              title: t("playback_osd_clock", {}, "OSD Clock"),
              subtitle: t("playback_show_clock_sub", {}, "Show current time and end time while controls are visible."),
              checked: Boolean(model.player.osdClockEnabled)
            })}
            ${this.renderActionRow({
              focusKey: "playback:nextEpisodeThresholdMode",
              title: t("settings.playback.nextEpisodeThresholdMode.title", {}, "Next episode threshold"),
              subtitle: t("settings.playback.nextEpisodeThresholdMode.subtitle", {}, "Choose percentage or minutes before the end."),
              value:
                String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() === "MINUTES_BEFORE_END"
                  ? t("settings.playback.nextEpisodeThresholdMode.minutes", {}, "Minutes before end")
                  : t("settings.playback.nextEpisodeThresholdMode.percentage", {}, "Percentage")
            })}
            ${this.renderActionRow({
              focusKey: "playback:nextEpisodeThresholdValue",
              title:
                String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() === "MINUTES_BEFORE_END"
                  ? t("settings.playback.nextEpisodeThresholdMinutes.title", {}, "Next episode minutes before end")
                  : t("settings.playback.nextEpisodeThresholdPercent.title", {}, "Next episode percentage"),
              subtitle:
                String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() === "MINUTES_BEFORE_END"
                  ? t(
                      "settings.playback.nextEpisodeThresholdMinutes.subtitle",
                      {},
                      "Start the next episode this many minutes before the end."
                    )
                  : t("settings.playback.nextEpisodeThresholdPercent.subtitle", {}, "Start the next episode at this percentage."),
              value:
                String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() === "MINUTES_BEFORE_END"
                  ? formatHalfStepSettingValue(model.player.nextEpisodeThresholdMinutesBeforeEnd ?? 2, " min")
                  : `${formatHalfStepSettingValue(model.player.nextEpisodeThresholdPercent ?? 99, "")}%`
            })}
            ${
              model.player.autoplayNextEpisode
                ? `
            ${this.renderToggleRow({
              focusKey: "playback:stillWatching",
              title: t("settings.playback.stillWatching.title", {}, "Still watching"),
              subtitle: t("settings.playback.stillWatching.subtitle", {}, "Show a prompt after repeated autoplay episodes."),
              checked: Boolean(model.player.stillWatchingEnabled)
            })}
            ${
              model.player.stillWatchingEnabled
                ? this.renderActionRow({
                    focusKey: "playback:stillWatchingThreshold",
                    title: t("settings.playback.stillWatchingThreshold.title", {}, "Still watching threshold"),
                    subtitle: t("settings.playback.stillWatchingThreshold.subtitle", {}, "How many autoplayed episodes before prompting."),
                    value: String(model.player.stillWatchingEpisodeThreshold ?? 3)
                  })
                : ""
            }
            `
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "playback:perTitleStreamLanguage",
              title: t("playback_per_title_stream_language", {}, "Use per-title source language"),
              subtitle: t("playback_per_title_stream_language_sub", {}, "Prioritize matching streams when a language is selected for a movie or series."),
              checked: Boolean(model.player.perTitleStreamLanguageEnabled)
            })}
            ${this.renderToggleRow({
              focusKey: "playback:reuseLastLink",
              title: t("autoplay_reuse_last_link", {}, "Reuse Last Link"),
              subtitle: t(
                "autoplay_reuse_last_link_sub",
                {},
                "Auto-play your last working stream for this same movie or episode while the cache is valid."
              ),
              checked: Boolean(model.player.streamReuseLastLinkEnabled)
            })}
            ${
              model.player.streamReuseLastLinkEnabled
                ? this.renderActionRow({
                    focusKey: "playback:reuseLastLinkCache",
                    title: t("autoplay_last_link_cache", {}, "Last Link Cache Duration"),
                    subtitle: t("autoplay_reuse_last_link_sub", {}, "Auto-play your last working stream while the cache is valid."),
                    value: formatReuseCacheDuration(model.player.streamReuseLastLinkCacheHours)
                  })
                : ""
            }
            ${this.renderActionRow({
              focusKey: "playback:autoStreamMode",
              title: t("autoplay_stream_selection", {}, "Auto Stream Selection"),
              subtitle: translateOptionCaption(
                STREAM_AUTOPLAY_MODE_OPTIONS.find((option) => String(option.id) === String(model.player.streamAutoPlayMode)),
                t("autoplay_mode_manual_desc", {}, "Always show the source list and let me choose.")
              ),
              value: labelForOptionId(STREAM_AUTOPLAY_MODE_OPTIONS, model.player.streamAutoPlayMode, "Manual (choose stream)")
            })}
            ${this.renderActionRow({
              focusKey: "playback:autoStreamTimeout",
              title: t("autoplay_timeout_title", {}, "Stream Selection Timeout"),
              subtitle: t("autoplay_timeout_sub", {}, "Wait time for addons before selecting."),
              value: labelForOptionId(
                STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
                model.player.streamAutoPlayTimeoutSeconds,
                `${model.player.streamAutoPlayTimeoutSeconds}s`
              )
            })}
            ${
              String(model.player.streamAutoPlayMode || "MANUAL") !== "MANUAL"
                ? `
            ${this.renderActionRow({
              focusKey: "playback:autoStreamSource",
              title: t("autoplay_scope", {}, "Auto-play Source Scope"),
              subtitle: labelForOptionId(STREAM_AUTOPLAY_SOURCE_OPTIONS, model.player.streamAutoPlaySource, "All sources"),
              value: labelForOptionId(STREAM_AUTOPLAY_SOURCE_OPTIONS, model.player.streamAutoPlaySource, "All sources")
            })}
            ${
              String(model.player.streamAutoPlaySource || "ALL_SOURCES") !== "ENABLED_PLUGINS_ONLY"
                ? this.renderActionRow({
                    focusKey: "playback:autoStreamAddons",
                    title: t("autoplay_allowed_addons", {}, "Allowed Addons"),
                    subtitle: t("autoplay_scope_addons_desc", {}, "Auto-play only considers selected installed addons."),
                    value: model.player.streamAutoPlaySelectedAddons?.length
                      ? String(model.player.streamAutoPlaySelectedAddons.length)
                      : t("autoplay_all_addons", {}, "All installed addons")
                  })
                : ""
            }
            ${
              arePluginsSupported() && String(model.player.streamAutoPlaySource || "ALL_SOURCES") !== "INSTALLED_ADDONS_ONLY"
                ? this.renderActionRow({
                    focusKey: "playback:autoStreamPlugins",
                    title: t("autoplay_allowed_plugins", {}, "Allowed Plugins"),
                    subtitle: t("autoplay_scope_plugins_desc", {}, "Auto-play only considers selected enabled plugins."),
                    value: model.player.streamAutoPlaySelectedPlugins?.length
                      ? String(model.player.streamAutoPlaySelectedPlugins.length)
                      : t("autoplay_all_plugins", {}, "All enabled plugins")
                  })
                : ""
            }`
                : ""
            }
            ${
              String(model.player.streamAutoPlayMode || "MANUAL") === "REGEX_MATCH"
                ? `
            ${this.renderActionRow({
              focusKey: "playback:autoStreamRegex",
              title: t("autoplay_regex_title", {}, "Regex Pattern"),
              subtitle: t("autoplay_regex_matches", {}, "Matches stream name, title, description, addon and URL."),
              value: String(model.player.streamAutoPlayRegex || "").trim() || t("common.notSet", {}, "Not set")
            })}`
                : ""
            }
          </div>
        `;
}
