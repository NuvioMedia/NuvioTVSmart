import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { Environment } from "../../platform/environment.js";
import { supportsTvLogin } from "../server/serverConfiguration.js";
import { SessionStore } from "../storage/sessionStore.js";
import { AuthManager } from "./authManager.js";
import { AuthState } from "./authState.js";
import { fetchSupabaseAuth } from "./supabaseAuthFetch.js";

let lastError = null;

function loginTrace(event, data) {
  try {
    globalThis.__NUVIO_TIZEN_LOGIN_TRACE__?.(event, data);
  } catch (_) {
    // Login diagnostics must never change the authentication flow.
  }
}

function hasQrAuthConfig() {
  return supportsTvLogin(ServerConfigurationStore.getActive());
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

function getBearerToken() {
  const token = SessionStore.accessToken;
  if (isJwtLike(token) && !isJwtExpired(token, 0)) {
    return token;
  }
  return ServerConfigurationStore.getActive().publishableKey;
}

function generateDeviceNonce() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resolveRedirectBaseUrl() {
  const configuredUrl = ServerConfigurationStore.getActive().tvLoginWebBaseUrl;
  if (configuredUrl) {
    return configuredUrl;
  }
  if (typeof window !== "undefined") {
    const protocol = String(window.location?.protocol || "");
    if (protocol === "http:" || protocol === "https:") {
      return window.location.origin;
    }
  }
  return configuredUrl;
}

function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildRedirectCandidates() {
  const candidates = [];
  const base = resolveRedirectBaseUrl();
  if (base) {
    candidates.push(base);
    if (base.endsWith("/")) {
      candidates.push(base.slice(0, -1));
    } else {
      candidates.push(`${base}/`);
    }
    const origin = extractOrigin(base);
    if (origin) {
      candidates.push(origin);
      candidates.push(`${origin}/`);
    }
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function toEpochMillis(session) {
  if (typeof session?.expires_at_millis === "number") {
    return session.expires_at_millis;
  }
  if (session?.expires_at) {
    const parsed = Date.parse(session.expires_at);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now() + 5 * 60 * 1000;
}

function isLegacyStartSignatureError(text) {
  const message = String(text || "").toLowerCase();
  return (
    message.includes("start_tv_login_session") &&
    message.includes("could not find the function") &&
    message.includes("p_device_name")
  );
}

function isCallerSessionRejected(text) {
  const message = String(text || "").toLowerCase();
  return (
    message.includes("http 401") ||
    message.includes("invalid caller session") ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt")
  );
}

async function parseErrorText(response) {
  const status = Number(response?.status || 0);
  try {
    const rawText = await response.text();
    const text = String(rawText || "").trim();
    if (!text) {
      return status ? `HTTP ${status}` : "Request failed";
    }

    try {
      const parsed = JSON.parse(text);
      const jsonMessage = [
        parsed?.msg,
        parsed?.message,
        parsed?.error_description,
        parsed?.error,
        parsed?.hint
      ].find((value) => typeof value === "string" && value.trim());
      if (jsonMessage) {
        return status ? `HTTP ${status}: ${jsonMessage.trim()}` : jsonMessage.trim();
      }
    } catch {
      // Ignore non-JSON payloads.
    }

    const strippedHtml = text
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!strippedHtml) {
      return status ? `HTTP ${status}` : "Request failed";
    }

    if (/<!doctype html>|<html[\s>]/i.test(text) && status) {
      return `HTTP ${status}: ${strippedHtml}`;
    }

    return status ? `HTTP ${status}: ${strippedHtml}` : strippedHtml;
  } catch {
    return status ? `HTTP ${status}` : "Request failed";
  }
}

function extractSessionTokens(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const accessToken =
    payload.access_token || payload.accessToken || payload?.session?.access_token || null;
  const refreshToken =
    payload.refresh_token || payload.refreshToken || payload?.session?.refresh_token || null;
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

async function ensureQrSessionAuthenticated({ forceNewAnonymous = false } = {}) {
  const serverGeneration = AuthManager.getServerGeneration();
  if (forceNewAnonymous) {
    const wasAnonymous = SessionStore.isAnonymousSession;
    if (!wasAnonymous && SessionStore.refreshToken) {
      const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
      if (refreshed && SessionStore.accessToken && !isJwtExpired(SessionStore.accessToken, 0)) {
        return true;
      }
      if (AuthManager.wasLastSessionRefreshTransientFailure?.()) {
        return true;
      }
    }
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
    SessionStore.isAnonymousSession = false;
  }

  if (SessionStore.accessToken && !isJwtLike(SessionStore.accessToken)) {
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
  }
  if (SessionStore.accessToken && !SessionStore.isAnonymousSession) {
    if (!isJwtExpired(SessionStore.accessToken)) {
      return true;
    }
    const refreshed = await AuthManager.refreshSessionIfNeeded();
    if (refreshed && SessionStore.accessToken && !isJwtExpired(SessionStore.accessToken)) {
      return true;
    }
    if (AuthManager.wasLastSessionRefreshTransientFailure?.()) {
      return true;
    }
    SessionStore.clear();
  }
  if (SessionStore.accessToken && SessionStore.isAnonymousSession) {
    if (!isJwtExpired(SessionStore.accessToken)) {
      return true;
    }
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
    SessionStore.isAnonymousSession = false;
  }

  const publishableKey = ServerConfigurationStore.getActive().publishableKey;
  const commonHeaders = {
    "Content-Type": "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`
  };

  const tryAnonymousSignup = async () => {
    const response = await fetchSupabaseAuth("/auth/v1/signup", {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        data: { tv_client: "webos" }
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    return text ? JSON.parse(text) : {};
  };

  const tryAnonymousToken = async () => {
    const response = await fetchSupabaseAuth("/auth/v1/token?grant_type=anonymous", {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({})
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    return text ? JSON.parse(text) : {};
  };

  let payload;
  try {
    payload = await tryAnonymousSignup();
  } catch (firstError) {
    payload = await tryAnonymousToken().catch((secondError) => {
      throw new Error(
        `${firstError?.message || "anonymous signup failed"} | ${secondError?.message || "anonymous token failed"}`
      );
    });
  }

  const tokens = extractSessionTokens(payload);
  if (!tokens) {
    throw new Error("Anonymous auth did not return session tokens");
  }
  if (!AuthManager.isServerGenerationCurrent(serverGeneration)) {
    throw new Error("QR session was superseded by a server change");
  }

  SessionStore.accessToken = tokens.accessToken;
  SessionStore.refreshToken = tokens.refreshToken;
  SessionStore.isAnonymousSession = true;
  return true;
}

async function fetchWithCallerSessionRecovery(requestFactory) {
  await ensureQrSessionAuthenticated();
  let response = await requestFactory();
  if (response.ok || response.status !== 401) {
    return response;
  }

  const firstErrorText = await parseErrorText(response);
  if (!isCallerSessionRejected(firstErrorText)) {
    throw new Error(firstErrorText || `HTTP ${response.status}`);
  }

  await ensureQrSessionAuthenticated({ forceNewAnonymous: true });
  return requestFactory();
}

async function startRpc(deviceNonce, redirectBaseUrl, includeDeviceName = true) {
  const publishableKey = ServerConfigurationStore.getActive().publishableKey;
  const payload = {
    p_device_nonce: deviceNonce,
    p_redirect_base_url: redirectBaseUrl
  };
  if (includeDeviceName) {
    payload.p_device_name = Environment.getDeviceLabel();
  }

  const response = await fetchWithCallerSessionRecovery(() =>
    fetchSupabaseAuth("/rest/v1/rpc/start_tv_login_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${getBearerToken()}`
      },
      body: JSON.stringify(payload)
    })
  );

  if (!response.ok) {
    const errorText = await parseErrorText(response);
    throw new Error(errorText || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data?.[0] || null;
}

export const QrLoginService = {
  getLastError() {
    return lastError;
  },

  async start() {
    lastError = null;
    loginTrace("qr start begin");
    try {
      if (!hasQrAuthConfig()) {
        throw new Error("QR auth is not configured");
      }
      await ensureQrSessionAuthenticated();
      const deviceNonce = generateDeviceNonce();
      const redirectCandidates = buildRedirectCandidates();
      if (!redirectCandidates.length) {
        throw new Error("Missing redirect_base_url configuration");
      }

      let session = null;
      let lastStartError = null;

      for (const redirectCandidate of redirectCandidates) {
        try {
          session = await startRpc(deviceNonce, redirectCandidate, true);
          if (session) {
            break;
          }
        } catch (error) {
          const message = String(error?.message || "");
          if (isLegacyStartSignatureError(message)) {
            try {
              session = await startRpc(deviceNonce, redirectCandidate, false);
              if (session) {
                break;
              }
            } catch (legacyError) {
              lastStartError = legacyError;
              continue;
            }
          }
          lastStartError = error;
          continue;
        }
      }

      if (!session) {
        if (lastStartError) {
          throw new Error(
            `${lastStartError.message} | tried redirect_base_url: ${redirectCandidates.join(" , ")}`
          );
        }
        throw new Error("Empty response from start_tv_login_session");
      }

      const result = {
        code: session.code,
        loginUrl: session.qr_content || session.web_url || null,
        qrImageUrl:
          session.qr_image_url ||
          `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(session.qr_content || session.web_url || "")}`,
        expiresAt: toEpochMillis(session),
        pollIntervalSeconds: Number(session.poll_interval_seconds || 3),
        deviceNonce
      };
      loginTrace("qr start success", {
        pollIntervalSeconds: result.pollIntervalSeconds,
        hasQrContent: Boolean(result.loginUrl),
        hasQrImage: Boolean(result.qrImageUrl)
      });
      return result;
    } catch (error) {
      lastError = String(error?.message || "QR start failed");
      loginTrace("qr start failed", { name: error?.name || "Error" });
      console.error("QR start error:", error);
      return null;
    }
  },

  async poll(code, deviceNonce) {
    lastError = null;
    try {
      if (!hasQrAuthConfig()) {
        lastError = "QR auth is not configured";
        return null;
      }
      const publishableKey = ServerConfigurationStore.getActive().publishableKey;
      const response = await fetchWithCallerSessionRecovery(() =>
        fetchSupabaseAuth("/rest/v1/rpc/poll_tv_login_session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: publishableKey,
            Authorization: `Bearer ${getBearerToken()}`
          },
          body: JSON.stringify({
            p_code: code,
            p_device_nonce: deviceNonce
          })
        })
      );

      if (!response.ok) {
        lastError = await parseErrorText(response);
        return null;
      }

      const data = await response.json();
      const status = data?.[0]?.status || null;
      loginTrace("qr poll parsed", { status: status || "empty" });
      return status;
    } catch (error) {
      lastError = String(error?.message || "QR poll failed");
      loginTrace("qr poll failed", { name: error?.name || "Error" });
      console.error("QR poll error:", error);
      return null;
    }
  },

  async exchange(code, deviceNonce) {
    lastError = null;
    loginTrace("qr exchange begin");
    const serverGeneration = AuthManager.getServerGeneration();
    try {
      if (!hasQrAuthConfig()) {
        lastError = "QR auth is not configured";
        return false;
      }
      const publishableKey = ServerConfigurationStore.getActive().publishableKey;
      const response = await fetchWithCallerSessionRecovery(() =>
        fetchSupabaseAuth("/functions/v1/tv-logins-exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: publishableKey,
            Authorization: `Bearer ${getBearerToken()}`
          },
          body: JSON.stringify({
            code,
            device_nonce: deviceNonce
          })
        })
      );

      if (!response.ok) {
        lastError = await parseErrorText(response);
        console.error("Exchange failed", lastError);
        return false;
      }

      const result = await response.json();
      const tokens = extractSessionTokens(result) || {
        accessToken: result?.access_token || null,
        refreshToken: result?.refresh_token || null
      };
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        lastError = "QR exchange missing session tokens";
        loginTrace("qr exchange missing tokens");
        return false;
      }
      if (!AuthManager.isServerGenerationCurrent(serverGeneration)) {
        lastError = "QR exchange was superseded by a server change";
        return false;
      }
      SessionStore.accessToken = tokens.accessToken;
      SessionStore.refreshToken = tokens.refreshToken;
      SessionStore.isAnonymousSession = false;
      loginTrace("qr exchange session ready");
      AuthManager.setState(AuthState.AUTHENTICATED);
      loginTrace("qr exchange authenticated");
      return result;
    } catch (error) {
      lastError = String(error?.message || "QR exchange failed");
      loginTrace("qr exchange failed", { name: error?.name || "Error" });
      console.error("QR exchange error:", error);
      return false;
    }
  },

  cleanup() {
    // no-op: timers are owned by screen
  }
};
