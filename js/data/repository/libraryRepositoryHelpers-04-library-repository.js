import { AddonEventDispatcher, AddonLibraryAction, ADDON_LIBRARY_RESOURCE } from "./addonEventDispatcher.js";
import { MdbListAccount } from "./mdbListAccount.js";
import { MdbListLibrary } from "./mdbListLibrary.js";
/* eslint-disable no-unused-vars */

import { AuthManager } from "../../core/auth/authManager.js";

import { toTraktImageUrl } from "../../core/trakt/traktImageUrl.js";

import { SavedLibrarySyncService } from "../../core/profile/savedLibrarySyncService.js";

import { ProfileManager } from "../../core/profile/profileManager.js";

import { LocalStore } from "../../core/storage/localStore.js";

import { savedLibraryRepository } from "./savedLibraryRepository.js";

import { metaRepository } from "./metaRepository.js";

import { requestJson, TraktAuthService } from "./traktAuthService.js";

import { TraktLibrarySourceMode, TraktSettingsStore } from "../local/traktSettingsStore.js";

import { SimklAuthService } from "./simklAuthService.js";

import { SimklSyncService } from "./simklSyncService.js";

import {
  readRemoteState,
  TRAKT_LIBRARY_CACHE_TTL_MS,
  LibrarySourceMode,
  WATCHLIST_KEY,
  LibraryListType,
  SIMKL_DEFAULT_LIST_KEY,
  normalizeSavedItem,
  toRemoteListItem,
  PERSONAL_KEY_PREFIX,
  writeRemoteState,
  LibraryListPrivacy,
  toSavedItemFromTraktWatchlist,
  createEmptyRemoteState,
  isMissingResourceError
} from "./libraryRepositoryHelpers-01-library-source-mode.js";
import {
  getRemotePersonalTabs,
  hydrateEntries,
  getRemoteEntries,
  getLocalEntries,
  membershipMapFromEntries,
  upsertPersonalItem,
  removePersonalItem
} from "./libraryRepositoryHelpers-02-merge-item-into-map.js";
import {
  buildTraktMutationBody,
  authorizedTraktRequest,
  toPersonalList,
  fetchTraktPersonalState
} from "./libraryRepositoryHelpers-03-authorized-trakt-request.js";

export class LibraryRepository {
  constructor() {
    this.traktRefreshPromise = null;
  }

  async ensureFreshTraktState() {
    const state = await readRemoteState();
    if (Date.now() - state.syncedAt <= TRAKT_LIBRARY_CACHE_TTL_MS) {
      return;
    }
    if (!this.traktRefreshPromise) {
      this.traktRefreshPromise = this.refreshNow().finally(() => {
        this.traktRefreshPromise = null;
      });
    }
    await this.traktRefreshPromise;
  }

  async getSourceMode() {
    const selectedMode = TraktSettingsStore.get().librarySourceMode;
    if (selectedMode === TraktLibrarySourceMode.MDBLIST) {
      return MdbListAccount.connected() ? LibrarySourceMode.MDBLIST : LibrarySourceMode.LOCAL;
    }
    if (selectedMode === TraktLibrarySourceMode.SIMKL) {
      return SimklAuthService.isAuthenticated() ? LibrarySourceMode.SIMKL : LibrarySourceMode.LOCAL;
    }
    if (selectedMode !== TraktLibrarySourceMode.TRAKT) {
      return LibrarySourceMode.LOCAL;
    }
    const traktToken = await TraktAuthService.getValidAccessToken().catch(() => null);
    if (!traktToken) {
      return LibrarySourceMode.LOCAL;
    }
    return LibrarySourceMode.TRAKT;
  }

  async getListTabs({ sourceMode = null } = {}) {
    const resolvedSourceMode = sourceMode || (await this.getSourceMode());
    if (resolvedSourceMode === LibrarySourceMode.MDBLIST) return MdbListLibrary.tabs();
    if (resolvedSourceMode === LibrarySourceMode.LOCAL) {
      return [];
    }
    if (resolvedSourceMode === LibrarySourceMode.SIMKL) {
      return SimklSyncService.getLibraryTabs();
    }
    await this.ensureFreshTraktState();
    const personalTabs = await getRemotePersonalTabs();
    return [
      {
        key: WATCHLIST_KEY,
        title: "Watchlist",
        type: LibraryListType.WATCHLIST,
        traktListId: null,
        slug: null,
        description: null,
        privacy: null,
        sortBy: null,
        sortHow: null
      },
      ...personalTabs
    ];
  }

