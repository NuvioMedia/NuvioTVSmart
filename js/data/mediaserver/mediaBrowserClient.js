import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
export function normalizeMediaServerAddress(value, provider) {
  try {
    const url = new URL(String(value).trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    let base = url.toString().replace(/\/+$/, "");
    if (provider === "emby") base = base.replace(/\/emby$/i, "");
    return base;
  } catch (_) {
    return null;
  }
}
// Android ServerRepository.profileDeviceId: Jellyfin revokes a user's previous token when the
// same DeviceId signs in again, so each secondary profile gets its own. The primary profile
// keeps the installation id, so existing sign-ins stay valid.
export function mediaServerDeviceId(profileId = ProfileManager.getActiveProfileId()) {
  let id = LocalStore.get("mediaServerDeviceId", null);
  if (!id) {
    const data = new Uint8Array(16);
    globalThis.crypto.getRandomValues(data);
    id = Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
    LocalStore.set("mediaServerDeviceId", id);
  }
  const pid = String(profileId ?? "1").trim() || "1";
  return pid === "1" ? id : `${id}-p${pid}`;
}
export function mediaServerApiRoot(connection) {
  return connection.address + (connection.providerId === "emby" ? "/emby" : "");
}
export function mediaServerUrl(connection, path, query = {}) {
  const url = new URL(mediaServerApiRoot(connection) + path);
  for (const [key, value] of Object.entries(query))
    if (value != null) url.searchParams.set(key, String(value));
  return url.toString();
}
export function mediaServerHeaders(connection) {
  const safe = (value) => String(value || "").replace(/["\r\n\\]/g, "");
  const auth = `MediaBrowser Client="Nuvio", Device="Smart TV", DeviceId="${safe(mediaServerDeviceId())}", Version="1.2.8"${connection.token ? `, Token="${safe(connection.token)}"` : ""}`;
  return { [connection.providerId === "emby" ? "X-Emby-Authorization" : "Authorization"]: auth };
}
export async function mediaServerRequest(
  connection,
  path,
  { method = "GET", query = {}, body, signal, publicInfo = false } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(mediaServerUrl(connection, path, query), {
      method,
      headers: {
        Accept: "application/json",
        ...mediaServerHeaders(connection),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: publicInfo ? "follow" : "error"
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "servers_error_auth"
          : response.status === 403
            ? "servers_error_forbidden"
            : "servers_error_failed"
      );
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export function serverEndpoint(connection, kind, itemId = "") {
  const user = encodeURIComponent(connection.remoteUserId);
  const item = encodeURIComponent(itemId);
  const jellyfin = {
    views: "/UserViews",
    items: "/Items",
    item: `/Items/${item}`,
    resume: "/UserItems/Resume",
    played: `/UserPlayedItems/${item}`
  };
  const emby = {
    views: `/Users/${user}/Views`,
    items: `/Users/${user}/Items`,
    item: `/Users/${user}/Items/${item}`,
    resume: `/Users/${user}/Items/Resume`,
    played: `/Users/${user}/PlayedItems/${item}`
  };
  return {
    path: (connection.providerId === "emby" ? emby : jellyfin)[kind],
    query: connection.providerId === "emby" ? {} : { userId: connection.remoteUserId }
  };
}
export function isSupportedServerVersion(provider, version) {
  const minimum = provider === "emby" ? [4, 7] : [10, 9];
  const actual = String(version || "")
    .split(".")
    .map(Number);
  if (!Number.isFinite(actual[0])) return false;
  for (let i = 0; i < minimum.length; i++) {
    const value = actual[i] || 0;
    if (value !== minimum[i]) return value > minimum[i];
  }
  return true;
}

export function mediaServerAssetUrl(connection, value) {
  const path = String(value || "");
  if (/^https?:\/\//i.test(path)) return new URL(path).toString();
  if (connection.providerId === "emby" && /^\/emby(?:\/|\?)/i.test(path))
    return connection.address + path;
  return mediaServerApiRoot(connection) + "/" + path.replace(/^\/+/, "");
}
