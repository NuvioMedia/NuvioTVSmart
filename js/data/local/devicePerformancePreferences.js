import { LocalStore } from "../../core/storage/localStore.js";

// Rendering cost depends on the TV hardware, not the profile, so this stays
// device-local and is never synced to the cloud.
const KEY = "devicePerformanceMode";

export const PERFORMANCE_MODES = Object.freeze(["auto", "performance", "quality"]);

export function normalizePerformanceMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return PERFORMANCE_MODES.includes(mode) ? mode : "auto";
}

export const DevicePerformancePreferences = {
  getMode() {
    return normalizePerformanceMode(LocalStore.get(KEY, "auto"));
  },

  setMode(mode) {
    const next = normalizePerformanceMode(mode);
    LocalStore.set(KEY, next);
    return next;
  }
};