  async getItems({ hydrate = true, sourceMode = null } = {}) {
    const resolvedSourceMode = sourceMode || (await this.getSourceMode());
    if (resolvedSourceMode === LibrarySourceMode.MDBLIST) {
      const entries = await MdbListLibrary.entries();
      return hydrate ? hydrateEntries(entries) : entries;
    }
    if (resolvedSourceMode === LibrarySourceMode.TRAKT) {
      await this.ensureFreshTraktState();
    }
    if (resolvedSourceMode === LibrarySourceMode.SIMKL) {
      const entries = await SimklSyncService.getLibraryEntries();
      return hydrate ? hydrateEntries(entries) : entries;
    }
    return resolvedSourceMode === LibrarySourceMode.TRAKT ? getRemoteEntries({ hydrate }) : getLocalEntries({ hydrate });
  }

  async hydrateItems(items, options = {}) {
    return hydrateEntries(items, options);
  }

  async getMembershipSnapshot(item, { sourceMode = null } = {}) {
    const resolvedSourceMode = sourceMode || (await this.getSourceMode());
    if (resolvedSourceMode === LibrarySourceMode.MDBLIST) return MdbListLibrary.membership(item);
    if (resolvedSourceMode === LibrarySourceMode.LOCAL) {
      const exists = await savedLibraryRepository.isSaved(item.itemId || item.id || "");
      return { listMembership: { local: exists } };
    }
    if (resolvedSourceMode === LibrarySourceMode.SIMKL) {
      return SimklSyncService.getMembershipSnapshot(item);
    }
    const [entries, listTabs] = await Promise.all([
      this.getItems({ sourceMode: resolvedSourceMode }),
      this.getListTabs({ sourceMode: resolvedSourceMode })
    ]);
    return membershipMapFromEntries(entries, listTabs)(item);
  }

  /**
   * Android withAddonLibraryEvent: a user change that moves the title in or out of the
   * library tells the Stremio add-ons that declare the "library" resource.
   */
  async withAddonLibraryEvent(item, sourceMode, mutation) {
    if (!AddonEventDispatcher.hasEnabledAddonFor(ADDON_LIBRARY_RESOURCE)) {
      return mutation();
    }
    const inLibrary = async () =>
      Object.values((await this.getMembershipSnapshot(item, { sourceMode }).catch(() => null))?.listMembership || {}).some(Boolean);
    const wasInLibrary = await inLibrary();
    const result = await mutation();
    if (result?.requiresRemovalConfirmation) {
      return result;
    }
    const isInLibraryNow = await inLibrary();
    if (wasInLibrary !== isInLibraryNow) {
      AddonEventDispatcher.library(
        String(item.itemType || item.type || item.contentType || "movie"),
        String(item.itemId || item.id || item.contentId || ""),
        isInLibraryNow ? AddonLibraryAction.LIBRARY_ADD : AddonLibraryAction.LIBRARY_REMOVE
      );
    }
    return result;
  }

  async toggleDefault(item, options = {}) {
    const sourceMode = await this.getSourceMode();
    return this.withAddonLibraryEvent(item, sourceMode, () => this.toggleDefaultInternal(item, { ...options, sourceMode }));
  }

  async toggleDefaultInternal(item, options = {}) {
    const profileId = ProfileManager.getActiveProfileId();
    const sourceMode = options.sourceMode || (await this.getSourceMode());
    const mdbListScope = sourceMode === LibrarySourceMode.MDBLIST ? MdbListAccount.scope() : null;
    if (mdbListScope && mdbListScope.profileId !== String(profileId))
      throw Object.assign(new Error("Profile changed"), { code: "mdblist_scope_changed" });
    const snapshot = await this.getMembershipSnapshot(item, { sourceMode });
    if (mdbListScope) MdbListAccount.check(mdbListScope);
    const currentMembership = snapshot?.listMembership || {};
    let desiredMembership;

    if (sourceMode === LibrarySourceMode.MDBLIST) {
      desiredMembership = { ...currentMembership, ["mdblist:watchlist"]: currentMembership["mdblist:watchlist"] !== true };
    } else if (sourceMode === LibrarySourceMode.TRAKT) {
      desiredMembership = {
        ...currentMembership,
        [WATCHLIST_KEY]: currentMembership[WATCHLIST_KEY] !== true
      };
    } else if (sourceMode === LibrarySourceMode.SIMKL) {
      const hasMembership = Object.values(currentMembership).some(Boolean);
      desiredMembership = Object.fromEntries(
        Object.keys(currentMembership).map((key) => [key, !hasMembership && key === SIMKL_DEFAULT_LIST_KEY])
      );
      if (!Object.keys(desiredMembership).length && !hasMembership) {
        desiredMembership = { [SIMKL_DEFAULT_LIST_KEY]: true };
      }
    } else {
      desiredMembership = { local: currentMembership.local !== true };
    }

    try {
      await this.applyMembershipChangesInternal(item, { desiredMembership }, { ...options, sourceMode });
    } catch (error) {
      if (error?.code === "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED") {
        return {
          sourceMode,
          desiredMembership,
          isSavedInLibrary: true,
          requiresRemovalConfirmation: true
        };
      }
      throw error;
    }

    return {
      sourceMode,
      desiredMembership,
      isSavedInLibrary: Object.values(desiredMembership).some(Boolean),
      requiresRemovalConfirmation: false
    };
  }

