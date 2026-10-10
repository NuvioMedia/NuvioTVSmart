/* eslint-disable no-unused-vars */
import * as internals from "./authQrSignInScreen.js";

export function createAuthQrSignInScreenMethods02() {
  const { Router, QrLoginService, LocalStore, I18n, QrCodeGenerator, GUEST_QR_BYPASS_KEY, escapeHtml, formatDuration, parseQrExpiration } =
    internals;

  return {
    bindControls() {
      const serverMenuButton = this.container.querySelector("[data-action='server-menu']");
      serverMenuButton?.addEventListener("click", () => this.toggleServerMenu());

      const refreshButton = this.container.querySelector("#qr-refresh-btn");
      refreshButton?.addEventListener("click", () => {
        const action = refreshButton.dataset.action;
        if (action === "signout") {
          this.openSignOutConfirmation();
        } else {
          this.handleRefreshAction();
        }
      });
      this.container.querySelector("#qr-back-btn")?.addEventListener("click", () => {
        void this.handleContinueAction();
      });
      this.container
        .querySelector("[data-action='use-official']")
        ?.addEventListener("click", () => this.openServerConnection("officialReview"));
      this.container.querySelector("[data-action='connect-custom']")?.addEventListener("click", () => this.openServerConnection("input"));
      this.container.querySelector("[data-action='login-qr']")?.addEventListener("click", () => this.toggleLoginMode(false));
      this.container.querySelector("[data-action='login-email']")?.addEventListener("click", () => this.toggleLoginMode(true));
      this.container.querySelector("[data-action='email-submit']")?.addEventListener("click", () => void this.submitEmailLogin());
      this.container.querySelector("[data-action='cancel-signout']")?.addEventListener("click", () => this.dismissSignOutConfirmation());
      this.container.querySelector("[data-action='confirm-signout']")?.addEventListener("click", () => void this.handleSignOut());
      this.container.querySelector("[data-action='terms']")?.addEventListener("click", () => {
        window.open?.("https://nuvio.tv/terms", "_blank");
      });

      const emailInput = this.container.querySelector("#auth-email-input");
      const passwordInput = this.container.querySelector("#auth-password-input");
      emailInput?.addEventListener("input", (event) => {
        this.email = String(event.target?.value || "");
        this.emailError = "";
        this.updateEmailError();
      });
      passwordInput?.addEventListener("input", (event) => {
        this.password = String(event.target?.value || "");
        this.emailError = "";
        this.updateEmailError();
      });
    },
    updateEmailError() {
      const errorNode = this.container?.querySelector(".qr-login-error");
      if (errorNode) {
        errorNode.textContent = this.emailError;
        errorNode.hidden = !this.emailError;
      }
    },
    toggleServerMenu() {
      if (this.isLeaving || this.showSignOutConfirmation) return;
      if (this.isServerMenuOpen) {
        this.focusAfterRender = ".qr-server-menu-trigger";
      }
      this.isServerMenuOpen = !this.isServerMenuOpen;
      this.render();
    },
    toggleLoginMode(useEmail) {
      // Auth requests already in flight cannot safely be cancelled.
      if (!this.isMounted || this.isLeaving || this.isSignedIn || this.isStartingQr || this.isPolling || this.isEmailSubmitting) return;
      if (!this.supportsEmailAuth || !this.supportsQrAuth) return;
      if (this.useEmailLogin === useEmail) {
        this.isServerMenuOpen = false;
        this.render();
        return;
      }
      this.useEmailLogin = useEmail;
      this.useQrLogin = !useEmail;
      this.isServerMenuOpen = false;
      this.stopIntervals();
      this.clearQr();
      this.qrStatusText = "";
      this.render();
      if (this.useQrLogin) {
        void this.startQr().catch((error) => {
          if (this.isMounted && !this.isLeaving) {
            this.setStatus(this.toFriendlyQrError(error?.message || error));
          }
        });
      }
    },
    openSignOutConfirmation() {
      if (this.isLeaving || !this.isSignedIn) return;
      this.isServerMenuOpen = false;
      this.showSignOutConfirmation = true;
      this.render();
    },
    dismissSignOutConfirmation() {
      if (!this.showSignOutConfirmation || this.isLeaving) return;
      this.showSignOutConfirmation = false;
      this.render();
    },
    openServerConnection(initialMode = "list") {
      if (this.isLeaving) return;
      this.isServerMenuOpen = false;
      Router.navigate("serverConnection", {
        returnRoute: "authQrSignIn",
        returnParams: { onboardingMode: this.onboardingMode },
        initialMode
      });
    },
    async startQr() {
      if (!this.isMounted || this.isLeaving || this.isStartingQr || !this.useQrLogin || this.isSignedIn) {
        return;
      }
      this.isStartingQr = true;
      this.updateActionButtons();
      this.stopIntervals();
      this.clearQr();
      this.setStatus(I18n.t("auth.qr.preparing"));

      try {
        const result = await QrLoginService.start();
        if (!this.isMounted || this.isLeaving) return;
        if (!result || !result.code) {
          this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
          return;
        }
        this.renderQr(result);
        this.setStatus(I18n.t("auth.qr.scanAndSignIn"));
        this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3);
      } finally {
        if (this.isMounted) {
          this.isStartingQr = false;
          this.updateActionButtons();
        }
      }
    },
    renderQr(result) {
      this.qrResult = result;
      const { loginUrl, verificationUri, displayCode, code, expiresAt } = result;
      const qrContainer = this.container?.querySelector("#qr-container");
      const codeText = this.container?.querySelector("#qr-code-text");
      const manualText = this.container?.querySelector("#qr-manual-text");
      if (!qrContainer || !codeText) return;
      const content = String(loginUrl || "").trim();
      if (!content) {
        qrContainer.innerHTML = `<span class="qr-code-unavailable">${escapeHtml(I18n.t("auth.qr.unavailable"))}</span>`;
      } else {
        qrContainer.innerHTML = `<canvas class="qr-image qr-image-canvas" aria-label="${escapeHtml(
          I18n.t("auth.qr.qrImageAlt")
        )}"></canvas>`;
        try {
          QrCodeGenerator.generate(qrContainer.querySelector("canvas"), content, 320);
        } catch (error) {
          console.warn("Unable to render QR code locally", error);
          qrContainer.innerHTML = `<span class="qr-code-unavailable">${escapeHtml(I18n.t("auth.qr.unavailable"))}</span>`;
        }
      }
      if (manualText) {
        const manualUrl = String(verificationUri || "")
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "");
        manualText.innerText = manualUrl && (displayCode || code) ? I18n.t("auth.qr.manualInstruction", { url: manualUrl }) : "";
      }
      codeText.innerText = I18n.t("auth.qr.codeLabel", {
        code: displayCode || code || ""
      });
      this.startCountdown(expiresAt);
    },
    clearQr() {
      this.qrResult = null;
      const qrContainer = this.container?.querySelector("#qr-container");
      const manualText = this.container?.querySelector("#qr-manual-text");
      const codeText = this.container?.querySelector("#qr-code-text");
      const expiryNode = this.container?.querySelector("#qr-expiry");
      if (qrContainer) qrContainer.innerHTML = "";
      if (manualText) manualText.innerText = "";
      if (codeText) codeText.innerText = "";
      if (expiryNode) expiryNode.innerText = "";
    },
    startCountdown(expiresAt) {
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      const expiration = Number(expiresAt || 0);
      this.qrExpiresAtMillis = expiration;
      if (!expiration) return;
      const renderRemaining = () => {
        if (!this.isMounted) return;
        const remaining = expiration - Date.now();
        const expiryNode = this.container?.querySelector("#qr-expiry");
        if (expiryNode) {
          expiryNode.innerText = I18n.t("auth.qr.expires", {
            duration: formatDuration(remaining)
          });
        }
        if (remaining <= 0) {
          this.setStatus(I18n.t("auth.qr.expired"));
          this.stopIntervals();
        }
      };
      renderRemaining();
      this.countdownTimer = setInterval(renderRemaining, 1000);
    },
    startPolling(code, deviceNonce, pollIntervalSeconds = 3) {
      this.stopPollingOnly();
      this.qrPollIntervalSeconds = Math.max(2, Number(pollIntervalSeconds || 3));
      const pollOnce = async () => {
        if (!this.isMounted || this.isLeaving || this.isPolling) return;
        this.isPolling = true;
        try {
          const pollResult = await QrLoginService.poll(code, deviceNonce);
          const status = typeof pollResult === "string" ? pollResult : pollResult?.status || null;
          if (pollResult && typeof pollResult === "object") {
            const nextInterval = Number(pollResult.pollIntervalSeconds);
            if (Number.isFinite(nextInterval) && nextInterval > 0) {
              this.qrPollIntervalSeconds = Math.max(2, nextInterval);
            }
            const nextExpiration = parseQrExpiration(pollResult.expiresAt);
            if (nextExpiration > 0 && nextExpiration !== this.qrExpiresAtMillis) {
              this.startCountdown(nextExpiration);
            }
          }
          if (!this.isMounted || this.isLeaving) return;
          if (status === "approved") {
            this.setStatus(I18n.t("auth.qr.approved"));
            this.stopPollingOnly();
            const exchange = await QrLoginService.exchange(code, deviceNonce);
            if (!this.isMounted || this.isLeaving) return;
            if (exchange) {
              LocalStore.remove(GUEST_QR_BYPASS_KEY);
              LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
              this.isSignedIn = true;
              this.connectedStats = null;
              this.isConnectedStatsLoading = true;
              this.render();
              void this.loadConnectedStats();
              this.setStatus(I18n.t("auth.qr.success"));
            } else {
              this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
            }
            return;
          }
          if (status === "pending") {
            this.setStatus(I18n.t("auth.qr.waitingApproval"));
          } else if (["expired", "used", "cancelled"].includes(status)) {
            this.setStatus(I18n.t("auth.qr.expired"));
            this.stopPollingOnly();
            return;
          } else if (!status) {
            this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
            this.stopPollingOnly();
            return;
          }
        } finally {
          this.isPolling = false;
          if (this.isMounted && !this.isLeaving && this.pollTimer !== null) {
            this.pollTimer = setTimeout(pollOnce, Math.max(2, Number(this.qrPollIntervalSeconds || 3)) * 1000);
          }
        }
      };
      this.pollTimer = setTimeout(pollOnce, Math.max(2, Number(this.qrPollIntervalSeconds || 3)) * 1000);
    },
    toFriendlyQrError(rawError) {
      const normalizedError = String(rawError || "")
        .replace(/\s+/g, " ")
        .trim();
      const conciseReason = normalizedError.length > 160 ? `${normalizedError.slice(0, 157)}...` : normalizedError;
      const message = normalizedError.toLowerCase();
      if (!message) return I18n.t("auth.qr.unavailable");
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
        (message.includes("start_device_login_session") || message.includes("start_tv_login_session")) &&
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
    }
  };
}
