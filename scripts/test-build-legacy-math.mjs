import assert from "node:assert/strict";
import test from "node:test";
import { findBalancedMathCall, toLegacyLengthValue } from "./build.mjs";

test("findBalancedMathCall spans the outermost call including nested arguments", () => {
  const input = "width: min(1px, clamp(2px, 3px, 4px)) solid";
  const call = findBalancedMathCall(input);

  assert.equal(call.fn, "min");
  assert.equal(call.argsText, "1px, clamp(2px, 3px, 4px)");
  assert.equal(input.slice(call.start, call.end), "min(1px, clamp(2px, 3px, 4px))");
  assert.equal(findBalancedMathCall("min(1px"), null);
  assert.equal(findBalancedMathCall("minmax(1px, 2px)"), null);
});

test("toLegacyLengthValue lowers nested math expressions to static fallbacks", () => {
  // 3+ nesting levels: clamp > min > var > calc.
  assert.equal(
    toLegacyLengthValue("clamp(12px, min(4vw, var(--gap, calc(20px + 4px))), 48px)"),
    "48px"
  );
  // calc() with a var() inside min() ships in the stylesheets.
  assert.equal(toLegacyLengthValue("min(680px, calc(100% - 2 * var(--gap)))"), "680px");
  // Shallow expressions and sibling calls keep their previous results.
  assert.equal(toLegacyLengthValue("calc(min(1rem, 2vw) + 2px)"), "calc(20px + 2px)");
  assert.equal(toLegacyLengthValue("min(1px, 2px) max(3px, 4px)"), "1px 4px");
  // minmax() is not a math function.
  assert.equal(
    toLegacyLengthValue("repeat(auto-fill, minmax(min(100%, 240px), 1fr))"),
    "repeat(auto-fill, minmax(240px, 1fr))"
  );
});
