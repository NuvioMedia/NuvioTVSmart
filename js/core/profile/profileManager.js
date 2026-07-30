import { LocalStore } from "../storage/localStore.js";

const PROFILES_KEY = "profiles";
const ACTIVE_PROFILE_ID_KEY = "activeProfileId";
const REMEMBER_LAST_PROFILE_KEY = "rememberLastProfile";
const HAS_EVER_SELECTED_PROFILE_KEY = "hasEverSelectedProfile";
export const MAX_PROFILES = 6;

const DEFAULT_PROFILES = [
  { id: "1", profileIndex: 1, name: "Profile 1", avatarColorHex: "#1E88E5", isPrimary: true }
];

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
    isPrimary: Boolean(profile?.isPrimary || normalizedIndex === 1),
    usesPrimaryAddons: Boolean(profile?.usesPrimaryAddons),
    usesPrimaryPlugins: Boolean(profile?.usesPrimaryPlugins)
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
    const normalized = (Array.isArray(profiles) ? profiles : []).map((profile, index) =>
      normalizeProfile(profile, index)
    );
    LocalStore.set(PROFILES_KEY, normalized);
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
    usesPrimaryAddons = false,
    usesPrimaryPlugins = false
  } = {}) {
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
          isPrimary: false,
          usesPrimaryAddons,
          usesPrimaryPlugins
        },
        profiles.length
      )
    ];
    LocalStore.set(PROFILES_KEY, nextProfiles);
    return true;
  },

  async updateProfile(profile) {
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
  },

  async deleteProfile(id) {
    const normalizedId = String(id || "");
    if (!normalizedId || normalizedId === "1") {
      return false;
    }

    const profiles = await this.getProfiles();
    const nextProfiles = profiles.filter((profile) => String(profile.id) !== normalizedId);
    if (nextProfiles.length === profiles.length) {
      return false;
    }
    LocalStore.set(PROFILES_KEY, nextProfiles);
    if (this.getActiveProfileId() === normalizedId) {
      LocalStore.set(ACTIVE_PROFILE_ID_KEY, "1");
    }
    return true;
  },

  getActiveProfileId() {
    const raw = LocalStore.get(ACTIVE_PROFILE_ID_KEY, null);
    if (raw == null) {
      return "1";
    }
    return String(raw);
  }
};
