import {
  ProfanityFilterStore,
  normalizeTitleKey,
  resolveProfanityFilterForTitle,
  shouldLookUpTitleRating
} from "../../../data/local/profanityFilterStore.js";
import { resolveTitleContentRating } from "../../../core/player/profanityRatingResolver.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function detailProfanityTitleKey(screen, meta = screen?.meta) {
  return normalizeTitleKey(screen?.params?.itemId || meta?.imdbId || meta?.id || "");
}

export function detailProfanityDecision(screen, meta = screen?.meta) {
  const titleKey = detailProfanityTitleKey(screen, meta);
  const rating = String(meta?.ageRating || "").trim();
  if (titleKey && rating) {
    ProfanityFilterStore.rememberRating(titleKey, rating);
  }
  return { titleKey, ...resolveProfanityFilterForTitle({ titleKey, rating }) };
}

export function renderProfanityGlyph(enabled) {
  // Same glyph in both states; the selected button style shows "on".
  return `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5v-14L7 9.5H3z" fill="currentColor"/><path d="M15.5 9l6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity="${enabled ? "1" : "0.55"}"/></svg>`;
}

export function renderDetailProfanityButton(screen, meta, t) {
  const decision = detailProfanityDecision(screen, meta);
  // Hidden entirely until the filter is turned on in Settings.
  if (!decision.titleKey || decision.reason === "disabled") {
    return "";
  }
  const label = decision.enabled
    ? t("profanity_detail_turn_off", {}, "Turn off profanity filter for this title")
    : t("profanity_detail_turn_on", {}, "Turn on profanity filter for this title");
  return `<button class="series-circle-btn focusable${decision.enabled ? " is-selected" : ""}" data-action="toggleProfanityFilter" aria-pressed="${decision.enabled ? "true" : "false"}" aria-label="${escapeHtml(label)}">${renderProfanityGlyph(decision.enabled)}</button>`;
}

/** Status line under the actions, shown only while the filter is on. */
export function renderDetailProfanityStatus(screen, meta, t) {
  const decision = detailProfanityDecision(screen, meta);
  maybeResolveDetailRating(screen, meta, decision);
  if (!decision.titleKey || !decision.enabled) {
    return "";
  }
  const parts = [t("profanity_detail_status_on", {}, "Profanity filter on")];
  if (decision.reason === "rating" && decision.rating) {
    parts.push(
      t("profanity_detail_status_rating", [decision.rating], `Auto for ${decision.rating}`)
    );
  } else if (decision.reason === "title_on") {
    parts.push(t("profanity_detail_status_title", {}, "Set for this title"));
  } else if (decision.reason === "always") {
    parts.push(t("profanity_detail_status_always", {}, "On for all titles"));
  }
  return `<div class="detail-resume-indicator detail-profanity-status">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
}

/**
 * The addon meta often has no rating. Look it up once in the background and
 * re-render if it turns the filter on (a TV-MA show, for instance).
 */
function maybeResolveDetailRating(screen, meta, decision) {
  if (
    !screen ||
    decision.reason !== "unrated" ||
    !decision.titleKey ||
    !shouldLookUpTitleRating(decision.titleKey)
  ) {
    return;
  }
  screen.profanityRatingLookups = screen.profanityRatingLookups || new Set();
  if (screen.profanityRatingLookups.has(decision.titleKey)) {
    return;
  }
  screen.profanityRatingLookups.add(decision.titleKey);
  const token = screen.detailLoadToken;
  void resolveTitleContentRating({
    titleKey: decision.titleKey,
    itemId: screen.params?.itemId || meta?.id || "",
    itemType: screen.params?.itemType || meta?.type || "",
    imdbId: meta?.imdbId || "",
    tmdbId: screen.params?.tmdbId || meta?.tmdbId || ""
  }).then((rating) => {
    if (
      !rating ||
      token !== screen.detailLoadToken ||
      detailProfanityTitleKey(screen) !== decision.titleKey
    ) {
      return;
    }
    const next = resolveProfanityFilterForTitle({ titleKey: decision.titleKey, rating });
    if (next.enabled !== decision.enabled && screen.meta && typeof screen.render === "function") {
      const focusRestore =
        typeof screen.captureDetailFocus === "function" ? screen.captureDetailFocus() : undefined;
      screen.render(screen.meta, focusRestore);
    }
  });
}

export function toggleDetailProfanityFilter(screen) {
  const decision = detailProfanityDecision(screen);
  if (!decision.titleKey) {
    return false;
  }
  ProfanityFilterStore.setTitleOverride(decision.titleKey, !decision.enabled, {
    name: String(screen.meta?.name || screen.params?.itemTitle || "").trim()
  });
  return true;
}
