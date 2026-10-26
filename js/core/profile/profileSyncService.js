import { AuthManager } from "../auth/authManager.js";
import { SessionStore } from "../storage/sessionStore.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { MAX_PROFILES, ProfileManager } from "./profileManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";

const TABLE = "tv_profiles";
const FALLBACK_TABLE = "profiles";
const PULL_RPC = "sync_pull_profiles";
const PUSH_RPC = "sync_push_profiles";
const PULL_LOCKS_RPC = "sync_pull_profile_locks";
const SET_PROFILE_PIN_RPC = "set_profile_pin";
const CLEAR_PROFILE_PIN_RPC = "clear_profile_pin";
const VERIFY_PROFILE_PIN_RPC = "verify_profile_pin";
const DELETE_PROFILE_DATA_RPC = "sync_delete_profile_data";
const PROFILE_PULL_MIN_INTERVAL_MS = 10_000;

let lastPullStatus = "idle";
let lastPullError = null;
let pullInFlight = null;
let lastPulledUserKey = null;
let lastPulledAtMs = 0;
let lastPulledProfiles = [];

function currentAuthUserKey() {
  const token = String(SessionStore.accessToken || "");
  try {
    const [, payload] = token.split(".");
    if (payload && typeof atob === "function") {
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const subject = String(JSON.parse(atob(padded))?.sub || "").trim();
      if (subject) {
        return subject;
      }
    }
  } catch (_) {
    // Fall back to the token itself so two sessions cannot share freshness.
  }
  return token || "authenticated";
}

function shouldTryLegacyTable(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && error.code === "PGRST205") {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("PGRST205") || message.includes("Could not find the table");
}

function readBooleanFlag(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

export function shouldTryProfileTableFallback(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && error.code === "PGRST202") {
    return true;
  }
  const message = `${String(error.message || "")} ${String(error.detail || "")}`;
  return message.includes("PGRST202") || message.includes("Could not find the function");
}

function mapProfileRow(row = {}) {
  const profileIndex = Number(row.profile_index || row.profileIndex || row.id || 1);
  const normalizedIndex =
    Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1;
  return {
    id: String(normalizedIndex),
    profileIndex: normalizedIndex,
    name: row.name || `Profile ${normalizedIndex}`,
    avatarColorHex: row.avatar_color_hex || row.avatarColorHex || "#1E88E5",
    avatarId: row.avatar_id || row.avatarId || null,
    avatarUrl: row.avatar_url || row.avatarUrl || null,
    profileBackgroundId:
      String(row.profile_background_id || row.profileBackgroundId || "").trim() || null,
    profileBackgroundUrl: row.profile_background_url || row.profileBackgroundUrl || null,
    usesPrimaryAddons: readBooleanFlag(row.uses_primary_addons, row.usesPrimaryAddons),
    usesPrimaryPlugins: readBooleanFlag(row.uses_primary_plugins, row.usesPrimaryPlugins),
    isPrimary: readBooleanFlag(row.is_primary, row.isPrimary) || normalizedIndex === 1
  };
}

