import { AuthManager } from "../auth/authManager.js";
import { LocalStore } from "../storage/localStore.js";
import { SessionStore } from "../storage/sessionStore.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { HomeCatalogStore } from "../../data/local/homeCatalogStore.js";
import { CollectionsStore, buildCollectionHomeKey } from "../../data/local/collectionsStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { ProfileManager } from "./profileManager.js";
import { buildCatalogDisableKey, buildCatalogOrderKey, catalogShouldShowOnHome } from "../addons/homeCatalogs.js";
import { getSyncBackoffRemainingMs, isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../auth/sessionLifecycle.js";

import { createHomeCatalogSettingsSyncServiceMethods01 } from "./homeCatalogSettingsSyncServiceMethods-01-is-syncing-from-remote.js";

export {
  AuthManager,
  LocalStore,
  SessionStore,
  SupabaseApi,
  addonRepository,
  HomeCatalogStore,
  CollectionsStore,
  buildCollectionHomeKey,
  LayoutPreferences,
  ProfileManager,
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogShouldShowOnHome,
  getSyncBackoffRemainingMs,
  isSyncBackoffActive,
  registerSessionTeardownHandler,
  PULL_RPC,
  PUSH_RPC,
  HOME_CATALOG_SHARED_SYNC_PLATFORM,
  PUSH_DEBOUNCE_MS,
  HIDE_UNRELEASED_CONTENT_KEY,
  HIDE_CATALOG_UNDERLINE_KEY,
  PENDING_PUSH_TOKENS_KEY,
  cachedSharedSettings,
  resolveProfileId,
  cloneValue,
  isPlainObject,
  stableStringify,
  normalizeString,
  decodeJwtPayload,
  currentPullToken,
  readPendingPushTokens,
  markPendingPush,
  clearPendingPush,
  pendingPushVersion,
  normalizeStringArray,
  firstStringArrayFromRaw,
  syncItemKey,
  normalizeSyncItem,
  itemHasIdentity,
  extractSettingsJson,
  extractUpdatedAt,
  buildCatalogEntries,
  buildCollectionEntries,
  buildLocalPayload,
  decodePayload,
  payloadSignature,
  fetchRemoteBlob,
  fetchBestRemotePayload,
  applyPayload,
  mergedSharedPayload
};
const PULL_RPC = "sync_pull_home_catalog_settings";
const PUSH_RPC = "sync_push_home_catalog_settings";
const HOME_CATALOG_SHARED_SYNC_PLATFORM = "home_catalog_shared";
const PUSH_DEBOUNCE_MS = 500;
const HIDE_UNRELEASED_CONTENT_KEY = "hide_unreleased_content";
const HIDE_CATALOG_UNDERLINE_KEY = "hide_catalog_underline";
const PENDING_PUSH_TOKENS_KEY = "homeCatalogSettingsPendingPushTokens";
let cachedSharedSettings = null;

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function currentPullToken(profileId = null) {
  if (!AuthManager.isAuthenticated) {
    return null;
  }
  const userId = normalizeString(decodeJwtPayload(SessionStore.accessToken)?.sub) || "authenticated";
  return `${userId}:${resolveProfileId(profileId)}`;
}

function readPendingPushTokens() {
  const value = LocalStore.get(PENDING_PUSH_TOKENS_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function markPendingPush(token) {
  if (!token) {
    return;
  }
  const pending = readPendingPushTokens();
  pending[token] = Math.max(Date.now(), Number(pending[token] || 0) + 1);
  LocalStore.set(PENDING_PUSH_TOKENS_KEY, pending);
}

function clearPendingPush(token, expectedVersion = null) {
  if (!token) {
    return;
  }
  const pending = readPendingPushTokens();
  if (!Object.prototype.hasOwnProperty.call(pending, token)) {
    return;
  }
  if (expectedVersion != null && pending[token] !== expectedVersion) {
    return;
  }
  delete pending[token];
  LocalStore.set(PENDING_PUSH_TOKENS_KEY, pending);
}

function pendingPushVersion(token) {
  if (!token) {
    return null;
  }
  const value = readPendingPushTokens()[token];
  return value == null ? null : value;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => normalizeString(entry)).filter(Boolean)));
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function firstStringArrayFromRaw(raw = {}, keys = []) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      continue;
    }
    return normalizeStringArray(raw[key]);
  }
  return null;
}

