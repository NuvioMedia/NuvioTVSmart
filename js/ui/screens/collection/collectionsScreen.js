import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { CollectionsStore } from "../../../data/local/collectionsStore.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../../components/reorderSession.js";
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
    this.ensureClickDelegation();
    this.focusKey = this.focusKey || "new";
    this.render();
  },

  ensureClickDelegation() {
    if (!this.container) {
      return;
    }
    if (!this._boundClickHandler) {
      this._boundClickHandler = async (event) => {
        const node = event?.target?.closest?.(".collections-focusable");
        if (!node || !this.container?.contains(node)) {
          return;
        }
        this.focusKey = String(node.dataset.focusKey || this.focusKey);
        this.applyFocus();
        await this.activateFocused();
      };
    }
    if (this._boundClickContainer === this.container) {
      return;
    }
    if (this._boundClickContainer) {
      this._boundClickContainer.removeEventListener("click", this._boundClickHandler);
    }
    this.container.addEventListener("click", this._boundClickHandler);
    this._boundClickContainer = this.container;
  },

  render() {
    const prevScrollTop = Number(
      this.container?.querySelector(".collections-main")?.scrollTop || 0
    );
    const collections = Array.isArray(this.reorderCollections)
      ? this.reorderCollections
      : CollectionsStore.get();
    this.collections = collections;
    const movingId = this.reorderSession?.movingKey || "";
    const rows = collections
      .map((collection, index) => {
        const isMoving = movingId === collection.id;
        const actionLocked = Boolean(movingId) && !isMoving;
        const folderCountText = t(
          "collections_folder_count",
          `${collection.folders.length} folder(s)`
        ).replace("%1$d", String(collection.folders.length));
        const subtitle = collection.pinToTop
          ? `${folderCountText} · ${t("collections_pinned", "Pinned")}`
          : folderCountText;
        return `
          <article class="collections-card${isMoving ? " is-moving" : ""}">
            <div class="collections-card-copy">
              <h2>${escapeHtml(collection.title)}</h2>
              <p class="collections-card-subtitle">${escapeHtml(subtitle)}</p>
            </div>
            <div class="collections-card-actions">
              ${
                isMoving
                  ? `<button type="button" class="collections-action collections-focusable"
                      data-focus-key="collection:${escapeHtml(collection.id)}:reorder"
                      data-action="done" data-id="${escapeHtml(collection.id)}">
                      <span class="material-icons" aria-hidden="true">check</span>
                      <span class="reorder-done-label">${escapeHtml(t("collections_done", "Done"))}</span>
                    </button>`
                  : actionLocked
                    ? ""
                    : `<button type="button" class="collections-action collections-focusable"
                      data-focus-key="collection:${escapeHtml(collection.id)}:reorder"
                      data-action="reorder" data-id="${escapeHtml(collection.id)}">
                      <span class="material-icons" aria-hidden="true">reorder</span>
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
                    </button>`
              }
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

    const main = this.container.querySelector(".collections-main");
    if (main && prevScrollTop > 0) {
      main.scrollTop = prevScrollTop;
    }
    this.ensureClickDelegation();
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
    this.scrollFocusedIntoView(target, nodes);
  },

  scrollFocusedIntoView(target, nodes = null) {
    if (!target) {
      return;
    }
    const main = this.container?.querySelector(".collections-main");
    const focusables =
      nodes || Array.from(this.container?.querySelectorAll(".collections-focusable") || []);
    const isTopControl =
      (focusables.length > 0 && target === focusables[0]) ||
      (isReordering(this.reorderSession) &&
        String(this.collections?.[0]?.id || "") === String(this.reorderSession?.movingKey || ""));
    if (main && isTopControl) {
      main.scrollTop = 0;
      return;
    }
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
    if (action === "reorder") {
      this.startReorder(id);
    } else if (action === "done") {
      this.finishReorder();
    }
  },

  startReorder(id) {
    const list = CollectionsStore.get();
    this.reorderSession = createReorderSession({ keys: list.map((collection) => collection.id) });
    if (!beginReorder(this.reorderSession, id)) {
      this.reorderSession = null;
      return;
    }
    this.reorderCollections = list;
    this.focusKey = `collection:${id}:reorder`;
    this.render();
  },
  applyReorderOrder() {
    const source = Array.isArray(this.reorderCollections)
      ? this.reorderCollections
      : CollectionsStore.get();
    const byId = new Map(source.map((collection) => [collection.id, collection]));
    const next = (this.reorderSession?.keys || []).map((key) => byId.get(key)).filter(Boolean);
    if (next.length) {
      this.reorderCollections = next;
    }
  },
  moveCollection(delta) {
    if (!moveReorderBy(this.reorderSession, delta)) {
      return;
    }
    this.applyReorderOrder();
    this.focusKey = `collection:${this.reorderSession.movingKey}:reorder`;
    this.render();
  },
  finishReorder() {
    if (!this.reorderSession) {
      return;
    }
    // Reconcile the session order with the latest store so collections synced in
    // while the move was open are kept instead of being dropped on confirm.
    const session = this.reorderSession;
    const movingId = session.movingKey;
    confirmReorder(session);
    const current = CollectionsStore.get();
    const byId = new Map(current.map((collection) => [collection.id, collection]));
    const next = session.keys.map((key) => byId.get(key)).filter(Boolean);
    const seen = new Set(next.map((collection) => collection.id));
    current.forEach((collection) => {
      if (!seen.has(collection.id)) {
        next.push(collection);
      }
    });
    const unchanged =
      next.length === current.length &&
      next.every((collection, index) => collection.id === current[index].id);
    this.focusKey = `collection:${movingId}:reorder`;
    this.reorderSession = null;
    this.reorderCollections = null;
    if (next.length && !unchanged) {
      CollectionsStore.replace(next);
    }
    this.render();
  },
  cancelReorderState() {
    if (!isReordering(this.reorderSession)) {
      return false;
    }
    const movingId = this.reorderSession.movingKey;
    cancelReorder(this.reorderSession);
    this.focusKey = `collection:${movingId}:reorder`;
    this.reorderSession = null;
    this.reorderCollections = null;
    this.render();
    return true;
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
    if (isReordering(this.reorderSession)) {
      this.cancelReorderState();
      return true;
    }
    return false;
  },

  async onKeyDown(event) {
    if (this.deleteDialog) {
      return;
    }
    if (isReordering(this.reorderSession)) {
      const reorderCode = Number(event?.keyCode || 0);
      if (reorderCode === 38 || reorderCode === 40) {
        event?.preventDefault?.();
        this.moveCollection(reorderCode === 38 ? -1 : 1);
        return;
      }
      if (reorderCode === 37 || reorderCode === 39) {
        event?.preventDefault?.();
        return;
      }
      if (reorderCode === 13 || reorderCode === 23 || reorderCode === 66 || reorderCode === 160) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.finishReorder();
        return;
      }
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container, ".collections-focusable")) {
      const focused = this.container?.querySelector(".collections-focusable.focused");
      this.focusKey = String(focused?.dataset?.focusKey || this.focusKey);
      this.scrollFocusedIntoView(focused);
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
    this.reorderSession = null;
    this.reorderCollections = null;
    if (this._boundClickContainer && this._boundClickHandler) {
      this._boundClickContainer.removeEventListener("click", this._boundClickHandler);
    }
    this._boundClickContainer = null;
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
