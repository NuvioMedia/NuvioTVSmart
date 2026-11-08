import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "torrentSettings";

export const TORRENT_PROFILES = ["SOFT", "BALANCED", "FAST"];
// Android's Soft/Balanced/Fast presets tune the torrent engine's peer limits.
// EngineFS exposes the same knob through the create request's peerSearch block.
export const TORRENT_PROFILE_PEER_LIMITS = {
  SOFT: { min: 20, max: 80 },
  BALANCED: { min: 40, max: 200 },
  FAST: { min: 60, max: 300 }
};

export const TORRENT_CACHE_SIZES = {
  NONE: 0,
  GB_2: 2 * 1024 * 1024 * 1024,
  GB_5: 5 * 1024 * 1024 * 1024,
  GB_10: 10 * 1024 * 1024 * 1024
};

export const TORRENT_SETTINGS_DEFAULTS = {
  p2pEnabled: false,
  enableUpload: true,
  hideTorrentStats: true,
  torrentProfile: "BALANCED",
  torrentCacheSize: "GB_2"
};

export function getTorrentProfilePeerLimits(profile) {
  return TORRENT_PROFILE_PEER_LIMITS[normalizeTorrentProfile(profile)];
}

function normalizeTorrentProfile(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return TORRENT_PROFILES.includes(normalized)
    ? normalized
    : TORRENT_SETTINGS_DEFAULTS.torrentProfile;
}

function normalizeTorrentCacheSize(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return Object.hasOwn(TORRENT_CACHE_SIZES, normalized)
    ? normalized
    : TORRENT_SETTINGS_DEFAULTS.torrentCacheSize;
}

function normalizeTorrentSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...TORRENT_SETTINGS_DEFAULTS,
    p2pEnabled: Boolean(source.p2pEnabled ?? source.p2p_enabled),
    enableUpload: source.enableUpload ?? source.enable_upload ?? true,
    hideTorrentStats: source.hideTorrentStats ?? source.hide_torrent_stats ?? true,
    torrentProfile: normalizeTorrentProfile(source.torrentProfile ?? source.torrent_profile),
    torrentCacheSize: normalizeTorrentCacheSize(source.torrentCacheSize ?? source.cache_size)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTorrentSettings
});

export const TorrentSettingsStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  setP2pEnabled(enabled, options = {}) {
    return store.set({ p2pEnabled: Boolean(enabled) }, options);
  },

  setEnableUpload(enabled, options = {}) {
    return store.set({ enableUpload: Boolean(enabled) }, options);
  },

  setHideTorrentStats(enabled, options = {}) {
    return store.set({ hideTorrentStats: Boolean(enabled) }, options);
  },

  setTorrentProfile(profile, options = {}) {
    return store.set({ torrentProfile: normalizeTorrentProfile(profile) }, options);
  },

  setTorrentCacheSize(size, options = {}) {
    return store.set({ torrentCacheSize: normalizeTorrentCacheSize(size) }, options);
  }
};
