import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P2pCacheService.supportsCacheControls delegates to TizenCapabilities.canUseP2p()", () => {
  const source = readFileSync(new URL("./p2pCacheService.js", import.meta.url), "utf8");
  assert.match(
    source,
    /import\s+\{\s*TizenCapabilities\s*\}\s+from\s+"\.\.\/\.\.\/platform\/tizen\/tizenCapabilities\.js"/
  );
  assert.match(
    source,
    /supportsCacheControls\(\)\s*\{\s*return\s+TizenCapabilities\.canUseP2p\(\);\s*\}/
  );
});
