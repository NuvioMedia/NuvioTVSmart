/**
 * Identity of the pieces a Home render can swap independently.
 *
 * `HomeScreen.render()` used to hand the whole shell to `container.innerHTML`
 * whenever anything changed, which reparses, relays out and repaints every card
 * for a single arriving row. To replace only what changed it needs two things
 * from a rendered tree: the ordered, keyed units, and proof that nothing outside
 * them moved. `collectHomeRenderUnits` produces both in one walk.
 */

// Rows are keyed by the `data-row-key` the markup already emits
// (`homeCatalogKey` first, which is also the key rows are merged and reordered
// by). The hero is a unit of its own because `heroItem`/`heroCandidates` are
// recomputed from `this.rows` on the same catalog update that rebuilds a row, so
// the render that changes one row can change the hero too.
export const HOME_PATCH_UNIT_SELECTOR = "[data-row-key], .home-hero";
export const HOME_HERO_UNIT_KEY = "__hero__";
// Wrapper elements whose class and inline style are copied across on a partial
// update instead of being compared. They are O(1) to sync and they change on a
// layout-prefs toggle that leaves every row identical, so comparing them would
// throw away a perfectly good partial update.
export const HOME_PATCH_SYNCED_SELECTOR = ".home-shell, .home-route-content";

// U+0000 delimits the structural markers below. The HTML parser rewrites a NUL
// in the source to U+FFFD, so it can never occur in a serialized node or in text
// data - a printable delimiter could collide with adjacent text and let two
// different trees produce the same skeleton. Written as an escape on purpose: a
// raw NUL byte would make this file binary to grep and to the packaging
// minifier. (esbuild re-emits it as the equivalent `\0` escape.)
const UNIT_MARK = "\u0000";
const CLOSE_MARK = "\u0000/\u0000";

export function homePatchUnitKey(node) {
  return node.hasAttribute("data-row-key")
    ? `row:${node.getAttribute("data-row-key")}`
    : HOME_HERO_UNIT_KEY;
}

/**
 * Walks a rendered Home tree once and returns its identity: the ordered patchable
 * units (key + serialized markup) and a `skeleton` string holding every element,
 * attribute and text node *outside* those units.
 *
 * The skeleton is what makes a partial write safe. Anything the patcher cannot
 * swap - the sidebar, the wrappers around the rows, the initial loading state, a
 * layout-mode change - lands in it, so a difference there is detected and forces
 * the full write instead of being silently left stale. Because each unit
 * contributes its key between NUL marks, equal skeletons also pin the unit keys
 * and their order; callers do not need to re-check that.
 *
 * Both sides of every comparison must come from this function applied to
 * *generated* markup, never to a live node that render() has already handed to
 * the rest of the screen. The live DOM is deliberately mutated after each render
 * - `hydrateHomeLazyImages` swaps `data-src` for `src`, `setFocusedNode` adds
 * `.focused`, `applyHomeTruncationState` adds `.is-truncated` - so a live node no
 * longer serializes back to the markup that produced it, and diffing against it
 * would report every visited row as changed.
 *
 * `markups` holds the units verbatim rather than a hash. `ScreenUtils.markupSignature`
 * is the repo's hash for whole-screen identity and was considered here: measured
 * on the target webOS TV (2026-08-03, 24 units / 332K chars) it would cut what is
 * retained while Home is mounted from ~649KB to ~0.7KB, but costs 15.3ms of djb2
 * per render against a ~148ms partial write. Exact strings win because the
 * milliseconds are what this screen is short of, the retention is released in
 * `cleanup()` the moment Home is left, and it is small next to the ~200-card DOM
 * it describes - and an exact compare cannot mistake a hash collision for an
 * unchanged row.
 *
 * @returns {{ keys: string[], markups: string[], skeleton: string }}
 */
export function collectHomeRenderUnits(root) {
  const keys = [];
  const markups = [];
  const skeleton = [];
  const walk = (node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        skeleton.push(child.data);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      if (child.matches(HOME_PATCH_UNIT_SELECTOR)) {
        const key = homePatchUnitKey(child);
        keys.push(key);
        markups.push(child.outerHTML);
        skeleton.push(`${UNIT_MARK}${key}${UNIT_MARK}`);
        continue;
      }
      const shallow = child.cloneNode(false);
      if (child.matches(HOME_PATCH_SYNCED_SELECTOR)) {
        shallow.removeAttribute("class");
        shallow.removeAttribute("style");
      }
      skeleton.push(shallow.outerHTML);
      walk(child);
      skeleton.push(CLOSE_MARK);
    }
  };
  walk(root);
  return { keys, markups, skeleton: skeleton.join("") };
}

export function syncHomePatchedAttributes(liveNode, nextNode) {
  if (!liveNode || !nextNode) {
    return;
  }
  if (liveNode.className !== nextNode.className) {
    liveNode.className = nextNode.className;
  }
  const nextStyle = nextNode.getAttribute("style") || "";
  if ((liveNode.getAttribute("style") || "") === nextStyle) {
    return;
  }
  if (nextStyle) {
    liveNode.setAttribute("style", nextStyle);
  } else {
    liveNode.removeAttribute("style");
  }
}
