import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function loadHelper(file, fnNames, extraDeps = {}) {
  const shadowedKeys = Object.keys(extraDeps);
  let source = readFileSync(
    new URL(`../js/ui/screens/collection/${file}.js`, import.meta.url),
    "utf8"
  )
    .replace(/^import\b[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^import\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export (async )?function /gm, "$1function ")
    .replace(/^export const /gm, "const ");

  for (const key of shadowedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    source = source.replace(
      new RegExp(`^(?:const|let|var)\\s+${escaped}\\s*=[^;\\n]+;?\\s*$`, "gm"),
      ""
    );
  }

  const returns = fnNames
    .map((name) => `${name}: typeof ${name} !== "undefined" ? ${name} : undefined`)
    .join(", ");
  const factory = new Function(...shadowedKeys, `${source}\nreturn { ${returns} };`);
  return factory(...Object.values(extraDeps));
}

test("normalizeItem and sourceType preserve tv instead of mapping to series", () => {
  const h01 = loadHelper("folderDetailScreenHelpers-01-tmdb-api-url", [
    "normalizeItem",
    "sourceType",
    "buildHeroDisplay"
  ]);

  const item = h01.normalizeItem({ id: "tv-1", type: "tv", name: "Live TV Channel" }, "movie");
  assert.equal(item.type, "tv");
  assert.equal(item.apiType, "tv");

  const hero = h01.buildHeroDisplay(item);
  assert.ok(hero.meta.includes("TV"));
  assert.ok(!hero.meta.includes("Series"));

  assert.equal(h01.sourceType({ type: "tv" }), "tv");
  assert.equal(h01.sourceType({ mediaType: "TV" }), "tv");
  assert.equal(h01.sourceType({ type: "series" }), "series");
});

test("mapTmdbListItem preserves tv mediaType", () => {
  const h01 = loadHelper(
    "folderDetailScreenHelpers-01-tmdb-api-url",
    ["firstNonEmpty", "toImageUrl", "buildPlaceholderPosterDataUrl"],
    {
      TMDB_POSTER_IMAGE_BASE_URL: "https://image.tmdb.org/t/p/w342",
      TMDB_BACKDROP_IMAGE_BASE_URL: "https://image.tmdb.org/t/p/w1280"
    }
  );
  const h03 = loadHelper(
    "folderDetailScreenHelpers-03-set-tmdb-discover-param",
    ["mapTmdbListItem"],
    {
      ...h01,
      normalizeItem: (obj, fallbackType) => ({
        ...obj,
        type: String(obj.type || fallbackType || "movie").toLowerCase()
      })
    }
  );

  const mapped = h03.mapTmdbListItem({ id: 42, name: "TMDB TV Item", poster_path: "/a.jpg" }, "tv");
  assert.equal(mapped.type, "tv");
});

test("mapTraktEntity preserves tv type", () => {
  const h01 = loadHelper(
    "folderDetailScreenHelpers-01-tmdb-api-url",
    ["firstNonEmpty", "bestTraktImage"],
    {
      TRAKT_PAGE_SIZE: 50
    }
  );
  const h04 = loadHelper("folderDetailScreenHelpers-04-map-trakt-entity", ["mapTraktEntity"], {
    ...h01,
    normalizeItem: (obj, fallbackType) => ({
      ...obj,
      type: String(obj.type || fallbackType || "movie").toLowerCase()
    })
  });

  const mapped = h04.mapTraktEntity({ title: "Trakt TV Item", ids: { trakt: 99 } }, "tv");
  assert.equal(mapped.type, "tv");
});
