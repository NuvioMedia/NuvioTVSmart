import test from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key)
};
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute() {}
  }),
  documentElement: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
  body: {},
  querySelector: () => null
};
const { PluginsScreen } = await import("../js/ui/screens/plugin/pluginsScreen.js");
const { PluginManager } = await import("../js/core/player/pluginManager.js");

function screen(repositories) {
  const removed = [];
  PluginManager.removeRepository = async (id) => removed.push(id) > 0;
  const state = Object.assign(Object.create(PluginsScreen), {
    model: { repositories },
    busy: false,
    renders: 0,
    render() {
      this.renders += 1;
    },
    setStatus() {}
  });
  return { state, removed };
}
const target = (action) => ({ dataset: { action }, getAttribute: () => null });
const repos = [{ id: "a" }, { id: "b" }, { id: "c" }];

// Android 2f58e48e5: confirm before deleting a plugin repository.
test("the delete button asks first and No keeps the repository", async () => {
  const { state, removed } = screen(repos);
  await state.activateTarget(target("remove:b"));
  assert.deepEqual(removed, []);
  assert.deepEqual(state.pendingRepositoryRemoval, { repositoryId: "b" });
  assert.equal(state.focusKey, "repo-delete:no");
  await state.activateTarget(target("dismiss-repository-removal"));
  assert.deepEqual(removed, []);
  assert.equal(state.pendingRepositoryRemoval, null);
  assert.equal(state.focusKey, "remove:b", "focus returns to the same delete button");
});

test("Back closes the dialog without deleting", async () => {
  const { state, removed } = screen(repos);
  await state.activateTarget(target("remove:a"));
  assert.equal(state.consumeBackRequest(), true);
  assert.deepEqual(removed, []);
  assert.equal(state.focusKey, "remove:a");
});

test("Yes deletes and moves focus to the next, previous or grouping card", async () => {
  for (const [id, list, focus] of [
    ["b", repos, "remove:c"],
    ["c", repos, "remove:b"],
    ["a", [{ id: "a" }], "global:group"]
  ]) {
    const { state, removed } = screen(list);
    await state.activateTarget(target(`remove:${id}`));
    await state.activateTarget(target("confirm-repository-removal"));
    assert.deepEqual(removed, [id]);
    assert.equal(state.pendingRepositoryRemoval, null);
    assert.equal(state.focusKey, focus);
  }
});
