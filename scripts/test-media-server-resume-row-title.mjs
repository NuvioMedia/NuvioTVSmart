import test from "node:test";
import assert from "node:assert/strict";

// The "Continue watching" row of a media server mixes movies and series, but its
// catalog type is "movie", so Home titled it "Continue watching - Movie". The row
// is named after the server instead, and no type suffix is added to it.

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true
  });
}
globalThis.window = globalThis.window || {
  addEventListener: () => {},
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener: () => {} })
};
globalThis.document = globalThis.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
  addEventListener: () => {},
  documentElement: { style: {} },
  body: {}
};

const { MediaServerRepository } = await import("../js/data/mediaserver/mediaServerRepository.js");
const { formatCatalogRowTitle, isMediaServerResumeRow } =
  await import("../js/ui/screens/home/homeUtils.js");
const { I18n } = await import("../js/i18n/index.js");

const connection = {
  id: "conn-1",
  providerId: "emby",
  address: "http://emby.local:8096",
  name: "Home Emby",
  enabled: true,
  libraries: [
    { id: "lib-shows", name: "TV shows", kind: "series", selected: true },
    { id: "lib-movies", name: "Movies", kind: "movie", selected: true }
  ]
};

function serverCatalogs() {
  const original = MediaServerRepository.connections;
  MediaServerRepository.connections = () => [connection];
  try {
    const [addon] = MediaServerRepository.addons();
    return { addon, catalogs: addon.catalogs };
  } finally {
    MediaServerRepository.connections = original;
  }
}

const rowOf = (addon, catalog) => ({
  addonId: addon.id,
  catalogId: catalog.id,
  catalogName: catalog.name,
  type: catalog.type
});

test("the resume row is named after the server", () => {
  const { catalogs } = serverCatalogs();
  const resume = catalogs.find((catalog) => catalog.id === "resume");
  assert.equal(resume.name, `Home Emby · ${I18n.t("servers_resume_row")}`);
});

test("the resume row gets no type suffix on Home", () => {
  const { addon, catalogs } = serverCatalogs();
  const row = rowOf(
    addon,
    catalogs.find((catalog) => catalog.id === "resume")
  );
  assert.equal(isMediaServerResumeRow(row), true);
  const title = formatCatalogRowTitle(row.catalogName, row.type, !isMediaServerResumeRow(row));
  // formatCatalogRowTitle capitalizes the first letter; nothing else is added.
  assert.equal(title.toLowerCase(), row.catalogName.toLowerCase());
  assert.doesNotMatch(title, / - (Movie|Film)$/i);
});

test("library rows and addon rows keep their type suffix", () => {
  const { addon, catalogs } = serverCatalogs();
  const library = rowOf(
    addon,
    catalogs.find((catalog) => catalog.id === "library-lib-movies")
  );
  assert.equal(isMediaServerResumeRow(library), false);
  assert.equal(
    isMediaServerResumeRow({ addonId: "com.example.addon", catalogId: "resume" }),
    false
  );
  assert.match(formatCatalogRowTitle(library.catalogName, library.type, true), /^Movies - /);
});
