import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);

test("Tizen service modules remain ES5, export onExit, and reset EngineFS started on exit", async () => {
  const [pluginSrc, engineSrc] = await Promise.all([
    readFile(new URL("../services/tizen/plugin-service.js", import.meta.url), "utf8"),
    readFile(new URL("../services/tizen/enginefs-service.js", import.meta.url), "utf8")
  ]);
  assert.equal(
    /\b(?:const|let|class)\b/.test(pluginSrc),
    false,
    "plugin-service.js must remain ES5"
  );

  const pluginMod = { exports: {} };
  const cjsFactory = vm.runInNewContext(
    `(function (exports, require, module) {\n${pluginSrc}\n})`,
    { Buffer, console, process, setTimeout, clearTimeout },
    { filename: "plugin-service.js" }
  );
  cjsFactory(pluginMod.exports, require, pluginMod);
  assert.equal(typeof pluginMod.exports.onExit, "function");
  assert.equal(pluginMod.exports.onExit, pluginMod.exports.onStop);
  pluginMod.exports.onExit();

  assert.match(engineSrc, /function stopEngineFsRuntime\(\)\s*\{[\s\S]*?started\s*=\s*false;/);
});
