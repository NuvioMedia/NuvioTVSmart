/* global __NUVIO_APP_VERSION__ */
import { SIMKL_API_URL, SIMKL_APP_NAME, SIMKL_CLIENT_ID } from "../../config.js";
import { AuthManager } from "../../core/auth/authManager.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { trackSessionRequest } from "../../core/auth/sessionLifecycle.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const DEFAULT_API_URL = "https://api.simkl.com";
const MAX_ATTEMPTS = 5;
const GET_INTERVAL_MS = 100;
const WRITE_INTERVAL_MS = 1000;
// Same 60 s read budget as the Android TV Simkl OkHttp client.
const REQUEST_TIMEOUT_MS = 60000;
let requestQueue = Promise.resolve();
let nextGetAt = 0;
let nextWriteAt = 0;

function appVersion() {
  return typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0";
}

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function apiBaseUrl() {
  return String(SIMKL_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

function createAbortError() {
  const error = new Error("Simkl request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(createAbortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(
      () => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      },
      Math.max(0, Number(ms) || 0)
    );
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function rateLimitedFetch(url, options, method, signal = null) {
  const isGet = String(method || "GET").toUpperCase() === "GET";
  const scheduledAt = isGet ? nextGetAt : nextWriteAt;
  throwIfAborted(signal);
  if (scheduledAt > Date.now()) await sleep(scheduledAt - Date.now(), signal);
  try {
    return await fetch(url, { ...options, ...(signal ? { signal } : {}) });
  } finally {
    const nextAt = Date.now() + (isGet ? GET_INTERVAL_MS : WRITE_INTERVAL_MS);
    if (isGet) nextGetAt = Math.max(nextGetAt, nextAt);
    else nextWriteAt = Math.max(nextWriteAt, nextAt);
  }
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function errorMessage(payload, status) {
  if (payload && typeof payload === "object") {
    return String(
      payload.message || payload.error_description || payload.error || `HTTP ${status}`
    );
  }
  return `Simkl request failed (${status})`;
}

async function executeSimklRequest(
  path,
  {
    method = "GET",
    body = null,
    authenticated = true,
    retry = true,
    authorizationToken = null,
    authProfileId = null,
    signal = null
  } = {}
) {
  if (!SIMKL_CLIENT_ID) throw new Error("Missing SIMKL_CLIENT_ID");
  const requestSignal = signal || AuthManager.getSessionSignal?.() || null;
  throwIfAborted(requestSignal);
  const url = new URL(`${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("client_id", SIMKL_CLIENT_ID);
  url.searchParams.set("app-name", SIMKL_APP_NAME || "nuvio");
  url.searchParams.set("app-version", appVersion());
  const token = authenticated ? authorizationToken : null;
  if (authenticated && !token) throw new Error("Simkl authentication required");
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers["Content-Type"] = "application/json";

  const attempts = retry ? MAX_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    let payload;
    try {
      ({ response, payload } = await withRequestTimeout(
        async (signal) => {
          throwIfAborted(signal);
          const response = await rateLimitedFetch(
            url.toString(),
            {
              method,
              headers,
              body: body == null ? undefined : JSON.stringify(body)
            },
            method,
            signal
          );
          return { response, payload: await readPayload(response) };
        },
        REQUEST_TIMEOUT_MS,
        requestSignal
      ));
    } catch (error) {
      if (requestSignal?.aborted || error?.name === "AbortError") throw error;
      if (attempt + 1 >= attempts) throw error;
      await sleep(Math.min(60000, 1000 * 2 ** attempt), requestSignal);
      continue;
    }
    if (response.ok || (response.status === 409 && path === "/scrobble/stop")) {
      return { response, payload };
    }
    if (response.status === 401) {
      SimklAuthStore.clearAuth(authProfileId);
      throw new Error("Simkl authorization was revoked");
    }
    const syncWriteLocked =
      response.status === 400 &&
      String(method).toUpperCase() !== "GET" &&
      String(path).startsWith("/sync/") &&
      String(payload?.error || "").toLowerCase() === "rate_limit";
    const transient = syncWriteLocked || [429, 500, 502, 503].includes(response.status);
    if (!transient || attempt + 1 >= attempts) {
      const error = new Error(errorMessage(payload, response.status));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    const retryAfter = Math.max(0, Number(response.headers.get("Retry-After") || 0) || 0) * 1000;
    await sleep(
      Math.min(60000, Math.max(retryAfter, syncWriteLocked ? 3000 : 1000 * 2 ** attempt)),
      requestSignal
    );
  }
  throw new Error("Simkl request failed");
}

export function simklRequest(path, options = {}) {
  const authProfileId = String(options.profileId || activeProfileId());
  const signal = options.signal || AuthManager.getSessionSignal?.() || null;
  const authorizationToken =
    options.authenticated === false ? null : SimklAuthStore.get(authProfileId).accessToken;
  const task = trackSessionRequest(
    requestQueue.then(() =>
      executeSimklRequest(path, { ...options, authProfileId, authorizationToken, signal })
    )
  );
  requestQueue = task.catch(() => false);
  return task;
}

async function fetchUserSettings(profileId = activeProfileId()) {
  const { payload } = await simklRequest("/users/settings", { method: "POST", profileId });
  const username = String(payload?.user?.name || "") || null;
  const accountId = payload?.account?.id == null ? null : Number(payload.account.id);
  SimklAuthStore.saveIdentity({ username, accountId }, profileId);
  return username;
}

export const SimklAuthService = {
  hasRequiredCredentials() {
    return Boolean(SIMKL_CLIENT_ID);
  },

  getCurrentAuthState() {
    return SimklAuthStore.get();
  },

  isAuthenticated() {
    return SimklAuthStore.isAuthenticated();
  },

  async startPinAuth() {
    if (!SIMKL_CLIENT_ID) throw new Error("Missing SIMKL_CLIENT_ID");
    const profileId = activeProfileId();
    const current = SimklAuthStore.get(profileId);
    if (current.userCode && current.expiresAt && Date.now() < current.expiresAt) return current;
    const { payload } = await simklRequest("/oauth/pin", {
      authenticated: false
    });
    if (
      payload?.result !== "OK" ||
      !payload?.user_code ||
      !(payload?.verification_uri || payload?.verification_url) ||
      !Number(payload?.expires_in)
    ) {
      throw new Error("Simkl returned an invalid PIN response");
    }
    return SimklAuthStore.savePinSession(payload, profileId);
  },

  async pollPin() {
    const profileId = activeProfileId();
    const state = SimklAuthStore.get(profileId);
    if (!state.userCode) return { type: "invalidated" };
    if (state.expiresAt && Date.now() >= state.expiresAt) {
      SimklAuthStore.clearPinSession(profileId);
      return { type: "expired" };
    }
    const { payload } = await simklRequest(`/oauth/pin/${encodeURIComponent(state.userCode)}`, {
      authenticated: false,
      retry: false
    });
    if (payload?.result === "KO") return { type: "pending" };
    const accessToken = String(payload?.access_token || "").trim();
    if (payload?.result !== "OK" || !accessToken || payload?.device_code) {
      SimklAuthStore.clearPinSession(profileId);
      return { type: "invalidated" };
    }
    SimklAuthStore.saveToken(accessToken, profileId);
    const username = await fetchUserSettings(profileId).catch(() => null);
    return { type: "approved", username };
  },

  cancelPinAuth() {
    SimklAuthStore.clearPinSession(activeProfileId());
  },

  fetchUserSettings,

  async disconnect() {
    const profileId = activeProfileId();
    SimklAuthStore.clearAuth(profileId);
  }
};
