import { LocalStore } from "../../core/storage/localStore.js";
import { MdbListAccount } from "./mdbListAccount.js";
import {
  decodeMdbListTabs,
  decodeMdbListItems,
  mdbListItemsPath,
  mdbListNextPage,
  projectMdbListEntries,
  mdbListType,
  readOnlyMdbListKey
} from "./mdbListLibraryCodec.js";
import { supportsMembershipFor } from "../../core/tracking/trackingLibraryMembership.js";

const KEY = "mdbListLibraries";
const TTL = 15 * 60 * 1000;
const inFlight = new Map();
const errors = new Map();
const WATCHLIST = {
  key: "mdblist:watchlist",
  title: "Watchlist",
  type: "watchlist",
  trackingProviderId: "mdblist",
  supportedContentTypes: ["movie", "series"]
};
function invalid() {
  throw Object.assign(new Error("mdblist_invalid_response"), { code: "mdblist_invalid_response" });
}
function read(scope) {
  const cached = LocalStore.get(KEY, {})?.[scope.profileId];
  return cached?.generation === scope.generation
    ? cached
    : { generation: scope.generation, tabs: [WATCHLIST], items: {}, hidden: [], checkedAt: 0 };
}
function save(scope, snapshot) {
  MdbListAccount.check(scope);
  const all = LocalStore.get(KEY, {});
  all[scope.profileId] = snapshot;
  LocalStore.set(KEY, all);
}
async function fetchItems(scope, key, sort = null, order = "asc") {
  const initial = {
    limit: "1000",
    unified: "true",
    ...(sort ? { sort, order } : { append_to_response: "poster,description,genres" })
  };
  let query = initial;
  const seen = new Set(),
    items = new Map();
  for (let index = 0; index < 1000; index++) {
    const fingerprint = JSON.stringify(query);
    if (seen.has(fingerprint)) invalid();
    seen.add(fingerprint);
    const response = await MdbListAccount.api(scope, mdbListItemsPath(key), { query });
    const page = decodeMdbListItems(response.payload);
    const before = items.size;
    for (const item of page) {
      const key = `${item.type}:${item.id}`;
      if (!items.has(key)) items.set(key, item);
    }
    if (readOnlyMdbListKey(key) && page.length && items.size === before) return [...items.values()];
    const next = mdbListNextPage(response.payload, response.headers);
    if (!next) return [...items.values()];
    query = { ...initial, ...next };
  }
  invalid();
}
async function likedTabs(scope, accountId) {
  const all = new Map();
  let query = { limit: "100", offset: "0" };
  const visited = new Set();
  for (let page = 0; page < 100; page++) {
    const key = JSON.stringify(query);
    if (visited.has(key)) invalid();
    visited.add(key);
    const { payload, headers } = await MdbListAccount.api(scope, "/lists/liked", { query });
    const tabs = decodeMdbListTabs(payload?.lists, accountId, "liked");
    tabs.forEach((tab) => {
      if (!all.has(tab.key)) all.set(tab.key, tab);
    });
    const next = mdbListNextPage(payload, headers);
    if (!next) return [...all.values()];
    query = { limit: "100", ...next };
  }
  invalid();
}
async function synchronize(scope, force) {
  const previous = read(scope);
  const account = MdbListAccount.user() || (await MdbListAccount.refreshUser(scope));
  const { payload } = await MdbListAccount.api(scope, "/lists/user", {
    query: { unified: "false", sort: "ranked" }
  });
  const owned = [
    ...decodeMdbListTabs(payload, account.id, "list"),
    ...decodeMdbListTabs(payload, account.id, "dynamic")
  ];
  const known = new Set(previous.tabs.map((tab) => tab.key));
  const hidden = new Set(previous.hidden);
  const newDynamic = owned.filter(
    (tab) => tab.key.startsWith("mdblist:dynamic:") && !known.has(tab.key)
  );
  if (newDynamic.length > 10) newDynamic.forEach((tab) => hidden.add(tab.key));
  const snapshot = {
    ...previous,
    tabs: [WATCHLIST, ...owned],
    orders: {},
    items: { [WATCHLIST.key]: await fetchItems(scope, WATCHLIST.key) }
  };
  const loadTabs = async (tabs, target) => {
    for (const tab of tabs) {
      if (hidden.has(tab.key)) continue;
      const cached = previous.tabs.find((t) => t.key === tab.key);
      target[tab.key] =
        !force &&
        !previous.invalidated &&
        tab.updatedAt &&
        cached?.updatedAt === tab.updatedAt &&
        previous.items[tab.key]
          ? previous.items[tab.key]
          : await fetchItems(scope, tab.key);
    }
  };
  await loadTabs(owned, snapshot.items);
  for (const category of ["external", "liked"]) {
    try {
      const tabs =
        category === "liked"
          ? await likedTabs(scope, account.id)
          : decodeMdbListTabs(
              (await MdbListAccount.api(scope, "/external/lists/user")).payload,
              account.id,
              "external"
            );
      if (category === "liked") {
        const newLiked = tabs.filter((tab) => !known.has(tab.key));
        if (newDynamic.length + newLiked.length > 10)
          newLiked.forEach((tab) => hidden.add(tab.key));
      }
      const items = {};
      await loadTabs(tabs, items);
      snapshot.tabs.push(...tabs);
      Object.assign(snapshot.items, items);
    } catch (error) {
      if (error?.status === 429 || error?.code === "mdblist_scope_changed") throw error;
      const cached = previous.tabs.filter(
        (t) =>
          t.key.startsWith(`mdblist:${category}:`) && (previous.items[t.key] || hidden.has(t.key))
      );
      snapshot.tabs.push(...cached);
      cached.forEach((t) => {
        if (previous.items[t.key]) snapshot.items[t.key] = previous.items[t.key];
      });
    }
  }
  snapshot.hidden = [...hidden].filter((key) => snapshot.tabs.some((tab) => tab.key === key));
  snapshot.checkedAt = Date.now();
  snapshot.invalidated = false;
  save(scope, snapshot);
  return snapshot;
}
function queue(scope, operation) {
  const key = `${scope.profileId}:${scope.generation}`;
  const task = (inFlight.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => {
      MdbListAccount.check(scope);
      return operation();
    });
  inFlight.set(key, task);
  return task.finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
}
function inputIds(input) {
  const id = String(input.itemId || input.id || "");
  const ids = {};
  const imdb = input.imdbId || input.ids?.imdb || id.replace(/^imdb:/, "");
  if (/^tt\d+$/.test(imdb)) ids.imdb = imdb;
  for (const type of ["tmdb", "tvdb", "trakt"]) {
    const raw =
      input[`${type}Id`] ||
      input.ids?.[type] ||
      (id.startsWith(`${type}:`) ? id.slice(type.length + 1) : null);
    if (Number.isSafeInteger(Number(raw)) && Number(raw) > 0) ids[type] = Number(raw);
  }
  const mdblist =
    input.mdblistId ?? input.ids?.mdblist ?? (id.startsWith("mdblist:") ? id.slice(8) : null);
  if (mdblist != null && String(mdblist).trim()) ids.mdblist = String(mdblist).trim();
  return ids;
}
function matches(item, type, ids) {
  return item.type === type && Object.entries(ids).some(([key, value]) => item.ids[key] === value);
}
function metadataBody(name, description, privacy) {
  if (
    !String(name || "").trim() ||
    String(description || "").trim() ||
    !["private", "public"].includes(privacy)
  )
    invalid();
  return { name: String(name).trim(), private: privacy === "private" };
}
async function mutateLibrary(update) {
  const scope = MdbListAccount.scope();
  await MdbListLibrary.snapshot();
  MdbListAccount.check(scope);
  return queue(scope, async () => {
    const snapshot = read(scope);
    try {
      const result = await update(snapshot, scope);
      snapshot.orders = {};
      save(scope, snapshot);
      return result;
    } catch (error) {
      snapshot.invalidated = true;
      try {
        save(scope, snapshot);
      } catch (_) {
        /* The account that owns this snapshot left. */
      }
      throw error;
    }
  });
}
function staticListId(snapshot, key) {
  if (
    !/^mdblist:list:[1-9]\d*$/.test(key) ||
    !snapshot.tabs.some((tab) => tab.key === key && tab.type === "personal")
  )
    invalid();
  return key.slice("mdblist:list:".length);
}

