// Watch party RPCs, mirroring Android core/party/PartyApi.kt. These calls do
// not go through SupabaseApi so their failures never trigger the sync backoff.
import { httpRequest } from "../network/httpClient.js";
import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { compactJson, decodePartyPreview, decodePartySnapshot } from "./partyModels.js";

const REQUEST_TIMEOUT_MS = 15000;

async function rpc(functionName, params = {}) {
  const { backendUrl, publishableKey } = ServerConfigurationStore.getActive();
  return httpRequest(`${backendUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    includeSessionAuth: true,
    timeoutMs: REQUEST_TIMEOUT_MS,
    body: JSON.stringify(params)
  });
}

function identityParams(identity) {
  return {
    p_device_id: identity.deviceId,
    p_display_name: identity.displayName,
    p_avatar_url: identity.avatarUrl ?? null,
    p_avatar_color: identity.avatarColor ?? null
  };
}

async function snapshot(functionName, params) {
  return decodePartySnapshot(await rpc(functionName, params));
}

async function snapshotWithProfile(functionName, identity, params) {
  if (identity.profileIndex == null) return snapshot(functionName, params);
  try {
    return await snapshot(functionName, { ...params, p_profile_index: identity.profileIndex });
  } catch (error) {
    if (error.code !== "PGRST202") throw error;
    return snapshot(functionName, params);
  }
}

export const PartyApi = {
  create(identity, media, playback) {
    return snapshotWithProfile("watch_party_create", identity, {
      ...identityParams(identity),
      p_media: compactJson(media),
      p_playback: playback ? compactJson(playback) : null
    });
  },

  join(code, identity) {
    return snapshotWithProfile("watch_party_join", identity, {
      p_code: code,
      ...identityParams(identity)
    });
  },

  async preview(code) {
    return decodePartyPreview(await rpc("watch_party_preview", { p_code: code }));
  },

  heartbeat(partyId, deviceId) {
    return snapshot("watch_party_heartbeat", { p_party_id: partyId, p_device_id: deviceId });
  },

  update(partyId, deviceId, media, playback) {
    const params = { p_party_id: partyId, p_device_id: deviceId };
    if (media) params.p_media = compactJson(media);
    if (playback) params.p_playback = compactJson(playback);
    return snapshot("watch_party_update", params);
  },

  leave(partyId, deviceId) {
    return snapshot("watch_party_leave", { p_party_id: partyId, p_device_id: deviceId });
  },

  end(partyId, deviceId) {
    return snapshot("watch_party_end", { p_party_id: partyId, p_device_id: deviceId });
  },

  setHostOnly(partyId, deviceId, hostOnly) {
    return snapshot("watch_party_set_host_only", {
      p_party_id: partyId,
      p_device_id: deviceId,
      p_host_only: hostOnly
    });
  },

  removeMember(partyId, deviceId, memberId) {
    return snapshot("watch_party_remove_member", {
      p_party_id: partyId,
      p_device_id: deviceId,
      p_member_id: memberId
    });
  },

  async clock() {
    const value = Number(await rpc("watch_party_clock"));
    if (!Number.isFinite(value)) throw new Error("Invalid watch party clock");
    return Math.trunc(value);
  },

  async enabled() {
    const value = await rpc("watch_party_enabled");
    if (typeof value !== "boolean") throw new Error("Invalid watch party availability");
    return value;
  }
};
