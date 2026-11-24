/* eslint-disable no-unused-vars */
import * as internals from "./pluginsScreen.js";

export function createPluginsScreenMethods04() {
  const { ScreenUtils, Router, Platform, PluginManager, t } = internals;

  return {
    async refreshRepository(repositoryId) {
      if (this.busy) return;
      const operationToken = this.beginBusyAction(`refresh:${repositoryId}`);
      this.setStatus(t("plugin_refreshing", {}, "Refreshing…"));
      this.render();
      try {
        const result = await PluginManager.refreshRepository(repositoryId);
        if (!this.isBusyActionActive(operationToken)) return;
        this.setStatus(
          result?.ok === false ? result.reason : t("plugin_repo_refreshed", {}, "Repository refreshed."),
          result?.ok === false ? "error" : "success"
        );
      } catch (error) {
        if (!this.isBusyActionActive(operationToken)) return;
        this.setStatus(String(error?.message || error || t("plugin_error_refresh", {}, "Failed to refresh")), "error");
      } finally {
        if (this.finishBusyAction(operationToken)) {
          this.render();
        }
      }
    },
    async testScraper(scraperId) {
      if (this.busy) return;
      const operationToken = this.beginBusyAction(`test-scraper:${scraperId}`);
      this.testResult = null;
      this.diagnosticsProviderId = null;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      this.testAbortController = controller;
      this.setStatus(t("plugin_test_btn", {}, "Test"));
      this.render();
      try {
        const result = await PluginManager.testScraper(scraperId, {
          signal: controller?.signal || null
        });
        if (!this.isBusyActionActive(operationToken)) return;
        this.testResult = { scraperId, ...result };
        const count = Array.isArray(result?.results) ? result.results.length : 0;
        this.setStatus(
          count
            ? t("plugin_test_results", { count }, `Test results (${count} streams)`)
            : t("plugin_test_no_results", {}, "No results found"),
          count ? "success" : ""
        );
      } catch (error) {
        if (!this.isBusyActionActive(operationToken)) return;
        this.testResult = null;
        this.setStatus(
          t(
            "plugin_error_test",
            { message: String(error?.message || error || "") },
            `Test failed: ${String(error?.message || error || "")}`
          ),
          "error"
        );
      } finally {
        if (this.testAbortController === controller) this.testAbortController = null;
        if (this.finishBusyAction(operationToken)) {
          this.render();
        }
      }
    },
    async onKeyDown(event) {
      if (this.pendingScraperEnable || this.pendingRepositoryRemoval) {
        if (Platform.isBackEvent(event)) {
          event?.preventDefault?.();
          if (this.pendingRepositoryRemoval) {
            this.dismissRepositoryRemoval();
            return;
          }
          this.pendingScraperEnable = null;
          this.render();
          return;
        }
        const code = Number(event?.keyCode || 0);
        if (code === 13) {
          event?.preventDefault?.();
          const current = this.container?.querySelector?.(".plugins-confirm-dialog .plugins-focusable:not([disabled]).focused");
          if (current) await this.activateTarget(current);
          return;
        }
        if ([37, 39].includes(code)) {
          event?.preventDefault?.();
          ScreenUtils.handleDpadNavigation(event, this.container, ".plugins-confirm-dialog .plugins-focusable:not([disabled])");
        }
        return;
      }
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        await Router.back();
        return;
      }
      const code = Number(event?.keyCode || 0);
      const nativeCode = Number(event?.originalKeyCode || code);
      if (Platform.isTizen() && [65376, 65385].includes(nativeCode)) {
        const input = document.activeElement;
        if (this.container?.contains?.(input) && input?.matches?.("input[data-action='repository-input']")) {
          // Tizen leaves the editor focused after IME Done/Cancel. End editing
          // before returning to the D-pad graph, as Android does on IME Done.
          this.addDraft = String(input.value || "");
          input.blur();
          this.focusKey = "add:submit";
          this.applyFocus();
          if (nativeCode === 65376 && this.addDraft.trim() && !this.busy) {
            await this.addRepository();
          }
          return;
        }
      }
      if (this.isNativeTextInputEditingActive(event) && [38, 40, 37, 39].includes(code)) {
        // Tizen/webOS route the directional keys through the native TV keyboard
        // while an input is being edited. Do not let the page-level focus graph
        // move to repository actions behind that keyboard.
        event?.stopPropagation?.();
        return;
      }
      if (code === 13) {
        event?.preventDefault?.();
        const current = this.container?.querySelector?.(".plugins-focusable.focused");
        if (current) {
          this.rememberFocusedTarget(current);
          await this.activateTarget(current);
        }
        return;
      }
      if (event?.target?.matches?.("input") && (code === 37 || code === 39) && (!Platform.isWebOS() || this.keyboardVisible !== false)) {
        return;
      }
      if ([37, 39].includes(code)) {
        if (this.moveFocusWithinHorizontalRow(code === 37 ? "left" : "right")) {
          event?.preventDefault?.();
          return;
        }
      }
      if ([38, 40, 37, 39].includes(code)) {
        if (ScreenUtils.handleDpadNavigation(event, this.container, ".plugins-focusable:not([disabled])")) {
          const target = this.rememberFocusedTarget();
          if (target) this.ensureMainVisibility(target);
        }
      }
    },
    consumeBackRequest() {
      if (this.pendingRepositoryRemoval) {
        this.dismissRepositoryRemoval();
        return true;
      }
      if (this.pendingScraperEnable) {
        this.pendingScraperEnable = null;
        this.render();
        return true;
      }
      return false;
    },
    cleanup() {
      this.routeEnterPending = false;
      this.runtimeProbeGeneration = Number(this.runtimeProbeGeneration || 0) + 1;
      if (this.unsubscribeStartupSyncPullCompleted) {
        this.unsubscribeStartupSyncPullCompleted();
        this.unsubscribeStartupSyncPullCompleted = null;
      }
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.statusTimer = 0;
      this.testAbortController?.abort?.();
      this.testAbortController = null;
      this.busyOperationToken = Number(this.busyOperationToken || 0) + 1;
      this.busy = false;
      this.busyAction = "";
      this.testResult = null;
      this.diagnosticsProviderId = null;
      this.pendingScraperEnable = null;
      this.pendingRepositoryRemoval = null;
      if (this.keyboardStateChangeHandler) {
        document.removeEventListener("keyboardStateChange", this.keyboardStateChangeHandler, false);
        this.keyboardStateChangeBound = false;
      }
      ScreenUtils.hide(this.container);
    }
  };
}
