import { createProfileScopedStore } from "./profileScopedStore.js";

const SUPPORTED = new Set(["en", "es", "la", "fr", "de", "it", "pt", "ja", "ko", "zh", "hi"]);
function normalize(value = {}) {
  const preferences = value?.byContentId && typeof value.byContentId === "object" ? value.byContentId : {};
  return { byContentId: Object.fromEntries(Object.entries(preferences).map(([id, language]) => [String(id), String(language).toLowerCase()]).filter(([, language]) => SUPPORTED.has(language))) };
}
const store = createProfileScopedStore({ key: "sourceLanguagePreferences", normalize });
export const SourceLanguagePreferenceStore = {
  get(contentId) { return store.get().byContentId[String(contentId || "")] || ""; },
  set(contentId, language) {
    const id = String(contentId || "").trim();
    if (!id) return;
    const current = store.get().byContentId;
    const byContentId = { ...current };
    if (SUPPORTED.has(String(language || "").toLowerCase())) byContentId[id] = String(language).toLowerCase();
    else delete byContentId[id];
    store.set({ byContentId });
  }
};
