import { AuthState } from "./authState.js";
import { clearAccountLocalData, hasAccountLocalData } from "./accountLocalDataReset.js";
import { SessionStore } from "../storage/sessionStore.js";
import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { fetchSupabaseAuth } from "./supabaseAuthFetch.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";

function publishableKey() {
  return ServerConfigurationStore.getActive().publishableKey;
}

function isJwtLike(token) {
  const value = String(token || "").trim();
  return value.split(".").length === 3;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isJwtExpired(token, leewaySeconds = 30) {
  if (!isJwtLike(token)) {
    return true;
  }
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || exp <= 0) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp <= nowSeconds + leewaySeconds;
}

const INVALID_REFRESH_MARKERS = [
  "invalid refresh token",
  "refresh token is not valid",
  "refresh token not found",
  "refresh_token_not_found",
  "invalid_grant",
  "session not found",
  "session_not_found",
  "invalid session"
];

function isInvalidRefreshResponse(status, body) {
  if (![400, 401, 403].includes(Number(status || 0))) {
    return false;
  }
  const normalizedBody = String(body || "").toLowerCase();
  return INVALID_REFRESH_MARKERS.some((marker) => normalizedBody.includes(marker));
}

class AuthManagerClass {
  constructor() {
    this.state = AuthState.LOADING;
    this.listeners = [];
    this.cachedEffectiveUserId = null;
    this.cachedEffectiveUserSourceUserId = null;
    this.refreshPromise = null;
    this.lastRefreshFailureKind = null;
    this.sessionGeneration = 0;
    this.serverGeneration = 0;
  }

  // ------------------------------------
  // SUBSCRIBE (equivalente StateFlow)
  // ------------------------------------
  subscribe(listener) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  setState(newState) {
    this.state = newState;
    this.listeners.forEach((l) => l(newState));
  }

  // ------------------------------------
  // BOOTSTRAP (equivalente observeSessionStatus)
  // ------------------------------------
  async bootstrap() {
    const token = SessionStore.accessToken;

    if (!token) {
      this.setState(AuthState.SIGNED_OUT);
      return;
    }

    if (SessionStore.isAnonymousSession) {
      this.setState(AuthState.SIGNED_OUT);
      return;
    }

    const refreshed = await this.refreshSessionIfNeeded();
    if (!refreshed) {
      if (this.wasLastSessionRefreshTransientFailure() && SessionStore.accessToken) {
        this.setState(AuthState.AUTHENTICATED);
      } else if (this.state !== AuthState.SIGNED_OUT) {
        await this.signOut();
      }
      return;
    }

    this.setState(AuthState.AUTHENTICATED);
  }

  getAuthState() {
    return this.state;
  }

  get isAuthenticated() {
    return this.state === AuthState.AUTHENTICATED;
  }

  wasLastSessionRefreshTransientFailure() {
    return this.lastRefreshFailureKind === "transient";
  }

  isAccessTokenExpired(leewaySeconds = 30) {
    return isJwtExpired(SessionStore.accessToken, leewaySeconds);
  }

  // ------------------------------------
  // EMAIL LOGIN
  // ------------------------------------
  async signInWithEmail(email, password) {
    const sessionGeneration = this.sessionGeneration;
    const res = await fetchSupabaseAuth("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey()
      },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) throw new Error("Login failed");

    const data = await res.json();
    if (sessionGeneration !== this.sessionGeneration) {
      throw new Error("Sign-in was superseded by a server change");
    }

    SessionStore.accessToken = data.access_token;
    SessionStore.refreshToken = data.refresh_token;
    SessionStore.isAnonymousSession = false;

