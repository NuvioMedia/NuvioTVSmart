import { AuthManager } from "../../../core/auth/authManager.js";
import { discoverServer } from "../../../core/server/serverDiscovery.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";
import { I18n } from "../../../i18n/index.js";
import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";

function text(key, fallback, params = {}) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dialogButton(action, label, { primary = false, cancel = false, disabled = false } = {}) {
  return `
    <button type="button" class="settings-dialog-option settings-text-dialog-button${
      primary ? " server-dialog-primary" : ""
    }${cancel ? " server-dialog-cancel" : ""} focusable" data-action="${action}"${
      disabled ? " disabled" : ""
    }>
      <span class="settings-dialog-option-label">${escapeHtml(label)}</span>
    </button>
  `;
}

function discoveryInputValue(configuration) {
  const candidate = String(configuration?.discoveryUrl || configuration?.backendUrl || "").trim();
  if (!candidate) return "";
  const marker = "/.well-known/nuvio";
  const markerIndex = candidate.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) return candidate.slice(0, markerIndex);
  return candidate;
}

function errorMessage(error) {
  const messages = {
    invalid_url: text(
      "custom_server_error_invalid_url",
      "Enter a valid HTTP or HTTPS Backend URL."
    ),
    official_server: ServerConfigurationStore.getActive().isCustom
      ? text(
          "custom_server_error_official_available",
          "api.nuvio.tv is the official server. Close this dialog and choose Use official server to switch back."
        )
      : text(
          "custom_server_error_official_active",
          "api.nuvio.tv is the official server and is already selected."
        ),
    connection_failed: text(
      "custom_server_error_connection",
      "Could not reach the discovery endpoint. Check the URL and server availability."
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
    wrong_service: text(
      "custom_server_error_service",
      "The discovery document is not for this app."
    ),
    not_self_hosted: text(
      "custom_server_error_not_self_hosted",
      "The discovery document does not identify a self-hosted server."
    ),
    missing_configuration: text(
      "custom_server_error_missing_configuration",
      "The discovery document is missing a valid Backend URL or publishable key."
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
  return messages[error?.code] || messages.connection_failed;
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

function securityWarning(configuration) {
  if (!configuration?.isSecure && configuration?.isPublicHost) {
    return text(
      "custom_server_warning_public_http",
      "This server uses a public hostname and unencrypted HTTP. Credentials and synced data may be exposed in transit."
    );
  }
  if (!configuration?.isSecure) {
    return text(
      "custom_server_warning_http",
      "This server is on a private network, but HTTP traffic is not encrypted. Other devices on the network may be able to read it."
    );
  }
  if (configuration?.isPublicHost) {
    return text(
      "custom_server_warning_public",
      "This server uses a public hostname. The app cannot verify who owns or operates it."
    );
  }
  return text(
    "custom_server_warning_private",
    "This appears to be a private-network server, but the app still cannot verify who controls it."
  );
}

export const ServerConnectionScreen = {
  async mount({ returnRoute = "", returnParams = {}, initialMode = "list" } = {}) {
    this.container = document.getElementById("account");
    this.returnRoute = String(returnRoute || "");
    this.returnParams = returnParams && typeof returnParams === "object" ? returnParams : {};
    this.operationId = 0;
    this.discoveryController = null;
    this.restartWatchdog = null;
    this.isMounted = true;
    this.mode = ["input", "officialReview"].includes(initialMode) ? initialMode : "list";
    this.inputValue =
      this.mode === "input" ? discoveryInputValue(ServerConfigurationStore.getActive()) : "";
    this.discoveredServer = null;
    this.error = "";
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    if (!this.container || !this.isMounted) return;
    const active = ServerConfigurationStore.getActive();
    const isInput = this.mode === "input" || this.mode === "discovering";
    const isReview = this.mode === "review" && this.discoveredServer;
    const isOfficialReview = this.mode === "officialReview";
    const isSwitching = this.mode === "switching";
    const isDiscovering = this.mode === "discovering";

    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${escapeHtml(text("custom_server_title", "Connect to custom server"))}</h2>
          <p class="auth-simple-subtitle">${escapeHtml(
            active.isCustom
              ? text("server_options_custom_active", "Connected to a self-hosted server")
              : text("server_options_official_active", "Using the official Nuvio server")
          )}</p>
          <p class="auth-simple-subtitle">${escapeHtml(active.backendUrl)}</p>
        </div>
        <div class="auth-simple-actions">
          <button type="button" class="auth-simple-card focusable" data-action="connect">
            ${escapeHtml(text("server_options_change_custom", "Connect to another server"))}
          </button>
          ${
            active.isCustom
              ? `<button type="button" class="auth-simple-card focusable" data-action="official">
                   ${escapeHtml(text("server_options_use_official", "Use official server"))}
                 </button>`
              : ""
          }
          <button type="button" class="auth-simple-card focusable" data-action="back">
            ${escapeHtml(text("auth.qr.back", "Back"))}
          </button>
        </div>
      </div>

      ${
        isInput
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog server-connection-dialog">
            <div class="settings-dialog-title">${escapeHtml(text("custom_server_title", "Connect to custom server"))}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "custom_server_description",
                "Enter the Backend URL provided by your server administrator."
              )
            )}</div>
            <input class="settings-text-dialog-field settings-text-dialog-input focusable"
                   data-action="serverInput" type="url" dir="ltr" autocomplete="off" autocapitalize="none"
                   spellcheck="false" placeholder="${escapeHtml(
                     text("custom_server_url_placeholder", "https://backend.example.com")
                   )}"
                   value="${escapeHtml(this.inputValue)}" ${isDiscovering ? "disabled" : ""} />
            ${this.error ? `<div class="settings-text-dialog-status is-error" role="alert">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              ${dialogButton("cancel", text("common.cancel", "Cancel"), { cancel: true })}
              ${dialogButton(
                "check",
                isDiscovering
                  ? text("custom_server_checking", "Checking…")
                  : text("custom_server_check", "Check server"),
                { primary: true, disabled: isDiscovering }
              )}
            </div>
          </div>
        </div>`
          : ""
      }

      ${
        isReview
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog server-connection-dialog">
            <div class="settings-dialog-title">${escapeHtml(text("custom_server_review_title", "Review custom server"))}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "custom_server_review_description",
                "The discovery document is valid. Connecting will sign you out of the current server and restart the app. Confirm that this is a server you own or trust."
              )
            )}</div>
            <div class="settings-account-status-card">
              <span class="settings-account-status-icon">✓</span>
              <div>
                <strong class="settings-account-status-value">${escapeHtml(
                  this.discoveredServer.backendUrl
                )}</strong>
                <span class="settings-account-status-label">${escapeHtml(
                  text("custom_server_verified_label", "Discovered backend")
                )}</span>
              </div>
            </div>
            <div class="settings-account-status-card">
              <span class="settings-account-status-icon">◆</span>
              <div>
                <strong class="settings-account-status-value">${escapeHtml(
                  text("custom_server_key_discovered", "Publishable key discovered automatically")
                )}</strong>
                <span class="settings-account-status-label">${escapeHtml(
                  capabilitySummary(this.discoveredServer)
                )}</span>
              </div>
            </div>
            <div class="server-security-warning">
              <strong>${escapeHtml(text("custom_server_warning_title", "Only connect to a server you trust"))}</strong>
              <span>${escapeHtml(securityWarning(this.discoveredServer))}</span>
              <span>${escapeHtml(
                text(
                  "custom_server_warning_credentials",
                  "The server operator can receive your account credentials and access data you sync through this server."
                )
              )}</span>
            </div>
            ${this.error ? `<div class="settings-text-dialog-status is-error" role="alert">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              ${dialogButton("cancel", text("common.cancel", "Cancel"), { cancel: true })}
              ${dialogButton("trust", text("custom_server_trust_action", "I trust this server"), { primary: true })}
            </div>
          </div>
        </div>`
          : ""
      }

      ${
        isOfficialReview
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog server-connection-dialog">
            <div class="settings-dialog-title">${escapeHtml(text("official_server_title", "Use the official server?"))}</div>
            <div class="settings-text-dialog-message">${escapeHtml(
              text(
                "official_server_description",
                "You will be signed out of the custom server and the app will restart."
              )
            )}</div>
            ${this.error ? `<div class="settings-text-dialog-status is-error" role="alert">${escapeHtml(this.error)}</div>` : ""}
            <div class="settings-text-dialog-actions">
              ${dialogButton("cancel", text("common.cancel", "Cancel"), { cancel: true })}
              ${dialogButton("confirmOfficial", text("official_server_action", "Use official server"), { primary: true })}
            </div>
          </div>
        </div>`
          : ""
      }

      ${
        isSwitching
          ? `<div class="settings-dialog-backdrop"><div class="settings-dialog server-switching-dialog">
               <div class="settings-dialog-title">${escapeHtml(text("custom_server_switching", "Switching…"))}</div>
             </div></div>`
          : ""
      }
    `;

    ScreenUtils.indexFocusables(this.container);
    if (isInput) {
      ScreenUtils.setInitialFocus(
        this.container,
        ".server-connection-dialog [data-action='serverInput']"
      );
    } else if (isReview || isOfficialReview) {
      ScreenUtils.setInitialFocus(
        this.container,
        ".server-connection-dialog .server-dialog-cancel"
      );
    } else if (isSwitching) {
      ScreenUtils.setInitialFocus(this.container, ".server-switching-dialog");
    } else {
      ScreenUtils.setInitialFocus(this.container, ".auth-simple-actions .focusable");
    }
    this.bindControls();
  },

  bindControls() {
    this.container?.querySelectorAll("[data-action]").forEach((node) => {
      node.onclick = () => {
        const action = node.dataset.action;
        if (action === "connect") this.openInput();
        if (action === "official") this.openOfficialReview();
        if (action === "back") this.returnToPrevious();
        if (action === "cancel") this.cancelDialog();
        if (action === "check") void this.checkServer();
        if (action === "trust") void this.switchServer(this.discoveredServer);
        if (action === "confirmOfficial") void this.switchServer(null);
      };
    });
  },

  openInput() {
    this.inputValue = discoveryInputValue(ServerConfigurationStore.getActive());
    this.error = "";
    this.mode = "input";
    this.render();
  },

  openOfficialReview() {
    this.error = "";
    this.mode = "officialReview";
    this.render();
  },

  cancelDialog() {
    if (this.mode === "switching") return;
    this.operationId += 1;
    this.discoveryController?.abort?.();
    this.discoveryController = null;
    this.discoveredServer = null;
    this.error = "";
    this.mode = "list";
    this.render();
  },

  async checkServer() {
    if (this.mode === "discovering" || this.mode === "switching") return;
    const input = this.container?.querySelector("[data-action='serverInput']");
    this.inputValue = String(input?.value || this.inputValue || "").trim();
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
      if (!this.isMounted || operationId !== this.operationId) return;
      this.discoveredServer = discovered;
      this.mode = "review";
    } catch (error) {
      if (!this.isMounted || operationId !== this.operationId) return;
      this.error = errorMessage(error);
      this.mode = "input";
    } finally {
      if (operationId === this.operationId) {
        this.discoveryController = null;
        this.render();
      }
    }
  },

  returnToPrevious() {
    if (this.returnRoute && Router.routes?.[this.returnRoute]) {
      Router.navigate(this.returnRoute, this.returnParams || {}, {
        replaceHistory: true,
        skipStackPush: true
      });
      return;
    }
    Router.back();
  },

  async switchServer(configuration) {
    if (this.mode === "switching") return;
    this.mode = "switching";
    this.error = "";
    this.render();

    let sessionCleared = false;
    try {
      sessionCleared = await AuthManager.prepareForServerSwitch();
    } catch (error) {
      console.warn("Failed to prepare server switch", error);
    }
    if (!sessionCleared) {
      this.mode = configuration ? "review" : "officialReview";
      this.error = text(
        "custom_server_session_clear_failed",
        "Could not safely clear the current session. The server was not changed."
      );
      this.render();
      return;
    }

    const saved = configuration
      ? ServerConfigurationStore.saveCustom(configuration)
      : ServerConfigurationStore.useOfficial();
    if (!saved) {
      this.mode = configuration ? "review" : "officialReview";
      this.error = text("custom_server_save_failed", "Could not save the server configuration.");
      this.render();
      return;
    }

    const reload = globalThis.location?.reload;
    if (typeof reload !== "function") {
      this.showRestartFailure(configuration);
      return;
    }
    try {
      const result = reload.call(globalThis.location);
      if (result === false) {
        this.showRestartFailure(configuration);
        return;
      }
    } catch (error) {
      console.warn("Automatic restart failed after server switch", error);
      this.showRestartFailure(configuration);
      return;
    }

    // location.reload normally never returns to this screen. Keep a visible,
    // actionable failure state for Smart-TV runtimes that acknowledge reload
    // without actually navigating.
    this.restartWatchdog = setTimeout(() => {
      if (this.isMounted) this.showRestartFailure(configuration);
    }, 6000);
  },

  showRestartFailure(configuration) {
    if (this.restartWatchdog) {
      clearTimeout(this.restartWatchdog);
      this.restartWatchdog = null;
    }
    this.mode = configuration ? "review" : "officialReview";
    this.error = text(
      "custom_server_restart_failed",
      "The server was saved, but the app could not restart automatically. Restart it manually."
    );
    this.render();
  },

  onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (this.mode === "switching") return;
    if (keyCode === 27 || keyCode === 461) {
      if (this.mode !== "list") {
        this.cancelDialog();
        return;
      }
      this.returnToPrevious();
      return;
    }
    const navigationContainer =
      this.mode === "list"
        ? this.container
        : this.container?.querySelector(".server-connection-dialog");
    if (ScreenUtils.handleDpadNavigation(event, navigationContainer) || keyCode !== 13) return;
    const action = navigationContainer?.querySelector(".focusable.focused")?.dataset?.action;
    if (action === "connect") this.openInput();
    if (action === "official") this.openOfficialReview();
    if (action === "back") this.returnToPrevious();
    if (action === "cancel") this.cancelDialog();
    if (action === "check" || action === "serverInput") void this.checkServer();
    if (action === "trust") void this.switchServer(this.discoveredServer);
    if (action === "confirmOfficial") void this.switchServer(null);
  },

  consumeBackRequest() {
    if (this.mode === "switching") return true;
    if (this.mode !== "list") {
      this.cancelDialog();
      return true;
    }
    return false;
  },

  cleanup() {
    this.isMounted = false;
    this.operationId += 1;
    this.discoveryController?.abort?.();
    this.discoveryController = null;
    if (this.restartWatchdog) clearTimeout(this.restartWatchdog);
    this.restartWatchdog = null;
    this.discoveredServer = null;
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
