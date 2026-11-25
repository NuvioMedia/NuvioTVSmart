import assert from "node:assert/strict";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../js/ui/components/reorderSession.js";
import { buildOrderedHomeCatalogItems } from "../js/core/addons/homeCatalogs.js";

const session = createReorderSession({ keys: ["a", "b", "c"], lockedKeys: ["a"] });
assert.equal(beginReorder(session, "a"), false, "pinned rows cannot start a move");
assert.equal(beginReorder(session, "b"), true);
assert.equal(isReordering(session), true);
assert.equal(beginReorder(session, "c"), false, "only one row moves at a time");

assert.equal(moveReorderBy(session, -1), false, "a row cannot cross a pinned row");
assert.deepEqual(session.keys, ["a", "b", "c"]);
assert.equal(moveReorderBy(session, 1), true);
assert.deepEqual(session.keys, ["a", "c", "b"]);
assert.equal(moveReorderBy(session, 1), false, "the last row stays last");
assert.deepEqual(cancelReorder(session), ["a", "b", "c"], "Back restores the starting order");
assert.equal(isReordering(session), false);

beginReorder(session, "c");
moveReorderBy(session, -1);
assert.deepEqual(confirmReorder(session), ["a", "c", "b"]);
assert.equal(isReordering(session), false);

const collections = [
  { id: "plain", title: "Plain", pinToTop: false, folders: [] },
  { id: "pinned", title: "Pinned", pinToTop: true, folders: [] }
];
const items = buildOrderedHomeCatalogItems([], collections, ["plain", "collection_pinned"], [], {});
assert.deepEqual(
  items.map((item) => item.key),
  ["collection_pinned", "collection_plain"],
  "pinned collections come first"
);
assert.equal(items[0].isPinnedToTop, true);
assert.equal(items[0].canMoveUp, false);
assert.equal(items[0].canMoveDown, false);
assert.equal(items[1].canMoveUp, false, "an unpinned row cannot move above a pinned row");

console.log("test-reorder-session: ok");
