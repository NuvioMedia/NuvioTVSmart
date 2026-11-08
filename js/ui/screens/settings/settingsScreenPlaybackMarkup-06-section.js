/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import { renderPlaybackGeneralBody } from "./settingsScreenPlaybackMarkup-01-general.js";
import { renderPlaybackAudioBody } from "./settingsScreenPlaybackMarkup-02-audio.js";
import { renderPlaybackSubtitleBody } from "./settingsScreenPlaybackMarkup-04-subtitles.js";
import { renderPlaybackP2pBody } from "./settingsScreenPlaybackMarkup-05-p2p.js";

export function renderPlaybackSectionMarkup(model) {
  const { TorrentSettingsStore, P2pCacheService, Platform, TizenCapabilities, SECTION_META, t } = internals;
  const expanded = this.expandedSections.playback;
  const torrentSettings = model.torrent || TorrentSettingsStore.get();
  const tizenP2pUnsupported = TizenCapabilities.isP2pUnsupported();
  const p2pUnavailableSubtitle = tizenP2pUnsupported
    ? t("settings_p2p_unsupported_subtitle", {}, "Not supported on this TV.")
    : t("settings_p2p_subtitle");
  const generalBody = renderPlaybackGeneralBody.call(this, model);
  const audioBody = renderPlaybackAudioBody.call(this, model);
  const subtitleBody = renderPlaybackSubtitleBody.call(this, model);
  const p2pBody = renderPlaybackP2pBody.call(this, model, {
    torrentSettings,
    tizenP2pUnsupported,
    p2pUnavailableSubtitle,
    p2pCacheSupported: P2pCacheService.supportsCacheControls(),
    p2pCacheClearing: Boolean(this.p2pCacheClearing),
    p2pCacheClearedBytes: this.p2pCacheClearedBytes ?? null,
    p2pCacheState: this.p2pCacheState || null
  });
  return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "playback"))}
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-stack">
              ${this.renderCollapsibleRow({
                focusKey: "playback:toggle:general",
                title: t("settings.playback.groups.general.title"),
                subtitle: t("settings.playback.groups.general.subtitle"),
                expanded: Boolean(expanded.general),
                bodyHtml: generalBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "playback:toggle:audio",
                title: t("settings.playback.groups.audio.title"),
                subtitle: t("settings.playback.groups.audio.subtitle"),
                expanded: Boolean(expanded.audio),
                bodyHtml: audioBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "playback:toggle:subtitles",
                title: t("settings.playback.groups.subtitles.title"),
                subtitle: t("settings.playback.groups.subtitles.subtitle"),
                expanded: Boolean(expanded.subtitles),
                bodyHtml: subtitleBody
              })}
              ${this.renderCollapsibleRow({
                focusKey: "playback:toggle:p2p",
                title: t("settings_p2p_title"),
                subtitle: t("settings_p2p_subtitle"),
                expanded: Boolean(expanded.p2p),
                bodyHtml: p2pBody
              })}
            </div>
          </div>
        `;
}