  async applyMembershipChanges(item, changes, options = {}) {
    const sourceMode = options?.sourceMode || (await this.getSourceMode());
    return this.withAddonLibraryEvent(item, sourceMode, () =>
      this.applyMembershipChangesInternal(item, changes, { ...options, sourceMode })
    );
  }

  async applyMembershipChangesInternal(item, changes, options = {}) {
    const sourceMode = options?.sourceMode || (await this.getSourceMode());
    if (sourceMode === LibrarySourceMode.MDBLIST) return MdbListLibrary.applyMembershipChanges(item, changes);
    if (sourceMode === LibrarySourceMode.LOCAL) {
      const shouldSave = Object.values(changes?.desiredMembership || {}).some(Boolean);
      if (shouldSave) {
        await savedLibraryRepository.save(normalizeSavedItem(item));
      } else {
        await savedLibraryRepository.remove(item.itemId || item.id || "");
      }
      return;
    }
    if (sourceMode === LibrarySourceMode.SIMKL) {
      await SimklSyncService.applyMembershipChanges(item, changes, options);
      return;
    }

    const desiredMembership = changes?.desiredMembership || {};
    const currentSnapshot = await this.getMembershipSnapshot(item, { sourceMode });
    let remoteState = await readRemoteState();

    for (const [listKey, desired] of Object.entries(desiredMembership)) {
      const before = currentSnapshot.listMembership?.[listKey] === true;
      const after = desired === true;
      if (before === after) {
        continue;
      }
      const body = buildTraktMutationBody(item);
      if (listKey === WATCHLIST_KEY) {
        await authorizedTraktRequest(after ? "/sync/watchlist" : "/sync/watchlist/remove", {
          method: "POST",
          body,
          errorMessage: after ? "Could not add item to Trakt watchlist" : "Could not remove item from Trakt watchlist"
        });
        remoteState.watchlist = after
          ? [
              toRemoteListItem(item, { listedAt: Date.now() }),
              ...(remoteState.watchlist || []).filter(
                (entry) =>
                  !(
                    String(entry.contentId) === String(item.itemId || item.id || "") &&
                    String(entry.contentType || "movie") === String(item.itemType || item.type || "movie")
                  )
              )
            ]
          : (remoteState.watchlist || []).filter(
              (entry) =>
                !(
                  String(entry.contentId) === String(item.itemId || item.id || "") &&
                  String(entry.contentType || "movie") === String(item.itemType || item.type || "movie")
                )
            );
        continue;
      }
      const listId = String(listKey).replace(PERSONAL_KEY_PREFIX, "");
      await authorizedTraktRequest(`/users/me/lists/${encodeURIComponent(listId)}/items${after ? "" : "/remove"}`, {
        method: "POST",
        body,
        errorMessage: after ? "Could not add item to Trakt list" : "Could not remove item from Trakt list"
      });
      remoteState = after ? upsertPersonalItem(remoteState, listKey, item) : removePersonalItem(remoteState, listKey, item);
    }

    await writeRemoteState(remoteState);
  }

  async getListWriterMode() {
    const profileId = ProfileManager.getActiveProfileId();
    const mode = await this.getSourceMode();
    if (ProfileManager.getActiveProfileId() !== profileId)
      throw Object.assign(new Error("Profile changed"), { code: "mdblist_scope_changed" });
    if (![LibrarySourceMode.TRAKT, LibrarySourceMode.MDBLIST].includes(mode))
      throw new Error("This provider does not support list management");
    return mode;
  }

  async createPersonalList(name, description, privacy) {
    if ((await this.getListWriterMode()) === LibrarySourceMode.MDBLIST) return MdbListLibrary.createList(name, description, privacy);
    const { payload } = await authorizedTraktRequest("/users/me/lists", {
      method: "POST",
      body: {
        name: String(name || "Untitled"),
        description: description || null,
        privacy: privacy || LibraryListPrivacy.PRIVATE
      },
      errorMessage: "Could not create Trakt list"
    });
    const created = toPersonalList(payload);
    if (!created) {
      throw new Error("Trakt returned an invalid list");
    }
    const state = await readRemoteState();
    state.lists = [...state.lists.filter((list) => list.key !== created.key), created];
    state.listItems[created.key] = state.listItems[created.key] || [];
    await writeRemoteState(state);
    return created.key;
  }

