import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("audioTranscode avoids Promise.prototype.finally", async () => {
  const source = await readFile(
    new URL("../services/webos/src/audioTranscode.js", import.meta.url),
    "utf8"
  );
  assert.equal(/\.finally\s*\(/.test(source), false);
});

test("audioTranscode avoids the URL class missing from the Tizen 5.0 Node 4.4.3 service", async () => {
  for (const name of [
    "audioTranscode.js",
    "audioTranscodeMatroska.js",
    "audioTranscodeSource.js",
    "audioTranscodeUnits.js"
  ]) {
    const source = await readFile(
      new URL(`../services/webos/src/${name}`, import.meta.url),
      "utf8"
    );
    assert.equal(/\bnew URL\s*\(|require\("url"\)\.URL\b/.test(source), false, name);
  }
});
