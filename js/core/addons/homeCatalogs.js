export function catalogRequiresExtras(catalog) {
  // Catalogs that cannot be requested without extra params (required search,
  // genre, ...) belong to the search/discover screens, not the home screen.
  return Array.isArray(catalog?.extra) && catalog.extra.some((entry) => Boolean(entry?.isRequired));
}

export function catalogShouldShowOnHome(catalog = {}) {
  // A required extra (search, genre, ...) makes the catalog unusable as a
  // parameterless Home row; AIOStreams/AIOMetadata also mark those catalogs
  // showInHome=false, but not every addon does.
  if (catalogRequiresExtras(catalog)) {
    return false;
  }
  return catalog?.hasExplicitShowInHome !== true || catalog?.showInHome === true;
}

export function catalogSupportsExtra(catalog = {}, name = "") {
  const target = String(name || "")
    .trim()
    .toLowerCase();
  if (!target) {
    return false;
  }
  return (
    (Array.isArray(catalog?.extra) &&
      catalog.extra.some(
        (entry) =>
          String(entry?.name || entry || "")
            .trim()
            .toLowerCase() === target
      )) ||
    (Array.isArray(catalog?.extraSupported) &&
      catalog.extraSupported.some(
        (entry) =>
          String(entry || "")
            .trim()
            .toLowerCase() === target
      )) ||
    (Array.isArray(catalog?.extraRequired) &&
      catalog.extraRequired.some(
        (entry) =>
          String(entry || "")
            .trim()
            .toLowerCase() === target
      ))
  );
}

function parseAndroidInt(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      return null;
    }
  } else if (!/^[+-]?\d+$/.test(String(value ?? "").trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647
    ? parsed
    : null;
}

export function catalogSkipStep(catalog = {}, defaultStep = 100) {
  const fallback = parseAndroidInt(defaultStep);
  const safeFallback = fallback && fallback > 0 ? fallback : 100;
  const pageSize = parseAndroidInt(catalog?.pageSize);
  if (pageSize && pageSize > 0) {
    return pageSize;
  }

  const skipExtra = Array.isArray(catalog?.extra)
    ? catalog.extra.find(
        (entry) =>
          String(entry?.name || entry || "")
            .trim()
            .toLowerCase() === "skip"
      )
    : null;
  const numericOptions = (Array.isArray(skipExtra?.options) ? skipExtra.options : [])
    .map((option) => parseAndroidInt(option))
    .filter((option) => option !== null && option >= 0)
    .filter((option, index, values) => values.indexOf(option) === index)
    .sort((left, right) => left - right);
  let minimumPositiveDifference = null;
  for (let index = 1; index < numericOptions.length; index += 1) {
    const step = numericOptions[index] - numericOptions[index - 1];
    if (step > 0) {
      minimumPositiveDifference =
        minimumPositiveDifference === null ? step : Math.min(minimumPositiveDifference, step);
    }
  }
  return minimumPositiveDifference || safeFallback;
}

export function buildCatalogOrderKey(addonId, type, catalogId) {
  return `${addonId}_${type}_${catalogId}`;
}

export function buildCatalogDisableKey(addonBaseUrl, type, catalogId, catalogName) {
  return `${addonBaseUrl}_${type}_${catalogId}_${catalogName}`;
}

export function buildCollectionOrderKey(collectionId) {
  const id = String(collectionId || "").trim();
  return id ? `collection_${id}` : "";
}

export function toDisplayTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function customTitleForKey(customTitles = {}, key = "") {
  return String(customTitles?.[key] || "").trim();
}

export function buildOrderedCatalogItems(
  addons,
  savedOrderKeys = [],
  disabledKeys = [],
  customTitles = {}
) {
  return buildOrderedHomeCatalogItems(addons, [], savedOrderKeys, disabledKeys, customTitles);
}

export function buildOrderedHomeCatalogItems(
  addons,
  collections = [],
  savedOrderKeys = [],
  disabledKeys = [],
  customTitles = {}
) {
  const defaultEntries = [];
  const seenKeys = new Set();
  const disabledSet = new Set(disabledKeys || []);

  (addons || []).forEach((addon) => {
    (addon.catalogs || [])
      .filter((catalog) => catalogShouldShowOnHome(catalog))
      .forEach((catalog) => {
        const key = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        defaultEntries.push({
          key,
          disableKey: buildCatalogDisableKey(
            addon.baseUrl,
            catalog.apiType,
            catalog.id,
            catalog.name
          ),
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName,
          catalogId: catalog.id,
          catalogName: customTitleForKey(customTitles, key) || catalog.name,
          originalCatalogName: catalog.name,
          type: catalog.apiType,
          isDisabled: false
        });
      });
  });

  (collections || []).forEach((collection) => {
    const key = buildCollectionOrderKey(collection?.id);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const folderCount = Array.isArray(collection?.folders) ? collection.folders.length : 0;
    defaultEntries.push({
      key,
      disableKey: key,
      addonBaseUrl: "",
      addonId: "",
      addonName: folderCount === 1 ? "1 folder" : `${folderCount} folders`,
      catalogId: collection.id,
      catalogName: customTitleForKey(customTitles, key) || collection.title,
      originalCatalogName: collection.title,
      type: "collection",
      isCollection: true,
      collectionId: collection.id,
      isDisabled: false
    });
  });

  const entryByKey = new Map(defaultEntries.map((entry) => [entry.key, entry]));
  const defaultOrderKeys = defaultEntries.map((entry) => entry.key);
  const savedValid = (savedOrderKeys || []).filter(
    (key, index, array) => array.indexOf(key) === index && entryByKey.has(key)
  );
  const savedSet = new Set(savedValid);
  const effectiveOrder = [...savedValid, ...defaultOrderKeys.filter((key) => !savedSet.has(key))];

  function isEntryDisabled(entry) {
    return disabledSet.has(entry.disableKey) || disabledSet.has(entry.key);
  }

  return effectiveOrder
    .map((key) => entryByKey.get(key))
    .filter(Boolean)
    .map((entry, index, array) => ({
      ...entry,
      disableKey:
        disabledSet.has(entry.key) && !disabledSet.has(entry.disableKey)
          ? entry.key
          : entry.disableKey,
      isDisabled: isEntryDisabled(entry),
      canMoveUp: index > 0,
      canMoveDown: index < array.length - 1
    }));
}