function syncItemKey(item = {}) {
  if (item.is_collection || item.isCollection) {
    return buildCollectionHomeKey({
      id: item.collection_id ?? item.collectionId
    });
  }
  return buildCatalogOrderKey(item.addon_id ?? item.addonId, item.type, item.catalog_id ?? item.catalogId);
}

function normalizeSyncItem(item = {}, fallbackOrder = 0) {
  const isCollection = Boolean(item.is_collection ?? item.isCollection);
  const order = Number(item.order);
  return {
    addon_id: normalizeString(item.addon_id ?? item.addonId),
    type: normalizeString(item.type).toLowerCase(),
    catalog_id: normalizeString(item.catalog_id ?? item.catalogId),
    enabled: item.enabled !== false,
    order: Number.isFinite(order) ? Math.trunc(order) : fallbackOrder,
    custom_title: normalizeString(item.custom_title ?? item.customTitle),
    is_collection: isCollection,
    collection_id: normalizeString(item.collection_id ?? item.collectionId)
  };
}

function itemHasIdentity(item = {}) {
  if (item.is_collection) {
    return Boolean(item.collection_id);
  }
  return Boolean(item.addon_id && item.type && item.catalog_id);
}

function extractSettingsJson(response) {
  const payload = Array.isArray(response) ? response[0] || null : response || null;
  const settingsJson = payload?.settings_json ?? payload?.settingsJson ?? payload;
  return isPlainObject(settingsJson) ? settingsJson : null;
}

function extractUpdatedAt(response) {
  const payload = Array.isArray(response) ? response[0] || null : response || null;
  return normalizeString(payload?.updated_at ?? payload?.updatedAt) || null;
}

function buildCatalogEntries(addons = []) {
  const entries = [];
  const seenKeys = new Set();
  (addons || []).forEach((addon) => {
    (addon.catalogs || [])
      .filter((catalog) => catalogShouldShowOnHome(catalog))
      .forEach((catalog) => {
        const key = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        entries.push({
          key,
          disableKey: buildCatalogDisableKey(addon.baseUrl, catalog.apiType, catalog.id, catalog.name),
          addonId: addon.id,
          type: catalog.apiType,
          catalogId: catalog.id
        });
      });
  });
  return entries;
}

function buildCollectionEntries(collections = []) {
  return (collections || []).map((collection) => ({
    key: buildCollectionHomeKey(collection),
    collectionId: collection.id
  }));
}

function buildLocalPayload(profileId = null, remotePayload = null) {
  return addonRepository.getInstalledAddons().then((addons) => {
    const resolvedProfileId = resolveProfileId(profileId);
    const collections = CollectionsStore.getForProfile(resolvedProfileId);
    const prefs = remotePayload ? payloadPreferences(remotePayload) : HomeCatalogStore.getForProfile(resolvedProfileId);
    const layout = LayoutPreferences.getForProfile(resolvedProfileId);
    const customTitles = prefs.customTitles || {};
    const catalogEntries = buildCatalogEntries(addons);
    const collectionEntries = buildCollectionEntries(collections);
    const entryByKey = new Map([
      ...catalogEntries.map((entry) => [entry.key, { ...entry, isCollection: false }]),
      ...collectionEntries.map((entry) => [entry.key, { ...entry, isCollection: true }])
    ]);
    const allKeys = [...catalogEntries.map((entry) => entry.key), ...collectionEntries.map((entry) => entry.key)];
    const savedValid = (prefs.order || []).filter(
      (key, index, array) => array.indexOf(key) === index && entryByKey.has(key)
    );
    const savedSet = new Set(savedValid);
    const mergedOrder = [...savedValid, ...allKeys.filter((key) => !savedSet.has(key))];
    const disabledSet = new Set(prefs.disabled || []);

    const items = mergedOrder
      .map((key, index) => {
        const entry = entryByKey.get(key);
        if (!entry) {
          return null;
        }
        if (entry.isCollection) {
          return {
            addon_id: "",
            type: "",
            catalog_id: "",
            enabled: !disabledSet.has(entry.key),
            order: index,
            custom_title: normalizeString(customTitles[entry.key]),
            is_collection: true,
            collection_id: entry.collectionId
          };
        }
        return {
          addon_id: entry.addonId,
          type: entry.type,
          catalog_id: entry.catalogId,
          enabled: !disabledSet.has(entry.disableKey) && !disabledSet.has(entry.key),
          order: index,
          custom_title: normalizeString(customTitles[entry.key]),
          is_collection: false,
          collection_id: ""
        };
      })
      .filter(Boolean);

    return {
      hide_unreleased_content: remotePayload
        ? Boolean(remotePayload.hide_unreleased_content)
        : Boolean(layout.hideUnreleasedContent),
      items
    };
  });
}

