import assert from "node:assert/strict";
import test from "node:test";

import {
  collectHomeRenderUnits,
  homePatchUnitKey,
  syncHomePatchedAttributes
} from "./homeRenderPatchUnits.js";

// --- A tiny, honest DOM fake ------------------------------------------------------------------
// `collectHomeRenderUnits` only ever calls `nodeType`/`data`/`firstChild`/`nextSibling`,
// `matches()`, `outerHTML`, and `cloneNode(false)` + `removeAttribute()` on the clone. This fake
// implements exactly that surface (plus `hasAttribute`/`getAttribute` for `homePatchUnitKey`) —
// not a general DOM, just enough real tree-walking and selector matching to exercise the actual
// algorithm instead of a stub that would just echo back canned values.

function linkChildren(children) {
  children.forEach((child, index) => {
    child._siblings = children;
    child._index = index;
  });
  return children;
}

function matchesSelectorList(node, selectorList) {
  return selectorList.split(",").some((raw) => {
    const selector = raw.trim();
    if (selector.startsWith(".")) {
      return node.className.split(/\s+/).includes(selector.slice(1));
    }
    const attrMatch = selector.match(/^\[([\w-]+)\]$/);
    if (attrMatch) {
      return node.hasAttribute(attrMatch[1]);
    }
    throw new Error(`fake DOM: unsupported selector fragment "${selector}"`);
  });
}

function serializeChildren(children) {
  return children.map((child) => (child.nodeType === 3 ? child.data : child.outerHTML)).join("");
}

function text(data) {
  return {
    nodeType: 3,
    data,
    _siblings: null,
    _index: -1,
    get nextSibling() {
      return this._siblings ? this._siblings[this._index + 1] || null : null;
    }
  };
}

function el(tag, attrs = {}, children = []) {
  const node = {
    nodeType: 1,
    tag,
    attrs: new Map(Object.entries(attrs)),
    children: linkChildren(children),
    _siblings: null,
    _index: -1,
    get nextSibling() {
      return this._siblings ? this._siblings[this._index + 1] || null : null;
    },
    get firstChild() {
      return this.children[0] || null;
    },
    get className() {
      return this.attrs.get("class") || "";
    },
    hasAttribute(name) {
      return this.attrs.has(name);
    },
    getAttribute(name) {
      return this.attrs.has(name) ? this.attrs.get(name) : null;
    },
    removeAttribute(name) {
      this.attrs.delete(name);
    },
    matches(selectorList) {
      return matchesSelectorList(this, selectorList);
    },
    cloneNode(deep) {
      // `collectHomeRenderUnits` only ever calls `cloneNode(false)`; a deep clone is not part of
      // the real algorithm's surface, so this fake does not implement it.
      if (deep) {
        throw new Error("fake DOM: deep cloneNode is unused by collectHomeRenderUnits");
      }
      return el(tag, Object.fromEntries(this.attrs), []);
    },
    get outerHTML() {
      const attrString = [...this.attrs.entries()]
        .map(([key, value]) => ` ${key}="${value}"`)
        .join("");
      return `<${tag}${attrString}>${serializeChildren(this.children)}</${tag}>`;
    }
  };
  return node;
}

function root(children) {
  return {
    get firstChild() {
      return children[0] || null;
    }
  };
}

globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

// A Home tree shaped like the real markup, but reduced to what the walk actually inspects: a
// shell/route-content wrapper pair (the two synced-attribute nodes), a hero unit, a non-synced
// wrapper (`.home-catalogs`) that should NOT have its class stripped, and two row units.
function buildHomeTree({
  shellClass = "home-shell home-layout-modern",
  shellStyle = "--gap:8px"
} = {}) {
  const heroNode = el("div", { class: "home-hero", "data-hero-id": "tt1" }, [text("Hero A")]);
  const rowA = el("div", { class: "home-row", "data-row-key": "continue-watching" }, [
    text("Row A")
  ]);
  const rowB = el("div", { class: "home-row", "data-row-key": "trending" }, [text("Row B")]);
  const catalogs = el("section", { class: "home-catalogs" }, [rowA, rowB]);
  const routeContent = el("div", { class: "home-route-content" }, [heroNode, catalogs]);
  const shell = el("div", { class: shellClass, style: shellStyle }, [routeContent]);
  return { tree: root([shell]), heroNode, rowA, rowB, catalogs, routeContent, shell };
}

// --- homePatchUnitKey --------------------------------------------------------------------------

