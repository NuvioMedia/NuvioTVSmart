import test from "node:test";
import assert from "node:assert/strict";

import { catalogShouldShowOnHome } from "./homeCatalogs.js";

test("hides catalogs that need a required extra to be requested", () => {
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "genre", isRequired: true, options: ["None"] }]
    }),
    false,
    "AIOStreams/AIOMetadata discover-only catalogs must stay off Home"
  );
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "genre", isRequired: true, options: ["None"] }],
      showInHome: true,
      hasExplicitShowInHome: true
    }),
    false,
    "showInHome cannot make an unusable catalog a Home row"
  );
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "search", isRequired: true }]
    }),
    false
  );
});

test("keeps catalogs that can be requested without params", () => {
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "skip", isRequired: false }]
    }),
    true,
    "catalogs without an explicit showInHome keep the Android default"
  );
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "skip", isRequired: false }],
      showInHome: true,
      hasExplicitShowInHome: true
    }),
    true
  );
  assert.equal(
    catalogShouldShowOnHome({
      extra: [{ name: "skip", isRequired: false }],
      showInHome: false,
      hasExplicitShowInHome: true
    }),
    false,
    "an explicit showInHome=false is still respected"
  );
});
