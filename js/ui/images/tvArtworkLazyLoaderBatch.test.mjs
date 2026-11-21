import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("tvArtworkLazyLoader batches src writes before geometry reads and skips Home shell on release", async () => {
  const source = stripModule(
    await readFile(new URL("./tvArtworkLazyLoader.js", import.meta.url), "utf8")
  );
  const ops = [];
  const context = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    innerHeight: 1080,
    innerWidth: 1920,
    getHomeArtworkObjectFit: () => "cover",
    isRescalableArtworkFit: () => true,
    releaseArtwork() {},
    rescaleArtwork: () => Promise.resolve(null),
    resetArtworkRescaler() {},
    shouldRescaleHomeArtwork: () => true,
    getTvArtworkPixelRatio: () => 1,
    registerSessionTeardownHandler() {},
    IntersectionObserver: function () {
      return { observe() {}, unobserve() {} };
    },
    observer: { observe() {}, unobserve() {} }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nobserver = { observe() {}, unobserve() {} };\nglobalThis.prepareTree = prepareTree;\nglobalThis.releaseTree = releaseTree;`,
    context
  );

  const makeLazyImg = (id) => {
    const attrs = { src: `https://image.tmdb.org/t/p/w500/${id}.jpg` };
    return {
      nodeType: 1,
      tagName: "IMG",
      dataset: {},
      classList: { contains: () => false },
      closest: () => null,
      matches: () => true,
      hasAttribute: (k) => k in attrs,
      getAttribute: (k) => attrs[k] ?? null,
      set src(v) {
        attrs.src = v;
        ops.push(`write:${id}`);
      },
      get src() {
        return attrs.src;
      },
      getBoundingClientRect() {
        ops.push(`read:${id}`);
        return { top: 0, bottom: 100, left: 0, right: 100 };
      }
    };
  };

  const imgA = makeLazyImg("a");
  const imgB = makeLazyImg("b");
  const root = {
    nodeType: 1,
    tagName: "DIV",
    classList: { contains: () => false },
    closest: () => null,
    matches: () => false,
    querySelectorAll: () => [imgA, imgB]
  };
  context.prepareTree(root);
  assert.deepEqual(ops, ["write:a", "write:b", "read:a", "read:b"]);

  let homeQsaCalls = 0;
  const homeShell = {
    nodeType: 1,
    tagName: "DIV",
    // Element.closest matches the element itself too.
    closest: (selector) => (selector === ".home-screen-shell" ? homeShell : null),
    querySelectorAll() {
      homeQsaCalls += 1;
      return [];
    }
  };
  context.releaseTree(homeShell);
  context.prepareTree(homeShell);
  context.releaseTree({
    nodeType: 1,
    tagName: "DIV",
    closest: (selector) => (selector === ".home-screen-shell" ? homeShell : null),
    querySelectorAll() {
      homeQsaCalls += 1;
      return [];
    }
  });
  assert.equal(homeQsaCalls, 0);
});
