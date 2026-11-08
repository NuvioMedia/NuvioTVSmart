/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods16() {
  const { P2pCacheService } = internals;

  return {
    async refreshP2pCacheState({ render = false } = {}) {
      if (!P2pCacheService.supportsCacheControls()) {
        this.p2pCacheState = { supported: false, available: false };
        return;
      }
      const token = Number(this.p2pCacheRefreshToken || 0) + 1;
      this.p2pCacheRefreshToken = token;
      try {
        const state = await P2pCacheService.getState();
        if (this.p2pCacheRefreshToken !== token) {
          return;
        }
        this.p2pCacheState = state;
      } catch (error) {
        if (this.p2pCacheRefreshToken !== token) {
          return;
        }
        this.p2pCacheState = { supported: true, available: false };
      }
      if (render && this.activeSection === "playback") {
        void this.render({ refreshModel: false });
      }
    },

    async clearP2pCache() {
      if (this.p2pCacheClearing || !P2pCacheService.supportsCacheControls()) {
        return;
      }
      this.p2pCacheClearing = true;
      this.p2pCacheClearedBytes = null;
      void this.render({ refreshModel: false });
      try {
        const result = await P2pCacheService.clearCache();
        this.p2pCacheClearedBytes = result?.cleared ? result.reclaimedBytes : null;
      } catch (error) {
        this.p2pCacheClearedBytes = null;
      } finally {
        this.p2pCacheClearing = false;
      }
      await this.refreshP2pCacheState();
      void this.render({ refreshModel: false });
    }
  };
}
