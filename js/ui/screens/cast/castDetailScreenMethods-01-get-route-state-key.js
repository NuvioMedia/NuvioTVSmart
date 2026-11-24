/* eslint-disable no-unused-vars */
import * as internals from "./castDetailScreen.js";
import {
  buildPersonCredits,
  calculatePersonAge,
  FILMOGRAPHY_FILTERS,
  filmographyView,
  formatPersonDate,
  personCreditsContainCjkTitles,
  shouldPreferCrewCredits
} from "../../../core/tmdb/personCredits.js";
import { customPosterForItem, posterFallbackAttributes } from "../../../core/poster/customPoster.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

const CJK_LANGUAGE_PREFIXES = ["ja", "ko", "zh"];
const FILTER_LABELS = {
  all: ["cast_detail_filter_all", "All"],
  movies: ["type_movies", "Movies"],
  series: ["type_series", "Series"]
};

export function createCastDetailScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    normalizeTmdbLanguageCode,
    TmdbSettingsStore,
    containsCjkOrHangul,
    resolvePersonName,
    TMDB_API_KEY,
    I18n,
    TMDB_BASE_URL,
    t,
    escapeHtml,
    escapeAttribute,
    toImage
  } = internals;

  return {
    getRouteStateKey(params = {}) {
      const castId = String(params?.castId || "").trim();
      const castName = String(params?.castName || "").trim();
      const identity = castId ? `id:${castId}` : castName ? `name:${castName}` : "";
      return identity ? `castDetail:${identity}` : null;
    },
    captureRouteState() {
      return {
        params: this.params ? { ...this.params } : {},
        person: this.person ? { ...this.person } : null,
        movieCredits: (this.movieCredits || []).map((item) => ({ ...item })),
        seriesCredits: (this.seriesCredits || []).map((item) => ({ ...item })),
        filmographyFilter: this.filmographyFilter,
        focusedItemId: String(this.lastFocusedItemId || ""),
        watchedTitleIds: Array.from(this.watchedTitleIds || [])
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      const currentKey = this.getRouteStateKey(params);
      if (
        !currentKey ||
        currentKey !== this.getRouteStateKey(snapshot?.params) ||
        !snapshot?.person ||
        typeof snapshot.person !== "object" ||
        !Array.isArray(snapshot.movieCredits) ||
        !Array.isArray(snapshot.seriesCredits)
      ) {
        return false;
      }
      this.params = params || {};
      this.person = { ...snapshot.person };
      this.movieCredits = snapshot.movieCredits.map((item) => ({ ...item }));
      this.seriesCredits = snapshot.seriesCredits.map((item) => ({ ...item }));
      // Android rememberSaveable: the filter survives opening a title and coming back.
      this.filmographyFilter = FILMOGRAPHY_FILTERS.includes(snapshot.filmographyFilter) ? snapshot.filmographyFilter : "all";
      this.lastFocusedItemId = String(snapshot.focusedItemId || "");
      this.watchedTitleIds = new Set(Array.isArray(snapshot.watchedTitleIds) ? snapshot.watchedTitleIds.map(String) : []);
      this.pendingRestoreFocus = true;
      return true;
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("castDetail");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.loadToken = (this.loadToken || 0) + 1;
      this.person = null;
      this.movieCredits = [];
      this.seriesCredits = [];
      this.filmographyFilter = "all";
      this.biographyExpanded = false;
      this.biographyTruncated = false;
      this.lastFocusedItemId = "";
      this.rowFocusIndex = 0;
      this.focusZone = "row";
      this.pendingRestoreFocus = false;
      this.watchedTitleIds = new Set();
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;

      if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
        this.render();
        void this.refreshWatchedTitleIds();
        return;
      }
      this.startLoad();
    },
    startLoad() {
      this.renderLoading();
      const loadToken = this.loadToken;
      // Android launches the person-detail request from the ViewModel after the
      // loading surface is composed. Do the same so a slow TMDB request cannot
      // hold the route or prevent Back from being handled.
      void this.loadCastDetails().catch((error) => {
        if (loadToken !== this.loadToken || Router.getCurrent() !== "castDetail") {
          return;
        }
        console.warn("Cast detail background load failed", error);
        this.renderError(error?.message || "");
      });
    },
    retryLoad() {
      this.loadToken = (this.loadToken || 0) + 1;
      this.startLoad();
    },
    async getPersonIdFromName(name) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!apiKey || !name) {
        return null;
      }
      const language = settings.language || "en-US";
      const url = `${TMDB_BASE_URL}/search/person?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&query=${encodeURIComponent(name)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      return first?.id ? String(first.id) : null;
    },
    async refreshWatchedTitleIds() {
      const token = this.loadToken;
      const items = [...(this.movieCredits || []), ...(this.seriesCredits || [])];
      const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
      const projected = await watchedTitleStateRepository
        .getTitleWatchedItems(items, { baseWatchedItems: watchedItems, limit: 5000 })
        .catch(() => watchedItems);
      if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
        return;
      }
      const next = buildWatchedTitleIdSet(projected);
      const changed = next.size !== this.watchedTitleIds?.size || Array.from(next).some((id) => !this.watchedTitleIds.has(id));
      this.watchedTitleIds = next;
      if (changed && this.person) {
        this.renderFilmographyRow();
      }
    },
    async loadCastDetails() {
      const token = this.loadToken;
      const loadError = () => t("cast_error_load_details_for", [this.params?.castName || ""], "Failed to load cast details");
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!apiKey) {
        this.renderError(loadError());
        return;
      }
      let personId = String(this.params?.castId || "").trim();
      if (!personId || !/^\d+$/.test(personId)) {
        personId = await this.getPersonIdFromName(this.params?.castName || "");
      }
      if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
        return;
      }
      if (!personId) {
        this.renderError(loadError());
        return;
      }

      const language = normalizeTmdbLanguageCode(settings.language || "en-US");
      const personUrl = (lang) =>
        `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=combined_credits`;
      const response = await fetch(personUrl(language));
      if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
        return;
      }
      if (!response.ok) {
        this.renderError(loadError());
        return;
      }
      const person = await response.json();
      if (token !== this.loadToken) {
        return;
      }
      const credits = person?.combined_credits || null;
      const languageCode = language.split("-", 1)[0].toLowerCase();
      const isCjkLanguage = CJK_LANGUAGE_PREFIXES.includes(languageCode);
      const localizedName = String(person?.name || "").trim();
      const originalName = String(person?.original_name || "").trim();
      // Android fetchPersonDetail: English details for a missing biography or a CJK-only
      // name, English credits for CJK titles, both only outside CJK languages.
      const shouldFetchEnglishPerson =
        languageCode !== "en" &&
        (String(person?.biography || "").trim() === "" ||
          (!isCjkLanguage && containsCjkOrHangul(localizedName) && (!originalName || containsCjkOrHangul(originalName))));
      const shouldFetchEnglishCredits = languageCode !== "en" && !isCjkLanguage && personCreditsContainCjkTitles(credits);
      let englishPerson = null;
      if (shouldFetchEnglishPerson || shouldFetchEnglishCredits) {
        try {
          const englishResponse = await fetch(personUrl("en"));
          if (englishResponse.ok) {
            englishPerson = await englishResponse.json();
          }
        } catch (error) {
          console.warn("Cast English fallback failed", error);
        }
      }
      if (token !== this.loadToken) {
        return;
      }
      const resolvedName =
        resolvePersonName({
          localizedName,
          originalName,
          fallbackEnglishName: shouldFetchEnglishPerson ? englishPerson?.name : "",
          preferredLanguage: language
        }) || "Unknown";
      const biography =
        String(person?.biography || "").trim() ||
        (languageCode !== "en" && shouldFetchEnglishPerson ? String(englishPerson?.biography || "").trim() : "");
      this.person = {
        id: String(person?.id || personId),
        name: resolvedName,
        biography: biography || null,
        birthday: String(person?.birthday || "").trim() || null,
        deathday: String(person?.deathday || "").trim() || null,
        placeOfBirth: String(person?.place_of_birth || "").trim() || null,
        profile: person?.profile_path ? toImage(person.profile_path) : ""
      };
      const { movieCredits, seriesCredits } = buildPersonCredits({
        credits,
        englishCredits: shouldFetchEnglishCredits ? englishPerson?.combined_credits : null,
        language,
        preferCrew: shouldPreferCrewCredits(this.params?.castRole)
      });
      this.movieCredits = movieCredits;
      this.seriesCredits = seriesCredits;
      this.render();
      void this.refreshWatchedTitleIds();
    },
    getFilmography() {
      return filmographyView(this.movieCredits || [], this.seriesCredits || [], this.filmographyFilter);
    },
    posterRadiusPx() {
      return Math.max(0, Number(LayoutPreferences.get()?.posterCardCornerRadiusDp ?? 12)) * 2;
    },
    renderLoading() {
      const name = String(this.params?.castName || "").trim();
      // Android CastDetailSkeleton.
      this.container.innerHTML = `
          <div class="cast-detail-shell cast-detail-skeleton" aria-busy="true">
            <section class="cast-detail-hero">
              <div class="cast-detail-portrait cast-skeleton-block"></div>
              <div class="cast-detail-info">
                <h1 class="cast-detail-name" dir="auto">${escapeHtml(name)}</h1>
                <div class="cast-skeleton-lines">
                  <div class="cast-skeleton-block cast-skeleton-line" style="width:60%"></div>
                  <div class="cast-skeleton-block cast-skeleton-line" style="width:48%"></div>
                  <div class="cast-skeleton-block cast-skeleton-line" style="width:72%"></div>
                  <div class="cast-skeleton-block cast-skeleton-line cast-skeleton-line-last" style="width:86%"></div>
                </div>
              </div>
            </section>
            <div class="cast-filmography-header">
              <div class="cast-skeleton-block cast-skeleton-title"></div>
              <div class="cast-skeleton-block cast-skeleton-count"></div>
            </div>
            <div class="cast-skeleton-row">
              ${Array.from({ length: 7 })
                .map(
                  () => `
              <div class="cast-skeleton-card">
                <div class="cast-skeleton-block cast-skeleton-poster"></div>
                <div class="cast-skeleton-block cast-skeleton-label"></div>
              </div>`
                )
                .join("")}
            </div>
          </div>
        `;
    },
    renderError(message = "") {
      // Android CastDetailError: title, message and Retry.
      this.container.innerHTML = `
          <div class="cast-detail-shell cast-detail-error">
            <div class="cast-detail-error-content">
              <h2 class="cast-detail-error-title">${escapeHtml(t("cast_detail_error", {}, "Something went wrong"))}</h2>
              ${message ? `<p class="cast-detail-error-message">${escapeHtml(message)}</p>` : ""}
              <button type="button" class="cast-detail-retry focusable" data-action="retry">${escapeHtml(t("cast_detail_retry", {}, "Retry"))}</button>
            </div>
          </div>
        `;
      this.focusZone = "error";
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container, ".cast-detail-retry");
    },
    renderInfoLines(person) {
      const lines = [];
      if (person.birthday) {
        const locale = I18n.getLocale();
        const age = calculatePersonAge(person.birthday, person.deathday);
        const ageText = age != null ? ` (${t("cast_detail_age", [age], `age ${age}`)})` : "";
        const birth = formatPersonDate(person.birthday, locale) || person.birthday;
        const death = person.deathday ? formatPersonDate(person.deathday, locale) || person.deathday : null;
        lines.push(
          (death
            ? t("cast_detail_born_died", [birth, death], `Born: ${birth} — †${death}`)
            : t("cast_detail_born", [birth], `Born: ${birth}`)) + ageText
        );
      }
      if (person.placeOfBirth) {
        lines.push(person.placeOfBirth);
      }
      return lines.length
        ? `<div class="cast-detail-facts">${lines.map((line) => `<div class="cast-detail-fact">${escapeHtml(line)}</div>`).join("")}</div>`
        : "";
    },
    renderHero() {
      const person = this.person || {};
      const name = person.name || "Unknown";
      const photo = String(person.profile || this.params?.castPhoto || "").trim();
      const expanded = Boolean(this.biographyExpanded);
      return `
          <section class="cast-detail-hero${expanded ? " is-expanded" : ""}">
            <div class="cast-detail-portrait${expanded || this.biographyTruncated ? " focusable" : ""}" data-action="toggleBiography" data-cast-zone="portrait">
              ${
                photo
                  ? `<img class="cast-detail-portrait-image" src="${escapeAttribute(photo)}" alt="${escapeAttribute(name)}" decoding="async" onerror="this.hidden=true" />`
                  : `<span class="cast-detail-portrait-initial">${escapeHtml(name.charAt(0).toUpperCase() || "?")}</span>`
              }
            </div>
            <div class="cast-detail-info">
              <h1 class="cast-detail-name" dir="auto">${escapeHtml(name)}</h1>
              ${this.renderInfoLines(person)}
              ${
                person.biography
                  ? `<div class="cast-detail-bio-wrap"><p class="cast-detail-bio" dir="auto">${escapeHtml(person.biography)}</p></div>
                     ${expanded ? `<div class="cast-detail-bio-hint">${escapeHtml(t("hero_synopsis_dismiss_hint", {}, "Press back to close"))}</div>` : ""}`
                  : ""
              }
            </div>
          </section>
        `;
    },
    renderFilmographyTabs(showFilter) {
      if (!showFilter) {
        return "";
      }
      return `
          <div class="cast-filmography-tabs" role="tablist">
            ${FILMOGRAPHY_FILTERS.map((filter) => {
              const [key, fallback] = FILTER_LABELS[filter];
              const selected = filter === this.filmographyFilter;
              return `<button type="button" class="cast-filmography-tab focusable${selected ? " is-selected" : ""}" role="tab" aria-selected="${selected ? "true" : "false"}" data-action="selectFilter" data-filter="${filter}" data-cast-zone="tabs">${escapeHtml(t(key, {}, fallback))}</button>`;
            }).join("")}
          </div>
        `;
    },
    renderCreditCard(rawItem, index, landscape) {
      const item = customPosterForItem(rawItem, "details", landscape ? "landscape" : "poster");
      const image = landscape ? String(item.landscapePoster || item.background || "").trim() : String(item.poster || "").trim();
      const watched = isTitleItemWatched(item, this.watchedTitleIds);
      return `
          <article class="cast-film-card focusable"
                   data-action="openDetail"
                   data-cast-zone="row"
                   data-card-index="${index}"
                   data-item-id="${escapeAttribute(item.id)}"
                   data-item-type="${escapeAttribute(item.type)}"
                   data-item-title="${escapeAttribute(item.name)}"
                   data-poster-src="${escapeAttribute(item.poster || "")}"
                   data-backdrop-src="${escapeAttribute(item.background || "")}"
                   aria-label="${escapeAttribute(item.name)}">
            <div class="cast-film-card-media">
              ${
                image
                  ? `<img class="cast-film-card-image" ${posterFallbackAttributes(item, landscape)} src="${escapeAttribute(image)}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true" />`
                  : ""
              }
              ${watched ? renderTitleWatchedBadge() : ""}
            </div>
            <div class="cast-film-card-title" dir="auto">${escapeHtml(item.name)}</div>
          </article>
        `;
    },
    renderFilmographyTrack() {
      const { credits } = this.getFilmography();
      const landscape = Boolean(LayoutPreferences.get()?.modernLandscapePostersEnabled);
      return credits.map((item, index) => this.renderCreditCard(item, index, landscape)).join("");
    },
    renderFilmography() {
      const { all, credits, showFilter } = this.getFilmography();
      if (!all.length || this.biographyExpanded) {
        return "";
      }
      const landscape = Boolean(LayoutPreferences.get()?.modernLandscapePostersEnabled);
      return `
          <section class="cast-filmography${landscape ? " is-landscape" : ""}" style="--cast-poster-radius:${this.posterRadiusPx()}px">
            <div class="cast-filmography-header">
              <h2 class="cast-filmography-title">${escapeHtml(t("cast_detail_filmography", {}, "Filmography"))}</h2>
              <span class="cast-filmography-count">${credits.length}</span>
              ${this.renderFilmographyTabs(showFilter)}
            </div>
            <div class="cast-filmography-row">
              <div class="cast-filmography-track">${this.renderFilmographyTrack()}</div>
            </div>
          </section>
        `;
    },
    /** Re-render only the posters, e.g. for a filter change or new watched marks. */
    renderFilmographyRow() {
      const section = this.container?.querySelector(".cast-filmography");
      const track = section?.querySelector(".cast-filmography-track");
      if (!track) {
        return;
      }
      const { credits } = this.getFilmography();
      section.querySelector(".cast-filmography-count").textContent = String(credits.length);
      track.innerHTML = this.renderFilmographyTrack();
      ScreenUtils.indexFocusables(this.container);
      this.applyFocus({ instant: true });
    },
    render() {
      this.container.innerHTML = `
          <div class="cast-detail-shell${this.biographyExpanded ? " is-biography-expanded" : ""}">
            ${this.renderHero()}
            ${this.renderFilmography()}
          </div>
        `;
      this.syncBiographyTruncation();
      ScreenUtils.indexFocusables(this.container);
      if (this.pendingRestoreFocus) {
        this.pendingRestoreFocus = false;
        const index = this.getRowCards().findIndex((node) => node.dataset.itemId === this.lastFocusedItemId);
        this.rowFocusIndex = Math.max(0, index);
        this.focusZone = "row";
      }
      if (this.focusZone !== "portrait" && !this.getRowCards().length) {
        this.focusZone = this.getPortrait() ? "portrait" : "row";
      }
      this.applyFocus({ instant: true });
    },
    /** Android: the portrait can be focused only to open a biography that does not fit. */
    syncBiographyTruncation() {
      const bio = this.container?.querySelector(".cast-detail-bio");
      if (this.biographyExpanded || !bio) {
        return;
      }
      const truncated = bio.scrollHeight > bio.clientHeight + 1;
      if (truncated === this.biographyTruncated) {
        return;
      }
      this.biographyTruncated = truncated;
      this.container.querySelector(".cast-detail-portrait")?.classList.toggle("focusable", truncated);
    }
  };
}
