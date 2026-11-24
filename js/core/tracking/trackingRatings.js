// Android TrackingRatings: the viewer's own ratings, saved to and read from the one tracking
// service picked in Settings > Tracking > Ratings (Simkl or MDBList).
import { ProfileManager } from "../profile/profileManager.js";
import { TraktSettingsStore, RATING_SOURCES } from "../../data/local/traktSettingsStore.js";
import { SimklAuthService } from "../../data/repository/simklAuthService.js";
import { SimklSyncService } from "../../data/repository/simklSyncService.js";
import { MdbListAccount } from "../../data/repository/mdbListAccount.js";
import { MdbListTracking } from "../../data/repository/mdbListTracking.js";

export const RATING_MAX = 10;

const PROVIDERS = {
  simkl: {
    connected: () => SimklAuthService.isAuthenticated(),
    supports: (media) => SimklSyncService.supportsRating(media),
    rating: (media) => SimklSyncService.userRating(media),
    rate: (media, rating) => SimklSyncService.rate(media, rating),
    onEnabled: () => {}
  },
  mdblist: {
    connected: () => MdbListAccount.connected(),
    supports: (media) => MdbListTracking.supportsRating(media),
    rating: (media) => MdbListTracking.userRating(media),
    rate: (media, rating) => MdbListTracking.rate(media, rating),
    // Android MdbListUserRatings.onEnabled: fetch the ratings as soon as MDBList is picked.
    onEnabled: () => void MdbListTracking.refresh({ force: true }).catch(() => false)
  }
};

// Ratings saved in this session, shown until the provider's own snapshot agrees.
const recent = new Map();
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn("Rating listener failed", error);
    }
  });
}

/** The media a rating belongs to: the title, or one of its episodes. */
export function ratingMediaReference(meta = {}, params = {}, episode = null) {
  const type = String(params.itemType || meta.type || "movie").toLowerCase();
  const year = Number(String(meta.releaseInfo || meta.year || "").match(/\d{4}/)?.[0]);
  return {
    itemId: String(params.itemId || meta.id || ""),
    itemType: ["series", "tv", "show", "anime"].includes(type) ? "series" : "movie",
    imdbId: meta.imdbId || meta.imdb_id || (/^tt\d+$/.test(String(meta.id || "")) ? meta.id : null),
    tmdbId: meta.tmdbId || meta.tmdb_id || null,
    title: meta.name || params.fallbackTitle || "",
    year: Number.isFinite(year) ? year : null,
    season: episode ? Number(episode.season) : null,
    episode: episode ? Number(episode.episode) : null,
    episodeTitle: episode?.title || null,
    videoId: episode?.id || null
  };
}

function ratingKey(media, provider) {
  return [
    ProfileManager.getActiveProfileId(),
    provider,
    media.itemType,
    media.itemId || media.imdbId || media.tmdbId,
    media.episode == null ? "" : `${media.season ?? -1}:${media.episode}`
  ].join(":");
}

export const TrackingRatings = {
  /** The chosen source, or null when it is off or no longer connected (Android provider()). */
  source() {
    const source = TraktSettingsStore.get().ratingSource;
    return source && PROVIDERS[source]?.connected() ? source : null;
  },

  /** Android availableSources: the connected rating services, Simkl before MDBList. */
  availableSources() {
    return RATING_SOURCES.filter((source) => PROVIDERS[source].connected());
  },

  /** Android current(): { provider, rating }, with no provider when the rate button is hidden. */
  current(media) {
    const source = this.source();
    if (!source || !PROVIDERS[source].supports(media)) {
      return { provider: null, rating: null };
    }
    const key = ratingKey(media, source);
    const stored = PROVIDERS[source].rating(media);
    if (recent.has(key)) {
      const override = recent.get(key);
      if (override === stored) recent.delete(key);
      return { provider: source, rating: override };
    }
    return { provider: source, rating: stored };
  },

  /** Android rate(): rating 1..10, or null to remove it. Resolves to true when saved. */
  async rate(media, rating) {
    if (rating != null && !(Number.isInteger(rating) && rating >= 1 && rating <= RATING_MAX)) {
      throw new Error("Rating must be 1..10");
    }
    const source = this.source();
    if (!source || !PROVIDERS[source].supports(media)) return false;
    let saved = false;
    try {
      saved = (await PROVIDERS[source].rate(media, rating)) === true;
    } catch (error) {
      console.warn("Rating update failed", error?.code || error?.message || error);
      saved = false;
    }
    if (saved) {
      recent.set(ratingKey(media, source), rating);
      notify();
    }
    return saved;
  },

  /** Android setSource(): null turns the rate button off. */
  setSource(source) {
    TraktSettingsStore.setRatingSource(source);
    const applied = TraktSettingsStore.get().ratingSource;
    if (applied) PROVIDERS[applied]?.onEnabled();
    notify();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
