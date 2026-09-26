/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods24() {
  const { isSeriesDetailMeta } = internals;

  return {
    handleSeriesDpad(event) {
      if (!this.meta || !isSeriesDetailMeta(this.meta, this.episodes) || this.pendingEpisodeSelection || this.pendingMovieSelection) {
        return false;
      }
      const keyCode = Number(event?.keyCode || 0);
      const direction = keyCode === 37 ? "left" : keyCode === 39 ? "right" : keyCode === 38 ? "up" : keyCode === 40 ? "down" : null;
      if (!direction) {
        return false;
      }

      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return false;
      }

      const focusLists = this.getDetailFocusLists();
      if (!focusLists) {
        return false;
      }
      const {
        actions,
        seasons,
        episodes,
        insightTabs,
        castCards,
        ratingSeasons,
        ratingChips,
        moreLikeCards,
        commentModes,
        commentCards,
        companyTracks,
        companyCards
      } = focusLists;
      const moreLikeRememberedIndex = this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards);
      const rememberedCompanyIndex = (trackIndex = 0) => this.getRememberedCompanyIndex(companyTracks, companyCards, trackIndex);
      const focusCommentsEntry = (index = 0, options = {}) => {
        if (commentModes.length) {
          return this.focusInList(commentModes, Math.min(index, commentModes.length - 1), options);
        }
        if (commentCards.length) {
          return this.focusInList(commentCards, Math.min(index, commentCards.length - 1), options);
        }
        return false;
      };
      const focusActiveSectionFromComments = (index = 0) => {
        if (this.seriesInsightTab === "ratings") {
          if (ratingChips.length) return this.focusInList(ratingChips, Math.min(index, ratingChips.length - 1));
          if (ratingSeasons.length) return this.focusInList(ratingSeasons, Math.min(index, ratingSeasons.length - 1));
        }
        if (
          (this.seriesInsightTab === "morelike" || this.seriesInsightTab === "trailer" || this.seriesInsightTab === "collection") &&
          moreLikeCards.length
        ) {
          return this.focusInList(moreLikeCards, this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards));
        }
        if (castCards.length) return this.focusInList(castCards, Math.min(index, castCards.length - 1));
        if (insightTabs.length) return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs));
        if (episodes.length)
          return this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
            preserveVerticalScroll: false
          });
        return false;
      };
      const focusFirstSeriesSectionBelowHero = () => {
        if (insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs));
        }
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, 0);
        }
        if (castCards.length) {
          return this.focusInList(castCards, 0);
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0);
        }
        if (focusCommentsEntry(0)) {
          return true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0);
        }
        return false;
      };
      const focusSeriesSectionAboveInsights = (index = 0) => {
        if (episodes.length) {
          return this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
            preserveVerticalScroll: false
          });
        }
        if (seasons.length) {
          return this.focusInList(seasons, Math.min(index, seasons.length - 1));
        }
        if (actions.length) {
          return this.focusInList(actions, Math.min(index, actions.length - 1));
        }
        return false;
      };

      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }

      const actionIndex = actions.indexOf(current);
      if (actionIndex >= 0) {
        if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
        if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
        if (direction === "down") {
          if (seasons.length) {
            return this.focusInList(seasons, this.getSelectedSeasonIndex(seasons)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
          if (focusFirstSeriesSectionBelowHero()) {
            return true;
          }
        }
        return true;
      }

      const seasonIndex = seasons.indexOf(current);
      if (seasonIndex >= 0) {
        if (direction === "left") return this.focusInList(seasons, seasonIndex - 1) || true;
        if (direction === "right") return this.focusInList(seasons, seasonIndex + 1) || true;
        if (direction === "up") {
          if (actions.length) {
            return this.focusInList(actions, Math.min(seasonIndex, actions.length - 1)) || true;
          }
        }
        if (direction === "down") {
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
          if (focusFirstSeriesSectionBelowHero()) {
            return true;
          }
        }
        return true;
      }

      const episodeIndex = episodes.indexOf(current);
      if (episodeIndex >= 0) {
        const absoluteEpisodeIndex = Number(current.dataset.episodeIndex || episodeIndex);
        if (direction === "left") return this.focusEpisodeByIndex(absoluteEpisodeIndex - 1, { preserveVerticalScroll: true }) || true;
        if (direction === "right") return this.focusEpisodeByIndex(absoluteEpisodeIndex + 1, { preserveVerticalScroll: true }) || true;
        if (direction === "up") {
          if (seasons.length) {
            return (
              this.focusInList(seasons, this.getSelectedSeasonIndex(seasons), {
                preserveVerticalScroll: true
              }) || true
            );
          }
          if (actions.length) {
            return this.focusInList(actions, Math.min(absoluteEpisodeIndex, actions.length - 1)) || true;
          }
        }
        if (direction === "down" && insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
        }
        if (direction === "down") {
          if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
            return this.focusInList(ratingSeasons, 0) || true;
          }
          if (castCards.length) {
            return this.focusInList(castCards, 0) || true;
          }
          if (moreLikeCards.length) {
            return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
          }
          if (companyCards[0]?.length) {
            return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
          }
        }
        return true;
      }

      const tabIndex = insightTabs.indexOf(current);
      if (tabIndex >= 0) {
        if (direction === "left") return this.focusInList(insightTabs, tabIndex - 1, { preserveVerticalScroll: true }) || true;
        if (direction === "right") return this.focusInList(insightTabs, tabIndex + 1, { preserveVerticalScroll: true }) || true;
        if (direction === "up") {
          if (focusSeriesSectionAboveInsights(tabIndex)) {
            return true;
          }
        }
        if (direction === "down") {
          if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
            return this.focusInList(ratingSeasons, 0) || true;
          }
          if (castCards.length) {
            return this.focusInList(castCards, 0) || true;
          }
          if (moreLikeCards.length) {
            return this.focusInList(moreLikeCards, 0) || true;
          }
          if (companyCards[0]?.length) {
            return this.focusInList(companyCards[0], 0) || true;
          }
        }
        return true;
      }

      const castIndex = castCards.indexOf(current);
      if (castIndex >= 0) {
        if (direction === "left") return this.focusInList(castCards, castIndex - 1) || true;
        if (direction === "right") return this.focusInList(castCards, castIndex + 1) || true;
        if (direction === "up") {
          if (insightTabs.length) {
            return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
        }
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (direction === "down" && companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
        return true;
      }

      const ratingSeasonIndex = ratingSeasons.indexOf(current);
      if (ratingSeasonIndex >= 0) {
        if (direction === "left") return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
        if (direction === "right") return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
        if (direction === "up") {
          if (insightTabs.length) {
            return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
        }
        if (direction === "down" && ratingChips.length) {
          return this.focusInList(ratingChips, 0) || true;
        }
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
        }
        return true;
      }

      const ratingChipIndex = ratingChips.indexOf(current);
      if (ratingChipIndex >= 0) {
        if (direction === "left") return this.focusInList(ratingChips, ratingChipIndex - 1) || true;
        if (direction === "right") return this.focusInList(ratingChips, ratingChipIndex + 1) || true;
        if (direction === "up") {
          if (ratingSeasons.length) {
            return this.focusInList(ratingSeasons, Math.min(ratingChipIndex, ratingSeasons.length - 1)) || true;
          }
          if (insightTabs.length) {
            return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
        }
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (direction === "down" && companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
        return true;
      }

      const commentModeIndex = commentModes.indexOf(current);
      if (commentModeIndex >= 0) {
        if (direction === "left")
          return (
            this.focusInList(commentModes, commentModeIndex - 1, {
              preserveVerticalScroll: true
            }) || true
          );
        if (direction === "right")
          return (
            this.focusInList(commentModes, commentModeIndex + 1, {
              preserveVerticalScroll: true
            }) || true
          );
        if (direction === "up") return focusActiveSectionFromComments(commentModeIndex) || true;
        if (direction === "down" && commentCards.length) return this.focusInList(commentCards, 0) || true;
        return true;
      }

      const commentCardIndex = commentCards.indexOf(current);
      if (commentCardIndex >= 0) {
        if (direction === "left")
          return (
            this.focusInList(commentCards, commentCardIndex - 1, {
              preserveVerticalScroll: true
            }) || true
          );
        if (direction === "right")
          return (
            this.focusInList(commentCards, commentCardIndex + 1, {
              preserveVerticalScroll: true
            }) || true
          );
        if (direction === "up") {
          if (commentModes.length)
            return (
              this.focusInList(commentModes, Math.min(commentCardIndex, commentModes.length - 1), {
                preserveVerticalScroll: true
              }) || true
            );
          return focusActiveSectionFromComments(commentCardIndex) || true;
        }
        if (direction === "down" && companyCards[0]?.length) return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
        return true;
      }

      const moreLikeIndex = moreLikeCards.indexOf(current);
      if (moreLikeIndex >= 0) {
        if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
        if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
        if (direction === "up") {
          if (insightTabs.length) {
            return this.focusInList(insightTabs, this.getInsightTabIndexForPreviewRail(insightTabs, current)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
        }
        if (direction === "down" && companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
        return true;
      }

      for (let trackIndex = 0; trackIndex < companyCards.length; trackIndex += 1) {
        const cards = companyCards[trackIndex];
        const companyIndex = cards.indexOf(current);
        if (companyIndex < 0) {
          continue;
        }
        if (direction === "left") return this.focusInList(cards, companyIndex - 1) || true;
        if (direction === "right") return this.focusInList(cards, companyIndex + 1) || true;
        if (direction === "up") {
          if (trackIndex > 0 && companyCards[trackIndex - 1]?.length) {
            return this.focusInList(companyCards[trackIndex - 1], rememberedCompanyIndex(trackIndex - 1)) || true;
          }
          if (commentCards.length || commentModes.length) {
            return focusCommentsEntry(companyIndex) || true;
          }
          if (moreLikeCards.length) {
            return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
          }
          if (this.seriesInsightTab === "ratings" && ratingChips.length) {
            return this.focusInList(ratingChips, Math.min(companyIndex, ratingChips.length - 1)) || true;
          }
          if (castCards.length) {
            return this.focusInList(castCards, Math.min(companyIndex, castCards.length - 1)) || true;
          }
          if (insightTabs.length) {
            return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
          }
          if (episodes.length) {
            return (
              this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
                preserveVerticalScroll: false
              }) || true
            );
          }
        }
        if (direction === "down" && trackIndex < companyCards.length - 1 && companyCards[trackIndex + 1]?.length) {
          return this.focusInList(companyCards[trackIndex + 1], 0) || true;
        }
        return true;
      }

      return false;
    }
  };
}
