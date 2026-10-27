import { mirrorWatchTargets, findServerEpisode } from "./serverWatchedMatcher.js";
import { serverUserState, projectServerUserState } from "./mediaServerUserState.js";
import { MediaServerStore } from "./mediaServerStore.js";
import {
  mediaServerRequest,
  mediaServerUrl,
  mediaServerHeaders,
  mediaServerDeviceId,
  mediaServerApiRoot,
  mediaServerAssetUrl,
  normalizeMediaServerAddress,
  isSupportedServerVersion,
  serverEndpoint
} from "./mediaBrowserClient.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { I18n } from "../../i18n/index.js";
const PAGE_SIZE = 100;
const LIST_FIELDS =
  "ProviderIds,Overview,MediaSources,MediaStreams,Genres,DateCreated,UserData,Path";
const refs = new Map();
const genreScopes = new Map();
const titleNames = new Map();
globalThis.document?.addEventListener?.("nuvio:media-servers-changed", () => {
  refs.clear();
  genreScopes.clear();
  titleNames.clear();
});
const key = (id) => encodeURIComponent(String(id));
const profile = () => String(ProfileManager.getActiveProfileId() || "1");
export const isMediaServerBase = (base) => String(base || "").startsWith("nuvio-server://");
export const parseServerItem = (id) => {
  const match = String(id || "").match(/^server:([^:]+):([^:]+)$/);
  try {
    return match
      ? { connectionId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]) }
      : null;
  } catch (_) {
    return null;
  }
};
export function nativeServerWatchTarget(item) {
  const parent = parseServerItem(item?.contentId || item?.id);
  if (!parent) return null;
  if (item.episode != null) {
    if (
      item.season == null ||
      item.season === "" ||
      !Number.isInteger(Number(item.season)) ||
      Number(item.season) < 0 ||
      !Number.isInteger(Number(item.episode)) ||
      Number(item.episode) < 1
    )
      return null;
    const episode = parseServerItem(item.videoId);
    return episode &&
      episode.connectionId === parent.connectionId &&
      episode.itemId !== parent.itemId
      ? episode
      : null;
  }
  return ["movie", "film"].includes(String(item.contentType || item.type || "").toLowerCase())
    ? parent
    : null;
}

export const canResolveMediaServerStream = (stream) =>
  Boolean((stream?.clientResolve || stream?.raw?.clientResolve)?.mediaServer);
