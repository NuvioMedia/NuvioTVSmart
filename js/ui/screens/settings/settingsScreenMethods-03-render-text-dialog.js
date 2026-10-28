/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods03() {
  const {
    DebridSettingsStore,
    DebridProviders,
    DEBRID_DEVICE_AUTH_STATUS,
    DebridDeviceAuthService,
    QrCodeGenerator,
    renderLoadingIndicator,
    t,
    escapeHtml,
    escapeAttribute
  } = internals;

  return {
    renderTextDialog() {
      if (!this.textDialog) {
        return "";
      }
      const field = this.textDialog.multiline
        ? `<textarea class="settings-text-dialog-field settings-text-dialog-textarea focusable"
                       data-zone="dialog"
                       data-text-dialog-role="field"
                       placeholder="${escapeAttribute(this.textDialog.placeholder || "")}">${escapeHtml(this.textDialog.draft)}</textarea>`
        : `<input class="settings-text-dialog-field settings-text-dialog-input focusable"
                    data-zone="dialog"
                    data-text-dialog-role="field"
                    type="${this.textDialog.secret ? "password" : this.textDialog.inputType === "url" ? "url" : "text"}"
                    dir="${this.textDialog.inputType === "url" ? "ltr" : "auto"}"
                    aria-label="${escapeAttribute(this.textDialog.title || "")}"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck="false"
                    placeholder="${escapeAttribute(this.textDialog.placeholder || "")}"
                    value="${escapeAttribute(this.textDialog.draft)}" />`;
      return `
          <div class="settings-dialog-backdrop">
            <div class="settings-dialog settings-text-dialog">
              <div class="settings-dialog-title">${escapeHtml(this.textDialog.title || "")}</div>
              ${field}
              ${
                this.textDialog.statusMessage
                  ? `<p class="settings-text-dialog-message ${escapeHtml(this.textDialog.statusKind || "error")}">${escapeHtml(this.textDialog.statusMessage)}</p>`
                  : ""
              }
              <div class="settings-text-dialog-actions">
                <button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                        data-zone="dialog"
                        data-text-dialog-action="save"
                        data-dialog-index="1">
                  <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.saveLabel || t("common.save", {}, "Save"))}</span>
                </button>
                ${
                  typeof this.textDialog.onClear === "function"
                    ? `<button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                        data-zone="dialog"
                        data-text-dialog-action="clear"
                        data-dialog-index="2">
                  <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.clearLabel || t("common.clear", {}, "Clear"))}</span>
                </button>`
                    : ""
                }
                <button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                        data-zone="dialog"
                        data-text-dialog-action="cancel"
                        data-dialog-index="${typeof this.textDialog.onClear === "function" ? 3 : 2}">
                  <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.cancelLabel || t("common.cancel", {}, "Cancel"))}</span>
                </button>
              </div>
            </div>
          </div>
        `;
    },
    bindTextDialogEvents() {
      if (!this.textDialog) {
        return;
      }
      const field = this.container?.querySelector?.("[data-text-dialog-role='field']");
      if (field && !field.__settingsTextDialogBound) {
        field.__settingsTextDialogBound = true;
        field.addEventListener("input", (event) => {
          if (this.textDialog) {
            this.textDialog.draft = String(event.target?.value ?? "");
            this.textDialog.statusMessage = "";
          }
        });
      }
    },
    async submitTextDialog() {
      if (!this.textDialog) {
        return;
      }
      const field = this.container?.querySelector?.("[data-text-dialog-role='field']");
      const value = String(field?.value ?? this.textDialog.draft ?? "");
      const submit = this.textDialog.onSubmit;
      const returnFocusKey = this.textDialog.returnFocusKey;
      if (typeof submit === "function") {
        const shouldClose = await submit(value);
        if (shouldClose === false) {
          return;
        }
      }
      this.textDialog = null;
      this.contentFocusKey = returnFocusKey || this.contentFocusKey;
      this.focusZone = "content";
    },
    async clearTextDialog() {
      if (!this.textDialog || typeof this.textDialog.onClear !== "function") {
        return;
      }
      const returnFocusKey = this.textDialog.returnFocusKey;
      const shouldClose = await this.textDialog.onClear();
      if (shouldClose === false) {
        return;
      }
      this.textDialog = null;
      this.contentFocusKey = returnFocusKey || this.contentFocusKey;
      this.focusZone = "content";
    },
    getTextDialogMaxFocusIndex() {
      return this.textDialog && typeof this.textDialog.onClear === "function" ? 3 : 2;
    },
    stopDebridDeviceAuth({ clearState = true } = {}) {
      if (this.debridAuthPollTimer) {
        clearTimeout(this.debridAuthPollTimer);
        this.debridAuthPollTimer = null;
      }
      this.debridAuthNonce = Number(this.debridAuthNonce || 0) + 1;
      if (clearState) this.debridAuthDialog = null;
    },
    isCurrentDebridAuth(nonce) {
      return Boolean(this.debridAuthDialog && Number(this.debridAuthDialog.nonce) === Number(nonce));
    },
    debridAuthDialogMessageHtml() {
      const state = this.debridAuthDialog;
      if (!state) return "";
      const providerName = escapeHtml(state.provider.displayName);
      if (state.status === "connected") {
        return `<div class="settings-debrid-auth-copy">${escapeHtml(
          t("debrid_device_auth_connected", { provider: state.provider.displayName }, `${state.provider.displayName} is connected.`)
        )}</div>`;
      }
      if (state.status === "starting") {
        return `<div class="settings-debrid-auth-loading">${renderLoadingIndicator({ size: "small" })}<span>${escapeHtml(
          t("debrid_device_auth_starting", {}, `Starting ${state.provider.displayName} sign-in…`)
        )}</span></div>`;
      }
      if (state.status === "waiting" && state.session) {
        const verificationUrl = state.session.friendlyVerificationUrl || state.session.verificationUrl;
        return `
            <div class="settings-debrid-auth-body">
              <p class="settings-debrid-auth-copy">${escapeHtml(
                t("debrid_device_auth_instructions", {}, "Scan the QR code or open the address on another device, then enter the code.")
              )}</p>
              <canvas class="settings-debrid-auth-qr" data-debrid-auth-qr aria-label="${escapeHtml(
                t("cd_qr_code", {}, `${providerName} QR code`)
              )}"></canvas>
              <div class="settings-debrid-auth-code">${escapeHtml(state.session.userCode)}</div>
              <div class="settings-debrid-auth-url">${escapeHtml(verificationUrl)}</div>
              <div class="settings-debrid-auth-status">${renderLoadingIndicator({ size: "small" })}<span>${escapeHtml(
                t("debrid_device_auth_waiting", {}, "Waiting for authorization…")
              )}</span></div>
            </div>`;
      }
      const fallback =
        state.status === "expired"
          ? t("debrid_device_auth_expired", {}, "The authorization code expired. Try again.")
          : state.status === "missingConfiguration"
            ? t("debrid_device_auth_missing_configuration", {}, "Premiumize sign-in is not configured in this build.")
            : t("debrid_device_auth_failed", {}, `Could not connect ${state.provider.displayName}.`);
      return `<div class="settings-debrid-auth-error"><strong>${providerName}</strong><span>${escapeHtml(
        state.message || fallback
      )}</span></div>`;
    },
    refreshDebridDeviceAuthDialog() {
      const state = this.debridAuthDialog;
      if (!state) return;
      const isConnected = state.status === "connected";
      const canRetry = ["failed", "expired", "missingConfiguration"].includes(state.status);
      const options = isConnected
        ? [
            { id: "disconnect", label: t("debrid_disconnect", {}, "Disconnect") },
            { id: "cancel", label: t("common.cancel", {}, "Cancel") }
          ]
        : [
            ...(canRetry ? [{ id: "retry", label: t("common.retry", {}, "Retry") }] : []),
            { id: "cancel", label: t("common.cancel", {}, "Cancel") }
          ];
      this.openOptionDialog({
        title: isConnected
          ? t("debrid_disconnect_provider", { provider: state.provider.displayName }, `Disconnect ${state.provider.displayName}`)
          : t("debrid_connect_provider", { provider: state.provider.displayName }, `Connect ${state.provider.displayName}`),
        messageHtml: this.debridAuthDialogMessageHtml(),
        options,
        optionColumns: options.length,
        returnFocusKey: `integration:debrid:key:${state.provider.id}`,
        dialogClassName: "settings-debrid-auth-dialog",
        onRender: (dialogSlot) => {
          const canvas = dialogSlot.querySelector?.("[data-debrid-auth-qr]");
          const content = this.debridAuthDialog?.session?.friendlyVerificationUrl || this.debridAuthDialog?.session?.verificationUrl || "";
          if (canvas && content) {
            try {
              QrCodeGenerator.generate(canvas, content, 420);
            } catch (error) {
              console.warn("Failed to generate Debrid authorization QR", error);
            }
          }
        },
        onClose: () => this.stopDebridDeviceAuth(),
        onSelect: async (option) => {
          if (option.id === "retry") {
            this.restartDebridDeviceAuth();
            return false;
          }
          if (option.id === "disconnect") {
            DebridSettingsStore.setProviderApiKey(state.provider.id, "");
          }
          return true;
        }
      });
    },
    openDebridDeviceAuthDialog(provider) {
      this.stopDebridDeviceAuth();
      const connected = Boolean(DebridProviders.apiKeyFor(DebridSettingsStore.get(), provider.id));
      const nonce = Number(this.debridAuthNonce || 0) + 1;
      this.debridAuthNonce = nonce;
      this.debridAuthDialog = {
        nonce,
        provider,
        status: connected ? "connected" : "starting",
        session: null,
        message: ""
      };
      this.refreshDebridDeviceAuthDialog();
      if (!connected) setTimeout(() => void this.startDebridDeviceAuth(nonce), 0);
    },
    restartDebridDeviceAuth() {
      const provider = this.debridAuthDialog?.provider;
      if (!provider) return;
      this.stopDebridDeviceAuth({ clearState: false });
      const nonce = Number(this.debridAuthNonce || 0) + 1;
      this.debridAuthNonce = nonce;
      this.debridAuthDialog = { nonce, provider, status: "starting", session: null, message: "" };
      this.refreshDebridDeviceAuthDialog();
      setTimeout(() => void this.startDebridDeviceAuth(nonce), 0);
    },
    async startDebridDeviceAuth(nonce) {
      try {
        const state = this.debridAuthDialog;
        if (!state || !this.isCurrentDebridAuth(nonce)) return;
        const session = await DebridDeviceAuthService.start(state.provider.id);
        if (!this.isCurrentDebridAuth(nonce)) return;
        this.debridAuthDialog.session = session;
        this.debridAuthDialog.status = "waiting";
        this.debridAuthDialog.message = "";
        this.refreshDebridDeviceAuthDialog();
        await this.render({ refreshModel: false });
        this.scheduleDebridDeviceAuthPoll(nonce);
      } catch (error) {
        if (!this.isCurrentDebridAuth(nonce)) return;
        const message = String(error?.message || error || "");
        this.debridAuthDialog.status = message.includes("PREMIUMIZE_CLIENT_ID") ? "missingConfiguration" : "failed";
        this.debridAuthDialog.message = message.includes("PREMIUMIZE_CLIENT_ID") ? "" : message;
        this.refreshDebridDeviceAuthDialog();
        await this.render({ refreshModel: false });
      }
    },
    scheduleDebridDeviceAuthPoll(nonce) {
      if (!this.isCurrentDebridAuth(nonce)) return;
      const seconds = Math.max(1, Math.trunc(Number(this.debridAuthDialog?.session?.intervalSeconds || 5)));
      this.debridAuthPollTimer = setTimeout(() => void this.pollDebridDeviceAuth(nonce), seconds * 1000);
    },
    async pollDebridDeviceAuth(nonce) {
      const state = this.debridAuthDialog;
      if (!state?.session || !this.isCurrentDebridAuth(nonce)) return;
      const result = await DebridDeviceAuthService.redeem(state.provider.id, state.session.deviceCode).catch((error) => ({
        status: DEBRID_DEVICE_AUTH_STATUS.FAILED,
        message: String(error?.message || error || "")
      }));
      if (!this.isCurrentDebridAuth(nonce)) return;
      if (result.status === DEBRID_DEVICE_AUTH_STATUS.AUTHORIZED) {
        DebridSettingsStore.setProviderApiKey(state.provider.id, result.accessToken);
        this.closeOptionDialog();
        await this.render();
        return;
      }
      if (result.status === DEBRID_DEVICE_AUTH_STATUS.PENDING) {
        this.scheduleDebridDeviceAuthPoll(nonce);
        return;
      }
      this.debridAuthDialog.status = result.status === DEBRID_DEVICE_AUTH_STATUS.EXPIRED ? "expired" : "failed";
      this.debridAuthDialog.message = String(result.message || "");
      this.refreshDebridDeviceAuthDialog();
      await this.render({ refreshModel: false });
    }
  };
}
