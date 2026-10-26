import { MediaServerRepository } from "../../../data/mediaserver/mediaServerRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { I18n } from "../../../i18n/index.js";
const t = (key, params = []) => I18n.t(key, params, { fallback: key });
export function renderMediaServersSection() {
  const pid = String(ProfileManager.getActiveProfileId());
  if (this.mediaServerProfileId !== pid) {
    this.mediaServerProfileId = pid;
    this.mediaServerDraft = null;
    this.mediaServersView = "list";
    this.mediaServerError = null;
  }
  const view = this.mediaServersView;
  const mount = this.settingsMountToken;
  const current = () =>
    this.isMounted &&
    this.activeSection === "contentDiscovery" &&
    this.settingsMountToken === mount &&
    String(ProfileManager.getActiveProfileId()) === pid &&
    this.mediaServersView === view;
  const connection = MediaServerRepository.connection(view);
  const back = () => {
    this.mediaServerDraft = null;
    this.mediaServerError = null;
    this.mediaServersView = view === "list" ? null : "list";
    this.contentFocusKey = "mediaServers:back";
  };
  this.actionMap.set("mediaServers:back", back);
  let body = this.renderActionRow({
    focusKey: "mediaServers:back",
    title: t("action_back"),
    icon: ""
  });
  if (view === "add") {
    const draft = (this.mediaServerDraft ||= {
      providerId: "jellyfin",
      address: "",
      username: "",
      password: ""
    });
    this.actionMap.set("mediaServers:provider", () =>
      this.openOptionDialog({
        title: t("settings_media_servers"),
        options: [
          { id: "jellyfin", label: "Jellyfin" },
          { id: "emby", label: "Emby" }
        ],
        selectedId: draft.providerId,
        returnFocusKey: "mediaServers:provider",
        onSelect: (option) => {
          draft.providerId = option.id;
        }
      })
    );
    body += this.renderActionRow({
      focusKey: "mediaServers:provider",
      title: t("settings_media_servers"),
      value: draft.providerId === "emby" ? "Emby" : "Jellyfin"
    });
    for (const field of ["address", "username", "password"]) {
      this.actionMap.set(`mediaServers:${field}`, () =>
        this.openTextDialog({
          title: t(`servers_${field}`),
          value: draft[field],
          secret: field === "password",
          inputType: field === "address" ? "url" : "text",
          placeholder: field === "address" ? t("servers_address_hint") : "",
          returnFocusKey: `mediaServers:${field}`,
          onSubmit: (value) => {
            draft[field] = value;
          }
        })
      );
      body += this.renderActionRow({
        focusKey: `mediaServers:${field}`,
        title: t(`servers_${field}`),
        value: field === "password" ? (draft.password ? "••••••" : "") : draft[field]
      });
    }
    this.actionMap.set("mediaServers:connect", async () => {
      if (!current() || this.mediaServerConnecting) return;
      this.mediaServerConnecting = true;
      this.mediaServerError = null;
      try {
        const entry = await MediaServerRepository.connect({ ...draft });
        if (current()) {
          this.mediaServersView = entry.id;
          this.mediaServerDraft = null;
        }
      } catch (error) {
        if (!current()) return;
        this.mediaServerError = t(
          error?.message?.startsWith("servers_") ? error.message : "servers_error_unreachable",
          [
            draft.providerId === "emby" ? "Emby" : "Jellyfin",
            draft.providerId === "emby" ? "4.7" : "10.9"
          ]
        );
      } finally {
        draft.password = "";
        this.mediaServerConnecting = false;
      }
    });
    body += this.renderActionRow({
      focusKey: "mediaServers:connect",
      title: t(this.mediaServerConnecting ? "servers_connecting" : "servers_connect"),
      disabled: this.mediaServerConnecting
    });
  } else if (connection) {
    body += `<h3>${this.escapeMediaServerText(connection.name)}</h3><p>${this.escapeMediaServerText(t("servers_signed_in_as", [connection.name, connection.userName]))}</p>`;
    for (const [field, label] of [
      ["enabled", "servers_enabled"],
      ["useCatalogMetadata", "servers_catalog_metadata"],
      ["importWatchState", "servers_import_watch_state"]
    ]) {
      this.actionMap.set(
        `mediaServers:${field}`,
        () =>
          current() && MediaServerRepository.update(connection.id, { [field]: !connection[field] })
      );
      body += this.renderToggleRow({
        focusKey: `mediaServers:${field}`,
        title: t(label),
        subtitle: t(`${label}_description`, [connection.name]),
        checked: connection[field]
      });
    }
    this.actionMap.set("mediaServers:libraries", () =>
      this.openMultiChoiceDialog({
        title: t("servers_libraries"),
        message: t("servers_libraries_description"),
        options: connection.libraries.map((lib) => ({ id: lib.id, label: lib.name })),
        selectedIds: connection.libraries.filter((lib) => lib.selected).map((lib) => lib.id),
        returnFocusKey: "mediaServers:libraries",
        onToggle: (ids) =>
          current() &&
          MediaServerRepository.update(connection.id, {
            libraries: connection.libraries.map((lib) => ({
              ...lib,
              selected: ids.includes(lib.id)
            }))
          })
      })
    );
    body += this.renderActionRow({
      focusKey: "mediaServers:libraries",
      title: t("servers_libraries"),
      value: connection.libraries
        .filter((lib) => lib.selected)
        .map((lib) => lib.name)
        .join(", ")
    });
    this.actionMap.set("mediaServers:refresh", async () => {
      if (!current()) return;
      try {
        await MediaServerRepository.refreshLibraries(connection.id);
      } catch (_) {
        if (!current()) return;
        this.mediaServerError = t("servers_error_unreachable");
      }
    });
    body += this.renderActionRow({
      focusKey: "mediaServers:refresh",
      title: t("servers_refresh_libraries")
    });
    this.actionMap.set("mediaServers:signin", () => {
      this.mediaServerDraft = {
        providerId: connection.providerId,
        address: connection.address,
        username: connection.userName,
        password: "",
        connectionId: connection.id
      };
      this.mediaServersView = "add";
    });
    body += this.renderActionRow({
      focusKey: "mediaServers:signin",
      title: t("servers_sign_in_again")
    });
    this.actionMap.set("mediaServers:remove", () =>
      this.openOptionDialog({
        title: t("servers_remove_confirm_title"),
        message: t("servers_remove_confirm_message", [connection.name]),
        options: [
          { id: "remove", label: t("servers_remove") },
          { id: "cancel", label: t("action_cancel") }
        ],
        selectedId: "cancel",
        returnFocusKey: "mediaServers:remove",
        onSelect: async (option) => {
          if (current() && option.id === "remove") {
            await MediaServerRepository.remove(connection.id);
            if (current()) this.mediaServersView = "list";
          }
        }
      })
    );
    body += this.renderActionRow({ focusKey: "mediaServers:remove", title: t("servers_remove") });
  } else {
    for (const entry of MediaServerRepository.connections()) {
      const id = `mediaServers:open:${entry.id}`;
      this.actionMap.set(id, () => {
        this.mediaServersView = entry.id;
      });
      body += this.renderActionRow({
        focusKey: id,
        title: entry.name,
        value: entry.providerId === "emby" ? "Emby" : "Jellyfin",
        subtitle: entry.userName
      });
    }
    this.actionMap.set("mediaServers:add", () => {
      this.mediaServerDraft = null;
      this.mediaServersView = "add";
    });
    body += this.renderActionRow({ focusKey: "mediaServers:add", title: t("servers_section_add") });
  }
  return `<div class="settings-group-card"><div class="settings-stack">${body}${this.mediaServerError ? `<p class="settings-trakt-error">${this.escapeMediaServerText(this.mediaServerError)}</p>` : ""}</div></div>`;
}
export function escapeMediaServerText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
