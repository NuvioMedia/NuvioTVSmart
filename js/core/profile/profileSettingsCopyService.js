import { buildOutgoingBlob } from "./profileSettingsSyncServiceHelpers-05-supported-feature-names.js";
import { applyRemoteBlob } from "./profileSettingsSyncServiceHelpers-05-supported-feature-names.js";
import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { MdbListSettingsStore } from "../../data/local/mdbListSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../data/local/animeSkipSettingsStore.js";
import { ProviderCredentialSyncService } from "./providerCredentialSyncService.js";
import { AuthManager } from "../auth/authManager.js";
import { ProfileManager } from "./profileManager.js";

const DEBRID_CREDENTIAL_FIELDS = ["torboxApiKey", "premiumizeApiKey", "realDebridApiKey"];

function copyMissingCredential(store, sourceProfileId, targetProfileId, fields) {
  const source = store.getForProfile(sourceProfileId) || {};
  const target = store.getForProfile(targetProfileId) || {};
  const partial = {};
  fields.forEach((field) => {
    if (String(source[field] || "").trim() && !String(target[field] || "").trim()) {
      partial[field] = source[field];
    }
  });
  if (Object.keys(partial).length) {
    store.setForProfile(targetProfileId, partial, { silentCredentialSync: true });
  }
}

function copyProviderCredentialsLocally(sourceProfileId, targetProfileId) {
  // Android only fills empty target credentials; it never replaces an existing key.
  copyMissingCredential(
    DebridSettingsStore,
    sourceProfileId,
    targetProfileId,
    DEBRID_CREDENTIAL_FIELDS
  );
  copyMissingCredential(MdbListSettingsStore, sourceProfileId, targetProfileId, ["apiKey"]);
  copyMissingCredential(AnimeSkipSettingsStore, sourceProfileId, targetProfileId, ["clientId"]);
  ProviderCredentialSyncService.queuePush(targetProfileId);
}

export const ProfileSettingsCopyService = {
  /**
   * Copies all TV profile settings from one profile to another. Provider credentials
   * are only copied on request and only into empty target fields, matching Android.
   */
  async copyProfileSettings({
    sourceProfileId,
    targetProfileId,
    copyProviderCredentials = false
  } = {}) {
    const source = String(sourceProfileId || "").trim();
    const target = String(targetProfileId || "").trim();
    if (!source || !target || source === target) {
      return false;
    }
    if (
      AuthManager.isAuthenticated &&
      String(ProfileManager.getActiveProfileId() || "") !== source
    ) {
      // Android refreshes a non-active source profile from remote before copying.
      await import("./profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) => ProfileSettingsSyncService.pull(source))
        .catch((error) => console.warn("Source profile settings pull failed", error));
    }
    const sourceBlob = buildOutgoingBlob(source);
    const applied = applyRemoteBlob(target, sourceBlob);
    if (copyProviderCredentials) {
      copyProviderCredentialsLocally(source, target);
    }
    if (AuthManager.isAuthenticated) {
      void import("./profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) => ProfileSettingsSyncService.push(target))
        .catch((error) => console.warn("Copied profile settings push failed", error));
    }
    return applied !== false || Boolean(sourceBlob?.features);
  }
};
