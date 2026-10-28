/* eslint-disable no-unused-vars */
import * as internals from "./router.js";

export function createRouterMethods02() {
  const {
    Platform,
    TizenCapabilities,
    LocalStore,
    RouteStateStore,
    ROUTER_PERF_DEBUG,
    routerPerfNow,
    logRouterPerf,
    NON_BACKSTACK_ROUTES,
    openPendingLaunchDeepLink,
    WEBOS_RESUME_ROUTE_KEY,
    WEBOS_RESUME_ROUTE_TTL_MS,
    TIZEN_ROUTE_RETURN_BACK_GUARD_MS,
    WEBOS_NON_RESTORABLE_ROUTES,
    getStackEntryRoute
  } = internals;

  return {
    completeRouteReturnBackGuard(navigationId) {
      if (navigationId !== this.routeReturnBackGuardNavigationId || !this.routeReturnBackGuardActive) {
        return;
      }
      this.routeReturnBackGuardUntil = Date.now() + TIZEN_ROUTE_RETURN_BACK_GUARD_MS;
    },
    consumeRouteReturnBackGuard() {
      if (!this.routeReturnBackGuardActive || Date.now() >= Number(this.routeReturnBackGuardUntil || 0)) {
        this.routeReturnBackGuardActive = false;
        this.routeReturnBackGuardUntil = 0;
        return false;
      }
      // Treat this as a short guard window, not a one-shot flag. Samsung can
      // report one physical Back through more than one key/history event; all
      // copies that reach the newly restored route must be consumed.
      return true;
    },
    isWebOsResumeRouteRestorable(routeName = this.current) {
      const route = String(routeName || "").trim();
      return Boolean(route && this.routes[route] && !WEBOS_NON_RESTORABLE_ROUTES.has(route));
    },
    persistWebOsResumeRoute(routeName = this.current, params = this.currentParams) {
      if (!Platform.isWebOS()) {
        return;
      }
      const route = String(routeName || "").trim();
      if (!this.isWebOsResumeRouteRestorable(route)) {
        LocalStore.remove(WEBOS_RESUME_ROUTE_KEY);
        return;
      }
      try {
        LocalStore.set(WEBOS_RESUME_ROUTE_KEY, {
          route,
          params: params || {},
          savedAt: Date.now()
        });
      } catch (error) {
        console.warn("Failed to persist webOS resume route", error);
      }
    },
    consumeWebOsResumeRoute() {
      if (!Platform.isWebOS()) {
        return null;
      }
      const snapshot = LocalStore.get(WEBOS_RESUME_ROUTE_KEY, null);
      if (!snapshot || typeof snapshot !== "object") {
        return null;
      }
      const route = String(snapshot.route || "").trim();
      const savedAt = Number(snapshot.savedAt || 0);
      if (
        !route ||
        !this.isWebOsResumeRouteRestorable(route) ||
        !Number.isFinite(savedAt) ||
        Date.now() - savedAt > WEBOS_RESUME_ROUTE_TTL_MS
      ) {
        LocalStore.remove(WEBOS_RESUME_ROUTE_KEY);
        return null;
      }
      return {
        route,
        params: snapshot.params && typeof snapshot.params === "object" ? snapshot.params : {}
      };
    },
    async navigate(routeName, params = {}, options = {}) {
      if (routeName === "detail" && params?.itemType === "collection") {
        const ref = String(params.itemId || "").match(/^server:([^:]+):([^:]+)$/);
        if (ref) {
          try {
            routeName = "catalogSeeAll";
            params = {
              addonBaseUrl: `nuvio-server://${decodeURIComponent(ref[1])}`,
              catalogId: `collection-${decodeURIComponent(ref[2])}`,
              type: "mixed",
              catalogName: params.fallbackTitle || params.itemTitle || "",
              addonName: params.addonName || "",
              supportsSkip: true
            };
          } catch (_) {
            return;
          }
        }
      }
      if (routeName === "plugins" && Platform.isTizen() && !TizenCapabilities.canUsePlugins()) {
        return;
      }
      const navigationStart = ROUTER_PERF_DEBUG ? routerPerfNow() : 0;

      const fromHistory = Boolean(options?.fromHistory);
      const skipStackPush = Boolean(options?.skipStackPush);
      const replaceHistory = Boolean(options?.replaceHistory);
      const targetParams = params || {};
      const routeReturnBackGuardNavigationId = this.beginRouteReturnBackGuard(options?.isBackNavigation);

      const Screen = this.routes[routeName];

      if (!Screen) {
        console.error("Route not found:", routeName);
        return;
      }

      const bootGuard = globalThis.NuvioBootGuard;
      if (bootGuard && typeof bootGuard.stage === "function") {
        bootGuard.stage(`Opening ${routeName} screen`);
      }

      // Cleanup current
      const previousRoute = this.current;
      const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
      if (this.current && this.current !== routeName) {
        this.captureCurrentRouteState();
        this.routes[this.current].cleanup?.();
        if (!shouldSkipPush) {
          this.stack.push({
            route: this.current,
            params: this.currentParams || {}
          });
        }
      } else if (this.current === routeName) {
        this.captureCurrentRouteState();
        this.routes[this.current].cleanup?.();
      }

      // Android recreates Search when entering profile selection; keep only same-session snapshots.
      if (routeName === "profileSelection" && String(targetParams.mode || "selection").toLowerCase() !== "management") {
        RouteStateStore.clear("route:search");
      }

      this.current = routeName;
      this.currentParams = targetParams;
      const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, {
        ...options,
        previousRoute
      });

      this.pendingMountParams = targetParams;
      try {
        await Screen.mount(this.currentParams, navigationContext);
      } finally {
        if (this.pendingMountParams === targetParams) this.pendingMountParams = null;
      }
      this.completeRouteReturnBackGuard(routeReturnBackGuardNavigationId);
      logRouterPerf("navigate", {
        ms: Number((routerPerfNow() - navigationStart).toFixed(2)),
        route: routeName,
        previousRoute,
        fromHistory,
        skipStackPush,
        replaceHistory
      });

      // If another navigation happened while this screen was mounting, this
      // navigation is stale and must not write an extra history entry.
      if (this.current !== routeName || this.currentParams !== targetParams) {
        return;
      }

      if (bootGuard && typeof bootGuard.ready === "function") {
        bootGuard.ready();
      }

      if (window?.history && typeof window.history.pushState === "function") {
        const state = {
          route: this.current,
          params: this.currentParams,
          previousRoute: previousRoute || null
        };
        if (!this.historyInitialized) {
          window.history.replaceState(state, "");
          this.historyInitialized = true;
        } else if (!fromHistory) {
          if (replaceHistory || NON_BACKSTACK_ROUTES.has(previousRoute)) {
            window.history.replaceState(state, "");
          } else {
            window.history.pushState(state, "");
          }
        }
        // webOS handles the remote Back button through the History API by
        // default. Keep one Home entry available so overlays can consume Back
        // before the platform treats it as a request to exit the app.
        if (Platform.isWebOS() && (this.current === "home" || this.current === "profileSelection") && !this.webOsHomeBackGuardInitialized) {
          window.history.pushState(state, "");
          this.webOsHomeBackGuardInitialized = true;
        }
      }
      this.persistWebOsResumeRoute(this.current, this.currentParams);
      // A title deep link from a webOS launch opens here, once navigation is past startup (sign-in, profiles, setup).
      await openPendingLaunchDeepLink(this, NON_BACKSTACK_ROUTES);
    },
    navigateFromPostPlayRecommendation(routeName, params = {}, options = {}) {
      const targetRoute = String(routeName || "").trim();
      if (!targetRoute || !this.routes[targetRoute]) {
        return false;
      }

      // Android removes the current Player and, when Player was opened from a
      // Stream destination, removes that Stream destination as the pop-up root
      // before pushing the recommendation Detail. The Router keeps the current
      // route out of `stack`, so compact both the logical stack and browser
      // history before mounting the new route.
      if (this.current !== "player") {
        void this.navigate(targetRoute, params, options);
        return true;
      }

      const topStackIndex = this.stack.length - 1;
      const topStackRoute = getStackEntryRoute(this.stack[topStackIndex]);
      const removesStreamRoot = topStackRoute === "stream";
      const historySteps = topStackRoute ? (removesStreamRoot ? 2 : 1) : 0;
      if (removesStreamRoot) {
        this.stack.pop();
      }

      const navigateOptions = {
        ...options,
        skipStackPush: true,
        replaceHistory: true
      };

      if (
        historySteps > 0 &&
        this.historyInitialized &&
        window?.history &&
        typeof window.history.go === "function" &&
        String(window.history.state?.route || "") === "player"
      ) {
        this.pendingPostPlayNavigation = {
          route: targetRoute,
          params: params && typeof params === "object" ? params : {},
          // We are already positioned on the retained stack root after
          // history.go(); a normal pushState creates the new Detail entry and
          // truncates the obsolete Player/Stream forward entries.
          options: { ...navigateOptions, replaceHistory: false },
          sourceRoute: "player",
          expectedRoute: getStackEntryRoute(this.stack[this.stack.length - 1]),
          requestedAt: Date.now()
        };
        try {
          window.history.go(-historySteps);
          return true;
        } catch (error) {
          this.pendingPostPlayNavigation = null;
          console.warn("Failed to compact post-play browser history", error);
        }
      }

      void this.navigate(targetRoute, params, navigateOptions);
      return true;
    },
    async consumePendingPostPlayNavigation(state = null) {
      const pending = this.pendingPostPlayNavigation;
      if (!pending) {
        return false;
      }
      this.pendingPostPlayNavigation = null;
      if (this.current !== pending.sourceRoute) {
        return false;
      }

      // A successful traversal lands on the route immediately before the
      // Android pop-up root. Do not mount that intermediate route: push the
      // recommendation directly, which truncates the old forward entries.
      if (pending.expectedRoute && String(state?.route || "") && String(state.route) !== pending.expectedRoute) {
        console.warn("Post-play history target differed from the logical stack", {
          expected: pending.expectedRoute,
          actual: state.route
        });
      }
      await this.navigate(pending.route, pending.params, pending.options);
      return true;
    },
    async backFromPendingNavigation() {
      // The current history entry still represents the caller until mount completes.
      // Restore that entry in place so a fast Back neither skips it nor records a stale route.
      const historyState = window?.history?.state || null;
      const targetRoute = String(historyState?.route || "");

      if (targetRoute && this.routes[targetRoute]) {
        const previous = this.stack[this.stack.length - 1];
        const previousRoute = typeof previous === "string" ? previous : previous?.route;
        if (previousRoute === targetRoute) {
          this.stack.pop();
        }
        await this.navigate(targetRoute, historyState.params || {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true
        });
        return;
      }

      await this.back({ skipConsume: true, skipHistory: true });
    }
  };
}