test("homePatchUnitKey keys a row by its data-row-key attribute and everything else as the hero sentinel", () => {
  const row = el("div", { "data-row-key": "trending" });
  const hero = el("div", { class: "home-hero" });

  assert.equal(homePatchUnitKey(row), "row:trending");
  assert.equal(homePatchUnitKey(hero), "__hero__");
});

// --- collectHomeRenderUnits: ordered unit identity ---------------------------------------------

test("collectHomeRenderUnits walks the tree once and returns the hero and rows as ordered, keyed units", () => {
  const { tree, heroNode, rowA, rowB } = buildHomeTree();
  const heroMarkup = heroNode.outerHTML;
  const rowAMarkup = rowA.outerHTML;
  const rowBMarkup = rowB.outerHTML;

  const result = collectHomeRenderUnits(tree);

  assert.deepEqual(result.keys, ["__hero__", "row:continue-watching", "row:trending"]);
  assert.deepEqual(result.markups, [heroMarkup, rowAMarkup, rowBMarkup]);
});

test("collectHomeRenderUnits does not walk inside a unit — its whole subtree is opaque markup", () => {
  // If the walk recursed into `.home-hero` or a row, a nested `[data-row-key]` (a card carrying
  // its own catalog attribution, say) would be reported as a *second* top-level unit and the
  // patcher would try to replace it independently of its parent row. It must not.
  const nestedRowKeyCard = el("article", { "data-row-key": "nested-should-not-count" });
  const hero = el("div", { class: "home-hero" }, [nestedRowKeyCard]);
  const tree = root([hero]);

  const result = collectHomeRenderUnits(tree);

  assert.deepEqual(result.keys, ["__hero__"]);
  assert.equal(result.markups.length, 1);
});

// --- collectHomeRenderUnits: the skeleton is what makes the patch safe -------------------------

test("collectHomeRenderUnits strips class/style only from the two synced wrapper elements, not from other wrappers", () => {
  const { tree, shell } = buildHomeTree();
  const result = collectHomeRenderUnits(tree);

  assert.equal(
    result.skeleton.includes(shell.className),
    false,
    "the shell's class must not leak into the skeleton"
  );
  assert.equal(
    result.skeleton.includes("--gap:8px"),
    false,
    "the shell's inline style must not leak into the skeleton"
  );
  // `.home-catalogs` is a plain wrapper, not one of the two synced selectors — its class is part
  // of its shape and must still be compared.
  assert.ok(
    result.skeleton.includes('class="home-catalogs"'),
    "a non-synced wrapper's class must still be part of the skeleton"
  );
});

test("a layout-prefs change (shell class + inline style only) does not change the skeleton", () => {
  // This is the acceptance criterion from the issue: syncing the shell/route-content attributes
  // unconditionally means a render that only toggles layout prefs must still be patchable.
  const before = collectHomeRenderUnits(buildHomeTree().tree);
  const after = collectHomeRenderUnits(
    buildHomeTree({ shellClass: "home-shell home-layout-grid", shellStyle: "--gap:24px" }).tree
  );

  assert.equal(after.skeleton, before.skeleton);
  assert.deepEqual(after.keys, before.keys);
});

test("a class change on a wrapper that is not synced does change the skeleton", () => {
  // Contrast case for the test above: proves the stripping is selective (only `.home-shell` and
  // `.home-route-content`), not a blanket "ignore every wrapper's class" that would hide a real
  // shape change (e.g. a layout-mode switch that adds `.home-grid-catalogs`).
  const before = collectHomeRenderUnits(buildHomeTree().tree);
  const changedCatalogsClass = buildHomeTree();
  changedCatalogsClass.catalogs.attrs.set("class", "home-catalogs home-grid-catalogs");

  const after = collectHomeRenderUnits(changedCatalogsClass.tree);

  assert.notEqual(after.skeleton, before.skeleton);
});

