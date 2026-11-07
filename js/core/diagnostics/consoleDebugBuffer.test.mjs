import assert from "node:assert/strict";
import { test } from "node:test";

// Importing the module installs the wrapper on globalThis.console, as it does
// in the app. Keep the original methods quiet for the test run.
const originalWarn = console.warn;
const originalError = console.error;
console.warn = () => {};
console.error = () => {};
const { getConsoleDebugEvents } = await import("./consoleDebugBuffer.js");

function lastEvent() {
  const events = getConsoleDebugEvents();
  return events[events.length - 1];
}

test("object arguments are captured as compact JSON with the same leaf handling as before", () => {
  const error = new Error("boom");
  console.warn("payload", {
    text: "x",
    count: 2,
    ok: true,
    nothing: null,
    missing: undefined,
    big: 10n,
    fn: function named() {},
    nested: { list: [1, "two", { three: 3 }] },
    error
  });
  const event = lastEvent();
  assert.equal(event.level, "warn");
  assert.equal(event.args[0], "payload");
  const parsed = JSON.parse(event.args[1]);
  assert.equal(parsed.text, "x");
  assert.equal(parsed.count, 2);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.nothing, null);
  assert.equal(parsed.missing, null);
  assert.equal(parsed.big, "10n");
  assert.equal(parsed.fn, "[Function named]");
  assert.deepEqual(parsed.nested, { list: [1, "two", { three: 3 }] });
  assert.ok(parsed.error.startsWith("Error: boom"));
  assert.ok(event.message.startsWith("payload {"));
});

test("cycles, depth and entry counts are bounded instead of walked in full", () => {
  const cyclic = { name: "root" };
  cyclic.self = cyclic;
  cyclic.deep = { a: { b: { c: { d: { e: "too deep" } } } } };
  cyclic.wide = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
  cyclic.long = Array.from({ length: 500 }, (_, i) => i);
  console.error(cyclic);
  const parsed = JSON.parse(lastEvent().args[0]);
  assert.equal(parsed.self, "[Circular]");
  assert.equal(parsed.deep.a.b.c, "[Object]");
  assert.equal(Object.keys(parsed.wide).length, 49, "48 entries plus the overflow marker");
  assert.equal(parsed.wide["…"], "152 more keys");
  assert.equal(parsed.long.length, 49);
  assert.equal(parsed.long[48], "… 452 more");
});

test("a huge payload stops serialising once the argument budget is spent", () => {
  const huge = { items: Array.from({ length: 40 }, (_, i) => ({ id: i, text: "y".repeat(400) })) };
  const startedAt = process.hrtime.bigint();
  console.warn(huge);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const event = lastEvent();
  assert.ok(event.args[0].length <= 6000, `argument length ${event.args[0].length}`);
  assert.ok(event.args[0].endsWith("…"), "truncated like before");
  assert.ok(elapsedMs < 50, `serialisation took ${elapsedMs} ms`);
});

test("toJSON is honoured and errors, strings and primitives keep their old formatting", () => {
  console.warn(new Error("direct"), "text", 3, false, undefined, null, 7n, { at: new Date(0) });
  const event = lastEvent();
  assert.ok(event.args[0].startsWith("Error: direct"));
  assert.deepEqual(event.args.slice(1, 7), ["text", "3", "false", "undefined", "null", "7n"]);
  assert.equal(JSON.parse(event.args[7]).at, "1970-01-01T00:00:00.000Z");
});

test("the buffer keeps the newest 300 events", () => {
  for (let index = 0; index < 320; index += 1) {
    console.warn(`line ${index}`);
  }
  const events = getConsoleDebugEvents();
  assert.equal(events.length, 300);
  assert.equal(events[events.length - 1].message, "line 319");
});

test.after(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
