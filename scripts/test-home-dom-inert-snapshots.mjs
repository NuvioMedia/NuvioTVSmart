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
    "\nglobalThis.api = { registerHomeDomNodes, updateHomeDom, sourceByNode, releasePosters };",
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
console.log(
  "Home snapshots and parsing share the inert document, including early live-node registration."
);
