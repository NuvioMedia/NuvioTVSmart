import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { withRequestTimeout } from "../network/requestTimeout.js";
import { recordSyncFailure } from "../sync/syncBackoffPolicy.js";
import { trackSessionRequest } from "./sessionLifecycle.js";

const AUTH_REQUEST_TIMEOUT_MS = 15000;
const RETRYABLE_AUTH_STATUSES = new Set([
  408, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530
]);

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function authUrl(baseUrl, endpoint) {
  const base = normalizeBaseUrl(baseUrl);
  const path = String(endpoint || "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function isNetworkError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    name === "typeerror" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("connection") ||
    message.includes("ssl")
  );
}

async function isRetryableResponse(response) {
  if (!response || response.ok) {
    return false;
  }
  if (RETRYABLE_AUTH_STATUSES.has(Number(response?.status || 0))) {
    return true;
  }
  if (typeof response?.clone !== "function") {
    return false;
  }
  try {
    const body = String(await response.clone().text()).toLowerCase();
    return body.includes("cloudflare") || body.includes("cf-error-code");
  } catch (_) {
    return false;
  }
}

async function fetchSupabaseAuthInternal(endpoint, init = {}) {
  const configuration = ServerConfigurationStore.getActive();
  const primaryBaseUrl = normalizeBaseUrl(configuration.backendUrl);
  const fallbackBaseUrl = normalizeBaseUrl(configuration.fallbackBackendUrl);
  const canFallback =
    Boolean(fallbackBaseUrl) && fallbackBaseUrl.toLowerCase() !== primaryBaseUrl.toLowerCase();
  const primaryUrl = authUrl(primaryBaseUrl, endpoint);

  try {
    const response = await withRequestTimeout(
      (signal) =>
        fetch(primaryUrl, {
          ...init,
          ...(signal ? { signal } : {})
        }),
      AUTH_REQUEST_TIMEOUT_MS,
      init?.signal || null
    );
    const shouldRetryPrimary = await isRetryableResponse(response);
    if (!canFallback || !shouldRetryPrimary) {
      return response;
    }
    recordSyncFailure({ status: response.status });
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }
    recordSyncFailure(error);
    if (!canFallback) {
      throw error;
    }
  }

  let fallbackResponse;
  try {
    fallbackResponse = await withRequestTimeout(
      (signal) =>
        fetch(authUrl(fallbackBaseUrl, endpoint), {
          ...init,
          ...(signal ? { signal } : {})
        }),
      AUTH_REQUEST_TIMEOUT_MS,
      init?.signal || null
    );
  } catch (error) {
    if (isNetworkError(error)) {
      recordSyncFailure(error);
    }
    throw error;
  }
  if (await isRetryableResponse(fallbackResponse)) {
    recordSyncFailure({ status: fallbackResponse.status });
  }
  return fallbackResponse;
}

export function fetchSupabaseAuth(endpoint, init = {}) {
  return trackSessionRequest(fetchSupabaseAuthInternal(endpoint, init));
}
