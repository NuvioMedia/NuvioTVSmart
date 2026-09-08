import { SUPABASE_URL } from "../../config.js";

export const MAX_DISCOVERY_DOCUMENT_BYTES = 64 * 1024;
const DISCOVERY_SUFFIX = "/.well-known/nuvio";

function serverError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function parseUrl(value, code = "invalid_url") {
  try {
    return new URL(value);
  } catch (error) {
    throw serverError(code, { cause: error });
  }
}

function isPrivateHostname(hostname = "") {
  const host = String(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number);
    return Boolean(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
    if (/^ff[0-9a-f]{2}:/.test(host) || /^2001:db8:/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHostname(mapped[1]);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateHostname(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return false;
}

export function isPublicHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return Boolean(
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !isPrivateHostname(parsed.hostname)
    );
  } catch (_) {
    return false;
  }
}

export function normalizeDiscoveryUrl(input) {
  const normalized = String(input || "").trim();
  if (!normalized) throw serverError("invalid_url");
  const candidate = normalized.includes("://") ? normalized : `https://${normalized}`;
  const parsed = parseUrl(candidate);
  if (!isPublicHttpsUrl(parsed.toString())) {
    throw serverError("invalid_url");
  }
  const basePath = parsed.pathname.replace(/\/\.well-known\/nuvio\/?$/, "").replace(/\/+$/, "");
  parsed.pathname = `${basePath}${DISCOVERY_SUFFIX}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeBackendUrl(value) {
  const parsed = parseUrl(String(value || "").trim(), "missing_configuration");
  if (
    !isPublicHttpsUrl(parsed.toString()) ||
    parsed.search ||
    parsed.hash ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw serverError("missing_configuration");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function sameServer(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && a.port === b.port;
  } catch (_) {
    return false;
  }
}

function utf8ByteLength(value) {
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(value).byteLength
    : unescape(encodeURIComponent(value)).length;
}

export function parseDiscoveryDocument(discoveryUrl, source) {
  let payload;
  try {
    payload = JSON.parse(String(source || ""));
  } catch (error) {
    throw serverError("invalid_document", { cause: error });
  }
  if (payload?.version !== 1) throw serverError("unsupported_version");
  if (String(payload?.service || "").toLowerCase() !== "nuvio") {
    throw serverError("wrong_service");
  }
  if (payload?.self_hosted !== true) throw serverError("not_self_hosted");

  const backendUrl = normalizeBackendUrl(payload?.backend_url);
  const publishableKey = String(payload?.publishable_key || "").trim();
  if (!publishableKey) throw serverError("missing_configuration");
  if (sameServer(backendUrl, SUPABASE_URL)) throw serverError("official_server");

  const capabilities = {
    emailPasswordAuth: payload?.capabilities?.email_password_auth === true,
    tvLogin: payload?.capabilities?.tv_login === true
  };
  if (!capabilities.emailPasswordAuth && !capabilities.tvLogin) {
    throw serverError("no_supported_auth");
  }

  return {
    backendUrl,
    publishableKey,
    capabilities,
    isCustom: true,
    discoveryUrl,
    fallbackBackendUrl: "",
    tvLoginWebBaseUrl: `${backendUrl}/tv-login`,
    deviceLoginWebBaseUrl: `${backendUrl}/link`,
    avatarPublicBaseUrl: `${backendUrl}/storage/v1/object/public/avatars`
  };
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_DISCOVERY_DOCUMENT_BYTES) throw serverError("response_too_large");

  if (!response.body?.getReader) {
    const text = await response.text();
    if (utf8ByteLength(text) > MAX_DISCOVERY_DOCUMENT_BYTES) {
      throw serverError("response_too_large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DISCOVERY_DOCUMENT_BYTES) {
      await reader.cancel();
      throw serverError("response_too_large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });
  if (typeof TextDecoder === "function") return new TextDecoder().decode(combined);
  let binary = "";
  combined.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return decodeURIComponent(escape(binary));
}

export async function discoverServer(input, fetchOrOptions = globalThis.fetch, options = {}) {
  const fetchImpl =
    typeof fetchOrOptions === "function"
      ? fetchOrOptions
      : fetchOrOptions.fetchImpl || globalThis.fetch;
  const externalSignal =
    typeof fetchOrOptions === "function" ? options.signal : fetchOrOptions.signal;
  const timeoutMs = Math.max(
    1,
    Number(typeof fetchOrOptions === "function" ? options.timeoutMs : fetchOrOptions.timeoutMs) ||
      15_000
  );
  const discoveryUrl = normalizeDiscoveryUrl(input);
  if (sameServer(discoveryUrl, SUPABASE_URL)) throw serverError("official_server");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abortFromExternal = () => controller?.abort();
  externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  if (externalSignal?.aborted) abortFromExternal();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller?.abort();
      reject(serverError("connection_failed"));
    }, timeoutMs);
  });
  const requestPromise = (async () => {
    const response = await fetchImpl(discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      ...(controller?.signal || externalSignal
        ? { signal: controller?.signal || externalSignal }
        : {})
    });
    if (!response?.ok) {
      throw serverError("http_error", { statusCode: Number(response?.status || 0) });
    }
    if (new URL(response.url || discoveryUrl).protocol !== "https:") {
      throw serverError("connection_failed");
    }
    return parseDiscoveryDocument(discoveryUrl, await readLimitedText(response));
  })();
  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    if (error?.code) throw error;
    throw serverError("connection_failed", { cause: error });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}
