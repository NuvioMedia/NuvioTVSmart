import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { isExpiredStreamUrl } from "../../core/player/hlsNetworkErrorPolicy.js";

const KEY = "streamLinkCache";
const MAX_ENTRIES = 500;
export const activeStreamLinkProfile = () => String(ProfileManager.getActiveProfileId() || "1");
const text = (value) => (typeof value === "string" ? value.trim() : "");
function contentKey(params) {
  const type = text(params.itemType).toLowerCase() || "movie";
  let videoId = text(params.videoId);
  if (
    !videoId &&
    ["series", "tv"].includes(type) &&
    params.season != null &&
    params.episode != null
  ) {
    videoId = `${text(params.itemId)}:${params.season}:${params.episode}`;
  }
  videoId ||= text(params.itemId);
  return videoId ? `${type === "tv" ? "series" : type}|${videoId}` : "";
}
export function sanitizeCachedStreamHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers && typeof headers === "object" ? headers : {})
      .filter(
        ([key, value]) =>
          typeof value === "string" &&
          /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key.trim()) &&
          key.trim().toLowerCase() !== "range" &&
          value.trim() &&
          !/[\r\n]/.test(value)
      )
      .map(([key, value]) => [key.trim(), value.trim()])
  );
}
export function isReusableHttpUrl(value) {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch (_) {
    return false;
  }
}
function readAll() {
  const all = LocalStore.get(KEY, {});
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}
function validPayload(value, maxAgeMs) {
  const age = Date.now() - Number(value?.cachedAtMs);
  return (
    value?.version === 1 &&
    text(value.streamName) &&
    Number.isFinite(age) &&
    age >= 0 &&
    Number(value.cachedAtMs) > 0 &&
    age <= maxAgeMs &&
    ((isReusableHttpUrl(value.url) && !isExpiredStreamUrl(value.url)) ||
      (!value.url && /^[0-9a-f]{40}$/i.test(value.infoHash || "")))
  );
}
// Deliberately separate from synced settings and from source-selection preferences.
export const StreamLinkCacheStore = {
  save(params, payload, profileId = activeStreamLinkProfile()) {
    const key = contentKey(params);
    if (!key || !payload || !profileId) return false;
    const entry = {
      ...payload,
      headers: sanitizeCachedStreamHeaders(payload.headers),
      key,
      version: 1,
      cachedAtMs: Date.now()
    };
    if (!validPayload(entry, Infinity)) return false;
    const all = readAll();
    const entries = Array.isArray(all[profileId]) ? all[profileId] : [];
    all[profileId] = [entry, ...entries.filter((item) => item?.key !== key)].slice(0, MAX_ENTRIES);
    LocalStore.set(KEY, all);
    return true;
  },
  remove(params, profileId = activeStreamLinkProfile()) {
    const key = contentKey(params || {});
    if (!key || !profileId) return false;
    const all = readAll();
    const entries = Array.isArray(all[profileId]) ? all[profileId] : [];
    const next = entries.filter((item) => item?.key !== key);
    if (next.length === entries.length) return false;
    all[profileId] = next;
    LocalStore.set(KEY, all);
    return true;
  },
  getValid(params, maxAgeMs, profileId = activeStreamLinkProfile()) {
    const key = contentKey(params);
    if (!key || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;
    const all = readAll();
    const entries = Array.isArray(all[profileId]) ? all[profileId] : [];
    const entry = entries.find((item) => item?.key === key);
    if (!entry) return null;
    if (!validPayload(entry, maxAgeMs)) {
      all[profileId] = entries.filter((item) => item?.key !== key);
      LocalStore.set(KEY, all);
      return null;
    }
    return {
      ...entry,
      headers: sanitizeCachedStreamHeaders(entry.headers),
      sources: Array.isArray(entry.sources)
        ? entry.sources.filter((value) => typeof value === "string")
        : []
    };
  }
};
