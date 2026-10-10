/* eslint-disable no-unused-vars */
import * as internals from "./authQrSignInScreen.js";

export function createAuthQrSignInScreenMethods03() {
  const { Router, LocalStore, ScreenUtils, AuthManager, I18n, Platform, GUEST_QR_BYPASS_KEY, focusNode } = internals;

  return {
    toFriendlyEmailError(rawError) {
      const message = String(rawError?.message || rawError || "")
        .replace(/\s+/g, " ")
        .trim();
      const normalized = message.toLowerCase();
      if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
        return I18n.t("auth.email.invalidCredentials");
      }
      if (normalized.includes("email not confirmed")) {
        return I18n.t("account_error_email_not_confirmed");
      }
      if (normalized.includes("user already registered")) {
        return I18n.t("account_error_email_already_registered");
      }
      if (normalized.includes("invalid email")) {
        return I18n.t("account_error_invalid_email");
      }
      if (normalized.includes("password") && normalized.includes("short")) {
        return I18n.t("account_error_password_too_short");
      }
      if (normalized.includes("password") && normalized.includes("weak")) {
        return I18n.t("account_error_password_too_weak");
      }
      if (normalized.includes("signup is disabled")) {
        return I18n.t("account_error_signup_disabled");
      }
      if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
        return I18n.t("account_error_rate_limited");
      }
      if (normalized.includes("network") || normalized.includes("failed to fetch")) {
        return I18n.t("auth.email.networkError");
      }
      if (normalized.includes("timeout") || normalized.includes("timed out")) {
        return I18n.t("account_error_connection_timeout");
      }
      if (normalized.includes("connection refused") || normalized.includes("connect failed")) {
        return I18n.t("account_error_connection_refused");
      }
      if (normalized.includes("http 404") || normalized.includes("could not find")) {
        return I18n.t("account_error_service_unavailable");
      }
      if (normalized.includes("http 400") || normalized.includes("bad request")) {
        return I18n.t("account_error_invalid_request");
      }
      return I18n.t("auth.email.signInFailed", {
        reason: message.length > 140 ? `${message.slice(0, 137)}...` : message
      });
    },
    setStatus(text) {
      this.qrStatusText = text;
      const statusNode = this.container?.querySelector("#qr-status");
      if (statusNode) statusNode.innerText = text;
    },
    updateActionButtons() {
      const refreshButton = this.container?.querySelector("#qr-refresh-btn");
      if (refreshButton instanceof HTMLButtonElement) {
        const disabled = Boolean(this.isLeaving || this.isStartingQr || this.isEmailSubmitting);
        refreshButton.disabled = disabled;
        refreshButton.setAttribute("aria-busy", this.isStartingQr ? "true" : "false");
      }
    },
    handleRefreshAction() {
      if (this.isLeaving || this.isStartingQr) return;
      void this.startQr();
    },
    async submitEmailLogin() {
      if (this.isLeaving || this.isEmailSubmitting) return;
      const email = String(this.email || "").trim();
      const password = String(this.password || "");
      if (!email || !password) {
        this.emailError = I18n.t("auth.email.required");
        this.render();
        return;
      }
      this.isEmailSubmitting = true;
      this.emailError = "";
      this.render();
      try {
        await AuthManager.signInWithEmail(email, password);
        LocalStore.remove(GUEST_QR_BYPASS_KEY);
        LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
        this.isSignedIn = true;
        this.connectedStats = null;
        this.isConnectedStatsLoading = true;
        void this.loadConnectedStats();
      } catch (error) {
        console.error("SignIn failed", error);
        if (this.isMounted) this.emailError = this.toFriendlyEmailError(error);
      } finally {
        this.isEmailSubmitting = false;
        if (this.isMounted && !this.isLeaving) this.render();
      }
    },
    async handleSignOut() {
      if (this.isLeaving || !this.isSignedIn) return;
      this.showSignOutConfirmation = false;
      this.isLeaving = true;
      this.updateActionButtons();
      try {
        await AuthManager.signOut();
      } finally {
        if (this.isMounted) {
          this.isLeaving = false;
          this.isSignedIn = false;
          this.cleanup();
          Router.navigate("authQrSignIn", { onboardingMode: false }, { replaceHistory: true });
        }
      }
    },
    async handleContinueAction() {
      if (this.isLeaving) return;
      this.isLeaving = true;
      this.updateActionButtons();
      const isGuestContinue = this.onboardingMode && !this.isSignedIn;
      if (isGuestContinue) {
        LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
        // Leaving the auth gate is not a sign-out operation. Keep guest/local
        // profile data intact; only discard the temporary anonymous auth session.
        AuthManager.clearAnonymousSession?.();
        LocalStore.set(GUEST_QR_BYPASS_KEY, true);
      } else if (this.isSignedIn) {
        LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
        LocalStore.remove(GUEST_QR_BYPASS_KEY);
      } else {
        // Back from the regular signed-out account route must not silently mark
        // the first-launch gate as completed; Android only does that for the
        // explicit onboarding action (or after a real account is restored).
        AuthManager.clearAnonymousSession?.();
      }
      this.cleanup();
      if (!this.onboardingMode && this.hasBackDestination) {
        Router.back();
        return;
      }
      Router.navigate("home", {}, { replaceHistory: true, skipStackPush: true });
    },
    leaveAuthScreen() {
      if (this.isLeaving) return;
      this.isLeaving = true;
      this.updateActionButtons();
      this.cleanup();
      if (this.onboardingMode) {
        // Android finishes the onboarding activity on hardware Back. Do not
        // silently turn Back into the explicit guest opt-in action.
        Platform.exitApp();
        return;
      }
      Router.back({ skipConsume: true });
    },
    getLeftDescription() {
      if (this.isSignedIn) return I18n.t("auth.qr.leftDescriptionSignedIn");
      if (this.useEmailLogin) return I18n.t("auth.email.hint");
      return I18n.t("auth.qr.leftDescriptionSignedOut");
    },
    getCardSubtitle() {
      if (this.isSignedIn) return I18n.t("auth.qr.cardSubtitleSignedIn");
      if (this.useEmailLogin) return I18n.t("auth.email.instruction");
      return I18n.t("auth.qr.cardSubtitleSignedOut");
    },
    getBackButtonLabel() {
      if (this.onboardingMode && !this.isSignedIn) {
        return I18n.t("auth.qr.continueWithoutAccount");
      }
      return this.onboardingMode ? I18n.t("auth.qr.continue") : I18n.t("auth.qr.back");
    },
    async onKeyDown(event) {
      const keyCode = Number(event?.keyCode || 0);
      if (this.showSignOutConfirmation) {
        if (keyCode === 27 || keyCode === 461) {
          this.dismissSignOutConfirmation();
          return;
        }
        const dialog = this.container?.querySelector(".auth-signout-confirm-dialog");
        if (ScreenUtils.handleDpadNavigation(event, dialog)) return;
        if (keyCode !== 13) return;
        const action = dialog?.querySelector(".focusable.focused")?.dataset?.action;
        if (action === "cancel-signout") {
          this.dismissSignOutConfirmation();
        } else if (action === "confirm-signout") {
          await this.handleSignOut();
        }
        return;
      }
      if (this.isServerMenuOpen && (keyCode === 27 || keyCode === 461)) {
        this.isServerMenuOpen = false;
        this.focusAfterRender = ".qr-server-menu-trigger";
        this.render();
        return;
      }
      if (keyCode === 27 || keyCode === 461) {
        this.leaveAuthScreen();
        return;
      }
      const navigationContainer = this.isServerMenuOpen ? this.container?.querySelector(".qr-server-menu") : this.container;
      if (ScreenUtils.handleDpadNavigation(event, navigationContainer)) return;
      if (keyCode !== 13) return;

      const current = navigationContainer?.querySelector(".focusable.focused");
      const action = current?.dataset?.action || "";
      if (action === "server-menu") {
        this.toggleServerMenu();
      } else if (action === "use-official" || action === "connect-custom") {
        this.openServerConnection(action === "use-official" ? "officialReview" : "input");
      } else if (action === "login-qr" || action === "login-email") {
        this.toggleLoginMode(action === "login-email");
      } else if (action === "refresh") {
        this.handleRefreshAction();
      } else if (action === "signout") {
        this.openSignOutConfirmation();
      } else if (action === "back") {
        await this.handleContinueAction();
      } else if (action === "email-submit" || action === "password-input") {
        await this.submitEmailLogin();
      } else if (action === "email-input") {
        focusNode(this.container.querySelector("#auth-password-input"));
      }
    },
    consumeBackRequest() {
      if (this.showSignOutConfirmation) {
        this.dismissSignOutConfirmation();
        return true;
      }
      if (this.isServerMenuOpen) {
        this.isServerMenuOpen = false;
        this.focusAfterRender = ".qr-server-menu-trigger";
        this.render();
        return true;
      }
      this.leaveAuthScreen();
      return true;
    },
    stopPollingOnly() {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    },
    stopIntervals() {
      this.stopPollingOnly();
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
    },
    cleanup() {
      this.isMounted = false;
      this.isLeaving = true;
      this.showSignOutConfirmation = false;
      this.stopIntervals();
      this.qrResult = null;
      this.qrStatusText = "";
      if (this.container) ScreenUtils.hide(this.container);
      this.container = null;
    }
  };
}
