import { ProfileManager } from "../../core/profile/profileManager.js";
/* eslint-disable no-unused-vars */
import * as internals from "./traktAuthService.js";

export function createTraktAuthServiceMethods01() {
  const {
    TRAKT_CLIENT_ID,
    TRAKT_CLIENT_SECRET,
    TRAKT_REDIRECT_URI,
    AuthManager,
    TraktAuthStore,
    WATCHED_MOVIES_PAGE_LIMIT,
    WATCHED_SHOWS_PAGE_LIMIT,
    hasRequiredCredentials,
    normalizeAuthErrorMessage,
    sleep,
    fetchWatchedPages,
    requestJson,
    isTokenExpiredOrExpiring,
    fetchUserSettings,
    normalizeHistoryItem,
    normalizeWatchlistItem,
    normalizePlaybackItem,
    normalizeWatchedShowItem,
    normalizeWatchedProgress,
    normalizeWatchedMovieItem
  } = internals;

  return {
    getCurrentAuthState() {
      return TraktAuthStore.get();
    },
    isAuthenticated() {
      return TraktAuthStore.isAuthenticated();
    },
    async startDeviceAuth() {
      const profileId = ProfileManager.getActiveProfileId();
      if (!hasRequiredCredentials()) {
        throw new Error("Missing TRAKT credentials");
      }

      const current = TraktAuthStore.get(profileId);
      if (current.deviceCode && current.expiresAt && Date.now() < Number(current.expiresAt)) {
        return current;
      }

      const requestSignal = AuthManager.getSessionSignal?.() || null;
      let { response, payload } = await requestJson("/oauth/device/code", {
        method: "POST",
        body: { client_id: TRAKT_CLIENT_ID },
        signal: requestSignal
      });

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("Retry-After") || 0);
        if (retryAfterSeconds >= 1 && retryAfterSeconds <= 10) {
          await sleep(retryAfterSeconds * 1000, requestSignal);
          ({ response, payload } = await requestJson("/oauth/device/code", {
            method: "POST",
            body: { client_id: TRAKT_CLIENT_ID },
            signal: requestSignal
          }));
        }
      }

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After") || 300);
          const minutes = Math.ceil(retryAfter / 60);
          throw new Error(`Trakt is rate limiting requests. Try again in ~${minutes} min`);
        }
        throw new Error(normalizeAuthErrorMessage(payload, `Failed to start Trakt auth (${response.status})`));
      }

      return TraktAuthStore.saveDeviceFlow(payload, profileId);
    },
    async pollDeviceToken() {
      const profileId = ProfileManager.getActiveProfileId();
      if (!hasRequiredCredentials()) {
        return { type: "failed", message: "Missing TRAKT credentials" };
      }
      const state = TraktAuthStore.get(profileId);
      if (!state.deviceCode) {
        return { type: "failed", message: "No active Trakt device code" };
      }
      if (state.expiresAt && Date.now() >= Number(state.expiresAt)) {
        TraktAuthStore.clearDeviceFlow(profileId);
        return { type: "expired" };
      }

      const { response, payload } = await requestJson("/oauth/device/token", {
        method: "POST",
        body: {
          code: state.deviceCode,
          client_id: TRAKT_CLIENT_ID,
          client_secret: TRAKT_CLIENT_SECRET
        }
      });

      if (ProfileManager.getActiveProfileId() !== profileId || TraktAuthStore.get(profileId).deviceCode !== state.deviceCode) {
        return { type: "failed", message: "Trakt authentication session changed" };
      }

      if (response.ok && payload) {
        TraktAuthStore.saveToken(payload, profileId);
        const username = await fetchUserSettings(profileId);
        return { type: "approved", username };
      }

      if (response.status === 400) {
        return { type: "pending" };
      }
      if (response.status === 409) {
        TraktAuthStore.clearDeviceFlow(profileId);
        return { type: "already_used" };
      }
      if (response.status === 410) {
        TraktAuthStore.clearDeviceFlow(profileId);
        return { type: "expired" };
      }
      if (response.status === 418) {
        TraktAuthStore.clearDeviceFlow(profileId);
        return { type: "denied" };
      }
      if (response.status === 429) {
        const interval = Math.min(60, Math.max(5, Number(state.pollInterval || 5) + 5));
        TraktAuthStore.updatePollInterval(interval, profileId);
        return { type: "slow_down", pollIntervalSeconds: interval };
      }
      return {
        type: "failed",
        message: normalizeAuthErrorMessage(payload, `Token polling failed (${response.status})`)
      };
    },
    async refreshTokenIfNeeded(force = false) {
      const profileId = ProfileManager.getActiveProfileId();
      if (!hasRequiredCredentials()) {
        return false;
      }
      const state = TraktAuthStore.get(profileId);
      if (!state.refreshToken) {
        return false;
      }
      if (!force && !isTokenExpiredOrExpiring(state)) {
        return true;
      }

      const { response, payload } = await requestJson("/oauth/token", {
        method: "POST",
        body: {
          refresh_token: state.refreshToken,
          client_id: TRAKT_CLIENT_ID,
          client_secret: TRAKT_CLIENT_SECRET,
          redirect_uri: TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob",
          grant_type: "refresh_token"
        }
      });

      if (TraktAuthStore.get(profileId).refreshToken !== state.refreshToken) return false;
      if (!response.ok || !payload) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          TraktAuthStore.clearAuth(profileId);
        }
        return false;
      }
      TraktAuthStore.saveToken(payload, profileId);
      await fetchUserSettings(profileId);
      return true;
    },
    async getValidAccessToken() {
      const profileId = ProfileManager.getActiveProfileId();
      const state = TraktAuthStore.get(profileId);
      if (!state.accessToken) {
        return null;
      }
      if (isTokenExpiredOrExpiring(state)) {
        const refreshed = await this.refreshTokenIfNeeded(true);
        if (!refreshed || ProfileManager.getActiveProfileId() !== profileId) {
          return null;
        }
        return TraktAuthStore.get(profileId).accessToken;
      }
      return state.accessToken;
    },
    async disconnect() {
      const profileId = ProfileManager.getActiveProfileId();
      const state = TraktAuthStore.get(profileId);
      if (hasRequiredCredentials() && state.accessToken) {
        try {
          await requestJson("/oauth/revoke", {
            method: "POST",
            body: {
              token: state.accessToken,
              client_id: TRAKT_CLIENT_ID,
              client_secret: TRAKT_CLIENT_SECRET
            }
          });
        } catch (error) {
          console.warn("Trakt revoke failed", error);
        }
      }
      internals.detailWatchedEnrichmentService.invalidateAllCache();
      if (TraktAuthStore.get(profileId).accessToken === state.accessToken) {
        TraktAuthStore.clearAuth(profileId);
      }
    },
    async fetchStats(forceRefresh = false) {
      const state = TraktAuthStore.get();
      const username = state.userSlug || state.username;
      if (!username) {
        await fetchUserSettings();
      }
      const nextState = TraktAuthStore.get();
      const userId = nextState.userSlug || nextState.username || "me";
      const token = await this.getValidAccessToken();
      if (!token) {
        return null;
      }
      const cacheKey = `traktCachedStats:${userId}`;
      const cached = forceRefresh ? null : JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - Number(cached.cachedAt || 0) < 60 * 60 * 1000) {
        return cached.stats || null;
      }
      const { response, payload } = await requestJson(`/users/${encodeURIComponent(userId)}/stats`, {
        authorization: `Bearer ${token}`
      });
      if (!response.ok || !payload) {
        return null;
      }
      const stats = {
        moviesWatched: Number(payload.movies?.watched || 0),
        showsWatched: Number(payload.shows?.watched || 0),
        episodesWatched: Number(payload.episodes?.watched || 0),
        totalWatchedHours: Math.round(Number(payload.movies?.minutes || 0) / 60 + Number(payload.episodes?.minutes || 0) / 60)
      };
      localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), stats }));
      return stats;
    },
    async fetchWatchHistory({ limit = 100 } = {}) {
      const token = await this.getValidAccessToken();
      if (!token) throw new Error("Trakt is not connected");

      const allItems = [];
      let page = 1;
      const perPage = Math.min(limit, 100);

      while (allItems.length < limit) {
        const { response, payload } = await requestJson(`/sync/history?limit=${perPage}&page=${page}`, {
          authorization: `Bearer ${token}`
        });
        if (!response.ok || !Array.isArray(payload)) throw new Error("Trakt history request failed");

        allItems.push(...payload.map(normalizeHistoryItem).filter(Boolean));
        if (payload.length < perPage) break;
        page++;
      }

      return allItems.slice(0, limit);
    },
    async fetchWatchlist({ limit = 100 } = {}) {
      const token = await this.getValidAccessToken();
      if (!token) return [];

      const allItems = [];
      let page = 1;
      const perPage = Math.min(limit, 100);

      while (allItems.length < limit) {
        const { response, payload } = await requestJson(`/sync/watchlist?limit=${perPage}&page=${page}`, {
          authorization: `Bearer ${token}`
        });
        if (!response.ok || !Array.isArray(payload)) break;

        allItems.push(...payload.map(normalizeWatchlistItem).filter(Boolean));
        if (payload.length < perPage) break;
        page++;
      }

      return allItems.slice(0, limit);
    },
    async fetchPlaybackState({ limit = 50 } = {}) {
      const token = await this.getValidAccessToken();
      if (!token) throw new Error("Trakt is not connected");

      // Trakt requires a media type in the playback path. Fetch both types so
      // the projection matches Android TV instead of silently receiving an
      // empty result from the invalid untyped endpoint.
      const payloads = await Promise.all(
        ["movies", "episodes"].map(async (type) => {
          const { response, payload } = await requestJson(`/sync/playback/${type}?limit=${limit}`, {
            authorization: `Bearer ${token}`
          });
          if (!response.ok || !Array.isArray(payload)) throw new Error(`Trakt ${type} playback request failed`);
          return payload;
        })
      );

      return payloads.flat().map(normalizePlaybackItem).filter(Boolean);
    },
    async fetchLastActivities() {
      const token = await this.getValidAccessToken();
      if (!token) throw new Error("Trakt is not connected");

      const { response, payload } = await requestJson("/sync/last_activities", {
        authorization: `Bearer ${token}`
      });
      if (!response.ok) throw new Error("Trakt last activities request failed");
      return payload;
    },
    async fetchWatchedShows() {
      const token = await this.getValidAccessToken();
      if (!token) throw new Error("Trakt is not connected");

      return fetchWatchedPages({
        token,
        path: "/sync/watched/shows?extended=progress",
        pageLimit: WATCHED_SHOWS_PAGE_LIMIT,
        normalize: normalizeWatchedShowItem,
        label: "watched shows"
      });
    },
    async fetchWatchedMovies() {
      const token = await this.getValidAccessToken();
      if (!token) throw new Error("Trakt is not connected");

      return fetchWatchedPages({
        token,
        path: "/sync/watched/movies",
        pageLimit: WATCHED_MOVIES_PAGE_LIMIT,
        normalize: normalizeWatchedMovieItem,
        label: "watched movies"
      });
    },
    async fetchWatchedProgress(showTraktId) {
      const token = await this.getValidAccessToken();
      if (!token) return null;

      const { response, payload } = await requestJson(`/shows/${encodeURIComponent(showTraktId)}/progress/watched`, {
        authorization: `Bearer ${token}`
      });
      if (!response.ok || !payload) return null;

      return normalizeWatchedProgress(payload);
    },
    /**
     * Every episode Trakt knows for a show, used to translate between the add-on's and
     * Trakt's numbering. Android requests the same `extended=episodes` seasons payload.
     */
    async fetchShowSeasons(showTraktId) {
      const id = String(showTraktId || "").trim();
      if (!id) return null;
      const token = await this.getValidAccessToken();
      if (!token) return null;

      const { response, payload } = await requestJson(`/shows/${encodeURIComponent(id)}/seasons?extended=episodes`, {
        authorization: `Bearer ${token}`
      });
      if (!response.ok || !Array.isArray(payload)) return null;
      return payload;
    }
  };
}
