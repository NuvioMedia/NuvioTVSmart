import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { I18n } from "../../../i18n/index.js";

const KEY = "manualSyncCode";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SyncCodeScreen = {
  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    const value = LocalStore.get(KEY, "");
    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${escapeHtml(I18n.t("auth.syncCode.title"))}</h2>
          <p class="auth-simple-subtitle">${escapeHtml(I18n.t("auth.syncCode.currentCode", { value: value || I18n.t("auth.syncCode.emptyValue") }))}</p>
        </div>
        <div class="auth-simple-actions">
          <div class="auth-simple-card focusable" data-action="setCode">${I18n.t("auth.syncCode.setCode")}</div>
          <div class="auth-simple-card focusable" data-action="clearCode">${I18n.t("auth.syncCode.clearCode")}</div>
          <div class="auth-simple-card focusable" data-action="back">${I18n.t("auth.syncCode.back")}</div>
        </div>
      </div>
      ${
        this.textDialog
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(I18n.t("auth.syncCode.prompt"))}</div>
            <input class="settings-text-dialog-field settings-text-dialog-input focusable"
                   data-action="textInput"
                   type="text"
                   autocomplete="off"
                   autocapitalize="none"
                   spellcheck="false"
                   value="${escapeHtml(value)}" />
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
    if (this.textDialog) {
      const dialogRoot = this.container.querySelector(".settings-dialog") || this.container;
      ScreenUtils.indexFocusables(dialogRoot);
      const input = dialogRoot.querySelector("[data-action='textInput']");
      input?.focus?.();
      input?.classList?.add("focused");
    } else {
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    }
  },

  onKeyDown(event) {
    if (this.textDialog) {
      if (event.keyCode === 27 || event.keyCode === 461) {
        this.textDialog = false;
        this.render();
        return;
      }
      const dialogRoot = this.container.querySelector(".settings-dialog") || this.container;
      if (ScreenUtils.handleDpadNavigation(event, dialogRoot)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = dialogRoot.querySelector(".focusable.focused");
      const action = current?.dataset?.action || "";
      if (action === "cancelText") {
        this.textDialog = false;
        this.render();
        return;
      }
      if (action === "saveText" || action === "textInput") {
        const input = this.container.querySelector("[data-action='textInput']");
        LocalStore.set(KEY, String(input?.value || "").trim());
        this.textDialog = false;
        this.render();
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
    if (action === "setCode") {
      this.textDialog = true;
      this.render();
      return;
    }
    if (action === "clearCode") {
      LocalStore.remove(KEY);
      this.render();
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
    this.textDialog = false;
    this.render();
    return true;
  },

  cleanup() {
    this.textDialog = false;
    ScreenUtils.hide(this.container);
  }
};
