import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const keysIn = (xml) =>
  new Set([...xml.matchAll(/<string name="([^"]+)"/g)].map((match) => match[1]));

const screens = {
  "js/ui/screens/plugin/catalogOrderScreen.js": [
    "catalog_order_title",
    "catalog_order_subtitle",
    "catalog_order_empty",
    "catalog_order_disabled_on_home",
    "catalog_order_enable",
    "catalog_order_disable",
    "common.done",
    "common.loading"
  ],
  "js/ui/screens/detail/metaDetailsScreenMethods-09-render-series-insight-section.js": [
    "detail.noCast"
  ],
  "js/ui/screens/collection/folderDetailScreenMethods-01-get-route-state-key.js": [
    "collections_folder_not_found"
  ]
};

const hardCoded = [
  ">Reorder Home Catalogs<",
  ">This controls catalog row order on Home (Classic + Modern + Grid).<",
  ">No home catalogs available yet.<",
  ">Disabled on Home<",
  '"Enable" : "Disable"',
  ">Done<",
  ">Loading...<",
  ">No cast information.<",
  ">Collection folder not found.<"
];

test("these screens no longer render hard-coded English", () => {
  for (const path of Object.keys(screens)) {
    const source = read(path);
    for (const text of hardCoded) {
      assert.equal(source.includes(text), false, `${path} still contains ${text}`);
    }
  }
});

test("every key these screens use exists in English and Romanian", () => {
  const english = keysIn(read("res/values/strings.xml"));
  const romanian = keysIn(read("res/values-ro/strings.xml"));
  for (const [path, keys] of Object.entries(screens)) {
    const source = read(path);
    for (const key of keys) {
      assert.ok(source.includes(`"${key}"`), `${path} does not use ${key}`);
      assert.ok(english.has(key), `values/strings.xml is missing ${key}`);
      assert.ok(romanian.has(key), `values-ro/strings.xml is missing ${key}`);
    }
  }
});
