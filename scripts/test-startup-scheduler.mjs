// Deferred startup work: runs after the first Home paint, or after the
// fallback delay when the session never reaches Home.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  markFirstHomePaint,
  onFirstHomePaint,
  resetBootTimingsForTests
} from "../js/core/diagnostics/bootTiming.js";
import { runAfterFirstHomePaint } from "../js/runtime/startupScheduler.js";

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a task runs once Home has painted, on its own macrotask", async () => {
  resetBootTimingsForTests();
  const calls = [];
  runAfterFirstHomePaint(() => calls.push("task"), { fallbackMs: 10_000 });
  await flush(5);
  assert.deepEqual(calls, []);
  markFirstHomePaint();
  assert.deepEqual(calls, [], "the task must not extend the frame that painted Home");
  await flush(0);
  assert.deepEqual(calls, ["task"]);
  markFirstHomePaint();
  await flush(0);
  assert.deepEqual(calls, ["task"], "a repeated paint mark must not rerun the task");
});

test("a task registered after the paint runs on the next macrotask", async () => {
  resetBootTimingsForTests();
  markFirstHomePaint();
  const calls = [];
  runAfterFirstHomePaint(() => calls.push("late"));
  assert.deepEqual(calls, []);
  await flush(0);
  assert.deepEqual(calls, ["late"]);
});

test("the fallback delay runs the task when Home never paints", async () => {
  resetBootTimingsForTests();
  const calls = [];
  runAfterFirstHomePaint(() => calls.push("fallback"), { fallbackMs: 15 });
  await flush(5);
  assert.deepEqual(calls, []);
  await flush(25);
  assert.deepEqual(calls, ["fallback"]);
  markFirstHomePaint();
  await flush(0);
  assert.deepEqual(calls, ["fallback"], "a later paint must not rerun the task");
});

test("a failing task does not break the other listeners", async () => {
  resetBootTimingsForTests();
  const calls = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    runAfterFirstHomePaint(() => {
      throw new Error("boom");
    });
    runAfterFirstHomePaint(() => calls.push("second"));
    markFirstHomePaint();
    await flush(0);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(calls, ["second"]);
  assert.equal(warnings.length, 1);
});

test("onFirstHomePaint unsubscribes and tolerates non-functions", () => {
  resetBootTimingsForTests();
  const calls = [];
  const unsubscribe = onFirstHomePaint(() => calls.push("removed"));
  onFirstHomePaint(null);
  unsubscribe();
  markFirstHomePaint();
  assert.deepEqual(calls, []);
});