function decodePayload(settingsJson = {}, localPayload = {}) {
  if (!isPlainObject(settingsJson)) {
    return null;
  }

  const rawItems = Array.isArray(settingsJson.items) ? settingsJson.items : null;
  if (rawItems) {
    return {
      hide_unreleased_content: Object.prototype.hasOwnProperty.call(settingsJson, HIDE_UNRELEASED_CONTENT_KEY)
        ? Boolean(settingsJson.hide_unreleased_content)
        : Boolean(localPayload.hide_unreleased_content),
      hide_catalog_underline: Object.prototype.hasOwnProperty.call(settingsJson, HIDE_CATALOG_UNDERLINE_KEY)
        ? Boolean(settingsJson.hide_catalog_underline)
        : undefined,
      items: rawItems
        .map((item, index) => normalizeSyncItem(item, index))
        .filter(itemHasIdentity)
        .sort((left, right) => left.order - right.order)
    };
  }

  const order = firstStringArrayFromRaw(settingsJson, [
    "catalog_order_keys",
    "home_catalog_order",
    "catalog_order",
    "order"
  ]);
  const disabled = firstStringArrayFromRaw(settingsJson, [
    "disabled_catalog_keys",
    "hidden_catalog_keys",
    "catalog_disabled_keys",
    "home_catalog_disabled",
    "disabled"
  ]);
  if (!order && !disabled) {
    return {
      hide_unreleased_content: Boolean(localPayload.hide_unreleased_content),
      items: []
    };
  }

  const localByKey = new Map((localPayload.items || []).map((item) => [syncItemKey(item), item]));
  const disabledSet = new Set(disabled || []);
  const savedValid = (order || []).filter((key, index, array) => {
    return array.indexOf(key) === index && localByKey.has(key);
  });
  const savedSet = new Set(savedValid);
  const mergedKeys = [
    ...savedValid,
    ...(localPayload.items || []).map((item) => syncItemKey(item)).filter((key) => key && !savedSet.has(key))
  ];
  return {
    hide_unreleased_content: Object.prototype.hasOwnProperty.call(settingsJson, HIDE_UNRELEASED_CONTENT_KEY)
      ? Boolean(settingsJson.hide_unreleased_content)
      : Boolean(localPayload.hide_unreleased_content),
    items: mergedKeys
      .map((key, index) => {
        const item = cloneValue(localByKey.get(key));
        if (!item) {
          return null;
        }
        return {
          ...item,
          enabled: !disabledSet.has(key),
          order: index
        };
      })
      .filter(Boolean)
  };
}

function payloadSignature(payload = {}) {
  return stableStringify({
    hide_unreleased_content: Boolean(payload.hide_unreleased_content),
    items: (payload.items || []).map((item) => ({
      key: syncItemKey(item),
      enabled: item.enabled !== false,
      order: Number(item.order || 0),
      custom_title: normalizeString(item.custom_title ?? item.customTitle)
    }))
  });
}

async function fetchRemoteBlob(profileId, platform) {
  const response = await SupabaseApi.rpc(
    PULL_RPC,
    {
      p_profile_id: resolveProfileId(profileId),
      p_platform: platform
    },
    true
  );
  const settingsJson = extractSettingsJson(response);
  if (!settingsJson) {
    return null;
  }
  return {
    settingsJson,
    updatedAt: extractUpdatedAt(response)
  };
}

async function fetchBestRemotePayload(profileId, localPayload) {
  const scope = currentPullToken(profileId);
  const blob = await fetchRemoteBlob(profileId, HOME_CATALOG_SHARED_SYNC_PLATFORM);
  cachedSharedSettings = {
    scope,
    settingsJson: cloneValue(blob?.settingsJson || {})
  };
  if (!blob) {
    return null;
  }
  const payload = decodePayload(blob.settingsJson, localPayload);
  if (!payload) {
    return null;
  }
  return {
    platform: HOME_CATALOG_SHARED_SYNC_PLATFORM,
    payload,
    updatedAt: blob.updatedAt,
    hasHideUnreleasedContent: Object.prototype.hasOwnProperty.call(blob.settingsJson, HIDE_UNRELEASED_CONTENT_KEY),
    hasHideCatalogUnderline: Object.prototype.hasOwnProperty.call(blob.settingsJson, HIDE_CATALOG_UNDERLINE_KEY)
  };
}

