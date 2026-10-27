import test from "node:test";
import assert from "node:assert/strict";
import { parseTitleDeepLink } from "../js/core/deeplink/deepLinkParser.js";
import {
  hasPendingLaunchDeepLink,
  openPendingLaunchDeepLink,
  readWebOsLaunchDeepLink,
  resetLaunchDeepLinkForTests,
  takeWebOsLaunchDeepLink
} from "../js/core/deeplink/launchDeepLink.js";

// The router's NON_BACKSTACK_ROUTES (js/ui/navigation/router.js): sign-in, profiles and setup.
const STARTUP_ROUTES = new Set([
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "serverConnection",
  "syncCode",
  "experienceModeSelection",
  "essentialAddonSetup"
]);

function launch(params) {
  globalThis.webOSSystem = { launchParams: params };
}

function fakeRouter(current) {
  return {
    current,
    opened: [],
    getCurrent() {
      return this.current;
    },
    async navigate(route, params, options) {
      this.opened.push(options === undefined ? [route, params] : [route, params, options]);
      this.current = route;
      this.currentParams = params;
    }
  };
}

test.beforeEach(() => {
  resetLaunchDeepLinkForTests();
  delete globalThis.webOSSystem;
  delete globalThis.PalmSystem;
});

// The title cases of the Android TV app's DeepLinkParserTest, plus the other forms its parser accepts.
test("title deep links match Android TV", () => {
  assert.deepEqual(parseTitleDeepLink("nuvio://meta?type=series&id=tt0944947"), {
    type: "series",
    id: "tt0944947"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://series/tt0944947"), {
    type: "series",
    id: "tt0944947"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://imdb/series/tt0944947"), {
    type: "series",
    id: "tt0944947"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://tmdb/tv/1399"), { type: "series", id: "tmdb:1399" });
  assert.deepEqual(parseTitleDeepLink("nuvio://tmdb/movie/603"), { type: "movie", id: "tmdb:603" });
  assert.deepEqual(parseTitleDeepLink("nuvio://tmdb/603?type=movie"), {
    type: "movie",
    id: "tmdb:603"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://detail/movie/tt0133093"), {
    type: "movie",
    id: "tt0133093"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://meta?type=movie&tmdb=603"), {
    type: "movie",
    id: "tmdb:603"
  });
});

test("links that aren't titles, and malformed ones, are left alone", () => {
  assert.equal(parseTitleDeepLink("nuvio://auth/trakt?code=abc"), null);
  assert.equal(parseTitleDeepLink("stremio://detail/series/tt0944947"), null);
  assert.equal(parseTitleDeepLink("nuvio://party/abc234"), null);
  assert.equal(parseTitleDeepLink("nuvio://free.nebulapro.xyz/sports/i/free/manifest.json"), null);
  assert.equal(parseTitleDeepLink("nuvio://detail/movie"), null);
  assert.equal(parseTitleDeepLink("nuvio://detail/podcast/tt0133093"), null);
  assert.equal(parseTitleDeepLink("nuvio://tmdb/603"), null);
  assert.equal(parseTitleDeepLink("nuvio:/detail/movie/tt0133093"), null);
  assert.equal(parseTitleDeepLink("https://nuvio.tv/detail/movie/tt0133093"), null);
  assert.equal(parseTitleDeepLink(""), null);
  assert.equal(parseTitleDeepLink(null), null);
});

test("webOS launch params carry the link as contentTarget", () => {
  launch(JSON.stringify({ contentTarget: "nuvio://tmdb/movie/603" }));
  assert.deepEqual(readWebOsLaunchDeepLink(), { type: "movie", id: "tmdb:603" });
  launch({ contentTarget: "nuvio://series/tt0944947" });
  assert.deepEqual(readWebOsLaunchDeepLink(), { type: "series", id: "tt0944947" });
  for (const params of [
    "{}",
    "",
    "{not json",
    '{"contentTarget": 603}',
    { contentTarget: "nuvio://party/abc234" }
  ]) {
    launch(params);
    assert.equal(readWebOsLaunchDeepLink(), null, JSON.stringify(params));
  }
});

test("a normal launch without params opens nothing", async () => {
  launch(JSON.stringify({ displayAffinity: 0 }));
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("home");
  assert.equal(hasPendingLaunchDeepLink(), false);
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  assert.deepEqual(router.opened, []);
});

test("the link waits through sign-in, profiles and setup, then opens once", async () => {
  launch({ contentTarget: "nuvio://tmdb/series/1396" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter(null);
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  for (const route of STARTUP_ROUTES) {
    router.current = route;
    assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false, route);
  }
  router.current = "home";
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), true);
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  assert.deepEqual(router.opened, [["detail", { itemId: "tmdb:1396", itemType: "series" }]]);
});

test("repeated launch events for one launch open the title once", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  // webOSLaunch for the same cold start, late on a slow boot, then a duplicated relaunch event.
  takeWebOsLaunchDeepLink();
  takeWebOsLaunchDeepLink();
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), true);
  assert.equal(router.opened.length, 1);
});

