import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

function makeInternalsProxy(overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      return () => ({});
    }
  });
}

test("SettingsScreen.render skips rendering when unmounted before or during collectModel", async () => {
  const source = stripModule(
    await readFile(
      new URL("./settingsScreenMethods-12-render-trakt-stats-strip.js", import.meta.url),
      "utf8"
    )
  );
  const context = vm.createContext({
    renderAmbientSection: () => "",
    renderWatchPartySection: () => "",
    internals: makeInternalsProxy({
      getVisibleSections: () => [{ id: "appearance" }],
      getSettingsSectionById: () => ({ id: "appearance" }),
      clamp: (v, min, max) => Math.max(min, Math.min(max, v))
    })
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createSettingsScreenMethods12();`, context);

  let collectCalls = 0;
  let ensureShellCalls = 0;
  let resolveCollect;
  const screen = Object.assign(Object.create(context.api), {
    isMounted: false,
    settingsMountToken: 1,
    container: { querySelector: () => null },
    collectModel: () => {
      collectCalls += 1;
      return new Promise((resolve) => {
        resolveCollect = resolve;
      });
    },
    ensureShell: () => {
      ensureShellCalls += 1;
    }
  });

  // Unmounted on entry: must not even collectModel or touch DOM.
  await screen.render();
  assert.equal(collectCalls, 0);
  assert.equal(ensureShellCalls, 0);

  // Unmounted while awaiting collectModel: must exit cleanly right after await.
  screen.isMounted = true;
  const renderPromise = screen.render();
  assert.equal(collectCalls, 1);
  screen.isMounted = false;
  resolveCollect({ layout: {}, theme: {} });
  await renderPromise;
  assert.equal(ensureShellCalls, 0);
});

test("SettingsScreen.mount sets isMounted before initial cached render and aborts if unmounted during cache preload", async () => {
  const [source01, source12] = await Promise.all(
    [
      "./settingsScreenMethods-01-get-current-rail-scroll-top.js",
      "./settingsScreenMethods-12-render-trakt-stats-strip.js"
    ].map(async (relPath) => stripModule(await readFile(new URL(relPath, import.meta.url), "utf8")))
  );

  let subscribeCalls = 0;
  let resolveCachedCollect;
  const container = {
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const context = vm.createContext({
    console,
    document: { getElementById: (id) => (id === "settings" ? container : null) },
    renderAmbientSection: () => "",
    renderWatchPartySection: () => "",
    internals: makeInternalsProxy({
      Router: { getCurrent: () => "settings" },
      ScreenUtils: { show() {}, routeEnterClass: () => "", indexFocusables() {} },
      SECTION_META: [{ id: "appearance" }],
      LocalStore: { set() {} },
      getVisibleSections: () => [{ id: "appearance" }],
      getSettingsSectionById: () => ({ id: "appearance" }),
      clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
      readSettingsUiState: () => ({}),
      normalizeExpandedSections: (v) => v || {},
      normalizeExpandedState: (_id, v) => v || {},
      MemberAccessRepository: {
        subscribe: () => {
          subscribeCalls += 1;
          return () => {};
        }
      },
      getSidebarProfileState: (opts = {}) =>
        opts?.cacheOnly ? Promise.resolve({ id: "p1" }) : new Promise(() => {})
    })
  });
  context.globalThis = context;
  vm.runInContext(
    `${source01}\n${source12}\nglobalThis.api = Object.assign(createSettingsScreenMethods01(), createSettingsScreenMethods12());`,
    context
  );

  let ensureShellCalls = 0;
  let isMountedDuringEnsureShell = null;
  const screen = Object.assign(Object.create(context.api), {
    isMounted: false,
    settingsMountToken: 0,
    expandedSections: {},
    collectModel: ({ cacheOnly = false } = {}) =>
      cacheOnly ? Promise.resolve({ layout: {}, theme: {} }) : new Promise(() => {}),
    ensureShell() {
      ensureShellCalls += 1;
      isMountedDuringEnsureShell = this.isMounted;
    },
    renderNav: () => "",
    renderSection: () => "",
    renderTextDialog: () => "",
    bindTextDialogEvents() {},
    applyFocus() {},
    handleWheelEvent() {},
    handleClickEvent() {},
    closeSidebarToNav() {},
    openSidebar() {}
  });

  // 1) Normal mount sets isMounted=true before initial cached render executes, even while remote fetch is pending.
  await screen.mount();
  assert.equal(screen.isMounted, true);
  assert.equal(isMountedDuringEnsureShell, true);
  assert.equal(ensureShellCalls, 1, "initial cached render must not be skipped by !isMounted");
  assert.equal(subscribeCalls, 1);

  // 2) Simulated unmount/token increment while cacheOnly collectModel is in flight aborts before subscribe or render.
  ensureShellCalls = 0;
  subscribeCalls = 0;
  screen.isMounted = false;
  let collectReady;
  const collectStarted = new Promise((resolve) => {
    collectReady = resolve;
  });
  screen.collectModel = ({ cacheOnly = false } = {}) =>
    cacheOnly
      ? new Promise((resolve) => {
          collectReady();
          resolveCachedCollect = resolve;
        })
      : new Promise(() => {});

  const staleMount = screen.mount();
  await collectStarted;
  screen.isMounted = false;
  screen.settingsMountToken += 1;
  resolveCachedCollect({ layout: {}, theme: {} });
  await staleMount;

  assert.equal(screen.isMounted, false);
  assert.equal(ensureShellCalls, 0);
  assert.equal(subscribeCalls, 0);
});
