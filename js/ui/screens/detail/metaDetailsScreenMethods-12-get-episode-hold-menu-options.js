import { getPosterListPickerOptions } from "../../components/posterOptionsMenu.js";
/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods12() {
  const { libraryRepository, NuvioDialog, isWatchProgressInProgress, t, resolveMetaImdbId, resolveMetaTmdbId, resolveMetaTraktId } =
    internals;

  return {
    getEpisodeHoldMenuOptions() {
      const episode = this.getEpisodeHoldMenuEpisode();
      if (!episode) {
        return [];
      }
      const watched = this.isEpisodeMarkedWatched(episode);
      const seasonFullyWatched = this.isSeasonFullyWatched(episode.season);
      const options = [
        {
          action: "toggleWatched",
          label: watched ? t("episodes_mark_unwatched", {}, "Mark as unwatched") : t("episodes_mark_watched", {}, "Mark as watched")
        },
        {
          action: seasonFullyWatched ? "markSeasonUnwatched" : "markSeasonWatched",
          label: seasonFullyWatched
            ? t("episodes_mark_season_unwatched", {}, "Mark season as unwatched")
            : t("episodes_mark_season_watched", {}, "Mark season as watched")
        }
      ];
      if (this.getPreviousEpisodes(episode).length > 0) {
        options.push({
          action: "markPreviousWatched",
          label: t("episodes_mark_previous_watched", {}, "Mark previous episodes as watched")
        });
      }
      const progress = this.getEpisodeMenuProgress(episode);
      options.push({
        action: "play",
        label: progress && isWatchProgressInProgress(progress) ? t("detail.resume", {}, "Resume") : t("episodes_play", {}, "Play")
      });
      options.push({
        action: "playManually",
        label: t("play_manually", {}, "Play manually")
      });
      if (progress && isWatchProgressInProgress(progress)) {
        options.push({
          action: "playFromBeginning",
          label: t("detail.playFromBeginning", {}, "Play from Beginning")
        });
      }
      return options;
    },
    getSeasonHoldMenuSeason() {
      const season = Number(this.seasonHoldMenu?.season);
      return Number.isFinite(season) && season >= 0 ? season : null;
    },
    getSeasonHoldMenuOptions() {
      const season = this.getSeasonHoldMenuSeason();
      if (season == null) {
        return [];
      }
      const fullyWatched = this.isSeasonFullyWatched(season);
      const options = [
        {
          action: fullyWatched ? "markSeasonUnwatched" : "markSeasonWatched",
          label: fullyWatched
            ? t("episodes_mark_season_unwatched", {}, "Mark season as unwatched")
            : t("episodes_mark_season_watched", {}, "Mark season as watched")
        }
      ];
      if (this.getPreviousSeasonEpisodes(season).length) {
        options.push({ action: "markPreviousSeasonsWatched", label: t("episodes_mark_previous_seasons_watched") });
      }
      return options;
    },
    getCurrentLibraryItem() {
      return {
        itemId: this.params?.itemId || this.meta?.id || "",
        itemType: this.params?.itemType || this.meta?.type || "movie",
        imdbId: resolveMetaImdbId(this.meta, this.params),
        tmdbId: resolveMetaTmdbId(this.meta, this.params),
        traktId: resolveMetaTraktId(this.meta, this.params),
        title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        poster: this.meta?.poster || null,
        background: this.meta?.background || this.meta?.landscapePoster || null,
        description: this.meta?.description || "",
        releaseInfo: this.meta?.releaseInfo || "",
        imdbRating: this.meta?.imdbRating == null ? null : Number(this.meta.imdbRating),
        genres: Array.isArray(this.meta?.genres) ? this.meta.genres : []
      };
    },
    async refreshLibraryMembership(token = this.detailLoadToken) {
      const mutationToken = this.libraryMembershipMutationToken || 0;
      const item = this.getCurrentLibraryItem();
      if (!item.itemId) {
        return false;
      }
      const snapshot = await libraryRepository.getMembershipSnapshot(item).catch((error) => {
        console.warn("Detail library membership refresh failed", error);
        return null;
      });
      if (token !== this.detailLoadToken || mutationToken !== (this.libraryMembershipMutationToken || 0) || !this.container || !snapshot) {
        return false;
      }
      const isSavedInLibrary = Object.values(snapshot.listMembership || {}).some(Boolean);
      if (this.isSavedInLibrary === isSavedInLibrary) {
        return true;
      }
      this.isSavedInLibrary = isSavedInLibrary;
      this.syncDetailActionButtons();
      return true;
    },
    getLibraryListMenuOptions() {
      // One builder for Detail, Home and the poster options menu, as Android shares one picker.
      return getPosterListPickerOptions(this.libraryListMenu);
    },
    destroyDetailHoldDialog() {
      if (this.detailHoldDialog) {
        this.detailHoldDialog.destroy();
        this.detailHoldDialog = null;
      }
    },
    focusDetailDescriptor(descriptor) {
      if (!descriptor || !this.container) {
        return false;
      }
      if (Number.isFinite(descriptor.episodeIndex) && descriptor.episodeIndex >= 0) {
        return this.focusEpisodeByIndex(Number(descriptor.episodeIndex), {
          animated: false,
          preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
        });
      }
      if (descriptor.episodeVideoId) {
        return this.focusEpisodeByVideoId(descriptor.episodeVideoId, {
          animated: false,
          preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
        });
      }
      if (!descriptor?.selector) {
        return false;
      }
      const target = this.container.querySelector(descriptor.selector);
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return this.focusInList([target], 0, {
        animated: false,
        preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
      });
    },
    mountEpisodeHoldDialog() {
      const episode = this.getEpisodeHoldMenuEpisode();
      if (!episode) {
        return false;
      }
      const options = this.getEpisodeHoldMenuOptions();
      const focusRestore = this.getEpisodeFocusDescriptor(episode.id);
      this.destroyDetailHoldDialog();
      this.detailHoldDialog = new NuvioDialog({
        title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        subtitle: [`S${Number(episode.season || 0)}E${Number(episode.episode || 0)}`, episode.title || ""].filter(Boolean).join(" - "),
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons: options.map((option, index) => ({
          label: option.label,
          key: option.action,
          onAction: () => {
            this.episodeHoldMenu = {
              ...(this.episodeHoldMenu || {}),
              optionIndex: index
            };
            void this.activateEpisodeHoldMenuOption();
          }
        })),
        onDismiss: () => {
          this.detailHoldDialog = null;
          this.episodeHoldMenu = null;
          this.focusDetailDescriptor(focusRestore);
        }
      }).mount(document.body);
      return true;
    },
    mountSeasonHoldDialog() {
      const season = this.getSeasonHoldMenuSeason();
      if (season == null) {
        return false;
      }
      const focusRestore = { selector: `.series-season-btn[data-season="${season}"]` };
      this.destroyDetailHoldDialog();
      this.detailHoldDialog = new NuvioDialog({
        title: season === 0 ? t("episodes_specials", {}, "Specials") : t("detail.seasonLabel", { season }, "Season {{season}}"),
        subtitle: t("episodes_season_actions", {}, "Season actions"),
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons: this.getSeasonHoldMenuOptions().map((option, index) => ({
          label: option.label,
          key: option.action,
          onAction: () => {
            this.seasonHoldMenu = {
              ...(this.seasonHoldMenu || {}),
              optionIndex: index
            };
            void this.activateSeasonHoldMenuOption();
          }
        })),
        onDismiss: () => {
          this.detailHoldDialog = null;
          this.seasonHoldMenu = null;
          this.focusDetailDescriptor(focusRestore);
        }
      }).mount(document.body);
      return true;
    },
    mountHeroPlayDialog() {
      const hasResume = Boolean(this.getActiveResumeProgress());
      const buttons = hasResume
        ? [
            {
              label: t("detail.resume", {}, "Resume"),
              key: "resume",
              onAction: () => {
                void this.activateHeroOptionsMenu("resume");
              }
            },
            {
              label: t("play_manually", {}, "Play manually"),
              key: "playManually",
              onAction: () => {
                void this.activateHeroOptionsMenu("playManually");
              }
            },
            {
              label: t("detail.playFromBeginning", {}, "Play from Beginning"),
              key: "playFromBeginning",
              onAction: () => {
                void this.activateHeroOptionsMenu("playFromBeginning");
              }
            }
          ]
        : [
            {
              label: t("play_manually", {}, "Play manually"),
              key: "playManually",
              onAction: () => {
                void this.activateHeroOptionsMenu("playManually");
              }
            }
          ];
      this.destroyDetailHoldDialog();
      this.detailHoldDialog = new NuvioDialog({
        title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
        subtitle: t("detail.playOptions", {}, "Play options"),
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons,
        onDismiss: () => {
          this.detailHoldDialog = null;
          this.heroPlayMenu = null;
          this.focusDetailDescriptor({
            selector: ".series-detail-actions [data-action='playDefault']"
          });
        }
      }).mount(document.body);
      return true;
    },
    mountLibraryListDialog() {
      if (!this.libraryListMenu) {
        return false;
      }
      const focusRestore = { selector: ".series-detail-actions [data-action='toggleLibrary']" };
      this.destroyDetailHoldDialog();
      this.detailHoldDialog = new NuvioDialog({
        title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
        subtitle: t("detail_lists_subtitle", {}, "Choose which lists should include this title"),
        error: this.libraryListMenu.error || null,
        widthVw: 52,
        suppressEnterUntilKeyUp: true,
        buttons: this.getLibraryListMenuOptions().map((option) => ({
          label: option.label,
          key: option.action,
          selected: option.selected,
          className: option.className,
          checkPlacement: option.checkPlacement,
          onAction: () => {
            void this.activateHeroOptionsMenu(option.action);
          }
        })),
        panelClassName: "poster-list-picker-dialog-panel",
        actionsClassName: "poster-list-picker-actions",
        onDismiss: () => {
          this.detailHoldDialog = null;
          this.libraryListMenu = null;
          this.focusDetailDescriptor(focusRestore);
        }
      }).mount(document.body);
      return true;
    },
    isEpisodeHoldTarget(node) {
      return Boolean(node?.matches?.(".series-episode-card.focusable"));
    },
    isSeasonHoldTarget(node) {
      return Boolean(node?.matches?.(".series-season-btn.focusable"));
    },
    isPosterHoldTarget(node) {
      return Boolean(node?.matches?.(".detail-morelike-card.focusable:not(.detail-trailer-card)"));
    },
    isHeroHoldTarget(node) {
      const action = String(node?.dataset?.action || "");
      return (
        Boolean(node?.matches?.(".series-primary-btn.focusable, .series-circle-btn.focusable")) &&
        (action === "playDefault" || action === "toggleLibrary")
      );
    },
    cancelPendingHeroHold() {
      if (this.pendingHeroHoldTimer) {
        clearTimeout(this.pendingHeroHoldTimer);
        this.pendingHeroHoldTimer = null;
      }
      this.pendingHeroHoldTarget = null;
    }
  };
}
