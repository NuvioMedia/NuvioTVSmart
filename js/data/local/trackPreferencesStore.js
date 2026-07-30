import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "trackPreferences";
const MAX_ENTRIES = 500;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function normalizeText(value) {
  return String(value ?? "").trim() || null;
}

function normalizeAudioPreference(value = {}) {
  const preference = {
    language: normalizeText(value?.language),
    name: normalizeText(value?.name),
    trackId: normalizeText(value?.trackId)
  };
  return Object.values(preference).some(Boolean) ? preference : null;
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function writeAll(next) {
  LocalStore.set(KEY, next && typeof next === "object" ? next : {});
}

function readEntries(profileId = activeProfileId()) {
  const entries = readAll()[String(profileId || "1")];
  return Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry === "object" && entry.contentId)
    : [];
}

function writeEntries(profileId, entries) {
  const all = readAll();
  all[String(profileId || "1")] = entries;
  writeAll(all);
}

export const TrackPreferencesStore = {
  getAudio(contentId, profileId = activeProfileId()) {
    const normalizedContentId = normalizeText(contentId);
    if (!normalizedContentId) {
      return null;
    }
    const entry = readEntries(profileId).find(
      (candidate) => candidate.contentId === normalizedContentId
    );
    return normalizeAudioPreference(entry?.audio);
  },

  setAudio(contentId, audio, profileId = activeProfileId()) {
    const normalizedContentId = normalizeText(contentId);
    const normalizedAudio = normalizeAudioPreference(audio);
    if (!normalizedContentId || !normalizedAudio) {
      return;
    }

    const entries = readEntries(profileId).filter(
      (entry) => entry.contentId !== normalizedContentId
    );
    entries.unshift({
      contentId: normalizedContentId,
      audio: normalizedAudio,
      updatedAtMs: Date.now()
    });
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeEntries(profileId, entries);
  }
};