function serverId(connection, itemId) {
  return `server:${key(connection.id)}:${key(itemId)}`;
}
function libraryKind(item) {
  const kind = String(item.CollectionType || "").toLowerCase();
  if (kind === "movies") return "movie";
  if (kind === "tvshows") return "series";
  if (kind === "boxsets") return "collection";
  if (!kind || ["mixed", "mixedcontent"].includes(kind)) return "mixed";
  return null;
}
function mediaType(item) {
  return String(item.Type).toLowerCase() === "movie"
    ? "movie"
    : String(item.Type).toLowerCase() === "boxset"
      ? "collection"
      : "series";
}
function image(connection, item, type = "Primary", parentId = null) {
  const tag = type === "Backdrop" ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
  const id = parentId || item.Id;
  if (!tag && !parentId) return null;
  return mediaServerUrl(connection, `/Items/${key(id)}/Images/${type}`, {
    tag,
    maxHeight: type === "Primary" ? 600 : undefined,
    maxWidth: type === "Backdrop" ? 1920 : undefined,
    quality: 90,
    api_key: connection.token
  });
}
export function mapServerItem(connection, item) {
  if (!item?.Id || item.IsMissing) return null;
  const type = mediaType(item);
  const nativeId = serverId(connection, item.Id);
  const external = item.ProviderIds || {};
  const id =
    connection.useCatalogMetadata && type !== "collection"
      ? external.Imdb || external.imdb || (external.Tmdb ? `tmdb:${external.Tmdb}` : nativeId)
      : nativeId;
  refs.set(`${profile()}:${connection.id}:${id}`, { connectionId: connection.id, itemId: item.Id });
  if (refs.size > 3000) refs.delete(refs.keys().next().value);
  return {
    id,
    type,
    apiType: type,
    name: item.Name || "",
    description: item.Overview || "",
    poster: image(connection, item) || image(connection, item, "Primary", item.SeriesId),
    background:
      image(connection, item, "Backdrop") ||
      (item.ParentBackdropItemId
        ? image(connection, item, "Backdrop", item.ParentBackdropItemId)
        : null),
    logo: image(connection, item, "Logo"),
    genres: item.Genres || [],
    releaseInfo: String(item.ProductionYear || ""),
    released: item.PremiereDate,
    imdbId: external.Imdb || external.imdb || null,
    tmdbId: external.Tmdb || external.tmdb || null,
    imdbRating: item.CommunityRating,
    serverItem: { connectionId: connection.id, itemId: item.Id },
    userData: item.UserData || {},
    runtimeMinutes: item.RunTimeTicks ? item.RunTimeTicks / 600000000 : null
  };
}
async function get(connection, kind, itemId, query = {}, signal) {
  const endpoint = serverEndpoint(connection, kind, itemId);
  return mediaServerRequest(connection, endpoint.path, {
    query: { ...endpoint.query, ...query },
    signal
  });
}
function playableSources(item) {
  return item?.IsMissing
    ? []
    : (item?.MediaSources || []).filter(
        (source) => String(source.Type || "").toLowerCase() !== "placeholder"
      );
}
export function buildServerDeviceProfile() {
  return {
    Name: "Nuvio Smart TV",
    MaxStreamingBitrate: 120000000,
    DirectPlayProfiles: [
      { Type: "Video", Container: "mp4,m4v,mov", VideoCodec: "h264", AudioCodec: "aac,mp3" }
    ],
    TranscodingProfiles: [
      {
        Type: "Video",
        Container: "ts",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
        MinSegments: 1,
        BreakOnNonKeyFrames: false
      }
    ],
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "ass", Method: "External" }
    ]
  };
}
export const MediaServerRepository = {
  connections(id) {
    return MediaServerStore.get(id).connections;
  },
  connection(id, pid) {
    return this.connections(pid).find((entry) => entry.id === id);
  },
  async connect({ providerId, address, username, password, connectionId = null }) {
    if (!["jellyfin", "emby"].includes(providerId)) throw new Error("servers_error_failed");
    const pid = profile();
    const normalized = normalizeMediaServerAddress(address, providerId);
    if (!normalized) throw new Error("servers_error_address");
    const draft = { address: normalized, providerId };
    const info = await mediaServerRequest(draft, "/System/Info/Public", { publicInfo: true });
    if (
      !isSupportedServerVersion(providerId, info?.Version) ||
      (providerId === "emby" && /jellyfin/i.test(info?.ProductName || ""))
    )
      throw new Error("servers_error_unsupported");
    const auth = await mediaServerRequest(draft, "/Users/AuthenticateByName", {
      method: "POST",
      body: { Username: username, Pw: password }
    });
    if (!auth?.AccessToken || !auth.User?.Id) throw new Error("servers_error_auth");
    const id =
      connectionId ||
      globalThis.crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const connection = {
      ...draft,
      id,
      name: info.ServerName || new URL(normalized).hostname,
      remoteServerId: auth.ServerId || info.Id,
      remoteUserId: auth.User.Id,
      userName: auth.User.Name || username,
      token: auth.AccessToken,
      enabled: true,
      useCatalogMetadata: false,
      importWatchState: false,
      libraries: [],
      aioStreams: Boolean(info.AIOStreams || info.aioStreams)
    };
    connection.libraries = await this.libraries(connection);
    if (profile() !== pid) throw new Error("servers_error_failed");
    const old = this.connection(id, pid);
    MediaServerStore.set(
      [
        ...this.connections(pid).filter((entry) => entry.id !== id),
        {
          ...connection,
          ...(old
            ? {
                enabled: old.enabled,
                useCatalogMetadata: old.useCatalogMetadata,
                importWatchState: old.importWatchState,
                libraries: connection.libraries.map((lib) => ({
                  ...lib,
                  selected: old.libraries.find((entry) => entry.id === lib.id)?.selected !== false
                }))
              }
            : {})
        }
      ],
      pid
    );
    this.changed();
    return connection;
  },
  async libraries(connection) {
    const data = await get(connection, "views");
    return (data?.Items || [])
      .map((item) => ({
        id: item.Id,
        name: item.Name || "",
        kind: libraryKind(item),
        selected: true
      }))
      .filter((lib) => lib.kind);
  },
  async refreshLibraries(id) {
    const pid = profile();
    const connection = this.connection(id, pid);
    const libraries = await this.libraries(connection);
    const current = this.connection(id, pid);
    if (
      profile() !== pid ||
      !current ||
      current.token !== connection.token ||
      current.address !== connection.address ||
      current.remoteUserId !== connection.remoteUserId
    )
      return;
    MediaServerStore.update(
      id,
      {
        libraries: libraries.map((lib) => ({
          ...lib,
          selected: current.libraries.find((entry) => entry.id === lib.id)?.selected !== false
        }))
      },
      pid
    );
    this.changed();
  },
  update(id, partial) {
    MediaServerStore.update(id, partial);
    this.changed();
  },
  async remove(id) {
    const pid = profile();
    const connection = this.connection(id, pid);
    if (!connection) return;
    MediaServerStore.set(
      this.connections(pid).filter((entry) => entry.id !== id),
      pid
    );
    this.changed();
    try {
      await mediaServerRequest(connection, "/Sessions/Logout", { method: "POST" });
    } catch (_) {
      /* Removal remains effective while the server is unavailable. */
    }
  },
  changed() {
    refs.clear();
    genreScopes.clear();
    titleNames.clear();
    globalThis.document?.dispatchEvent?.(new CustomEvent("nuvio:media-servers-changed"));
  },
  addons() {
    return this.connections()
      .filter((entry) => entry.enabled && entry.libraries.some((lib) => lib.selected))
      .map((connection) => {
        const kinds = [
          ...new Set(
            connection.libraries
              .filter((lib) => lib.selected)
              .flatMap((lib) =>
                lib.kind === "mixed"
                  ? ["movie", "series"]
                  : lib.kind === "collection"
                    ? []
                    : [lib.kind]
              )
          )
        ];
        const revision = MediaServerStore.get().revision;
        return {
          id: `media-server-${connection.id}`,
          name: connection.name,
          displayName: connection.name,
          version: String(revision),
          baseUrl: `nuvio-server://${connection.id}?revision=${revision}`,
          types: kinds,
          resources: [
            { name: "catalog", types: [] },
            { name: "stream", types: kinds },
            { name: "meta", types: ["movie", "series", "collection"], idPrefixes: ["server:"] }
          ],
          catalogs: [
            {
              id: "resume",
              type: "movie",
              apiType: "movie",
              name: I18n.t("servers_resume_row"),
              extra: []
            },
            ...connection.libraries
              .filter((lib) => lib.selected)
              .map((lib) => ({
                id: `library-${lib.id}`,
                type: lib.kind,
                apiType: lib.kind,
                name: lib.name,
                extra: [{ name: "skip", isRequired: false }]
              })),
            ...kinds.map((type) => ({
              id: `search-${type}`,
              type,
              apiType: type,
              name: connection.name,
              extra: [{ name: "search", isRequired: true }]
            }))
          ]
        };
      });
  },
  fromBase(base) {
    return this.connection(String(base).slice("nuvio-server://".length).split("?")[0]);
  },
  async catalog({ addonBaseUrl, catalogId, type, skip = 0, extraArgs = {}, signal }) {
    const pid = profile();
    const connection = this.fromBase(addonBaseUrl);
    if (!connection?.enabled) return { status: "error", message: "servers_failure_not_found" };
    try {
      let data;
      let hasMore = false;
      if (catalogId === "resume") {
        if (skip) return { status: "success", data: { items: [], hasMore: false } };
        data = await get(
          connection,
          "resume",
          null,
          { limit: 100, fields: LIST_FIELDS, mediaTypes: "Video" },
          signal
        );
      } else if (catalogId.startsWith("search-")) {
        const search = String(extraArgs.search || "").trim();
        if (!search || skip) return { status: "success", data: { items: [], hasMore: false } };
        const libraries = connection.libraries.filter(
          (lib) => lib.selected && (lib.kind === type || lib.kind === "mixed")
        );
        const scopes = connection.aioStreams ? [null] : libraries;
        const results = await Promise.all(
          scopes.map((lib) =>
            get(
              connection,
              "items",
              null,
              {
                parentId: lib?.id,
                recursive: true,
                includeItemTypes: type === "movie" ? "Movie" : "Series",
                searchTerm: search,
                limit: 100,
                fields: LIST_FIELDS
              },
              signal
            )
          )
        );
        data = { Items: results.flatMap((result) => result?.Items || []) };
      } else if (catalogId.startsWith("collection-")) {
        data = await get(
          connection,
          "items",
          null,
          {
            parentId: catalogId.slice("collection-".length),
            recursive: false,
            fields: LIST_FIELDS,
            sortBy: "SortName",
            sortOrder: "Ascending",
            startIndex: skip,
            limit: PAGE_SIZE,
            enableTotalRecordCount: true
          },
          signal
        );
        hasMore = skip + (data?.Items?.length || 0) < Number(data?.TotalRecordCount || 0);
      } else {
        const library = connection.libraries.find(
          (lib) => lib.id === catalogId.replace(/^library-/, "") && lib.selected
        );
        if (!library) return { status: "error", message: "servers_failure_not_found" };
        const scopeKey = `${pid}:${connection.id}:${library.id}`;
        const query = {
          genreIds: genreScopes.get(scopeKey),
          parentId: library.id,
          recursive: library.kind !== "collection",
          includeItemTypes:
            library.kind === "mixed"
              ? "Movie,Series"
              : library.kind === "movie"
                ? "Movie"
                : library.kind === "series"
                  ? "Series"
                  : undefined,
          fields: LIST_FIELDS,
          sortBy: library.kind === "collection" ? "SortName" : "DateCreated,SortName",
          sortOrder: library.kind === "collection" ? "Ascending" : "Descending",
          startIndex: skip,
          limit: PAGE_SIZE,
          enableTotalRecordCount: true
        };
        data = await get(connection, "items", null, query, signal);
        if (!skip && !data?.Items?.length && library.kind !== "collection") {
          const genres = await mediaServerRequest(connection, "/Genres", {
            query: { parentId: library.id, userId: connection.remoteUserId, limit: 1 },
            signal
          });
          const genre = genres?.Items?.[0]?.Id;
          if (genre) {
            genreScopes.set(scopeKey, genre);
            data = await get(connection, "items", null, { ...query, genreIds: genre }, signal);
          }
        }
        hasMore = skip + (data?.Items?.length || 0) < Number(data?.TotalRecordCount || 0);
      }
      if (profile() !== pid) return { status: "error", message: "servers_error_failed" };
      const seen = new Set();
      const items = (data?.Items || [])
        .map((item) => mapServerItem(connection, item))
        .filter((item) => item && !seen.has(item.id) && seen.add(item.id));
      return {
        status: "success",
        data: {
          items,
          hasMore,
          supportsSkip: hasMore,
          skipStep: PAGE_SIZE,
          nextSkip: skip + (data?.Items?.length || 0),
          addonBaseUrl,
          addonId: `media-server-${connection.id}`,
          addonName: connection.name,
          catalogId,
          catalogName: connection.name,
          type
        }
      };
    } catch (error) {
      return {
        status: "error",
        message: error?.message?.startsWith("servers_")
          ? error.message
          : "servers_failure_unreachable"
      };
    }
  },
  async meta(id, signal) {
    const pid = profile();
    const ref = parseServerItem(id);
    if (!ref) return null;
    const connection = this.connection(ref.connectionId);
    if (!connection?.enabled) return null;
    const item = await get(connection, "item", ref.itemId, { fields: LIST_FIELDS }, signal);
    if (profile() !== pid) return null;
    const result = mapServerItem(connection, item);
    if (!result) return null;
    result.id = id;
    result.videos = [];
    let stateItems = [item];
    if (result.type === "series") {
      const episodes = await mediaServerRequest(connection, `/Shows/${key(item.Id)}/Episodes`, {
        query: { userId: connection.remoteUserId, fields: LIST_FIELDS },
        signal
      });
      stateItems = episodes?.Items || [];
      result.videos = (episodes?.Items || [])
        .filter((episode) => !episode.IsMissing)
        .map((episode) => ({
          id: serverId(connection, episode.Id),
          title: episode.Name || "",
          season: episode.ParentIndexNumber,
          episode: episode.IndexNumber,
          thumbnail: image(connection, episode),
          released: episode.PremiereDate,
          overview: episode.Overview,
          runtimeMinutes: episode.RunTimeTicks / 600000000,
          rating: episode.CommunityRating,
          available: !episode.IsMissing
        }));
    }
    if (profile() !== pid) return null;
    if (connection.importWatchState) projectServerUserState(result, stateItems, pid);
    return result;
  },
  async streams(base, type, videoId, signal) {
    const pid = profile();
    const connection = this.fromBase(base);
    if (!connection?.enabled) return { status: "success", data: [] };
    try {
      let ref = parseServerItem(videoId) || refs.get(`${profile()}:${connection.id}:${videoId}`);
      if (ref && ref.connectionId !== connection.id) return { status: "success", data: [] };
      if (!ref) {
        const match = String(videoId).match(/^(tt\d+|tmdb:\d+)(?::(\d+):(\d+))?$/);
        if (!match) return { status: "success", data: [] };
        const external = match[1].startsWith("tt")
          ? { name: "Imdb", id: match[1] }
          : { name: "Tmdb", id: match[1].slice(5) };
        const scopes = connection.libraries.filter(
          (library) => library.selected && (library.kind === type || library.kind === "mixed")
        );
        if (!scopes.length) return { status: "success", data: [] };
        const lookup = async (query) => {
          const matches = await Promise.all(
            scopes.map((library) =>
              get(
                connection,
                "items",
                null,
                {
                  parentId: library.id,
                  recursive: true,
                  includeItemTypes: type === "movie" ? "Movie" : "Series",
                  fields: LIST_FIELDS,
                  limit: 100,
                  ...query
                },
                signal
              )
            )
          );
          const unique = new Map(
            matches.flatMap((result) => result?.Items || []).map((item) => [item.Id, item])
          );
          // A title narrows the search; only provider identity can authorize playback.
          return [...unique.values()].filter(
            (item) =>
              String(
                item.ProviderIds?.[external.name] ||
                  item.ProviderIds?.[external.name.toLowerCase()] ||
                  ""
              ) === external.id
          );
        };
        let exact = await lookup({ anyProviderIdEquals: `${external.name}.${external.id}` });
        if (!exact.length && !signal?.aborted && profile() === pid) {
          const titleKey = `${pid}:${type}:${match[1]}`;
          let title = titleNames.get(titleKey);
          if (!title) {
            const { metaRepository } = await import("../repository/metaRepository.js");
            let timer;
            try {
              const cached = metaRepository.getCachedMeta(type, match[1]);
              const meta =
                cached ||
                (
                  await Promise.race([
                    metaRepository.getMetaFromAllAddons(type, match[1]).catch(() => null),
                    new Promise((resolve) => {
                      timer = setTimeout(() => resolve(null), 3000);
                    })
                  ])
                )?.data;
              title = String(meta?.name || "").trim();
              if (title) {
                if (titleNames.size >= 200) titleNames.delete(titleNames.keys().next().value);
                titleNames.set(titleKey, title);
              }
            } finally {
              clearTimeout(timer);
            }
          }
          if (title && !signal?.aborted && profile() === pid)
            exact = await lookup({ searchTerm: title });
        }
        if (exact.length !== 1) return { status: "success", data: [] };
        let itemId = exact[0].Id;
        if (type !== "movie" && match[2] && match[3]) {
          const episodes = await mediaServerRequest(connection, `/Shows/${key(itemId)}/Episodes`, {
            query: {
              userId: connection.remoteUserId,
              season: Number(match[2]),
              fields: LIST_FIELDS
            },
            signal
          });
          const exactEpisodes = (episodes?.Items || []).filter(
            (episode) =>
              episode.ParentIndexNumber === Number(match[2]) &&
              episode.IndexNumber === Number(match[3]) &&
              (!episode.IndexNumberEnd || episode.IndexNumberEnd === episode.IndexNumber) &&
              !episode.IsMissing
          );
          if (exactEpisodes.length !== 1) return { status: "success", data: [] };
          itemId = exactEpisodes[0].Id;
        } else if (type !== "movie") return { status: "success", data: [] };
        ref = { connectionId: connection.id, itemId };
      }
      const item = await get(connection, "item", ref.itemId, { fields: LIST_FIELDS }, signal);
      if (profile() !== pid) return { status: "success", data: [] };
      const data = playableSources(item).map((source) => {
        const video = source.MediaStreams?.find((stream) => stream.Type === "Video");
        const audio = source.MediaStreams?.find((stream) => stream.Type === "Audio");
        return {
          id: `${connection.id}:${item.Id}:${source.Id}`,
          name: connection.name,
          title: source.Name || video?.DisplayTitle || item.Name,
          description: [video?.DisplayTitle, audio?.DisplayTitle, source.Container?.toUpperCase()]
            .filter(Boolean)
            .join(" • "),
          addonName: connection.name,
          clientResolve: { mediaServer: { ...ref, mediaSourceId: source.Id } },
          serverUserState: serverUserState(item),
          behaviorHints: { filename: source.Path?.split(/[\\/]/).pop(), videoSize: source.Size },
          serverItem: ref
        };
      });
      return { status: "success", data };
    } catch (error) {
      return { status: "error", message: error?.message || "servers_failure_unreachable" };
    }
  },
  async resolve(stream) {
    const target = (stream.clientResolve || stream.raw?.clientResolve)?.mediaServer;
    if (!target) return { status: "unavailable" };
    const pid = profile();
    const connection = this.connection(target.connectionId, pid);
    if (!connection?.enabled) return { status: "unavailable" };
    const body = {
      UserId: connection.remoteUserId,
      MediaSourceId: target.mediaSourceId,
      MaxStreamingBitrate: 120000000,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: false,
      IsPlayback: true,
      DeviceProfile: buildServerDeviceProfile()
    };
    const resumeItem = await get(connection, "item", target.itemId, { fields: "UserData" }).catch(
      () => null
    );
    if (profile() !== pid) return { status: "unavailable" };
    const info = await mediaServerRequest(connection, `/Items/${key(target.itemId)}/PlaybackInfo`, {
      method: "POST",
      query: {
        userId: connection.remoteUserId,
        mediaSourceId: target.mediaSourceId,
        maxStreamingBitrate: body.MaxStreamingBitrate,
        enableDirectPlay: true
      },
      body
    });
    if (profile() !== pid || info?.ErrorCode) return { status: "unavailable" };
    const source =
      info?.MediaSources?.find((entry) => entry.Id === target.mediaSourceId) ||
      info?.MediaSources?.find((entry) => String(entry.Type).toLowerCase() !== "placeholder");
    if (!source) return { status: "unavailable" };
    let url, playMethod;
    if (source.SupportsDirectPlay) {
      url = mediaServerUrl(connection, `/Videos/${key(target.itemId)}/stream`, {
        static: true,
        mediaSourceId: source.Id,
        playSessionId: info.PlaySessionId,
        deviceId: mediaServerDeviceId(),
        tag: source.ETag,
        api_key: connection.token
      });
      playMethod = "DirectPlay";
    } else if (source.TranscodingUrl) {
      url = new URL(mediaServerAssetUrl(connection, source.TranscodingUrl));
      if (url.origin === new URL(connection.address).origin)
        url.searchParams.set("api_key", connection.token);
      url = url.toString();
      playMethod = source.SupportsDirectStream ? "DirectStream" : "Transcode";
    } else return { status: "unavailable" };
    const subtitles = (source.MediaStreams || [])
      .filter(
        (entry) =>
          String(entry.Type).toLowerCase() === "subtitle" &&
          entry.DeliveryUrl &&
          String(entry.DeliveryMethod).toLowerCase() === "external"
      )
      .map((entry) => {
        const url = new URL(mediaServerAssetUrl(connection, entry.DeliveryUrl));
        const sameOrigin = url.origin === new URL(connection.address).origin;
        if (sameOrigin) url.searchParams.set("api_key", connection.token);
        return {
          id: `server-sub-${entry.Index}`,
          url: url.toString(),
          lang: entry.Language || "und",
          name: entry.DisplayTitle,
          headers: sameOrigin ? mediaServerHeaders(connection) : {}
        };
      });
    const playback = {
      ...target,
      profileId: pid,
      mediaSourceId: source.Id,
      playSessionId: info.PlaySessionId,
      playMethod
    };
    return {
      status: "success",
      stream: {
        ...stream,
        url,
        subtitles,
        serverUserState: resumeItem ? serverUserState(resumeItem) : stream.serverUserState,
        serverPlayback: playback,
        raw: { ...stream.raw, subtitles, serverPlayback: playback },
        mimeType: playMethod === "DirectPlay" ? null : "application/x-mpegURL",
        behaviorHints: {
          ...stream.behaviorHints,
          filename: source.Path?.split(/[\\/]/).pop() || stream.behaviorHints?.filename
        }
      }
    };
  },
  async report(playback, event, positionMs, paused) {
    const connection = this.connection(playback.connectionId, playback.profileId);
    if (!connection) return;
    const path =
      event === "start"
        ? "/Sessions/Playing"
        : event === "stop"
          ? "/Sessions/Playing/Stopped"
          : "/Sessions/Playing/Progress";
    await mediaServerRequest(connection, path, {
      method: "POST",
      body: {
        ItemId: playback.itemId,
        MediaSourceId: playback.mediaSourceId,
        PlaySessionId: playback.playSessionId,
        PositionTicks: Math.max(0, Math.round(positionMs || 0)) * 10000,
        IsPaused: Boolean(paused),
        PlayMethod: playback.playMethod,
        CanSeek: true,
        ...(event === "pause"
          ? { EventName: "Pause" }
          : event === "resume"
            ? { EventName: "Unpause" }
            : event === "progress"
              ? { EventName: "TimeUpdate" }
              : {})
      }
    });
  },
  async watchedTargets(item, profileId = profile()) {
    const pid = String(profileId);
    if (profile() !== pid) throw new Error("servers_watched_failed");
    const direct = parseServerItem(item.contentId || item.id);
    if (!direct) return mirrorWatchTargets(this.connections(pid), item);
    const connection = this.connection(direct.connectionId, pid);
    if (!connection?.enabled) throw new Error("servers_watched_failed");
    let target = nativeServerWatchTarget(item);
    // Older local history did not persist videoId. Resolve exact coordinates
    // from the parent series; never fall back to marking the series itself.
    if (
      !target &&
      item.episode != null &&
      item.videoId == null &&
      item.season != null &&
      item.season !== "" &&
      Number.isInteger(Number(item.season)) &&
      Number(item.season) >= 0 &&
      Number.isInteger(Number(item.episode)) &&
      Number(item.episode) > 0
    ) {
      const episode = await findServerEpisode(connection, direct.itemId, item);
      if (episode?.Id && episode.Id !== direct.itemId)
        target = { connectionId: connection.id, itemId: episode.Id };
    }
    if (!target) throw new Error("servers_watched_failed");
    return [target];
  },
  async writeWatchedTarget(target, played, profileId, connectionSnapshot) {
    const connection = this.connection(target.connectionId, profileId);
    if (
      profile() !== String(profileId) ||
      !connection?.enabled ||
      JSON.stringify(connection) !== JSON.stringify(connectionSnapshot)
    )
      throw new Error("servers_watched_failed");
    const endpoint = serverEndpoint(connection, "played", target.itemId);
    await mediaServerRequest(connection, endpoint.path, {
      method: played ? "POST" : "DELETE",
      query: endpoint.query
    });
  },
  async markWatched(item, played, profileId = profile()) {
    const targets = await this.watchedTargets(item, profileId);
    for (const target of targets) {
      await this.writeWatchedTarget(
        target,
        played,
        profileId,
        this.connection(target.connectionId, profileId)
      );
    }
    return true;
  }
};
