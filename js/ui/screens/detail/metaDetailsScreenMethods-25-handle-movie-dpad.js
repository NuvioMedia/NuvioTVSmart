/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods25() {
  const { isSeriesDetailMeta } = internals;

  return {
    handleMovieDpad(event) {
      if (!this.meta || isSeriesDetailMeta(this.meta, this.episodes) || this.pendingEpisodeSelection || this.pendingMovieSelection) {
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
      const actions = focusLists.actions;
      const tabs = focusLists.insightTabs;
      const cast = focusLists.castCards;
      const moreLikeCards = focusLists.moreLikeCards;
      const commentModes = focusLists.commentModes;
      const commentCards = focusLists.commentCards;
      const moreLikeRememberedIndex = this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards);
      const companyTracks = focusLists.companyTracks;
      const companyCards = focusLists.companyCards;
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
        if (
          (this.movieInsightTab === "morelike" || this.movieInsightTab === "trailer" || this.movieInsightTab === "collection") &&
          moreLikeCards.length
        ) {
          return this.focusInList(moreLikeCards, this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards));
        }
        if (cast.length) return this.focusInList(cast, Math.min(index, cast.length - 1));
        if (tabs.length) return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs));
        return this.focusInList(actions, Math.min(index, actions.length - 1));
      };

      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }

      const actionIndex = actions.indexOf(current);
      if (actionIndex >= 0) {
        if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
        if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
        if (direction === "down") {
          if (tabs.length) {
            return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
          }
          if (cast.length) {
            return this.focusInList(cast, 0) || true;
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

      const tabIndex = tabs.indexOf(current);
      if (tabIndex >= 0) {
        if (direction === "left") return this.focusInList(tabs, tabIndex - 1, { preserveVerticalScroll: true }) || true;
        if (direction === "right") return this.focusInList(tabs, tabIndex + 1, { preserveVerticalScroll: true }) || true;
        if (direction === "up") return this.focusInList(actions, Math.min(tabIndex, actions.length - 1)) || true;
        if (direction === "down") {
          if (cast.length) return this.focusInList(cast, 0) || true;
          if (moreLikeCards.length) return this.focusInList(moreLikeCards, 0) || true;
          if (focusCommentsEntry(0)) return true;
          if (companyCards[0]?.length) return this.focusInList(companyCards[0], 0) || true;
        }
        return true;
      }

      const castIndex = cast.indexOf(current);
      if (castIndex >= 0) {
        if (direction === "left") return this.focusInList(cast, castIndex - 1) || true;
        if (direction === "right") return this.focusInList(cast, castIndex + 1) || true;
        if (direction === "up") {
          if (tabs.length) {
            return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
          }
          return this.focusInList(actions, Math.min(castIndex, actions.length - 1)) || true;
        }
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
        }
        if (direction === "down" && companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
        return true;
      }

      const moreLikeIndex = moreLikeCards.indexOf(current);
      if (moreLikeIndex >= 0) {
        if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
        if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
        if (direction === "up") {
          if (tabs.length) {
            return this.focusInList(tabs, this.getInsightTabIndexForPreviewRail(tabs, current)) || true;
          }
          if (cast.length) {
            return this.focusInList(cast, Math.min(moreLikeIndex, cast.length - 1)) || true;
          }
          return this.focusInList(actions, Math.min(moreLikeIndex, actions.length - 1)) || true;
        }
        if (direction === "down" && focusCommentsEntry(0)) {
          return true;
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
        if (direction === "down" && companyCards[0]?.length) return this.focusInList(companyCards[0], 0) || true;
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
          if (cast.length) {
            return this.focusInList(cast, Math.min(companyIndex, cast.length - 1)) || true;
          }
          if (tabs.length) {
            return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
          }
          return this.focusInList(actions, Math.min(companyIndex, actions.length - 1)) || true;
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
