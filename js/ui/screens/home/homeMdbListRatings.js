import {
  MdbListSettingsStore,
  MDBLIST_RATING_ORDER,
  MDBLIST_PROVIDER_SETTINGS
} from "../../../data/local/mdbListSettingsStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { showHomeRatings } from "../../../core/util/imdbRatingVisibility.js";
import { mdbListRatingIcon } from "../../../core/util/mdbListRatingStatus.js";
import { I18n } from "../../../i18n/index.js";
import { escapeHtml } from "./homeUtils.js";

export function getHeroMdbListRatings(hero, layoutMode = "modern", layoutPrefs = null) {
  const settings = MdbListSettingsStore.get();
  if (
    !settings.enabled ||
    !settings.showOnHero ||
    (layoutMode === "modern" &&
      !showHomeRatings((layoutPrefs || LayoutPreferences.get())?.homeImdbRatingsVisibility))
  ) {
    return [];
  }
  const ratings = hero?.mdbListRatings || {};
  return (settings.ratingOrder || MDBLIST_RATING_ORDER)
    .filter(
      (provider) =>
        settings[MDBLIST_PROVIDER_SETTINGS[provider]] !== false &&
        ratings[provider] != null &&
        String(ratings[provider]).trim() !== "" &&
        Number.isFinite(Number(ratings[provider])) &&
        Number(ratings[provider]) >= 0 &&
        Number(ratings[provider]) <=
          (["imdb", "mal"].includes(provider) ? 10 : provider === "letterboxd" ? 5 : 100)
    )
    .slice(0, layoutMode === "modern" ? 3 : 6)
    .map((provider) => ({ provider, value: Number(ratings[provider]) }));
}

export function renderHeroMdbListRatings(hero, layoutMode = "modern", layoutPrefs = null) {
  const items = getHeroMdbListRatings(hero, layoutMode, layoutPrefs);
  if (!items.length) return "";
  const icons = {
    imdb: "assets/icons/imdb_logo_2016.svg",
    trakt: "assets/icons/mdblist_trakt.svg",
    tmdb: "assets/icons/mdblist_tmdb.svg",
    letterboxd: "assets/icons/mdblist_letterboxd.svg",
    metacritic: "assets/icons/mdblist_metacritic.png",
    mal: "assets/icons/mdblist_mal.svg"
  };
  return `<span class="home-mdb-rating-items">${items
    .map(({ provider, value }) => {
      const fixed = ["imdb", "tmdb", "letterboxd"].includes(provider) || value % 1 !== 0;
      const text = new Intl.NumberFormat(I18n.getLocale(), {
        minimumFractionDigits: fixed ? 1 : 0,
        maximumFractionDigits: fixed ? 1 : 0,
        useGrouping: false
      }).format(value);
      const icon = icons[provider] || mdbListRatingIcon(provider, value, hero.mdbListRatings);
      return `<span class="home-mdb-rating-item"><img class="${provider === "imdb" ? "is-imdb" : ""}" src="${icon}" alt="${escapeHtml(provider)}" /><span>${escapeHtml(text)}</span></span>`;
    })
    .join("")}</span>`;
}
