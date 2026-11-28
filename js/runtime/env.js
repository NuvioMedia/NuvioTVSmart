(function bootstrapNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var existing = root.__NUVIO_ENV__ || {};

  root.__NUVIO_ENV__ = {
    NUVIO_SUPABASE_URL:
      typeof existing.NUVIO_SUPABASE_URL === "undefined" ? "" : existing.NUVIO_SUPABASE_URL,
    NUVIO_SUPABASE_ANON_KEY:
      typeof existing.NUVIO_SUPABASE_ANON_KEY === "undefined"
        ? ""
        : existing.NUVIO_SUPABASE_ANON_KEY,
    NUVIO_SUPABASE_FALLBACK_URL:
      typeof existing.NUVIO_SUPABASE_FALLBACK_URL === "undefined"
        ? ""
        : existing.NUVIO_SUPABASE_FALLBACK_URL,
    TV_LOGIN_WEB_BASE_URL:
      typeof existing.TV_LOGIN_WEB_BASE_URL === "undefined"
        ? "https://nuvio.tv/tv-login"
        : existing.TV_LOGIN_WEB_BASE_URL,
    DEVICE_LOGIN_WEB_BASE_URL:
      typeof existing.DEVICE_LOGIN_WEB_BASE_URL === "undefined"
        ? "https://nuvio.tv/link"
        : existing.DEVICE_LOGIN_WEB_BASE_URL,
    YOUTUBE_PROXY_URL:
      typeof existing.YOUTUBE_PROXY_URL === "undefined"
        ? "youtube-proxy.html"
        : existing.YOUTUBE_PROXY_URL,
    TRAILER_API_URL:
      typeof existing.TRAILER_API_URL === "undefined" ? "" : existing.TRAILER_API_URL,
    INTRODB_API_URL:
      typeof existing.INTRODB_API_URL === "undefined"
        ? "https://api.introdb.app/"
        : existing.INTRODB_API_URL,
    IMDB_RATINGS_API_BASE_URL:
      typeof existing.IMDB_RATINGS_API_BASE_URL === "undefined"
        ? ""
        : existing.IMDB_RATINGS_API_BASE_URL,
    AVATAR_PUBLIC_BASE_URL:
      typeof existing.AVATAR_PUBLIC_BASE_URL === "undefined" ? "" : existing.AVATAR_PUBLIC_BASE_URL,
    UNIQUE_CONTRIBUTIONS_BASE_URL:
      typeof existing.UNIQUE_CONTRIBUTIONS_BASE_URL === "undefined"
        ? ""
        : existing.UNIQUE_CONTRIBUTIONS_BASE_URL,
    SUPPORTERS_API_BASE_URL:
      typeof existing.SUPPORTERS_API_BASE_URL === "undefined"
        ? "https://nuvio.tv/"
        : existing.SUPPORTERS_API_BASE_URL,
    SUPPORT_URL:
      typeof existing.SUPPORT_URL === "undefined"
        ? "https://nuvio.tv/support"
        : existing.SUPPORT_URL,
    SPONSOR_NAMES:
      typeof existing.SPONSOR_NAMES === "undefined" || !String(existing.SPONSOR_NAMES).trim()
        ? "ragmehos."
        : existing.SPONSOR_NAMES,
    TMDB_API_KEY: typeof existing.TMDB_API_KEY === "undefined" ? "" : existing.TMDB_API_KEY,
    TRAKT_CLIENT_ID:
      typeof existing.TRAKT_CLIENT_ID === "undefined" ? "" : existing.TRAKT_CLIENT_ID,
    TRAKT_CLIENT_SECRET:
      typeof existing.TRAKT_CLIENT_SECRET === "undefined" ? "" : existing.TRAKT_CLIENT_SECRET,
    SIMKL_CLIENT_ID:
      typeof existing.SIMKL_CLIENT_ID === "undefined" ? "" : existing.SIMKL_CLIENT_ID,
    SIMKL_APP_NAME:
      typeof existing.SIMKL_APP_NAME === "undefined" || !String(existing.SIMKL_APP_NAME).trim()
        ? "nuvio"
        : existing.SIMKL_APP_NAME,
    PREMIUMIZE_CLIENT_ID:
      typeof existing.PREMIUMIZE_CLIENT_ID === "undefined" ? "" : existing.PREMIUMIZE_CLIENT_ID
  };
})();
