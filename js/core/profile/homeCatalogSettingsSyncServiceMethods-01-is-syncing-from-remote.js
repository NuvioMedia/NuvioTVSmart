import * as internals from "./homeCatalogSettingsSyncService.js";

export function createHomeCatalogSettingsSyncServiceMethods01() {
  const {
    AuthManager,
    SupabaseApi,
    getSyncBackoffRemainingMs,
    isSyncBackoffActive,
    PUSH_RPC,
    HOME_CATALOG_SHARED_SYNC_PLATFORM,
    PUSH_DEBOUNCE_MS,
    resolveProfileId,
    currentPullToken,
    markPendingPush,
    clearPendingPush,
    pendingPushVersion,
    buildLocalPayload,
    payloadSignature,
    fetchBestRemotePayload,
    applyPayload,
    mergedSharedPayload
  } = internals;

  return {
    isSyncingFromRemote(profileId = null) {
      return this.syncingFromRemoteProfiles.has(resolveProfileId(profileId));
    },
    getLastPullFailed() {
      return this.lastPullFailed === true;
    },
    async pull(profileId = null) {
      this.lastPullFailed = false;
      if (isSyncBackoffActive()) {
        return false;
      }
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const pullToken = currentPullToken(resolvedProfileId);
      try {
        if (pendingPushVersion(pullToken) != null) {
          this.completedInitialPullTokens.add(pullToken);
          await this.push(resolvedProfileId);
          return false;
        }
        const localPayload = await buildLocalPayload(resolvedProfileId);
        const remote = await fetchBestRemotePayload(resolvedProfileId, localPayload);
        if (!remote || !(remote.payload.items || []).length) {
          if (pullToken) {
            this.completedInitialPullTokens.add(pullToken);
          }
          return false;
        }
        // A local reorder can happen while the remote request is in flight. Do
        // not let that older response replace the user's newer local choice.
        if (pendingPushVersion(pullToken) != null) {
          this.completedInitialPullTokens.add(pullToken);
          await this.push(resolvedProfileId);
          return false;
        }
        // Compare the installed rows after remote application, rather than a
        // partial remote list against the complete local inventory.
        const effectivePayload = await buildLocalPayload(resolvedProfileId, remote.payload);
        if (pendingPushVersion(pullToken) != null) {
          this.completedInitialPullTokens.add(pullToken);
          await this.push(resolvedProfileId);
          return false;
        }
        const changed = payloadSignature(effectivePayload) !== payloadSignature(localPayload);
        applyPayload(resolvedProfileId, remote.payload, effectivePayload);
        if (!changed) {
          if (pullToken) {
            this.completedInitialPullTokens.add(pullToken);
          }
          return false;
        }
        if (pullToken) {
          this.completedInitialPullTokens.add(pullToken);
        }
        return true;
      } catch (error) {
        this.lastPullFailed = true;
        console.warn("Home catalog settings sync pull failed", error);
        return false;
      }
    },
    async push(profileId = null) {
      if (isSyncBackoffActive()) {
        return false;
      }
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const pushToken = currentPullToken(resolvedProfileId);
      const pendingVersion = pendingPushVersion(pushToken);
      if (this.isSyncingFromRemote(resolvedProfileId)) {
        return false;
      }
      try {
        const localPayload = await buildLocalPayload(resolvedProfileId);
        const payload = await mergedSharedPayload(resolvedProfileId, localPayload);
        await SupabaseApi.rpc(
          PUSH_RPC,
          {
            p_profile_id: resolvedProfileId,
            p_platform: HOME_CATALOG_SHARED_SYNC_PLATFORM,
            p_settings_json: payload
          },
          true
        );
        clearPendingPush(pushToken, pendingVersion);
        return true;
      } catch (error) {
        console.warn("Home catalog settings sync push failed", error);
        return false;
      }
    },
    triggerPush(profileId = null, delayMs = PUSH_DEBOUNCE_MS) {
      if (!AuthManager.isAuthenticated) {
        return;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const pullToken = currentPullToken(resolvedProfileId);
      markPendingPush(pullToken);
      if (!pullToken || !this.completedInitialPullTokens.has(pullToken)) {
        return;
      }
      if (this.isSyncingFromRemote(resolvedProfileId)) {
        return;
      }
      const generation = this.syncGeneration;
      const profileVersion = internals.ProfileManager.getProfileDataVersion(resolvedProfileId);
      const existingTimer = this.pushTimers.get(resolvedProfileId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const cooldownMs = getSyncBackoffRemainingMs();
      const effectiveDelayMs = Math.max(PUSH_DEBOUNCE_MS, Number(delayMs) || 0, cooldownMs > 0 ? cooldownMs + 50 : 0);
      const timerId = setTimeout(async () => {
        if (generation !== this.syncGeneration || profileVersion !== internals.ProfileManager.getProfileDataVersion(resolvedProfileId)) {
          return;
        }
        this.pushTimers.delete(resolvedProfileId);
        const didPush = await this.push(resolvedProfileId);
        if (
          generation === this.syncGeneration &&
          profileVersion === internals.ProfileManager.getProfileDataVersion(resolvedProfileId) &&
          !didPush &&
          isSyncBackoffActive()
        ) {
          this.triggerPush(resolvedProfileId);
        }
      }, effectiveDelayMs);
      this.pushTimers.set(resolvedProfileId, timerId);
    }
  };
}
