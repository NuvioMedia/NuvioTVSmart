import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { libraryRepository, LibrarySourceMode } =
  await import("../js/data/repository/libraryRepository.js");
const { watchedItemsRepository } = await import("../js/data/repository/watchedItemsRepository.js");
const { watchedTitleStateRepository } =
  await import("../js/data/repository/watchedTitleStateRepository.js");
const { LibraryController } = await import("../js/ui/screens/library/libraryController.js");

const movie = (n) => ({ id: `tt${n}`, type: "movie", name: `M${n}`, addedAt: 100 - n });
let items = [1, 2, 3, 4, 5].map(movie);
Object.assign(libraryRepository, {
  getSourceMode: async () => LibrarySourceMode.LOCAL,
  getListTabs: async () => [],
  getItems: async () => items,
  hydrateItems: async (list) => list
});
watchedItemsRepository.getAll = async () => [];
watchedTitleStateRepository.getTitleWatchedItems = async () => [];

const keys = (c) => c.getState().visibleItems.map((item) => item.id);
const controller = new LibraryController();
await controller.init();
assert.deepEqual(keys(controller), ["tt1", "tt2", "tt3", "tt4", "tt5"]);

// Long-press removal: the next card takes the removed slot.
controller.setFocusedPosterKey("movie:tt3");
items = items.filter((item) => item.id !== "tt3");
await controller.reload({ preserveOverlay: true });
assert.equal(controller.getState().lastFocusedPosterKey, "movie:tt4");

// Removing the last card falls back to the new last card.
controller.setFocusedPosterKey("movie:tt5");
items = items.filter((item) => item.id !== "tt5");
await controller.reload({ preserveOverlay: true });
assert.equal(controller.getState().lastFocusedPosterKey, "movie:tt4");

// Detail removal: the screen remounts with a fresh controller.
controller.setFocusedPosterKey("movie:tt2");
controller.dispose();
items = items.filter((item) => item.id !== "tt2");
const remounted = new LibraryController();
await remounted.init();
assert.equal(remounted.getState().lastFocusedPosterKey, "movie:tt4");

// An unchanged library keeps the focused card.
remounted.setFocusedPosterKey("movie:tt1");
await remounted.reload({ preserveOverlay: true });
assert.equal(remounted.getState().lastFocusedPosterKey, "movie:tt1");
remounted.dispose();
console.log("library remove focus ok");
