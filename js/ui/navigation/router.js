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
import { PartyScreen } from "../screens/party/partyScreen.js";
import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { RouteStateStore } from "./routeStateStore.js";
import { Router } from "./routerState.js";
import { LocalStore } from "../../core/storage/localStore.js";

import { createRouterMethods01 } from "./routerMethods-01-get-route-state-key.js";
import { createRouterMethods02 } from "./routerMethods-02-complete-route-return-back-guard.js";
import { createRouterMethods03 } from "./routerMethods-03-back.js";
import { openPendingLaunchDeepLink } from "../../core/deeplink/launchDeepLink.js";

export {
  Router,
  HomeScreen,
  PlayerScreen,
  AccountScreen,
  AuthQrSignInScreen,
  AuthSignInScreen,
  ServerConnectionScreen,
  SyncCodeScreen,
  ProfileSelectionScreen,
  MetaDetailsScreen,
  LibraryScreen,
  SearchScreen,
  DiscoverScreen,
  SettingsScreen,
  ConsoleDebugScreen,
  TraktScreen,
  SupportersContributorsScreen,
  ExperienceModeSelectionScreen,
  EssentialAddonSetupScreen,
  LicensesAttributionsScreen,
  PluginScreen,
  PluginsScreen,
  CatalogOrderScreen,
  StreamScreen,
  CastDetailScreen,
  CatalogSeeAllScreen,
  TmdbEntityBrowseScreen,
  FolderDetailScreen,
  PartyScreen,
  Platform,
  TizenCapabilities,
  RouteStateStore,
  LocalStore,
  ROUTER_PERF_DEBUG,
  routerPerfNow,
  logRouterPerf,
  NON_BACKSTACK_ROUTES,
  openPendingLaunchDeepLink,
  WEBOS_RESUME_ROUTE_KEY,
  WEBOS_RESUME_ROUTE_TTL_MS,
  TIZEN_ROUTE_RETURN_BACK_GUARD_MS,
  WEBOS_NON_RESTORABLE_ROUTES,
  getStackEntryRoute,
  getStackEntryParams,
  resolvePendingHistoryReturnParams
};
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
  "stream",
  "watchParty"
]);

function getStackEntryRoute(entry) {
  return typeof entry === "string" ? entry : String(entry?.route || "");
}

function getStackEntryParams(entry) {
  return typeof entry === "string" ? {} : entry?.params || {};
}

function resolvePendingHistoryReturnParams(pending, state, stackEntry) {
  const stackParams = getStackEntryParams(stackEntry);
  const historyParams = state?.params && typeof state.params === "object" ? state.params : {};
  const pendingParams = pending?.params && typeof pending.params === "object" ? pending.params : {};

  // The pending params come from the live source route (for example the
  // player's current resume position). Browser history can still contain the
  // older params captured when that route was originally opened, so preserve
  // its untouched fields but let the explicit return params win.
  return {
    ...(stackParams && typeof stackParams === "object" ? stackParams : {}),
    ...historyParams,
    ...pendingParams
  };
}

Object.assign(Router, {
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
    folderDetail: FolderDetailScreen,
    watchParty: PartyScreen
  },
  ...createRouterMethods01(),
  ...createRouterMethods02(),
  ...createRouterMethods03()
});
