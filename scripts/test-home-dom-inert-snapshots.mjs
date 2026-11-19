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
    "\nglobalThis.api = { registerHomeDomNodes, updateHomeDom, sourceByNode, releasePosters, updateNode, unchangedHomeRowMarkup };",
  context
);
let documentsCreated = 0;
const imported = [];
const inertDocument = {
  importNode(node, deep) {
    assert.equal(deep, false);
    const copy = {
      ownerDocument: this,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      textContent: node.textContent,
      attributes: node.attributes || [],
      style: node.style || [],
      classList: node.classList,
      dataset: node.dataset || {},
      getAttribute: node.getAttribute ? (k) => node.getAttribute(k) : () => null,
      hasAttribute: node.hasAttribute ? (k) => node.hasAttribute(k) : () => false,
      childNodes: []
    };
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

// Verify that incremental updates on .home-hero-description unwrap any runtime
// .hero-description-track span before reconciling children, preventing duplicate
// overlapping text nodes when auto-scroll is active.
const rawTextNode = {
  ownerDocument: liveDocument,
  nodeType: 3,
  nodeName: "#text",
  textContent: "Original synopsis",
  nextSibling: null,
  parentNode: null,
  contains: () => false
};
const runtimeTrack = {
  ownerDocument: liveDocument,
  nodeType: 1,
  nodeName: "SPAN",
  classList: { contains: (cls) => cls === "hero-description-track" },
  firstChild: rawTextNode,
  nextSibling: null,
  parentNode: null,
  remove() {
    if (this.parentNode) {
      let cur = this.parentNode.firstChild;
      if (cur === this) {
        this.parentNode.firstChild = this.nextSibling;
      } else {
        while (cur && cur.nextSibling !== this) {
          cur = cur.nextSibling;
        }
        if (cur) {
          cur.nextSibling = this.nextSibling;
        }
      }
    }
    this.parentNode = null;
  }
};
rawTextNode.parentNode = runtimeTrack;

const descClasses = new Set(["home-hero-description", "hero-description-autoscroll"]);
const descNode = {
  ownerDocument: liveDocument,
  nodeType: 1,
  nodeName: "P",
  attributes: [],
  style: { height: "120px", maskImage: "linear-gradient(#000,#000)", webkitMaskImage: "linear-gradient(#000,#000)" },
  classList: {
    contains: (cls) => descClasses.has(cls),
    remove: (cls) => descClasses.delete(cls),
    add: (cls) => descClasses.add(cls),
    item: () => "home-hero-description",
    [Symbol.iterator]: () => descClasses.values()
  },
  dataset: {},
  firstChild: rawTextNode,
  hasAttribute: () => false,
  getAttribute: () => null,
  setAttribute: () => {},
  removeAttribute: () => {},
  insertBefore(node, before) {
    if (node.parentNode === runtimeTrack && runtimeTrack.firstChild === node) {
      runtimeTrack.firstChild = node.nextSibling;
    }
    node.parentNode = this;
    node.nextSibling = before;
    this.firstChild = node;
  }
};
rawTextNode.parentNode = descNode;
context.api.registerHomeDomNodes([descNode]);

// Simulate heroDescriptionAutoScroll wrapping rawTextNode into runtimeTrack at runtime
descNode.firstChild = runtimeTrack;
runtimeTrack.parentNode = descNode;
rawTextNode.parentNode = runtimeTrack;
rawTextNode.nextSibling = null;

const sourceTextNode = {
  ownerDocument: inertDocument,
  nodeType: 3,
  nodeName: "#text",
  textContent: "Updated synopsis",
  nextSibling: null
};
const sourceDescNode = {
  ownerDocument: inertDocument,
  nodeType: 1,
  nodeName: "P",
  attributes: [],
  style: [],
  classList: {
    contains: (cls) => cls === "home-hero-description",
    item: () => "home-hero-description",
    [Symbol.iterator]: () => ["home-hero-description"][Symbol.iterator]()
  },
  dataset: {},
  firstChild: sourceTextNode,
  hasAttribute: () => false,
  getAttribute: () => null
};

context.api.updateNode(descNode, sourceDescNode, null);
assert.equal(descNode.firstChild, rawTextNode, "unwrapped text node must be reused in place");
assert.equal(rawTextNode.nextSibling, null, "no duplicate text node or stale track may remain");
assert.equal(rawTextNode.textContent, "Updated synopsis");
assert.equal(descClasses.has("hero-description-autoscroll"), false);
assert.equal(descNode.style.height, "");

console.log(
  "Home snapshots and parsing share the inert document, including early live-node registration."
);
