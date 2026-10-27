import { SessionStore } from "../storage/sessionStore.js";
import { LocalStore } from "../storage/localStore.js";
import { clearProfileLocalData } from "./profileLocalDataReset.js";

const PROFILES_KEY = "profiles";
const ACTIVE_PROFILE_ID_KEY = "activeProfileId";
const REMEMBER_LAST_PROFILE_KEY = "rememberLastProfile";
const HAS_EVER_SELECTED_PROFILE_KEY = "hasEverSelectedProfile";
export const MAX_PROFILES = 6;
const profileDataVersions = new Map();
let profileMutations = Promise.resolve();

function mutateProfiles(operation) {
  const result = profileMutations.then(operation);
  profileMutations = result.catch(() => {});
  return result;
}

async function removeLocalProfileData(id) {
  if (id === "1") return;
  const sessionToken = SessionStore.accessToken;
  profileDataVersions.set(id, (profileDataVersions.get(id) || 0) + 1);
  if (ProfileManager.getActiveProfileId() === id) {
    LocalStore.set(ACTIVE_PROFILE_ID_KEY, "1");
  }
  const { cancelProfileSettingsCloudSync } = await import("../../data/local/profileScopedStore.js");
  const { PluginStore } = await import("../../data/local/pluginStore.js");
  const { PluginCodeStore } = await import("../../data/local/pluginCodeStore.js");
  const { HomeCatalogSettingsSyncService } = await import("./homeCatalogSettingsSyncService.js");
  cancelProfileSettingsCloudSync(id);
  HomeCatalogSettingsSyncService.clearProfile(id);
  if (!(await PluginCodeStore.clearProfile(id))) {
    throw new Error("Profile plugin code removal failed");
  }
  if (SessionStore.accessToken !== sessionToken) throw new Error("Profile cleanup account changed");
  PluginStore.clearProfile(id);
  clearProfileLocalData(id);
  // Also invalidate requests started while IndexedDB cleanup was awaiting.
  profileDataVersions.set(id, (profileDataVersions.get(id) || 0) + 1);
  if (ProfileManager.getActiveProfileId() === id) {
    LocalStore.set(ACTIVE_PROFILE_ID_KEY, "1");
  }
}

const DEFAULT_PROFILES = [
  {
    id: "1",
    profileIndex: 1,
    name: "Profile 1",
    avatarColorHex: "#1E88E5",
    avatarId: null,
    avatarUrl: null,
    profileBackgroundId: null,
    profileBackgroundUrl: null,
    isPrimary: true
  }
];

function readBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function normalizeProfile(profile, index = 0) {
  const fallbackIndex = index + 1;
  const profileIndex = Number(
    profile?.profileIndex || profile?.profile_index || profile?.id || fallbackIndex
  );
  const normalizedIndex =
    Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : fallbackIndex;
  return {
    ...profile,
    id: String(normalizedIndex),
    profileIndex: normalizedIndex,
    avatarColorHex: String(profile?.avatarColorHex || "#1E88E5"),
    avatarId: profile?.avatarId || profile?.avatar_id || null,
    avatarUrl: String(profile?.avatarUrl || profile?.avatar_url || "").trim() || null,
    profileBackgroundId:
      String(profile?.profileBackgroundId || profile?.profile_background_id || "").trim() || null,
    profileBackgroundUrl:
      String(profile?.profileBackgroundUrl || profile?.profile_background_url || "").trim() || null,
    isPrimary: readBooleanFlag(profile?.isPrimary) || normalizedIndex === 1,
    usesPrimaryAddons: readBooleanFlag(profile?.usesPrimaryAddons ?? profile?.uses_primary_addons),
    usesPrimaryPlugins: readBooleanFlag(
      profile?.usesPrimaryPlugins ?? profile?.uses_primary_plugins
    )
  };
}

function getFirstAvailableProfileIndex(profiles = []) {
  const usedIndexes = new Set(
    (Array.isArray(profiles) ? profiles : [])
      .map((profile) => Number(profile?.profileIndex || profile?.id || 0))
      .filter((profileIndex) => Number.isFinite(profileIndex) && profileIndex > 0)
      .map((profileIndex) => Math.trunc(profileIndex))
  );
  for (let profileIndex = 2; profileIndex <= MAX_PROFILES; profileIndex += 1) {
    if (!usedIndexes.has(profileIndex)) {
      return profileIndex;
    }
  }
  return null;
}

