import { I18n } from "../../i18n/index.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function watchedBadgeLabel() {
  return I18n.t("episodes_cd_watched", {}, { fallback: "Watched" });
}

export function buildWatchedTitleIdSet(watchedItems = []) {
  return new Set(
    (Array.isArray(watchedItems) ? watchedItems : [])
      .filter((item) => item?.season == null && item?.episode == null)
      .map((item) => String(item?.contentId || "").trim())
      .filter(Boolean)
  );
}

export function isTitleItemWatched(item = {}, watchedTitleIds = null) {
  const id = String(item?.id || item?.contentId || "").trim();
  if (!id || !watchedTitleIds || typeof watchedTitleIds.has !== "function") {
    return false;
  }
  return watchedTitleIds.has(id);
}

export function renderWatchedBadgeGlyph(className = "title-watched-badge-svg") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`;
}

export function renderTitleWatchedBadge({
  className = "title-watched-badge",
  iconClassName = "title-watched-badge-svg"
} = {}) {
  return `<span class="${className}" aria-label="${escapeHtml(watchedBadgeLabel())}">${renderWatchedBadgeGlyph(iconClassName)}</span>`;
}
