/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods01() {
  const {
    MAX_PROFILES,
    ProfileManager,
    ProfileSyncService,
    AvatarRepository,
    MemberAccessRepository,
    ProfileBackgroundRepository,
    renderMemberBrandWordmark,
    t,
    getDefaultProfileColor,
    escapeHtml,
    getProfileInitial,
    resolveProfileAvatarUrl
  } = internals;

  return {
    async mount(params = {}) {
      this.container = document.getElementById("profileSelection");
      if (!this.container) {
        console.error("Missing #profileSelection container");
        return;
      }

      this.container.style.display = "block";
      this.screenMode = String(params?.mode || "selection").toLowerCase();
      this.returnRoute = String(params?.returnRoute || "");
      this.isManagementMode = this.screenMode === "management";
      this.activeProfileId = String(ProfileManager.getActiveProfileId() || "1");
      this.focusKey = "";
      this.focusedNode = null;
      this.pendingFocusKey = "";
      this.lastProfileFocusKey = "profile:1";
      this.optionsProfileId = null;
      this.deleteProfileId = null;
      this._optionsDialog = null;
      this._deleteDialog = null;
      this.editorState = null;
      this.pinOverlayState = null;
      this.pinOverlayRenderState = null;
      this.pinOverlayPhase = "closed";
      this.pinOverlayError = "";
      this.pinActionMessage = "";
      this.pinEntryStage = "create";
      this.pinValue = "";
      this.pinDraftValue = "";
      this.profilePinEnabled = {};
      this.isPinOperationInProgress = false;
      this.pinActionMessageTimer = null;
      this.pinTransitionTimer = null;
      this.pinTransitionCallback = null;
      this.suppressedFocusClick = null;
      this.avatarCatalog = [];
      this.avatarImageUrlsById = {};
      this.profileBackgroundCatalog = [];
      this.memberAccess = MemberAccessRepository.getCurrentAccess();
      this.hasProfileAvatarAccess = false;
      this.hasProfileBackgroundAccess = false;
      this.memberAccessUnsubscribe = null;
      this.profileBackgroundUnsubscribe = null;
      this.isMounted = true;
      const mountToken = {};
      this.mountToken = mountToken;
      this.lastKeyboardActivation = null;
      this.suppressHoldMenuEnterUntilKeyUp = false;
      this.isActivatingProfile = false;
      this.activatingProfileId = "";
      this._bgScreen = null;
      this._bgThemeColors = null;
      this._bgTargetColor = null;

      const skipInitialProfileSync = Boolean(params?.skipInitialProfileSync);
      this.profilePinEnabled = skipInitialProfileSync ? params?.profilePinEnabled || {} : {};
      this.profiles = await ProfileManager.getProfiles();
      if (!this.isMounted || this.mountToken !== mountToken) return;
      this.lastProfileFocusKey = `profile:${this.activeProfileId || "1"}`;
      this.render();

      // Display local profiles immediately, but keep profile actions behind the
      // same initial profile/lock refresh that previously blocked the screen.
      this.initialProfileSync = skipInitialProfileSync
        ? Promise.resolve()
        : Promise.all([ProfileSyncService.pull(), ProfileSyncService.pullProfileLockStates()]).then(async ([, pinStates]) => {
            const profiles = await ProfileManager.getProfiles();
            if (!this.isMounted || this.mountToken !== mountToken) return;
            this.profiles = profiles;
            this.profilePinEnabled = pinStates;
            this.render();
          });
      this.memberAccessUnsubscribe = MemberAccessRepository.subscribe((access) => {
        this.memberAccess = access;
        if (!this.isMounted || !this.profiles) {
          return;
        }
        void this.refreshMemberFeatures({ render: true }).catch((error) => {
          console.warn("Profile member features refresh failed", error);
        });
      });
      this.profileBackgroundUnsubscribe = ProfileBackgroundRepository.subscribe((catalog) => {
        this.profileBackgroundCatalog = Array.isArray(catalog) ? catalog : [];
        if (!this.isMounted) {
          return;
        }
        if (this.editorState) {
          this.render();
        } else {
          this.updateProfileBackground(this.getFocusedProfile());
        }
      });
    },
    async loadAvatarCatalog(hasMemberAccess = this.hasProfileAvatarAccess) {
      const mountToken = this.mountToken;
      let catalog;
      try {
        catalog = await AvatarRepository.getAvatarCatalog(Boolean(hasMemberAccess));
      } catch (error) {
        console.warn("Failed to load avatar catalog", error);
        catalog = [];
      }
      if (!this.isMounted || this.mountToken !== mountToken) return;
      this.avatarCatalog = catalog;
      this.avatarImageUrlsById = this.avatarCatalog.reduce((accumulator, avatar) => {
        accumulator[avatar.id] = avatar.imageUrl;
        return accumulator;
      }, {});
    },
    async refreshMemberFeatures({ render = false } = {}) {
      const mountToken = this.mountToken;
      const previousBackgroundAccess = Boolean(this.hasProfileBackgroundAccess);
      const access = await MemberAccessRepository.getAccess().catch(() => this.memberAccess);
      if (!this.isMounted || this.mountToken !== mountToken) return;
      this.memberAccess = access;
      this.hasProfileAvatarAccess = MemberAccessRepository.hasEntitlement(access, "PROFILE_AVATARS");
      this.hasProfileBackgroundAccess = MemberAccessRepository.hasEntitlement(access, "PROFILE_BACKGROUNDS");
      await this.loadAvatarCatalog(this.hasProfileAvatarAccess);
      if (!this.isMounted || this.mountToken !== mountToken) return;
      if (this.hasProfileBackgroundAccess) {
        const catalog = await ProfileBackgroundRepository.ensureLoaded();
        if (!this.isMounted || this.mountToken !== mountToken) return;
        this.profileBackgroundCatalog = catalog;
        const selectedId = this.getFocusedProfile()?.profileBackgroundId || null;
        void ProfileBackgroundRepository.loadSelectedAndPreload(selectedId);
      } else {
        if (previousBackgroundAccess || this.profileBackgroundCatalog.length) {
          ProfileBackgroundRepository.invalidateCache();
        }
        this.profileBackgroundCatalog = [];
      }
      if (render && this.isMounted) {
        this.render();
      }
    },
    getProfileById(profileId) {
      return (this.profiles || []).find((profile) => String(profile.id) === String(profileId)) || null;
    },
    getFocusedProfile() {
      const focusedProfileId = this.focusedNode?.dataset?.profileId;
      return this.getProfileById(focusedProfileId) || this.getProfileById(this.activeProfileId) || this.getVisibleProfiles()[0] || null;
    },
    getProfileBackgroundImageUrl(profile) {
      if (!this.hasProfileBackgroundAccess || !profile) {
        return null;
      }
      const customUrl = String(profile.profileBackgroundUrl || "").trim();
      return customUrl || ProfileBackgroundRepository.getImageUrl(profile.profileBackgroundId);
    },
    getVisibleProfiles() {
      return Array.isArray(this.profiles) ? this.profiles : [];
    },
    async refreshProfilePinStates() {
      this.profilePinEnabled = await ProfileSyncService.pullProfileLockStates();
    },
    isProfilePinEnabled(profileId) {
      const normalizedId = String(profileId || "");
      return Boolean(this.profilePinEnabled?.[normalizedId] || this.profilePinEnabled?.[Number(normalizedId)]);
    },
    getAvatarImageUrl(avatarId) {
      const normalizedId = String(avatarId || "").trim();
      if (!normalizedId) {
        return null;
      }
      return this.avatarImageUrlsById?.[normalizedId] || null;
    },
    getEditorSelectedAvatar() {
      if (!this.editorState?.selectedAvatarId) {
        return null;
      }
      return this.avatarCatalog.find((avatar) => avatar.id === this.editorState.selectedAvatarId) || null;
    },
    getEditorSelectedBackground() {
      const selectedId = String(this.editorState?.selectedBackgroundId || "").trim();
      if (!selectedId) {
        return null;
      }
      return this.profileBackgroundCatalog.find((background) => background.id === selectedId) || null;
    },
    getEditorBackgroundPreviewUrl() {
      const customUrl = String(this.editorState?.selectedBackgroundUrl || "").trim();
      return customUrl || this.getEditorSelectedBackground()?.imageUrl || null;
    },
    getFilteredEditorAvatars() {
      const category = String(this.editorState?.category || "all");
      if (category === "all") {
        return this.avatarCatalog;
      }
      if (category.toLowerCase() === "supporter") {
        return this.avatarCatalog.filter((avatar) => Boolean(avatar.memberOnly));
      }
      return this.avatarCatalog.filter(
        (avatar) => !avatar.memberOnly && String(avatar.category || "").toLowerCase() === category.toLowerCase()
      );
    },
    render() {
      const visibleProfiles = this.getVisibleProfiles();
      const canAddProfile = visibleProfiles.length < MAX_PROFILES;
      const totalItems = visibleProfiles.length + (canAddProfile ? 1 : 0);
      const gridClass = totalItems >= 5 ? "profile-grid profile-grid-compact" : "profile-grid";
      const title = this.isManagementMode
        ? t("profile_manage_title", {}, "Manage Profiles")
        : t("profile_selection_title", {}, "Who's watching?");
      const subtitle = this.isManagementMode
        ? t("profile_manage_subtitle", {}, "Select a profile to edit, switch, or create a new one")
        : t("profile_selection_subtitle", {}, "Select a profile to continue");
      const hint = this.isManagementMode
        ? t("profile_manage_hint", {}, "Select a profile to manage")
        : t("profile_selection_hint", {}, "Hold to manage profile");
      const renderedPinState = this.getRenderedPinOverlayState();
      const isPinActive = Boolean(renderedPinState);
      const pinScreenPhaseClass = isPinActive ? ` is-pin-${escapeHtml(this.pinOverlayPhase || "open")}` : "";
      const compactGridScreenClass = totalItems >= 5 ? " profile-screen-compact-grid" : "";

      this.container.innerHTML = `
          <div class="profile-screen${pinScreenPhaseClass}${compactGridScreenClass}">
            <div class="profile-screen-background" data-role="profile-screen-background" aria-hidden="true"></div>
            <div class="profile-main-layer"${isPinActive ? ' aria-hidden="true"' : ""}>
              ${renderMemberBrandWordmark({
                access: this.memberAccess,
                imageClass: "profile-logo",
                wrapperClass: "profile-brand-lockup"
              })}

              <h1 class="profile-title">${escapeHtml(title)}</h1>
              <p class="profile-subtitle">${escapeHtml(subtitle)}</p>

              <div class="${gridClass}" id="profileGrid" data-profile-item-count="${totalItems}">
                ${visibleProfiles.map((profile) => this.renderProfileCard(profile)).join("")}
                ${canAddProfile ? this.renderAddProfileCard() : ""}
              </div>

              <p class="profile-hint">${escapeHtml(hint)}</p>
            </div>
            ${this.renderPinOverlay()}
          </div>
          ${this.renderEditorOverlay()}
          ${this.renderPinActionToast()}
        `;

      this.bindEvents();
      if (renderedPinState) {
        const pinProfile = this.getPinOverlayProfile();
        if (pinProfile?.avatarColorHex) {
          this.updateBackground(pinProfile.avatarColorHex);
        }
      }
      this.restoreFocus();
      this.updateProfileBackground(this.getFocusedProfile());
    },
    renderProfileCard(profile) {
      const avatarUrl = resolveProfileAvatarUrl(profile, (avatarId) => this.getAvatarImageUrl(avatarId));
      return `
          <div class="profile-card profile-focusable focusable" role="button" aria-label="${escapeHtml(profile.name)}"
               data-profile-id="${escapeHtml(profile.id)}"
               data-focus-key="profile:${escapeHtml(profile.id)}"
               tabindex="0">
            <div class="profile-avatar-ring">
              <div class="profile-avatar" style="background:${escapeHtml(profile.avatarColorHex || getDefaultProfileColor())}">
                ${
                  avatarUrl
                    ? `<img class="profile-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(profile.name)}"/>`
                    : escapeHtml(getProfileInitial(profile.name))
                }
              </div>
              ${profile.isPrimary ? `<span class="profile-primary-dot" aria-hidden="true">&#9733;</span>` : ""}
            </div>
            <div class="profile-name">${escapeHtml(profile.name)}</div>
            ${profile.isPrimary ? `<div class="profile-badge">${escapeHtml(t("profile_selection_primary_badge", {}, "PRIMARY"))}</div>` : `<div class="profile-badge-slot" aria-hidden="true"></div>`}
          </div>
        `;
    },
    renderAddProfileCard() {
      return `
          <div class="profile-card profile-card-add profile-focusable focusable" role="button"
               data-profile-id="add"
               data-focus-key="profile:add"
               tabindex="0">
            <div class="profile-avatar-ring">
              <div class="profile-avatar profile-avatar-add" aria-hidden="true"></div>
            </div>
            <div class="profile-name">${escapeHtml(t("profile_add_new", {}, "Add Profile"))}</div>
            <div class="profile-badge-slot" aria-hidden="true"></div>
          </div>
        `;
    }
  };
}
