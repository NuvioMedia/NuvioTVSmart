import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "tizenPlaybackSettings";

function normalize(value) {
  return {
    alwaysUsePlaybackProxy: value?.alwaysUsePlaybackProxy === true
  };
}

// Network workarounds belong to this TV, not to a profile or synced account.
export const TizenPlaybackSettingsStore = {
  get() {
    return normalize(LocalStore.get(KEY));
  },

  set(partial = {}) {
    const next = normalize({ ...this.get(), ...partial });
    LocalStore.set(KEY, next);
    return next;
  }
};
