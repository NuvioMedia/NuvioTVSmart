import { HomeScreen } from "../screens/home/homeScreen.js";
import { PlayerScreen } from "../screens/player/playerScreen.js";
import { AccountScreen } from "../screens/account/accountScreen.js";
import { AuthQrSignInScreen } from "../screens/account/authQrSignInScreen.js";
import { AuthSignInScreen } from "../screens/account/authSignInScreen.js";
import { ServerConnectionScreen } from "../screens/account/serverConnectionScreen.js";
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
import { ExperienceModeSelectionScreen } from "../screens/onboarding/experienceModeSelectionScreen.js";
import { EssentialAddonSetupScreen } from "../screens/onboarding/essentialAddonSetupScreen.js";
import { LicensesAttributionsScreen } from "../screens/settings/licensesAttributionsScreen.js";
import { PluginScreen } from "../screens/plugin/pluginScreen.js";
import { PluginsScreen } from "../screens/plugin/pluginsScreen.js";
import { CatalogOrderScreen } from "../screens/plugin/catalogOrderScreen.js";
import { StreamScreen } from "../screens/stream/streamScreen.js";
import { CastDetailScreen } from "../screens/cast/castDetailScreen.js";
import { CatalogSeeAllScreen } from "../screens/catalog/catalogSeeAllScreen.js";
import { TmdbEntityBrowseScreen } from "../screens/tmdb/tmdbEntityBrowseScreen.js";
import { FolderDetailScreen } from "../screens/collection/folderDetailScreen.js";
import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { RouteStateStore } from "./routeStateStore.js";
import { LocalStore } from "../../core/storage/localStore.js";

const ROUTER_PERF_DEBUG = Boolean(
  globalThis.__NUVIO_DEBUG_ROUTER_PERF__ || globalThis.__NUVIO_DEBUG_HOME_PERF__
);

function routerPerfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logRouterPerf(stage, data = {}) {
  if (!ROUTER_PERF_DEBUG) {
    return;
  }
  try {
    console.info(`[router-perf] ${stage}`, data);
  } catch (_) {}
}

const NON_BACKSTACK_ROUTES = new Set([
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "serverConnection",
  "syncCode",
  "experienceModeSelection",
  "essentialAddonSetup"
]);
const WEBOS_RESUME_ROUTE_KEY = "webos_last_resume_route";
const WEBOS_RESUME_ROUTE_TTL_MS = 20 * 60 * 1000;
const TIZEN_ROUTE_RETURN_BACK_GUARD_MS = 700;
const WEBOS_NON_RESTORABLE_ROUTES = new Set([
  ...NON_BACKSTACK_ROUTES,
  "debugConsole",
  "plugin",
  "plugins",
  "catalogOrder",
  "detail",
  "player",
  "stream"
]);

function getStackEntryRoute(entry) {
  return typeof entry === "string" ? entry : String(entry?.route || "");
}

