import { Router } from "../../navigation/router.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";
import { renderBrandWordmarkImage } from "../../components/brandWordmark.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";

let pollInterval = null;
let countdownInterval = null;
let activeQrSessionId = 0;
const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";

export const AuthQrSignInScreen = {
  async mount({ onboardingMode = false } = {}) {
    this.container = document.getElementById("account");
    this.onboardingMode = Boolean(onboardingMode);
    this.isSignedIn = AuthManager.isAuthenticated;
    this.hasBackDestination = Router.stack.length > 0;
    this.isMounted = true;
    this.isStartingQr = false;
    this.isLeaving = false;
    const serverConfiguration = ServerConfigurationStore.getActive();
    this.hasQrConfiguration = Boolean(
      serverConfiguration.backendUrl &&
      serverConfiguration.publishableKey &&
      serverConfiguration.capabilities.tvLogin
    );
    ScreenUtils.show(this.container);

    this.container.innerHTML = `
      <div class="qr-layout">
        <section class="qr-left-panel">
          <div class="qr-brand-lockup">
            ${renderBrandWordmarkImage({ className: "qr-logo" })}
          </div>

          <div class="qr-copy-block">
            <h1 class="qr-title">${I18n.t("auth.qr.title")}</h1>
            <p id="qr-description" class="qr-description">${this.getLeftDescription()}</p>
          </div>
          <div class="qr-left-actions">
            <button type="button" id="qr-server-btn" class="qr-action-btn qr-action-btn-secondary qr-server-btn focusable" data-action="server">${I18n.t(
              "server_options_title",
              {},
              { fallback: "Server options" }
            )}</button>
          </div>
        </section>

        <section class="qr-card-panel" aria-label="${I18n.t("auth.qr.cardAriaLabel")}">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">${I18n.t("auth.qr.cardTitle")}</h2>
              <p id="qr-card-subtitle" class="qr-card-subtitle">${this.getCardSubtitle()}</p>
            </header>

            <div id="qr-container" class="qr-code-frame">${
              this.hasQrConfiguration
                ? ""
                : `<span class="qr-code-placeholder">${I18n.t(
                    "auth.qr.configureServer",
                    {},
                    { fallback: "Configure a server to generate a QR code" }
                  )}</span>`
            }</div>
            <div id="qr-code-text" class="qr-code-text"></div>
            <div id="qr-status" class="qr-status">${I18n.t("auth.qr.waitingApproval")}</div>
            <div class="qr-actions">
              <button type="button" id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">${I18n.t("auth.qr.refresh")}</button>
              <button type="button" id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">${this.getBackButtonLabel()}</button>
            </div>
          </div>
        </section>
      </div>
    `;

    this.refreshButton = this.container.querySelector("#qr-refresh-btn");
    this.backButton = this.container.querySelector("#qr-back-btn");
    if (this.refreshButton) {
      this.refreshButton.onclick = () => {
        this.handleRefreshAction();
      };
    }
    if (this.backButton) {
      this.backButton.onclick = () => {
        this.handleContinueAction();
      };
    }

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(
      this.container,
      this.hasQrConfiguration ? "#qr-refresh-btn" : "#qr-server-btn"
    );
    // Android starts QR login from LaunchedEffect after composing the screen;
    // the QR service must not delay route completion or Back handling.
    void this.startQr().catch((error) => {
      if (!this.isMounted || this.isLeaving) {
        return;
      }
      console.warn("QR login background start failed", error);
      this.setStatus(this.toFriendlyQrError(error?.message || error));
    });
  },

  async startQr() {
    if (!this.isMounted || this.isLeaving || this.isStartingQr) {
      return;
    }
    if (!this.hasQrConfiguration) {
      this.setStatus(I18n.t("auth.qr.notConfigured"));
      return;
    }
    this.isStartingQr = true;
    this.updateActionButtons();
    this.stopIntervals();
    const sessionId = activeQrSessionId + 1;
    activeQrSessionId = sessionId;
    this.clearQr();
    this.setStatus(I18n.t("auth.qr.preparing"));

    try {
      const result = await QrLoginService.start();
      if (!this.isMounted || sessionId !== activeQrSessionId) {
        return;
      }

      if (!result) {
        const raw = QrLoginService.getLastError();
        this.setStatus(this.toFriendlyQrError(raw));
        return;
      }

      this.renderQr(result);
      this.setStatus(I18n.t("auth.qr.scanAndSignIn"));
      this.startPolling(
        result.code,
        result.deviceNonce,
        result.pollIntervalSeconds || 3,
        sessionId
      );
    } finally {
      if (this.isMounted && sessionId === activeQrSessionId) {
        this.isStartingQr = false;
        this.updateActionButtons();
      }
    }
  },

  renderQr({ qrImageUrl, code }) {
    const qrContainer = this.container?.querySelector("#qr-container");
    const codeText = this.container?.querySelector("#qr-code-text");

    if (!qrContainer || !codeText) {
      return;
    }

    qrContainer.innerHTML = `
      <img src="${qrImageUrl}" class="qr-image" alt="${I18n.t("auth.qr.qrImageAlt")}" />
    `;

    codeText.innerText = I18n.t("auth.qr.codeLabel", { code });
  },

  clearQr() {
    const qrContainer = this.container?.querySelector("#qr-container");
    const codeText = this.container?.querySelector("#qr-code-text");
    if (qrContainer) {
      qrContainer.innerHTML = "";
    }
    if (codeText) {
      codeText.innerText = "";
    }
  },

  startCountdown(expiresAt) {
    const renderRemaining = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }
    };

    renderRemaining();
    countdownInterval = setInterval(renderRemaining, 1000);
  },

  startPolling(code, deviceNonce, pollIntervalSeconds = 3, sessionId) {
    pollInterval = setInterval(
      async () => {
        const status = await QrLoginService.poll(code, deviceNonce);
        if (!this.isMounted || sessionId !== activeQrSessionId) {
          return;
        }

        if (status === "approved") {
          this.setStatus(I18n.t("auth.qr.approved"));
          clearInterval(pollInterval);
          pollInterval = null;

          const exchange = await QrLoginService.exchange(code, deviceNonce);
          if (sessionId !== activeQrSessionId) {
            return;
          }

          if (exchange) {
            LocalStore.remove(GUEST_QR_BYPASS_KEY);
            LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
            this.isSignedIn = true;
            // AuthManager's authenticated-state subscriber owns post-login
            // routing. Do not navigate here as well: the two async routes can
            // mount and clean up the profile screen concurrently on Tizen.
          } else {
            this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
          }
        }

        if (status === "pending") {
          this.setStatus(I18n.t("auth.qr.waitingApproval"));
        }

        if (status === "expired") {
          this.setStatus(I18n.t("auth.qr.expired"));
        }
      },
      Math.max(2, Number(pollIntervalSeconds || 3)) * 1000
    );
  },

  toFriendlyQrError(rawError) {
    const normalizedError = String(rawError || "")
      .replace(/\s+/g, " ")
      .trim();
    const conciseReason =
      normalizedError.length > 160 ? `${normalizedError.slice(0, 157)}...` : normalizedError;
    const message = normalizedError.toLowerCase();
    if (!message) {
      return I18n.t("auth.qr.unavailable");
    }
    if (
      message.includes("qr auth is not configured") ||
      message.includes("missing redirect_base_url configuration") ||
      message.includes("apikey") ||
      message.includes("api key") ||
      message.includes("anon key")
    ) {
      return I18n.t("auth.qr.notConfigured");
    }
    if (message.includes("invalid tv login redirect base url")) {
      return I18n.t("auth.qr.invalidRedirect");
    }
    if (
      message.includes("start_tv_login_session") &&
      message.includes("could not find the function")
    ) {
      return I18n.t("auth.qr.missingFunction");
    }
    if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
      return I18n.t("auth.qr.missingExtension");
    }
    if (message.includes("network") || message.includes("failed to fetch")) {
      return I18n.t("auth.qr.networkError");
    }
    if (
      message.includes("unsupported method") ||
      message.includes("error response") ||
      message.includes("http 5") ||
      message.includes("http 404") ||
      message.includes("http 405")
    ) {
      return I18n.t("auth.qr.serviceUnavailable");
    }
    return I18n.t("auth.qr.unavailableWithReason", { reason: conciseReason });
  },

  setStatus(text) {
    const statusNode = this.container?.querySelector("#qr-status");
    if (!statusNode) {
      return;
    }
    statusNode.innerText = text;
  },

  updateActionButtons() {
    const refreshButton = this.refreshButton || this.container?.querySelector("#qr-refresh-btn");
    const backButton = this.backButton || this.container?.querySelector("#qr-back-btn");
    const disabled = Boolean(this.isLeaving || this.isStartingQr);
    if (refreshButton instanceof HTMLButtonElement) {
      refreshButton.disabled = disabled;
      refreshButton.setAttribute("aria-busy", this.isStartingQr ? "true" : "false");
    }
    if (backButton instanceof HTMLButtonElement) {
      backButton.disabled = Boolean(this.isLeaving);
    }
  },

  handleRefreshAction() {
    if (this.isLeaving || this.isStartingQr) {
      return;
    }
    this.startQr();
  },

  async handleContinueAction() {
    if (this.isLeaving) {
      return;
    }
    this.isLeaving = true;
    this.updateActionButtons();
    LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
    if (!this.isSignedIn) {
      LocalStore.set(GUEST_QR_BYPASS_KEY, true);
      await AuthManager.signOut();
    } else {
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
    }
    this.cleanup();
    if (this.hasBackDestination && this.isSignedIn) {
      Router.back();
      return;
    }
    Router.navigate(
      "home",
      {},
      {
        replaceHistory: true,
        skipStackPush: true
      }
    );
  },

  getLeftDescription() {
    if (this.isSignedIn) {
      return I18n.t("auth.qr.leftDescriptionSignedIn");
    }
    return I18n.t("auth.qr.leftDescriptionSignedOut");
  },

  getCardSubtitle() {
    if (this.isSignedIn) {
      return I18n.t("auth.qr.cardSubtitleSignedIn");
    }
    return I18n.t("auth.qr.cardSubtitleSignedOut");
  },

  getBackButtonLabel() {
    if (this.isSignedIn) {
      return I18n.t("auth.qr.continue");
    }
    return I18n.t("auth.qr.continueWithoutAccount");
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }

    const current = this.container?.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const action = current.dataset.action;
    if (action === "refresh") {
      this.handleRefreshAction();
      return;
    }
    if (action === "server") {
      Router.navigate("serverConnection", { returnRoute: "authQrSignIn" });
      return;
    }
    if (action === "back") {
      this.handleContinueAction();
    }
  },

  consumeBackRequest() {
    this.handleContinueAction();
    return true;
  },

  stopIntervals() {
    if (pollInterval) clearInterval(pollInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    pollInterval = null;
    countdownInterval = null;
  },

  cleanup() {
    this.isMounted = false;
    activeQrSessionId += 1;
    this.stopIntervals();
    if (this.refreshButton) {
      this.refreshButton.onclick = null;
      this.refreshButton = null;
    }
    if (this.backButton) {
      this.backButton.onclick = null;
      this.backButton = null;
    }
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
