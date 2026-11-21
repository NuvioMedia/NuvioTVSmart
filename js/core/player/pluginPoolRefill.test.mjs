import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// runWithPool is module-private; load it alone into a sandbox so the scraper
// pool can be driven deterministically.
async function createPool() {
  const source = await readFile(new URL("./pluginManager.js", import.meta.url), "utf8");
  const start = source.indexOf("async function runWithPool(");
  const end = source.indexOf("\nasync function executeOne(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const limit = { value: 1 };
  const context = vm.createContext({ Promise });
  vm.runInContext(
    `
    let runningExecutions = 0;
    const queuedExecutions = [];
    const PluginRuntime = { allowedConcurrency: (max) => Math.min(max, __limit()) };
    ${source.slice(start, end)}
    globalThis.runWithPool = runWithPool;
    `,
    Object.assign(context, { __limit: () => limit.value })
  );
  return { context, limit };
}

function deferred() {
  const box = {};
  box.promise = new Promise((resolve) => {
    box.resolve = resolve;
  });
  return box;
}

function trackedTask(name, started) {
  const execution = deferred();
  return {
    execution,
    task: () => {
      started.push(name);
      return execution.promise;
    }
  };
}

test("queue fills every free slot when the adaptive concurrency limit grows", async () => {
  const { context, limit } = await createPool();
  const started = [];
  const first = deferred();
  const tasks = ["p2", "p3", "p4"].map((name) => trackedTask(name, started));

  const running = [context.runWithPool(() => first.promise, { maxConcurrent: 4 })];
  running.push(...tasks.map((entry) => context.runWithPool(entry.task, { maxConcurrent: 4 })));
  assert.deepEqual(started, [], "only one slot exists until the governor recovers");

  // Memory pressure clears (or the governor scale recovers) during the batch.
  limit.value = 4;
  first.resolve(["first"]);
  await running[0];

  // Android's semaphore hands every available permit to a waiting scraper, so
  // the whole free capacity is used as soon as it exists.
  assert.deepEqual(started, ["p2", "p3", "p4"]);

  tasks.forEach((entry) => entry.execution.resolve([]));
  await Promise.all(running);
});

test("a shrinking pool keeps the queue order and never exceeds its slot count", async () => {
  const { context, limit } = await createPool();
  const started = [];
  const first = trackedTask("p1", started);
  const second = trackedTask("p2", started);
  const third = trackedTask("p3", started);
  const fourth = trackedTask("p4", started);

  limit.value = 2;
  const running = [
    context.runWithPool(first.task, { maxConcurrent: 4 }),
    context.runWithPool(second.task, { maxConcurrent: 4 }),
    context.runWithPool(third.task, { maxConcurrent: 4 }),
    context.runWithPool(fourth.task, { maxConcurrent: 4 })
  ];
  assert.deepEqual(started, ["p1", "p2"]);

  // The governor shrinks the pool while p3 and p4 wait.
  limit.value = 1;
  first.execution.resolve(["first"]);
  await running[0];
  assert.deepEqual(started, ["p1", "p2"], "no slot is free at the lower limit");

  second.execution.resolve(["second"]);
  await running[1];
  assert.deepEqual(started, ["p1", "p2", "p3"], "the head keeps its place");

  third.execution.resolve(["third"]);
  await running[2];
  assert.deepEqual(started, ["p1", "p2", "p3", "p4"]);

  fourth.execution.resolve(["fourth"]);
  await Promise.all(running);
});
