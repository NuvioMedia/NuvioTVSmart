import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("pluginManager.runWithPool drains aborted head entries and refills concurrency slots", async () => {
  const pluginSource = await readFile(new URL("./pluginManager.js", import.meta.url), "utf8");
  const start = pluginSource.indexOf("async function runWithPool(");
  const end = pluginSource.indexOf("\nasync function executeOne(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const runWithPoolSource = pluginSource.slice(start, end);

  let concurrencyLimit = 1;
  const context = vm.createContext({
    Promise
  });
  vm.runInContext(
    `
    let runningExecutions = 0;
    const queuedExecutions = [];
    const PluginRuntime = { allowedConcurrency: (n) => Math.min(n, __limit()) };
    ${runWithPoolSource}
    globalThis.runWithPool = runWithPool;
    `,
    Object.assign(context, { __limit: () => concurrencyLimit })
  );

  let releaseFirst;
  let ranSecond = false;
  let ranThird = false;
  let ranFourth = false;

  const p1 = context.runWithPool(
    () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve(["first"]);
      }),
    { maxConcurrent: 4 }
  );

  // Task 2 has a signal that turns aborted without listener removal splicing, while Task 3 waits behind it.
  const silentAbortSignal = { aborted: false, addEventListener() {}, removeEventListener() {} };
  const p2 = context.runWithPool(
    async () => {
      ranSecond = true;
      return ["second"];
    },
    { maxConcurrent: 4 },
    silentAbortSignal
  );
  const p3 = context.runWithPool(
    async () => {
      ranThird = true;
      return ["third"];
    },
    { maxConcurrent: 4 }
  );
  const p4 = context.runWithPool(
    async () => {
      ranFourth = true;
      return ["fourth"];
    },
    { maxConcurrent: 4 }
  );

  silentAbortSignal.aborted = true;
  concurrencyLimit = 2;
  releaseFirst();

  assert.deepEqual(Array.from(await p1), ["first"]);
  assert.deepEqual(Array.from(await p2), []);
  assert.deepEqual(Array.from(await p3), ["third"]);
  assert.deepEqual(Array.from(await p4), ["fourth"]);
  assert.equal(ranSecond, false);
  assert.equal(ranThird, true);
  assert.equal(ranFourth, true);
});