test("a text node that looks like the element-close marker cannot forge a different tree's skeleton", () => {
  // Regression: while the close marker was the printable token "</>", these two structurally
  // different trees serialised identically — text data is pushed raw, so `&lt;/&gt;` in generated
  // markup decodes to exactly the marker. The patcher would then accept a shape it should have
  // rejected. Both markers are NUL-delimited now, and text can never contain a NUL because the
  // HTML parser rewrites one to U+FFFD.
  // `linkChildren` matters here: without it the sibling text node is unreachable via
  // `nextSibling` and the test would pass for the wrong reason.
  const inside = root(linkChildren([el("div", { class: "w" }, [text("</>")])]));
  const after = root(linkChildren([el("div", { class: "w" }, []), text("</>")]));

  const insideSkeleton = collectHomeRenderUnits(inside).skeleton;
  const afterSkeleton = collectHomeRenderUnits(after).skeleton;
  // Both really do contain the same pieces in a different order — that is what made the printable
  // marker forgeable — so this is a genuine collision case, not two unrelated trees.
  assert.equal([...insideSkeleton].sort().join(""), [...afterSkeleton].sort().join(""));
  assert.notEqual(insideSkeleton, afterSkeleton);
});

test("collectHomeRenderUnits reports a changed row's new markup as a different unit string, unchanged rows unaffected", () => {
  const first = buildHomeTree();
  const firstResult = collectHomeRenderUnits(first.tree);

  const second = buildHomeTree();
  second.rowA.children = linkChildren([text("Row A, now with an arrived poster")]);

  const secondResult = collectHomeRenderUnits(second.tree);

  assert.deepEqual(secondResult.keys, firstResult.keys, "row identity/order must be unaffected");
  assert.notEqual(
    secondResult.markups[1],
    firstResult.markups[1],
    "the changed row's markup string must differ"
  );
  assert.equal(
    secondResult.markups[2],
    firstResult.markups[2],
    "the untouched row's markup string must be byte-identical"
  );
  assert.equal(
    secondResult.markups[0],
    firstResult.markups[0],
    "the untouched hero's markup string must be byte-identical"
  );
});

// --- syncHomePatchedAttributes ------------------------------------------------------------------

function attributeNode({ className = "", style = null } = {}) {
  const attrs = new Map();
  if (style !== null) {
    attrs.set("style", style);
  }
  const calls = { setAttribute: [], removeAttribute: [], classNameWrites: [] };
  return {
    calls,
    get className() {
      return className;
    },
    set className(value) {
      className = value;
      calls.classNameWrites.push(value);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    setAttribute(name, value) {
      attrs.set(name, value);
      calls.setAttribute.push([name, value]);
    },
    removeAttribute(name) {
      attrs.delete(name);
      calls.removeAttribute.push(name);
    }
  };
}

test("syncHomePatchedAttributes copies a changed className but leaves an identical one untouched", () => {
  const unchanged = attributeNode({ className: "home-shell home-layout-modern" });
  syncHomePatchedAttributes(
    unchanged,
    attributeNode({ className: "home-shell home-layout-modern" })
  );
  assert.deepEqual(unchanged.calls.classNameWrites, []);

  const changed = attributeNode({ className: "home-shell home-layout-modern" });
  syncHomePatchedAttributes(changed, attributeNode({ className: "home-shell home-layout-grid" }));
  assert.deepEqual(changed.calls.classNameWrites, ["home-shell home-layout-grid"]);
});

test("syncHomePatchedAttributes sets, updates, and clears the inline style to match the next node", () => {
  // No style yet -> next has one: must be set.
  const gainsStyle = attributeNode({ style: null });
  syncHomePatchedAttributes(gainsStyle, attributeNode({ style: "--gap:8px" }));
  assert.deepEqual(gainsStyle.calls.setAttribute, [["style", "--gap:8px"]]);
  assert.deepEqual(gainsStyle.calls.removeAttribute, []);

  // Has a style -> next has none: must be removed, not set to "".
  const losesStyle = attributeNode({ style: "--gap:8px" });
  syncHomePatchedAttributes(losesStyle, attributeNode({ style: null }));
  assert.deepEqual(losesStyle.calls.removeAttribute, ["style"]);
  assert.deepEqual(losesStyle.calls.setAttribute, []);

  // Identical style on both sides: neither setAttribute nor removeAttribute may fire.
  const identical = attributeNode({ style: "--gap:8px" });
  syncHomePatchedAttributes(identical, attributeNode({ style: "--gap:8px" }));
  assert.deepEqual(identical.calls.setAttribute, []);
  assert.deepEqual(identical.calls.removeAttribute, []);
});

test("syncHomePatchedAttributes is a no-op when either side is missing", () => {
  assert.doesNotThrow(() => syncHomePatchedAttributes(null, attributeNode()));
  assert.doesNotThrow(() => syncHomePatchedAttributes(attributeNode(), null));
  assert.doesNotThrow(() => syncHomePatchedAttributes(null, null));
});
