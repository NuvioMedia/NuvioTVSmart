/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import { cancelReorder, confirmReorder, isReordering, moveReorderBy } from "../../components/reorderSession.js";

export function createSettingsScreenMethods14() {
  const {
    Router,
    Platform,
    activateLegacySidebarAction,
    getRootSidebarNodes,
    getRootSidebarSelectedNode,
    isSelectedSidebarAction,
    isRootSidebarNode,
    clamp,
    isSettingsActivateEvent
  } = internals;

  return {
    async activateFocused() {
      if (this.textDialog) {
        const current = this.container.querySelector(".focusable.focused");
        const action = current?.dataset?.textDialogAction || "";
        if (action === "save") {
          await this.submitTextDialog();
          await this.render();
          return;
        }
        if (action === "clear") {
          await this.clearTextDialog();
          await this.render();
          return;
        }
        if (action === "cancel") {
          this.closeTextDialog();
          await this.render({ refreshModel: false });
          return;
        }
        this.dialogFocusIndex = 0;
        this.applyFocus();
        return;
      }

      if (this.optionDialog) {
        const option = this.optionDialog.options[this.dialogFocusIndex];
        if (!option) {
          return;
        }
        if (this.optionDialog.multiChoice) {
          const optionId = String(option.id);
          const selectedIds = new Set(this.optionDialog.selectedIds || []);
          if (selectedIds.has(optionId)) {
            selectedIds.delete(optionId);
          } else {
            selectedIds.add(optionId);
          }
          this.optionDialog.selectedIds = selectedIds;
          if (typeof this.optionDialog.onToggle === "function") {
            await this.optionDialog.onToggle(Array.from(selectedIds), option);
          }
          await this.render();
          return;
        }
        if (typeof this.optionDialog.onSelect === "function") {
          const shouldClose = await this.optionDialog.onSelect(option);
          if (shouldClose === false) {
            await this.render({ refreshModel: false });
            return;
          }
        }
        this.closeOptionDialog();
        await this.render();
        return;
      }

      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }

      if (String(current.dataset.focusKey || "") === "about:supporters") {
        await Router.navigate("supportersContributors");
        return;
      }

      const zone = String(current.dataset.zone || "");

      if (isRootSidebarNode(current)) {
        activateLegacySidebarAction(String(current.dataset.action || ""), "settings");
        if (isSelectedSidebarAction(String(current.dataset.action || ""), "settings")) {
          await this.closeSidebarToNav();
        }
        return;
      }

      if (zone === "nav") {
        await this.activateNavSelection();
        const firstContent = this.container.querySelector(".settings-content-focusable");
        if (firstContent) {
          this.focusZone = "content";
          this.contentFocusKey =
            this.activeSection === "appearance" ? this.getAppearanceThemeFocusKey() : String(firstContent.dataset.focusKey || "");
          this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
          this.applyFocus();
        }
        return;
      }

      const focusKey = String(current.dataset.focusKey || "");
      const action = this.actionMap.get(focusKey);
      if (!action) {
        return;
      }

      this.contentFocusKey = focusKey;
      this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
      const role = String(current.dataset.role || "");
      const isSectionToggle = role === "section-toggle";
      this.suppressNextContentFocusScroll = this.focusZone === "content" && (role === "toggle" || isSectionToggle);
      await action();

      if (Router.getCurrent() === "settings") {
        await this.render({ refreshModel: !isSectionToggle });
        this.focusZone = "content";
        this.applyFocus();
      }
    },
    async onKeyDown(event) {
      if (isReordering(this.mdbReorderSession)) {
        const reorderCode = Number(event?.keyCode || 0);
        const session = this.mdbReorderSession;
        const persist = () => {
          const { MdbListSettingsStore } = internals;
          MdbListSettingsStore.set({ ratingOrder: [...session.keys] });
        };
        if (reorderCode === 38 || reorderCode === 40) {
          event?.preventDefault?.();
          if (moveReorderBy(session, reorderCode === 38 ? -1 : 1)) {
            persist();
            this.contentFocusKey = `integration:mdblist:reorder:${session.movingKey}`;
            await this.render();
          }
          return;
        }
        if (reorderCode === 37 || reorderCode === 39) {
          event?.preventDefault?.();
          return;
        }
        if (reorderCode === 13) {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const movingKey = session.movingKey;
          confirmReorder(session);
          this.mdbReorderSession = null;
          this.contentFocusKey = `integration:mdblist:reorder:${movingKey}`;
          await this.render();
          return;
        }
        if (Platform.isBackEvent(event)) {
          event?.preventDefault?.();
          cancelReorder(session);
          persist();
          this.mdbReorderSession = null;
          this.contentFocusKey = `integration:mdblist:reorder:${session.keys[0] || ""}`;
          await this.render();
          return;
        }
      }
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        if (this.textDialog) {
          this.closeTextDialog();
          await this.render({ refreshModel: false });
          return;
        }
        if (this.optionDialog) {
          this.closeOptionDialog();
          await this.render({ refreshModel: false });
          return;
        }
        if (this.activeSection === "contentDiscovery" && this.mediaServersView) {
          this.actionMap.get("mediaServers:back")?.();
          await this.render({ refreshModel: false });
          return;
        }
        if (this.focusZone === "sidebar") {
          Platform.exitApp();
        } else {
          await this.openSidebar();
        }
        return;
      }

      const code = Number(event?.keyCode || 0);

      if (this.textDialog) {
        const activeField = document.activeElement?.matches?.("[data-text-dialog-role='field']");
        if ((code === 38 || code === 40) && !(activeField && this.textDialog.multiline)) {
          event?.preventDefault?.();
          const delta = code === 38 ? -1 : 1;
          this.dialogFocusIndex = clamp(this.dialogFocusIndex + delta, 0, this.getTextDialogMaxFocusIndex());
          this.applyFocus();
          return;
        }
        if (code === 37 || code === 39) {
          if (!activeField) {
            event?.preventDefault?.();
            this.dialogFocusIndex = clamp(this.dialogFocusIndex + (code === 37 ? -1 : 1), 0, this.getTextDialogMaxFocusIndex());
            this.applyFocus();
          }
          return;
        }
        if (code === 13 && activeField) {
          if (this.textDialog.multiline) {
            return;
          }
          event?.preventDefault?.();
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          await this.submitTextDialog();
          await this.render();
          return;
        }
      }

      if (this.optionDialog) {
        if (code === 38 || code === 40 || code === 37 || code === 39) {
          event?.preventDefault?.();
          const count = this.optionDialog.options.length;
          const cols = Math.max(1, Number(this.optionDialog.optionColumns || 1));
          const index = this.dialogFocusIndex;
          let next = index;
          if (code === 38) {
            next = index - cols;
          } else if (code === 40) {
            next = index + cols;
          } else if (code === 37) {
            if (index % cols > 0) next = index - 1;
          } else if (code === 39) {
            if (index % cols < cols - 1 && index + 1 < count) next = index + 1;
          }
          if (next >= 0 && next < count && next !== index) {
            this.dialogFocusIndex = next;
            this.applyFocus();
          }
          return;
        }
      }

      if (code === 38 || code === 40 || code === 37 || code === 39) {
        event?.preventDefault?.();

        if (this.focusZone === "sidebar") {
          if (code === 38) {
            this.sidebarFocusIndex = clamp(
              this.sidebarFocusIndex - 1,
              0,
              Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1)
            );
            this.applyFocus();
            return;
          }
          if (code === 40) {
            this.sidebarFocusIndex = clamp(
              this.sidebarFocusIndex + 1,
              0,
              Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1)
            );
            this.applyFocus();
            return;
          }
          if (code === 39) {
            await this.closeSidebarToNav();
            return;
          }
        }

        if (this.focusZone === "nav") {
          const horizonStyle = String(this.model?.theme?.settingsUiStyle || "CLASSIC") === "HORIZON";
          if (horizonStyle && code === 37) {
            this.moveNavFocus(this.navIndex - 1);
            return;
          }
          if (horizonStyle && code === 39) {
            this.moveNavFocus(this.navIndex + 1);
            return;
          }
          if (horizonStyle && code === 40) {
            const firstContent = this.container.querySelector(".settings-content-focusable");
            if (firstContent) {
              this.focusZone = "content";
              this.contentFocusKey = String(firstContent.dataset.focusKey || "");
              this.applyFocus();
            }
            return;
          }
          if (horizonStyle && code === 38) {
            const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
            const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
            this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
            await this.openSidebar();
            return;
          }
          if (code === 38) {
            this.moveNavFocus(this.navIndex - 1);
            return;
          }
          if (code === 40) {
            this.moveNavFocus(this.navIndex + 1);
            return;
          }
          if (code === 37) {
            const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
            const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
            this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
            await this.openSidebar();
            return;
          }
          if (code === 39) {
            const firstContent = this.container.querySelector(".settings-content-focusable");
            if (firstContent) {
              this.focusZone = "content";
              this.contentFocusKey = String(firstContent.dataset.focusKey || "");
              this.applyFocus();
            }
            return;
          }
        }

        if (this.focusZone === "content") {
          if (code === 38 && String(this.model?.theme?.settingsUiStyle || "CLASSIC") === "HORIZON") {
            if (!this.moveContent("up")) {
              this.syncNavFocusToActive();
              this.focusZone = "nav";
              this.applyFocus();
            }
            return;
          }
          if (code === 37) {
            const moved = this.moveContent("left");
            if (!moved) {
              this.syncNavFocusToActive();
              this.focusZone = "nav";
              this.applyFocus();
            }
            return;
          }
          if (code === 38) {
            this.moveContent("up");
            return;
          }
          if (code === 40) {
            this.moveContent("down");
            return;
          }
          if (code === 39) {
            this.moveContent("right");
            return;
          }
        }
      }

      if (!isSettingsActivateEvent(event)) {
        return;
      }

      event?.preventDefault?.();
      await this.activateFocused();
    },
    consumeBackRequest() {
      if (this.textDialog) {
        this.closeTextDialog();
        void this.render({ refreshModel: false });
        return true;
      }
      if (this.optionDialog) {
        this.closeOptionDialog();
        void this.render({ refreshModel: false });
        return true;
      }
      if (this.activeSection === "contentDiscovery" && this.mediaServersView) {
        this.actionMap.get("mediaServers:back")?.();
        void this.render({ refreshModel: false });
        return true;
      }
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        void this.openSidebar();
      }
      return true;
    }
  };
}
