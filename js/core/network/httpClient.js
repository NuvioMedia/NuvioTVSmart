import { SessionStore } from "../storage/sessionStore.js";
import { AuthManager } from "../auth/authManager.js";
import { fetchViaWebOsSupabaseProxy } from "../../platform/webos/webosSupabaseProxy.js";

function toHeaderObject(headers) {
  if (!headers) {
    return {};
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function hasHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
}

export async function httpRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const includeSessionAuth = options.includeSessionAuth !== false;

  const headers = toHeaderObject(options.headers);

  if (includeSessionAuth && SessionStore.refreshToken && AuthManager.isAccessTokenExpired()) {
    await AuthManager.refreshSessionIfNeeded();
  }

  if (includeSessionAuth && SessionStore.accessToken && !hasHeader(headers, "Authorization")) {
    headers["Authorization"] = `Bearer ${SessionStore.accessToken}`;
  }

  const body = options.body;
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
  const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
  if (hasBody && !hasHeader(headers, "Content-Type") && !isFormData && !isBlob && !isSearchParams) {
    headers["Content-Type"] = "application/json";
  }

  const { includeSessionAuth: _ignoredIncludeSessionAuth, ...fetchOptions } = options;
  const fetchInit = {
    ...fetchOptions,
    method,
    credentials: fetchOptions.credentials || "omit",
    headers
  };

  let response =
    (await fetchViaWebOsSupabaseProxy(url, fetchInit)) || (await fetch(url, fetchInit));

  if (response.status === 401 && includeSessionAuth && SessionStore.refreshToken) {
    const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
    if (refreshed && SessionStore.accessToken) {
      const retryInit = {
        ...fetchInit,
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${SessionStore.accessToken}`
        }
      };
      response =
        (await fetchViaWebOsSupabaseProxy(url, retryInit)) || (await fetch(url, retryInit));
    }
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text);
    error.status = response.status;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.code === "string") {
          error.code = parsed.code;
        }
        if (typeof parsed.message === "string") {
          error.detail = parsed.message;
        }
      }
    } catch (parseError) {
      // Keep raw response text in error.message when payload is not JSON.
    }
    throw error;
  }

  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return null;
  }
  return JSON.parse(normalized);
}
