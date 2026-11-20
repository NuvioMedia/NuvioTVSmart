import { fetchViaWebOsDebridAuthProxy } from "../../../platform/webos/webosSupabaseProxy.js";

const TORBOX_BASE_URL = "https://api.torbox.app/";
const PREMIUMIZE_BASE_URL = "https://www.premiumize.me/";
const REAL_DEBRID_BASE_URL = "https://api.real-debrid.com/rest/1.0/";
const DEFAULT_DEBRID_TIMEOUT_MS = 15000;

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

async function fetchDebridWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_DEBRID_TIMEOUT_MS, ...rest } = options || {};
  const controller =
    !rest.signal && typeof AbortController === "function" ? new AbortController() : null;
  const fetchOptions = {
    ...rest,
    headers: {
      ...(rest.headers || {})
    },
    ...(controller ? { signal: controller.signal } : {})
  };
  const attempt = (async () =>
    (await fetchViaWebOsDebridAuthProxy(url, fetchOptions)) || (await fetch(url, fetchOptions)))();
  attempt.catch(() => {});

  const effectiveTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
    return attempt;
  }

  let timer = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort?.();
      const error = new Error(`Debrid request timed out after ${effectiveTimeoutMs} ms`);
      error.name = "AbortError";
      reject(error);
    }, effectiveTimeoutMs);
  });
  try {
    return await Promise.race([attempt, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(baseUrl, path, options = {}) {
  let response;
  try {
    const url = joinUrl(baseUrl, path);
    response = await fetchDebridWithTimeout(url, options);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: "",
      error
    };
  }
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    text
  };
}

async function requestDebridAuthJson(baseUrl, path, options = {}) {
  const url = joinUrl(baseUrl, path);
  try {
    const response = await fetchDebridWithTimeout(url, options);
    const text = await response.text();
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, data, text };
  } catch (error) {
    return { ok: false, status: 0, data: null, text: "", error };
  }
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${String(apiKey || "").trim()}`
  };
}

function formBody(values = {}) {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => body.append(key, String(entry)));
    } else if (value != null) {
      body.set(key, String(value));
    }
  });
  return body;
}

export const DebridApi = {
  async startTorboxDeviceAuthorization(appName = "Nuvio") {
    const query = new URLSearchParams({ app: String(appName || "Nuvio") });
    return requestDebridAuthJson(
      TORBOX_BASE_URL,
      `v1/api/user/auth/device/start?${query.toString()}`
    );
  },

  async redeemTorboxDeviceAuthorization(deviceCode) {
    return requestDebridAuthJson(TORBOX_BASE_URL, "v1/api/user/auth/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: String(deviceCode || "").trim() })
    });
  },

  async startPremiumizeDeviceAuthorization(clientId) {
    return requestDebridAuthJson(PREMIUMIZE_BASE_URL, "token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: formBody({ response_type: "device_code", client_id: clientId }).toString()
    });
  },

  async redeemPremiumizeDeviceAuthorization(deviceCode, clientId) {
    return requestDebridAuthJson(PREMIUMIZE_BASE_URL, "token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: formBody({
        grant_type: "device_code",
        code: deviceCode,
        client_id: clientId
      }).toString()
    });
  },

  async validateTorboxApiKey(apiKey) {
    const response = await requestJson(TORBOX_BASE_URL, "v1/api/user/me", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async validatePremiumizeApiKey(apiKey) {
    const response = await requestJson(PREMIUMIZE_BASE_URL, "api/account/info", {
      headers: authHeaders(apiKey)
    });
    return response.ok && String(response.data?.status || "").toLowerCase() !== "error";
  },

  async validateRealDebridApiKey(apiKey) {
    const response = await requestJson(REAL_DEBRID_BASE_URL, "user", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async torboxCreateTorrent(apiKey, magnet) {
    const body = new FormData();
    body.set("magnet", magnet);
    body.set("add_only_if_cached", "true");
    body.set("allow_zip", "false");
    return requestJson(TORBOX_BASE_URL, "v1/api/torrents/createtorrent", {
      method: "POST",
      headers: authHeaders(apiKey),
      body
    });
  },

  async torboxCheckCached(apiKey, hashes = []) {
    return requestJson(TORBOX_BASE_URL, "v1/api/torrents/checkcached?format=object", {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hashes: (hashes || [])
          .map((hash) =>
            String(hash || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      })
    });
  },

  async torboxGetTorrent(apiKey, torrentId) {
    const query = new URLSearchParams({
      id: String(torrentId),
      bypass_cache: "true"
    });
    return requestJson(TORBOX_BASE_URL, `v1/api/torrents/mylist?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async torboxRequestDownloadLink(apiKey, torrentId, fileId) {
    const query = new URLSearchParams({
      token: String(apiKey || "").trim(),
      torrent_id: String(torrentId),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (fileId != null) {
      query.set("file_id", String(fileId));
    }
    return requestJson(TORBOX_BASE_URL, `v1/api/torrents/requestdl?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async torboxListCloudItems(apiKey, path) {
    return requestJson(TORBOX_BASE_URL, path, { headers: authHeaders(apiKey) });
  },

  async torboxRequestCloudDownloadLink(apiKey, itemType, itemId, fileId) {
    const type = String(itemType || "");
    const config =
      type === "Usenet"
        ? { path: "v1/api/usenet/requestdl", idKey: "usenet_id" }
        : type === "WebDownload"
          ? { path: "v1/api/webdl/requestdl", idKey: "web_id" }
          : { path: "v1/api/torrents/requestdl", idKey: "torrent_id" };
    const query = new URLSearchParams({
      token: String(apiKey || "").trim(),
      [config.idKey]: String(itemId),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (fileId != null) query.set("file_id", String(fileId));
    return requestJson(TORBOX_BASE_URL, `${config.path}?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async premiumizeDirectDownload(apiKey, source) {
    return requestJson(PREMIUMIZE_BASE_URL, "api/transfer/directdl", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ src: source })
    });
  },

  async premiumizeCheckCache(apiKey, hashes = []) {
    const body = new URLSearchParams();
    (hashes || [])
      .map((hash) =>
        String(hash || "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
      .forEach((hash) => body.append("items[]", `magnet:?xt=urn:btih:${hash}`));
    return requestJson(PREMIUMIZE_BASE_URL, "api/cache/check", {
      method: "POST",
      headers: authHeaders(apiKey),
      body
    });
  },

  async premiumizeListCloudItems(apiKey) {
    return requestJson(PREMIUMIZE_BASE_URL, "api/item/listall", {
      headers: authHeaders(apiKey)
    });
  },

  async premiumizeCloudItemDetails(apiKey, itemId) {
    const query = new URLSearchParams({ id: String(itemId || "") });
    return requestJson(PREMIUMIZE_BASE_URL, `api/item/details?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async realDebridAddMagnet(apiKey, magnet) {
    return requestJson(REAL_DEBRID_BASE_URL, "torrents/addMagnet", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ magnet })
    });
  },

  async realDebridTorrentInfo(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/info/${encodeURIComponent(torrentId)}`, {
      headers: authHeaders(apiKey)
    });
  },

  async realDebridSelectFiles(apiKey, torrentId, files) {
    return requestJson(
      REAL_DEBRID_BASE_URL,
      `torrents/selectFiles/${encodeURIComponent(torrentId)}`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: formBody({ files })
      }
    );
  },

  async realDebridUnrestrictLink(apiKey, link) {
    return requestJson(REAL_DEBRID_BASE_URL, "unrestrict/link", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ link })
    });
  },

  async realDebridDeleteTorrent(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/delete/${encodeURIComponent(torrentId)}`, {
      method: "DELETE",
      headers: authHeaders(apiKey)
    });
  }
};
