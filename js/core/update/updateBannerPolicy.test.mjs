import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldShowUpdate } from "./updateBannerPolicy.js";

test("automatic check shows a new update when the banner is enabled", () => {
  assert.equal(
    shouldShowUpdate({
      isRemoteNewer: true,
      force: false,
      bannerEnabled: true,
      dismissedTag: null,
      updateTag: "v1.2.0"
    }),
    true
  );
});

test("dismissed update stays hidden during automatic checks", () => {
  assert.equal(
    shouldShowUpdate({
      isRemoteNewer: true,
      force: false,
      bannerEnabled: true,
      dismissedTag: "v1.2.0",
      updateTag: "v1.2.0"
    }),
    false
  );
});

test("a newer tag is shown after the previous update was dismissed", () => {
  assert.equal(
    shouldShowUpdate({
      isRemoteNewer: true,
      force: false,
      bannerEnabled: true,
      dismissedTag: "v1.2.0",
      updateTag: "v1.3.0"
    }),
    true
  );
});

test("manual check shows the update despite dismissal and a disabled banner", () => {
  assert.equal(
    shouldShowUpdate({
      isRemoteNewer: true,
      force: true,
      bannerEnabled: false,
      dismissedTag: "v1.2.0",
      updateTag: "v1.2.0"
    }),
    true
  );
});

test("current version never shows as an update", () => {
  assert.equal(
    shouldShowUpdate({
      isRemoteNewer: false,
      force: true,
      bannerEnabled: true,
      dismissedTag: null,
      updateTag: "v1.2.0"
    }),
    false
  );
});
