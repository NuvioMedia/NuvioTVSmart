import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

// Recent plugin provider plays, per profile, mirroring Android PluginDataStore's
// pluginProviderPlays history. A bounded window keeps a newly preferred provider able
// to move to the front.

const KEY = "pluginProviderPlays";
const MAX_PLAYS = 50;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

export const PluginProviderPlaysStore = {
  get(profileId = activeProfileId()) {
    const entry = readAll()[String(profileId || "1")];
    return Array.isArray(entry) ? entry.filter((id) => typeof id === "string" && id.trim()) : [];
  },

  record(scraperId, profileId = activeProfileId()) {
    const id = String(scraperId || "").trim();
    if (!id) {
      return;
    }
    const all = readAll();
    const key = String(profileId || "1");
    const previous = Array.isArray(all[key]) ? all[key] : [];
    all[key] = [...previous, id].slice(-MAX_PLAYS);
    LocalStore.set(KEY, all);
  },

  clear(profileId = null) {
    if (profileId == null) {
      LocalStore.remove(KEY);
      return;
    }
    const all = readAll();
    delete all[String(profileId)];
    LocalStore.set(KEY, all);
  }
};