export const MdbListLibrary = {
  async order(key, sortKey) {
    const scope = MdbListAccount.scope();
    await this.snapshot();
    MdbListAccount.check(scope);
    return queue(scope, async () => {
      const snapshot = read(scope);
      if (!snapshot.items[key] || snapshot.hidden.includes(key)) invalid();
      const released = sortKey === "released_asc" || sortKey === "released_desc";
      if (!released && !["added_asc", "added_desc"].includes(sortKey)) invalid();
      const cacheKey = `${key}:${released ? "released_oldest" : sortKey}`;
      let rows = snapshot.orders?.[cacheKey];
      if (!rows) {
        rows = await fetchItems(
          scope,
          key,
          released ? "released" : "added",
          released || sortKey === "added_asc" ? "desc" : "asc"
        );
        if (released) {
          const dates = rows
            .map((item) => item.releaseDate || String(item.year || ""))
            .filter(Boolean);
          if (dates.length && dates[0] > dates[dates.length - 1]) rows.reverse();
        }
        snapshot.orders = { ...snapshot.orders, [cacheKey]: rows };
        save(scope, snapshot);
      }
      const aliases = new Map();
      for (const item of projectMdbListEntries(snapshot))
        for (const [kind, id] of Object.entries(item.ids))
          aliases.set(`${item.type}:${kind}:${id}`, `${item.type}:${item.id}`);
      const keys = rows
        .map((item) =>
          Object.entries(item.ids)
            .map(([kind, id]) => aliases.get(`${item.type}:${kind}:${id}`))
            .find(Boolean)
        )
        .filter(Boolean);
      return sortKey === "released_desc" ? keys.reverse() : keys;
    });
  },
  async createList(name, description, privacy) {
    const body = metadataBody(name, description, privacy);
    return mutateLibrary(async (snapshot, scope) => {
      const { payload } = await MdbListAccount.api(scope, "/lists/user/add", {
        method: "POST",
        body
      });
      if (!Number.isSafeInteger(payload?.id) || payload.id <= 0) invalid();
      const key = `mdblist:list:${payload.id}`;
      snapshot.tabs = [
        ...snapshot.tabs.filter((t) => t.key !== key),
        {
          key,
          title: payload.name || body.name,
          type: "personal",
          privacy,
          isMembershipDestination: true,
          supportedContentTypes: ["movie", "series"],
          trackingProviderId: "mdblist"
        }
      ];
      snapshot.items[key] = [];
      return key;
    });
  },
  async updateList(key, name, description, privacy) {
    const body = metadataBody(name, description, privacy);
    return mutateLibrary(async (snapshot, scope) => {
      const id = staticListId(snapshot, key);
      const { payload } = await MdbListAccount.api(scope, `/lists/${id}`, { method: "PUT", body });
      if (payload?.success !== true || String(payload.id) !== id) invalid();
      snapshot.tabs = snapshot.tabs.map((t) =>
        t.key === key
          ? {
              ...t,
              title: payload.name || body.name,
              privacy: (payload.private ?? body.private) ? "private" : "public"
            }
          : t
      );
    });
  },
  async deleteList(key) {
    return mutateLibrary(async (snapshot, scope) => {
      const id = staticListId(snapshot, key);
      const { payload, status } = await MdbListAccount.api(scope, `/lists/${id}`, {
        method: "DELETE"
      });
      if (status !== 204 && (payload?.success !== true || String(payload.id) !== id)) invalid();
      snapshot.tabs = snapshot.tabs.filter((t) => t.key !== key);
      snapshot.hidden = snapshot.hidden.filter((k) => k !== key);
      delete snapshot.items[key];
    });
  },
  error() {
    const s = MdbListAccount.scope();
    return errors.get(`${s.profileId}:${s.generation}`) || null;
  },
  async snapshot({ force = false } = {}) {
    const scope = MdbListAccount.scope();
    MdbListAccount.check(scope);
    const cached = read(scope);
    const age = Date.now() - cached.checkedAt;
    if (!force && !cached.invalidated && age >= 0 && age < TTL) return cached;
    const key = `${scope.profileId}:${scope.generation}`;
    try {
      let result;
      if (!force && inFlight.has(key)) {
        await inFlight.get(key);
        MdbListAccount.check(scope);
        result = read(scope);
      } else result = await queue(scope, () => synchronize(scope, force));
      errors.delete(key);
      return result;
    } catch (error) {
      MdbListAccount.check(scope);
      errors.set(key, error);
      while (errors.size > 12) errors.delete(errors.keys().next().value);
      if (!force && cached.checkedAt && error?.code !== "mdblist_authorization_revoked")
        return read(scope);
      throw error;
    }
  },
  async tabs() {
    const s = await this.snapshot();
    return s.tabs.filter((t) => !s.hidden.includes(t.key));
  },
  async entries() {
    return projectMdbListEntries(await this.snapshot());
  },
  async options() {
    return (await this.snapshot()).tabs.filter((t) => t.key !== WATCHLIST.key);
  },
  async setVisible(key, visible) {
    const scope = MdbListAccount.scope();
    return queue(scope, async () => {
      const snapshot = read(scope);
      if (key === WATCHLIST.key || !snapshot.tabs.some((t) => t.key === key)) invalid();
      if (visible === !snapshot.hidden.includes(key)) return;
      // Android downloads a hidden list before exposing it again. A failed
      // request leaves both visibility and cached membership unchanged.
      if (visible) snapshot.items[key] = await fetchItems(scope, key);
      else delete snapshot.items[key];
      snapshot.hidden = visible
        ? snapshot.hidden.filter((k) => k !== key)
        : [...new Set([...snapshot.hidden, key])];
      snapshot.orders = {};
      save(scope, snapshot);
    });
  },
  async membership(input) {
    const ids = inputIds(input),
      type = mdbListType(input.itemType || input.type);
    const snapshot = await this.snapshot();
    return {
      listMembership: Object.fromEntries(
        snapshot.tabs
          .filter((tab) => !snapshot.hidden.includes(tab.key))
          .map((tab) => [
            tab.key,
            (snapshot.items[tab.key] || []).some((item) => matches(item, type, ids))
          ])
      )
    };
  },
  async applyMembershipChanges(input, changes) {
    const scope = MdbListAccount.scope();
    await this.snapshot();
    MdbListAccount.check(scope);
    return queue(scope, async () => {
      const snapshot = read(scope),
        type = mdbListType(input.itemType || input.type),
        ids = inputIds(input);
      try {
        for (const [key, desired] of Object.entries(changes?.desiredMembership || {})) {
          if (readOnlyMdbListKey(key)) continue;
          const tab = snapshot.tabs.find((t) => t.key === key);
          if (!tab || !type || !Object.keys(ids).length) invalid();
          if (!supportsMembershipFor(tab, type)) {
            if (!desired) continue;
            invalid();
          }
          const items = snapshot.items[key] || [];
          if (items.some((item) => matches(item, type, ids)) === Boolean(desired)) continue;
          const bucket = type === "movie" ? "movies" : "shows";
          const { payload } = await MdbListAccount.api(
            scope,
            `${mdbListItemsPath(key)}/${desired ? "add" : "remove"}`,
            {
              method: "POST",
              body: { [bucket]: [key === WATCHLIST.key ? { ids } : ids] }
            }
          );
          const rawCount = (name) =>
            typeof payload?.[name] === "object" ? payload[name]?.[bucket] : payload?.[name];
          const count = (name) => Number(rawCount(name) ?? 0);
          const changedKey = desired ? "added" : "removed";
          if (
            rawCount(changedKey) == null ||
            ![changedKey, desired ? "existing" : "not_found", "not_found"].every(
              (name) => Number.isSafeInteger(count(name)) && count(name) >= 0
            ) ||
            count(changedKey) + count(desired ? "existing" : "not_found") !== 1 ||
            (desired && count("not_found") !== 0)
          )
            invalid();
          snapshot.items[key] = items.filter((item) => !matches(item, type, ids));
          snapshot.orders = {};
          if (desired)
            snapshot.items[key].push({
              id: input.itemId || input.id,
              type,
              ids,
              name: input.title || input.name || input.itemId,
              poster: input.poster || null,
              background: input.background || null,
              description: input.description || "",
              genres: input.genres || [],
              listedAt: Date.now(),
              imdbId: ids.imdb || null,
              tmdbId: ids.tmdb || null,
              traktId: ids.trakt || null
            });
          save(scope, snapshot);
        }
      } catch (error) {
        snapshot.invalidated = true;
        try {
          save(scope, snapshot);
        } catch (_) {
          /* Account changed: never write old state. */
        }
        throw error;
      }
    });
  }
};
