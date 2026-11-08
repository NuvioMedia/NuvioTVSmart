import { createTrackingSettingsMethods } from "../settings/trackingSettingsMethods.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { TraktAuthService } from "../../../data/repository/traktAuthService.js";
import { SimklAuthService } from "../../../data/repository/simklAuthService.js";
import { SimklSyncService } from "../../../data/repository/simklSyncService.js";
import {
  SimklAnimeIdPreference,
  MoreLikeThisSourcePreference,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource,
  normalizeTraktContinueWatchingDaysCap
} from "../../../data/local/traktSettingsStore.js";
import { I18n } from "../../../i18n/index.js";
import {
  SettingsScreen,
  bindSettingsScrollIndicators,
  scrollSettingsContentItem
} from "../settings/settingsScreen.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function focusNode(node) {
  focusWithoutScroll(node);
}

function captureTraktScrollState(container) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  return {
    traktScrollTop: Number(scrollArea?.scrollTop || 0)
  };
}

function restoreTraktScrollState(container, scrollState) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  if (scrollArea && scrollState) {
    scrollArea.scrollTop = Number(scrollState.traktScrollTop || 0);
  }
}

function formatCountdown(valueMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const TRAKT_ROUTE_ENTER_DURATION_MS = 350;

export const TraktScreen = Object.assign(Object.create(SettingsScreen), {
  ...createTrackingSettingsMethods(),
  async mount() {
    this.container = document.getElementById("trakt");
    ScreenUtils.show(this.container);
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = this.contentFocusKey || null;
    this.optionDialog = this.optionDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.traktRouteEnterPending = true;
    this.traktRouteAutoWorkDeferred = true;
    this.expandedProvider = this.expandedProvider || null;
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    await this.render();
    this.deferTraktAutoWork("clock");
    if (TraktAuthService.isAuthenticated()) {
      this.deferTraktAutoWork("stats");
    }
  },

  deferTraktAutoWork(kind) {
    const key = String(kind || "");
    if (!key || Router.getCurrent() !== "trakt" || !this.traktRouteAutoWorkDeferred) {
      return false;
    }
    this.pendingTraktAutoWork = {
      ...(this.pendingTraktAutoWork || {}),
      [key]: true
    };
    this.scheduleTraktRouteAutoWork();
    return true;
  },

  scheduleTraktRouteAutoWork() {
    if (this.traktRouteAutoWorkTimer) {
      return;
    }
    this.traktRouteAutoWorkTimer = setTimeout(() => {
      this.traktRouteAutoWorkTimer = null;
      this.runTraktRouteAutoWork();
    }, TRAKT_ROUTE_ENTER_DURATION_MS + 80);
  },

  runTraktRouteAutoWork() {
    const pending = this.pendingTraktAutoWork || {};
    this.pendingTraktAutoWork = null;
    this.traktRouteAutoWorkDeferred = false;
    if (Router.getCurrent() !== "trakt") {
      return;
    }
    if (pending.clock) {
      this.startTraktClock();
    }
    if (pending.polling) {
      this.startTraktPolling();
    }
    if (pending.stats && !this.traktStats && !this.traktStatsLoading) {
      void this.loadTraktStats(false).then(() => {
        if (Router.getCurrent() === "trakt" && this.container && this.activeSection === "trakt") {
          void this.render();
        }
      });
    }
    if (SimklAuthService.getCurrentAuthState().userCode) {
      this.startSimklPolling();
    }
  },

  async render({ refreshModel = true } = {}) {
    const previousScrollState = captureTraktScrollState(this.container);
    if (refreshModel || !this.model) this.model = {};
    this.actionMap = new Map();
    const rawPanelHtml = this.renderTrackingSection();
    const panelHtml = this.traktRouteEnterPending
      ? rawPanelHtml
      : rawPanelHtml.replace("settings-slide-panel ", "");
    this.actionMap.set("trakt:back", () => Router.back());
    this.container.innerHTML = `
      <div class="trakt-route-shell${this.traktRouteEnterPending ? " trakt-route-enter" : ""}">
        <div class="trakt-route-content">
          ${panelHtml}
        </div>
        <div data-trakt-dialog>${this.renderOptionDialog()}</div>
      </div>
    `;
    restoreTraktScrollState(this.container, previousScrollState);
    ScreenUtils.indexFocusables(this.container);
    bindSettingsScrollIndicators(this.container);
    this.traktRouteEnterPending = false;
    this.suppressNextContentFocusScroll = true;
    this.applyFocus();
    restoreTraktScrollState(this.container, previousScrollState);
    this.updateTraktCountdowns();
  },

  applyFocus() {
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    if (this.optionDialog) {
      const dialogNode =
        this.container.querySelector(
          `.settings-dialog-option[data-dialog-index="${this.dialogFocusIndex}"]`
        ) || this.container.querySelector(".settings-dialog-option");
      if (dialogNode) {
        dialogNode.classList.add("focused");
        focusNode(dialogNode);
        scrollSettingsContentItem(dialogNode);
      }
      return;
    }

    const selector = this.contentFocusKey
      ? `.settings-content-focusable[data-focus-key="${String(this.contentFocusKey).replace(/["\\]/g, "\\$&")}"]`
      : null;
    const target = selector ? this.container.querySelector(selector) : null;
    const fallback = target || this.container.querySelector(".settings-content-focusable");
    if (!fallback) {
      return;
    }
    fallback.classList.add("focused");
    focusNode(fallback);
    if (this.suppressNextContentFocusScroll) {
      this.suppressNextContentFocusScroll = false;
    } else {
      scrollSettingsContentItem(fallback);
    }
    this.contentFocusKey = String(fallback.dataset.focusKey || "");
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(".settings-content-focusable, .settings-dialog-option");
    if (!target || !this.container?.contains?.(target)) {
      return;
    }
    event?.preventDefault?.();
    this.container
      .querySelectorAll(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    if (target.classList.contains("settings-dialog-option")) {
      const dialogIndex = Number(target.dataset.dialogIndex);
      if (Number.isFinite(dialogIndex)) {
        this.dialogFocusIndex = dialogIndex;
      }
    } else {
      this.focusZone = "content";
      this.contentFocusKey = String(target.dataset.focusKey || this.contentFocusKey || "");
    }
    await this.activateFocused();
  },

  async activateFocused() {
    if (this.optionDialog) {
      const option = this.optionDialog.options[this.dialogFocusIndex];
      if (!option) {
        return;
      }
      if (typeof this.optionDialog.onSelect === "function") {
        await this.optionDialog.onSelect(option);
      }
      this.closeOptionDialog();
      await this.render();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    const focusKey = String(current?.dataset?.focusKey || "");
    const action = this.actionMap.get(focusKey);
    if (!action) {
      return;
    }
    this.contentFocusKey = focusKey;
    await action();
    if (Router.getCurrent() === "trakt") {
      await this.render();
    }
  },

  focusContentByKey(focusKey) {
    const target = this.container?.querySelector(
      `.settings-content-focusable[data-focus-key="${String(focusKey || "").replace(/["\\]/g, "\\$&")}"]`
    );
    if (!target) {
      return false;
    }
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      ?.forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    scrollSettingsContentItem(target);
    this.contentFocusKey = String(target.dataset.focusKey || focusKey || "");
    return true;
  },

  moveFocus(direction) {
    const selector = this.optionDialog ? ".settings-dialog-option" : ".settings-content-focusable";
    const before = this.container.querySelector(`${selector}.focused`);
    const beforeFocusKey = String(before?.dataset?.focusKey || "");

    if (!this.optionDialog) {
      if (
        direction === "up" &&
        beforeFocusKey === "trakt:librarySource" &&
        this.focusContentByKey("trakt:disconnect")
      ) {
        return;
      }
      if (
        direction === "down" &&
        beforeFocusKey === "trakt:disconnect" &&
        this.focusContentByKey("trakt:librarySource")
      ) {
        return;
      }
    }

    ScreenUtils.moveFocusDirectional(this.container, direction, selector);
    const after = this.container.querySelector(`${selector}.focused`);
    if (after && after !== before) {
      if (this.optionDialog) {
        const dialogIndex = Number(after.dataset.dialogIndex);
        if (Number.isFinite(dialogIndex)) {
          this.dialogFocusIndex = dialogIndex;
        }
      } else {
        this.contentFocusKey = String(after.dataset.focusKey || "");
      }
      scrollSettingsContentItem(after);
    }
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.optionDialog) {
        this.closeOptionDialog();
        await this.render({ refreshModel: false });
        return;
      }
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (this.optionDialog && (code === 37 || code === 39)) {
        return;
      }
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : "right";
      this.moveFocus(direction);
      return;
    }

    if (code === 13) {
      event?.preventDefault?.();
      await this.activateFocused();
    }
  },

  consumeBackRequest() {
    if (!this.optionDialog) {
      return false;
    }
    this.closeOptionDialog();
    void this.render({ refreshModel: false });
    return true;
  },

  cleanup() {
    if (this.traktRouteAutoWorkTimer) {
      clearTimeout(this.traktRouteAutoWorkTimer);
      this.traktRouteAutoWorkTimer = null;
    }
    this.pendingTraktAutoWork = null;
    this.traktRouteAutoWorkDeferred = false;
    if (this.simklPollTimer) {
      clearTimeout(this.simklPollTimer);
      this.simklPollTimer = null;
    }
    this.stopTraktPolling?.();
    this.stopTraktClock();
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    this.handleClickBound = null;
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = null;
    this.optionDialog = null;
    this.dialogFocusIndex = 0;
    this.model = null;
    ScreenUtils.hide(this.container);
  }
});