test("the same title launched again later opens again", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  takeWebOsLaunchDeepLink();
  router.current = "home";
  takeWebOsLaunchDeepLink();
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), true);
  assert.equal(router.opened.length, 2);
});

test("another link during startup replaces the waiting one", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  launch({ contentTarget: "nuvio://tmdb/series/1396" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("profileSelection");
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  router.current = "home";
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.deepEqual(router.opened, [["detail", { itemId: "tmdb:1396", itemType: "series" }]]);
});

test("a launch without a link or with a malformed one keeps the waiting link", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  launch("{not json");
  takeWebOsLaunchDeepLink();
  launch({ contentTarget: "nuvio://party/abc234" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.deepEqual(router.opened, [["detail", { itemId: "tmdb:603", itemType: "movie" }]]);
});

test("a resident launch opens over the current screen and keeps the back stack", async () => {
  launch({ contentTarget: "nuvio://series/tt0944947" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("library");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  // A plain navigate pushes Library on the stack: no replaceHistory, no skipStackPush, no reset to Home.
  assert.deepEqual(router.opened, [["detail", { itemId: "tt0944947", itemType: "series" }]]);
});

test("parser handles Android form decoding and rejects invalid URI syntax", () => {
  assert.deepEqual(parseTitleDeepLink("nuvio://detail/movie/custom+id"), {
    type: "movie",
    id: "custom id"
  });
  assert.deepEqual(parseTitleDeepLink("nuvio://meta?type=movie&id=custom+id"), {
    type: "movie",
    id: "custom id"
  });
  for (const url of [
    "nuvio://movie/bad%xx",
    "nuvio://movie/bad id",
    "nuvio://meta?type=movie&tmdb=603&__proto__=x"
  ]) {
    const parsed = parseTitleDeepLink(url);
    if (url.includes("__proto__")) assert.deepEqual(parsed, { type: "movie", id: "tmdb:603" });
    else assert.equal(parsed, null);
  }
});

test("launch event params override stale system params, including an empty launch", () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  assert.deepEqual(
    takeWebOsLaunchDeepLink({ params: { contentTarget: "nuvio://tmdb/series/1396" } }),
    { type: "series", id: "tmdb:1396" }
  );
  assert.equal(takeWebOsLaunchDeepLink({ params: {} }), null);
});

test("launchSingleTop replaces the top Detail history entry", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("detail");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.deepEqual(router.opened, [
    ["detail", { itemId: "tmdb:603", itemType: "movie" }, { replaceHistory: true }]
  ]);
});

async function lifecycle(current, platform = "webos") {
  const { readFile } = await import("node:fs/promises");
  const { default: vm } = await import("node:vm");
  const source = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const handlers = new Map();
  const router = fakeRouter(current);
  router.isWebOsResumeRouteRestorable = (route) => route === "home";
  router.persistWebOsResumeRoute = () => {};
  let activated = 0;
  launch({});
  globalThis.webOSSystem.activate = () => {
    activated++;
  };
  const context = {
    webOSSystem: globalThis.webOSSystem,
    Platform: { isWebOS: () => platform === "webos" },
    document: {
      addEventListener: (name, callback) => handlers.set(name, callback),
      body: { style: { removeProperty() {} } }
    },
    Router: router,
    NON_BACKSTACK_ROUTES: STARTUP_ROUTES,
    appShellRendered: true,
    DeviceSessionRegistration: { requestForegroundRegistration() {} },
    ProviderCredentialSyncService: { requestForegroundPull() {} },
    MediaServerSyncService: { requestForegroundPull() {} },
    StartupSyncService: { requestForegroundSync() {} },
    takeWebOsLaunchDeepLink,
    openPendingLaunchDeepLink,
    console
  };
  vm.runInNewContext(
    source.slice(
      source.indexOf("function setupWebOsAppLifecycle()"),
      source.indexOf("function setupProviderCredentialForegroundLifecycle()")
    ) + "\nsetupWebOsAppLifecycle();",
    context
  );
  return {
    router,
    handlers,
    activated: () => activated,
    async event(params) {
      handlers.get("webOSRelaunch")({ detail: params });
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

test("real relaunch handler holds every startup gate, including PIN selection", async () => {
  const app = await lifecycle("profileSelection");
  for (const route of STARTUP_ROUTES) {
    app.router.current = route;
    await app.event({ contentTarget: "nuvio://tmdb/movie/603" });
    assert.equal(app.router.current, route);
    assert.deepEqual(app.router.opened, []);
    assert.equal(hasPendingLaunchDeepLink(), true);
  }
  assert.equal(app.activated(), STARTUP_ROUTES.size);
  app.router.current = "home";
  await openPendingLaunchDeepLink(app.router, STARTUP_ROUTES);
  assert.equal(app.router.opened.length, 1);
});

test("real relaunch handler does not send repeated title events back Home", async () => {
  const app = await lifecycle("home");
  const params = { contentTarget: "nuvio://tmdb/movie/603" };
  await app.event(params);
  await app.event(params);
  assert.equal(app.router.current, "detail");
  assert.equal(app.router.opened.length, 1);
  await app.event({});
  assert.equal(app.router.current, "home");
});

test("browser and Tizen install no webOS launch handlers", async () => {
  for (const platform of ["browser", "tizen"]) {
    const app = await lifecycle("home", platform);
    assert.equal(app.handlers.size, 0);
    assert.equal(hasPendingLaunchDeepLink(), false);
  }
});

test("a relaunch waits until the current screen finishes mounting", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  const router = fakeRouter("home");
  router.pendingMountParams = {};
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  assert.equal(hasPendingLaunchDeepLink(), true);
  router.pendingMountParams = null;
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), true);
});

async function realRouter() {
  const { readFile } = await import("node:fs/promises");
  const { default: vm } = await import("node:vm");
  const source = await readFile(
    new URL(
      "../js/ui/navigation/routerMethods-02-complete-route-return-back-guard.js",
      import.meta.url
    ),
    "utf8"
  );
  const history = [];
  const context = {
    internals: {
      Platform: { isTizen: () => false, isWebOS: () => true },
      LocalStore: { set() {}, remove() {} },
      WEBOS_NON_RESTORABLE_ROUTES: new Set(["detail"]),
      NON_BACKSTACK_ROUTES: STARTUP_ROUTES,
      openPendingLaunchDeepLink,
      routerPerfNow: () => 0,
      logRouterPerf() {}
    },
    window: {
      history: {
        pushState: (state) => history.push(state),
        replaceState: (state) => {
          history[history.length ? history.length - 1 : 0] = state;
        }
      }
    },
    console
  };
  const methods = vm.runInNewContext(
    source
      .replace('import * as internals from "./router.js";', "")
      .replace("export function", "function") + "\ncreateRouterMethods02();",
    context
  );
  const router = {
    ...methods,
    routes: { home: { async mount() {} }, detail: { async mount() {} } },
    current: null,
    stack: [],
    getCurrent() {
      return this.current;
    },
    beginRouteReturnBackGuard() {},
    captureCurrentRouteState() {},
    resolveNavigationContext() {
      return {};
    }
  };
  return { router, history };
}

test("real router waits for mount and replaces consecutive Detail entries", async () => {
  const { router, history } = await realRouter();
  let finish;
  router.routes.home.mount = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const mounting = router.navigate("home");
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink();
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  finish();
  await mounting;
  assert.equal(router.current, "detail");
  assert.equal(router.pendingMountParams, null);
  const length = history.length;
  launch({ contentTarget: "nuvio://tmdb/series/1396" });
  takeWebOsLaunchDeepLink();
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.equal(history.length, length);
  assert.equal(history.at(-1).params.itemId, "tmdb:1396");
  assert.equal(history.at(-2).route, "home");
  assert.deepEqual(
    router.stack.map((entry) => entry.route),
    ["home"]
  );
});