export const ProfileSyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  getLastPullError() {
    return lastPullError;
  },

  async pull(force = false) {
    if (isSyncBackoffActive()) {
      lastPullStatus = "deferred";
      lastPullError = null;
      return [];
    }
    if (pullInFlight) {
      return pullInFlight;
    }

    let requestPromise = null;
    requestPromise = (async () => {
      lastPullStatus = "loading";
      lastPullError = null;
      try {
        if (!AuthManager.isAuthenticated) {
          lastPullStatus = "signed-out";
          return [];
        }
        const userKey = currentAuthUserKey();
        const now = Date.now();
        if (
          !force &&
          lastPulledUserKey === userKey &&
          lastPulledAtMs > 0 &&
          now >= lastPulledAtMs &&
          now - lastPulledAtMs < PROFILE_PULL_MIN_INTERVAL_MS
        ) {
          lastPullStatus = "ok";
          return [...lastPulledProfiles];
        }
        let rows = [];
        try {
          rows = await SupabaseApi.rpc(PULL_RPC, {}, true);
        } catch (rpcError) {
          // A table fallback is useful only for deployments that do not expose
          // the profiles RPC. Retrying network, auth, or server failures through
          // another webOS proxy request can otherwise hold boot past its watchdog.
          if (!shouldTryProfileTableFallback(rpcError)) {
            throw rpcError;
          }
          const ownerId = await AuthManager.getEffectiveUserId();
          try {
            rows = await SupabaseApi.select(
              FALLBACK_TABLE,
              `user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
              true
            );
          } catch (primaryError) {
            if (!shouldTryLegacyTable(primaryError)) {
              throw rpcError;
            }
            rows = await SupabaseApi.select(
              TABLE,
              `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
              true
            );
          }
        }
        if (
          !AuthManager.isAuthenticated ||
          isSyncBackoffActive() ||
          currentAuthUserKey() !== userKey
        ) {
          lastPullStatus = "deferred";
          return [];
        }
        if (
          !Array.isArray(rows) ||
          rows.some((row) => {
            const raw = row?.profile_index ?? row?.profileIndex ?? row?.id;
            const id = Number(raw);
            return (
              !["number", "string"].includes(typeof raw) ||
              !Number.isInteger(id) ||
              id < 1 ||
              id > MAX_PROFILES
            );
          })
        )
          throw new Error("Invalid remote profile list");
        const profiles = rows.map((row) => mapProfileRow(row));
        if (profiles.length) {
          if (!(await ProfileManager.replaceProfiles(profiles))) {
            throw new Error("Invalid remote profile list");
          }
        }
        if (currentAuthUserKey() === userKey) {
          lastPulledUserKey = userKey;
          lastPulledAtMs = Date.now();
          lastPulledProfiles = [...profiles];
        }
        lastPullStatus = "ok";
        return profiles;
      } catch (error) {
        lastPullStatus = "error";
        lastPullError = error;
        console.warn("Profile sync pull failed", error);
        return [];
      }
    })();
    pullInFlight = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (pullInFlight === requestPromise) {
        pullInFlight = null;
      }
    }
  },

  async push() {
    if (isSyncBackoffActive()) {
      return false;
    }
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const profiles = await ProfileManager.getProfiles();
      try {
        await SupabaseApi.rpc(
          PUSH_RPC,
          {
            p_client_max_profiles: MAX_PROFILES,
            p_profiles: profiles.map((profile) => {
              const profileIndex = Number(profile.profileIndex || profile.id || 1);
              const avatarUrl = String(profile.avatarUrl || "").trim() || null;
              const profileBackgroundUrl =
                String(profile.profileBackgroundUrl || "").trim() || null;
              return {
                profile_index:
                  Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
                name: profile.name,
                avatar_color_hex: profile.avatarColorHex || "#1E88E5",
                avatar_id: avatarUrl ? null : profile.avatarId || null,
                avatar_url: avatarUrl,
                profile_background_id: String(profile.profileBackgroundId || "").trim() || null,
                profile_background_url: profileBackgroundUrl,
                uses_primary_addons: Boolean(profile.usesPrimaryAddons),
                uses_primary_plugins: Boolean(profile.usesPrimaryPlugins)
              };
            })
          },
          true
        );
        return true;
      } catch (rpcError) {
        if (!shouldTryProfileTableFallback(rpcError)) {
          throw rpcError;
        }
        console.warn("Profile sync push RPC is unavailable, falling back to table sync", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      const rows = profiles.map((profile) => {
        const profileIndex = Number(profile.profileIndex || profile.id || 1);
        const avatarUrl = String(profile.avatarUrl || "").trim() || null;
        const profileBackgroundUrl = String(profile.profileBackgroundUrl || "").trim() || null;
        return {
          id: profile.id,
          owner_id: ownerId,
          profile_index:
            Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
          name: profile.name,
          avatar_color_hex: profile.avatarColorHex || "#1E88E5",
          avatar_id: avatarUrl ? null : profile.avatarId || null,
          avatar_url: avatarUrl,
          profile_background_id: String(profile.profileBackgroundId || "").trim() || null,
          profile_background_url: profileBackgroundUrl,
          uses_primary_addons: Boolean(profile.usesPrimaryAddons),
          uses_primary_plugins: Boolean(profile.usesPrimaryPlugins),
          is_primary: Boolean(profile.isPrimary)
        };
      });

      const fallbackRows = rows.map((row) => ({
        user_id: ownerId,
        profile_index: row.profile_index,
        name: row.name,
        avatar_color_hex: row.avatar_color_hex,
        avatar_id: row.avatar_id || null,
        avatar_url: row.avatar_url || null,
        profile_background_id: row.profile_background_id || null,
        profile_background_url: row.profile_background_url || null,
        uses_primary_addons: Boolean(row.uses_primary_addons),
        uses_primary_plugins: Boolean(row.uses_primary_plugins)
      }));
      try {
        await SupabaseApi.delete(FALLBACK_TABLE, `user_id=eq.${encodeURIComponent(ownerId)}`, true);
        if (fallbackRows.length) {
          await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,profile_index", true);
        }
      } catch (primaryError) {
        if (!shouldTryLegacyTable(primaryError)) {
          throw primaryError;
        }
        await SupabaseApi.upsert(TABLE, rows, "id", true);
      }
      return true;
    } catch (error) {
      console.warn("Profile sync push failed", error);
      return false;
    }
  },

  async pullProfileLockStates() {
    if (isSyncBackoffActive()) {
      return {};
    }
    try {
      if (!AuthManager.isAuthenticated) {
        return {};
      }
      const rows = await SupabaseApi.rpc(PULL_LOCKS_RPC, {}, true);
      return (Array.isArray(rows) ? rows : []).reduce((accumulator, row) => {
        const profileIndex = Number(row?.profile_index ?? row?.profileIndex ?? row?.id ?? 0);
        if (Number.isFinite(profileIndex) && profileIndex > 0) {
          accumulator[String(Math.trunc(profileIndex))] = Boolean(
            row?.pin_enabled ?? row?.pinEnabled
          );
        }
        return accumulator;
      }, {});
    } catch (error) {
      console.warn("Profile lock state pull failed", error);
      return {};
    }
  },

  async setProfilePin(profileId, pin, currentPin = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const params = {
        p_profile_id: Number(profileId),
        p_pin: String(pin || "")
      };
      if (String(currentPin || "").trim()) {
        params.p_current_pin = String(currentPin).trim();
      }
      await SupabaseApi.rpc(SET_PROFILE_PIN_RPC, params, true);
      return true;
    } catch (error) {
      console.warn("Set profile PIN failed", error);
      return false;
    }
  },

  async clearProfilePin(profileId, currentPin = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const params = {
        p_profile_id: Number(profileId)
      };
      if (String(currentPin || "").trim()) {
        params.p_current_pin = String(currentPin).trim();
      }
      await SupabaseApi.rpc(CLEAR_PROFILE_PIN_RPC, params, true);
      return true;
    } catch (error) {
      console.warn("Clear profile PIN failed", error);
      return false;
    }
  },

  async verifyProfilePin(profileId, pin) {
    try {
      if (!AuthManager.isAuthenticated) {
        return null;
      }
      const response = await SupabaseApi.rpc(
        VERIFY_PROFILE_PIN_RPC,
        {
          p_profile_id: Number(profileId),
          p_pin: String(pin || "")
        },
        true
      );
      const payload = Array.isArray(response) ? response[0] || {} : response || {};
      return {
        unlocked: Boolean(payload?.unlocked),
        retryAfterSeconds: Math.max(
          0,
          Number(payload?.retry_after_seconds ?? payload?.retryAfterSeconds ?? 0) || 0
        )
      };
    } catch (error) {
      console.warn("Verify profile PIN failed", error);
      return null;
    }
  },

  async deleteProfileData(profileId) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      await SupabaseApi.rpc(
        DELETE_PROFILE_DATA_RPC,
        {
          p_profile_id: Number(profileId)
        },
        true
      );
      return true;
    } catch (error) {
      console.warn("Delete remote profile data failed", error);
      return false;
    }
  }
};
