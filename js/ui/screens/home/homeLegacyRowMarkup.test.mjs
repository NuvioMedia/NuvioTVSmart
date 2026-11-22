import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

const { Router } = await import("../../navigation/routerState.js");
Router.getCurrent = () => "home";
const { renderLegacyCatalogRowsMarkup } =
  await import("./homeScreenHelpers-13-continue-watching-stream-params.js");

const row = (index, tag = "") => ({
  homeCatalogKey: `addon|movie|catalog${index}`,
  addonId: "addon",
  catalogId: `catalog${index}`,
  catalogName: `Catalog ${index}`,
  type: "movie",
  result: {
    status: "success",
    data: {
      items: [1, 2, 3].map((item) => ({
        id: `tt${index}${item}${tag}`,
        type: "movie",
        name: `Title ${item}${tag}`
      }))
    }
  }
});

test("the media-server resume row keeps its server name and no type suffix", () => {
  const resume = {
    ...row(0),
    addonId: "media-server-conn",
    catalogId: "resume",
    catalogName: "Home Emby · Continue watching"
  };
  const { markup } = renderLegacyCatalogRowsMarkup([resume], {
    layoutMode: "classic",
    showCatalogTypeSuffix: true
  });
  assert.match(markup, /Home Emby · Continue watching/);
  assert.doesNotMatch(markup, /Continue watching - Movie/);
});

for (const layoutMode of ["grid", "classic"]) {
  test(`${layoutMode} rows already mounted are not sent to the DOM again`, () => {
    const first = renderLegacyCatalogRowsMarkup([row(0), row(1)], { layoutMode });
    assert.equal(first.domMarkup, first.markup);

    const next = renderLegacyCatalogRowsMarkup([row(0), row(1, "-changed")], {
      layoutMode,
      mountedRowMarkups: first.rowMarkups
    });
    const [unchanged, changed] = [...next.rowMarkups.keys()];
    assert.match(
      next.domMarkup,
      new RegExp(
        `<section data-row-key="${unchanged.replace(/\|/g, "\\|")}" data-home-row-unchanged></section>`
      )
    );
    assert.ok(next.domMarkup.includes(next.rowMarkups.get(changed)));
    assert.ok(!next.domMarkup.includes(next.rowMarkups.get(unchanged)));
    // The full page markup, used for the unchanged-page check, keeps every row.
    assert.equal(next.markup, next.rowMarkups.get(unchanged) + next.rowMarkups.get(changed));
  });
}
