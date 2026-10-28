import { MdbListTracking } from "../../data/repository/mdbListTracking.js";
import * as internals from "./startupSyncService.js";

function surfaceChangedHomeInputs(result) {
  return !(result && result.ok === true && result.value === false);
}

async function getProfileHomeSignature(ProfileManager) {
  try {
    const profiles = await ProfileManager.getProfiles();
    if (!Array.isArray(profiles)) {
      return null;
    }
    return JSON.stringify(
      profiles.map((profile) => ({
        id: profile?.id,
        profileIndex: profile?.profileIndex,
        name: profile?.name,
        avatarColorHex: profile?.avatarColorHex,
        avatarId: profile?.avatarId,
        avatarUrl: profile?.avatarUrl,
        profileBackgroundId: profile?.profileBackgroundId,
        profileBackgroundUrl: profile?.profileBackgroundUrl,
        usesPrimaryAddons: profile?.usesPrimaryAddons,
        usesPrimaryPlugins: profile?.usesPrimaryPlugins,
        isPrimary: profile?.isPrimary
      }))
    );
  } catch (_) {
    return null;
  }
}

export function createStartupSyncServiceMethods02() {
  const {
    AuthManager,
    ProfileManager,
    ProfileSyncService,
    addonRepository,
    LibrarySyncService,
    WatchProgressSyncService,
    SavedLibrarySyncService,
    WatchedItemsSyncService,
    PluginSyncService,
    ProfileSettingsSyncService,
    ProviderCredentialSyncService,
    MediaServerSyncService,
    SimklSyncService,
    CollectionSyncService,
    HomeCatalogSettingsSyncService,
    ThemeManager,
    MemberAccessRepository,
    I18n,
    hasProfileSettingsCloudSyncPending,
    isSyncBackoffActive,
    resetSyncBackoff,
    MAX_PULL_ATTEMPTS,
    FORCE_RESYNC_MIN_INTERVAL_MS,
    sleep,
    normalizeProfileId,
    currentSyncKey,
    canUsePersistedWarmSync,
    runSurface,
    notifySyncPullCompleted
  } = internals;

  return {
    markHomeInputsChanged(changed) {
      if (changed) {
        this.lastPullChangedHomeInputs = true;
      }
    },
    getLastPullChangedHomeInputs() {
      return this.lastPullChangedHomeInputs;
    },
    async requestSyncNow({
      force = true,
      includeProfileSettings = true,
      allowWarmRepeat = false,
      pushAfterPull = false,
      notifyPullCompleted = false
    } = {}) {
      if (!this.started) {
        return false;
      }
      const generation = this.runGeneration;
      if (this.inFlightPromise && this.inFlightGeneration === generation) {
        this.queuePendingSyncRequest({
          force,
          includeProfileSettings,
          pushAfterPull,
          notifyPullCompleted
        });
        return this.inFlightPromise;
      }
      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        this.scheduleBackoffRetry({ notifyPullCompleted });
        return false;
      }

      const profileId = ProfileManager.getActiveProfileId();
      const key = currentSyncKey(profileId);
      const now = Date.now();
      const coversProfileSettings = !includeProfileSettings || this.lastPulledIncludedProfileSettings === true;
      if (force && this.lastPulledKey === key && coversProfileSettings && now - this.lastPulledAtMs < FORCE_RESYNC_MIN_INTERVAL_MS) {
        if (notifyPullCompleted) {
          notifySyncPullCompleted({
            profileId: normalizeProfileId(profileId),
            includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
            changedHomeInputs: false,
            completedAt: Date.now()
          });
        }
        return true;
      }
      if (!force && !allowWarmRepeat && canUsePersistedWarmSync(key, includeProfileSettings, now)) {
        // Android's warm cycle runs the same broad remote pull as a cold
        // startup, including the plugin surface. Keep the service lazy while
        // preserving that timing and ordering instead of pulling plugins only.
        const warmPullSucceeded = await this.syncPull({
          includeProfileScoped: this.profileScopedSyncEnabled,
          includeProfileSettings,
          generation,
          profileId,
          key
        });
        if (warmPullSucceeded && this.isCurrentRun(generation) && !isSyncBackoffActive()) {
          this.markFullPullSucceeded(key, includeProfileSettings);
          this.lastPullCompleted = true;
          resetSyncBackoff();
          if (notifyPullCompleted) {
            notifySyncPullCompleted({
              profileId: normalizeProfileId(profileId),
              includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
              changedHomeInputs: Boolean(this.lastPullChangedHomeInputs),
              completedAt: Date.now()
            });
          }
          return true;
        }
        this.lastPullCompleted = false;
        if (isSyncBackoffActive()) {
          this.scheduleBackoffRetry({ notifyPullCompleted });
        }
        return false;
      }

      let requestPromise = null;
      requestPromise = (async () => {
        this.inFlight = true;
        this.lastPullCompleted = false;
        let completed = false;
        try {
          for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
            if (!this.isCurrentRun(generation) || !AuthManager.isAuthenticated) {
              break;
            }
            if (!this.isCurrentProfile(profileId, key)) {
              break;
            }
            if (isSyncBackoffActive()) {
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }

            const didComplete = await this.syncPull({
              includeProfileScoped: this.profileScopedSyncEnabled,
              includeProfileSettings,
              generation,
              profileId,
              key
            });
            if (didComplete && this.isCurrentRun(generation) && !isSyncBackoffActive()) {
              if (pushAfterPull && this.profileScopedSyncEnabled) {
                await this.syncPush({ generation, profileId, key });
              }
              if (!isSyncBackoffActive()) {
                this.markFullPullSucceeded(key, includeProfileSettings);
                resetSyncBackoff();
                completed = true;
                if (notifyPullCompleted) {
                  notifySyncPullCompleted({
                    profileId: normalizeProfileId(profileId),
                    includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
                    changedHomeInputs: Boolean(this.lastPullChangedHomeInputs),
                    completedAt: Date.now()
                  });
                }
                break;
              }
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }
            if (isSyncBackoffActive()) {
              this.scheduleBackoffRetry({ notifyPullCompleted });
              break;
            }
            if (attempt < MAX_PULL_ATTEMPTS) {
              await sleep(3000, AuthManager.getSessionSignal?.());
            }
          }
          this.lastPullCompleted = completed;
          return completed;
        } finally {
          this.inFlight = false;
          if (this.inFlightPromise === requestPromise) {
            this.inFlightPromise = null;
            this.inFlightGeneration = 0;
          }
          const pending = this.pendingSyncRequest;
          this.pendingSyncRequest = null;
          if (pending && this.isCurrentRun(generation)) {
            setTimeout(() => {
              void this.requestSyncNow(pending).catch((error) => {
                console.warn("Queued startup sync failed", error);
              });
            }, 0);
          }
        }
      })();
      this.inFlightPromise = requestPromise;
      this.inFlightGeneration = generation;
      return requestPromise;
    },
    async syncPull({
      includeProfileScoped = this.profileScopedSyncEnabled,
      includeProfileSettings = true,
      generation = this.runGeneration,
      profileId = ProfileManager.getActiveProfileId(),
      key = currentSyncKey(profileId)
    } = {}) {
      if (!this.isCurrentRun(generation) || !AuthManager.isAuthenticated || !this.isCurrentProfile(profileId, key)) {
        return false;
      }
      this.lastPullChangedHomeInputs = false;
      WatchedItemsSyncService.resetLastPullChangedHomeInputs?.();
      WatchProgressSyncService.resetLastPullChangedHomeInputs?.();
      const profileSignatureBefore = await getProfileHomeSignature(ProfileManager);
      if (profileSignatureBefore == null) {
        this.markHomeInputsChanged(true);
      }
      let profileSettingsSignatureBefore = null;
      if (includeProfileSettings) {
        try {
          profileSettingsSignatureBefore = ProfileSettingsSyncService.getHomeInputSignature?.(profileId) ?? null;
        } catch (_) {
          this.markHomeInputsChanged(true);
        }
      }
      await ProfileSyncService.pull();
      if (!this.isCurrentProfile(profileId, key)) {
        return false;
      }
      const profileStatus = ProfileSyncService.getLastPullStatus?.();
      const profileSignatureAfter = await getProfileHomeSignature(ProfileManager);
      this.markHomeInputsChanged(
        profileStatus !== "ok" ||
          profileSignatureBefore == null ||
          profileSignatureAfter == null ||
          profileSignatureBefore !== profileSignatureAfter
      );
      if (profileStatus === "deferred") {
        this.scheduleBackoffRetry();
        return false;
      }
      if (profileStatus !== "ok") {
        return false;
      }

      const activeProfileId = profileId;
      if (includeProfileSettings) {
        const profileSettingsResult = await runSurface("profile settings", async () => {
          const didApply = await ProfileSettingsSyncService.pull(activeProfileId);
          if (hasProfileSettingsCloudSyncPending(activeProfileId) && !isSyncBackoffActive()) {
            await ProfileSettingsSyncService.push(activeProfileId);
          }
          return didApply;
        });
        let profileSettingsSignatureAfter = null;
        try {
          profileSettingsSignatureAfter = ProfileSettingsSyncService.getHomeInputSignature?.(activeProfileId) ?? null;
        } catch (_) {}
        this.markHomeInputsChanged(
          !profileSettingsResult.ok ||
            profileSettingsSignatureBefore == null ||
            profileSettingsSignatureAfter == null ||
            profileSettingsSignatureBefore !== profileSettingsSignatureAfter
        );
        if (profileSettingsResult.ok && profileSettingsResult.value) {
          await runSurface("profile settings theme", async () => {
            await I18n.init();
            const memberAccess = await MemberAccessRepository.getAccess().catch(() => MemberAccessRepository.getCurrentAccess());
            ThemeManager.apply({ enforceAccess: true, access: memberAccess });
            I18n.apply();
          });
        }
      }

      await Promise.all([
        runSurface("provider credentials", () => ProviderCredentialSyncService.syncFromRemote(activeProfileId)),
        runSurface("media servers", () => MediaServerSyncService.syncFromRemote(activeProfileId)),
        runSurface("MDBList refresh", () => MdbListTracking.refresh()),
        runSurface("Simkl refresh", () =>
          SimklSyncService.refresh().catch((error) => {
            console.warn("Simkl automatic refresh failed", error);
            return false;
          })
        )
      ]);

      if (!this.isCurrentProfile(profileId, key)) {
        return false;
      }

      if (!includeProfileScoped) {
        return this.isCurrentRun(generation) && !isSyncBackoffActive();
      }
      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        return false;
      }

      const addonUrlsBefore = JSON.stringify(addonRepository.getInstalledAddonUrls());
      const homeSurfaceResults = await Promise.all([
        // Android pulls plugins and addons as independent surfaces. Keep a
        // plugin-service/readiness failure from suppressing the addon snapshot.
        runSurface("plugins", () => PluginSyncService.pull(activeProfileId)),
        runSurface("collections", () => CollectionSyncService.pull(activeProfileId)),
        runSurface("home catalog settings", () => HomeCatalogSettingsSyncService.pull(activeProfileId)),
        runSurface("addons", () => LibrarySyncService.pull()),
        runSurface("saved library", () => SavedLibrarySyncService.pull(activeProfileId))
      ]);

      // Only these three surfaces provide Home catalog rows. The profile
      // settings surface is checked separately against the exact settings the
      // current Home render consumed; plugin settings and the saved-library
      // list do not form catalog or Continue Watching rows.
      const collectionsResult = homeSurfaceResults[1];
      const homeCatalogSettingsResult = homeSurfaceResults[2];
      this.markHomeInputsChanged(surfaceChangedHomeInputs(collectionsResult) || CollectionSyncService.getLastPullFailed?.() !== false);
      this.markHomeInputsChanged(
        surfaceChangedHomeInputs(homeCatalogSettingsResult) || HomeCatalogSettingsSyncService.getLastPullFailed?.() !== false
      );
      const addonUrlsAfter = JSON.stringify(addonRepository.getInstalledAddonUrls());
      const addonPullStatus = LibrarySyncService.getLastPullStatus?.();
      this.markHomeInputsChanged(addonUrlsBefore !== addonUrlsAfter || addonPullStatus?.state !== "ok");

      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        return false;
      }
      const watchedItemsResult = await runSurface("watched items", async () => {
        await WatchedItemsSyncService.pull(activeProfileId);
        return WatchedItemsSyncService.getLastPullChangedHomeInputs?.() === false ? false : true;
      });
      this.markHomeInputsChanged(surfaceChangedHomeInputs(watchedItemsResult));
      if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
        return false;
      }
      const watchProgressResult = await runSurface("watch progress", async () => {
        await WatchProgressSyncService.pull(activeProfileId);
        return WatchProgressSyncService.getLastPullChangedHomeInputs?.() === false ? false : true;
      });
      this.markHomeInputsChanged(surfaceChangedHomeInputs(watchProgressResult));
      return this.isCurrentRun(generation) && !isSyncBackoffActive();
    },
    async requestWatchStateSyncNow() {
      if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
        return false;
      }
      const generation = this.runGeneration;
      const profileId = ProfileManager.getActiveProfileId();
      const profileKey = currentSyncKey(profileId);
      if (this.watchStateInFlightPromise && this.watchStateInFlightGeneration === generation) {
        return this.watchStateInFlightPromise;
      }
      if (isSyncBackoffActive()) {
        this.scheduleBackoffRetry();
        return false;
      }

      const watchedItemsRevisionBefore = WatchedItemsSyncService.getHomeInputChangeRevision?.() ?? 0;
      const watchProgressRevisionBefore = WatchProgressSyncService.getHomeInputChangeRevision?.() ?? 0;
      let requestPromise = null;
      requestPromise = (async () => {
        try {
          if (!this.isCurrentProfile(profileId, profileKey)) {
            return false;
          }
          const watchedResult = await runSurface("periodic watched items", () => WatchedItemsSyncService.pull(profileId));
          if (!watchedResult.ok) {
            return false;
          }
          if (watchedResult.ok && WatchedItemsSyncService.getLastPullHadUnsynced?.() && !isSyncBackoffActive()) {
            await runSurface("periodic watched items push", () => WatchedItemsSyncService.push(profileId));
          }
          if (!isSyncBackoffActive()) {
            if (!this.isCurrentProfile(profileId, profileKey)) {
              return false;
            }
            const progressResult = await runSurface("periodic watch progress", () => WatchProgressSyncService.pull(profileId));
            if (!progressResult.ok) {
              return false;
            }
            if (progressResult.ok && WatchProgressSyncService.getLastPullHadUnsynced?.() && !isSyncBackoffActive()) {
              await runSurface("periodic watch progress push", () => WatchProgressSyncService.push(profileId));
            }
          }
          if (isSyncBackoffActive()) {
            this.scheduleBackoffRetry();
            return false;
          }
          const requestIsCurrent = this.isCurrentRun(generation) && this.isCurrentProfile(profileId, profileKey);
          const changedHomeInputs =
            watchedItemsRevisionBefore !== (WatchedItemsSyncService.getHomeInputChangeRevision?.() ?? 0) ||
            watchProgressRevisionBefore !== (WatchProgressSyncService.getHomeInputChangeRevision?.() ?? 0);
          if (requestIsCurrent && changedHomeInputs) {
            notifySyncPullCompleted({
              profileId: normalizeProfileId(profileId),
              includeProfileScoped: true,
              changedHomeInputs: true,
              source: "watch-state",
              completedAt: Date.now()
            });
          }
          return requestIsCurrent;
        } finally {
          if (this.watchStateInFlightPromise === requestPromise) {
            this.watchStateInFlightPromise = null;
            this.watchStateInFlightGeneration = 0;
          }
        }
      })();
      this.watchStateInFlightPromise = requestPromise;
      this.watchStateInFlightGeneration = generation;
      return requestPromise;
    }
  };
}