export const ProfileManager = {
  MAX_PROFILES,

  async getProfiles() {
    const stored = LocalStore.get(PROFILES_KEY, null);
    if (Array.isArray(stored) && stored.length) {
      const normalized = stored.map((profile, index) => normalizeProfile(profile, index));
      LocalStore.set(PROFILES_KEY, normalized);
      return normalized;
    }
    LocalStore.set(PROFILES_KEY, DEFAULT_PROFILES);
    return DEFAULT_PROFILES;
  },

  async replaceProfiles(profiles) {
    return mutateProfiles(async () => {
      if (
        !Array.isArray(profiles) ||
        !profiles.length ||
        profiles.some((profile) => {
          const raw = profile?.profileIndex ?? profile?.profile_index ?? profile?.id;
          const id = Number(raw);
          return (
            !["number", "string"].includes(typeof raw) ||
            !Number.isInteger(id) ||
            id < 1 ||
            id > MAX_PROFILES
          );
        })
      )
        return false;
      const normalized = profiles.map((profile, index) => normalizeProfile(profile, index));
      const ids = new Set(normalized.map((profile) => profile.id));
      if (!ids.has("1") || ids.size !== normalized.length) return false;
      const previous = await this.getProfiles();
      const previousIds = new Set(previous.map((profile) => profile.id));
      for (const profile of previous) {
        if (!ids.has(profile.id)) await removeLocalProfileData(profile.id);
      }
      // A newly discovered slot may still have data from an earlier deletion.
      for (const id of ids) {
        if (!previousIds.has(id)) await removeLocalProfileData(id);
      }
      LocalStore.set(PROFILES_KEY, normalized);
      return true;
    });
  },

  getProfileDataVersion(profileId) {
    return profileDataVersions.get(String(profileId)) || 0;
  },

  getNextProfileIndex(profiles = []) {
    return getFirstAvailableProfileIndex(profiles);
  },

  async setActiveProfile(id) {
    LocalStore.set(ACTIVE_PROFILE_ID_KEY, String(id));
    LocalStore.set(HAS_EVER_SELECTED_PROFILE_KEY, true);
  },

  isRememberLastProfileEnabled() {
    return Boolean(LocalStore.get(REMEMBER_LAST_PROFILE_KEY, false));
  },

  setRememberLastProfileEnabled(enabled) {
    LocalStore.set(REMEMBER_LAST_PROFILE_KEY, Boolean(enabled));
  },

  hasEverSelectedProfile() {
    return Boolean(
      LocalStore.get(HAS_EVER_SELECTED_PROFILE_KEY, false) ||
      LocalStore.get(ACTIVE_PROFILE_ID_KEY, null) != null
    );
  },

  clearActiveProfile() {
    LocalStore.remove(ACTIVE_PROFILE_ID_KEY);
  },

  async createProfile({
    name,
    avatarColorHex = "#1E88E5",
    avatarId = null,
    avatarUrl = null,
    profileBackgroundId = null,
    profileBackgroundUrl = null,
    usesPrimaryAddons = false,
    usesPrimaryPlugins = false
  } = {}) {
    return mutateProfiles(async () => {
      const trimmedName = String(name || "").trim();
      if (!trimmedName) {
        return false;
      }

      const profiles = await this.getProfiles();
      if (profiles.length >= MAX_PROFILES) {
        return false;
      }

      const nextIndex = getFirstAvailableProfileIndex(profiles);
      if (nextIndex == null) {
        return false;
      }
      await removeLocalProfileData(String(nextIndex));
      const nextProfiles = [
        ...profiles,
        normalizeProfile(
          {
            id: nextIndex,
            profileIndex: nextIndex,
            name: trimmedName,
            avatarColorHex,
            avatarId,
            avatarUrl,
            profileBackgroundId,
            profileBackgroundUrl,
            isPrimary: false,
            usesPrimaryAddons,
            usesPrimaryPlugins
          },
          profiles.length
        )
      ];
      LocalStore.set(PROFILES_KEY, nextProfiles);
      return true;
    });
  },

  async updateProfile(profile) {
    return mutateProfiles(async () => {
      const profiles = await this.getProfiles();
      const nextProfiles = profiles.map((entry, index) => {
        if (String(entry.id) !== String(profile?.id)) {
          return entry;
        }
        return normalizeProfile(
          {
            ...entry,
            ...profile
          },
          index
        );
      });
      LocalStore.set(PROFILES_KEY, nextProfiles);
      return true;
    });
  },

  async deleteProfile(id) {
    return mutateProfiles(async () => {
      const normalizedId = String(id || "");
      if (!normalizedId || normalizedId === "1") {
        return false;
      }

      const profiles = await this.getProfiles();
      const nextProfiles = profiles.filter((profile) => String(profile.id) !== normalizedId);
      if (nextProfiles.length === profiles.length) {
        return false;
      }
      await removeLocalProfileData(normalizedId);
      LocalStore.set(PROFILES_KEY, nextProfiles);
      return true;
    });
  },

  getActiveProfileId() {
    const raw = LocalStore.get(ACTIVE_PROFILE_ID_KEY, null);
    if (raw == null) {
      return "1";
    }
    return String(raw);
  }
};
