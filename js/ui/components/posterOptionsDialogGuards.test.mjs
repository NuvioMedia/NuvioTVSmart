import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("PosterOptionsDialogController prevents stale mounts after destroy and deduplicates concurrent activations", async () => {
  const source = stripModule(
    await readFile(new URL("./posterOptionsMenu.js", import.meta.url), "utf8")
  );

  let dialogMounts = 0;
  let resolveState;
  let resolveAction;
  let actionCalls = 0;

  class FakeNuvioDialog {
    mount() {
      dialogMounts += 1;
      return this;
    }
    destroy() {}
  }

  const testCtx = vm.createContext({
    document: { body: {} },
    console,
    trackingErrorMessage: () => "",
    I18n: { t: (_k, _p, opts) => opts?.fallback || "" },
    savedLibraryRepository: { isSaved: async () => false },
    libraryRepository: {
      getListTabs: async () => [],
      getMembershipSnapshot: async () => ({ listMembership: {} }),
      getSourceMode: async () => "local",
      applyMembershipChanges: async () => {}
    },
    LibrarySourceMode: { LOCAL: "local", SIMKL: "simkl" },
    watchedItemsRepository: {
      isWatched: async () => false,
      markItem: async () => {},
      unmarkItem: async () => {}
    },
    watchedTitleStateRepository: { markItem: async () => {}, unmarkItem: async () => {} },
    watchProgressRepository: {},
    watchedSeriesReconciliationService: { getSeriesSummary: async () => ({}) },
    supportsMembershipFor: () => true,
    NuvioDialog: FakeNuvioDialog,
    buildWatchedTitleIdSet: () => new Set(),
    isTitleItemWatched: () => false
  });
  testCtx.globalThis = testCtx;
  vm.runInContext(
    `${source}\nglobalThis.PosterOptionsDialogController = PosterOptionsDialogController;`,
    testCtx
  );
  testCtx.createPosterOptionsState = () =>
    new Promise((resolve) => {
      resolveState = resolve;
    });
  testCtx.activatePosterOption = () => {
    actionCalls += 1;
    return new Promise((resolve) => {
      resolveAction = resolve;
    });
  };

  const controller = new testCtx.PosterOptionsDialogController({ onDetails: () => {} });
  const openPromise = controller.open({ id: "tt1", type: "movie", name: "Film" });
  controller.destroy({ restoreFocus: false });
  resolveState({
    item: { id: "tt1", type: "movie", title: "Film" },
    isSaved: false,
    isWatched: false
  });
  assert.equal(await openPromise, false);
  assert.equal(dialogMounts, 0, "destroyed controller must not mount a stale dialog");

  // Re-open validly and verify double Enter / concurrent activateOption deduplication.
  const secondOpen = controller.open({ id: "tt2", type: "movie", name: "Film 2" });
  resolveState({
    item: { id: "tt2", type: "movie", title: "Film 2" },
    isSaved: false,
    isWatched: false
  });
  assert.equal(await secondOpen, true);
  assert.equal(dialogMounts, 1);

  const firstActivation = controller.activateOption("toggleLibrary");
  const duplicateActivation = controller.activateOption("toggleLibrary");
  assert.equal(actionCalls, 1, "concurrent activateOption must be ignored while in flight");
  assert.equal(await duplicateActivation, false);
  resolveAction({ type: "updated", state: controller.state });
  assert.equal(await firstActivation, true);
});
