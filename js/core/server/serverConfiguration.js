function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
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

export function normalizePublicBackendUrl(value) {
  const normalized = normalizeUrl(value);
  if (!isPublicHttpsUrl(normalized)) return "";
  const parsed = new URL(normalized);
  if (parsed.search || parsed.hash) return "";
  return parsed.toString().replace(/\/+$/, "");
}

export function sameServer(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && a.port === b.port;
  } catch (_) {
    return false;
  }
}

export function createServerConfiguration({
  backendUrl,
  publishableKey,
  capabilities,
  isCustom,
  fallbackBackendUrl = "",
  tvLoginWebBaseUrl = "",
  avatarPublicBaseUrl = ""
}) {
  const normalizedBackendUrl = isCustom
    ? normalizePublicBackendUrl(backendUrl)
    : normalizeUrl(backendUrl);
  const normalizedKey = String(publishableKey || "").trim();
  const normalizedCapabilities = {
    emailPasswordAuth: capabilities?.emailPasswordAuth === true,
    tvLogin: capabilities?.tvLogin === true
  };
  if (
    isCustom &&
    (!normalizedBackendUrl ||
      !normalizedKey ||
      (!normalizedCapabilities.emailPasswordAuth && !normalizedCapabilities.tvLogin))
  ) {
    return null;
  }
  return Object.freeze({
    backendUrl: normalizedBackendUrl,
    publishableKey: normalizedKey,
    capabilities: Object.freeze(normalizedCapabilities),
    isCustom: Boolean(isCustom),
    fallbackBackendUrl: isCustom ? "" : normalizeUrl(fallbackBackendUrl),
    tvLoginWebBaseUrl: isCustom
      ? `${normalizedBackendUrl}/tv-login`
      : normalizeUrl(tvLoginWebBaseUrl),
    avatarPublicBaseUrl:
      (isCustom ? "" : normalizeUrl(avatarPublicBaseUrl)) ||
      (normalizedBackendUrl ? `${normalizedBackendUrl}/storage/v1/object/public/avatars` : "")
  });
}

export function supportsTvLogin(configuration) {
  return Boolean(
    configuration?.backendUrl &&
    configuration?.publishableKey &&
    configuration?.capabilities?.tvLogin
  );
}

export function supportsEmailPasswordAuth(configuration) {
  return Boolean(configuration?.capabilities?.emailPasswordAuth);
}
