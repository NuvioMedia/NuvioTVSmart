import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const moduleSource = stripModule(
  await readFile(new URL("./posterOptionsMenu.js", import.meta.url), "utf8")
);

function createHarness() {
  const counts = { mounts: 0, actions: 0, saves: 0, changed: 0, dismissed: 0 };
  const stateRequests = [];
  const actionRequests = [];
  const saveRequests = [];

  class FakeNuvioDialog {
    constructor(options) {
      this.options = options;
      this.title = options.title;
    }
    mount() {
      counts.mounts += 1;
      return this;
    }
    destroy() {}
    setButtonSelected() {}
  }

  const context = vm.createContext({
    document: { body: {} },
    console,
    trackingErrorMessage: () => "",
    I18n: { t: (_key, _params, options) => options?.fallback || "" },
    savedLibraryRepository: { isSaved: async () => false },
    libraryRepository: {
      getListTabs: async () => [],
      getMembershipSnapshot: async () => ({ listMembership: {} }),
      getSourceMode: async () => "local",
      applyMembershipChanges: () => {
        counts.saves += 1;
        const request = deferred();
        saveRequests.push(request);
        return request.promise;
      }
    },
    LibrarySourceMode: { LOCAL: "local", SIMKL: "simkl" },
    watchedItemsRepository: { isWatched: async () => false },
    watchedTitleStateRepository: {},
    watchProgressRepository: {},
    watchedSeriesReconciliationService: {},
    supportsMembershipFor: () => true,
    NuvioDialog: FakeNuvioDialog,
    buildWatchedTitleIdSet: () => new Set(),
    isTitleItemWatched: () => false
  });
  context.globalThis = context;
  vm.runInContext(
    `${moduleSource}\nglobalThis.PosterOptionsDialogController = PosterOptionsDialogController;`,
    context
  );
  context.createPosterOptionsState = () => {
    const request = deferred();
    stateRequests.push(request);
    return request.promise;
  };
  context.activatePosterOption = () => {
    counts.actions += 1;
    const request = deferred();
    actionRequests.push(request);
    return request.promise;
  };

  const controller = new context.PosterOptionsDialogController({
    onDetails: () => {},
    onDismiss: () => {
      counts.dismissed += 1;
    },
    onChanged: () => {
      counts.changed += 1;
    }
  });
  return { controller, counts, stateRequests, actionRequests, saveRequests };
}

const posterState = (id, title = id) => ({
  item: { id, type: "movie", title },
  sourceMode: "trakt",
  membership: {},
  isSaved: false,
  isWatched: false
});

const listPickerState = () => ({
  item: { itemId: "tt1", title: "Film" },
  sourceMode: "trakt",
  tabs: [{ key: "trakt", title: "Trakt" }],
  membership: { trakt: false },
  error: ""
});

async function openValidDialog(harness) {
  const pending = harness.controller.open({ id: "tt1", type: "movie" });
  harness.stateRequests[0].resolve(posterState("tt1"));
  assert.equal(await pending, true);
}

async function openListPicker(harness) {
  await openValidDialog(harness);
  const activation = harness.controller.activateOption("toggleLibrary");
  harness.actionRequests[0].resolve({ type: "listPicker", state: listPickerState() });
  assert.equal(await activation, true);
}

test("aborts a stale open after destroy", async () => {
  const harness = createHarness();
  const pending = harness.controller.open({ id: "tt1", type: "movie" });

  harness.controller.destroy({ restoreFocus: false });
  harness.stateRequests[0].resolve(posterState("tt1"));

  assert.equal(await pending, false);
  assert.equal(harness.counts.mounts, 0);
});

test("mounts only the newest dialog when opens overlap", async () => {
  const harness = createHarness();
  const first = harness.controller.open({ id: "tt1", type: "movie" });
  const second = harness.controller.open({ id: "tt2", type: "movie" });

  harness.stateRequests[1].resolve(posterState("tt2", "Two"));
  assert.equal(await second, true);
  harness.stateRequests[0].resolve(posterState("tt1", "One"));

  assert.equal(await first, false);
  assert.equal(harness.counts.mounts, 1);
  assert.equal(harness.controller.dialog.title, "Two");
});

test("ignores concurrent option activations while one is in flight", async () => {
  const harness = createHarness();
  await openValidDialog(harness);

  const activation = harness.controller.activateOption("toggleLibrary");
  const duplicate = harness.controller.activateOption("toggleLibrary");
  assert.equal(await duplicate, false);

  harness.actionRequests[0].resolve({ type: "updated", state: posterState("tt1") });
  assert.equal(await activation, true);
  assert.equal(harness.counts.actions, 1);
  assert.equal(harness.counts.changed, 1);
});

test("does not apply an option activation that resolves after destroy", async () => {
  const harness = createHarness();
  await openValidDialog(harness);

  const activation = harness.controller.activateOption("toggleLibrary");
  harness.controller.destroy({ restoreFocus: false });
  harness.actionRequests[0].resolve({ type: "updated", state: posterState("tt1") });

  assert.equal(await activation, false);
  assert.equal(harness.counts.changed, 0);
});

test("does not mount the list picker after the poster dialog is dismissed", async () => {
  const harness = createHarness();
  await openValidDialog(harness);

  const activation = harness.controller.activateOption("toggleLibrary");
  harness.controller.dialog.options.onDismiss();
  harness.actionRequests[0].resolve({ type: "listPicker", state: listPickerState() });

  assert.equal(await activation, false);
  assert.equal(harness.counts.mounts, 1);
  assert.equal(harness.controller.dialog, null);
});

test("deduplicates list picker saves", async () => {
  const harness = createHarness();
  await openListPicker(harness);

  const save = harness.controller.activateListPickerOption("saveLibraryLists");
  const duplicate = harness.controller.activateListPickerOption("saveLibraryLists");
  assert.equal(await duplicate, false);

  harness.saveRequests[0].resolve();
  assert.equal(await save, true);
  assert.equal(harness.counts.saves, 1);
  assert.equal(harness.counts.changed, 1);
});

test("does not apply a list picker save that resolves after destroy", async () => {
  const harness = createHarness();
  await openListPicker(harness);

  const save = harness.controller.activateListPickerOption("saveLibraryLists");
  harness.controller.destroy({ restoreFocus: false });
  harness.saveRequests[0].resolve();

  assert.equal(await save, false);
  assert.equal(harness.counts.changed, 0);
});
