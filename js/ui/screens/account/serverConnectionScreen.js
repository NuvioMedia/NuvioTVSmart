import { AuthManager } from "../../../core/auth/authManager.js";
import { discoverServer } from "../../../core/server/serverDiscovery.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";
import { I18n } from "../../../i18n/index.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";

function text(key, fallback, params = {}) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorMessage(error) {
  const messages = {
    invalid_url: text("custom_server_error_invalid_url", "Enter a valid public HTTPS Backend URL."),
    official_server: ServerConfigurationStore.getActive().isCustom
      ? text(
          "custom_server_error_official_available",
          "Use the official-server action to return to api.nuvio.tv."
        )
      : text(
          "custom_server_error_official_active",
          "The official Nuvio server is already selected."
        ),
    connection_failed: text(
      "custom_server_error_connection",
      "The discovery endpoint could not be reached."
    ),
    response_too_large: text(
      "custom_server_error_response_too_large",
      "The discovery document is larger than allowed."
    ),
    invalid_document: text(
      "custom_server_error_invalid_document",
      "The server returned an invalid discovery document."
    ),
    unsupported_version: text(
      "custom_server_error_version",
      "This discovery document version is not supported."
    ),
    wrong_service: text("custom_server_error_service", "The discovery document is not for Nuvio."),
    not_self_hosted: text(
      "custom_server_error_not_self_hosted",
      "The server does not identify itself as self-hosted."
    ),
    missing_configuration: text(
      "custom_server_error_missing_configuration",
      "The discovery document is missing its Backend URL or publishable key."
    ),
    no_supported_auth: text(
      "custom_server_error_no_auth",
      "The server does not advertise a supported sign-in method."
    )
  };
  if (error?.code === "http_error") {
    return text(
      "custom_server_error_http",
      `The discovery endpoint returned HTTP ${error.statusCode || 0}.`,
      { value: error.statusCode || 0 }
    );
  }
  return messages[error?.code] || text("custom_server_error_connection", "Unable to check server.");
}

function capabilitySummary(configuration) {
  const capabilities = [];
  if (configuration?.capabilities?.emailPasswordAuth) {
    capabilities.push(text("custom_server_capability_email", "Email and password"));
  }
  if (configuration?.capabilities?.tvLogin) {
    capabilities.push(text("custom_server_capability_tv_login", "TV/QR login"));
  }
  return capabilities.join(" / ");
}

