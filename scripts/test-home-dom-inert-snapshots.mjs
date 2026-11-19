import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHeroDescriptionAutoScroller } from "../js/ui/screens/home/heroDescriptionAutoScroll.js";

// The scroller schedules its first pass on a frame; the test drives it by hand.
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

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

function makeNode({ nodeType = 1, nodeName = "DIV", ownerDocument = liveDocument, classes = [], text = "" } = {}) {
  const nodeClasses = new Set(classes);
  const node = {
    nodeType,
    nodeName,
    ownerDocument,
    parentNode: null,
    childNodes: [],
    style: {},
    dataset: {},
    attributes: [],
    classList: {
      contains: (name) => nodeClasses.has(name),
      add: (...names) => names.forEach((name) => nodeClasses.add(name)),
      remove: (...names) => names.forEach((name) => nodeClasses.delete(name)),
      item: () => [...nodeClasses][0] || "",
      [Symbol.iterator]: () => nodeClasses.values()
    },
    get className() {
      return [...nodeClasses].join(" ");
    },
    set className(value) {
      nodeClasses.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => nodeClasses.add(name));
    },
    get firstChild() {
      return this.childNodes[0] || null;
    },
    get firstElementChild() {
      return this.childNodes.find((child) => child.nodeType === 1) || null;
    },
    get nextSibling() {
      const siblings = this.parentNode?.childNodes;
      return siblings ? siblings[siblings.indexOf(this) + 1] || null : null;
    },
    get textContent() {
      return this.childNodes.map((child) => child.textContent).join("");
    },
    set textContent(value) {
      this.childNodes.forEach((child) => {
        child.parentNode = null;
      });
      this.childNodes = [];
      if (String(value)) this.appendChild(makeText(String(value), ownerDocument));
    },
    get clientHeight() {
      return nodeClasses.has("home-hero-description") ? 72 : 0;
    },
    get scrollHeight() {
      return nodeClasses.has("hero-description-track") ? 220 : 0;
    },
    appendChild(child) {
      child.remove();
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    insertBefore(child, before) {
      child.remove();
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
      child.parentNode = this;
      return child;
    },
    remove() {
      const siblings = this.parentNode?.childNodes;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    },
    matches: () => false,
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    hasAttribute: () => false,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {}
  };
  if (nodeType === 1) node.textContent = text;
  return node;
}

function makeText(text, ownerDocument = liveDocument) {
  const node = makeNode({ nodeType: 3, nodeName: "#text", ownerDocument });
  Object.defineProperty(node, "textContent", { value: text, writable: true });
  return node;
}

// Verify that incremental updates on .home-hero-description unwrap any runtime
// .hero-description-track span before reconciling children, preventing duplicate
// overlapping text nodes when auto-scroll is active.
const descNode = makeNode({ nodeName: "P", classes: ["home-hero-description", "hero-description-autoscroll"] });
descNode.style.height = "120px";
const rawTextNode = makeText("Original synopsis");
descNode.appendChild(rawTextNode);
context.api.registerHomeDomNodes([descNode]);

function wrapLikeAutoScroller(parent, textNode) {
  const track = makeNode({ nodeName: "SPAN", ownerDocument: parent.ownerDocument, classes: ["hero-description-track"] });
  track.appendChild(textNode);
  parent.appendChild(track);
  return track;
}

function sourceDescription(text) {
  const source = makeNode({ nodeName: "P", ownerDocument: inertDocument });
  source.appendChild(makeText(text, inertDocument));
  return source;
}

wrapLikeAutoScroller(descNode, rawTextNode);
context.api.updateNode(descNode, sourceDescription("Updated synopsis"), null);
assert.equal(descNode.firstChild, rawTextNode, "unwrapped text node must be reused in place");
assert.equal(rawTextNode.nextSibling, null, "no duplicate text node or stale track may remain");
assert.equal(rawTextNode.textContent, "Updated synopsis");
assert.equal(descNode.classList.contains("hero-description-autoscroll"), false);
assert.equal(descNode.style.height, "");

// The next refresh wraps the same registered text node again; reconciliation
// must keep reusing it instead of cloning a second copy.
wrapLikeAutoScroller(descNode, rawTextNode);
context.api.updateNode(descNode, sourceDescription("Latest synopsis"), null);
assert.equal(descNode.childNodes.length, 1, "a repeated refresh must not accumulate children");
assert.equal(descNode.firstChild, rawTextNode, "the registered text node survives every refresh");
assert.equal(rawTextNode.textContent, "Latest synopsis");
assert.equal(context.api.sourceByNode.get(rawTextNode) !== undefined, true);

// The scroller must move the existing text node into its track, never replace
// it: a recreated node is unknown to the incremental renderer and gets cloned.
const scrollerHost = makeNode({
  nodeName: "P",
  classes: ["home-hero-description"],
  ownerDocument: {
    createElement: (tagName) => makeNode({ nodeName: tagName.toUpperCase() }),
    defaultView: { getComputedStyle: () => ({ lineHeight: "24px", fontSize: "18px" }) }
  }
});
const scrollerTextNode = makeText("A long synopsis");
scrollerHost.appendChild(scrollerTextNode);
const scroller = createHeroDescriptionAutoScroller({ isPaused: () => false });
assert.equal(scroller.apply(scrollerHost, true), true);
const track = scrollerHost.firstElementChild;
assert.ok(track.classList.contains("hero-description-track"));
assert.equal(track.firstChild, scrollerTextNode);
assert.equal(scrollerHost.classList.contains("hero-description-autoscroll"), true);
scroller.apply(scrollerHost, true);
assert.equal(scrollerHost.firstElementChild, track, "an active scroll reuses its track");
assert.equal(track.firstChild, scrollerTextNode, "the tracked text node keeps its identity");
scroller.stop();
assert.equal(scrollerHost.classList.contains("hero-description-autoscroll"), false);

console.log(
  "Home snapshots and parsing share the inert document, including early live-node registration."
);
