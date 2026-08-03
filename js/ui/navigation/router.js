import { HomeScreen } from "../screens/home/homeScreen.js";
import { PlayerScreen } from "../screens/player/playerScreen.js";
import { AccountScreen } from "../screens/account/accountScreen.js";
import { AuthQrSignInScreen } from "../screens/account/authQrSignInScreen.js";
import { AuthSignInScreen } from "../screens/account/authSignInScreen.js";
import { SyncCodeScreen } from "../screens/account/syncCodeScreen.js";
import { ProfileSelectionScreen } from "../../core/profile/profileSelectionScreen.js";
import { MetaDetailsScreen } from "../screens/detail/metaDetailsScreen.js";
import { LibraryScreen } from "../screens/library/libraryScreen.js";
import { SearchScreen } from "../screens/search/searchScreen.js";
import { DiscoverScreen } from "../screens/search/discoverScreen.js";
import { SettingsScreen } from "../screens/settings/settingsScreen.js";
import { ConsoleDebugScreen } from "../screens/debug/consoleDebugScreen.js";
import { TraktScreen } from "../screens/trakt/traktScreen.js";
import { SupportersContributorsScreen } from "../screens/supporters/supportersContributorsScreen.js";
import { PluginScreen } from "../screens/plugin/pluginScreen.js";
import { PluginsScreen } from "../screens/plugin/pluginsScreen.js";
import { CatalogOrderScreen } from "../screens/plugin/catalogOrderScreen.js";
import { StreamScreen } from "../screens/stream/streamScreen.js";
import { CastDetailScreen } from "../screens/cast/castDetailScreen.js";
import { CatalogSeeAllScreen } from "../screens/catalog/catalogSeeAllScreen.js";
import { FolderDetailScreen } from "../screens/collection/folderDetailScreen.js";
import { Platform } from "../../platform/index.js";
import { RouteStateStore } from "./routeStateStore.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { createPerfLogger } from "../../core/diagnostics/perfLog.js";

const routerPerf = createPerfLogger("router");

const NON_BACKSTACK_ROUTES = new Set([
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "syncCode"
]);
const WEBOS_RESUME_ROUTE_KEY = "webos_last_resume_route";
const WEBOS_RESUME_ROUTE_TTL_MS = 20 * 60 * 1000;
const TIZEN_ROUTE_RETURN_BACK_GUARD_MS = 700;
const WEBOS_NON_RESTORABLE_ROUTES = new Set([
  ...NON_BACKSTACK_ROUTES,
  "debugConsole",
  "player",
  "stream"
]);

