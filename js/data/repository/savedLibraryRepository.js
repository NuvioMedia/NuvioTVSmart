import { AddonEventDispatcher, AddonLibraryAction } from "./addonEventDispatcher.js";
import { SavedLibraryStore } from "../local/savedLibraryStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

let savedLibrarySyncTimers = null;
const savedLibrarySyncInFlightByProfile = new Map();
let savedLibrarySyncGeneration = 0;

function queueSavedLibraryCloudSync(profileId = activeProfileId(), delayMs = 500) {
  const profileKey = String(profileId || "1");
  const generation = savedLibrarySyncGeneration;
  if (savedLibrarySyncTimers) {
    const existingTimer = savedLibrarySyncTimers.get(profileKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
  }
  if (!savedLibrarySyncTimers) {
    savedLibrarySyncTimers = new Map();
  }
  const timerId = setTimeout(() => {
    if (generation !== savedLibrarySyncGeneration) {
      return;
    }
    savedLibrarySyncTimers.delete(profileKey);
    const runPush = async () => {
      if (generation !== savedLibrarySyncGeneration) {
        return;
      }
      const inFlight = savedLibrarySyncInFlightByProfile.get(profileKey);
      if (inFlight) {
        await inFlight.catch(() => false);
      }
      if (generation !== savedLibrarySyncGeneration) {
        return;
      }
      const pushPromise = import("../../core/profile/savedLibrarySyncService.js")
        .then(({ SavedLibrarySyncService }) => SavedLibrarySyncService.push(profileId))
        .catch((error) => {
          console.warn("Saved library cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (savedLibrarySyncInFlightByProfile.get(profileKey) === pushPromise) {
            savedLibrarySyncInFlightByProfile.delete(profileKey);
          }
        });
      savedLibrarySyncInFlightByProfile.set(profileKey, pushPromise);
      const didPush = await pushPromise;
      if (generation !== savedLibrarySyncGeneration) {
        return;
      }
      if (!didPush) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueSavedLibraryCloudSync(profileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  savedLibrarySyncTimers.set(profileKey, timerId);
}

function stopSavedLibraryCloudSync({ waitForInFlight = true } = {}) {
  const pending = waitForInFlight ? [...savedLibrarySyncInFlightByProfile.values()] : [];
  savedLibrarySyncGeneration += 1;
  savedLibrarySyncTimers?.forEach((timerId) => clearTimeout(timerId));
  savedLibrarySyncTimers?.clear();
  savedLibrarySyncInFlightByProfile.clear();
  if (!waitForInFlight || pending.length === 0) {
    return Promise.resolve(true);
  }
  return Promise.allSettled(pending).then(() => true);
}

registerSessionTeardownHandler?.(({ waitForInFlight = true } = {}) =>
  stopSavedLibraryCloudSync({ waitForInFlight })
);

class SavedLibraryRepository {
  async getAll(limit = 200, profileId = activeProfileId()) {
    return SavedLibraryStore.listForProfile(profileId).slice(0, limit);
  }

  async isSaved(contentId, profileId = activeProfileId()) {
    return Boolean(SavedLibraryStore.findByContentId(contentId, profileId));
  }

  async save(item, profileId = activeProfileId()) {
    if (!item?.contentId) {
      return;
    }
    SavedLibraryStore.upsert(item, profileId);
    queueSavedLibraryCloudSync(profileId);
  }

  async remove(contentId, profileId = activeProfileId()) {
    SavedLibraryStore.remove(contentId, profileId);
    queueSavedLibraryCloudSync(profileId);
  }

  async toggle(item, profileId = activeProfileId()) {
    if (!item?.contentId) {
      return false;
    }
    const exists = SavedLibraryStore.findByContentId(item.contentId, profileId);
    const type = String(item.contentType || item.type || "movie");
    if (exists) {
      SavedLibraryStore.remove(item.contentId, profileId);
      queueSavedLibraryCloudSync(profileId);
      // Android: a user toggle tells the Stremio add-ons that declare "library".
      AddonEventDispatcher.library(type, item.contentId, AddonLibraryAction.LIBRARY_REMOVE);
      return false;
    }
    SavedLibraryStore.upsert(item, profileId);
    queueSavedLibraryCloudSync(profileId);
    AddonEventDispatcher.library(type, item.contentId, AddonLibraryAction.LIBRARY_ADD);
    return true;
  }

  async replaceAll(items, profileId = activeProfileId()) {
    SavedLibraryStore.replaceForProfile(profileId, items || []);
  }
}

export const savedLibraryRepository = new SavedLibraryRepository();
