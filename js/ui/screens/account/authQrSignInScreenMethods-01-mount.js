/* eslint-disable no-unused-vars */
import * as internals from "./authQrSignInScreen.js";

export function createAuthQrSignInScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    AuthManager,
    I18n,
    renderBrandWordmarkImage,
    PluginManager,
    ProfileManager,
    ServerConfigurationStore,
    WatchProgressStore,
    addonRepository,
    savedLibraryRepository,
    supportsEmailPasswordAuth,
    supportsTvLogin,
    connectedAccountIdentity,
    escapeHtml
  } = internals;

  return {
    async mount({ onboardingMode = false } = {}) {
      this.container = document.getElementById("account");
      this.onboardingMode = Boolean(onboardingMode);
      this.hasBackDestination = Router.stack.length > 0;
      this.isMounted = true;
      this.isLeaving = false;
      this.isStartingQr = false;
      this.isPolling = false;
      this.isEmailSubmitting = false;
      this.email = "";
      this.password = "";
      this.emailError = "";
      this.isServerMenuOpen = false;
      this.focusAfterRender = null;
      this.showSignOutConfirmation = false;
      this.isSignedIn = AuthManager.isAuthenticated;
      this.connectedStats = null;
      this.isConnectedStatsLoading = this.isSignedIn;
      this.serverConfiguration = ServerConfigurationStore.getActive();
      this.supportsEmailAuth = supportsEmailPasswordAuth(this.serverConfiguration);
      this.supportsQrAuth = supportsTvLogin(this.serverConfiguration);
      // Prefer QR sign-in on TV when the server supports it; fall back to
      // direct email/password. The user can switch via the server menu.
      this.useEmailLogin = !this.supportsQrAuth && this.supportsEmailAuth;
      this.useQrLogin = this.supportsQrAuth;
      ScreenUtils.show(this.container);
      this.render();

      if (this.useQrLogin && !this.isSignedIn) {
        void this.startQr().catch((error) => {
          if (!this.isMounted || this.isLeaving) {
            return;
          }
          console.warn("QR login background start failed", error);
          this.setStatus(this.toFriendlyQrError(error?.message || error));
        });
      }
      if (this.isSignedIn) {
        void this.loadConnectedStats();
      }
    },
    render() {
      if (!this.container || !this.isMounted) {
        return;
      }

      const configuration = this.serverConfiguration || ServerConfigurationStore.getActive();
      const loginModeItem =
        !this.isSignedIn && this.supportsEmailAuth && this.supportsQrAuth
          ? [
              {
                action: this.useEmailLogin ? "login-qr" : "login-email",
                label: I18n.t(this.useEmailLogin ? "server_options_login_with_qr" : "server_options_login_with_email")
              }
            ]
          : [];
      const menuItems = configuration?.isCustom
        ? [
            ...loginModeItem,
            { action: "use-official", label: I18n.t("server_options_use_official") },
            { action: "connect-custom", label: I18n.t("server_options_change_custom") }
          ]
        : [...loginModeItem, { action: "connect-custom", label: I18n.t("server_options_connect_custom") }];

      this.container.innerHTML = `
          <div class="qr-layout">
            <button type="button" class="qr-server-menu-trigger focusable" data-action="server-menu"
                    aria-label="${escapeHtml(I18n.t("server_options_content_description"))}">⋮</button>
            <section class="qr-left-panel">
              <div class="qr-brand-lockup">
                ${renderBrandWordmarkImage({ className: "qr-logo" })}
              </div>

              <div class="qr-copy-block">
                <h1 class="qr-title">${I18n.t("auth.qr.title")}</h1>
                <p id="qr-description" class="qr-description">${this.getLeftDescription()}</p>
                ${this.renderConnectedAccountIdentity()}
              </div>
            </section>

            <section class="qr-card-panel" aria-label="${escapeHtml(I18n.t("auth.qr.cardAriaLabel"))}">
              <div class="qr-card">
                <header class="qr-card-header">
                  <h2 class="qr-card-title">${I18n.t("auth.qr.cardTitle")}</h2>
                  <p id="qr-card-subtitle" class="qr-card-subtitle">${this.getCardSubtitle()}</p>
                </header>

                <p class="qr-login-instruction">
                  ${
                    this.isSignedIn
                      ? I18n.t("auth.qr.syncedData")
                      : this.useEmailLogin
                        ? I18n.t("auth.email.instruction")
                        : I18n.t("auth.qr.scanInstruction")
                  }
                </p>
                ${this.renderLoginContent()}
                ${!this.isSignedIn ? this.renderTermsAcknowledgement() : ""}
                <div class="qr-actions">${this.renderActions()}</div>
              </div>
            </section>

            ${this.isServerMenuOpen ? this.renderServerMenu(menuItems) : ""}
            ${this.showSignOutConfirmation ? this.renderSignOutConfirmation() : ""}
          </div>
        `;

      this.bindControls();
      ScreenUtils.indexFocusables(this.container);
      const initialSelector = this.showSignOutConfirmation
        ? ".server-dialog-cancel"
        : this.isServerMenuOpen
          ? ".qr-server-menu-item.focusable"
          : this.focusAfterRender || (this.useEmailLogin && !this.isSignedIn ? "#auth-email-input" : "#qr-refresh-btn");
      const focusContainer = this.showSignOutConfirmation ? this.container.querySelector(".auth-signout-confirm-dialog") : this.container;
      this.focusAfterRender = null;
      ScreenUtils.setInitialFocus(focusContainer, initialSelector);
    },
    renderLoginContent() {
      if (this.isSignedIn) {
        return this.renderConnectedStats();
      }
      if (this.useEmailLogin) {
        return `
            <form id="auth-email-form" class="qr-email-form" novalidate>
              <label class="qr-input-label" for="auth-email-input">${escapeHtml(I18n.t("auth.email.emailLabel"))}</label>
              <input id="auth-email-input" class="qr-auth-input focusable" data-action="email-input"
                     type="email" autocomplete="username" autocapitalize="none" spellcheck="false"
                     dir="ltr"
                     placeholder="${escapeHtml(I18n.t("auth.email.placeholder"))}"
                     value="${escapeHtml(this.email)}" />
              <label class="qr-input-label" for="auth-password-input">${escapeHtml(I18n.t("auth.email.passwordLabel"))}</label>
              <input id="auth-password-input" class="qr-auth-input focusable" data-action="password-input"
                     type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false"
                     dir="ltr"
                     placeholder="${escapeHtml(I18n.t("auth.email.passwordPlaceholder"))}"
                     value="${escapeHtml(this.password)}" />
              <button type="button" id="auth-email-submit" class="qr-action-btn qr-action-btn-primary focusable"
                      data-action="email-submit" ${this.isEmailSubmitting ? "disabled" : ""}>
                ${escapeHtml(I18n.t(this.isEmailSubmitting ? "auth.email.signingIn" : "auth.email.signIn"))}
              </button>
              ${this.emailError ? `<p class="qr-login-error" role="alert">${escapeHtml(this.emailError)}</p>` : ""}
            </form>
          `;
      }

      return `
          <div id="qr-container" class="qr-code-frame"></div>
          <div id="qr-manual-text" class="qr-manual-text"></div>
          <div id="qr-code-text" class="qr-code-text"></div>
          <div id="qr-expiry" class="qr-expiry"></div>
          <div id="qr-status" class="qr-status">${escapeHtml(I18n.t("auth.qr.waitingApproval"))}</div>
        `;
    },
    renderConnectedAccountIdentity() {
      if (!this.isSignedIn) return "";
      const { email, userId } = connectedAccountIdentity();
      if (!email && !userId) return "";
      return `
          <div class="qr-connected-identity">
            ${email ? `<span class="qr-connected-email">${escapeHtml(email)}</span>` : ""}
            ${userId ? `<span class="qr-connected-user-id">${escapeHtml(userId)}</span>` : ""}
          </div>
        `;
    },
    renderConnectedStats() {
      const values = this.isConnectedStatsLoading
        ? ["...", "...", "...", "..."]
        : [
            this.connectedStats?.addons ?? 0,
            this.connectedStats?.plugins ?? 0,
            this.connectedStats?.library ?? 0,
            this.connectedStats?.watchProgress ?? 0
          ];
      const labels = ["account_stat_addons", "account_stat_plugins", "account_stat_library", "account_stat_progress"];
      return `
          <div id="qr-connected-stats" class="qr-connected-stats" aria-label="${escapeHtml(I18n.t("auth.qr.syncedData"))}">
            <div class="qr-connected-stats-line" aria-hidden="true"></div>
            <div class="qr-connected-stats-row">
              ${values
                .map(
                  (value, index) => `
                    <div class="qr-connected-stat">
                      <strong>${escapeHtml(value)}</strong>
                      <span>${escapeHtml(I18n.t(labels[index]))}</span>
                    </div>
                    ${index === values.length - 1 ? "" : '<div class="qr-connected-stats-divider" aria-hidden="true"></div>'}
                  `
                )
                .join("")}
            </div>
            <div class="qr-connected-stats-line" aria-hidden="true"></div>
          </div>
        `;
    },
    updateConnectedStats() {
      const statsNode = this.container?.querySelector("#qr-connected-stats");
      if (statsNode) {
        statsNode.outerHTML = this.renderConnectedStats();
      }
    },
    async loadConnectedStats() {
      if (!this.isMounted || !this.isSignedIn) return;
      const profileId = ProfileManager.getActiveProfileId();
      try {
        const library = await savedLibraryRepository.getAll(1000, profileId);
        if (!this.isMounted || !this.isSignedIn) return;
        this.connectedStats = {
          addons: addonRepository.getInstalledAddonUrls().length,
          plugins: PluginManager.listRepositories().length,
          library: Array.isArray(library) ? library.length : 0,
          watchProgress: WatchProgressStore.listForProfile(profileId).length
        };
      } catch (error) {
        console.warn("Unable to load connected account stats", error);
        if (this.isMounted && this.isSignedIn) {
          this.connectedStats = { addons: 0, plugins: 0, library: 0, watchProgress: 0 };
        }
      } finally {
        if (this.isMounted && this.isSignedIn) {
          this.isConnectedStatsLoading = false;
          this.updateConnectedStats();
        }
      }
    },
    renderTermsAcknowledgement() {
      return `
          <div class="qr-terms">
            <span>${escapeHtml(I18n.t("auth_qr_terms_prefix"))}</span>
            <button type="button" class="qr-terms-link focusable" data-action="terms">
              ${escapeHtml(I18n.t("auth_qr_terms_link"))}
            </button>
          </div>
        `;
    },
    renderActions() {
      const backLabel = this.getBackButtonLabel();
      const refreshAction = this.isSignedIn
        ? `<button type="button" id="qr-refresh-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="signout">
               ${escapeHtml(I18n.t("auth.account.signOut"))}
             </button>`
        : this.useEmailLogin
          ? ""
          : `<button type="button" id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">
                 ${escapeHtml(I18n.t("auth.qr.refresh"))}
               </button>`;
      const continueLabel = `<button type="button" id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">
          ${escapeHtml(backLabel)}
        </button>`;
      return `${refreshAction}${continueLabel}`;
    },
    renderServerMenu(items) {
      return `
          <div class="qr-server-menu" role="menu" aria-label="${escapeHtml(I18n.t("server_options_title"))}">
            <div class="qr-server-menu-title">${escapeHtml(I18n.t("server_options_title"))}</div>
            ${items
              .map(
                (item) => `
                  <button type="button" class="qr-server-menu-item focusable" data-action="${item.action}" role="menuitem">
                    ${escapeHtml(item.label)}
                  </button>
                `
              )
              .join("")}
          </div>
        `;
    },
    renderSignOutConfirmation() {
      return `
          <div class="settings-dialog-backdrop">
            <div class="settings-dialog settings-text-dialog auth-signout-confirm-dialog"
                 role="dialog" aria-modal="true" aria-labelledby="auth-signout-confirm-title">
              <div id="auth-signout-confirm-title" class="settings-dialog-title">${escapeHtml(
                I18n.t("account_sign_out_confirm_title")
              )}</div>
              <div class="settings-text-dialog-message">${escapeHtml(I18n.t("account_sign_out_confirm_subtitle"))}</div>
              <div class="settings-text-dialog-actions">
                <button type="button" class="settings-dialog-option settings-text-dialog-button server-dialog-cancel focusable"
                        data-action="cancel-signout">
                  <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.cancel"))}</span>
                </button>
                <button type="button" class="settings-dialog-option settings-text-dialog-button server-dialog-danger focusable"
                        data-action="confirm-signout">
                  <span class="settings-dialog-option-label">${escapeHtml(I18n.t("auth.account.signOut"))}</span>
                </button>
              </div>
            </div>
          </div>
        `;
    }
  };
}
