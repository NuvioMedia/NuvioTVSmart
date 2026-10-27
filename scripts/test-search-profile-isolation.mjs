import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

const plain = (value) => JSON.parse(JSON.stringify(value));
const result = (query) => ({
  status: "success",
  data: { items: [{ id: `fixture:${query}`, name: query, type: "movie" }] }
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function setup(platform = "browser") {
  const storage = new Map();
  const frames = new Map();
  const timers = new Map();
  const requests = [];
  const paints = [];
  let nextId = 0;
  const container = { querySelector: () => null, querySelectorAll: () => [] };
  const emptyScreen = { mount: async () => {} };
  const fixtures = {
    LocalStore: {
      get: (key, fallback) => (storage.has(key) ? plain(storage.get(key)) : fallback),
      set: (key, value) => storage.set(key, plain(value)),
      remove: (key) => storage.delete(key)
    },
    HomeScreen: emptyScreen,
    MetaDetailsScreen: emptyScreen,
    ProfileSelectionScreen: emptyScreen,
    Platform: {
      isBrowser: () => platform === "browser",
      isTizen: () => platform === "tizen",
      isWebOS: () => platform === "webos"
    },
    ScreenUtils: { show() {}, hide() {} },
    LayoutPreferences: { get: () => ({ modernSidebar: false }) },
    getSidebarProfileState: async () => null,
    getTvRuntimePerformanceProfile: () => ({ isPerformanceConstrained: false }),
    resetDpadRepeat() {},
    watchedItemsRepository: { getAll: async () => [] },
    watchedTitleStateRepository: { getTitleWatchedItems: async () => [] },
    buildWatchedTitleIdSet: () => new Set(),
    addonRepository: {
      getInstalledAddons: async () => [
        {
          id: "synthetic-addon",
          baseUrl: "https://search-fixture.invalid",
          displayName: "Synthetic catalog",
          catalogs: [
            { id: "movies", name: "Movies", apiType: "movie", extra: [{ name: "search" }] }
          ]
        }
      ]
    },
    respond: (request) => result(request.extraArgs.search),
    catalogRepository: {
      getCatalog: async (request) => {
        requests.push(request);
        return fixtures.respond(request);
      }
    }
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        export { Router } from './js/ui/navigation/router.js';
        export { SearchScreen } from './js/ui/screens/search/searchScreen.js';
        export { ProfileManager } from './js/core/profile/profileManager.js';
        export { SearchHistoryStore } from './js/data/local/searchHistoryStore.js';
      `
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "subject",
    plugins: [
      {
        name: "synthetic-search-boundaries",
        setup(b) {
          // Keep the real composition, helpers, route snapshots, profiles, history,
          // search requests and cancellation. Replace only unrelated screens and
          // UI/platform/repository imports in the two composition modules.
          b.onLoad({ filter: /\/(?:searchScreen|router)\.js$/ }, async ({ path }) => ({
            contents: (await readFile(path, "utf8")).replace(
              /import\s+(\{[^}]+\})\s+from\s+["']([^"']+)["'];/g,
              (statement, bindings, source) =>
                /\/(?:searchScreen(?:Methods-[^/]+)?|searchCatalogTargets|launchDeepLink|router(?:Methods-[^/]+|State)?|routeStateStore|profileManager|searchHistoryStore|localStore)\.js$/.test(
                  source
                )
                  ? statement
                  : `const ${bindings} = fixtures;`
            ),
            loader: "js"
          }));
          b.onLoad({ filter: /\/localStore\.js$/ }, () => ({
            contents: "export const { LocalStore } = fixtures;",
            loader: "js"
          }));
          b.onLoad(
            {
              filter:
                /\/(?:pluginCodeStore|pluginStore|homeCatalogSettingsSyncService|profileScopedStore)\.js$/
            },
            () => ({
              contents: `
              export const PluginCodeStore = { clearProfile: async () => true };
              export const PluginStore = { clearProfile() {} };
              export const HomeCatalogSettingsSyncService = { clearProfile() {} };
              export const cancelProfileSettingsCloudSync = () => {};
            `,
              loader: "js"
            })
          );
          b.onLoad({ filter: /\/customPoster\.js$/ }, () => ({
            contents:
              "export const customPosterForItem = item => item; export const posterFallbackAttributes = () => '';",
            loader: "js"
          }));
        }
      }
    ]
  });
  const context = vm.createContext({
    fixtures,
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => (storage.has(key) ? JSON.stringify(storage.get(key)) : null),
      setItem: (key, value) => storage.set(key, JSON.parse(value)),
      removeItem: (key) => storage.delete(key)
    },
    console,
    AbortController,
    document: { getElementById: () => container },
    window: {},
    setTimeout: (fn) => {
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => {
      const id = ++nextId;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const { Router, SearchScreen, ProfileManager, SearchHistoryStore } = context.subject;
  const visible = () =>
    plain({
      query: SearchScreen.query,
      mode: SearchScreen.mode,
      items: (SearchScreen.rows || []).flatMap((row) => row.items.map((item) => item.id)),
      history: SearchScreen.recentSearches || []
    });
  // DOM painting is the only replaced SearchScreen method.
  SearchScreen.render = () => {
    SearchScreen.cancelScheduledRender();
    paints.push(visible());
  };
  const flush = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback();
    }
  };
  await ProfileManager.replaceProfiles([
    { id: "1", name: "Synthetic A" },
    { id: "2", name: "Synthetic B" }
  ]);
  await ProfileManager.setActiveProfile("1");
  return {
    Router,
    SearchScreen,
    ProfileManager,
    SearchHistoryStore,
    fixtures,
    requests,
    paints,
    visible,
    flush,
    async enter(params = {}) {
      await Router.navigate("search", params);
      await flush();
    },
    async search(query) {
      await SearchScreen.runSearchFromInput({ value: query }, { rememberToHistory: true });
      await flush();
    },
    async switchProfile(id) {
      // The selector leaves Search before changing the active profile, as the UI does.
      await Router.navigate("profileSelection");
      await ProfileManager.setActiveProfile(id);
      await Router.navigate("home", {}, { skipStackPush: true });
      await Router.navigate("search");
      await flush();
    }
  };
}

test("profile switches reset active query/results while retaining each profile history", async () => {
  const h = await setup();
  h.SearchHistoryStore.save("B earlier search", "2");
  await h.enter();
  await h.search("A movie");
  assert.deepEqual(h.visible().items, ["fixture:A movie"]);

  await h.switchProfile("2");
  assert.deepEqual(h.visible(), {
    query: "",
    mode: "idle",
    items: [],
    history: ["B earlier search"]
  });
  assert.deepEqual(plain(h.SearchHistoryStore.list("1")), ["A movie"]);
  await h.search("B movie");

  await h.switchProfile("1");
  assert.deepEqual(h.visible(), {
    query: "",
    mode: "idle",
    items: [],
    history: ["A movie"]
  });
  await h.switchProfile("2");
  assert.deepEqual(h.visible(), {
    query: "",
    mode: "idle",
    items: [],
    history: ["B movie", "B earlier search"]
  });
  assert.equal(
    h.requests.length,
    2,
    "entering a profile must not repeat the previous catalog search"
  );
});

test("same-profile detail Back and Search re-entry retain query and result rows", async () => {
  const h = await setup();
  await h.enter();
  await h.search("Own movie");
  const expected = h.visible();
  await h.Router.navigate("detail", { itemId: "fixture:Own movie", itemType: "movie" });
  await h.Router.back({ skipHistory: true });
  await h.flush();
  assert.equal(h.Router.getCurrent(), "search");
  assert.deepEqual(h.visible(), expected);
  await h.enter();
  assert.deepEqual(h.visible(), expected);
  assert.equal(h.requests.length, 1);
});

test("an explicit different query paints no previous rows while its catalog request is pending", async () => {
  const h = await setup();
  await h.enter();
  await h.search("Previous movie");
  await h.Router.navigate("home");
  const pending = deferred();
  h.fixtures.respond = () => pending.promise;
  const firstPaint = h.paints.length;
  await h.enter({ query: "New movie" });
  assert.equal(h.visible().query, "New movie");
  assert.deepEqual(h.visible().items, []);
  assert.ok(h.paints.slice(firstPaint).every((paint) => paint.items.length === 0));
  pending.resolve(result("New movie"));
  await h.flush();
  assert.deepEqual(h.visible().items, ["fixture:New movie"]);
  assert.deepEqual(plain(h.SearchHistoryStore.list()), ["Previous movie"]);
});

test("a cancelled outgoing profile request cannot overwrite incoming query, rows or history", async () => {
  const h = await setup();
  await h.enter();
  const late = deferred();
  h.fixtures.respond = () => late.promise;
  const outgoing = h.SearchScreen.runSearchFromInput({ value: "A delayed movie" });
  await h.flush();
  assert.equal(h.requests.length, 1);
  const outgoingSignal = h.requests[0].signal;
  assert.equal(outgoingSignal.aborted, false);
  await h.switchProfile("2");
  assert.equal(outgoingSignal.aborted, true);
  assert.equal(h.visible().query, "");
  assert.deepEqual(h.visible().items, []);

  h.fixtures.respond = (request) => result(request.extraArgs.search);
  await h.search("B current movie");
  const expected = h.visible();
  const firstPaint = h.paints.length;
  // Deliberately ignore AbortSignal at the IO boundary: a late response still arrives.
  late.resolve(result("A delayed movie"));
  await outgoing;
  await h.flush();
  assert.deepEqual(h.visible(), expected);
  assert.ok(
    h.paints.slice(firstPaint).every((paint) => !paint.items.includes("fixture:A delayed movie"))
  );
  assert.deepEqual(plain(h.SearchHistoryStore.list("1")), []);
  assert.deepEqual(plain(h.SearchHistoryStore.list("2")), ["B current movie"]);
});

test("a newly created profile cannot inherit a deleted profile slot search", async () => {
  const h = await setup();
  await h.switchProfile("2");
  await h.search("Deleted profile query");
  await h.switchProfile("1");
  assert.equal(await h.ProfileManager.deleteProfile("2"), true);
  assert.equal(await h.ProfileManager.createProfile({ name: "New person" }), true);
  await h.switchProfile("2");
  assert.equal(h.visible().query, "");
  assert.deepEqual(h.visible().items, []);
});

test("profile selection resets Search even when reselecting the same profile", async () => {
  const h = await setup();
  await h.enter();
  await h.search("Own movie");
  await h.switchProfile("1");
  assert.equal(h.visible().query, "");
  assert.deepEqual(h.visible().items, []);
  assert.deepEqual(h.visible().history, ["Own movie"]);
});

test("profile management preserves same-profile Search snapshots", async () => {
  const h = await setup();
  await h.enter();
  await h.search("Own movie");
  const expected = h.visible();
  await h.Router.navigate("profileSelection", { mode: "management", returnRoute: "settings" });
  await h.Router.navigate("home");
  await h.enter();
  assert.deepEqual(h.visible(), expected);
  assert.equal(h.requests.length, 1);
});

for (const platform of ["tizen", "webos"]) {
  test(`${platform}: switching profiles clears Search and retains recent history`, async () => {
    const h = await setup(platform);
    h.SearchHistoryStore.save("B history", "2");
    await h.enter();
    await h.search("A movie");
    await h.switchProfile("2");
    assert.deepEqual(h.visible(), { query: "", mode: "idle", items: [], history: ["B history"] });
    await h.search("B movie");
    await h.switchProfile("1");
    assert.deepEqual(h.visible(), { query: "", mode: "idle", items: [], history: ["A movie"] });
  });
}

test("entering profile selection from details also invalidates the earlier Search snapshot", async () => {
  const h = await setup();
  await h.enter();
  await h.search("A movie");
  await h.Router.navigate("detail", { itemId: "fixture:A movie", itemType: "movie" });
  await h.switchProfile("2");
  assert.equal(h.visible().query, "");
  assert.deepEqual(h.visible().items, []);
});
