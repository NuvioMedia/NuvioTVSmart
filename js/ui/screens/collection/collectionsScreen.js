import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { CollectionsStore } from "../../../data/local/collectionsStore.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { I18n } from "../../../i18n/index.js";

function t(key, fallback, params = {}) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const CollectionsScreen = {
  async mount() {
    this.container = document.getElementById("collections");
    ScreenUtils.show(this.container);
    this.focusKey = this.focusKey || "new";
    this.render();
  },

  render() {
    const collections = CollectionsStore.get();
    this.collections = collections;
    const rows = collections
      .map((collection, index) => {
        return `
          <article class="collections-card">
            <div class="collections-card-copy">
              <h2>${escapeHtml(collection.title)}</h2>
              <p class="collections-card-subtitle">${escapeHtml(
                t("collections_folder_count", `${collection.folders.length} folder(s)`).replace(
                  "%1$d",
                  String(collection.folders.length)
                )
              )}</p>
              ${collection.pinToTop ? `<p class="collections-card-pinned">${escapeHtml(t("collections_editor_pin_above", "Pinned above catalogs"))}</p>` : ""}
            </div>
            <div class="collections-card-actions">
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="collection:${escapeHtml(collection.id)}:up"
                      data-action="moveUp" data-id="${escapeHtml(collection.id)}"
                      ${index === 0 ? 'aria-disabled="true"' : ""}>
                <span class="material-icons" aria-hidden="true">arrow_upward</span>
              </button>
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="collection:${escapeHtml(collection.id)}:down"
                      data-action="moveDown" data-id="${escapeHtml(collection.id)}"
                      ${index === collections.length - 1 ? 'aria-disabled="true"' : ""}>
                <span class="material-icons" aria-hidden="true">arrow_downward</span>
              </button>
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="collection:${escapeHtml(collection.id)}"
                      data-action="edit" data-id="${escapeHtml(collection.id)}">
                <span class="material-icons" aria-hidden="true">edit</span>
              </button>
              <button type="button" class="collections-action collections-focusable collections-action-danger"
                      data-focus-key="collection:${escapeHtml(collection.id)}:delete"
                      data-action="delete" data-id="${escapeHtml(collection.id)}">
                <span class="material-icons" aria-hidden="true">delete</span>
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <header class="collections-header-row">
            <div>
              <h1 class="collections-title">${escapeHtml(t("collections_header", "Collections"))}</h1>
              <p class="collections-subtitle">${escapeHtml(
                t("web_manage_collections_subtitle", "Create and manage your custom collections")
              )}</p>
            </div>
            <button type="button" class="collections-new collections-focusable"
                    data-focus-key="new" data-action="new">
              <span class="material-icons" aria-hidden="true">add</span>
              <span>${escapeHtml(t("collections_new", "New Collection"))}</span>
            </button>
          </header>
          <section class="collections-list">
            ${
              collections.length
                ? rows
                : `<p class="collections-empty">${escapeHtml(
                    t(
                      "collections_empty",
                      "No collections yet. Create one to organize your catalogs."
                    )
                  )}</p>`
            }
          </section>
        </main>
      </div>
    `;

    this.container.querySelectorAll(".collections-focusable").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusKey = String(node.dataset.focusKey || this.focusKey);
        this.applyFocus();
        await this.activateFocused();
      });
    });

    this.applyFocus();
  },

  applyFocus() {
    this.container
      ?.querySelectorAll(".collections-focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const nodes = Array.from(this.container?.querySelectorAll(".collections-focusable") || []);
    if (!nodes.length) {
      return;
    }
    const target =
      nodes.find((node) => String(node.dataset.focusKey || "") === this.focusKey) || nodes[0];
    this.focusKey = String(target.dataset.focusKey || "");
    target.classList.add("focused");
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest" });
  },

  async activateFocused() {
    const node =
      this.container?.querySelector(".collections-focusable.focused") ||
      this.container?.querySelector(".collections-focusable");
    if (!node) {
      return;
    }
    const action = String(node.dataset.action || "");
    const id = String(node.dataset.id || "");
    if (action === "new") {
      await Router.navigate("collectionEditor", { collectionId: null });
      return;
    }
    if (action === "edit") {
      await Router.navigate("collectionEditor", { collectionId: id });
      return;
    }
    if (action === "delete") {
      this.confirmDelete(id);
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      this.moveCollection(id, action === "moveUp" ? -1 : 1);
    }
  },

  moveCollection(id, direction) {
    const list = CollectionsStore.get();
    const index = list.findIndex((collection) => collection.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) {
      return;
    }
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    CollectionsStore.replace(next);
    this.focusKey = `collection:${id}`;
    this.render();
  },

  confirmDelete(id) {
    const collection = CollectionsStore.get().find((entry) => entry.id === id);
    if (!collection || this.deleteDialog) {
      return;
    }
    this.deleteDialog = new NuvioDialog({
      title: t("collections_delete_confirm_title", "Delete Collection?"),
      subtitle: t(
        "collections_delete_confirm_subtitle",
        `This will permanently delete "${collection.title}". This cannot be undone.`
      ).replace("%1$s", collection.title),
      widthVw: 42,
      buttons: [
        {
          label: t("collections_delete_confirm", "Delete"),
          key: "delete",
          danger: true,
          onAction: () => {
            this.closeDeleteDialog();
            CollectionsStore.removeCollection(id);
            this.focusKey = "new";
            this.render();
          }
        },
        {
          label: t("collections_cancel", "Cancel"),
          key: "cancel",
          onAction: () => this.closeDeleteDialog()
        }
      ],
      onDismiss: () => this.closeDeleteDialog()
    }).mount(document.body);
  },

  closeDeleteDialog() {
    const dialog = this.deleteDialog;
    this.deleteDialog = null;
    dialog?.destroy?.();
  },

  consumeBackRequest() {
    if (this.deleteDialog) {
      this.closeDeleteDialog();
      return true;
    }
    return false;
  },

  async onKeyDown(event) {
    if (this.deleteDialog) {
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container, ".collections-focusable")) {
      const focused = this.container?.querySelector(".collections-focusable.focused");
      this.focusKey = String(focused?.dataset?.focusKey || this.focusKey);
      focused?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    const code = Number(event?.keyCode || 0);
    if (code === 13 || code === 23 || code === 66 || code === 160) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.activateFocused();
    }
  },

  cleanup() {
    this.closeDeleteDialog();
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
