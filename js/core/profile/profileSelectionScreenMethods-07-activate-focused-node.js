/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods07() {
  const {
    Router,
    ProfileManager,
    StartupSyncService,
    ScreenUtils,
    MemberAccessRepository,
    ProfileBackgroundRepository,
    ThemeManager,
    I18n,
    detailWatchedEnrichmentService,
    resolveExperienceRoute,
    PluginRuntime,
    getDefaultProfileColor,
    isTextInput
  } = internals;

  return {
    async activateFocusedNode(node) {
      const action = String(node?.dataset?.action || "");
      const profileId = node?.dataset?.profileId;

      if (action === "cancel-editor") {
        this.closeEditor();
        return;
      }
      if (action === "submit-editor") {
        await this.submitEditor();
        return;
      }
      if (action === "select-copy-source") {
        this.openProfileCopySourceDialog(null);
        return;
      }
      if (action === "select-editor-tab" && this.editorState) {
        const editorTab = String(node.dataset.editorTab || "avatar");
        if (editorTab !== "background" || this.hasProfileBackgroundAccess) {
          this.editorState.editorTab = editorTab === "background" ? "background" : "avatar";
          this.pendingFocusKey = `editor:tab:${this.editorState.editorTab}`;
          this.render();
        }
        return;
      }
      if (action === "select-avatar-category" && this.editorState) {
        this.editorState.category = String(node.dataset.category || "all");
        this.pendingFocusKey = `editor:category:${this.editorState.category}`;
        this.render();
        return;
      }
      if (action === "select-background" && this.editorState) {
        const backgroundId = String(node.dataset.backgroundId || "");
        if (backgroundId === "normal") {
          this.editorState.selectedBackgroundId = null;
          this.editorState.selectedBackgroundUrl = null;
        } else if (backgroundId === "custom") {
          const customUrl = String(this.editorState.baseBackgroundUrl || "").trim();
          if (!customUrl) {
            return;
          }
          if (!this.editorState.selectedBackgroundId && this.editorState.selectedBackgroundUrl === customUrl) {
            this.editorState.selectedBackgroundUrl = null;
          } else {
            this.editorState.selectedBackgroundId = null;
            this.editorState.selectedBackgroundUrl = customUrl;
          }
        } else {
          const background = this.profileBackgroundCatalog.find((entry) => entry.id === backgroundId);
          if (!background) {
            return;
          }
          if (!this.editorState.selectedBackgroundUrl && this.editorState.selectedBackgroundId === background.id) {
            this.editorState.selectedBackgroundId = null;
            this.editorState.selectedBackgroundUrl = null;
          } else {
            this.editorState.selectedBackgroundId = background.id;
            this.editorState.selectedBackgroundUrl = null;
            void ProfileBackgroundRepository.loadSelectedAndPreload(background.id);
          }
        }
        this.editorState.editorTab = "background";
        this.pendingFocusKey = `editor:background:${backgroundId}`;
        this.render();
        return;
      }
      if (action === "select-avatar" && this.editorState) {
        const avatar = this.avatarCatalog.find((entry) => entry.id === node.dataset.avatarId);
        if (!avatar) {
          return;
        }
        if (this.editorState.selectedAvatarId === avatar.id) {
          this.editorState.selectedAvatarId = null;
          this.editorState.selectedColorHex =
            this.editorState.mode === "edit" ? this.editorState.baseColorHex || getDefaultProfileColor() : getDefaultProfileColor();
        } else {
          this.editorState.selectedAvatarId = avatar.id;
          this.editorState.selectedColorHex = avatar.bgColor || getDefaultProfileColor();
        }
        this.editorState.focusedAvatarName = avatar.displayName;
        this.pendingFocusKey = `editor:avatar:${avatar.id}`;
        this.render();
        return;
      }
      if (action === "open-edit-profile") {
        this.openEditEditor(this.getProfileById(profileId));
        return;
      }
      if (action === "open-profile-pin") {
        const profile = this.getProfileById(profileId);
        if (profile) {
          this.openPinOverlay(this.isProfilePinEnabled(profile.id) ? "verify-change" : "set", profile);
        }
        return;
      }
      if (action === "remove-profile-pin") {
        const profile = this.getProfileById(profileId);
        if (profile) {
          this.openPinOverlay("verify-remove", profile);
        }
        return;
      }
      if (action === "confirm-delete-profile") {
        this.openDeleteDialog(this.getProfileById(profileId));
        return;
      }
      if (action === "delete-profile") {
        await this.deleteProfile(profileId);
        return;
      }

      const mountToken = this.mountToken;
      await this.initialProfileSync;
      if (!this.isMounted || this.mountToken !== mountToken) return;

      if (profileId === "add") {
        this.openCreateEditor();
        return;
      }

      const profile = this.getProfileById(profileId);
      if (!profile) {
        return;
      }

      if (this.isManagementMode) {
        this.openOptionsDialog(profile);
        return;
      }

      if (this.isProfilePinEnabled(profile.id)) {
        this.openPinOverlay("unlock", profile);
        return;
      }

      await this.activateProfile(profile.id);
    },
    async activateProfile(profileId) {
      if (!profileId || this.isActivatingProfile) {
        return;
      }
      this.isActivatingProfile = true;
      this.activatingProfileId = String(profileId);
      const profileCard =
        Array.from(this.container?.querySelectorAll(".profile-card[data-profile-id]") || []).find(
          (node) => String(node.dataset.profileId || "") === String(profileId)
        ) || null;
      profileCard?.classList?.add("is-activating");
      try {
        // A provider started under the previous profile must not publish late
        // results into the newly selected profile's stream screen.
        PluginRuntime.cancelAll();
        await ProfileManager.setActiveProfile(profileId);
        StartupSyncService.enableProfileScopedSync();
        detailWatchedEnrichmentService.invalidateAllCache();
        await I18n.init();
        const memberAccess = await MemberAccessRepository.getAccess().catch(() => MemberAccessRepository.getCurrentAccess());
        ThemeManager.apply({ enforceAccess: true, access: memberAccess });
        I18n.apply();
        const experienceRoute = await resolveExperienceRoute(profileId);
        void StartupSyncService.requestSyncNow({
          notifyPullCompleted: ["home", "plugins"].includes(experienceRoute)
        }).catch((error) => {
          console.warn("Profile background sync failed", error);
        });
        await Router.navigate(
          experienceRoute,
          experienceRoute === "home" ? { forceReload: true } : {},
          experienceRoute === "home" ? {} : { replaceHistory: true, skipStackPush: true }
        );
      } catch (error) {
        console.warn("Failed to activate profile", error);
        this.isActivatingProfile = false;
        this.activatingProfileId = "";
        profileCard?.classList?.remove("is-activating");
      }
    },
    async onKeyDown(event) {
      if (!this.container) {
        return;
      }
      if (this.isActivatingProfile) {
        event?.preventDefault?.();
        return;
      }

      const code = Number(event?.keyCode || 0);
      if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
        event?.preventDefault?.();
        return;
      }
      const overlayRoot =
        this.container.querySelector("[data-overlay-root='pin']") ||
        this.container.querySelector("[data-overlay-root='delete']") ||
        this.container.querySelector("[data-overlay-root='options']") ||
        this.container.querySelector("[data-overlay-root='editor']");
      const currentProfileCard = this.container.querySelector(".profile-card.focused") || null;

      if (code !== 13 || !this.canHoldManageProfile(currentProfileCard)) {
        this.cancelPendingProfileHold();
      }

      if (overlayRoot) {
        this.cancelPendingProfileHold();
        if (overlayRoot.dataset.overlayRoot === "pin") {
          await this.handlePinOverlayKeyDown(event);
          return;
        }
        const isEditorOverlay = overlayRoot.dataset.overlayRoot === "editor";
        const overlaySelector = isEditorOverlay ? ".profile-overlay-focusable:not(.is-disabled)" : ".profile-dialog-button";

        if (
          (isEditorOverlay && this.moveEditorFocus(event, overlayRoot)) ||
          (!isEditorOverlay && ScreenUtils.handleDpadNavigation(event, overlayRoot, overlaySelector))
        ) {
          return;
        }

        if (code !== 13) {
          return;
        }

        const focused = overlayRoot.querySelector(`${overlaySelector}.focused`) || document.activeElement;
        if (!focused || (isTextInput(focused) && overlayRoot.dataset.overlayRoot === "editor")) {
          return;
        }
        event?.preventDefault?.();
        this.rememberKeyboardActivation(focused);
        await this.activateFocusedNode(focused);
        return;
      }

      if (code === 13 && this.canHoldManageProfile(currentProfileCard)) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingProfileHold(currentProfileCard)) {
          this.startPendingProfileHold(currentProfileCard);
        }
        return;
      }

      if (this.moveProfileFocus(event) || ScreenUtils.handleDpadNavigation(event, this.container, ".profile-card")) {
        return;
      }

      if (code !== 13) {
        return;
      }

      const current = this.container.querySelector(".profile-card.focused");
      if (!current) {
        return;
      }
      this.rememberKeyboardActivation(current);
      await this.activateFocusedNode(current);
    },
    async onKeyUp(event) {
      if (this.suppressHoldMenuEnterUntilKeyUp) {
        this.suppressHoldMenuEnterUntilKeyUp = false;
        if (Number(event?.keyCode || 0) === 13) {
          event?.preventDefault?.();
          return;
        }
      }
      if (Number(event?.keyCode || 0) !== 13 || this.pinOverlayState || this.optionsProfileId || this.deleteProfileId || this.editorState) {
        return;
      }
      const current = this.container?.querySelector(".profile-card.focused") || null;
      if (await this.completePendingProfileHold(current, event)) {
        event?.preventDefault?.();
      }
    },
    consumeBackRequest() {
      if (this.pinOverlayState || this.pinOverlayRenderState) {
        this.closePinOverlay();
        return true;
      }
      if (this._deleteDialog || this.deleteProfileId) {
        this.closeDeleteDialog();
        return true;
      }
      if (this._optionsDialog || this.optionsProfileId) {
        this.closeOptionsDialog();
        return true;
      }
      if (this.editorState) {
        this.closeEditor();
        return true;
      }
      if (!this.isManagementMode) {
        return true;
      }
      return false;
    },
    _destroyDialogs() {
      if (this._optionsDialog) {
        this._optionsDialog.destroy();
        this._optionsDialog = null;
      }
      if (this._deleteDialog) {
        this._deleteDialog.destroy();
        this._deleteDialog = null;
      }
      this.optionsProfileId = null;
      this.deleteProfileId = null;
    }
  };
}