export const ServerConnectionScreen = {
  async mount({ returnRoute = "" } = {}) {
    this.container = document.getElementById("account");
    this.returnRoute = String(returnRoute || "");
    this.operationId = 0;
    this.discoveryController = null;
    this.mode = "list";
    this.inputValue = "";
    this.discoveredServer = null;
    this.error = "";
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    const active = ServerConfigurationStore.getActive();
    const isInput = this.mode === "input";
    const isReview = this.mode === "review" && this.discoveredServer;
    const isOfficialReview = this.mode === "officialReview";
    const busy = this.mode === "discovering" || this.mode === "switching";
    const mainFocusableClass = isInput || isReview || isOfficialReview || busy ? "" : " focusable";

    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${escapeHtml(text("custom_server_title", "Nuvio server"))}</h2>
          <p class="auth-simple-subtitle">${escapeHtml(
            active.isCustom
              ? text("server_options_custom_active", "Connected to a self-hosted server")
              : text("server_options_official_active", "Using the official Nuvio server")
          )}</p>
          <p class="auth-simple-subtitle">${escapeHtml(active.backendUrl)}</p>
        </div>
        <div class="auth-simple-actions">
          <div class="auth-simple-card${mainFocusableClass}" data-action="connect">${escapeHtml(
            text("server_options_change_custom", "Connect to another server")
          )}</div>
          ${
            active.isCustom
              ? `<div class="auth-simple-card${mainFocusableClass}" data-action="official">${escapeHtml(
                  text("server_options_use_official", "Use official server")
                )}</div>`
              : ""
          }
          <div class="auth-simple-card${mainFocusableClass}" data-action="back">${escapeHtml(
            text("auth.signIn.back", "Back")
          )}</div>
        </div>
      </div>
      ${
        isInput
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(text("custom_server_title", "Connect to custom server"))}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "custom_server_description",
                "Enter the Backend URL provided by your server administrator."
              )
            )}</div>
            <input class="settings-text-dialog-field settings-text-dialog-input focusable"
                   data-action="serverInput" type="text" autocomplete="off" autocapitalize="none"
                   spellcheck="false" placeholder="https://backend.example.com"
                   value="${escapeHtml(this.inputValue)}" />
            ${this.error ? `<div class="settings-text-dialog-status is-error">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="check">
                <span class="settings-dialog-option-label">${escapeHtml(
                  text("custom_server_check", "Check server")
                )}</span>
              </button>
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="cancel">
                <span class="settings-dialog-option-label">${escapeHtml(
                  text("common.cancel", "Cancel")
                )}</span>
              </button>
            </div>
          </div>
        </div>`
          : ""
      }
      ${
        isReview
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(text("custom_server_review_title", "Review custom server"))}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "custom_server_review_description",
                "Connecting signs you out and restarts the app. Only continue with a server you trust."
              )
            )}</div>
            <div class="settings-account-status-card">
              <strong class="settings-account-status-value">${escapeHtml(this.discoveredServer.backendUrl)}</strong>
              <span class="settings-account-status-label">${escapeHtml(capabilitySummary(this.discoveredServer))}</span>
            </div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "custom_server_warning_credentials",
                "The server operator can receive your account credentials and access data synchronized through it."
              )
            )}</div>
            ${this.error ? `<div class="settings-text-dialog-status is-error">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="trust">
                <span class="settings-dialog-option-label">${escapeHtml(
                  busy
                    ? text("custom_server_switching", "Switching...")
                    : text("custom_server_trust_action", "I trust this server")
                )}</span>
              </button>
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="cancel">
                <span class="settings-dialog-option-label">${escapeHtml(
                  text("common.cancel", "Cancel")
                )}</span>
              </button>
            </div>
          </div>
        </div>`
          : ""
      }
      ${
        isOfficialReview
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(
              text("official_server_title", "Use the official server?")
            )}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "official_server_description",
                "You will be signed out of the custom server and the app will restart."
              )
            )}</div>
            ${this.error ? `<div class="settings-text-dialog-status is-error">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="confirmOfficial">
                <span class="settings-dialog-option-label">${escapeHtml(
                  text("official_server_action", "Use official server")
                )}</span>
              </button>
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="cancel">
                <span class="settings-dialog-option-label">${escapeHtml(
                  text("common.cancel", "Cancel")
                )}</span>
              </button>
            </div>
          </div>
        </div>`
          : ""
      }
      ${
        this.mode === "discovering" || this.mode === "switching"
          ? `<div class="settings-dialog-backdrop"><div class="settings-dialog"><div class="settings-dialog-title">${escapeHtml(
              this.mode === "switching"
                ? text("custom_server_switching", "Switching...")
                : text("custom_server_checking", "Checking...")
            )}</div></div></div>`
          : ""
      }
    `;

    ScreenUtils.indexFocusables(this.container);
    const input = this.container.querySelector("[data-action='serverInput']");
    if (input) {
      input.focus?.();
      input.classList.add("focused");
    } else if (isReview || isOfficialReview) {
      this.container
        .querySelectorAll(".focusable")
        .forEach((node) => node.classList.remove("focused"));
      const firstDialogAction = this.container.querySelector(".settings-dialog .focusable");
      firstDialogAction?.classList.add("focused");
      firstDialogAction?.focus?.();
    } else {
      ScreenUtils.setInitialFocus(this.container);
    }
  },

  openInput() {
    this.mode = "input";
    this.error = "";
    this.render();
  },

  async checkServer() {
    const input = this.container.querySelector("[data-action='serverInput']");
    this.inputValue = String(input?.value || "").trim();
    const operationId = ++this.operationId;
    this.discoveryController?.abort?.();
    this.discoveryController = typeof AbortController === "function" ? new AbortController() : null;
    this.mode = "discovering";
    this.error = "";
    this.render();
    try {
      const discovered = await discoverServer(this.inputValue, {
        signal: this.discoveryController?.signal
      });
      if (operationId !== this.operationId || !this.container) return;
      this.discoveredServer = discovered;
      this.mode = "review";
    } catch (error) {
      if (operationId !== this.operationId || !this.container) return;
      this.error = errorMessage(error);
      this.mode = "input";
    }
    this.discoveryController = null;
    this.render();
  },

  returnToPrevious() {
    if (this.returnRoute && Router.routes?.[this.returnRoute]) {
      Router.navigate(this.returnRoute, {}, { replaceHistory: true, skipStackPush: true });
      return;
    }
    Router.back();
  },

  async switchServer(configuration) {
    this.mode = "switching";
    this.error = "";
    this.render();
    const accountCleared = await AuthManager.prepareForServerSwitch();
    if (!accountCleared) {
      this.mode = configuration ? "review" : "officialReview";
      this.error = text(
        "custom_server_session_clear_failed",
        "The current account session could not be cleared safely. The server was not changed."
      );
      this.render();
      return;
    }
    const saved = configuration
      ? ServerConfigurationStore.saveCustom(configuration)
      : ServerConfigurationStore.useOfficial();
    if (!saved) {
      this.mode = configuration ? "review" : "list";
      this.error = text(
        "custom_server_save_failed",
        "The server configuration could not be saved."
      );
      this.render();
      return;
    }
    try {
      globalThis.location?.reload?.();
    } catch (_) {
      Router.navigate("authSignIn", {}, { replaceHistory: true });
    }
  },

  async onKeyDown(event) {
    if (this.mode === "switching") return;
    if (event.keyCode === 27 || event.keyCode === 461) {
      if (this.mode !== "list") {
        this.operationId += 1;
        this.discoveryController?.abort?.();
        this.discoveryController = null;
        this.mode = "list";
        this.error = "";
        this.render();
        return;
      }
      this.returnToPrevious();
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container) || event.keyCode !== 13) return;
    const action = this.container.querySelector(".focusable.focused")?.dataset?.action;
    if (action === "connect") this.openInput();
    if (action === "official") {
      this.mode = "officialReview";
      this.render();
    }
    if (action === "confirmOfficial") await this.switchServer(null);
    if (action === "back") this.returnToPrevious();
    if (action === "check" || action === "serverInput") await this.checkServer();
    if (action === "cancel") {
      this.mode = "list";
      this.error = "";
      this.render();
    }
    if (action === "trust" && this.mode !== "switching") {
      await this.switchServer(this.discoveredServer);
    }
  },

  consumeBackRequest() {
    if (this.mode === "switching") return true;
    if (this.mode !== "list") {
      this.operationId += 1;
      this.discoveryController?.abort?.();
      this.discoveryController = null;
      this.mode = "list";
      this.error = "";
      this.render();
      return true;
    }
    return false;
  },

  cleanup() {
    this.operationId += 1;
    this.discoveryController?.abort?.();
    this.discoveryController = null;
    this.discoveredServer = null;
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
