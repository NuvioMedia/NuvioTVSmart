/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderPlaybackP2pBody(
  model,
  {
    torrentSettings,
    tizenP2pUnsupported,
    p2pUnavailableSubtitle,
    p2pCacheSupported = false,
    p2pCacheClearing = false,
    p2pCacheClearedBytes = null,
    p2pCacheState = null
  }
) {
  const { t, formatByteSize } = internals;
  const profile = String(torrentSettings.torrentProfile || "BALANCED");
  const cacheSize = String(torrentSettings.torrentCacheSize || "GB_2");
  const cacheSizeLabelKey = cacheSize === "NONE" ? "settings_p2p_cache_none" : `settings_p2p_cache_${cacheSize.replace("GB_", "")}_gb`;
  const cacheAvailable = p2pCacheSupported && !tizenP2pUnsupported;
  const cacheState = p2pCacheState || null;
  let cacheSubtitle = t(
    "settings_p2p_clear_cache_usage_pending",
    {},
    "Usage is measured after P2P starts; select to clear cached torrent data"
  );
  if (!cacheAvailable) {
    cacheSubtitle = t("settings_p2p_cache_unsupported", {}, "Not available on this TV.");
  } else if (p2pCacheClearing) {
    cacheSubtitle = t("settings_p2p_clear_cache_clearing", {}, "Clearing inactive torrent data…");
  } else if (p2pCacheClearedBytes != null) {
    cacheSubtitle = t(
      "settings_p2p_clear_cache_done",
      [formatByteSize(p2pCacheClearedBytes)],
      `Cleared ${formatByteSize(p2pCacheClearedBytes)} of inactive torrent data`
    );
  } else if (cacheState?.available) {
    cacheSubtitle = t(
      "settings_p2p_clear_cache_usage",
      [formatByteSize(cacheState.usedBytes)],
      `${formatByteSize(cacheState.usedBytes)} currently used`
    );
  }
  return `
          <div class="settings-stack">
            ${this.renderToggleRow({
              focusKey: "playback:p2pEnabled",
              title: t("settings_p2p_title"),
              subtitle: p2pUnavailableSubtitle,
              checked: tizenP2pUnsupported ? false : Boolean(torrentSettings.p2pEnabled),
              disabled: tizenP2pUnsupported
            })}
            ${this.renderToggleRow({
              focusKey: "playback:hideTorrentStats",
              title: t("settings_p2p_hide_stats_title"),
              subtitle: tizenP2pUnsupported ? p2pUnavailableSubtitle : t("settings_p2p_hide_stats_subtitle"),
              checked: tizenP2pUnsupported ? false : Boolean(torrentSettings.hideTorrentStats),
              disabled: tizenP2pUnsupported
            })}
            ${this.renderActionRow({
              focusKey: "playback:torrentProfile",
              title: t("settings_p2p_profile_title", {}, "Torrent profile"),
              subtitle: t(`settings_p2p_profile_${profile.toLowerCase()}_description`, {}, ""),
              value: t(`settings_p2p_profile_${profile.toLowerCase()}`, {}, profile),
              disabled: tizenP2pUnsupported
            })}
            ${this.renderActionRow({
              focusKey: "playback:torrentCacheSize",
              title: t("settings_p2p_cache_size_title", {}, "Torrent cache size"),
              subtitle: cacheAvailable
                ? t("settings_p2p_cache_size_description", {}, "Downloaded torrent data kept on this device for faster replays")
                : t("settings_p2p_cache_unsupported", {}, "Not available on this TV."),
              value: t(cacheSizeLabelKey, {}, cacheSize),
              disabled: !cacheAvailable
            })}
            ${this.renderActionRow({
              focusKey: "playback:clearTorrentCache",
              title: t("settings_p2p_clear_cache_title", {}, "Clear torrent cache"),
              subtitle: cacheSubtitle,
              disabled: !cacheAvailable || p2pCacheClearing
            })}
          </div>
        `;
}
