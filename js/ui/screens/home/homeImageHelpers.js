import { uniqueNonEmptyValues } from "./homeUtils.js";
import { normalizeTmdbBackdropUrl } from "../../../core/tmdb/tmdbImageUrl.js";

/**
 * Builds the ordered list of image candidates used by hero, poster and continue-watching cards.
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroBackdropSources(item = null) {
  return uniqueNonEmptyValues([
    normalizeTmdbBackdropUrl(item?.background),
    normalizeTmdbBackdropUrl(item?.backdrop),
    normalizeTmdbBackdropUrl(item?.backdropUrl),
    normalizeTmdbBackdropUrl(item?.landscapePoster),
    item?.poster,
    item?.thumbnail,
    item?.episodeThumbnail
  ]);
}

export function encodeHeroBackdropFallbacks(sources = []) {
  return sources.map((source) => encodeURIComponent(source)).join("|");
}

export function buildImageFallbackErrorHandler() {
  return "var q=(this.dataset.fallbackSrcs||'').split('|').filter(Boolean);var next=q.shift();if(next){this.dataset.fallbackSrcs=q.join('|');this.src=decodeURIComponent(next);return;}this.removeAttribute('src');this.classList.add('placeholder');";
}

export function buildHeroLogoErrorHandler() {
  return "this.hidden=true;this.style.display='none';var b=this.parentElement;if(b){var t=b.querySelector('.home-hero-title-text');if(t&&t.textContent&&t.textContent.trim()){t.classList.remove('is-hidden');}}";
}