function getStackEntryParams(entry) {
  return typeof entry === "string" ? {} : entry?.params || {};
}

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
  pendingHistoryReturn: null,
  pendingPostPlayNavigation: null,

  routes: {
    home: HomeScreen,
    player: PlayerScreen,
    account: AccountScreen,
    authQrSignIn: AuthQrSignInScreen,
    authSignIn: AuthSignInScreen,
    serverConnection: ServerConnectionScreen,
    syncCode: SyncCodeScreen,
    profileSelection: ProfileSelectionScreen,
    experienceModeSelection: ExperienceModeSelectionScreen,
    essentialAddonSetup: EssentialAddonSetupScreen,
    detail: MetaDetailsScreen,
    library: LibraryScreen,
    search: SearchScreen,
    discover: DiscoverScreen,
    settings: SettingsScreen,
    debugConsole: ConsoleDebugScreen,
    trakt: TraktScreen,
    supportersContributors: SupportersContributorsScreen,
    licensesAttributions: LicensesAttributionsScreen,
    plugin: PluginScreen,
    plugins: PluginsScreen,
    catalogOrder: CatalogOrderScreen,
    stream: StreamScreen,
    castDetail: CastDetailScreen,
    catalogSeeAll: CatalogSeeAllScreen,
    tmdbEntityBrowse: TmdbEntityBrowseScreen,
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
      isBackNavigation: Boolean(options?.isBackNavigation),
      previousRoute: String(options?.previousRoute || "")
    };
  },

  async consumePendingHistoryReturn(state = null) {
    const pending = this.pendingHistoryReturn;
    if (!pending) {
      return false;
    }

    this.pendingHistoryReturn = null;
    // This history traversal is the transition we explicitly requested. Any
    // stale one-shot/timed suppression belongs to a previous event and must not
    // swallow the route that Android would have revealed with popBackStack().
    this.ignoreNextPopstate = false;
    this.suppressPopstateUntil = 0;

    const targetStackIndex = Number.isInteger(pending.targetStackIndex)
      ? pending.targetStackIndex
      : this.stack.length - 1;
    const stackEntry = this.stack[targetStackIndex];
    const stackMatches =
      this.stack.length === Number(pending.stackLength) &&
      targetStackIndex >= 0 &&
      getStackEntryRoute(stackEntry) === pending.route &&
      (!pending.stackEntry || stackEntry === pending.stackEntry);
    const routeMatches = state?.route === pending.route;
    const sourceMatches = this.current === pending.sourceRoute;

    if (sourceMatches && stackMatches && routeMatches) {
      this.stack.splice(targetStackIndex);
      const targetParams =
        state?.params && typeof state.params === "object"
          ? state.params
          : getStackEntryParams(stackEntry) || pending.params;
      await this.navigate(pending.route, targetParams, {
        fromHistory: true,
        skipStackPush: true,
        isBackNavigation: true
      });
      return true;
    }

    if (sourceMatches && stackMatches && !state?.route) {
      // A few TV browser builds can emit a null state when the app reaches the
      // first history entry. Keep the requested Android destination instead of
      // allowing the generic no-state path to jump to Home.
      this.stack.splice(targetStackIndex);
      await this.navigate(pending.route, getStackEntryParams(stackEntry) || pending.params, {
        skipStackPush: true,
        replaceHistory: true,
        isBackNavigation: true
      });
      return true;
    }

    if (sourceMatches) {
      // The browser has still completed the one Back traversal, but the route
      // stack changed before its popstate arrived. Let the browser state be
      // authoritative while preventing the old screen from consuming the
      // same event as a second Back request.
      this.skipConsumeNextPopstate = true;
    }
    return false;
  },

  restoreCurrentHistoryState(previousState = null) {
    if (!window?.history) {
      return;
    }
    const hasPreviousRouteMetadata = Object.prototype.hasOwnProperty.call(
      previousState || {},
      "previousRoute"
    );
    const currentState = {
      route: this.current,
      params: this.currentParams,
      previousRoute: hasPreviousRouteMetadata
        ? previousState.previousRoute || null
        : previousState?.route === this.current
          ? null
          : previousState?.route || null
    };
    if (
      previousState?.route === currentState.route &&
      typeof window.history.replaceState === "function"
    ) {
      // The browser already points at this route. Replace only the params so a
      // duplicate popstate does not append another identical history entry.
      window.history.replaceState(currentState, "");
      return;
    }
    if (typeof window.history.pushState === "function") {
      // A real late Back moved to an older route. Push the restored current
      // route so the older entry remains reachable on the next Back.
      window.history.pushState(currentState, "");
    }
  },

  init() {
    if (this.popstateBound) {
      return;
    }
    this.popstateBound = true;
    window.addEventListener("popstate", async (event) => {
      const state = event?.state || null;
      if (await this.consumePendingHistoryReturn(state)) {
        return;
      }
      if (await this.consumePendingPostPlayNavigation(state)) {
        return;
      }
      if (this.ignoreNextPopstate) {
        this.ignoreNextPopstate = false;
        return;
      }
      if (Date.now() < Number(this.suppressPopstateUntil || 0)) {
        this.restoreCurrentHistoryState(state);
        return;
      }
      if (this.consumeRouteReturnBackGuard()) {
        // A physical Tizen Back can also move browser history after its key
        // event has already completed an in-app route return. Keep that late
        // popstate on the restored screen instead of letting Home consume it
        // as a second Back and open the sidebar.
        this.restoreCurrentHistoryState(state);
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
        if (consumeResult !== "history") {
          this.restoreCurrentHistoryState(state);
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

  popToExistingRoute(routeName, fallbackParams = {}, options = {}) {
    const targetRoute = String(routeName || "").trim();
    if (!targetRoute || !this.routes[targetRoute] || this.current === targetRoute) {
      return false;
    }

    const allowSingleIntermediateRoute = Boolean(options?.allowSingleIntermediateRoute);

    if (this.pendingHistoryReturn) {
      return this.pendingHistoryReturn.route === targetRoute;
    }

    if (!this.historyInitialized || !window?.history) {
      return false;
    }

    const currentHistoryRoute = String(window.history.state?.route || "");
    if (currentHistoryRoute && currentHistoryRoute !== this.current) {
      // The current route is still mounting and has not written its browser
      // entry yet. Traversing history here would pop the caller's route instead
      // of the Player/Stream entry; let the conservative replacement path
      // finish the pending navigation first.
      return false;
    }

    const topStackIndex = this.stack.length - 1;
    const topStackRoute = getStackEntryRoute(this.stack[topStackIndex]);
    const targetStackIndex =
      topStackRoute === targetRoute
        ? topStackIndex
        : allowSingleIntermediateRoute && topStackIndex > 0
          ? topStackIndex - 1
          : -1;
    if (targetStackIndex < 0) {
      return false;
    }

    const stackEntry = this.stack[targetStackIndex];
    if (getStackEntryRoute(stackEntry) !== targetRoute) {
      return false;
    }

    if (allowSingleIntermediateRoute && targetRoute === "detail") {
      const targetItemId = String(fallbackParams?.itemId || "").trim();
      const targetItemType = String(fallbackParams?.itemType || "")
        .trim()
        .toLowerCase();
      const stackParams = getStackEntryParams(stackEntry);
      const stackItemId = String(stackParams?.itemId || "").trim();
      const stackItemType = String(stackParams?.itemType || "")
        .trim()
        .toLowerCase();
      if (
        (targetItemId && stackItemId !== targetItemId) ||
        (targetItemType && stackItemType && stackItemType !== targetItemType)
      ) {
        return false;
      }
    }

    const historySteps = this.stack.length - targetStackIndex;
    if (historySteps > 1 && !allowSingleIntermediateRoute) {
      return false;
    }
    if (
      (historySteps === 1 && typeof window.history.back !== "function") ||
      (historySteps > 1 && typeof window.history.go !== "function")
    ) {
      return false;
    }

    const previousHistoryRoute = String(window.history.state?.previousRoute || "");
    const expectedPreviousRoute = historySteps === 1 ? targetRoute : topStackRoute;
    if (previousHistoryRoute && previousHistoryRoute !== expectedPreviousRoute) {
      // The explicit history predecessor prevents treating a stale stack entry
      // as the Android destination. For the natural-end path, one Sources
      // entry may sit between Player and the existing Detail.
      return false;
    }

    this.pendingHistoryReturn = {
      route: targetRoute,
      params: fallbackParams && typeof fallbackParams === "object" ? fallbackParams : {},
      sourceRoute: this.current,
      stackLength: this.stack.length,
      stackEntry,
      targetStackIndex,
      requestedAt: Date.now()
    };

    try {
      if (historySteps === 1) {
        window.history.back();
      } else {
        window.history.go(-historySteps);
      }
      return true;
    } catch (error) {
      this.pendingHistoryReturn = null;
      console.warn("Failed to return to existing route", targetRoute, error);
      return false;
    }
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
    if (routeName === "plugins" && Platform.isTizen() && !TizenCapabilities.canUsePlugins()) {
      return;
    }
    const navigationStart = ROUTER_PERF_DEBUG ? routerPerfNow() : 0;

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

    this.current = routeName;
    this.currentParams = targetParams;
    const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, {
      ...options,
      previousRoute
    });

    await Screen.mount(this.currentParams, navigationContext);
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
    if (
      pending.expectedRoute &&
      String(state?.route || "") &&
      String(state.route) !== pending.expectedRoute
    ) {
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
  },

  async back(options = {}) {
    if (this.pendingHistoryReturn || this.pendingPostPlayNavigation) {
      return;
    }

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
        const previousRoute = this.current;
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
    this.captureCurrentRouteState();
    this.routes[this.current].cleanup?.();
    this.current = previousRoute;
    this.currentParams = previousParams;
    const navigationContext = this.resolveNavigationContext(previousRoute, previousParams, {
      isBackNavigation: true,
      previousRoute: fromRoute
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
