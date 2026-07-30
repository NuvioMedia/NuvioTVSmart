import { AuthManager } from "../auth/authManager.js";
import { SessionStore } from "../storage/sessionStore.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { HomeCatalogStore } from "../../data/local/homeCatalogStore.js";
import { CollectionsStore, buildCollectionHomeKey } from "../../data/local/collectionsStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { ProfileManager } from "./profileManager.js";
import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogRequiresExtras
} from "../addons/homeCatalogs.js";

const PULL_RPC = "sync_pull_home_catalog_settings";
const PUSH_RPC = "sync_push_home_catalog_settings";
const HOME_CATALOG_SHARED_SYNC_PLATFORM = "home_catalog_shared";
const HOME_CATALOG_LEGACY_SYNC_PLATFORMS = ["tv", "mobile"];
const PUSH_DEBOUNCE_MS = 500;
const HIDE_UNRELEASED_CONTENT_KEY = "hide_unreleased_content";
const HIDE_CATALOG_UNDERLINE_KEY = "hide_catalog_underline";

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
  const userId =
    normalizeString(decodeJwtPayload(SessionStore.accessToken)?.sub) || "authenticated";
  return `${userId}:${resolveProfileId(profileId)}`;
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
  return buildCatalogOrderKey(
    item.addon_id ?? item.addonId,
    item.type,
    item.catalog_id ?? item.catalogId
  );
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
      .filter((catalog) => !catalogRequiresExtras(catalog))
      .forEach((catalog) => {
        const key = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        entries.push({
          key,
          disableKey: buildCatalogDisableKey(
            addon.baseUrl,
            catalog.apiType,
            catalog.id,
            catalog.name
          ),
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

function buildLocalPayload(profileId = null) {
  return addonRepository.getInstalledAddons().then((addons) => {
    const resolvedProfileId = resolveProfileId(profileId);
    const collections = CollectionsStore.getForProfile(resolvedProfileId);
    const prefs = HomeCatalogStore.getForProfile(resolvedProfileId);
    const layout = LayoutPreferences.getForProfile(resolvedProfileId);
    const customTitles = prefs.customTitles || {};
    const catalogEntries = buildCatalogEntries(addons);
    const collectionEntries = buildCollectionEntries(collections);
    const entryByKey = new Map([
      ...catalogEntries.map((entry) => [entry.key, { ...entry, isCollection: false }]),
      ...collectionEntries.map((entry) => [entry.key, { ...entry, isCollection: true }])
    ]);
    const allKeys = [
      ...catalogEntries.map((entry) => entry.key),
      ...collectionEntries.map((entry) => entry.key)
    ];
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
      hide_unreleased_content: Boolean(layout.hideUnreleasedContent),
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
      hide_unreleased_content: Object.prototype.hasOwnProperty.call(
        settingsJson,
        HIDE_UNRELEASED_CONTENT_KEY
      )
        ? Boolean(settingsJson.hide_unreleased_content)
        : Boolean(localPayload.hide_unreleased_content),
      hide_catalog_underline: Object.prototype.hasOwnProperty.call(
        settingsJson,
        HIDE_CATALOG_UNDERLINE_KEY
      )
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
    ...(localPayload.items || [])
      .map((item) => syncItemKey(item))
      .filter((key) => key && !savedSet.has(key))
  ];
  return {
    hide_unreleased_content: Object.prototype.hasOwnProperty.call(
      settingsJson,
      HIDE_UNRELEASED_CONTENT_KEY
    )
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

async function fetchRemotePayload(profileId, platform, localPayload) {
  const blob = await fetchRemoteBlob(profileId, platform);
  if (!blob) {
    return null;
  }
  const payload = decodePayload(blob.settingsJson, localPayload);
  if (!payload) {
    return null;
  }
  return {
    platform,
    payload,
    updatedAt: blob.updatedAt,
    hasHideUnreleasedContent: Object.prototype.hasOwnProperty.call(
      blob.settingsJson,
      HIDE_UNRELEASED_CONTENT_KEY
    ),
    hasHideCatalogUnderline: Object.prototype.hasOwnProperty.call(
      blob.settingsJson,
      HIDE_CATALOG_UNDERLINE_KEY
    )
  };
}

function withNewestStandaloneSettings(selected, rows) {
  const hideUnreleasedSource = rows
    .filter((row) => row.hasHideUnreleasedContent)
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    )[0];
  const hideUnderlineSource = rows
    .filter((row) => row.hasHideCatalogUnderline)
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    )[0];

  return {
    ...selected,
    payload: {
      ...selected.payload,
      hide_unreleased_content:
        hideUnreleasedSource?.payload?.hide_unreleased_content ??
        selected.payload.hide_unreleased_content,
      hide_catalog_underline:
        hideUnderlineSource?.payload?.hide_catalog_underline ??
        selected.payload.hide_catalog_underline
    }
  };
}

async function fetchBestRemotePayload(profileId, localPayload) {
  const shared = await fetchRemotePayload(
    profileId,
    HOME_CATALOG_SHARED_SYNC_PLATFORM,
    localPayload
  );
  const legacyRows = (
    await Promise.all(
      HOME_CATALOG_LEGACY_SYNC_PLATFORMS.map((platform) =>
        fetchRemotePayload(profileId, platform, localPayload).catch(() => null)
      )
    )
  ).filter(Boolean);
  const rows = [shared, ...legacyRows].filter(Boolean);
  if (!rows.length) {
    return null;
  }

  const selected =
    rows
      .filter((row) => (row.payload.items || []).length > 0)
      .sort((left, right) =>
        String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
      )[0] ||
    shared ||
    legacyRows.sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    )[0];

  return selected ? withNewestStandaloneSettings(selected, rows) : null;
}

function applyPayload(profileId, payload = {}) {
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

  HomeCatalogSettingsSyncService.syncingFromRemoteProfiles.add(resolveProfileId(profileId));
  try {
    HomeCatalogStore.setForProfile(
      profileId,
      {
        order,
        disabled,
        customTitles
      },
      { silentSync: true }
    );
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
  const remoteBlob = await fetchRemoteBlob(profileId, HOME_CATALOG_SHARED_SYNC_PLATFORM).catch(
    () => null
  );
  const remotePayload = decodePayload(remoteBlob?.settingsJson || {}, localPayload) || {};
  const remoteTitlesByKey = new Map(
    (remotePayload.items || [])
      .map((item) => [syncItemKey(item), normalizeString(item.custom_title)])
      .filter(([, title]) => title)
  );
  const items = (localPayload.items || []).map((item, index) => ({
    ...item,
    order: index,
    custom_title:
      normalizeString(item.custom_title) || remoteTitlesByKey.get(syncItemKey(item)) || ""
  }));

  return {
    ...(remoteBlob?.settingsJson || {}),
    ...localPayload,
    hide_catalog_underline: remotePayload.hide_catalog_underline,
    items
  };
}

export const HomeCatalogSettingsSyncService = {
  syncingFromRemoteProfiles: new Set(),
  pushTimers: new Map(),
  completedInitialPullTokens: new Set(),

  isSyncingFromRemote(profileId = null) {
    return this.syncingFromRemoteProfiles.has(resolveProfileId(profileId));
  },

  async pull(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    const pullToken = currentPullToken(resolvedProfileId);
    try {
      const localPayload = await buildLocalPayload(resolvedProfileId);
      const remote = await fetchBestRemotePayload(resolvedProfileId, localPayload);
      if (!remote || !(remote.payload.items || []).length) {
        if (pullToken) {
          this.completedInitialPullTokens.add(pullToken);
        }
        return false;
      }
      if (payloadSignature(remote.payload) === payloadSignature(localPayload)) {
        if (pullToken) {
          this.completedInitialPullTokens.add(pullToken);
        }
        return false;
      }
      applyPayload(resolvedProfileId, remote.payload);
      if (pullToken) {
        this.completedInitialPullTokens.add(pullToken);
      }
      return true;
    } catch (error) {
      console.warn("Home catalog settings sync pull failed", error);
      return false;
    }
  },

  async push(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    if (this.isSyncingFromRemote(resolvedProfileId)) {
      return false;
    }
    try {
      const localPayload = await buildLocalPayload(resolvedProfileId);
      const payload = await mergedSharedPayload(resolvedProfileId, localPayload);
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_platform: HOME_CATALOG_SHARED_SYNC_PLATFORM,
          p_settings_json: payload
        },
        true
      );
      return true;
    } catch (error) {
      console.warn("Home catalog settings sync push failed", error);
      return false;
    }
  },

  triggerPush(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    const pullToken = currentPullToken(resolvedProfileId);
    if (!pullToken || !this.completedInitialPullTokens.has(pullToken)) {
      return;
    }
    if (this.isSyncingFromRemote(resolvedProfileId)) {
      return;
    }
    const existingTimer = this.pushTimers.get(resolvedProfileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timerId = setTimeout(() => {
      this.pushTimers.delete(resolvedProfileId);
      void this.push(resolvedProfileId);
    }, PUSH_DEBOUNCE_MS);
    this.pushTimers.set(resolvedProfileId, timerId);
  }
};