function payloadPreferences(payload = {}) {
  const sortedItems = (payload.items || [])
    .map((item, index) => normalizeSyncItem(item, index))
    .filter(itemHasIdentity)
    .sort((left, right) => left.order - right.order);
  const order = sortedItems.map((item) => syncItemKey(item)).filter(Boolean);
  const disabled = sortedItems
    .filter((item) => item.enabled === false)
    .map((item) => syncItemKey(item))
    .filter(Boolean);
  const customTitles = sortedItems.reduce((accumulator, item) => {
    const key = syncItemKey(item);
    const title = normalizeString(item.custom_title ?? item.customTitle);
    if (key && title) {
      accumulator[key] = title;
    }
    return accumulator;
  }, {});

  return { order, disabled, customTitles };
}

function applyPayload(profileId, payload = {}, effectivePayload = payload) {
  const prefs = payloadPreferences(payload);
  // Keep remote-only identities, then append installed rows in manifest order,
  // as Android does when rebuilding its effective Home catalog order.
  const savedKeys = new Set(prefs.order);
  prefs.order.push(...(effectivePayload.items || []).map(syncItemKey).filter((key) => !savedKeys.has(key)));
  HomeCatalogSettingsSyncService.syncingFromRemoteProfiles.add(resolveProfileId(profileId));
  try {
    HomeCatalogStore.setForProfile(profileId, prefs, { silentSync: true });
    if (Object.prototype.hasOwnProperty.call(payload, HIDE_UNRELEASED_CONTENT_KEY)) {
      LayoutPreferences.setForProfile(
        profileId,
        { hideUnreleasedContent: Boolean(payload.hide_unreleased_content) },
        { silentSync: true }
      );
    }
  } finally {
    HomeCatalogSettingsSyncService.syncingFromRemoteProfiles.delete(resolveProfileId(profileId));
  }
}

async function mergedSharedPayload(profileId, localPayload) {
  const scope = currentPullToken(profileId);
  let remoteJson = cachedSharedSettings?.scope === scope ? cachedSharedSettings.settingsJson || {} : null;
  if (!remoteJson) {
    const remoteBlob = await fetchRemoteBlob(profileId, HOME_CATALOG_SHARED_SYNC_PLATFORM).catch(() => null);
    remoteJson = cloneValue(remoteBlob?.settingsJson || {});
    cachedSharedSettings = { scope, settingsJson: remoteJson };
  }
  const remotePayload = decodePayload(remoteJson, localPayload) || {};
  const remoteTitlesByKey = new Map(
    (remotePayload.items || [])
      .map((item) => [syncItemKey(item), normalizeString(item.custom_title)])
      .filter(([, title]) => title)
  );
  const items = (localPayload.items || []).map((item, index) => ({
    ...item,
    order: index,
    custom_title: normalizeString(item.custom_title) || remoteTitlesByKey.get(syncItemKey(item)) || ""
  }));

  return {
    ...remoteJson,
    ...localPayload,
    hide_catalog_underline: remotePayload.hide_catalog_underline,
    items
  };
}

export const HomeCatalogSettingsSyncService = {
  clearProfile(profileId) {
    const id = resolveProfileId(profileId);
    clearTimeout(this.pushTimers.get(id));
    this.pushTimers.delete(id);
    for (const token of this.completedInitialPullTokens) {
      if (token.endsWith(`:${id}`)) this.completedInitialPullTokens.delete(token);
    }
    if (cachedSharedSettings?.scope?.endsWith(`:${id}`)) cachedSharedSettings = null;
  },
  syncingFromRemoteProfiles: new Set(),
  pushTimers: new Map(),
  completedInitialPullTokens: new Set(),
  syncGeneration: 0,
  lastPullFailed: false,
  ...createHomeCatalogSettingsSyncServiceMethods01()
};

registerSessionTeardownHandler?.(() => {
  HomeCatalogSettingsSyncService.syncGeneration += 1;
  HomeCatalogSettingsSyncService.pushTimers.forEach((timerId) => clearTimeout(timerId));
  HomeCatalogSettingsSyncService.pushTimers.clear();
  HomeCatalogSettingsSyncService.syncingFromRemoteProfiles.clear();
  HomeCatalogSettingsSyncService.completedInitialPullTokens.clear();
  cachedSharedSettings = null;
  return true;
});
