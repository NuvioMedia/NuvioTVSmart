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
