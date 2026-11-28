import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  selectHomeCatalogDescriptorsToLoad
} from "./homeCatalogs.js";

const descriptor = (addonId, catalogId, extra = {}) => ({
  addonBaseUrl: `https://${addonId}.example/manifest`,
  addonId,
  addonName: addonId,
  catalogId,
  catalogName: `${catalogId} name`,
  type: "movie",
  ...extra
});

const orderKey = (entry) => buildCatalogOrderKey(entry.addonId, entry.type, entry.catalogId);
const disableKey = (entry) =>
  buildCatalogDisableKey(entry.addonBaseUrl, entry.type, entry.catalogId, entry.catalogName);

test("disabled catalogs are not requested", () => {
  const popular = descriptor("cinemeta", "top");
  const featured = descriptor("cinemeta", "imdbRating");
  const watchlist = descriptor("aiometadata", "watchlist");
  const selected = selectHomeCatalogDescriptorsToLoad([popular, featured, watchlist], {
    disabled: [disableKey(popular), orderKey(featured)]
  });
  assert.deepEqual(selected, [watchlist]);
});

test("the first batch follows the saved Home order, not the add-on order", () => {
  const descriptors = [
    descriptor("cinemeta", "top"),
    descriptor("cinemeta", "imdbRating"),
    descriptor("cinemeta", "year"),
    descriptor("aiometadata", "watchlist"),
    descriptor("aiometadata", "letterboxd")
  ];
  const [top, imdb, year, watchlist, letterboxd] = descriptors;
  const selected = selectHomeCatalogDescriptorsToLoad(descriptors, {
    order: [
      orderKey(watchlist),
      "collection_streaming",
      orderKey(letterboxd),
      orderKey(top),
      orderKey(imdb)
    ],
    disabled: [disableKey(imdb)]
  });
  // A constrained TV loads the first few rows; the user's top rows must be in it.
  assert.deepEqual(selected.slice(0, 2), [watchlist, letterboxd]);
  // Catalogs with no saved position keep their add-on order after the saved ones.
  assert.deepEqual(selected, [watchlist, letterboxd, top, year]);
});

test("no saved preferences keeps every catalog in add-on order", () => {
  const descriptors = [descriptor("a", "1"), descriptor("b", "2"), descriptor("c", "3")];
  assert.deepEqual(selectHomeCatalogDescriptorsToLoad(descriptors, {}), descriptors);
  assert.deepEqual(selectHomeCatalogDescriptorsToLoad(descriptors), descriptors);
});

test("Home load slices the selected descriptors into the first batch", () => {
  const source = fs.readFileSync(
    new URL("../../ui/screens/home/homeScreenMethods-21-load-data.js", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /selectHomeCatalogDescriptorsToLoad\(uniqueCatalogDescriptors, HomeCatalogStore\.get\(\)\)/
  );
  assert.match(
    source,
    /const initialDescriptors = homeCatalogDescriptors\.slice\(0, initialCatalogLoad\)/
  );
  assert.match(
    source,
    /const deferredDescriptors = homeCatalogDescriptors\.slice\(initialCatalogLoad\)/
  );
});
