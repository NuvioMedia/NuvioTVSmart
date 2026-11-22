import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("FocusEngine clears activeBackKeyIdentities and activeKeyDownStartedAt on blur and hidden visibilitychange", () => {
  const source = readFileSync(new URL("./focusEngine.js", import.meta.url), "utf8");
  assert.match(source, /window\.addEventListener\("blur",\s*this\.boundResetActiveKeys\)/);
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange",\s*this\.boundHandleVisibilityReset\)/
  );
  assert.match(source, /this\.activeBackKeyIdentities\.clear\(\)/);
  assert.match(source, /this\.activeKeyDownStartedAt\.clear\(\)/);
});
