import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// homeScreenMethods-04 reaches the whole app through homeScreenContext, so the
// real method is evaluated against stubs the way the other home tests do it.
const source = (
  await readFile(new URL("./homeScreenMethods-04-get-hero-focus-delay.js", import.meta.url), "utf8")
)
  .replace(/^import [\s\S]*?";$/m, "")
  .replace(/^import [^;]+;$/gm, "")
  .replace(/^export /gm, "");

function emptyCalls() {
  return { signature: 0, retry: 0, continueWatching: 0, catalogs: 0 };
}

function buildScreen({ settleMs = 20 } = {}) {
  const calls = emptyCalls();
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    internals: {
      Router: { getCurrent: () => "home" },
      addonRepository: {},
      CollectionsStore: {},
      ProfileManager: {},
      StartupSyncService: {},
      ProfileSettingsSyncService: {},
      watchProgressRepository: {},
      watchedItemsRepository: {},
      LayoutPreferences: {},
      HomeCatalogStore: {},
      getSidebarProfileState: async () => null,
      buildSidebarProfileSignature: () => "",
      getContinueWatchingNextUpSeedOptions: () => ({}),
      buildCatalogOrderKey: () => "",
      catalogShouldShowOnHome: () => true,
      catalogSkipStep: () => 1,
      catalogSupportsExtra: () => false,
      MODERN_HOME_CONSTANTS: {},
      CW_MAX_VISIBLE_ITEMS: 1,
      HERO_ROTATE_FIRST_DELAY_MS: 1,
      HERO_ROTATE_INTERVAL_MS: 1,
      HOME_CATALOG_REFRESH_TTL_MS: 1,
      HOME_ROUTE_RETURN_SETTLE_MS: settleMs,
      HOME_STABLE_GATE_TIMEOUT_MS: 1,
      logHomePerf: () => {},
      homePerfNow: () => 0,
      preloadHeroAssets: () => Promise.resolve(),
      buildHeroIdentity: () => "",
      I18n: {}
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createHomeScreenMethods04();`, context);

  const screen = Object.assign(Object.create(context.api), {
    homeLoadToken: 7,
    loadedHomeRouteInputSignature: "sig",
    sidebarProfile: null,
    buildHomeRouteInputSignature() {
      calls.signature += 1;
      return "sig";
    },
    retryPendingCatalogRows() {
      calls.retry += 1;
    },
    refreshHomeContinueWatchingAfterSync() {
      calls.continueWatching += 1;
      return Promise.resolve(false);
    },
    refreshHomeCatalogsIfStale() {
      calls.catalogs += 1;
      return Promise.resolve(false);
    },
    requestHomeBackgroundRefresh() {
      throw new Error("an unchanged route input must not rebuild the screen");
    }
  });
  return { screen, calls };
}

test("a route return leaves the settle window to focus restoration", async () => {
  const { screen, calls } = buildScreen();
  const pending = screen.refreshHomeAfterRouteReturn();

  assert.deepEqual(calls, emptyCalls(), "no work starts in the mount frame");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, emptyCalls(), "no work starts before the settle window expires");

  await pending;

  assert.equal(calls.signature, 1);
  assert.equal(calls.retry, 1);
  assert.equal(calls.continueWatching, 1);
  assert.equal(calls.catalogs, 1);
  assert.equal(screen.homeRouteReturnRefreshTimer, null, "the timer is not left behind");
});

test("a newer Home token drops the refresh scheduled by the previous mount", async () => {
  const { screen, calls } = buildScreen();
  const pending = screen.refreshHomeAfterRouteReturn();

  screen.homeLoadToken += 1;

  assert.equal(await pending, false);
  assert.deepEqual(calls, emptyCalls());
  assert.equal(screen.homeRouteReturnRefreshTimer, null);
});

test("a second route return replaces the pending settle timer", async () => {
  const { screen, calls } = buildScreen();
  screen.refreshHomeAfterRouteReturn();
  const pending = screen.refreshHomeAfterRouteReturn();

  await pending;

  assert.equal(calls.signature, 1, "the replaced return must not refresh twice");
  assert.equal(calls.continueWatching, 1);
  assert.equal(calls.catalogs, 1);
});
