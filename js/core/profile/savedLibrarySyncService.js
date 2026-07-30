import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { savedLibraryRepository } from "../../data/repository/savedLibraryRepository.js";
import { ProfileManager } from "./profileManager.js";

const PULL_RPC = "sync_pull_library";
const PUSH_RPC = "sync_push_library";
const PULL_PAGE_SIZE = 500;
const VALID_POSTER_SHAPES = new Set(["POSTER", "LANDSCAPE", "SQUARE"]);

function normalizePosterShape(value) {
  const shape = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_POSTER_SHAPES.has(shape) ? shape : "POSTER";
}

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function mapRemoteItem(row = {}) {
  const contentId = row.content_id || row.contentId || row.id || "";
  const updatedAtRaw =
    row.added_at ||
    row.addedAt ||
    row.updated_at ||
    row.updatedAt ||
    row.created_at ||
    row.createdAt ||
    null;
  const updatedAt = Number(updatedAtRaw);
  return {
    contentId,
    contentType: row.content_type || row.contentType || "movie",
    title: row.name || row.title || "Untitled",
    poster: row.poster || null,
    posterShape: normalizePosterShape(row.poster_shape || row.posterShape),
    background: row.background || null,
    description: row.description || "",
    releaseInfo: row.release_info || row.releaseInfo || "",
    imdbRating: row.imdb_rating ?? row.imdbRating ?? null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    addonBaseUrl: row.addon_base_url || row.addonBaseUrl || null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function toRemoteItem(item = {}) {
  return {
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    name: item.title || item.name || "Untitled",
    poster: item.poster || null,
    poster_shape: normalizePosterShape(item.posterShape || item.poster_shape),
    background: item.background || null,
    description: item.description || "",
    release_info: item.releaseInfo || "",
    imdb_rating: item.imdbRating == null ? null : Number(item.imdbRating),
    genres: Array.isArray(item.genres) ? item.genres : [],
    addon_base_url: item.addonBaseUrl || null,
    added_at: Number(item.updatedAt || item.addedAt || Date.now())
  };
}

export const SavedLibrarySyncService = {
  async pull(profileId = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const localItems = await savedLibraryRepository.getAll(1000, resolvedProfileId);
      const rows = [];
      for (let offset = 0; ; offset += PULL_PAGE_SIZE) {
        const page = await SupabaseApi.rpc(
          PULL_RPC,
          {
            p_profile_id: resolvedProfileId,
            p_limit: PULL_PAGE_SIZE,
            p_offset: offset
          },
          true
        );
        const pageRows = Array.isArray(page) ? page : [];
        rows.push(...pageRows);
        if (pageRows.length < PULL_PAGE_SIZE) {
          break;
        }
      }
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId));
      if (!remoteItems.length && localItems.length) {
        return localItems;
      }
      await savedLibraryRepository.replaceAll(remoteItems, resolvedProfileId);
      return remoteItems;
    } catch (error) {
      console.warn("Saved library sync pull failed", error);
      return [];
    }
  },

  async push(profileId = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const items = await savedLibraryRepository.getAll(1000, resolvedProfileId);
      if (!items.length) {
        return true;
      }
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_items: items.map((item) => toRemoteItem(item))
        },
        true
      );
      return true;
    } catch (error) {
      console.warn("Saved library sync push failed", error);
      return false;
    }
  }
};
