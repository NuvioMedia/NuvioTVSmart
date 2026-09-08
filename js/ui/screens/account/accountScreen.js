import { AuthManager } from "../../../core/auth/authManager.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { I18n } from "../../../i18n/index.js";

export const AccountScreen = {
  async mount() {
    this.container = document.getElementById("account");
    this.container.style.display = "block";
    this.state = {
      authState: AuthManager.getAuthState(),
      email: null,
      linkedDevices: []
    };

    this.unsubscribe = AuthManager.subscribe((state) => {
      this.state.authState = state;
      this.render();
    });

    this.render();
  },

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.container) {
      this.container.style.display = "none";
      this.container.innerHTML = "";
    }
  },

  async signOut() {
    await AuthManager.signOut();
    Router.navigate("authSignIn");
  },

  render() {
    if (!this.container) {
      return;
    }

    if (this.state.authState === "loading") {
      this.container.innerHTML = `<div class="account-shell"><h2 class="account-title">${I18n.t("auth.account.loadingAccount")}</h2></div>`;
      return;
    }

    if (this.state.authState === "signedOut") {
      this.container.innerHTML = `
        <div class="account-shell">
          <h1 class="account-title">${I18n.t("auth.account.title")}</h1>
          <p class="account-subtitle">${I18n.t("auth.account.signInCopy")}</p>
          <div class="account-card focusable" data-action="signin">
            <h3 class="account-card-title">${I18n.t("auth.account.signIn")}</h3>
            <p class="account-card-subtitle">${I18n.t("auth.account.signInSubtitle")}</p>
          </div>
        </div>
      `;
      this.attachFocus();
      return;
    }

    this.container.innerHTML = `
      <div class="account-shell">
        <h1 class="account-title">${I18n.t("auth.account.title")}</h1>
        <div class="account-info">
          <span>${I18n.t("auth.account.signedInAs")}</span>
          <strong>${this.state.email || I18n.t("common.unknownUser")}</strong>
        </div>
        <div class="account-card account-card-danger focusable" data-action="logout">${I18n.t("auth.account.signOut")}</div>
      </div>
    `;
    this.attachFocus();
  },

  attachFocus() {
    const focusables = this.container.querySelectorAll(".focusable");
    focusables.forEach((el, index) => {
      el.dataset.index = String(index);
    });
    focusables[0]?.classList.add("focused");
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    const current = this.container?.querySelector(".focused");

    if (event.keyCode === 13 && current) {
      const action = current.dataset.action;
      if (action === "signin") {
        Router.navigate("authSignIn");
      }
      if (action === "logout") {
        this.signOut();
      }
    }
  }
};
