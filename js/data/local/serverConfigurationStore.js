import {
  AVATAR_PUBLIC_BASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_FALLBACK_URL,
  SUPABASE_URL,
  TV_LOGIN_WEB_BASE_URL
} from "../../config.js";
import { isPublicHttpsUrl } from "../../core/server/serverDiscovery.js";

export const SERVER_CONFIGURATION_KEY = "nuvioServerConfigurationV1";

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function officialConfiguration() {
  const backendUrl = normalizeUrl(SUPABASE_URL);
  return {
    backendUrl,
    publishableKey: String(SUPABASE_ANON_KEY || "").trim(),
    capabilities: { emailPasswordAuth: false, tvLogin: true },
    isCustom: false,
    discoveryUrl: null,
    fallbackBackendUrl: normalizeUrl(SUPABASE_FALLBACK_URL),
    tvLoginWebBaseUrl: normalizeUrl(TV_LOGIN_WEB_BASE_URL),
    deviceLoginWebBaseUrl: "",
    avatarPublicBaseUrl:
      normalizeUrl(AVATAR_PUBLIC_BASE_URL) ||
      (backendUrl ? `${backendUrl}/storage/v1/object/public/avatars` : "")
  };
}

function validCustomConfiguration(value) {
  if (!value || typeof value !== "object" || value.isCustom !== true) return null;
  const backendUrl = normalizeUrl(value.backendUrl);
  const publishableKey = String(value.publishableKey || "").trim();
  const capabilities = {
    emailPasswordAuth: value.capabilities?.emailPasswordAuth === true,
    tvLogin: value.capabilities?.tvLogin === true
  };
  let parsed;
  try {
    parsed = new URL(backendUrl);
  } catch (_) {
    return null;
  }
  if (
    !isPublicHttpsUrl(parsed.toString()) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !publishableKey ||
    (!capabilities.emailPasswordAuth && !capabilities.tvLogin)
  ) {
    return null;
  }
  return {
    backendUrl,
    publishableKey,
    capabilities,
    isCustom: true,
    discoveryUrl: String(value.discoveryUrl || "").trim() || null,
    fallbackBackendUrl: "",
    tvLoginWebBaseUrl: `${backendUrl}/tv-login`,
    deviceLoginWebBaseUrl: `${backendUrl}/link`,
    avatarPublicBaseUrl: `${backendUrl}/storage/v1/object/public/avatars`
  };
}

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

export const ServerConfigurationStore = {
  getOfficial() {
    return officialConfiguration();
  },

  getActive(storage) {
    try {
      const raw = storageOrDefault(storage)?.getItem?.(SERVER_CONFIGURATION_KEY);
      if (!raw) return officialConfiguration();
      return validCustomConfiguration(JSON.parse(raw)) || officialConfiguration();
    } catch (error) {
      console.warn("[serverConfiguration] Failed to load custom server", error);
      return officialConfiguration();
    }
  },

  saveCustom(configuration, storage) {
    const normalized = validCustomConfiguration(configuration);
    if (!normalized) return false;
    try {
      const target = storageOrDefault(storage);
      if (!target?.setItem || !target?.getItem) return false;
      target.setItem(SERVER_CONFIGURATION_KEY, JSON.stringify(normalized));
      return target.getItem(SERVER_CONFIGURATION_KEY) !== null;
    } catch (error) {
      console.warn("[serverConfiguration] Failed to save custom server", error);
      return false;
    }
  },

  useOfficial(storage) {
    try {
      const target = storageOrDefault(storage);
      if (!target?.removeItem || !target?.getItem) return false;
      target.removeItem(SERVER_CONFIGURATION_KEY);
      return target.getItem(SERVER_CONFIGURATION_KEY) == null;
    } catch (error) {
      console.warn("[serverConfiguration] Failed to restore official server", error);
      return false;
    }
  }
};
