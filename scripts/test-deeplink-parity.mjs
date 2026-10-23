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
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
  const router = fakeRouter("home");
  assert.equal(hasPendingLaunchDeepLink(), false);
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  assert.deepEqual(router.opened, []);
});

test("the link waits through sign-in, profiles and setup, then opens once", async () => {
  launch({ contentTarget: "nuvio://tmdb/series/1396" });
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
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
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  // webOSLaunch for the same cold start, late on a slow boot, then a duplicated relaunch event.
  takeWebOsLaunchDeepLink({ now: 6000 });
  takeWebOsLaunchDeepLink({ now: 6500 });
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  assert.equal(router.opened.length, 1);
});

test("the same title launched again later opens again", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  takeWebOsLaunchDeepLink({ now: 1000 });
  takeWebOsLaunchDeepLink({ now: 60000 });
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), true);
  assert.equal(router.opened.length, 2);
});

test("another link during startup replaces the waiting one", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
  launch({ contentTarget: "nuvio://tmdb/series/1396" });
  takeWebOsLaunchDeepLink({ now: 3000 });
  const router = fakeRouter("profileSelection");
  assert.equal(await openPendingLaunchDeepLink(router, STARTUP_ROUTES), false);
  router.current = "home";
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.deepEqual(router.opened, [["detail", { itemId: "tmdb:1396", itemType: "series" }]]);
});

test("a launch without a link or with a malformed one keeps the waiting link", async () => {
  launch({ contentTarget: "nuvio://tmdb/movie/603" });
  takeWebOsLaunchDeepLink({ startup: true, now: 0 });
  launch("{not json");
  takeWebOsLaunchDeepLink({ now: 3000 });
  launch({ contentTarget: "nuvio://party/abc234" });
  takeWebOsLaunchDeepLink({ now: 6000 });
  const router = fakeRouter("home");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  assert.deepEqual(router.opened, [["detail", { itemId: "tmdb:603", itemType: "movie" }]]);
});

test("a resident launch opens over the current screen and keeps the back stack", async () => {
  launch({ contentTarget: "nuvio://series/tt0944947" });
  takeWebOsLaunchDeepLink({ now: 0 });
  const router = fakeRouter("library");
  await openPendingLaunchDeepLink(router, STARTUP_ROUTES);
  // A plain navigate pushes Library on the stack: no replaceHistory, no skipStackPush, no reset to Home.
  assert.deepEqual(router.opened, [["detail", { itemId: "tt0944947", itemType: "series" }]]);
});
