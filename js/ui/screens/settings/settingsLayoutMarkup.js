import { renderCustomPosterSettings } from "./settingsCustomPosterSection.js";
/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderLayoutMarkup(model) {
  const { isModernSidebarBlurAvailable, HOME_LAYOUT_OPTIONS, SECTION_META, t } = internals;
  const expanded = this.expandedSections.layout;
  const selectedLayout = String(model.layout.homeLayout || "").toLowerCase();
  const isModernLayout = selectedLayout === "modern";
  const isModernLandscape = isModernLayout && Boolean(model.layout.modernLandscapePostersEnabled);
  const cardExpansionEnabled = Boolean(model.layout.focusedPosterBackdropExpandEnabled);
  const showAutoplayRow = cardExpansionEnabled || isModernLandscape;
  const continueWatchingSortMode = String(model.layout.continueWatchingSortMode || "default");
  const continueWatchingSortLabel =
    continueWatchingSortMode === "split_upcoming"
      ? t("layout_cw_sort_split_upcoming", {}, "Separate Upcoming Row")
      : continueWatchingSortMode === "streaming_style"
        ? t("settings.layout.continueWatchingSort.streamingStyle", {}, "Streaming Style")
        : t("settings.layout.continueWatchingSort.default", {}, "Default");
  const homeRatingsShown = model.layout.homeImdbRatingsVisibility !== "HIDE_ALL";
  const detailRatingsVisibility = String(model.layout.detailImdbRatingsVisibility || "SHOW_ALL");
  const detailRatingsVisibilityLabel =
    detailRatingsVisibility === "HIDE_UNWATCHED_EPISODES"
      ? t("layout_ratings_hide_unwatched", {}, "Hide Unwatched")
      : detailRatingsVisibility === "HIDE_EPISODES" || detailRatingsVisibility === "HIDE_ALL"
        ? t("layout_ratings_hide", {}, "Hide")
        : t("layout_ratings_show", {}, "Show");

  const homeLayoutBody = `
          <div class="settings-stack">
            <div class="settings-layout-grid">
              ${HOME_LAYOUT_OPTIONS.map((option) =>
                this.renderLayoutCard(option, selectedLayout === option.id, `layout:layout:${option.id}`)
              ).join("")}
            </div>
            ${
              isModernLayout
                ? this.renderToggleRow({
                    focusKey: "layout:modernLandscapePosters",
                    title: t("settings.layout.landscapePosters.title"),
                    subtitle: t("settings.layout.landscapePosters.subtitle"),
                    checked: Boolean(model.layout.modernLandscapePostersEnabled)
                  })
                : ""
            }
            ${
              isModernLayout
                ? this.renderToggleRow({
                    focusKey: "layout:modernHeroFullScreenBackdrop",
                    title: t("settings.layout.fullscreenHeroBackdrop.title"),
                    subtitle: t("settings.layout.fullscreenHeroBackdrop.subtitle"),
                    checked: Boolean(model.layout.modernHeroFullScreenBackdropEnabled)
                  })
                : ""
            }
          </div>
        `;

  if (model.experience?.mode === "ESSENTIAL") {
    return `
            ${this.renderSectionHeader({
              ...SECTION_META.find((item) => item.id === "layout"),
              subtitleKey: "layout_selection_subtitle"
            })}
            <div class="settings-group-card"><div class="settings-stack">
              ${homeLayoutBody}
              ${
                selectedLayout === "classic"
                  ? this.renderToggleRow({
                      focusKey: "layout:classicFocusGradient",
                      title: t("layout_classic_focus_gradient", {}, "Classic focus gradient"),
                      subtitle: t("layout_classic_focus_gradient_sub", {}, "Show the focus gradient in Classic layout."),
                      checked: Boolean(model.layout.classicFocusGradientEnabled)
                    })
                  : ""
              }
              ${
                !isModernLayout && model.layout.heroSectionEnabled
                  ? this.renderActionRow({
                      focusKey: "layout:heroCatalogs",
                      title: t("layout_hero_catalog", {}, "Hero catalogs"),
                      subtitle: t("layout_hero_catalog_sub", {}, "Choose catalogs used by the Hero section."),
                      value: String(model.layout.heroCatalogKeys?.length || 0)
                    })
                  : ""
              }
            </div></div>`;
  }

  const homeContentBody = `
          <div class="settings-stack">
            ${
              !model.layout.modernSidebar
                ? this.renderToggleRow({
                    focusKey: "layout:collapseSidebar",
                    title: t("settings.layout.collapseSidebar.title"),
                    subtitle: t("settings.layout.collapseSidebar.subtitle"),
                    checked: Boolean(model.layout.collapseSidebar)
                  })
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "layout:modernSidebar",
              title: t("settings.layout.modernSidebar.title"),
              subtitle: t("settings.layout.modernSidebar.subtitle"),
              checked: Boolean(model.layout.modernSidebar)
            })}
            ${
              model.layout.modernSidebar && isModernSidebarBlurAvailable()
                ? this.renderToggleRow({
                    focusKey: "layout:modernSidebarBlur",
                    title: t("settings.layout.modernSidebarBlur.title"),
                    subtitle: t("settings.layout.modernSidebarBlur.subtitle"),
                    checked: Boolean(model.layout.modernSidebarBlur)
                  })
                : ""
            }
            ${
              !isModernLayout
                ? `
            ${this.renderToggleRow({
              focusKey: "layout:heroSection",
              title: t("settings.layout.heroSection.title"),
              subtitle: t("settings.layout.heroSection.subtitle"),
              checked: Boolean(model.layout.heroSectionEnabled)
            })}
            ${model.layout.heroSectionEnabled ? this.renderActionRow({ focusKey: "layout:heroCatalogs", title: t("layout_hero_catalog", {}, "Hero catalogs"), subtitle: t("layout_hero_catalog_sub", {}, "Choose catalogs used by the Hero section"), value: model.layout.heroCatalogKeys?.length ? String(model.layout.heroCatalogKeys.length) : t("common_all", {}, "All") }) : ""}
            `
                : ""
            }
            ${this.renderActionRow({
              focusKey: "layout:searchDiscover",
              title: t("layout_discover_location_action", {}, "Discover location"),
              subtitle: t("settings.layout.searchDiscover.subtitle"),
              value:
                model.layout.discoverLocation === "in_sidebar"
                  ? t("layout_discover_location_in_sidebar")
                  : model.layout.discoverLocation === "off"
                    ? t("common.off", {}, "Off")
                    : t("layout_discover_location_in_search")
            })}
            ${!isModernLayout ? this.renderToggleRow({ focusKey: "layout:classicFocusGradient", title: t("layout_classic_focus_gradient"), subtitle: t("layout_classic_focus_gradient_sub"), checked: Boolean(model.layout.classicFocusGradientEnabled) }) : ""}
            ${
              !isModernLayout
                ? this.renderToggleRow({
                    focusKey: "layout:posterLabels",
                    title: t("settings.layout.posterLabels.title"),
                    subtitle: t("settings.layout.posterLabels.subtitle"),
                    checked: Boolean(model.layout.posterLabelsEnabled)
                  })
                : ""
            }
            ${
              !isModernLayout
                ? this.renderToggleRow({
                    focusKey: "layout:addonName",
                    title: t("settings.layout.addonName.title"),
                    subtitle: t("settings.layout.addonName.subtitle"),
                    checked: Boolean(model.layout.catalogAddonNameEnabled)
                  })
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "layout:catalogType",
              title: t("settings.layout.catalogType.title"),
              subtitle: t("settings.layout.catalogType.subtitle"),
              checked: Boolean(model.layout.catalogTypeSuffixEnabled)
            })}
            ${this.renderToggleRow({
              focusKey: "layout:hideUnreleased",
              title: t("settings.layout.hideUnreleased.title"),
              subtitle: t("settings.layout.hideUnreleased.subtitle"),
              checked: Boolean(model.layout.hideUnreleasedContent)
            })}
            ${this.renderToggleRow({
              focusKey: "layout:homeImdbRatings",
              title: t("layout_overall_ratings", {}, "Overall Ratings"),
              subtitle: homeRatingsShown
                ? t("layout_overall_ratings_sub_on", {}, "Standard and TMDB ratings are shown.")
                : t(
                    "layout_overall_ratings_sub_off",
                    {},
                    "Standard and TMDB ratings are Hidden. MDBList provider settings take priority on detail pages."
                  ),
              checked: homeRatingsShown
            })}
          </div>
        `;

  const continueWatchingEnabled = model.layout.continueWatchingEnabled !== false;
  const continueWatchingOptionsBody = continueWatchingEnabled
    ? `
            ${this.renderActionRow({ focusKey: "layout:continueWatchingCardStyle", title: t("layout_cw_card_style", {}, "Card style"), subtitle: t("layout_section_continue_watching_desc", {}, "Choose the Continue Watching card shape"), value: t(`layout_cw_card_style_${model.layout.continueWatchingCardStyle || "card"}`, {}, model.layout.continueWatchingCardStyle || "card") })}
            ${this.renderToggleRow({
              focusKey: "layout:useEpisodeThumbnailsInCw",
              title: t("settings.layout.useEpisodeThumbnailsInCw.title", {}, "Use Episode Thumbnails"),
              subtitle: t("settings.layout.useEpisodeThumbnailsInCw.subtitle", {}, "Show episode artwork in Continue Watching cards."),
              checked: model.layout.useEpisodeThumbnailsInCw !== false
            })}
            ${
              model.layout.useEpisodeThumbnailsInCw !== false
                ? this.renderToggleRow({
                    focusKey: "layout:blurContinueWatchingNextUp",
                    title: t("settings.layout.blurContinueWatchingNextUp.title", {}, "Blur Next Up Artwork"),
                    subtitle: t(
                      "settings.layout.blurContinueWatchingNextUp.subtitle",
                      {},
                      "Blur upcoming episode artwork in Continue Watching."
                    ),
                    checked: Boolean(model.layout.blurContinueWatchingNextUp)
                  })
                : ""
            }
            ${this.renderToggleRow({
              focusKey: "layout:nextUpFromFurthest",
              title: t("settings.layout.nextUpFromFurthest.title", {}, "Up Next From Furthest Episode"),
              subtitle: t(
                "settings.layout.nextUpFromFurthest.subtitle",
                {},
                "Use the highest watched episode as the seed for the next episode."
              ),
              checked: model.layout.nextUpFromFurthestEpisode !== false
            })}
            ${this.renderToggleRow({
              focusKey: "layout:showUnairedNextUp",
              title: t("settings.layout.showUnairedNextUp.title", {}, "Show Unaired Next Up Episodes"),
              subtitle: t("settings.layout.showUnairedNextUp.subtitle", {}, "Allow upcoming episodes to appear in Continue Watching."),
              checked: model.layout.showUnairedNextUp !== false
            })}
            ${this.renderActionRow({
              focusKey: "layout:continueWatchingSortMode",
              title: t("settings.layout.continueWatchingSort.title", {}, "Sort Order"),
              subtitle: t(
                "settings.layout.continueWatchingSort.subtitle",
                {},
                "Choose the same Continue Watching ordering used on Android TV."
              ),
              value: continueWatchingSortLabel
            })}
          `
    : "";

  const continueWatchingBody = `
          <div class="settings-stack">
            ${this.renderToggleRow({
              focusKey: "layout:continueWatchingEnabled",
              title: t("settings.layout.continueWatchingEnabled.title", {}, "Show Continue Watching"),
              subtitle: t("settings.layout.continueWatchingEnabled.subtitle", {}, "Show Continue Watching and Upcoming rows on Home."),
              checked: continueWatchingEnabled
            })}
            ${continueWatchingOptionsBody}
          </div>
        `;

  const detailPageBody = `
          <div class="settings-stack">
            ${this.renderToggleRow({ focusKey: "layout:detail:shuffle", title: t("random_episode_title"), subtitle: t("layout_random_episode_sub"), checked: Boolean(model.layout.randomEpisodeEnabled) })}
            ${this.renderToggleRow({
              focusKey: "layout:detail:blurUnwatched",
              title: t("settings.layout.blurUnwatched.title"),
              subtitle: t("settings.layout.blurUnwatched.subtitle"),
              checked: Boolean(model.layout.blurUnwatchedEpisodes)
            })}
            ${this.renderActionRow({
              focusKey: "layout:detail:episodeRatings",
              title: t("layout_episode_ratings", {}, "Episode Ratings"),
              subtitle: t("layout_episode_ratings_sub", {}, "Choose which episode ratings are visible."),
              value: detailRatingsVisibilityLabel
            })}
            ${this.renderToggleRow({
              focusKey: "layout:detail:trailerButton",
              title: t("settings.layout.showTrailerButton.title"),
              subtitle: t("settings.layout.showTrailerButton.subtitle"),
              checked: Boolean(model.layout.detailPageTrailerButtonEnabled)
            })}
            ${this.renderToggleRow({
              focusKey: "layout:detail:preferExternalMeta",
              title: t("settings.layout.preferExternalMeta.title"),
              subtitle: t("settings.layout.preferExternalMeta.subtitle"),
              checked: model.layout.preferExternalMetaAddonDetail !== false
            })}
            ${this.renderToggleRow({ focusKey: "layout:showFullReleaseDate", title: t("layout_show_full_release_date"), subtitle: t("layout_show_full_release_date_sub"), checked: model.layout.showFullReleaseDate !== false })}
          </div>
        `;

  const focusedPosterBody = `
          <div class="settings-stack">
            ${
              !isModernLandscape
                ? this.renderToggleRow({
                    focusKey: "layout:focusedPosterExpand",
                    title: t("settings.layout.focusedPosterExpand.title"),
                    subtitle: t("settings.layout.focusedPosterExpand.subtitle"),
                    checked: Boolean(model.layout.focusedPosterBackdropExpandEnabled)
                  })
                : ""
            }
            ${
              !isModernLandscape && Boolean(model.layout.focusedPosterBackdropExpandEnabled)
                ? this.renderActionRow({
                    focusKey: "layout:focusedPosterExpandDelay",
                    title: t("settings.layout.focusedPosterExpandDelay.title"),
                    subtitle: t("settings.layout.focusedPosterExpandDelay.subtitle"),
                    value: `${Number(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3)}s`
                  })
                : ""
            }
            ${
              showAutoplayRow
                ? this.renderToggleRow({
                    focusKey: "layout:focusedPosterTrailer",
                    title: isModernLayout
                      ? t("settings.layout.autoplayTrailer.title")
                      : t("settings.layout.autoplayTrailerExpandedCard.title"),
                    subtitle: isModernLayout
                      ? t("settings.layout.autoplayTrailer.subtitle")
                      : t("settings.layout.autoplayTrailerExpandedCard.subtitle"),
                    checked: Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
                  })
                : ""
            }
            ${
              showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
                ? this.renderToggleRow({
                    focusKey: "layout:focusedPosterTrailerMuted",
                    title: isModernLayout ? t("settings.layout.trailerMuted.title") : t("settings.layout.trailerMutedExpandedCard.title"),
                    subtitle: isModernLayout
                      ? t("settings.layout.trailerMuted.subtitle")
                      : t("settings.layout.trailerMutedExpandedCard.subtitle"),
                    checked: Boolean(model.layout.focusedPosterBackdropTrailerMuted)
                  })
                : ""
            }
            ${
              isModernLayout && showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
                ? this.renderActionRow({
                    focusKey: "layout:focusedPosterTrailerTarget",
                    title: t("settings.layout.trailerTarget.title"),
                    subtitle: t("settings.layout.trailerTarget.subtitle"),
                    value:
                      String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media") === "expanded_card"
                        ? t("settings.layout.trailerTargets.expandedCard")
                        : t("settings.layout.trailerTargets.heroMedia")
                  })
                : ""
            }
          </div>
        `;

  const cardAppearanceBody = `
          <div class="settings-stack">
            ${this.renderActionRow({ focusKey: "layout:posterWidth", title: t("layout_card_width", {}, "Card width"), subtitle: t("layout_section_card_style_desc", {}, "Adjust poster card width"), value: String(model.layout.posterCardWidthDp) })}
            ${this.renderActionRow({ focusKey: "layout:posterRadius", title: t("layout_card_radius", {}, "Card corner radius"), subtitle: t("layout_section_card_style_desc", {}, "Adjust poster card corner radius"), value: String(model.layout.posterCardCornerRadiusDp) })}
            ${this.renderToggleRow({ focusKey: "layout:cardDepthEnabled", title: t("settings_card_depth_enabled", {}, "Enable depth effect"), subtitle: t("settings_card_depth_description", {}, "Add edge light and sheen to image cards"), checked: Boolean(model.layout.cardDepthEnabled) })}
            ${
              model.layout.cardDepthEnabled
                ? `
              ${this.renderActionRow({ focusKey: "layout:cardDepthEdge", title: t("settings_card_depth_edge_value", {}, "Edge glow"), value: `${model.layout.cardDepthEdgeStrength}%` })}
              ${this.renderActionRow({ focusKey: "layout:cardDepthSheen", title: t("settings_card_depth_sheen_value", {}, "Sheen"), value: `${model.layout.cardDepthSheenStrength}%` })}
              ${this.renderActionRow({ focusKey: "layout:cardDepthCoverage", title: t("settings_card_depth_coverage_value", {}, "Edge coverage"), value: `${model.layout.cardDepthEdgeCoverage}%` })}
              ${[
                ["PostersEnabled", "settings_card_depth_surface_posters"],
                ["ContinueWatchingEnabled", "settings_card_depth_surface_continue_watching"],
                ["EpisodeCardsEnabled", "settings_card_depth_surface_episodes"],
                ["CastEnabled", "settings_card_depth_surface_cast"],
                ["TrailersEnabled", "settings_card_depth_surface_trailers"]
              ]
                .map(([suffix, key]) =>
                  this.renderToggleRow({
                    focusKey: `layout:cardDepth${suffix}`,
                    title: t(key, {}, key),
                    checked: model.layout[`cardDepth${suffix}`] !== false
                  })
                )
                .join("")}
            `
                : ""
            }
          </div>`;

  return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "layout"))}
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-stack">
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:homeLayout",
                title: t("settings.layout.groups.homeLayout.title"),
                subtitle: t("settings.layout.groups.homeLayout.subtitle"),
                expanded: Boolean(expanded.homeLayout),
                bodyHtml: homeLayoutBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:homeContent",
                title: t("settings.layout.groups.homeContent.title"),
                subtitle: t("settings.layout.groups.homeContent.subtitle"),
                expanded: Boolean(expanded.homeContent),
                bodyHtml: homeContentBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:continueWatching",
                title: t("settings.layout.groups.continueWatching.title", {}, "Continue Watching"),
                subtitle: t("settings.layout.groups.continueWatching.subtitle", {}, "Configure next episodes and ordering"),
                expanded: Boolean(expanded.continueWatching),
                bodyHtml: continueWatchingBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:detailPage",
                title: t("settings.layout.groups.detailPage.title"),
                subtitle: t("settings.layout.groups.detailPage.subtitle"),
                expanded: Boolean(expanded.detailPage),
                bodyHtml: detailPageBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:focusedPoster",
                title: t("settings.layout.groups.focusedPoster.title"),
                subtitle: t("settings.layout.groups.focusedPoster.subtitle"),
                expanded: Boolean(expanded.focusedPoster),
                bodyHtml: focusedPosterBody
              })}
              ${this.renderCollapsibleRow({ focusKey: "layout:toggle:cardAppearance", title: t("settings_card_depth_title", {}, "Card appearance"), subtitle: t("settings_card_depth_description", {}, "Size, corners and depth surfaces"), expanded: Boolean(expanded.cardAppearance), bodyHtml: cardAppearanceBody })}
              ${this.renderCollapsibleRow({
                focusKey: "layout:toggle:customPosters",
                title: t("layout_custom_poster_title", {}, "Custom Poster Source"),
                subtitle: t("layout_section_custom_poster_desc", {}, "Use artwork from an external poster service."),
                expanded: Boolean(expanded.customPosters),
                bodyHtml: `<div class="settings-stack">${renderCustomPosterSettings.call(this)}</div>`
              })}
            </div>
          </div>
        `;
}
