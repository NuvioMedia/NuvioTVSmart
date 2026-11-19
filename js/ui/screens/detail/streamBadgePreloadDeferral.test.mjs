import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("Home startup app.js does not import or run preloadStreamBadgeImages", async () => {
  const appSource = await readFile(new URL("../../../app.js", import.meta.url), "utf8");
  assert.equal(appSource.includes("preloadStreamBadgeImages"), false);
});

test("Detail mount triggers preloadStreamBadgeImages and catches failures", async () => {
  const mountSource = (await readFile(new URL("./metaDetailsScreenMethods-02-mount.js", import.meta.url), "utf8"))
    .replace(/^import [\s\S]*?;$/gm, "")
    .replace(/^export /gm, "");

  let preloadCalls = 0;
  let shouldReject = false;
  const warned = [];
  const detailNode = { innerHTML: "" };

  const context = vm.createContext({
    detailShuffleSettings: () => ({ enabled: false }),
    nextShuffleVisit: () => 1,
    preloadStreamBadgeImages: () => {
      preloadCalls += 1;
      return shouldReject ? Promise.reject(new Error("badge-fail")) : Promise.resolve();
    },
    internals: {
      Router: { getCurrent: () => "detail" },
      ScreenUtils: { show: () => {} },
      hasMdbListRatings: () => false
    },
    document: {
      getElementById: (id) => (id === "detail" ? detailNode : null)
    },
    console: {
      warn: (...args) => warned.push(args)
    }
  });

  vm.runInContext(`${mountSource}\nglobalThis.methods = createMetaDetailsScreenMethods02();`, context);

  const screen = Object.create(context.methods);
  screen.stopTrailerPlayback = () => {};
  screen.cancelTraktCommentsRequest = () => {};
  screen.bindTrailerProxyMessaging = () => {};
  screen.hydrateFromRouteState = () => false;
  screen.loadDetail = () => Promise.resolve();

  await screen.mount();
  assert.equal(preloadCalls, 1);

  shouldReject = true;
  await screen.mount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(preloadCalls, 2);
  assert.equal(warned.length, 1);
  assert.equal(warned[0][0], "Stream badge image prerender failed");
});
