import assert from "node:assert/strict";
import test from "node:test";

test("CW enrichment cache memoizes reads, sees external edits, and only writes real changes", async () => {
  const storage = new Map();
  let setCalls = 0;
  let parseCalls = 0;

  const previousLocalStorage = globalThis.localStorage;
  const previousJsonParse = JSON.parse;
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      setCalls += 1;
      storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key)
  };
  JSON.parse = (...args) => {
    parseCalls += 1;
    return previousJsonParse(...args);
  };

  try {
    const { saveContinueWatchingEnrichment, getCachedContinueWatchingEnrichment } =
      await import("./homeScreenHelpers-10-get-cached-continue-watching-enrichment.js");

    const baseItem = {
      contentId: "tt999",
      contentType: "series",
      season: 1,
      episode: 1,
      videoId: "v1",
      title: "Show",
      episodeTitle: "Pilot",
      episodeThumbnail: "https://img/thumb.jpg",
      thumbnail: "https://img/thumb.jpg",
      poster: "https://img/poster.jpg",
      genres: ["Drama"]
    };

    saveContinueWatchingEnrichment(baseItem);
    const setsAfterFirstSave = setCalls;
    const parsesBeforeReads = parseCalls;

    for (let i = 0; i < 5; i += 1) {
      const hit = getCachedContinueWatchingEnrichment(baseItem);
      assert.equal(hit?.episodeTitle, "Pilot");
    }
    assert.equal(parseCalls, parsesBeforeReads, "memoized hits must not re-run JSON.parse");

    // Saving identical entry within 1h skips redundant LocalStore.set().
    saveContinueWatchingEnrichment(baseItem);
    assert.equal(setCalls, setsAfterFirstSave);

    // Direct external localStorage write invalidates the memo via raw-text comparison.
    const rawObj = previousJsonParse(storage.get("homeContinueWatchingEnrichmentCache"));
    rawObj["series:tt999:1:1"].episodeTitle = "External Update";
    storage.set("homeContinueWatchingEnrichmentCache", JSON.stringify(rawObj));
    const parsesAfterRawEdit = parseCalls;
    const refreshed = getCachedContinueWatchingEnrichment(baseItem);
    assert.equal(refreshed?.episodeTitle, "External Update");
    assert.equal(parseCalls, parsesAfterRawEdit + 1);
    for (let i = 0; i < 4; i += 1) {
      assert.equal(getCachedContinueWatchingEnrichment(baseItem)?.episodeTitle, "External Update");
    }
    assert.equal(parseCalls, parsesAfterRawEdit + 1);

    // Changed metadata is written immediately, even inside the dedupe window.
    const updatedItem = { ...baseItem, episodeTitle: "Updated" };
    const setsBeforeChange = setCalls;
    saveContinueWatchingEnrichment(updatedItem);
    assert.equal(setCalls, setsBeforeChange + 1);
    assert.equal(getCachedContinueWatchingEnrichment(baseItem)?.episodeTitle, "Updated");

    // An identical entry older than the dedupe window is refreshed, so the
    // 14-day cache age can still revalidate its metadata.
    const staleObj = previousJsonParse(storage.get("homeContinueWatchingEnrichmentCache"));
    staleObj["series:tt999:1:1"].cachedAt = Date.now() - 2 * 60 * 60 * 1000;
    storage.set("homeContinueWatchingEnrichmentCache", JSON.stringify(staleObj));
    const setsBeforeStale = setCalls;
    saveContinueWatchingEnrichment(updatedItem);
    assert.equal(setCalls, setsBeforeStale + 1);
    assert.ok(Date.now() - getCachedContinueWatchingEnrichment(baseItem).cachedAt < 60 * 1000);

    // Clearing the cache (Settings) invalidates the memo through the null raw value.
    storage.delete("homeContinueWatchingEnrichmentCache");
    assert.equal(getCachedContinueWatchingEnrichment(baseItem), null);
  } finally {
    JSON.parse = previousJsonParse;
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  }
});
