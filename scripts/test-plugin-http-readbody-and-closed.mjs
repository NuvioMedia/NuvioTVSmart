import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("plugin-http.cjs guards readBody against stream errors and checks finished/destroyed in isResponseClosed", () => {
  const source = readFileSync(new URL("../services/plugin-http.cjs", import.meta.url), "utf8");
  assert.match(source, /function isResponseClosed\(response\)/);
  assert.match(source, /response\.writableEnded \|\| response\.finished \|\| response\.destroyed/);
  assert.match(source, /function readBody\(request, callback\)[\s\S]*request\.on\("error"/);
  assert.match(source, /function readBody\(request, callback\)[\s\S]*var settled = false/);
});
