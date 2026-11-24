/* eslint-disable no-unused-vars */
import * as internals from "./castDetailScreen.js";
import { isTalkShowGuestAppearance } from "../../../core/tmdb/talkShowCredits.js";

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
    renderLoadingIndicator,
    TMDB_BASE_URL,
    t,
    escapeHtml,
    escapeAttribute,
    toImage,
    toType,
    todayIsoDate,
    uniqueCredits
  } = internals;

  return {
    getRouteStateKey(params = {}) {
      const castId = String(params?.castId || "").trim();
      const castName = String(params?.castName || "").trim();
      const identity = castId ? `id:${castId}` : castName ? `name:${castName}` : "";
      return identity ? `castDetail:${identity}` : null;
    },
    captureRouteState() {
      const focused = this.container?.querySelector(".cast-credit-card.focusable.focused");
      if (focused) {
        this.rememberFocusedCard(focused);
      }
      return {
        params: this.params ? { ...this.params } : {},
        person: this.person ? { ...this.person } : null,
        credits: Array.isArray(this.credits) ? this.credits.map((item) => ({ ...item })) : [],
        sectionFocusIndexByKey: { ...(this.sectionFocusIndexByKey || {}) },
        focusedSectionKey: String(this.lastFocusedSectionKey || ""),
        focusedItemId: String(this.lastFocusedItemId || "")
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      const currentKey = this.getRouteStateKey(params);
      const snapshotKey = this.getRouteStateKey(snapshot?.params);
      if (
        !currentKey ||
        currentKey !== snapshotKey ||
        !snapshot?.person ||
        typeof snapshot.person !== "object" ||
        !Array.isArray(snapshot.credits)
      ) {
        return false;
      }
      this.params = params || {};
      this.person = { ...snapshot.person };
      this.credits = snapshot.credits.map((item) => ({ ...item }));
      this.sectionFocusIndexByKey =
        snapshot.sectionFocusIndexByKey && typeof snapshot.sectionFocusIndexByKey === "object"
          ? { ...snapshot.sectionFocusIndexByKey }
          : {};
      this.lastFocusedSectionKey = String(snapshot.focusedSectionKey || "");
      this.lastFocusedItemId = String(snapshot.focusedItemId || "");
      this.pendingRestoreFocus = true;
      return true;
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("castDetail");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.loadToken = (this.loadToken || 0) + 1;
      this.person = null;
      this.credits = [];
      this.sectionFocusIndexByKey = {};
      this.lastFocusedSectionKey = "";
      this.lastFocusedItemId = "";
      this.pendingRestoreFocus = false;
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;

      if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
        this.render();
        return;
      }

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
        this.renderError("Failed to load cast details.");
      });
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
    async loadCastDetails() {
      const token = this.loadToken;
      try {
        const settings = TmdbSettingsStore.get();
        const apiKey = String(TMDB_API_KEY || "").trim();
        if (!apiKey) {
          if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
            return;
          }
          this.renderError("TMDB API key not configured.");
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
          this.renderError("Cast profile not found.");
          return;
        }

        const language = normalizeTmdbLanguageCode(settings.language || "en-US");
        const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&append_to_response=combined_credits,images`;
        const response = await fetch(url);
        if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
          return;
        }
        if (!response.ok) {
          this.renderError("Failed to load cast details.");
          return;
        }
        const person = await response.json();
        if (token !== this.loadToken) {
          return;
        }
        const languageCode = language.split("-", 1)[0].toLowerCase();
        const localizedName = String(person?.name || "").trim();
        const originalName = String(person?.original_name || "").trim();
        const shouldFetchEnglishPerson =
          languageCode !== "en" &&
          (String(person?.biography || "").trim() === "" ||
            (containsCjkOrHangul(localizedName) && (!originalName || containsCjkOrHangul(originalName))));
        let englishPerson = null;
        if (shouldFetchEnglishPerson) {
          try {
            const englishUrl = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=en&append_to_response=combined_credits,images`;
            const englishResponse = await fetch(englishUrl);
            if (englishResponse.ok) {
              englishPerson = await englishResponse.json();
            }
          } catch (error) {
            console.warn("Cast English name fallback failed", error);
          }
        }
        if (token !== this.loadToken) {
          return;
        }
        const resolvedName =
          resolvePersonName({
            localizedName: localizedName,
            originalName,
            fallbackEnglishName: englishPerson?.name,
            preferredLanguage: language
          }) ||
          this.params?.castName ||
          "Unknown";
        this.person = {
          id: String(person?.id || personId),
          name: resolvedName,
          biography: String(person?.biography || "").trim() || (languageCode !== "en" ? String(englishPerson?.biography || "").trim() : ""),
          birthday: person?.birthday || "",
          placeOfBirth: person?.place_of_birth || "",
          knownForDepartment: person?.known_for_department || "",
          profile: toImage(person?.profile_path || this.params?.castPhoto || "")
        };
        const credits = Array.isArray(person?.combined_credits?.cast) ? person.combined_credits.cast : [];
        this.credits = credits
          .filter((item) => !isTalkShowGuestAppearance(item))
          .map((item) => ({
            id: item?.id ? String(item.id) : "",
            // TMDB credits expose a numeric TMDB id. Keep the same canonical
            // identity used by Android TV so the detail route can resolve it to
            // the IMDb id expected by the metadata addons before loading episodes.
            itemId: item?.imdb_id || (item?.id ? `tmdb:${String(item.id)}` : ""),
            type: toType(item?.media_type),
            name: item?.title || item?.name || "Untitled",
            subtitle: item?.character || "",
            poster: toImage(item?.poster_path || item?.backdrop_path || ""),
            popularity: Number(item?.popularity || 0),
            releaseDate: String(item?.release_date || item?.first_air_date || "")
          }))
          .filter((item) => Boolean(item.itemId))
          .sort((left, right) => right.popularity - left.popularity);

        this.render();
      } catch (error) {
        if (token !== this.loadToken || Router.getCurrent() !== "castDetail") {
          return;
        }
        console.warn("Cast detail load failed", error);
        this.renderError("Failed to load cast details.");
      }
    },
    renderLoading() {
      this.container.innerHTML = `
          <div class="cast-detail-shell">
            <div class="cast-detail-loading">
              ${renderLoadingIndicator()}
              <span>Loading cast profile...</span>
            </div>
          </div>
        `;
    },
    renderError(message) {
      this.container.innerHTML = `
          <div class="cast-detail-shell">
            <button class="cast-detail-back focusable" data-action="back" aria-label="${escapeAttribute(t("common.back", {}, "Back"))}">
              <span class="material-icons" aria-hidden="true">arrow_back</span>
            </button>
            <div class="cast-detail-error">${message}</div>
          </div>
        `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    getCreditSections() {
      const allCredits = uniqueCredits(this.credits);
      const today = todayIsoDate();
      const popular = [...allCredits].sort((left, right) => right.popularity - left.popularity);
      const latest = allCredits
        .filter((item) => item.releaseDate && item.releaseDate <= today)
        .sort((left, right) => String(right.releaseDate || "").localeCompare(String(left.releaseDate || "")));
      const upcoming = allCredits
        .filter((item) => item.releaseDate && item.releaseDate > today)
        .sort((left, right) => String(left.releaseDate || "").localeCompare(String(right.releaseDate || "")));

      return [
        { key: "popular", title: t("person_popular", {}, "Popular"), items: popular },
        { key: "latest", title: t("person_latest", {}, "Latest"), items: latest },
        { key: "upcoming", title: t("person_upcoming", {}, "Upcoming"), items: upcoming }
      ].filter((section) => section.items.length);
    },
    renderCreditCard(item) {
      return `
          <article class="cast-credit-card focusable"
                   data-action="openDetail"
                   data-item-id="${escapeAttribute(item.itemId)}"
                   data-item-type="${escapeAttribute(item.type)}"
                   data-item-title="${escapeAttribute(item.name)}"
                   data-poster-src="${escapeAttribute(item.poster || "")}"
                   data-backdrop-src="${escapeAttribute(item.poster || "")}">
            <div class="cast-credit-poster"${item.poster ? ` style="background-image:url('${escapeAttribute(item.poster)}')"` : ""}></div>
            <div class="cast-credit-title" dir="auto">${escapeHtml(item.name)}</div>
            <div class="cast-credit-subtitle" dir="auto">${escapeHtml(item.subtitle || item.type)}</div>
          </article>
        `;
    },
    renderCreditSections() {
      const sections = this.getCreditSections();
      if (!sections.length) {
        return `<div class="cast-credit-empty">${escapeHtml(t("cast_detail_empty", {}, "No titles found for this cast member."))}</div>`;
      }
      return sections
        .map(
          (section) => `
              <section class="cast-credit-section" data-credit-section="${escapeAttribute(section.key)}">
                <h3 class="cast-detail-section-title" dir="${I18n.isRtl() ? "rtl" : "ltr"}">${escapeHtml(section.title)}</h3>
                <div class="cast-credit-track">${section.items.map((item) => this.renderCreditCard(item)).join("")}</div>
              </section>
            `
        )
        .join("");
    },
    render() {
      const person = this.person || {};
      const creditsHtml = this.renderCreditSections();
      const direction = I18n.isRtl() ? "rtl" : "ltr";

      this.container.innerHTML = `
          <div class="cast-detail-shell">
            <section class="cast-detail-hero">
              <div class="cast-detail-hero-content" dir="${direction}">
                <div class="cast-detail-avatar"${person.profile ? ` style="background-image:url('${escapeAttribute(person.profile)}')"` : ""}></div>
                <div class="cast-detail-meta">
                  <h2 class="cast-detail-name" dir="auto">${escapeHtml(person.name || "Unknown")}</h2>
                  <div class="cast-detail-facts">
                    ${person.knownForDepartment ? `<span>${escapeHtml(person.knownForDepartment)}</span>` : ""}
                    ${person.birthday ? `<span>${escapeHtml(person.birthday)}</span>` : ""}
                    ${person.placeOfBirth ? `<span>${escapeHtml(person.placeOfBirth)}</span>` : ""}
                  </div>
                  <p class="cast-detail-bio">${escapeHtml(person.biography || "No biography available.")}</p>
                </div>
              </div>
            </section>
            <section class="cast-detail-credits">
              ${creditsHtml}
            </section>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      if (this.pendingRestoreFocus) {
        this.pendingRestoreFocus = false;
        if (this.restoreFocusedCard()) {
          return;
        }
      }
      ScreenUtils.setInitialFocus(this.container, ".cast-credit-card.focusable");
      const initial = this.container.querySelector(".cast-credit-card.focusable.focused");
      if (initial) {
        this.rememberFocusedCard(initial);
      }
      this.syncFocusedCardScroll({ instant: true });
    },
    getCreditCardNodes(section = null) {
      if (section instanceof HTMLElement) {
        return Array.from(section.querySelectorAll(".cast-credit-card.focusable"));
      }
      return Array.from(this.container?.querySelectorAll(".cast-credit-card.focusable") || []);
    }
  };
}
