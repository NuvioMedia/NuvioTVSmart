import { httpRequest } from "../../../core/network/httpClient.js";
import { recordSyncFailure } from "../../../core/sync/syncBackoffPolicy.js";
import { ServerConfigurationStore } from "../../local/serverConfigurationStore.js";

function trackSyncRequest(request) {
  return Promise.resolve(request).catch((error) => {
    recordSyncFailure(error);
    throw error;
  });
}

function buildHeaders(extra = {}, useSession = true) {
  const { publishableKey } = ServerConfigurationStore.getActive();
  const headers = {
    apikey: publishableKey,
    ...extra
  };
  if (!useSession && headers.Authorization == null) {
    headers.Authorization = `Bearer ${publishableKey}`;
  }
  return headers;
}

function backendUrl() {
  return ServerConfigurationStore.getActive().backendUrl;
}

export const SupabaseApi = {
  rpc(functionName, body = {}, useSession = true) {
    return trackSyncRequest(
      httpRequest(`${backendUrl()}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
        includeSessionAuth: useSession,
        body: JSON.stringify(body)
      })
    );
  },

  select(table, query = "", useSession = true) {
    const suffix = query ? `?${query}` : "";
    return trackSyncRequest(
      httpRequest(`${backendUrl()}/rest/v1/${table}${suffix}`, {
        method: "GET",
        headers: buildHeaders({}, useSession),
        includeSessionAuth: useSession
      })
    );
  },

  upsert(table, rows, onConflict = null, useSession = true) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return trackSyncRequest(
      httpRequest(`${backendUrl()}/rest/v1/${table}${query}`, {
        method: "POST",
        headers: buildHeaders(
          {
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          useSession
        ),
        includeSessionAuth: useSession,
        body: JSON.stringify(rows)
      })
    );
  },

  delete(table, query, useSession = true) {
    return trackSyncRequest(
      httpRequest(`${backendUrl()}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: buildHeaders({ Prefer: "return=representation" }, useSession),
        includeSessionAuth: useSession
      })
    );
  },

  downloadStorageObject(bucket, storagePath, useSession = true) {
    const normalizedBucket = encodeURIComponent(String(bucket || "").trim());
    const normalizedPath = String(storagePath || "")
      .trim()
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    if (!normalizedBucket || !normalizedPath) {
      return Promise.resolve(null);
    }
    return trackSyncRequest(
      httpRequest(
        `${backendUrl()}/storage/v1/object/authenticated/${normalizedBucket}/${normalizedPath}`,
        {
          method: "GET",
          headers: buildHeaders({}, useSession),
          includeSessionAuth: useSession,
          responseType: "blob"
        }
      )
    );
  }
};
