import { AuthState } from "./authState.js";
import { clearAccountLocalData, hasAccountLocalData } from "./accountLocalDataReset.js";
import { SessionStore } from "../storage/sessionStore.js";
import { fetchSupabaseAuth } from "./supabaseAuthFetch.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";
import { HomeCatalogSnapshotStore } from "../../data/local/homeCatalogSnapshotStore.js";
import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import {
  notifySessionTeardownHandlers,
  waitForPendingSessionRequests
} from "./sessionLifecycle.js";

function createAbortController() {
  return typeof AbortController === "function" ? new AbortController() : null;
}

function publishableKey() {
  return String(ServerConfigurationStore.getActive()?.publishableKey || "").trim();
}

function parseResponseError(response, fallback = "Request failed") {
  return response
    .text()
    .catch(() => "")
    .then((body) => {
      const raw = String(body || "").trim();
      if (!raw) {
        return response.status ? `HTTP ${response.status}` : fallback;
      }
      try {
        const parsed = JSON.parse(raw);
        const message = [
          parsed?.msg,
          parsed?.message,
          parsed?.error_description,
          parsed?.error,
          parsed?.hint
        ].find((value) => typeof value === "string" && value.trim());
        if (message) {
          return response.status ? `HTTP ${response.status}: ${message.trim()}` : message.trim();
        }
      } catch (_) {
        // Keep the server's plain-text response below.
      }
      return response.status ? `HTTP ${response.status}: ${raw}` : raw;
    });
}

