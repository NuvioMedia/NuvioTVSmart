import { registerMdbListAccountActions } from "./settingsMdbListAccount.js";
import { MdbListAccount } from "../../../data/repository/mdbListAccount.js";
/* eslint-disable no-unused-vars */
import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { TraktAuthService } from "../../../data/repository/traktAuthService.js";
import { SimklAuthService } from "../../../data/repository/simklAuthService.js";
import { SimklSyncService } from "../../../data/repository/simklSyncService.js";
import {
  SimklAnimeIdPreference,
  MoreLikeThisSourcePreference,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource,
  normalizeTraktContinueWatchingDaysCap
} from "../../../data/local/traktSettingsStore.js";
import { I18n } from "../../../i18n/index.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}

function captureTraktScrollState(container) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  return {
    traktScrollTop: Number(scrollArea?.scrollTop || 0)
  };
}

function restoreTraktScrollState(container, scrollState) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  if (scrollArea && scrollState) {
    scrollArea.scrollTop = Number(scrollState.traktScrollTop || 0);
  }
}

function formatCountdown(valueMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

import { ProfileManager } from "../../../core/profile/profileManager.js";
function isTrackingActive(screen) {
  return (
    Router.getCurrent() === "trakt" ||
    (Router.getCurrent() === "settings" && screen.activeSection === "trakt" && screen.isMounted)
  );
}
export function createTrackingSettingsMethods() {
  return {
    stopTrackingWork() {
      this.trackingWorkGeneration = (this.trackingWorkGeneration || 0) + 1;
      this.traktPollInFlight = null;
      this.simklPollInFlight = null;
      this.stopTraktPolling?.();
      this.stopTraktClock?.();
      if (this.simklPollTimer) clearTimeout(this.simklPollTimer);
      this.simklPollTimer = null;
    },
    startTraktClock() {
      if (this.traktClockTimer) {
        return;
      }
      this.updateTraktCountdowns();
      this.traktClockTimer = setInterval(() => {
        if (!isTrackingActive(this)) {
          this.stopTraktClock();
          return;
        }
        this.updateTraktCountdowns();
      }, 1000);
    },

    stopTraktClock() {
      if (!this.traktClockTimer) {
        return;
      }
      clearInterval(this.traktClockTimer);
      this.traktClockTimer = null;
    },

    updateTraktCountdowns() {
      if (!this.container) {
        return;
      }
      const auth = TraktAuthService.getCurrentAuthState();
      const deviceCountdown = this.container.querySelector("[data-trakt-device-countdown]");
      if (deviceCountdown && auth.expiresAt) {
        deviceCountdown.textContent = formatCountdown(Number(auth.expiresAt) - Date.now());
      }

      const tokenCountdown = this.container.querySelector("[data-trakt-token-countdown]");
      if (tokenCountdown && auth.createdAt && auth.expiresIn) {
        const expiresAtMs = (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000;
        tokenCountdown.textContent = formatCountdown(expiresAtMs - Date.now());
      }
      const simklAuth = SimklAuthService.getCurrentAuthState();
      const simklCountdown = this.container.querySelector("[data-simkl-device-countdown]");
      if (simklCountdown && simklAuth.expiresAt) {
        simklCountdown.textContent = formatCountdown(Number(simklAuth.expiresAt) - Date.now());
      }
    },

    openTrackingChoice({ title, options, selectedId, returnFocusKey, onSelect }) {
      const profileId = ProfileManager.getActiveProfileId();
      const generation = this.trackingWorkGeneration || 0;
      this.openOptionDialog({
        title,
        options: options.map((option) => ({ ...option, label: option.label || option.id })),
        selectedId,
        returnFocusKey,
        onSelect: (option) => {
          if (
            isTrackingActive(this) &&
            ProfileManager.getActiveProfileId() === profileId &&
            (this.trackingWorkGeneration || 0) === generation
          )
            return onSelect(option);
          return false;
        }
      });
    },

    async startTraktDeviceAuth() {
      const profileId = ProfileManager.getActiveProfileId();
      const generation = this.trackingWorkGeneration || 0;
      const current = () =>
        isTrackingActive(this) &&
        ProfileManager.getActiveProfileId() === profileId &&
        (this.trackingWorkGeneration || 0) === generation;
      this.traktLoading = true;
      this.traktErrorMessage = null;
      this.traktStatusMessage = null;
      await this.render();
      if (!current()) return;
      try {
        await TraktAuthService.startDeviceAuth();
        if (!current()) return;
        this.traktStatusMessage = t(
          "trakt_status_enter_activation_code",
          {},
          "Enter the code on trakt.tv/activate"
        );
        this.startTraktPolling();
      } catch (error) {
        if (current())
          this.traktErrorMessage = String(
            error?.message || t("qr_login_start_failed", {}, "Failed to start login")
          );
      } finally {
        if (current()) {
          this.traktLoading = false;
          await this.render();
        }
      }
    },

    async loadTraktStats(forceRefresh = false) {
      const profileId = ProfileManager.getActiveProfileId();
      const generation = this.trackingWorkGeneration || 0;
      const current = () =>
        isTrackingActive(this) &&
        ProfileManager.getActiveProfileId() === profileId &&
        (this.trackingWorkGeneration || 0) === generation;
      if (!TraktAuthService.isAuthenticated()) {
        this.traktStats = null;
        this.traktStatsLoading = false;
        return;
      }
      this.traktStatsLoading = true;
      try {
        const stats = await TraktAuthService.fetchStats(forceRefresh);
        if (current()) this.traktStats = stats;
      } catch (_) {
        if (current()) this.traktStats = null;
      } finally {
        if (current()) this.traktStatsLoading = false;
      }
    },

    renderTrackingSection() {
      const profileId = ProfileManager.getActiveProfileId();
      if (this.trackingRenderProfile !== profileId) {
        this.stopTrackingWork();
        this.trackingRenderProfile = profileId;
        this.traktStats = null;
        this.traktStatsLoading = false;
        this.traktLoading = false;
        this.traktErrorMessage = null;
        this.simklErrorMessage = null;
        this.traktStatusMessage = null;
        this.simklStatusMessage = null;
        this.expandedProvider = null;
      }
      const generation = this.trackingWorkGeneration || 0;
      const current = () =>
        isTrackingActive(this) &&
        ProfileManager.getActiveProfileId() === profileId &&
        (this.trackingWorkGeneration || 0) === generation;
      const setAction = (key, callback) =>
        this.actionMap.set(key, (...args) => (current() ? callback(...args) : false));
      this.startTraktClock();
      registerMdbListAccountActions.call(this);
      if (TraktAuthService.getCurrentAuthState().deviceCode) this.startTraktPolling();
      if (SimklAuthService.getCurrentAuthState().userCode) this.startSimklPolling();
      const trakt = TraktAuthService.getCurrentAuthState();
      const simkl = SimklAuthService.getCurrentAuthState();
      const settings = TraktSettingsStore.get();
      const traktConnected = TraktAuthService.isAuthenticated();
      const simklConnected = SimklAuthService.isAuthenticated();
      const traktWaiting = Boolean(trakt.deviceCode && trakt.expiresAt > Date.now());
      const simklWaiting = Boolean(simkl.userCode && simkl.expiresAt > Date.now());
      const connectedWatchSources = [
        ...(MdbListAccount.connected()
          ? [{ id: WatchProgressSource.MDBLIST, label: "MDBList" }]
          : []),
        { id: WatchProgressSource.NUVIO_SYNC, label: "Nuvio Sync" },
        ...(traktConnected ? [{ id: WatchProgressSource.TRAKT, label: "Trakt" }] : []),
        ...(simklConnected ? [{ id: WatchProgressSource.SIMKL, label: "Simkl" }] : [])
      ];
      const connectedLibrarySources = [
        ...(MdbListAccount.connected()
          ? [{ id: TraktLibrarySourceMode.MDBLIST, label: "MDBList" }]
          : []),
        { id: TraktLibrarySourceMode.LOCAL, label: "Nuvio" },
        ...(traktConnected ? [{ id: TraktLibrarySourceMode.TRAKT, label: "Trakt" }] : []),
        ...(simklConnected ? [{ id: TraktLibrarySourceMode.SIMKL, label: "Simkl" }] : [])
      ];

      setAction("tracking:trakt", () => {
        this.expandedProvider = this.expandedProvider === "trakt" ? null : "trakt";
      });
      setAction("tracking:simkl", () => {
        this.expandedProvider = this.expandedProvider === "simkl" ? null : "simkl";
      });
      setAction("tracking:traktConnect", async () => {
        await this.startTraktDeviceAuth();
        if (current()) this.expandedProvider = "trakt";
      });
      setAction("tracking:simklConnect", async () => {
        this.simklErrorMessage = null;
        try {
          await SimklAuthService.startPinAuth();
          if (!current()) return;
          this.simklStatusMessage = t(
            "simkl_status_enter_code",
            {},
            "Enter the code on Simkl to finish connecting."
          );
          this.startSimklPolling();
        } catch (error) {
          if (!current()) return;
          this.simklErrorMessage = String(
            error?.message ||
              error ||
              t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
          );
        }
        if (current()) this.expandedProvider = "simkl";
      });
      setAction("tracking:traktDisconnect", () => {
        this.openOptionDialog({
          title: t("trakt_disconnect_title", {}, "Disconnect Trakt?"),
          options: [
            { id: "disconnect", label: t("trakt_disconnect", {}, "Disconnect") },
            { id: "cancel", label: t("action_cancel", {}, "Cancel") }
          ],
          selectedId: "cancel",
          returnFocusKey: "tracking:trakt",
          onSelect: async (option) => {
            if (!current() || option.id !== "disconnect") return;
            await TraktAuthService.disconnect();
          }
        });
      });
      setAction("tracking:simklDisconnect", () => {
        this.openOptionDialog({
          title: t("simkl_disconnect_title", {}, "Disconnect Simkl?"),
          options: [
            { id: "disconnect", label: t("simkl_disconnect", {}, "Disconnect") },
            { id: "cancel", label: t("action_cancel", {}, "Cancel") }
          ],
          selectedId: "cancel",
          returnFocusKey: "tracking:simkl",
          onSelect: async (option) => {
            if (!current() || option.id !== "disconnect") return;
            await SimklAuthService.disconnect();
            if (current()) SimklSyncService.clearCurrentProfile();
          }
        });
      });
      setAction("tracking:simklSync", async () => {
        this.simklStatusMessage = t("simkl_status_syncing", {}, "Syncing Simkl…");
        this.simklErrorMessage = null;
        try {
          await SimklSyncService.refresh({ force: true });
          if (!current()) return;
          this.simklStatusMessage = t("simkl_status_synced", {}, "Simkl sync completed.");
        } catch (error) {
          this.simklStatusMessage = null;
          this.simklErrorMessage = String(
            error?.message ||
              error ||
              t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
          );
        }
      });
      setAction("tracking:simklInfo", () => {
        this.showSimklInfo = !this.showSimklInfo;
      });
      setAction("tracking:simklVisit", () => window.open?.("https://simkl.com", "_blank"));
      setAction("tracking:simklDocs", () =>
        window.open?.("https://api.simkl.org/guides/sync", "_blank")
      );
      setAction("tracking:librarySource", () =>
        this.openTrackingChoice({
          title: t("trakt_library_source_title", {}, "Library source"),
          options: connectedLibrarySources,
          selectedId: settings.librarySourceMode,
          returnFocusKey: "tracking:librarySource",
          onSelect: (option) => TraktSettingsStore.setLibrarySourceMode(option.id)
        })
      );
      setAction("tracking:progressSource", () =>
        this.openTrackingChoice({
          title: t("trakt_watch_progress_title", {}, "Watch progress source"),
          options: connectedWatchSources,
          selectedId: settings.watchProgressSource,
          returnFocusKey: "tracking:progressSource",
          onSelect: (option) => TraktSettingsStore.setWatchProgressSource(option.id)
        })
      );
      setAction("tracking:cwWindow", () => {
        const values = [14, 30, 60, 90, 180, 365, 0];
        this.openTrackingChoice({
          title: t("trakt_continue_watching_window", {}, "Continue Watching window"),
          options: values.map((days) => ({
            id: String(days),
            label:
              days === 0
                ? t("trakt_all_history", {}, "All history")
                : t("trakt_days_format", [days], `${days} days`)
          })),
          selectedId: String(settings.continueWatchingDaysCap),
          returnFocusKey: "tracking:cwWindow",
          onSelect: (option) =>
            TraktSettingsStore.setContinueWatchingDaysCap(
              normalizeTraktContinueWatchingDaysCap(Number(option.id))
            )
        });
      });
      setAction("tracking:comments", () => {
        TraktSettingsStore.setShowMetaComments(!settings.showMetaComments);
      });
      setAction("tracking:moreLikeThis", () =>
        this.openTrackingChoice({
          title: t("trakt_more_like_this_source_title", {}, "More Like This source"),
          options: [
            { id: MoreLikeThisSourcePreference.TRAKT, label: "Trakt" },
            { id: MoreLikeThisSourcePreference.TMDB, label: "TMDB" }
          ],
          selectedId: settings.moreLikeThisSource,
          returnFocusKey: "tracking:moreLikeThis",
          onSelect: (option) => TraktSettingsStore.setMoreLikeThisSource(option.id)
        })
      );
      setAction("tracking:animeId", () =>
        this.openTrackingChoice({
          title: t("tracking_simkl_anime_id_title", {}, "Simkl anime ID"),
          options: [
            { id: SimklAnimeIdPreference.IMDB, label: "IMDb / TMDB" },
            { id: SimklAnimeIdPreference.MAL, label: "MyAnimeList" },
            { id: SimklAnimeIdPreference.KITSU, label: "Kitsu" },
            { id: SimklAnimeIdPreference.TVDB, label: "TVDB" }
          ],
          selectedId: settings.simklAnimeIdPreference,
          returnFocusKey: "tracking:animeId",
          onSelect: (option) => {
            TraktSettingsStore.setSimklAnimeIdPreference(option.id);
            if (current()) SimklSyncService.clearCurrentProfile();
            void SimklSyncService.refresh({ force: true });
          }
        })
      );

      const providerRow = ({ id, title, connected, waiting, username }) =>
        this.renderActionRow({
          focusKey: `tracking:${id}`,
          leadingIconSrc:
            id === "simkl" ? "assets/icons/simkl_tv_glyph.svg" : "assets/icons/trakt_tv_glyph.svg",
          title,
          subtitle: connected
            ? t(
                id === "simkl" ? "simkl_connected_as" : "trakt_connected_as",
                [username || `${title} user`],
                `Connected as ${username || `${title} user`}`
              )
            : waiting
              ? t("tracking_status_waiting", {}, "Waiting for approval")
              : t(id === "simkl" ? "simkl_connect" : "trakt_login", {}, `Connect ${title}`),
          value: connected
            ? t("tracking_status_connected", {}, "Connected")
            : waiting
              ? t("tracking_status_waiting", {}, "Waiting")
              : t("tracking_status_disconnected", {}, "Not connected")
        });

      return `
      <section class="settings-slide-panel settings-trakt-panel settings-tracking-panel">
        <div class="settings-trakt-hero settings-tracking-hero">
          <div>
            <div class="settings-trakt-title">${escapeHtml(t("settings_tracking_title", {}, "Tracking"))}</div>
            <p class="settings-trakt-description">${escapeHtml(t("settings_tracking_description", {}, "Connect tracking providers and choose which one powers your Library and Continue Watching."))}</p>
          </div>
        </div>
        <div class="settings-trakt-scroll-area">
          <div class="settings-trakt-card">
            <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_accounts_title", {}, "Accounts"))}</h3>
            <p class="settings-tracking-card-subtitle">${escapeHtml(t("tracking_accounts_subtitle", {}, "Connect and manage tracking services"))}</p>
            <div class="settings-trakt-options-stack">
              ${this.renderActionRow({ focusKey: "integration:mdblist:account", leadingIconSrc: "assets/icons/mdblist_logo.svg", title: "MDBList", subtitle: MdbListAccount.connected() ? t("mdblist_connected_as", [MdbListAccount.user()?.name || t("mdblist_account_fallback")]) : t("mdblist_tracking_description"), value: MdbListAccount.connected() ? t("tracking_status_connected", {}, "Connected") : t("servers_connect"), disabled: !MdbListAccount.configured() && !MdbListAccount.connected() })}
              ${providerRow({ id: "trakt", title: "Trakt", connected: traktConnected, waiting: traktWaiting, username: trakt.username })}
              ${providerRow({ id: "simkl", title: "Simkl", connected: simklConnected, waiting: simklWaiting, username: simkl.username })}
            </div>
          </div>
          ${this.mdbListAccountMessage ? `<p class="settings-trakt-message" role="status">${escapeHtml(this.mdbListAccountMessage)}</p>` : ""}
          ${this.expandedProvider === "trakt" ? this.renderTrackingTraktAccount(trakt, traktConnected, traktWaiting) : ""}
          ${this.expandedProvider === "simkl" ? this.renderTrackingSimklAccount(simkl, simklConnected, simklWaiting) : ""}
          <div class="settings-trakt-card">
            <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_sources_title", {}, "Sources"))}</h3>
            <p class="settings-tracking-card-subtitle">${escapeHtml(t("tracking_sources_subtitle", {}, "Choose where Nuvio reads your library and watch progress. Playback scrobbles to every connected service."))}</p>
            <div class="settings-trakt-options-stack">
              ${this.renderActionRow({ focusKey: "tracking:librarySource", title: t("trakt_library_source_title", {}, "Library source"), subtitle: t("tracking_library_source_dialog_subtitle", {}, "Choose the service Nuvio reads for your Library."), value: connectedLibrarySources.find((item) => item.id === settings.librarySourceMode)?.label || "Nuvio" })}
              ${this.renderActionRow({ focusKey: "tracking:progressSource", title: t("trakt_watch_progress_title", {}, "Watch progress source"), subtitle: t("tracking_watch_progress_dialog_subtitle", {}, "Choose the service Nuvio reads for resume and Continue Watching."), value: connectedWatchSources.find((item) => item.id === settings.watchProgressSource)?.label || "Nuvio Sync" })}
            </div>
          </div>
          ${
            traktConnected
              ? `
            <div class="settings-trakt-card">
              <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_trakt_features_title", {}, "Trakt features"))}</h3>
              <p class="settings-tracking-card-subtitle">${escapeHtml(t("tracking_trakt_features_subtitle", {}, "Trakt-specific history, reviews, and recommendations"))}</p>
              <div class="settings-trakt-options-stack">
                ${this.renderActionRow({ focusKey: "tracking:cwWindow", title: t("trakt_continue_watching_window", {}, "Continue Watching window"), subtitle: t("trakt_continue_watching_subtitle", {}, "Trakt history considered for Continue Watching"), value: settings.continueWatchingDaysCap === 0 ? t("trakt_all_history", {}, "All history") : t("trakt_days_format", [settings.continueWatchingDaysCap], `${settings.continueWatchingDaysCap} days`) })}
                ${this.renderToggleRow({ focusKey: "tracking:comments", title: t("trakt_comments_title", {}, "Trakt comments"), subtitle: t("trakt_comments_subtitle", {}, "Show Trakt reviews on metadata pages"), checked: Boolean(settings.showMetaComments) })}
                ${this.renderActionRow({ focusKey: "tracking:moreLikeThis", title: t("trakt_more_like_this_source_title", {}, "More Like This source"), subtitle: t("trakt_more_like_this_source_subtitle", {}, "Choose related titles from Trakt or TMDB"), value: settings.moreLikeThisSource === MoreLikeThisSourcePreference.TMDB ? "TMDB" : "Trakt" })}
              </div>
            </div>
          `
              : ""
          }
          ${
            simklConnected
              ? `
            <div class="settings-trakt-card">
              <h3 class="settings-trakt-card-title">${escapeHtml(t("tracking_simkl_features_title", {}, "Simkl features"))}</h3>
              <p class="settings-tracking-card-subtitle">${escapeHtml(t("tracking_simkl_features_subtitle", {}, "Simkl-specific settings"))}</p>
              <div class="settings-trakt-options-stack">
                ${this.renderActionRow({ focusKey: "tracking:animeId", title: t("tracking_simkl_anime_id_title", {}, "Anime ID preference"), subtitle: t("tracking_simkl_anime_id_subtitle", {}, "Controls how anime series are identified"), value: settings.simklAnimeIdPreference === "mal" ? "MyAnimeList" : settings.simklAnimeIdPreference === "kitsu" ? "Kitsu" : settings.simklAnimeIdPreference === "tvdb" ? "TVDB" : "IMDb / TMDB" })}
              </div>
            </div>
          `
              : ""
          }
          ${simklConnected ? `<p class="settings-trakt-meta-copy settings-tracking-attribution">${escapeHtml(t("licenses_attributions_simkl_body", {}, "Library and tracking data provided by Simkl."))}</p>` : ""}
        </div>
      </section>
    `;
    },

    renderTrackingTraktAccount(auth, connected, waiting) {
      if (connected) {
        const tokenRemainingMs =
          auth.createdAt && auth.expiresIn
            ? Math.max(0, (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000 - Date.now())
            : 0;
        return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("trakt_account_login", {}, "Trakt account"))}</h3><p class="settings-trakt-body-copy">${escapeHtml(t("trakt_connected_as", [auth.username || "Trakt user"], `Connected as ${auth.username || "Trakt user"}`))}</p>${tokenRemainingMs ? `<p class="settings-trakt-meta-copy">${escapeHtml(t("trakt_token_refreshes", [formatCountdown(tokenRemainingMs)], `Token refreshes in ${formatCountdown(tokenRemainingMs)}`))}</p>` : ""}${this.renderTraktStatsStrip(this.traktStats, this.traktStatsLoading)}${this.renderActionRow({ focusKey: "tracking:traktDisconnect", title: t("trakt_disconnect", {}, "Disconnect Trakt"), subtitle: t("trakt_disconnect_subtitle", {}, "Remove this profile's Trakt connection") })}</div>`;
      }
      return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("trakt_login", {}, "Connect Trakt"))}</h3>${waiting ? `<p class="settings-trakt-body-copy">${escapeHtml(t("trakt_awaiting_instruction", {}, "Open the Trakt activation page on another device and enter this code."))}</p><strong>${escapeHtml(auth.verificationUrl || "https://trakt.tv/activate")}</strong><div class="settings-trakt-code">${escapeHtml(auth.userCode || "-")}</div><p class="settings-trakt-meta-copy">${escapeHtml(t("trakt_code_expires", [formatCountdown(Number(auth.expiresAt) - Date.now())], `Code expires in ${formatCountdown(Number(auth.expiresAt) - Date.now())}`))}</p>` : `<p class="settings-trakt-body-copy">${escapeHtml(t("trakt_manual_code_description", {}, "A manual activation code will be shown here. No QR code is required."))}</p>${this.renderActionRow({ focusKey: "tracking:traktConnect", title: t("trakt_login", {}, "Connect Trakt"), subtitle: TraktAuthService.hasRequiredCredentials() ? t("trakt_manual_code_description", {}, "Generate activation code") : t("trakt_missing_credentials", {}, "Missing Trakt client credentials") })}`}${this.traktStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.traktStatusMessage)}</p>` : ""}${this.traktErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.traktErrorMessage)}</p>` : ""}</div>`;
    },

    renderTrackingSimklAccount(auth, connected, waiting) {
      if (connected) {
        return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("simkl_account_title", {}, "Simkl account"))}</h3><p class="settings-trakt-body-copy">${escapeHtml(t("simkl_connected_as", [auth.username || "Simkl user"], `Connected as ${auth.username || "Simkl user"}`))}</p>${this.renderActionRow({ focusKey: "tracking:simklSync", title: t("simkl_sync_now", {}, "Sync now"), subtitle: t("simkl_status_syncing", {}, "Check Simkl immediately for remote changes") })}${this.renderActionRow({ focusKey: "tracking:simklVisit", title: t("simkl_visit", {}, "Visit Simkl") })}${this.renderActionRow({ focusKey: "tracking:simklInfo", title: t("simkl_sync_info_action", {}, "How syncing works"), subtitle: t("simkl_sync_info_title", {}, "Automatic refresh and Continue Watching rules") })}${this.showSimklInfo ? `<div class="settings-tracking-sync-info"><p>${escapeHtml(t("simkl_sync_info_description", [15], "Nuvio checks Simkl automatically at most once every 15 minutes."))}</p><p>${escapeHtml(t("simkl_sync_info_activity", {}, "Each refresh downloads only changes."))}</p><p>${escapeHtml(t("simkl_sync_info_manual", {}, "Changes made in Nuvio are sent immediately."))}</p><p>${escapeHtml(t("simkl_sync_info_library_statuses", {}, "On Hold and Dropped shows stay hidden from Continue Watching."))}</p>${this.renderActionRow({ focusKey: "tracking:simklDocs", title: t("simkl_sync_info_docs", {}, "Read the Simkl sync guide") })}</div>` : ""}${this.renderActionRow({ focusKey: "tracking:simklDisconnect", title: t("simkl_disconnect", {}, "Disconnect Simkl"), subtitle: t("simkl_disconnect_subtitle", {}, "Remove this profile's Simkl connection") })}${this.simklStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.simklStatusMessage)}</p>` : ""}${this.simklErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.simklErrorMessage)}</p>` : ""}</div>`;
      }
      return `<div class="settings-trakt-card settings-tracking-account-card"><h3 class="settings-trakt-card-title">${escapeHtml(t("simkl_connect", {}, "Connect Simkl"))}</h3>${waiting ? `<p class="settings-trakt-body-copy">${escapeHtml(t("simkl_awaiting_instruction", {}, "Open the Simkl verification page and enter this code."))}</p><strong>${escapeHtml(auth.verificationUrl || "https://simkl.com/pin")}</strong><div class="settings-trakt-code">${escapeHtml(auth.userCode || "-")}</div><p class="settings-trakt-meta-copy">${escapeHtml(t("simkl_code_expires", [formatCountdown(Number(auth.expiresAt) - Date.now())], `Code expires in ${formatCountdown(Number(auth.expiresAt) - Date.now())}`))}</p>` : `<p class="settings-trakt-body-copy">${escapeHtml(t("simkl_description", {}, "A manual PIN will be shown here. Enter it on Simkl from a phone or computer."))}</p>${this.renderActionRow({ focusKey: "tracking:simklConnect", title: t("simkl_connect", {}, "Connect Simkl"), subtitle: SimklAuthService.hasRequiredCredentials() ? t("simkl_status_enter_code", {}, "Generate manual PIN") : t("simkl_missing_credentials", {}, "Missing SIMKL_CLIENT_ID") })}`}${this.simklStatusMessage ? `<p class="settings-trakt-message">${escapeHtml(this.simklStatusMessage)}</p>` : ""}${this.simklErrorMessage ? `<p class="settings-trakt-error">${escapeHtml(this.simklErrorMessage)}</p>` : ""}</div>`;
    },

    startSimklPolling(force = false) {
      if (this.simklPollInFlight && !force) return;
      if (this.simklPollTimer && !force) return;
      if (this.simklPollTimer) clearTimeout(this.simklPollTimer);
      const generation = this.trackingWorkGeneration || 0;
      const profileId = ProfileManager.getActiveProfileId();
      const isCurrent = () =>
        isTrackingActive(this) &&
        (this.trackingWorkGeneration || 0) === generation &&
        ProfileManager.getActiveProfileId() === profileId;
      const poll = async () => {
        if (!isCurrent()) return;
        const lease = {};
        if (this.simklPollInFlight) return;
        this.simklPollInFlight = lease;
        try {
          const state = SimklAuthService.getCurrentAuthState();
          if (!state.userCode || !isTrackingActive(this)) {
            this.simklPollTimer = null;
            return;
          }
          const result = await SimklAuthService.pollPin().catch((error) => ({
            type: "failed",
            message: String(
              error?.message ||
                error ||
                t("simkl_error_network", {}, "Unable to reach Simkl. Try again.")
            )
          }));
          if (!isCurrent()) return;
          if (result.type === "approved") {
            this.simklPollTimer = null;
            this.simklStatusMessage = t(
              "simkl_connected_as",
              [result.username || "Simkl"],
              `Connected as ${result.username || "Simkl"}`
            );
            await SimklSyncService.refresh({ force: true }).catch(() => false);
            if (!isCurrent()) return;
            await this.render();
            return;
          }
          if (result.type === "pending") {
            this.simklStatusMessage = t("simkl_status_waiting", {}, "Waiting for Simkl approval…");
          } else if (result.type === "expired" || result.type === "invalidated") {
            this.simklErrorMessage = t(
              "simkl_error_code_expired",
              {},
              "Simkl code expired. Start again."
            );
            this.simklPollTimer = null;
            await this.render();
            return;
          } else if (result.type === "failed") {
            this.simklErrorMessage = result.message;
            this.simklPollTimer = null;
            await this.render();
            return;
          }
          await this.render();
          if (!isCurrent()) return;
          const next = SimklAuthService.getCurrentAuthState();
          this.simklPollTimer = setTimeout(
            () => {
              this.simklPollTimer = null;
              void poll();
            },
            Math.max(1, Number(next.pollInterval || 5)) * 1000
          );
        } finally {
          if (this.simklPollInFlight === lease) this.simklPollInFlight = null;
        }
      };
      void poll();
    },

    startTraktPolling(force = false) {
      if (this.traktPollInFlight && !force) return;
      if (this.traktPollTimer && !force) {
        return;
      }
      this.stopTraktPolling();
      const generation = this.trackingWorkGeneration || 0;
      const profileId = ProfileManager.getActiveProfileId();
      const isCurrent = () =>
        isTrackingActive(this) &&
        (this.trackingWorkGeneration || 0) === generation &&
        ProfileManager.getActiveProfileId() === profileId;
      const poll = async () => {
        if (!isCurrent()) return;
        const lease = {};
        if (this.traktPollInFlight) return;
        this.traktPollInFlight = lease;
        try {
          const state = TraktAuthService.getCurrentAuthState();
          if (!state.deviceCode || !isTrackingActive(this)) {
            this.stopTraktPolling();
            return;
          }
          const result = await TraktAuthService.pollDeviceToken().catch((error) => ({
            type: "failed",
            message: String(
              error?.message ||
                error ||
                t("trakt_error_network_will_retry", {}, "Network error, will retry")
            )
          }));
          if (!isCurrent()) return;
          if (result.type === "approved") {
            this.stopTraktPolling();
            this.traktStatusMessage = t(
              "trakt_connected_as",
              [result.username || "Trakt"],
              `Connected as ${result.username || "Trakt"}`
            );
            this.traktErrorMessage = null;
            await this.loadTraktStats(true);
            if (!isCurrent()) return;
            await this.render();
            return;
          }
          if (result.type === "pending") {
            this.traktStatusMessage = t("tracking_status_waiting", {}, "Waiting for approval");
            this.traktErrorMessage = null;
          } else if (result.type === "slow_down") {
            this.traktStatusMessage = t(
              "trakt_status_rate_limited_slowing_polling",
              {},
              "Rate limited, slowing down polling..."
            );
            this.traktErrorMessage = null;
          } else if (result.type === "expired") {
            this.stopTraktPolling();
            this.traktStatusMessage = null;
            this.traktErrorMessage = t(
              "trakt_error_code_expired",
              {},
              "Device code expired. Start again."
            );
          } else if (result.type === "denied") {
            this.stopTraktPolling();
            this.traktStatusMessage = null;
            this.traktErrorMessage = t("trakt_error_denied", {}, "Authorization denied on Trakt.");
          } else if (result.type === "already_used") {
            this.stopTraktPolling();
            this.traktStatusMessage = null;
            this.traktErrorMessage = t(
              "trakt_error_code_used",
              {},
              "Device code already used. Start again."
            );
          } else if (result.type === "failed") {
            this.traktStatusMessage = null;
            this.traktErrorMessage =
              result.message ||
              t("trakt_error_network_retry", {}, "Network error, please try again");
          }
          await this.render();
          if (!isCurrent()) return;
          const nextState = TraktAuthService.getCurrentAuthState();
          if (nextState.deviceCode && !this.traktPollTimer) {
            this.traktPollTimer = setTimeout(
              () => {
                this.traktPollTimer = null;
                void poll();
              },
              Math.max(1, Number(nextState.pollInterval || 5)) * 1000
            );
          }
        } finally {
          if (this.traktPollInFlight === lease) this.traktPollInFlight = null;
        }
      };
      void poll();
    }
  };
}