    this.setState(AuthState.AUTHENTICATED);
  }

  async signOut() {
    await this._teardownAccountSession();
  }

  async prepareForServerSwitch() {
    return this._teardownAccountSession({ serverSwitch: true, verify: true });
  }

  async _teardownAccountSession({ serverSwitch = false, verify = false } = {}) {
    const wasSignedOut = this.state === AuthState.SIGNED_OUT;
    this.sessionGeneration += 1;
    if (serverSwitch) this.serverGeneration += 1;
    let storageCleared = true;
    let pluginCodeCleared = false;
    try {
      SessionStore.clear();
      clearAccountLocalData();
    } catch (error) {
      storageCleared = false;
      console.warn("Account-local data reset failed", error);
    }
    try {
      pluginCodeCleared = await PluginCodeStore.clearAll();
    } catch (error) {
      console.warn("Plugin code reset failed", error);
    }
    this.cachedEffectiveUserId = null;
    this.cachedEffectiveUserSourceUserId = null;
    if (!wasSignedOut) {
      this.setState(AuthState.SIGNED_OUT);
    }
    if (!verify) return true;
    try {
      return Boolean(
        storageCleared &&
        pluginCodeCleared &&
        !SessionStore.accessToken &&
        !SessionStore.refreshToken &&
        !SessionStore.isAnonymousSession &&
        !hasAccountLocalData()
      );
    } catch (error) {
      console.warn("Unable to verify account cleanup before server switch", error);
      return false;
    }
  }

  async refreshSessionIfNeeded({ force = false } = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.lastRefreshFailureKind = null;
    const accessToken = SessionStore.accessToken;
    const refreshToken = SessionStore.refreshToken;
    if (!refreshToken) {
      return Boolean(accessToken) && !isJwtExpired(accessToken, 0);
    }

    if (!force && accessToken && !isJwtExpired(accessToken)) {
      return true;
    }

    const sessionGeneration = this.sessionGeneration;
    this.refreshPromise = (async () => {
      try {
        const res = await fetchSupabaseAuth("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: publishableKey()
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (sessionGeneration !== this.sessionGeneration) return false;
        if (!res.ok) {
          const responseBody = await res.text();
          if (sessionGeneration !== this.sessionGeneration) return false;
          if (isInvalidRefreshResponse(res.status, responseBody)) {
            this.lastRefreshFailureKind = "invalid";
            await this.signOut();
            return false;
          }

          this.lastRefreshFailureKind = "transient";
          return Boolean(accessToken);
        }
        const data = await res.json();
        if (sessionGeneration !== this.sessionGeneration) return false;
        if (!data?.access_token) {
          this.lastRefreshFailureKind = "transient";
          return Boolean(accessToken);
        }
        SessionStore.accessToken = data.access_token;
        if (data.refresh_token) {
          SessionStore.refreshToken = data.refresh_token;
        }
        this.lastRefreshFailureKind = null;
        return true;
      } catch (error) {
        if (sessionGeneration !== this.sessionGeneration) return false;
        console.warn("Session refresh failed", error);
        if (accessToken) {
          this.lastRefreshFailureKind = "transient";
          return true;
        }
        this.lastRefreshFailureKind = "failed";
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  getServerGeneration() {
    return this.serverGeneration;
  }

  isServerGenerationCurrent(generation) {
    return Number(generation) === this.serverGeneration;
  }

  // ------------------------------------
  // QR LOGIN FLOW
  // ------------------------------------

  async startTvLoginSession(deviceNonce, deviceName, redirectBaseUrl) {
    const res = await fetchSupabaseAuth("/rest/v1/rpc/start_tv_login_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey(),
        Authorization: `Bearer ${SessionStore.accessToken}`
      },
      body: JSON.stringify({
        p_device_nonce: deviceNonce,
        p_redirect_base_url: redirectBaseUrl,
        ...(deviceName && { p_device_name: deviceName })
      })
    });

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    return data[0];
  }

  async pollTvLoginSession(code, deviceNonce) {
    const res = await fetchSupabaseAuth("/rest/v1/rpc/poll_tv_login_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey(),
        Authorization: `Bearer ${SessionStore.accessToken}`
      },
      body: JSON.stringify({
        p_code: code,
        p_device_nonce: deviceNonce
      })
    });

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    return data[0];
  }

  async exchangeTvLoginSession(code, deviceNonce) {
    const res = await fetchSupabaseAuth("/functions/v1/tv-logins-exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey(),
        Authorization: `Bearer ${SessionStore.accessToken}`
      },
      body: JSON.stringify({
        code,
        device_nonce: deviceNonce
      })
    });

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    SessionStore.accessToken = data.accessToken;
    SessionStore.refreshToken = data.refreshToken;

    this.setState(AuthState.AUTHENTICATED);
  }

  // ------------------------------------
  // EFFECTIVE USER ID (PORTING CACHE LOGIC)
  // ------------------------------------

  async getEffectiveUserId() {
    if (this.cachedEffectiveUserId) return this.cachedEffectiveUserId;

    if (!SessionStore.accessToken) {
      const refreshed = await this.refreshSessionIfNeeded();
      if (!refreshed || !SessionStore.accessToken) {
        await this.signOut();
        throw new Error("Missing valid session token");
      }
    }

    const authHeaders = {
      "Content-Type": "application/json",
      apikey: publishableKey(),
      Authorization: `Bearer ${SessionStore.accessToken}`
    };

    let res = await fetchSupabaseAuth("/rest/v1/rpc/get_sync_owner", {
      method: "POST",
      headers: authHeaders
    });

    if (res.status === 401) {
      const refreshed = await this.refreshSessionIfNeeded({ force: true });
      if (refreshed) {
        res = await fetchSupabaseAuth("/rest/v1/rpc/get_sync_owner", {
          method: "POST",
          headers: {
            ...authHeaders,
            Authorization: `Bearer ${SessionStore.accessToken}`
          }
        });
      }
    }

    if (!res.ok) {
      if (
        res.status === 401 &&
        !this.wasLastSessionRefreshTransientFailure() &&
        this.state !== AuthState.SIGNED_OUT
      ) {
        await this.signOut();
      }
      throw new Error(await res.text());
    }

    const data = await res.json();
    const id = data;

    this.cachedEffectiveUserId = id;
    return id;
  }
}

export const AuthManager = new AuthManagerClass();
