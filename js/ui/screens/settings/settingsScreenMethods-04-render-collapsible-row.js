/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods04() {
  const { Router, AuthManager, renderLoadingIndicator, SECTION_META, ROW_ICONS, t, escapeHtml, iconSvg } = internals;

  return {
    renderCollapsibleRow({ focusKey, title, subtitle, expanded, bodyHtml = "", classes = "" }) {
      return `
          <div class="settings-collapsible${classes ? ` ${classes}` : ""}${expanded ? " is-open" : ""}">
            <button class="settings-action-row settings-collapsible-trigger settings-content-focusable focusable${expanded ? " is-open" : ""}"
                    data-zone="content"
                    ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
                    aria-expanded="${expanded ? "true" : "false"}"
                    data-role="section-toggle">
              <span class="settings-row-copy">
                <span class="settings-row-title">${escapeHtml(title)}</span>
                ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
              </span>
              <span class="settings-row-tail">
                <span class="settings-row-value">${expanded ? t("common.open") : t("common.closed")}</span>
                ${iconSvg(expanded ? ROW_ICONS.expand : ROW_ICONS.chevron, "settings-row-icon")}
              </span>
            </button>
            ${
              expanded
                ? `
              <div class="settings-collapsible-body">
                <div class="settings-group-card settings-subsection-card">
                  ${bodyHtml}
                </div>
              </div>
            `
                : ""
            }
          </div>
        `;
    },
    renderAccountSection(model) {
      const signedIn = model.authState === "authenticated";
      const loading = model.authState === "loading";
      this.actionMap.set("account:signin", () => Router.navigate("authQrSignIn"));
      this.actionMap.set("account:signout", () => {
        this.openOptionDialog({
          title: t("account_sign_out_confirm_title", {}, "Sign out?"),
          message: t(
            "account_sign_out_confirm_subtitle",
            {},
            "You will need to sign in again to sync library, watch progress, addons, and plugins on this device."
          ),
          options: [
            { id: "cancel", labelKey: "action_cancel", label: "Cancel" },
            { id: "confirm", labelKey: "account_sign_out", label: "Sign Out" }
          ],
          selectedId: "cancel",
          returnFocusKey: "account:signout",
          dialogClassName: "settings-account-signout-dialog",
          onSelect: async (option) => {
            if (option.id !== "confirm") return;
            await AuthManager.signOut();
            this.accountSyncOverview = null;
            this.accountSyncOverviewPromise = null;
            this.accountSyncOverviewLoaded = false;
          }
        });
      });

      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "account"))}
          <div class="settings-group-card settings-group-card-fill settings-account-card">
            <div class="settings-account-list">
              ${
                loading
                  ? `
                <div class="settings-account-loading">
                  ${renderLoadingIndicator()}
                  <span>${escapeHtml(t("account_loading", {}, "Loading..."))}</span>
                </div>
              `
                  : ""
              }
              ${
                !loading && !signedIn
                  ? `
                <p class="settings-account-description">${escapeHtml(t("account_sync_description", {}, "Sync your library, watch progress, addons, and plugins across devices."))}</p>
                <p class="settings-account-inline-note">${escapeHtml(t("account_sync_restart_note", {}, "Sync is not real-time across active devices. Restart this device after signing in or to pick up changes made elsewhere."))}</p>
                ${this.renderAccountActionButton({
                  focusKey: "account:signin",
                  icon: "vpn_key",
                  title: t("account_signin_qr_title", {}, "Sign In with QR"),
                  subtitle: t("account_signin_qr_subtitle", {}, "Scan a QR code and complete email login on your phone")
                })}
              `
                  : ""
              }
              ${
                signedIn
                  ? `
                ${this.renderAccountStatusCard(model.accountEmail || t("settings.status.linkedFallback", {}, "Linked account"))}
                <p class="settings-account-inline-note">${escapeHtml(t("account_sync_restart_note", {}, "Sync is not real-time across active devices. Restart this device after signing in or to pick up changes made elsewhere."))}</p>
                ${
                  model.accountSyncOverview
                    ? this.renderAccountSyncOverview(model.accountSyncOverview)
                    : model.accountSyncOverviewLoading
                      ? this.renderAccountSyncOverviewLoading()
                      : ""
                }
                ${this.renderAccountSignOutButton()}
              `
                  : ""
              }
            </div>
          </div>
        `;
    },
    renderAccountStatusCard(value) {
      return `
          <div class="settings-account-status-card">
            <span class="settings-account-status-icon material-icons" aria-hidden="true">check_circle</span>
            <span class="settings-account-status-label">${escapeHtml(t("account_signed_in_label", {}, "Signed in"))}</span>
            <strong class="settings-account-status-value">${escapeHtml(value)}</strong>
          </div>
        `;
    },
    renderAccountActionButton({ focusKey, icon, title, subtitle }) {
      return `
          <button class="settings-account-action-button settings-content-focusable focusable"
                  data-zone="content"
                  ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
                  data-role="action">
            <span class="settings-account-button-icon material-icons" aria-hidden="true">${escapeHtml(icon)}</span>
            <span class="settings-account-button-copy">
              <span class="settings-account-button-title">${escapeHtml(title)}</span>
              <span class="settings-account-button-subtitle">${escapeHtml(subtitle)}</span>
            </span>
          </button>
        `;
    },
    renderAccountSignOutButton() {
      return `
          <button class="settings-account-signout-button settings-content-focusable focusable"
                  data-zone="content"
                  ${this.registerAction("account:signout", this.actionMap.get("account:signout"))}
                  data-role="action">
            <span class="settings-account-signout-icon material-icons" aria-hidden="true">logout</span>
            <span class="settings-account-signout-label">${escapeHtml(t("account_sign_out", {}, "Sign Out"))}</span>
          </button>
        `;
    },
    renderAccountSyncOverviewLoading() {
      return `
          <div class="settings-account-sync-overview settings-account-sync-loading">
            ${renderLoadingIndicator()}
            <span>${escapeHtml(t("account_loading_sync", {}, "Loading sync data..."))}</span>
          </div>
        `;
    },
    renderAccountSyncOverview(overview) {
      const statLabels = [
        t("account_stat_addons", {}, "addons"),
        t("account_stat_plugins", {}, "plugins"),
        t("account_stat_library", {}, "library"),
        t("account_stat_progress", {}, "progress"),
        t("account_stat_watched", {}, "watched")
      ];
      const renderStats = (values) =>
        values
          .map(
            (value, index) => `
          <span class="settings-account-stat">
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(statLabels[index])}</small>
          </span>
        `
          )
          .join("");
      const rows = Array.isArray(overview?.perProfile) ? overview.perProfile : [];
      return `
          <div class="settings-account-sync-overview">
            <div class="settings-account-sync-row settings-account-sync-total-row">
              <span class="settings-account-sync-total-label">${escapeHtml(t("account_total_label", {}, "Total"))}</span>
              <span class="settings-account-sync-stats">
                ${renderStats([
                  overview.totalAddons || 0,
                  overview.totalPlugins || 0,
                  overview.totalLibrary || 0,
                  overview.totalWatchProgress || 0,
                  overview.totalWatchedItems || 0
                ])}
              </span>
            </div>
            ${rows
              .map(
                (profile) => `
              <div class="settings-account-sync-row">
                <span class="settings-account-profile-badge" style="background:${escapeHtml(profile.avatarColorHex || "#1E88E5")};">${escapeHtml(
                  String(profile.profileName || "?")
                    .charAt(0)
                    .toUpperCase() || "?"
                )}</span>
                <span class="settings-account-profile-name">${escapeHtml(profile.profileName || `Profile ${profile.profileId || ""}`)}</span>
                <span class="settings-account-sync-stats">
                  ${renderStats([
                    profile.addons || 0,
                    profile.plugins || 0,
                    profile.library || 0,
                    profile.watchProgress || 0,
                    profile.watchedItems || 0
                  ])}
                </span>
              </div>
            `
              )
              .join("")}
          </div>
        `;
    },
    renderProfilesSection(model) {
      const isPrimaryProfileActive = String(model?.activeProfileId || "1") === "1";
      if (isPrimaryProfileActive) {
        this.actionMap.set("profiles:manage", () =>
          Router.navigate("profileSelection", {
            mode: "management",
            returnRoute: "settings"
          })
        );
      }
      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "profiles"))}
          <div class="settings-group-card settings-profile-card">
            <div class="settings-stack">
              ${
                isPrimaryProfileActive
                  ? this.renderActionRow({
                      focusKey: "profiles:manage",
                      title: t("profile_manage_button", {}, "Manage Profiles"),
                      subtitle: "",
                      icon: null,
                      classes: "settings-profile-manage-row"
                    })
                  : ""
              }
            </div>
          </div>
        `;
    }
  };
}
