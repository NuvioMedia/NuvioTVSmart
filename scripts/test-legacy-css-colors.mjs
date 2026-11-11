// Old Tizen/webOS engines reject rgb(var(--x-rgb) / a): the declaration wins the
// cascade and then becomes invalid at computed-value time, so the surface just
// disappears. They need the comma token. This guards both halves of that rule.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const cssDir = new URL("../css/", import.meta.url);
const files = (await readdir(cssDir)).filter((name) => name.endsWith(".css"));
const sheets = await Promise.all(files.map((name) => readFile(new URL(name, cssDir), "utf8")));

const base = await readFile(new URL("../css/base.css", import.meta.url), "utf8");
const theme = await readFile(new URL("../js/ui/theme/themeManager.js", import.meta.url), "utf8");

const used = new Set(
  [...sheets.join("\n").matchAll(/var\((--[a-z0-9-]+-rgb-legacy)\)/g)].map((m) => m[1])
);
const inBase = new Set([...base.matchAll(/(--[a-z0-9-]+-rgb-legacy)\s*:/g)].map((m) => m[1]));
const inTheme = new Set([...theme.matchAll(/"(--[a-z0-9-]+-rgb-legacy)"/g)].map((m) => m[1]));

for (const token of used) {
  assert.ok(inBase.has(token), `${token} is used but not defined in css/base.css`);
  assert.ok(inTheme.has(token), `${token} is not derived by the theme manager`);
}

const modern = sheets.join("\n").match(/rgb\(var\(--[a-z0-9-]+-rgb\)\s*\/\s*[0-9.]+\)/);
assert.equal(modern, null, `space-separated rgb() is invisible on Tizen 5: ${modern?.[0]}`);

console.log(`legacy colour tokens ok (${used.size} tokens)`);
