import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../js/ui/screens/home/homeDomUpdate.js", import.meta.url),
  "utf8"
);
const released = [];
const context = vm.createContext({ releaseHomeArtwork: (url) => released.push(url) });
vm.runInContext(
  source.replace(/^import .*;$/gm, "").replaceAll("export function", "function") +
    "\nglobalThis.api = { registerHomeDomNodes, updateHomeDom, sourceByNode, releasePosters, updateNode, updateAttributes, unchangedHomeRowMarkup };",
  context
);
let documentsCreated = 0;
const imported = [];
const inertDocument = {
  importNode(node, deep) {
    assert.equal(deep, false);
    const copy = { ownerDocument: this, childNodes: [] };
    imported.push(node);
    return copy;
  },
  createElement() {
    return { ownerDocument: this, childNodes: [] };
  }
};
const liveDocument = {
  implementation: {
    createHTMLDocument() {
      documentsCreated++;
      return inertDocument;
    }
  }
};
const image = {
  ownerDocument: liveDocument,
  nodeType: 1,
  dataset: {},
  classList: { contains: () => false },
  childNodes: [],
  cloneNode() {
    assert.fail("Snapshot must not clone a lazy image in the live document");
  }
};
// Pagination can register live images before the first full Home render.
context.api.registerHomeDomNodes([image]);
assert.equal(context.api.sourceByNode.get(image).node.ownerDocument, inertDocument);
assert.deepEqual(imported, [image]);

const shell = {};
const container = {
  ownerDocument: liveDocument,
  childNodes: [],
  querySelector: () => shell,
  matches: () => false,
  querySelectorAll: () => [],
  nodeType: 1
};
assert.equal(context.api.updateHomeDom(container, "<div></div>"), false);
assert.equal(context.api.updateHomeDom(container, "<div></div>", { incremental: true }), true);
assert.equal(documentsCreated, 1);
assert.equal(context.api.sourceByNode.get(container).node.ownerDocument, inertDocument);
const poster = {
  dataset: { originalSrc: "https://art/poster.jpg" },
  getAttribute: () => "blob:poster"
};
context.api.releasePosters({ nodeType: 1, matches: () => false, querySelectorAll: () => [poster] });
assert.deepEqual(released, ["blob:poster"]);
assert.equal(poster.dataset.originalSrc, undefined);
// An unchanged-row stand-in leaves the mounted row and its snapshot alone.
const stub = context.api.unchangedHomeRowMarkup("row&amp;1");
assert.equal(stub, '<section data-row-key="row&amp;1" data-home-row-unchanged></section>');
const mountedRow = {
  get classList() {
    assert.fail("An unchanged row must not be reconciled");
  }
};
context.api.updateNode(mountedRow, {
  nodeType: 1,
  hasAttribute: (name) => name === "data-home-row-unchanged"
});
assert.equal(context.api.sourceByNode.get(mountedRow), undefined);

// The hero paints a bounded blob while the generated markup keeps the original
// addon logo. An incremental refresh must not put the oversized url back.
function sourceNode(values) {
  return {
    attributes: Object.keys(values).map((name) => ({ name })),
    getAttribute: (name) => (name in values ? values[name] : null)
  };
}
function liveNode({ hero = false } = {}) {
  const attributes = { src: "blob:logo", alt: "old" };
  return {
    tagName: "IMG",
    dataset: {},
    heroLogoSourceUrl: hero ? "https://cdn/original.png" : undefined,
    classList: {
      contains: (name) => hero && name === "home-hero-logo"
    },
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
    attributes
  };
}
const heroLogo = liveNode({ hero: true });
context.api.updateAttributes(
  heroLogo,
  sourceNode({ src: "blob:logo", alt: "old" }),
  sourceNode({ src: "https://cdn/original.png", alt: "new" })
);
assert.equal(heroLogo.getAttribute("src"), "blob:logo", "the rescaled hero logo survives a refresh");
assert.equal(heroLogo.getAttribute("alt"), "new");
context.api.updateAttributes(
  heroLogo,
  sourceNode({ src: "blob:logo", alt: "new" }),
  sourceNode({ src: "https://cdn/next.png", alt: "new" })
);
assert.equal(heroLogo.getAttribute("src"), "https://cdn/next.png", "a different hero logo still updates");

const plainImage = liveNode();
context.api.updateAttributes(
  plainImage,
  sourceNode({ src: "https://cdn/old.jpg" }),
  sourceNode({ src: "https://cdn/new.jpg" })
);
assert.equal(plainImage.getAttribute("src"), "https://cdn/new.jpg", "other images still follow the markup");

console.log(
  "Home snapshots and parsing share the inert document, including early live-node registration."
);
