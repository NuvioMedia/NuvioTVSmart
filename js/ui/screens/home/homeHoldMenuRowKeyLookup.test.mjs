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

test("HomeScreen.restoreHoldMenuScrollState matches special rowKey characters via dataset lookup", async () => {
  const source = stripModule(
    await readFile(
      new URL("./homeScreenMethods-06-get-hero-source-from-focus-state.js", import.meta.url),
      "utf8"
    )
  );

  const context = vm.createContext({
    internals: makeInternalsProxy()
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createHomeScreenMethods06();`, context);

  const trickyKey = 'row:"special"\\[1]';
  const trickyTrack = { dataset: { trackRowKey: trickyKey }, scrollLeft: 0 };
  const viewport = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };

  const screen = Object.assign(Object.create(context.api), {
    container: {
      querySelector() {
        throw new Error("querySelector must not receive unescaped rowKey");
      },
      querySelectorAll(sel) {
        return sel === "[data-track-row-key]" ? [trickyTrack] : [];
      }
    },
    getHomeViewport: () => viewport,
    prepareHomeRowsForRestore() {},
    holdMenuScrollState: {
      mainScrollTop: 120,
      trackStates: { [trickyKey]: 340 }
    }
  });

  assert.equal(screen.restoreHoldMenuScrollState(), true);
  assert.equal(trickyTrack.scrollLeft, 340);
  assert.equal(viewport.scrollTop, 120);
});
