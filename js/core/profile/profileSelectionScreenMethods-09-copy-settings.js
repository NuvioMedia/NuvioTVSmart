/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods09() {
  const { NuvioDialog, ProfileSettingsCopyService, t } = internals;

  return {
    closeCopySettingsDialogs() {
      this._copySettingsDialog?.destroy?.();
      this._copySettingsDialog = null;
      this._copySettingsTarget = null;
      this._copySettingsSelectedSourceId = null;
      this._copySettingsCopyCredentials = false;
    },

    openProfileCopySourceDialog(targetProfile = null) {
      const targetId = targetProfile ? String(targetProfile.id) : "";
      const profiles = (this.getVisibleProfiles?.() || this.profiles || []).filter(
        (profile) => !targetId || String(profile.id) !== targetId
      );
      if (!profiles.length) {
        return;
      }
      const sameTarget = String(this._copySettingsTarget?.id || "") === String(targetProfile?.id || "");
      this._copySettingsTarget = targetProfile;
      if (!sameTarget || !this._copySettingsDialog) {
        const preferred = profiles.find((profile) => profile.isPrimary) || profiles[0] || null;
        this._copySettingsSelectedSourceId = targetProfile ? String(preferred?.id || "") : "";
        this._copySettingsCopyCredentials = false;
      }
      this.renderCopySettingsDialog();
    },

    renderCopySettingsDialog() {
      const targetProfile = this._copySettingsTarget;
      const targetId = targetProfile ? String(targetProfile.id) : "";
      const profiles = (this.getVisibleProfiles?.() || this.profiles || []).filter(
        (profile) => !targetId || String(profile.id) !== targetId
      );
      const selectedId = String(this._copySettingsSelectedSourceId || "");
      const sourceProfile = profiles.find((profile) => String(profile.id) === selectedId) || null;
      this._copySettingsDialog?.destroy?.();
      this._copySettingsDialog = new NuvioDialog({
        title: targetProfile
          ? t("profile_copy_settings_title", [targetProfile.name], `Copy Settings to ${targetProfile.name}`)
          : t("profile_copy_settings_setup_title", {}, "Profile Settings"),
        subtitle: targetProfile
          ? t(
              "profile_copy_settings_subtitle",
              {},
              "Choose a source profile. Its supported TV settings will replace this profile's settings once."
            )
          : t("profile_copy_settings_setup_subtitle", {}, "Start fresh or copy TV settings from another profile once."),
        widthVw: 45,
        actionsClassName: "profile-copy-settings-actions",
        suppressEnterUntilKeyUp: true,
        buttons: [
          ...(targetProfile
            ? []
            : [
                {
                  label: `${!sourceProfile ? "✓ " : ""}${t("profile_copy_settings_start_fresh", {}, "Start Fresh")}`,
                  key: "fresh",
                  selected: !sourceProfile,
                  onAction: () => {
                    this._copySettingsSelectedSourceId = "";
                    this._copySettingsCopyCredentials = false;
                    this.renderCopySettingsDialog();
                  }
                }
              ]),
          ...profiles.map((profile) => {
            const id = String(profile.id);
            return {
              label: `${id === selectedId ? "✓ " : ""}${String(profile.name || `Profile ${profile.id}`)}`,
              key: `source:${id}`,
              selected: id === selectedId,
              onAction: () => {
                this._copySettingsSelectedSourceId = id;
                this.renderCopySettingsDialog();
              }
            };
          }),
          ...(sourceProfile
            ? [
                {
                  label: this._copySettingsCopyCredentials
                    ? t("profile_copy_settings_credentials_on", {}, "API Keys: Copy Missing Keys")
                    : t("profile_copy_settings_credentials_off", {}, "API Keys: Do Not Copy"),
                  key: "credentials",
                  selected: this._copySettingsCopyCredentials,
                  onAction: () => {
                    this._copySettingsCopyCredentials = !this._copySettingsCopyCredentials;
                    this.renderCopySettingsDialog();
                  }
                }
              ]
            : []),
          ...(!targetProfile || sourceProfile
            ? [
                {
                  label: t("profile_copy_settings_apply", {}, "Apply"),
                  key: "apply",
                  onAction: () => {
                    if (targetProfile) {
                      this.applyProfileCopy(sourceProfile, targetProfile, this._copySettingsCopyCredentials);
                    } else if (sourceProfile) {
                      if (this.editorState) {
                        this.editorState.copySourceProfileId = String(sourceProfile.id);
                        this.editorState.copyProviderCredentials = Boolean(this._copySettingsCopyCredentials);
                        this.pendingFocusKey = "editor:copy-source";
                      }
                      this.closeCopySettingsDialogs();
                      this.render();
                    } else {
                      if (this.editorState) {
                        this.editorState.copySourceProfileId = null;
                        this.editorState.copyProviderCredentials = false;
                        this.pendingFocusKey = "editor:copy-source";
                      }
                      this.closeCopySettingsDialogs();
                      this.render();
                    }
                  }
                }
              ]
            : []),
          {
            label: t("profile_cancel", {}, "Cancel"),
            key: "cancel",
            onAction: () => this.closeCopySettingsDialogs()
          }
        ],
        onDismiss: () => this.closeCopySettingsDialogs()
      }).mount(document.body);
    },

    async applyProfileCopy(sourceProfile, targetProfile, copyProviderCredentials) {
      if (!sourceProfile || !targetProfile) {
        this.closeCopySettingsDialogs();
        return;
      }
      const sourceName = String(sourceProfile.name || `Profile ${sourceProfile.id}`);
      const targetName = String(targetProfile.name || `Profile ${targetProfile.id}`);
      const sourceId = String(sourceProfile.id);
      const targetId = String(targetProfile.id);
      const copyCredentials = Boolean(copyProviderCredentials);
      this.closeCopySettingsDialogs();
      if (this.isCopyingProfileSettings) {
        return;
      }
      this.isCopyingProfileSettings = true;
      let success = false;
      try {
        success = await ProfileSettingsCopyService.copyProfileSettings({
          sourceProfileId: sourceId,
          targetProfileId: targetId,
          copyProviderCredentials: copyCredentials
        });
      } catch (error) {
        console.warn("Failed to copy profile settings", error);
      } finally {
        this.isCopyingProfileSettings = false;
      }
      this._copySettingsDialog = new NuvioDialog({
        title: success
          ? t("profile_copy_settings_success_title", {}, "Settings copied")
          : t("profile_copy_settings_error_title", {}, "Could not copy settings"),
        subtitle: success
          ? t("profile_copy_settings_success", [sourceName, targetName], `Settings copied from ${sourceName} to ${targetName}.`)
          : t("profile_copy_settings_error", {}, "Could not copy settings. Try again."),
        widthVw: 37.5,
        buttons: [
          {
            label: t("common.done", {}, "Done"),
            key: "done",
            onAction: () => this.closeCopySettingsDialogs()
          }
        ],
        onDismiss: () => this.closeCopySettingsDialogs()
      }).mount(document.body);
    }
  };
}
