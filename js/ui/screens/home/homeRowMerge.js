// A background Home refresh resolves only the initial catalog batch before its
// first render. Assigning that batch directly discards every already-rendered
// row outside it, so Home regresses to a stripped-down list and pays two extra
// full rebuilds before the deferred batches restore it.
//
// Merging instead must not resurrect rows the user just removed - Settings is
// where addons and catalogs get disabled, and Home is where you return - so a
// retained row has to still be configured for this load.
export function mergeRefreshedHomeRows(
  existingRows = [],
  fetchedRows = [],
  configuredCatalogKeys = null,
  { background = false } = {}
) {
  const fetched = Array.isArray(fetchedRows) ? fetchedRows : [];
  if (!background) {
    return fetched;
  }

  const existing = Array.isArray(existingRows) ? existingRows : [];
  const isConfigured = (row) => {
    // Rows without a catalog key (collection folders and similar) are not
    // catalog-backed, so the configured-catalog set says nothing about them.
    if (!row?.homeCatalogKey) {
      return true;
    }
    if (!configuredCatalogKeys) {
      return true;
    }
    return configuredCatalogKeys.has(row.homeCatalogKey);
  };

  const merged = new Map();
  existing.filter(isConfigured).forEach((row) => {
    merged.set(row?.homeCatalogKey, row);
  });
  // Freshly fetched rows win over the retained copy of the same catalog.
  fetched.forEach((row) => {
    merged.set(row?.homeCatalogKey, row);
  });
  return Array.from(merged.values());
}
