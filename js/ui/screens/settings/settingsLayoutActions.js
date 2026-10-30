/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function registerLayoutActions(model) {
  const { HomeCatalogStore, LayoutPreferences, HOME_LAYOUT_OPTIONS, t } = internals;
  this.actionMap.set("layout:toggle:homeLayout", () => {
    this.toggleExpandedSection("layout", "homeLayout");
  });
  this.actionMap.set("layout:toggle:homeContent", () => {
    this.toggleExpandedSection("layout", "homeContent");
  });
  this.actionMap.set("layout:toggle:continueWatching", () => {
    this.toggleExpandedSection("layout", "continueWatching");
  });
  this.actionMap.set("layout:toggle:detailPage", () => {
    this.toggleExpandedSection("layout", "detailPage");
  });
  this.actionMap.set("layout:toggle:focusedPoster", () => {
    this.toggleExpandedSection("layout", "focusedPoster");
  });
  this.actionMap.set("layout:toggle:cardAppearance", () => {
    this.toggleExpandedSection("layout", "cardAppearance");
  });
  this.actionMap.set("layout:toggle:customPosters", () => {
    this.toggleExpandedSection("layout", "customPosters");
  });
  HOME_LAYOUT_OPTIONS.forEach((option) => {
    this.actionMap.set(`layout:layout:${option.id}`, () => {
      LayoutPreferences.set({ homeLayout: option.id });
    });
  });

  this.actionMap.set("layout:collapseSidebar", () => {
    LayoutPreferences.set({ collapseSidebar: !LayoutPreferences.get().collapseSidebar });
  });
  this.actionMap.set("layout:modernSidebar", () => {
    LayoutPreferences.set({ modernSidebar: !LayoutPreferences.get().modernSidebar });
  });
  this.actionMap.set("layout:modernSidebarBlur", () => {
    LayoutPreferences.set({ modernSidebarBlur: !LayoutPreferences.get().modernSidebarBlur });
  });
  this.actionMap.set("layout:heroSection", () => {
    LayoutPreferences.set({ heroSectionEnabled: !LayoutPreferences.get().heroSectionEnabled });
  });
  this.actionMap.set("layout:heroCatalogs", () => {
    const catalogSettings = model.homeCatalog || HomeCatalogStore.get();
    const options = (catalogSettings.order || [])
      .filter((key) => !catalogSettings.disabled?.includes(key))
      .map((key) => ({
        id: key,
        label: catalogSettings.customTitles?.[key] || key.split("::").pop() || key
      }));
    this.openMultiChoiceDialog({
      title: t("layout_hero_catalog", {}, "Hero catalogs"),
      options,
      selectedIds: model.layout.heroCatalogKeys || [],
      returnFocusKey: "layout:heroCatalogs",
      onToggle: (selectedIds) => LayoutPreferences.set({ heroCatalogKeys: selectedIds })
    });
  });
  this.actionMap.set("layout:searchDiscover", () => {
    const options = [
      { id: "in_search", labelKey: "layout_discover_location_in_search" },
      { id: "in_sidebar", labelKey: "layout_discover_location_in_sidebar" },
      { id: "off", labelKey: "common_off" }
    ];
    this.openOptionDialog({
      title: t("layout_discover_location_dialog_title", {}, "Discover location"),
      options,
      selectedId: model.layout.discoverLocation || "in_search",
      returnFocusKey: "layout:searchDiscover",
      onSelect: (option) => LayoutPreferences.set({ discoverLocation: option.id })
    });
  });
  this.actionMap.set("layout:classicFocusGradient", () =>
    LayoutPreferences.set({
      classicFocusGradientEnabled: !LayoutPreferences.get().classicFocusGradientEnabled
    })
  );
  this.actionMap.set("layout:showFullReleaseDate", () =>
    LayoutPreferences.set({ showFullReleaseDate: !LayoutPreferences.get().showFullReleaseDate })
  );
  this.actionMap.set("layout:detail:preferExternalMeta", () =>
    LayoutPreferences.set({
      preferExternalMetaAddonDetail: !LayoutPreferences.get().preferExternalMetaAddonDetail
    })
  );
  this.actionMap.set("layout:continueWatchingCardStyle", () =>
    this.openOptionDialog({
      title: t("layout_cw_card_style", {}, "Continue Watching card style"),
      options: ["card", "wide", "poster"].map((id) => ({
        id,
        labelKey: `layout_cw_card_style_${id}`
      })),
      selectedId: model.layout.continueWatchingCardStyle || "card",
      returnFocusKey: "layout:continueWatchingCardStyle",
      onSelect: (option) => LayoutPreferences.set({ continueWatchingCardStyle: option.id })
    })
  );
  this.actionMap.set("layout:continueWatchingEnabled", () => {
    LayoutPreferences.set({
      continueWatchingEnabled: !LayoutPreferences.get().continueWatchingEnabled
    });
  });
  const openNumberSetting = (focusKey, titleKey, field, values, fallback) =>
    this.actionMap.set(focusKey, () =>
      this.openOptionDialog({
        title: t(titleKey, {}, titleKey),
        options: values.map((value) => ({ id: String(value), label: String(value) })),
        selectedId: String(model.layout[field] ?? fallback),
        returnFocusKey: focusKey,
        onSelect: (option) => LayoutPreferences.set({ [field]: Number(option.id) })
      })
    );
  openNumberSetting("layout:posterWidth", "layout_card_width", "posterCardWidthDp", [96, 108, 116, 126, 136, 146, 156, 168], 126);
  openNumberSetting("layout:posterRadius", "layout_card_radius", "posterCardCornerRadiusDp", [0, 4, 8, 12, 16, 20, 24], 12);
  openNumberSetting(
    "layout:cardDepthEdge",
    "settings_card_depth_edge_value",
    "cardDepthEdgeStrength",
    [0, 10, 20, 28, 40, 60, 80, 100],
    28
  );
  openNumberSetting("layout:cardDepthSheen", "settings_card_depth_sheen_value", "cardDepthSheenStrength", [0, 10, 20, 40, 60, 80, 100], 10);
  openNumberSetting("layout:cardDepthCoverage", "settings_card_depth_coverage_value", "cardDepthEdgeCoverage", [0, 25, 50, 75, 100], 0);
  ["Enabled", "PostersEnabled", "ContinueWatchingEnabled", "EpisodeCardsEnabled", "CastEnabled", "TrailersEnabled"].forEach((suffix) => {
    const field = `cardDepth${suffix}`;
    this.actionMap.set(`layout:${field}`, () => LayoutPreferences.set({ [field]: !LayoutPreferences.get()[field] }));
  });
  this.actionMap.set("layout:hideUnreleased", () => {
    LayoutPreferences.set({
      hideUnreleasedContent: !LayoutPreferences.get().hideUnreleasedContent
    });
  });
  this.actionMap.set("layout:useEpisodeThumbnailsInCw", () => {
    LayoutPreferences.set({
      useEpisodeThumbnailsInCw: !LayoutPreferences.get().useEpisodeThumbnailsInCw
    });
  });
  this.actionMap.set("layout:blurContinueWatchingNextUp", () => {
    LayoutPreferences.set({
      blurContinueWatchingNextUp: !LayoutPreferences.get().blurContinueWatchingNextUp
    });
  });
  this.actionMap.set("layout:nextUpFromFurthest", () => {
    LayoutPreferences.set({
      nextUpFromFurthestEpisode: !LayoutPreferences.get().nextUpFromFurthestEpisode
    });
  });
  this.actionMap.set("layout:showUnairedNextUp", () => {
    LayoutPreferences.set({ showUnairedNextUp: !LayoutPreferences.get().showUnairedNextUp });
  });
  this.actionMap.set("layout:continueWatchingSortMode", () => {
    const options = [
      {
        id: "default",
        labelKey: "settings.layout.continueWatchingSort.default",
        label: "Default"
      },
      {
        id: "streaming_style",
        labelKey: "settings.layout.continueWatchingSort.streamingStyle",
        label: "Streaming Style"
      },
      {
        id: "split_upcoming",
        labelKey: "layout_cw_sort_split_upcoming",
        label: "Separate Upcoming Row"
      }
    ];
    this.openOptionDialog({
      title: t("settings.dialogs.continueWatchingSortMode", {}, "Continue Watching Sort"),
      options,
      selectedId: String(model.layout.continueWatchingSortMode || "default"),
      returnFocusKey: "layout:continueWatchingSortMode",
      onSelect: (option) => {
        LayoutPreferences.set({ continueWatchingSortMode: String(option.id || "default") });
      }
    });
  });
  this.actionMap.set("layout:homeImdbRatings", () => {
    const current = LayoutPreferences.get().homeImdbRatingsVisibility;
    LayoutPreferences.set({
      homeImdbRatingsVisibility: current === "HIDE_ALL" ? "SHOW_ALL" : "HIDE_ALL"
    });
  });
  this.actionMap.set("layout:posterLabels", () => {
    LayoutPreferences.set({ posterLabelsEnabled: !LayoutPreferences.get().posterLabelsEnabled });
  });
  this.actionMap.set("layout:addonName", () => {
    LayoutPreferences.set({
      catalogAddonNameEnabled: !LayoutPreferences.get().catalogAddonNameEnabled
    });
  });
  this.actionMap.set("layout:catalogType", () => {
    LayoutPreferences.set({
      catalogTypeSuffixEnabled: !LayoutPreferences.get().catalogTypeSuffixEnabled
    });
  });
  this.actionMap.set("layout:modernLandscapePosters", () => {
    LayoutPreferences.set({
      modernLandscapePostersEnabled: !LayoutPreferences.get().modernLandscapePostersEnabled
    });
  });
  this.actionMap.set("layout:modernHeroFullScreenBackdrop", () => {
    LayoutPreferences.set({
      modernHeroFullScreenBackdropEnabled: !LayoutPreferences.get().modernHeroFullScreenBackdropEnabled
    });
  });
  this.actionMap.set("layout:focusedPosterExpand", () => {
    LayoutPreferences.set({
      focusedPosterBackdropExpandEnabled: !LayoutPreferences.get().focusedPosterBackdropExpandEnabled
    });
  });
  this.actionMap.set("layout:focusedPosterExpandDelay", () => {
    const options = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
      id: String(value),
      label: `${value}s`
    }));
    this.openOptionDialog({
      title: t("settings.dialogs.backdropExpandDelay"),
      options,
      selectedId: String(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3),
      returnFocusKey: "layout:focusedPosterExpandDelay",
      onSelect: (option) => {
        LayoutPreferences.set({
          focusedPosterBackdropExpandDelaySeconds: Number(option.id || 0) || 0
        });
      }
    });
  });
  this.actionMap.set("layout:focusedPosterTrailer", () => {
    LayoutPreferences.set({
      focusedPosterBackdropTrailerEnabled: !LayoutPreferences.get().focusedPosterBackdropTrailerEnabled
    });
  });
  this.actionMap.set("layout:focusedPosterTrailerMuted", () => {
    LayoutPreferences.set({
      focusedPosterBackdropTrailerMuted: !LayoutPreferences.get().focusedPosterBackdropTrailerMuted
    });
  });
  this.actionMap.set("layout:focusedPosterTrailerTarget", () => {
    const options = [
      { id: "hero_media", labelKey: "settings.layout.trailerTargets.heroMedia" },
      { id: "expanded_card", labelKey: "settings.layout.trailerTargets.expandedCard" }
    ];
    this.openOptionDialog({
      title: t("settings.dialogs.modernTrailerPlaybackLocation"),
      options,
      selectedId: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media"),
      returnFocusKey: "layout:focusedPosterTrailerTarget",
      onSelect: (option) => {
        LayoutPreferences.set({
          focusedPosterBackdropTrailerPlaybackTarget: String(option.id || "hero_media")
        });
      }
    });
  });
  this.actionMap.set("layout:detail:trailerButton", () => {
    LayoutPreferences.set({
      detailPageTrailerButtonEnabled: !LayoutPreferences.get().detailPageTrailerButtonEnabled
    });
  });
  this.actionMap.set("layout:detail:shuffle", () =>
    LayoutPreferences.set({ randomEpisodeEnabled: !LayoutPreferences.get().randomEpisodeEnabled })
  );
  this.actionMap.set("layout:detail:blurUnwatched", () => {
    LayoutPreferences.set({
      blurUnwatchedEpisodes: !LayoutPreferences.get().blurUnwatchedEpisodes
    });
  });
  this.actionMap.set("layout:detail:episodeRatings", () => {
    const options = [
      { id: "SHOW_ALL", labelKey: "layout_ratings_show", label: "Show" },
      { id: "HIDE_EPISODES", labelKey: "layout_ratings_hide", label: "Hide" },
      {
        id: "HIDE_UNWATCHED_EPISODES",
        labelKey: "layout_ratings_hide_unwatched",
        label: "Hide Unwatched"
      }
    ];
    this.openOptionDialog({
      title: t("layout_episode_ratings", {}, "Episode Ratings"),
      options,
      selectedId: LayoutPreferences.get().detailImdbRatingsVisibility,
      returnFocusKey: "layout:detail:episodeRatings",
      onSelect: (option) => {
        LayoutPreferences.set({ detailImdbRatingsVisibility: String(option.id || "SHOW_ALL") });
      }
    });
  });
}
