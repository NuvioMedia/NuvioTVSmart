import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRefreshedHomeRows } from "../../js/ui/screens/home/homeRowMerge.js";

const row = (key, marker = "old") => ({ homeCatalogKey: key, marker });
const keys = (rows) => rows.map((entry) => entry.homeCatalogKey);

test("a cold load uses the fetched rows verbatim", () => {
  const existing = [row("a"), row("b")];
  const fetched = [row("a", "new")];
  assert.deepEqual(keys(mergeRefreshedHomeRows(existing, fetched, null, { background: false })), [
    "a"
  ]);
});

test("a background refresh keeps rows outside the initial batch", () => {
  // The regression this guards: Home dropping from 26 rows to the 6 the initial
  // batch resolved, then rebuilding back to 26.
  const existing = [row("a"), row("b"), row("c")];
  const fetched = [row("a", "new")];
  const configured = new Set(["a", "b", "c"]);
  const merged = mergeRefreshedHomeRows(existing, fetched, configured, { background: true });
  assert.deepEqual(keys(merged).sort(), ["a", "b", "c"]);
});

test("freshly fetched rows replace the retained copy", () => {
  const merged = mergeRefreshedHomeRows([row("a", "old")], [row("a", "new")], new Set(["a"]), {
    background: true
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].marker, "new");
});

test("a row whose catalog is no longer configured is dropped", () => {
  // Disabling an addon in Settings then returning to Home must not resurrect it.
  const existing = [row("a"), row("removed")];
  const merged = mergeRefreshedHomeRows(existing, [], new Set(["a"]), { background: true });
  assert.deepEqual(keys(merged), ["a"]);
});

test("rows without a catalog key survive the configured-catalog filter", () => {
  const collectionRow = { marker: "collection" };
  const merged = mergeRefreshedHomeRows([collectionRow, row("a")], [], new Set(["a"]), {
    background: true
  });
  assert.equal(merged.length, 2);
});

test("tolerates missing inputs", () => {
  assert.deepEqual(mergeRefreshedHomeRows(null, null, null, { background: true }), []);
  assert.deepEqual(keys(mergeRefreshedHomeRows(undefined, [row("a")], null, { background: true })), [
    "a"
  ]);
});
