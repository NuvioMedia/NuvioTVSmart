import { MdbListTracking } from "../../../data/repository/mdbListTracking.js";
import { MdbListAccount } from "../../../data/repository/mdbListAccount.js";
import { MdbListLibrary } from "../../../data/repository/mdbListLibrary.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { QrCodeGenerator, t, escapeHtml, escapeAttribute } from "./settingsScreenContext.js";

export function stopMdbListAuthorization() {
  this.mdbListAuthNonce = (this.mdbListAuthNonce || 0) + 1;
  clearTimeout(this.mdbListAuthTimer);
  this.mdbListAuthTimer = null;
}

export function openMdbListAuthorization() {
  stopMdbListAuthorization.call(this);
  const nonce = this.mdbListAuthNonce;
  const profileId = String(ProfileManager.getActiveProfileId());
  const current = () =>
    this.isMounted &&
    this.mdbListAuthNonce === nonce &&
    String(ProfileManager.getActiveProfileId()) === profileId;
  let session = null;
  const show = (message, html = "") => {
    if (!current()) return;
    this.openOptionDialog({
      title: "MDBList",
      message: html ? "" : message,
      messageHtml: html
        ? `<p class="settings-debrid-auth-copy">${escapeHtml(message)}</p>${html}`
        : "",
      options: [{ id: "cancel", label: t("common.cancel") }],
      returnFocusKey: "integration:mdblist:account",
      onClose: () => stopMdbListAuthorization.call(this),
      onSelect: () => true,
      onRender: (slot) => {
        const canvas = slot.querySelector("[data-mdblist-qr]");
        if (canvas && session) {
          try {
            QrCodeGenerator.generate(canvas, session.completeUrl, 420);
          } catch (_) {
            canvas.remove();
          } // The address and code remain usable.
        }
      }
    });
  };
  show(t("common.loading"));
  void (async () => {
    try {
      session = await MdbListAccount.start();
      if (!current()) return;
      show(
        t("mdblist_awaiting_instruction"),
        `<div class="settings-debrid-auth-body"><canvas class="settings-debrid-auth-qr" data-mdblist-qr aria-label="${escapeAttribute(t("mdblist_qr_description"))}"></canvas><div class="settings-debrid-auth-code">${escapeHtml(session.userCode)}</div><div class="settings-debrid-auth-url">${escapeHtml(session.url)}</div></div>`
      );
      await this.render({ refreshModel: false });
      const poll = async () => {
        try {
          if (!current()) return;
          const authorized = await MdbListAccount.poll(session, current);
          if (!current()) return;
          if (authorized) {
            void MdbListTracking.refresh({ force: true }).then(() => {
              if (this.isMounted && String(ProfileManager.getActiveProfileId()) === profileId)
                void this.render();
            });
            this.closeOptionDialog();
            await this.render();
            return;
          }
          this.mdbListAuthTimer = setTimeout(() => void poll(), session.interval * 1000);
        } catch (error) {
          if (!current()) return;
          show(t(error?.code || "mdblist_unavailable", {}, t("mdblist_unavailable")));
          await this.render({ refreshModel: false });
        }
      };
      this.mdbListAuthTimer = setTimeout(() => void poll(), session.interval * 1000);
    } catch (error) {
      if (!current()) return;
      show(t(error?.code || "mdblist_unavailable", {}, t("mdblist_unavailable")));
      await this.render({ refreshModel: false });
    }
  })();
}

export async function openMdbListVisibility() {
  const scope = MdbListAccount.scope();
  const mountToken = this.settingsMountToken;
  const snapshot = await MdbListLibrary.snapshot();
  MdbListAccount.check(scope);
  if (!this.isMounted || mountToken !== this.settingsMountToken) return;
  const show = (selectedId = null, error = null) => {
    this.openOptionDialog({
      title: t("mdblist_library_lists"),
      message:
        error ||
        (snapshot.tabs.length <= 1
          ? t("mdblist_library_lists_empty")
          : t("mdblist_library_lists_description")),
      selectedId,
      options: snapshot.tabs
        .filter((tab) => tab.key !== "mdblist:watchlist")
        .map((tab) => ({
          id: tab.key,
          label: `${snapshot.hidden.includes(tab.key) ? "☐" : "☑"} ${tab.title}`
        })),
      returnFocusKey: "integration:mdblist:lists",
      onSelect: async (option) => {
        MdbListAccount.check(scope);
        const visible = snapshot.hidden.includes(option.id);
        try {
          await MdbListLibrary.setVisible(option.id, visible);
        } catch (error) {
          if (this.isMounted && mountToken === this.settingsMountToken)
            show(option.id, t(error?.code || "mdblist_unavailable", {}, t("mdblist_unavailable")));
          return false;
        }
        snapshot.hidden = visible
          ? snapshot.hidden.filter((k) => k !== option.id)
          : [...snapshot.hidden, option.id];
        if (!this.isMounted || mountToken !== this.settingsMountToken) return true;
        show(option.id);
        return false;
      }
    });
  };
  show();
}

export function registerMdbListAccountActions() {
  this.actionMap.set("integration:mdblist:account", () => {
    if (!MdbListAccount.connected()) {
      openMdbListAuthorization.call(this);
      return;
    }
    const scope = MdbListAccount.scope();
    this.openOptionDialog({
      title: "MDBList",
      message:
        t("mdblist_tracking_description") +
        (MdbListTracking.getSnapshot().checkedAt
          ? ` · ${t("mdblist_last_synced", [new Date(MdbListTracking.getSnapshot().checkedAt).toLocaleString()])}`
          : ""),
      options: [
        { id: "sync", label: t("simkl_sync_now") },
        { id: "disconnect", label: t("debrid_disconnect") },
        { id: "cancel", label: t("common.cancel") }
      ],
      returnFocusKey: "integration:mdblist:account",
      onSelect: async (option) => {
        if (option.id === "sync") {
          MdbListAccount.check(scope);
          this.mdbListAccountMessage = t("mdblist_status_syncing");
          try {
            await MdbListTracking.refresh({ force: true, strict: true });
            MdbListAccount.check(scope);
            this.mdbListAccountMessage = t("mdblist_last_synced", [
              new Date(MdbListTracking.getSnapshot().checkedAt).toLocaleString()
            ]);
          } catch (error) {
            try {
              MdbListAccount.check(scope);
            } catch (_) {
              return true;
            }
            this.mdbListAccountMessage = t(
              error.code || "mdblist_unavailable",
              {},
              t("mdblist_unavailable")
            );
          }
          return true;
        }
        if (option.id !== "disconnect") return true;
        MdbListAccount.check(scope);
        const revoked = await MdbListAccount.disconnect();
        if (String(ProfileManager.getActiveProfileId()) !== scope.profileId) return true;
        if (!revoked) this.mdbListAccountMessage = t("mdblist_revoke_failed");
        return true;
      }
    });
  });
  this.actionMap.set("integration:mdblist:lists", async () => {
    try {
      await openMdbListVisibility.call(this);
    } catch (error) {
      this.mdbListAccountMessage = t(
        error?.code || "mdblist_unavailable",
        {},
        t("mdblist_unavailable")
      );
    }
  });
}
