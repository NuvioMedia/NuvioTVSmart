import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { recordSyncFailure } from "../sync/syncBackoffPolicy.js";

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

export async function fetchSupabaseAuth(endpoint, init = {}) {
  const configuration = ServerConfigurationStore.getActive();
  const primaryBaseUrl = normalizeBaseUrl(configuration.backendUrl);
  const fallbackBaseUrl = normalizeBaseUrl(configuration.fallbackBackendUrl);
  const canFallback =
    Boolean(fallbackBaseUrl) && fallbackBaseUrl.toLowerCase() !== primaryBaseUrl.toLowerCase();
  const primaryUrl = authUrl(primaryBaseUrl, endpoint);

  try {
    const response = await fetch(primaryUrl, init);
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
    fallbackResponse = await fetch(authUrl(fallbackBaseUrl, endpoint), init);
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
