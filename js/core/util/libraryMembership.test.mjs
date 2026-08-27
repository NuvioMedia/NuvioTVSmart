import test from "node:test";
import assert from "node:assert/strict";

// Repository imports touch LocalStore during module init, so give them a
// localStorage before importing the service under test.
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
})();

const { tabSupportsContentType } = await import("./libraryMembership.js");
const { SimklSyncService } = await import("../../data/repository/simklSyncService.js");

// Keep getLibraryTabs from touching the network.
SimklSyncService.refresh = async () => false;

const tabs = await SimklSyncService.getLibraryTabs();
const keysFor = (type) => tabs.filter((tab) => tabSupportsContentType(tab, type)).map((tab) => tab.key);

// Shows the old destination only filter offered a series only status to a movie.
test("old destination only filter offered a series only status to a movie", () => {
  const offered = tabs
    .filter((tab) => tab.isMembershipDestination !== false)
    .map((tab) => tab.key);
  assert.ok(
    offered.includes("simkl:status:watching"),
    "reproduces the bug: Watching was offered for a movie"
  );
});

// Mirrors TrackingLibraryMembershipTest "movie cannot select a series only status".
test("a movie is not offered series only statuses", () => {
  const offered = keysFor("movie");
  assert.ok(!offered.includes("simkl:status:watching"), "Watching is series only");
  assert.ok(!offered.includes("simkl:status:hold"), "On Hold is series only");
  assert.ok(offered.includes("simkl:status:plantowatch"), "Plan to Watch stays for a movie");
  assert.ok(offered.includes("simkl:status:dropped"), "Dropped stays for a movie");
});

// A series keeps every writable status.
test("a series keeps series statuses", () => {
  const offered = keysFor("series");
  assert.ok(offered.includes("simkl:status:watching"), "Watching stays for a series");
  assert.ok(offered.includes("simkl:status:hold"), "On Hold stays for a series");
});

// Mirrors TrackingLibraryMembershipTest "read only provider status cannot be selected".
test("a read only status is never offered", () => {
  assert.ok(!keysFor("movie").includes("simkl:status:completed"), "Completed is read only");
  assert.ok(!keysFor("series").includes("simkl:status:completed"), "Completed is read only");
});

// tv, show and anime items are treated as series.
test("tv and anime are treated as series", () => {
  assert.ok(keysFor("tv").includes("simkl:status:watching"), "tv counts as series");
  assert.ok(keysFor("anime").includes("simkl:status:hold"), "anime counts as series");
});

// A tab with no declared content types accepts anything.
test("a tab without content types accepts anything", () => {
  const localTab = { key: "local", isMembershipDestination: true };
  assert.equal(tabSupportsContentType(localTab, "movie"), true);
});