export const Router = {
  current: null,
  currentParams: {},
  stack: [],
  historyInitialized: false,
  webOsHomeBackGuardInitialized: false,
  popstateBound: false,
  suppressPopstateUntil: 0,
  skipConsumeNextPopstate: false,
  ignoreNextPopstate: false,
  routeReturnBackGuardActive: false,
  routeReturnBackGuardUntil: 0,
  routeReturnBackGuardNavigationId: 0,

  routes: {
    home: HomeScreen,
    player: PlayerScreen,
    account: AccountScreen,
    authQrSignIn: AuthQrSignInScreen,
    authSignIn: AuthSignInScreen,
    syncCode: SyncCodeScreen,
    profileSelection: ProfileSelectionScreen,
    detail: MetaDetailsScreen,
    library: LibraryScreen,
    search: SearchScreen,
    discover: DiscoverScreen,
    settings: SettingsScreen,
    debugConsole: ConsoleDebugScreen,
    trakt: TraktScreen,
    supportersContributors: SupportersContributorsScreen,
    plugin: PluginScreen,
    plugins: PluginsScreen,
    catalogOrder: CatalogOrderScreen,
    stream: StreamScreen,
    castDetail: CastDetailScreen,
    catalogSeeAll: CatalogSeeAllScreen,
    folderDetail: FolderDetailScreen
  },

  getRouteStateKey(routeName, params = {}) {
    const screen = this.routes[routeName];
    if (!screen?.getRouteStateKey) {
      return null;
    }
    try {
      return screen.getRouteStateKey(params || {});
    } catch (error) {
      console.warn("Failed to resolve route state key", routeName, error);
      return null;
    }
  },

  captureCurrentRouteState() {
    if (!this.current) {
      return;
    }
    const screen = this.routes[this.current];
    if (!screen?.captureRouteState) {
      return;
    }
    const key = this.getRouteStateKey(this.current, this.currentParams);
    if (!key) {
      return;
    }
    try {
      RouteStateStore.set(key, screen.captureRouteState());
    } catch (error) {
      console.warn("Failed to capture route state", this.current, error);
    }
  },

  resolveNavigationContext(routeName, params = {}, options = {}) {
    const screen = this.routes[routeName];
    const key = this.getRouteStateKey(routeName, params);
    const shouldClear = Boolean(screen?.clearRouteStateOnMount?.(params || {}));
    if (shouldClear && key) {
      RouteStateStore.clear(key);
    }
    return {
      restoredState: !shouldClear && key ? RouteStateStore.get(key) : null,
      routeStateKey: key,
      fromHistory: Boolean(options?.fromHistory),
      isBackNavigation: Boolean(options?.isBackNavigation)
    };
  },

  init() {
    if (this.popstateBound) {
      return;
    }
    this.popstateBound = true;
    window.addEventListener("popstate", async (event) => {
      if (this.ignoreNextPopstate) {
        this.ignoreNextPopstate = false;
        return;
      }
      if (Date.now() < Number(this.suppressPopstateUntil || 0)) {
        if (window?.history && typeof window.history.pushState === "function") {
          window.history.pushState({ route: this.current, params: this.currentParams }, "");
        }
        return;
      }
      const state = event?.state || null;
      if (this.consumeRouteReturnBackGuard()) {
        // A physical Tizen Back can also move browser history after its key
        // event has already completed an in-app route return. Keep that late
        // popstate on the restored screen instead of letting Home consume it
        // as a second Back and open the sidebar.
        if (window?.history && typeof window.history.pushState === "function") {
          window.history.pushState({ route: this.current, params: this.currentParams }, "");
        }
        return;
      }
      if (Platform.isTizen() && this.current === "home" && state?.route === "home") {
        // A native history event can arrive after the timed route-return guard
        // has expired. Home is already restored, so forwarding this redundant
        // transition would make Home consume it as another Back and open the
        // sidebar.
        return;
      }
      const shouldSkipConsume = Boolean(this.skipConsumeNextPopstate);
      this.skipConsumeNextPopstate = false;
      const currentScreen = this.getCurrentScreen();
      const shouldLetPlayerReturnToStream =
        this.current === "player" &&
        state?.route === "stream" &&
        currentScreen?.shouldReturnToStreamOnBack?.() !== false &&
        !currentScreen?.hasBackDismissableOverlay?.();
      const consumeResult =
        !shouldSkipConsume && !shouldLetPlayerReturnToStream
          ? currentScreen?.consumeBackRequest?.()
          : false;
      if (consumeResult) {
        if (
          consumeResult !== "history" &&
          window?.history &&
          typeof window.history.pushState === "function"
        ) {
          window.history.pushState({ route: this.current, params: this.currentParams }, "");
        }
        return;
      }
      if (this.current === "home" && (!state?.route || NON_BACKSTACK_ROUTES.has(state.route))) {
        Platform.exitApp();
        return;
      }
      if (state?.route && this.routes[state.route]) {
        await this.navigate(state.route, state.params || {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true
        });
        return;
      }
      if (this.current && this.current !== "home" && this.routes.home) {
        await this.navigate(
          "home",
          {},
          {
            fromHistory: true,
            skipStackPush: true,
            isBackNavigation: true
          }
        );
      }
    });
  },

  suppressNextPopstate(durationMs = 700) {
    this.suppressPopstateUntil = Math.max(
      Number(this.suppressPopstateUntil || 0),
      Date.now() + Math.max(0, Number(durationMs || 0))
    );
  },

  ignoreSinglePopstate() {
    this.ignoreNextPopstate = true;
  },

  beginRouteReturnBackGuard(isBackNavigation = false) {
    this.routeReturnBackGuardNavigationId += 1;
    const navigationId = this.routeReturnBackGuardNavigationId;
    const shouldGuard = Platform.isTizen() && Boolean(isBackNavigation);
    this.routeReturnBackGuardActive = shouldGuard;
    this.routeReturnBackGuardUntil = shouldGuard ? Number.POSITIVE_INFINITY : 0;
    return navigationId;
  },

  completeRouteReturnBackGuard(navigationId) {
    if (
      navigationId !== this.routeReturnBackGuardNavigationId ||
      !this.routeReturnBackGuardActive
    ) {
      return;
    }
    this.routeReturnBackGuardUntil = Date.now() + TIZEN_ROUTE_RETURN_BACK_GUARD_MS;
  },

  consumeRouteReturnBackGuard() {
    if (
      !this.routeReturnBackGuardActive ||
      Date.now() >= Number(this.routeReturnBackGuardUntil || 0)
    ) {
      this.routeReturnBackGuardActive = false;
      this.routeReturnBackGuardUntil = 0;
      return false;
    }
    // Treat this as a short guard window, not a one-shot flag. Samsung can
    // report one physical Back through more than one key/history event; all
    // copies that reach the newly restored route must be consumed.
    return true;
  },

  persistWebOsResumeRoute(routeName = this.current, params = this.currentParams) {
    if (!Platform.isWebOS()) {
      return;
    }
    const route = String(routeName || "").trim();
    if (!route || !this.routes[route] || WEBOS_NON_RESTORABLE_ROUTES.has(route)) {
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
      !this.routes[route] ||
      WEBOS_NON_RESTORABLE_ROUTES.has(route) ||
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
    const endNavigate = routerPerf.span("navigate");

    const fromHistory = Boolean(options?.fromHistory);
    const skipStackPush = Boolean(options?.skipStackPush);
    const replaceHistory = Boolean(options?.replaceHistory);
    const targetParams = params || {};
    const routeReturnBackGuardNavigationId = this.beginRouteReturnBackGuard(
      options?.isBackNavigation
    );

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
    const endCleanup = routerPerf.span("navigate:cleanupPrevious");
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

    endCleanup({ route: routeName, previousRoute });

    this.current = routeName;
    this.currentParams = targetParams;
    const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, options);

    const endMount = routerPerf.span("navigate:mount");
    await Screen.mount(this.currentParams, navigationContext);
    endMount({ route: routeName });
    this.completeRouteReturnBackGuard(routeReturnBackGuardNavigationId);
    endNavigate({
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
      const state = { route: this.current, params: this.currentParams };
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
      if (
        Platform.isWebOS() &&
        (this.current === "home" || this.current === "profileSelection") &&
        !this.webOsHomeBackGuardInitialized
      ) {
        window.history.pushState(state, "");
        this.webOsHomeBackGuardInitialized = true;
      }
    }
    this.persistWebOsResumeRoute(this.current, this.currentParams);
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
  },

  async back(options = {}) {
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

    if (
      !options?.skipHistory &&
      window?.history &&
      typeof window.history.back === "function" &&
      this.historyInitialized
    ) {
      if (options?.skipConsume) {
        this.skipConsumeNextPopstate = true;
      }
      window.history.back();
      return;
    }

    if (this.stack.length === 0) {
      if (this.current && this.current !== "home" && this.routes.home) {
        this.routes[this.current].cleanup?.();
        this.current = "home";
        this.currentParams = {};
        await this.routes.home.mount();
        this.persistWebOsResumeRoute("home", {});
        return;
      }

      Platform.exitApp();
      return;
    }

    const previous = this.stack.pop();
    const previousRoute = typeof previous === "string" ? previous : previous?.route;
    const previousParams = typeof previous === "string" ? {} : previous?.params || {};

    if (!previousRoute || !this.routes[previousRoute]) {
      return;
    }

    this.captureCurrentRouteState();
    this.routes[this.current].cleanup?.();
    this.current = previousRoute;
    this.currentParams = previousParams;
    const navigationContext = this.resolveNavigationContext(previousRoute, previousParams, {
      isBackNavigation: true
    });

    await this.routes[previousRoute].mount(previousParams, navigationContext);
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
