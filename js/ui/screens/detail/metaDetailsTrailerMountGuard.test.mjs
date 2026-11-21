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

test("MetaDetailsScreen.playTrailer aborts cleanly when detailLoadToken or route changes during async trailer lookup", async () => {
  const source = stripModule(
    await readFile(
      new URL("./metaDetailsScreenMethods-19-toggle-active-trailer-playback.js", import.meta.url),
      "utf8"
    )
  );

  let currentRoute = "detail";
  const context = vm.createContext({
    shouldContinueTrailerInBackgroundOnBack: () => false,
    focusWithoutScroll: () => {},
    internals: makeInternalsProxy({
      Router: { getCurrent: () => currentRoute }
    })
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createMetaDetailsScreenMethods19();`, context);

  let resolvePreferred;
  let stopCalls = 0;
  const screen = Object.assign(Object.create(context.api), {
    detailLoadToken: 4,
    container: {},
    meta: { id: "tt1" },
    trailerSource: null,
    captureDetailFocus: () => null,
    resolvePreferredTrailerSource: () =>
      new Promise((resolve) => {
        resolvePreferred = resolve;
      }),
    stopTrailerPlayback: () => {
      stopCalls += 1;
    }
  });

  // Token advances mid-await -> stale resolution must not set trailerSource or start playback.
  const firstAttempt = screen.playTrailer();
  screen.detailLoadToken = 5;
  resolvePreferred({ kind: "video", url: "https://cdn.example/stale.mp4" });
  await firstAttempt;
  assert.equal(screen.trailerSource, null);
  assert.equal(stopCalls, 0);

  // Route leaves "detail" mid-await -> must abort cleanly too.
  currentRoute = "home";
  const secondAttempt = screen.playTrailer();
  resolvePreferred({ kind: "video", url: "https://cdn.example/navigated-away.mp4" });
  await secondAttempt;
  assert.equal(screen.trailerSource, null);
  assert.equal(stopCalls, 0);
});
