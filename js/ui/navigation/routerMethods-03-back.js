/* eslint-disable no-unused-vars */
import * as internals from "./router.js";

const HISTORY_BACK_FALLBACK_MS = 220;

function getTimerApi() {
  const schedule =
    typeof globalThis?.setTimeout === "function"
      ? globalThis.setTimeout
      : typeof window?.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : null;
  const cancel =
    typeof globalThis?.clearTimeout === "function"
      ? globalThis.clearTimeout
      : typeof window?.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : null;
  return { schedule, cancel };
}

function detachScreenTrailerIframesForHistoryBack(screen) {
  if (!screen) {
    return;
  }
  try {
    if (typeof screen.clearHomeTrailerLayers === "function") {
      screen.clearHomeTrailerLayers();
    }
    if (typeof screen.stopTrailerPlaybackForNavigation === "function") {
      screen.stopTrailerPlaybackForNavigation();
    }
  } catch (_) {}
}

export function createRouterMethods03() {
  const { Platform, getStackEntryRoute, getStackEntryParams } = internals;

  return {
    cancelPendingHistoryBackFallback() {
      if (!this._historyBackFallbackTimer) {
        return;
      }
      const { cancel } = getTimerApi();
      try {
        cancel?.(this._historyBackFallbackTimer);
      } catch (_) {}
      this._historyBackFallbackTimer = null;
    },
    async back(options = {}) {
      if (this.pendingHistoryReturn || this.pendingPostPlayNavigation) {
        return;
      }
      this.cancelPendingHistoryBackFallback();

      const currentScreen = this.getCurrentScreen();
      const consumeResult = !options?.skipConsume ? currentScreen?.consumeBackRequest?.() : false;
      if (consumeResult) {
        if (consumeResult !== "history") {
          this.suppressNextPopstate();
        }
        return;
      }

      if (this.current === "home") {
        Platform.exitApp();
        return;
      }

      if (!options?.skipHistory && window?.history && typeof window.history.back === "function" && this.historyInitialized) {
        const sourceRoute = this.current;
        const sourceParams = this.currentParams;
        const sourceGuardNavigationId = this.routeReturnBackGuardNavigationId;
        const sourceHistoryState = window.history.state;
        const hadSkipConsume = Boolean(options?.skipConsume);
        if (hadSkipConsume) {
          this.skipConsumeNextPopstate = true;
        }
        // Detach active trailer iframes before history.back() so a YouTube
        // embed cannot keep focus or consume the shared joint session history.
        detachScreenTrailerIframesForHistoryBack(currentScreen);
        window.history.back();

        const { schedule } = getTimerApi();
        if (
          typeof schedule === "function" &&
          this.current === sourceRoute &&
          this.currentParams === sourceParams &&
          this.routeReturnBackGuardNavigationId === sourceGuardNavigationId
        ) {
          this._historyBackFallbackTimer = schedule(() => {
            this._historyBackFallbackTimer = null;
            if (
              this.pendingHistoryReturn ||
              this.pendingPostPlayNavigation ||
              this.current !== sourceRoute ||
              this.currentParams !== sourceParams ||
              this.routeReturnBackGuardNavigationId !== sourceGuardNavigationId
            ) {
              return;
            }
            const liveState = window?.history?.state;
            if (liveState !== sourceHistoryState && String(liveState?.route || "") !== sourceRoute) {
              return;
            }
            if (hadSkipConsume) {
              this.skipConsumeNextPopstate = false;
            }
            this.suppressNextPopstate?.();
            void this.back({ skipConsume: true, skipHistory: true, syncHistoryState: true });
          }, HISTORY_BACK_FALLBACK_MS);
        }
        return;
      }

      if (this.stack.length === 0) {
        if (this.current && this.current !== "home" && this.routes.home) {
          const previousRoute = this.current;
          const guardId = this.beginRouteReturnBackGuard?.(true);
          try {
            this.routes[this.current].cleanup?.();
            this.current = "home";
            this.currentParams = {};
            await this.routes.home.mount(
              {},
              {
                isBackNavigation: true,
                previousRoute
              }
            );
          } finally {
            this.completeRouteReturnBackGuard?.(guardId);
          }
          if (
            options?.syncHistoryState &&
            this.current === "home" &&
            window?.history &&
            typeof window.history.replaceState === "function"
          ) {
            window.history.replaceState({ route: "home", params: {}, previousRoute }, "");
          }
          this.persistWebOsResumeRoute("home", {});
          return;
        }

        Platform.exitApp();
        return;
      }

      const previous = this.stack.pop();
      const previousRoute = getStackEntryRoute(previous);
      const previousParams = getStackEntryParams(previous);

      if (!previousRoute || !this.routes[previousRoute]) {
        return;
      }

      const fromRoute = this.current;
      const guardId = this.beginRouteReturnBackGuard?.(true);
      try {
        this.captureCurrentRouteState();
        this.routes[this.current].cleanup?.();
        this.current = previousRoute;
        this.currentParams = previousParams;
        const navigationContext = this.resolveNavigationContext(previousRoute, previousParams, {
          isBackNavigation: true,
          previousRoute: fromRoute
        });

        await this.routes[previousRoute].mount(previousParams, navigationContext);
      } finally {
        this.completeRouteReturnBackGuard?.(guardId);
      }
      if (
        options?.syncHistoryState &&
        this.current === previousRoute &&
        this.currentParams === previousParams &&
        window?.history &&
        typeof window.history.replaceState === "function"
      ) {
        window.history.replaceState({ route: this.current, params: this.currentParams, previousRoute: fromRoute || null }, "");
      }
      this.persistWebOsResumeRoute(this.current, this.currentParams);
    },
    getCurrent() {
      return this.current;
    },
    getCurrentScreen() {
      if (!this.current) {
        return null;
      }
      return this.routes[this.current] || null;
    }
  };
}
