import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";
import {
  supportsEmailPasswordAuth,
  supportsTvLogin
} from "../../../core/server/serverConfiguration.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const AuthSignInScreen = {
  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    const server = ServerConfigurationStore.getActive();
    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${I18n.t("auth.signIn.title")}</h2>
          <p class="auth-simple-subtitle">${I18n.t("auth.signIn.description")}</p>
        </div>
        <div class="auth-simple-actions">
          ${
            supportsTvLogin(server)
              ? `<div class="auth-simple-card focusable" data-action="openQr">${I18n.t("auth.signIn.openQrLogin")}</div>`
              : ""
          }
          ${
            supportsEmailPasswordAuth(server)
              ? `<div class="auth-simple-card focusable" data-action="emailLogin">${I18n.t(
                  "account_signin_create_title",
                  {},
                  { fallback: "Sign In with Email" }
                )}</div>`
              : ""
          }
          <div class="auth-simple-card focusable" data-action="server">${I18n.t(
            "server_options_title",
            {},
            { fallback: "Server options" }
          )}</div>
          <div class="auth-simple-card focusable" data-action="back">${I18n.t("auth.signIn.back")}</div>
        </div>
      </div>
      ${
        this.textDialog
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(this.textDialog.title || "")}</div>
            <input class="settings-text-dialog-field settings-text-dialog-input focusable"
                   data-action="textInput"
                   type="${this.textDialog.type === "password" ? "password" : "text"}"
                   autocomplete="off"
                   autocapitalize="none"
                   spellcheck="false"
                   value="${escapeHtml(this.textDialog.value || "")}" />
            <div class="settings-text-dialog-actions">
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="saveText">
                <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.save", {}, { fallback: "Save" }))}</span>
              </button>
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="cancelText">
                <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.cancel", {}, { fallback: "Cancel" }))}</span>
              </button>
            </div>
          </div>
        </div>
      `
          : ""
      }
    `;

    ScreenUtils.indexFocusables(this.container);
    if (this.textDialog) {
      const input = this.container.querySelector("[data-action='textInput']");
      input?.focus?.();
      input?.classList?.add("focused");
    } else {
      ScreenUtils.setInitialFocus(this.container);
    }
  },

  openEmailDialog() {
    this.textDialog = {
      step: "email",
      title: I18n.t("auth.signIn.emailPrompt"),
      value: this.pendingEmail || "",
      type: "text"
    };
    this.render();
  },

  openPasswordDialog(email) {
    this.pendingEmail = String(email || "").trim();
    this.textDialog = {
      step: "password",
      title: I18n.t("auth.signIn.passwordPrompt"),
      value: "",
      type: "password"
    };
    this.render();
  },

  async submitTextDialog() {
    const input = this.container.querySelector("[data-action='textInput']");
    const value = String(input?.value || "");
    if (this.textDialog?.step === "email") {
      if (value.trim()) {
        this.openPasswordDialog(value);
      }
      return;
    }
    if (this.textDialog?.step === "password") {
      const email = String(this.pendingEmail || "").trim();
      const password = value;
      this.textDialog = null;
      this.pendingEmail = "";
      this.render();
      if (email && password) {
        try {
          await AuthManager.signInWithEmail(email, password);
          // AuthManager's authenticated-state subscriber owns post-login
          // routing. Do not navigate here as well: the two async routes can
          // mount and clean up the profile screen concurrently on Tizen.
        } catch (error) {
          console.error("SignIn failed", error);
        }
      }
    }
  },

  async onKeyDown(event) {
    if (this.textDialog) {
      if (event.keyCode === 27 || event.keyCode === 461) {
        this.textDialog = null;
        this.pendingEmail = "";
        this.render();
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      const action = current?.dataset?.action || "";
      if (action === "cancelText") {
        this.textDialog = null;
        this.pendingEmail = "";
        this.render();
        return;
      }
      if (action === "saveText" || action === "textInput") {
        await this.submitTextDialog();
      }
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (event.keyCode !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = current.dataset.action;
    if (action === "openQr") {
      Router.navigate("authQrSignIn");
      return;
    }
    if (action === "emailLogin") {
      this.openEmailDialog();
      return;
    }
    if (action === "server") {
      Router.navigate("serverConnection", { returnRoute: "authSignIn" });
      return;
    }
    if (action === "back") {
      Router.back();
    }
  },

  consumeBackRequest() {
    if (!this.textDialog) {
      return false;
    }
    this.textDialog = null;
    this.pendingEmail = "";
    this.render();
    return true;
  },

  cleanup() {
    this.textDialog = null;
    this.pendingEmail = "";
    ScreenUtils.hide(this.container);
  }
};
