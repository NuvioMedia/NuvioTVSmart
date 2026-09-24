export function validatePluginUrl(value, { allowPathOnly = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { ok: false, reason: "URL is empty" };
  }
  try {
    const parsed = new URL(raw);
    if (!allowPathOnly && !["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, reason: "Only HTTP(S) URLs are allowed" };
    }
    return { ok: true, url: parsed.toString(), parsed };
  } catch (_) {
    return { ok: false, reason: "Invalid URL" };
  }
}

export function normalizePluginHeaders(headers = {}, { addDefaultUserAgent = true } = {}) {
  const result = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    const name = String(key || "");
    if (!name || value == null || name.toLowerCase() === "accept-encoding") return;
    result[name] = String(value);
  });
  if (addDefaultUserAgent && !Object.prototype.hasOwnProperty.call(result, "User-Agent")) {
    result["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }
  return result;
}

export function normalizePluginHttpMethod(method) {
  const normalized = String(method || "GET").toUpperCase();
  return ["POST", "PUT", "PATCH", "DELETE"].includes(normalized) ? normalized : "GET";
}

export function validatePluginFetchRequest(
  { url, method = "GET", headers = {}, body = "", bodyBase64, bodyKind: requestedBodyKind } = {},
  limits = {}
) {
  const urlResult = validatePluginUrl(url);
  if (!urlResult.ok) {
    return urlResult;
  }
  const maxBodyBytes = Number(limits.maxBodyBytes || 1024 * 1024);
  const bodyText = typeof body === "string" ? body : "";
  const bodyBytes =
    typeof TextEncoder === "function"
      ? new TextEncoder().encode(bodyText).byteLength
      : unescape(encodeURIComponent(bodyText)).length;
  const hasBinaryBody = bodyBase64 !== undefined;
  if (
    hasBinaryBody &&
    (typeof bodyBase64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bodyBase64))
  ) {
    return { ok: false, reason: "Invalid binary request body" };
  }
  const normalizedMethod = normalizePluginHttpMethod(method);
  const bodyKind =
    requestedBodyKind === undefined
      ? hasBinaryBody
        ? "base64"
        : normalizedMethod === "DELETE" || !bodyText
          ? "none"
          : "text"
      : String(requestedBodyKind).toLowerCase();
  if (!["none", "text", "base64"].includes(bodyKind)) {
    return { ok: false, reason: "Unsupported request body type" };
  }
  if ((bodyKind === "base64") !== hasBinaryBody) {
    return { ok: false, reason: "Invalid binary request body" };
  }
  const binaryBytes = hasBinaryBody
    ? (bodyBase64.length / 4) * 3 -
      (bodyBase64.endsWith("==") ? 2 : bodyBase64.endsWith("=") ? 1 : 0)
    : 0;
  const requestBodyBytes = bodyKind === "base64" ? binaryBytes : bodyKind === "text" ? bodyBytes : 0;
  if (requestBodyBytes > maxBodyBytes) {
    return { ok: false, reason: "Request body exceeds the plugin quota" };
  }
  const normalizedHeaders = normalizePluginHeaders(headers, limits);
  if (!Object.keys(normalizedHeaders).some((key) => key.toLowerCase() === "content-type")) {
    if (normalizedMethod === "POST")
      normalizedHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    if (
      ["PUT", "PATCH"].includes(normalizedMethod) ||
      (normalizedMethod === "DELETE" && bodyKind !== "none")
    ) {
      normalizedHeaders["Content-Type"] = "application/json";
    }
  }
  return {
    ok: true,
    url: urlResult.url,
    method: normalizedMethod,
    headers: normalizedHeaders,
    bodyKind,
    body: bodyKind === "text" ? bodyText : "",
    ...(hasBinaryBody ? { bodyBase64 } : {})
  };
}
