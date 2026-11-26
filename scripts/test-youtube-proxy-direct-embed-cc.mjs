import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function runProxyFallback(search) {
  const html = readFileSync(new URL("../docs/youtube-proxy.html", import.meta.url), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, "youtube-proxy.html inline script must exist");
  const doc = {
    body: { innerHTML: "" },
    getElementById: () => null,
    head: { appendChild: () => {} },
    createElement: () => ({})
  };
  const win = {
    location: {
      origin: "https://example.test",
      href: `https://example.test/youtube-proxy.html${search}`,
      search
    },
    parent: { postMessage: () => {} },
    document: doc,
    addEventListener: () => {}
  };
  const ctx = vm.createContext({
    window: win,
    document: doc,
    location: win.location,
    encodeURIComponent,
    decodeURIComponent,
    Number,
    String,
    Date,
    JSON,
    Math,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  });
  vm.runInContext(match[1], ctx);
  const srcMatch = doc.body.innerHTML.match(/src="([^"]+)"/i);
  assert.ok(srcMatch, "direct embed iframe src must be rendered");
  return new URL(srcMatch[1]).searchParams;
}

test("youtube-proxy direct-embed fallback sets cc_load_policy and cc_lang_pref from query params", () => {
  const enabledParams = runProxyFallback(
    "?v=dQw4w9WgXcQ&direct=1&cc_load_policy=1&cc_lang_pref=pl"
  );
  assert.equal(enabledParams.get("cc_load_policy"), "1");
  assert.equal(enabledParams.get("cc_lang_pref"), "pl");

  const disabledParams = runProxyFallback(
    "?v=dQw4w9WgXcQ&direct=1&cc_load_policy=0&cc_lang_pref=pl"
  );
  assert.equal(disabledParams.get("cc_load_policy"), "0");
  assert.equal(disabledParams.get("cc_lang_pref"), null);
});
