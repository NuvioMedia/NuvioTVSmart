import { PARENTAL_GUIDE_API_URL } from "../../config.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";

const CACHE = new Map();

function normalizeImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

async function fetchJson(url, timeoutMs = 3500) {
  try {
    return await withRequestTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "GET",
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        console.warn("Parental guide request failed", { url, status: response.status });
        return null;
      }
      return await response.json();
    }, timeoutMs);
  } catch (error) {
    console.warn("Parental guide request failed", { url, error: error?.message || String(error) });
    return null;
  }
}

function resolveSeverity(category) {
  if (!category || !Array.isArray(category.severityBreakdowns)) {
    return null;
  }

  const breakdowns = category.severityBreakdowns
    .map((entry) => ({
      severityLevel: String(entry?.severityLevel || "")
        .trim()
        .toLowerCase(),
      voteCount: Number(entry?.voteCount || 0)
    }))
    .filter((entry) => entry.severityLevel && Number.isFinite(entry.voteCount));

  const dominant =
    breakdowns
      .filter((entry) => entry.severityLevel !== "none")
      .sort((left, right) => right.voteCount - left.voteCount)[0] || null;
  const noneVotes = breakdowns.find((entry) => entry.severityLevel === "none")?.voteCount || 0;

  if (!dominant || dominant.voteCount <= noneVotes) {
    return null;
  }

  return dominant.severityLevel;
}

function mapParentsGuide(categories) {
  if (!Array.isArray(categories) || !categories.length) {
    return null;
  }

  const categoryMap = new Map(
    categories
      .map((category) => [
        String(category?.category || "")
          .trim()
          .toUpperCase(),
        category
      ])
      .filter(([key]) => key)
  );
  const parentalGuide = {
    nudity: resolveSeverity(categoryMap.get("SEXUAL_CONTENT")),
    violence: resolveSeverity(categoryMap.get("VIOLENCE")),
    profanity: resolveSeverity(categoryMap.get("PROFANITY")),
    alcohol: resolveSeverity(categoryMap.get("ALCOHOL_DRUGS")),
    frightening: resolveSeverity(categoryMap.get("FRIGHTENING_INTENSE_SCENES"))
  };

  return {
    hasData: true,
    parentalGuide
  };
}

async function getGuide(imdbId) {
  const baseUrl = normalizeBaseUrl(PARENTAL_GUIDE_API_URL);
  const normalizedImdbId = normalizeImdbId(imdbId);
  if (!baseUrl || !normalizedImdbId) {
    return null;
  }
  const cacheKey = `title:${normalizedImdbId}`;
  if (CACHE.has(cacheKey)) {
    return CACHE.get(cacheKey);
  }
  const result = await fetchJson(
    `${baseUrl}titles/${encodeURIComponent(normalizedImdbId)}/parentsGuide`
  );
  const payload = mapParentsGuide(result?.parentsGuide);
  // Android caches successful category responses, including an empty set of warnings.
  // Failed requests must remain retryable on the next playback.
  if (payload) CACHE.set(cacheKey, payload);
  return payload;
}

export const parentalGuideRepository = {
  async getMovieGuide(imdbId) {
    return getGuide(imdbId);
  },

  async getTvGuide(imdbId) {
    return getGuide(imdbId);
  }
};