function isMissingDeviceLoginFunction(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("could not find the function") &&
    message.includes("start_device_login_session")
  );
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
    this.sessionTeardownListeners = new Set();
    this.sessionAbortController = createAbortController();
    this.sessionGeneration = 0;
    this.cachedEffectiveUserId = null;
    this.cachedEffectiveUserSourceUserId = null;
    this.refreshPromise = null;
    this.lastRefreshFailureKind = null;
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
    if (newState === AuthState.AUTHENTICATED && this.sessionAbortController?.signal?.aborted) {
      this.sessionAbortController = createAbortController();
    }
    this.state = newState;
    this.listeners.forEach((l) => l(newState));
  }

  getSessionSignal() {
    return this.sessionAbortController?.signal || null;
  }

  registerSessionTeardownListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.sessionTeardownListeners.add(listener);
    return () => this.sessionTeardownListeners.delete(listener);
  }

  async notifySessionTeardown(options = {}) {
    const listeners = [...this.sessionTeardownListeners];
    if (!listeners.length) {
      return true;
    }
    const results = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve().then(() => listener(options)))
    );
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.warn("Session teardown listener failed", result.reason);
      }
    });
    return results.every((result) => result.status === "fulfilled" && result.value !== false);
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
    const generation = this.sessionGeneration;
    const key = publishableKey();
    const res = await fetchSupabaseAuth("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key
      },
      body: JSON.stringify({ email, password }),
      signal: this.getSessionSignal()
    });

    if (!res.ok) {
      throw new Error(await parseResponseError(res, "Login failed"));
    }

    const data = await res.json();
    if (generation !== this.sessionGeneration) {
      throw new Error("Login was cancelled because the server changed");
    }
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error("Login response did not include a valid session");
    }

    SessionStore.accessToken = data.access_token;
    SessionStore.refreshToken = data.refresh_token;
    SessionStore.isAnonymousSession = false;

    this.setState(AuthState.AUTHENTICATED);
  }

  async signOut() {
    return this._teardownAccountSession({ serverSwitch: false, verify: false });
  }

  clearAnonymousSession() {
    if (!SessionStore.isAnonymousSession) {
      return false;
    }
    this.sessionGeneration += 1;
    if (this.sessionAbortController && !this.sessionAbortController.signal.aborted) {
      try {
        this.sessionAbortController.abort();
      } catch (_) {
        // Abort is best effort on older TV runtimes.
      }
    }
    try {
      SessionStore.clear();
    } catch (error) {
      console.warn("Anonymous session reset failed", error);
      return false;
    }
    this.cachedEffectiveUserId = null;
    this.cachedEffectiveUserSourceUserId = null;
    this.sessionAbortController = createAbortController();
    return true;
  }

  async prepareForServerSwitch() {
    return this._teardownAccountSession({ serverSwitch: true, verify: true });
  }

  async _teardownAccountSession({ serverSwitch = false, verify = false } = {}) {
    const wasSignedOut = this.state === AuthState.SIGNED_OUT;
    const hadAccountSession =
      !SessionStore.isAnonymousSession &&
      (this.state === AuthState.AUTHENTICATED ||
        Boolean(SessionStore.accessToken || SessionStore.refreshToken));
    const shouldClearAccountData = !serverSwitch || hadAccountSession;
    this.sessionGeneration += 1;

    if (this.sessionAbortController && !this.sessionAbortController.signal.aborted) {
      try {
        this.sessionAbortController.abort();
      } catch (_) {
        // Abort is best effort on older TV runtimes.
      }
    }

    let sessionStorageCleared = true;
    try {
      SessionStore.clear();
    } catch (error) {
      sessionStorageCleared = false;
      console.warn("Session storage reset failed", error);
    }

    this.cachedEffectiveUserId = null;
    this.cachedEffectiveUserSourceUserId = null;
    this.lastRefreshFailureKind = null;

    const teardownListenersSucceeded = await this.notifySessionTeardown({
      serverSwitch,
      hadAccountSession
    });
    const teardownHandlersSucceeded = await notifySessionTeardownHandlers({
      serverSwitch,
      hadAccountSession,
      waitForInFlight: true
    });
    const sessionRequestsDrained = await waitForPendingSessionRequests();

    // Notify the UI only after teardown listeners have captured and drained
    // their in-flight work. The app-level signed-out listener also calls
    // StartupSyncService.stop(), so changing state earlier would discard the
    // promises we need to await here.
    if (!wasSignedOut) {
      this.setState(AuthState.SIGNED_OUT);
    }

    let accountDataCleared = true;
    if (shouldClearAccountData) {
      try {
        clearAccountLocalData();
      } catch (error) {
        accountDataCleared = false;
        console.warn("Account-local data reset failed during session teardown", error);
      }
    }

    let pluginDataCleared = true;
    if (shouldClearAccountData) {
      try {
        pluginDataCleared = (await PluginCodeStore.clearAll()) !== false;
      } catch (error) {
        pluginDataCleared = false;
        console.warn("Plugin code reset failed during session teardown", error);
      }
    }

    let homeCatalogDataCleared = true;
    if (shouldClearAccountData) {
      try {
        homeCatalogDataCleared = (await HomeCatalogSnapshotStore.clearAll()) !== false;
      } catch (error) {
        homeCatalogDataCleared = false;
        console.warn("Home catalog cache reset failed during session teardown", error);
      }
    }

    // A completed teardown starts a fresh request generation. Requests begun
    // before the switch remain cancelled, while the next auth/QR attempt can
    // use a live signal without waiting for a page reload.
    this.sessionAbortController = createAbortController();

    if (!verify) {
      return true;
    }
    let accountDataVerified = true;
    if (shouldClearAccountData) {
      try {
        accountDataVerified = !hasAccountLocalData();
      } catch (error) {
        accountDataVerified = false;
        console.warn("Unable to verify account-local cleanup", error);
      }
    }
    return Boolean(
      sessionStorageCleared &&
      teardownListenersSucceeded &&
      teardownHandlersSucceeded &&
      sessionRequestsDrained &&
      accountDataCleared &&
      pluginDataCleared &&
      homeCatalogDataCleared &&
      accountDataVerified &&
      !SessionStore.accessToken &&
      !SessionStore.refreshToken &&
      (!shouldClearAccountData || !SessionStore.isAnonymousSession)
    );
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

    this.refreshPromise = (async () => {
      try {
        const generation = this.sessionGeneration;
        const key = publishableKey();
        const res = await fetchSupabaseAuth("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: key
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: this.getSessionSignal()
        });
        if (!res.ok) {
          const responseBody = await res.text();
          if (isInvalidRefreshResponse(res.status, responseBody)) {
            this.lastRefreshFailureKind = "invalid";
            await this.signOut();
            return false;
          }

          this.lastRefreshFailureKind = "transient";
          return Boolean(accessToken);
        }
        const data = await res.json();
        if (generation !== this.sessionGeneration) {
          this.lastRefreshFailureKind = "failed";
          return false;
        }
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

  // ------------------------------------
  // QR LOGIN FLOW
  // ------------------------------------

  async startTvLoginSession(deviceNonce, deviceName, redirectBaseUrl) {
    const request = (includeDeviceName) =>
      fetchSupabaseAuth("/rest/v1/rpc/start_tv_login_session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey(),
          Authorization: `Bearer ${SessionStore.accessToken || publishableKey()}`
        },
        body: JSON.stringify({
          p_device_nonce: deviceNonce,
          p_redirect_base_url: redirectBaseUrl,
          ...(includeDeviceName && deviceName && { p_device_name: deviceName })
        }),
        signal: this.getSessionSignal()
      });

    let res = await request(Boolean(deviceName));
    if (!res.ok) {
      const error = new Error(await parseResponseError(res));
      const message = String(error.message || "").toLowerCase();
      if (
        deviceName &&
        message.includes("start_tv_login_session") &&
        message.includes("could not find the function") &&
        message.includes("p_device_name")
      ) {
        res = await request(false);
      } else {
        throw error;
      }
    }

    if (!res.ok) {
      throw new Error(await parseResponseError(res));
    }

    const data = await res.json();
    return data?.[0] || null;
  }

  async startDeviceLoginSession(
    deviceNonce,
    deviceName,
    deviceType = "tv",
    redirectBaseUrl,
    legacyRedirectBaseUrl
  ) {
    const key = publishableKey();
    const res = await fetchSupabaseAuth("/rest/v1/rpc/start_device_login_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${SessionStore.accessToken || key}`
      },
      body: JSON.stringify({
        p_device_nonce: deviceNonce,
        p_redirect_base_url: redirectBaseUrl,
        p_device_type: deviceType,
        ...(deviceName && { p_device_name: deviceName })
      }),
      signal: this.getSessionSignal()
    });

    if (!res.ok) {
      const error = new Error(await parseResponseError(res));
      if (!isMissingDeviceLoginFunction(error)) {
        throw error;
      }

      const legacy = await this.startTvLoginSession(
        deviceNonce,
        deviceName,
        legacyRedirectBaseUrl || redirectBaseUrl
      );
      if (!legacy) {
        throw new Error("Empty response from start_tv_login_session");
      }
      return {
        deviceCode: String(legacy.device_code || legacy.deviceCode || legacy.code || ""),
        userCode: String(legacy.user_code || legacy.userCode || legacy.code || ""),
        verificationUri: String(
          legacyRedirectBaseUrl ||
            legacy.verification_uri ||
            legacy.verificationUri ||
            legacy.web_url ||
            ""
        ),
        verificationUriComplete: String(
          legacy.verification_uri_complete ||
            legacy.verificationUriComplete ||
            legacy.qr_content ||
            legacy.web_url ||
            ""
        ),
        expiresAt: legacy.expires_at || legacy.expiresAt || null,
        pollIntervalSeconds: Number(
          legacy.poll_interval_seconds || legacy.pollIntervalSeconds || 3
        ),
        legacy: true
      };
    }

    const data = await res.json();
    const row = data?.[0] || {};
    return {
      deviceCode: String(row.device_code || ""),
      userCode: String(row.user_code || ""),
      verificationUri: String(row.verification_uri || ""),
      verificationUriComplete: String(row.verification_uri_complete || ""),
      expiresAt: row.expires_at || null,
      pollIntervalSeconds: Number(row.poll_interval_seconds || 3),
      legacy: false
    };
  }

  async pollTvLoginSession(code, deviceNonce) {
    const res = await fetchSupabaseAuth("/rest/v1/rpc/poll_tv_login_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey(),
        Authorization: `Bearer ${SessionStore.accessToken || publishableKey()}`
      },
      body: JSON.stringify({
        p_code: code,
        p_device_nonce: deviceNonce
      }),
      signal: this.getSessionSignal()
    });

    if (!res.ok) throw new Error(await parseResponseError(res));

    const data = await res.json();
    return data?.[0] || null;
  }

  async exchangeTvLoginSession(code, deviceNonce) {
    const res = await fetchSupabaseAuth("/functions/v1/tv-logins-exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey(),
        Authorization: `Bearer ${SessionStore.accessToken || publishableKey()}`
      },
      body: JSON.stringify({
        code,
        device_nonce: deviceNonce
      }),
      signal: this.getSessionSignal()
    });

    if (!res.ok) throw new Error(await parseResponseError(res));

    const data = await res.json();

    const accessToken = data?.accessToken || data?.access_token;
    const refreshToken = data?.refreshToken || data?.refresh_token;
    if (!accessToken || !refreshToken) {
      throw new Error("QR exchange missing session tokens");
    }
    SessionStore.accessToken = accessToken;
    SessionStore.refreshToken = refreshToken;
    SessionStore.isAnonymousSession = false;

    this.setState(AuthState.AUTHENTICATED);
    return data;
  }

  // ------------------------------------
  // EFFECTIVE USER ID (PORTING CACHE LOGIC)
  // ------------------------------------

  async getEffectiveUserId() {
    if (this.cachedEffectiveUserId) return this.cachedEffectiveUserId;
    const generation = this.sessionGeneration;

    if (!SessionStore.accessToken) {
      const refreshed = await this.refreshSessionIfNeeded();
      if (generation !== this.sessionGeneration || !refreshed || !SessionStore.accessToken) {
        await this.signOut();
        throw new Error("Missing valid session token");
      }
    }

    const key = publishableKey();
    const authHeaders = {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${SessionStore.accessToken || key}`
    };

    let res = await fetchSupabaseAuth("/rest/v1/rpc/get_sync_owner", {
      method: "POST",
      headers: authHeaders,
      signal: this.getSessionSignal()
    });

    if (res.status === 401) {
      const refreshed = await this.refreshSessionIfNeeded({ force: true });
      if (generation === this.sessionGeneration && refreshed) {
        res = await fetchSupabaseAuth("/rest/v1/rpc/get_sync_owner", {
          method: "POST",
          headers: {
            ...authHeaders,
            Authorization: `Bearer ${SessionStore.accessToken}`
          },
          signal: this.getSessionSignal()
        });
      }
    }

    if (generation !== this.sessionGeneration) {
      throw new Error("Session changed while resolving sync owner");
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