  async updatePersonalList(listId, name, description, privacy) {
    if ((await this.getListWriterMode()) === LibrarySourceMode.MDBLIST)
      return MdbListLibrary.updateList(listId, name, description, privacy);
    const { payload } = await authorizedTraktRequest(`/users/me/lists/${encodeURIComponent(String(listId))}`, {
      method: "PUT",
      body: {
        name: String(name || "Untitled"),
        description: description || null,
        privacy: privacy || LibraryListPrivacy.PRIVATE
      },
      errorMessage: "Could not update Trakt list"
    });
    const updated = toPersonalList(payload);
    const state = await readRemoteState();
    state.lists = state.lists.map((list) => {
      if (String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, "") !== String(listId)) {
        return list;
      }
      return {
        ...list,
        ...(updated || {}),
        key: list.key,
        title: String(updated?.title || name || list.title || "Untitled"),
        description: updated?.description ?? description ?? null,
        privacy: updated?.privacy || privacy || list.privacy || LibraryListPrivacy.PRIVATE
      };
    });
    await writeRemoteState(state);
  }

  async deletePersonalList(listId) {
    if ((await this.getListWriterMode()) === LibrarySourceMode.MDBLIST) return MdbListLibrary.deleteList(listId);
    await authorizedTraktRequest(`/users/me/lists/${encodeURIComponent(String(listId))}`, {
      method: "DELETE",
      errorMessage: "Could not delete Trakt list"
    });
    const state = await readRemoteState();
    const match = state.lists.find((list) => {
      return String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, "") === String(listId);
    });
    if (!match) {
      return;
    }
    state.lists = state.lists.filter((list) => list.key !== match.key);
    delete state.listItems[match.key];
    await writeRemoteState(state);
  }

  async reorderPersonalLists(orderedListIds = []) {
    if ((await this.getListWriterMode()) === LibrarySourceMode.MDBLIST) throw new Error("MDBList does not support list reordering");
    const rank = orderedListIds
      .map((id) => Number(String(id).replace(PERSONAL_KEY_PREFIX, "")))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!rank.length) return;
    await authorizedTraktRequest("/users/me/lists/reorder", {
      method: "POST",
      body: { rank },
      errorMessage: "Could not reorder Trakt lists"
    });
    const state = await readRemoteState();
    const byId = new Map(state.lists.map((list) => [String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, ""), list]));
    const reordered = orderedListIds.map((id) => byId.get(String(id).replace(PERSONAL_KEY_PREFIX, ""))).filter(Boolean);
    const untouched = state.lists.filter((list) => !reordered.some((entry) => entry.key === list.key));
    state.lists = [...reordered, ...untouched];
    await writeRemoteState(state);
  }

  async refreshNow() {
    const sourceMode = await this.getSourceMode();
    if (sourceMode === LibrarySourceMode.MDBLIST) {
      await MdbListLibrary.snapshot({ force: true });
      return true;
    }
    if (sourceMode === LibrarySourceMode.TRAKT) {
      if (!TraktAuthService.isAuthenticated()) return false;
      try {
        const [watchlistItems, personal] = await Promise.all([TraktAuthService.fetchWatchlist({ limit: 200 }), fetchTraktPersonalState()]);
        const rawItems = watchlistItems.map(toSavedItemFromTraktWatchlist).filter(Boolean);
        const state = createEmptyRemoteState();
        state.syncedAt = Date.now();
        state.watchlist = rawItems;
        state.lists = personal.lists;
        personal.lists.forEach((list, index) => {
          state.listItems[list.key] = personal.itemGroups[index] || [];
        });
        await writeRemoteState(state);
        return true;
      } catch (error) {
        console.warn("[LIB] Trakt library fetch failed", error);
        return false;
      }
    }
    if (sourceMode === LibrarySourceMode.SIMKL) {
      try {
        return await SimklSyncService.refresh({ force: true });
      } catch (error) {
        console.warn("[LIB] Simkl library fetch failed", error);
        return false;
      }
    }
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    try {
      await SavedLibrarySyncService.pull();
      return true;
    } catch (error) {
      if (!isMissingResourceError(error)) {
        console.warn("LibraryRepository refreshNow failed", error);
      }
      return false;
    }
  }
}
