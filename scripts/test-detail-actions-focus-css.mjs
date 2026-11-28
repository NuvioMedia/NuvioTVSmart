import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css52 = readFileSync(new URL("../css/components-52.css", import.meta.url), "utf8");
const css54 = readFileSync(new URL("../css/components-54.css", import.meta.url), "utf8");
const css60 = readFileSync(new URL("../css/components-60.css", import.meta.url), "utf8");

function parseRules(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => {
      const idx = chunk.indexOf("{");
      if (idx === -1) return null;
      return {
        selectors: chunk
          .slice(0, idx)
          .split(",")
          .map((s) => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim())
          .filter(Boolean),
        body: chunk
          .slice(idx + 1)
          .replace(/\s+/g, " ")
          .trim()
      };
    })
    .filter(Boolean);
}

// 1. Safe clip buffer inside .detail-hero-body so scale(1.1) never clips.
const heroBodyRule = css52.match(/\.detail-hero-body\s*\{([^}]*)\}/);
assert.ok(heroBodyRule, "components-52.css defines clip buffer on .detail-hero-body");
assert.match(heroBodyRule[1], /padding:\s*8px\s+24px\s+0/);
assert.match(heroBodyRule[1], /margin:\s*-8px\s+-24px\s+0/);

// 2. components-54.css transitions and full-mode 1:1 Android TV scale(1.1) + single 4px ring.
const rules54 = parseRules(css54);
assert.ok(
  rules54.some(
    (r) =>
      r.selectors.includes(".series-detail-actions .series-secondary-btn") &&
      /transition:/.test(r.body)
  ),
  "components-54.css animates .series-detail-actions .series-secondary-btn transitions"
);

for (const sel of [
  ".series-primary-btn.focused",
  ".series-secondary-btn.focused",
  ".series-circle-btn.focused"
]) {
  assert.ok(
    rules54.some((r) => r.selectors.includes(sel) && /transform:\s*scale\(1\.1\)/.test(r.body)),
    `components-54.css applies transform: scale(1.1) to ${sel}`
  );
  assert.ok(
    rules54.some(
      (r) =>
        r.selectors.includes(sel) &&
        /box-shadow:\s*inset 0 0 0 4px var\(--detail-focus-ring\)/.test(r.body)
    ),
    `components-54.css keeps single inset 4px ring on ${sel}`
  );
}

assert.equal(
  /inset 0 0 0 8px/.test(css54),
  false,
  "components-54.css keeps full mode 1:1 with Android TV (no double-inset ring outside performance-constrained)"
);

assert.match(
  css54,
  /@media\s*\(forced-colors:\s*active\)[\s\S]*outline:\s*4px\s+solid\s+Highlight/,
  "components-54.css provides forced-colors outline fallback"
);

// 3. components-60.css must not block detail action focus motion under .legacy-tizen,
//    while preserving the instant non-scaled path under .performance-constrained.
const rules60 = parseRules(css60);
const legacySelectors = rules60.flatMap((r) =>
  r.selectors.filter((s) => s.startsWith(".legacy-tizen "))
);

for (const forbidden of [".series-primary-btn", ".series-secondary-btn", ".series-circle-btn"]) {
  assert.deepEqual(
    legacySelectors.filter(
      (s) => s.includes(forbidden) && !s.startsWith(".legacy-tizen .focusable:not(")
    ),
    [],
    `legacy-tizen must not disable or override focus motion for ${forbidden}`
  );
}

const catchAll = legacySelectors.find((s) =>
  s.startsWith(".legacy-tizen .focusable:not(.home-content-card)")
);
assert.ok(catchAll, "CU-series .focusable catch-all still exists");
for (const excluded of [
  ":not(.series-primary-btn)",
  ":not(.series-secondary-btn)",
  ":not(.series-circle-btn)"
]) {
  assert.ok(catchAll.includes(excluded), `CU-series catch-all must exclude ${excluded}`);
}

assert.ok(
  rules60.some(
    (r) =>
      r.selectors.includes(
        ".performance-constrained .series-detail-actions .series-secondary-btn"
      ) && /transition:\s*none\s*!important/.test(r.body)
  ),
  "performance-constrained disables transitions on .series-secondary-btn"
);

for (const btn of [
  ".performance-constrained .series-primary-btn.focused",
  ".performance-constrained .series-secondary-btn.focused",
  ".performance-constrained .series-circle-btn.focused"
]) {
  assert.ok(
    rules60.some(
      (r) =>
        r.selectors.includes(btn) &&
        /transform:\s*none\s*!important/.test(r.body) &&
        /inset 0 0 0 4px var\(--detail-focus-ring,\s*#ffffff\)/.test(r.body) &&
        /inset 0 0 0 8px var\(--bg-color,\s*#0d0d0d\)/.test(r.body)
    ),
    `performance-constrained keeps transform: none and double-inset ring on ${btn}`
  );
  assert.equal(
    rules60.some((r) => r.selectors.includes(btn) && /scale\(1\.03\)/.test(r.body)),
    false,
    `tizenCardLift must not override ${btn} with scale(1.03)`
  );
}

console.log("detail actions focus css ok");
