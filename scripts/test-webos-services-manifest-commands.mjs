import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("services.json declares every command registered in services/webos/src/index.js", async () => {
  const [manifestRaw, indexSource] = await Promise.all([
    readFile(new URL("../services/webos/services.json", import.meta.url), "utf8"),
    readFile(new URL("../services/webos/src/index.js", import.meta.url), "utf8")
  ]);
  const manifest = JSON.parse(manifestRaw);
  const declared = new Set(
    (manifest.services || []).flatMap((svc) => (svc.commands || []).map((cmd) => cmd.name))
  );
  const registered = Array.from(
    indexSource.matchAll(/service\.register\(\s*"([^"]+)"/g),
    (m) => m[1]
  );
  assert.equal(registered.length > 0, true);
  for (const name of registered) {
    assert.equal(declared.has(name), true, `Missing command in services.json: ${name}`);
  }
  assert.equal(declared.has("embeddedSubtitleTimeline"), true);
});
