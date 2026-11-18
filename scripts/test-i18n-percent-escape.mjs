import assert from "node:assert/strict";
import { test } from "node:test";

const { I18n } = await import("../js/i18n/index.js");

// strings.xml writes a literal percent as "%%", as Android does. The P2P loader
// showed "0%%" because formatting never turned it back into "%".
test('"%%" becomes "%" when a string is formatted with arguments', () => {
  assert.equal(
    I18n.t("missing.torrent.stats", [17, 0, 42], { fallback: "%1$d peers · %2$d seeds · %3$d%%" }),
    "17 peers · 0 seeds · 42%"
  );
  assert.equal(I18n.t("missing.sequential", [5], { fallback: "%d%% done" }), "5% done");
});

test('"%%" stays as written when no argument is formatted, like getString()', () => {
  assert.equal(I18n.t("missing.plain", {}, { fallback: "100%%" }), "100%%");
});
