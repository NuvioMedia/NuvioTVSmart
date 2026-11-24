/* eslint-disable no-unused-vars */
import * as internals from "./pluginsScreen.js";

export function createPluginsScreenMethods01() {
  const { ScreenUtils, Router, Platform, PluginManager } = internals;

  return {
    async mount() {
      this.container = document.getElementById("plugins");
      ScreenUtils.show(this.container);
      // Never focus the text field on route entry: webOS opens the virtual
      // keyboard as soon as an input receives focus.
      this.focusKey = !this.focusKey || this.focusKey === "add:input" ? "add:submit" : this.focusKey;
      this.addDraft = this.addDraft || "";
      this.routeEnterPending = true;
      this.busy = false;
      this.busyAction = "";
      this.statusMessage = "";
      this.statusKind = "";
      this.statusTimer = 0;
      this.testResult = null;
      this.diagnosticsProviderId = null;
      this.testAbortController = null;
      this.pendingScraperEnable = null;
      this.pendingRepositoryRemoval = null;
      this.keyboardVisible = false;
      this.ensureStartupSyncSubscription();
      this.runtimeProbeGeneration = Number(this.runtimeProbeGeneration || 0) + 1;
      const runtimeProbeGeneration = this.runtimeProbeGeneration;
      // Match Android's initial-state rendering: runtime capabilities only gate
      // executable actions and must not delay the management screen. Tizen also
      // probes here; its PluginService is already protected by the startup
      // health barrier, and the asynchronous QuickJS self-test is what turns a
      // provisional `unknown` state into the real limited/ready state.
      void this.probeRuntime().then(() => {
        if (runtimeProbeGeneration !== this.runtimeProbeGeneration || Router.getCurrent() !== "plugins" || this.hasActiveTextInput()) {
          return;
        }
        this.render();
      });
      this.bindEvents();
      this.render();
    },
    isNativeTextInputEditingActive(event = null) {
      if (!Platform.isTizen() && !Platform.isWebOS()) {
        return false;
      }
      if (Platform.isWebOS() && this.keyboardVisible === false) {
        // webOS keeps the input as activeElement after its native keyboard has
        // disappeared; the D-pad must be handed back to the page at that point.
        return false;
      }
      const active = document.activeElement;
      const eventTarget = event?.target || null;
      return Boolean(
        (active && this.container?.contains?.(active) && active.matches?.("input, textarea")) ||
        eventTarget?.matches?.("input, textarea") ||
        eventTarget?.closest?.("input, textarea")
      );
    },
    async probeRuntime() {
      try {
        await PluginManager.getRuntimeStatus({ probe: true });
      } catch (error) {
        this.setStatus(String(error?.message || error || ""), "error");
      }
    },
    bindEvents() {
      if (Platform.isWebOS() && !this.keyboardStateChangeBound) {
        this.keyboardStateChangeHandler = (event) => {
          this.keyboardVisible = event?.detail?.visibility === true;
        };
        document.addEventListener("keyboardStateChange", this.keyboardStateChangeHandler, false);
        this.keyboardStateChangeBound = true;
      }
      if (this.eventsBound || !this.container) return;
      this.eventsBound = true;
      this.container.addEventListener("input", (event) => {
        const input = event.target?.closest?.("[data-action='repository-input']");
        if (input) this.addDraft = String(input.value || "");
      });
      this.container.addEventListener("focusin", (event) => {
        const target = event.target?.closest?.(".plugins-focusable");
        if (!target || !this.container.contains(target)) return;
        this.container.querySelectorAll(".plugins-focusable.focused").forEach((node) => {
          if (node !== target) node.classList.remove("focused");
        });
        target.classList.add("focused");
        if (Platform.isWebOS() && target.matches?.("input, textarea")) {
          this.keyboardVisible = true;
        }
        this.rememberFocusedTarget(target);
        this.ensureMainVisibility(target);
      });
      this.container.addEventListener("click", (event) => {
        const target = event.target?.closest?.("[data-action]");
        if (!target || !this.container.contains(target) || target.disabled || target.getAttribute?.("aria-disabled") === "true") {
          return;
        }
        if (target.dataset.action === "repository-input") {
          this.focusKey = String(target.dataset.focusKey || "add:input");
          return;
        }
        event.preventDefault();
        this.focusKey = String(target.dataset.focusKey || this.focusKey || "");
        this.applyFocus();
        void this.activateTarget(target);
      });
    },
    editable(model = this.model) {
      return !model?.readOnly && !this.busy;
    },
    beginBusyAction(action) {
      const operationToken = Number(this.busyOperationToken || 0) + 1;
      this.busyOperationToken = operationToken;
      this.busyAction = String(action || "");
      this.busy = true;
      return operationToken;
    },
    finishBusyAction(operationToken) {
      if (Number(this.busyOperationToken || 0) !== Number(operationToken || 0)) {
        return false;
      }
      this.busyAction = "";
      this.busy = false;
      return true;
    },
    isBusyActionActive(operationToken) {
      return Number(this.busyOperationToken || 0) === Number(operationToken || 0);
    },
    visibleProviders(repositoryId, model = this.model) {
      return (model?.scrapers || []).filter((entry) => entry.repositoryId === repositoryId && (!model.readOnly || entry.enabled !== false));
    }
  };
}
