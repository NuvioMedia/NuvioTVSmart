import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { CollectionsStore } from "../../../data/local/collectionsStore.js";
import {
  buildOrderedHomeCatalogItems,
  toDisplayTypeLabel
} from "../../../core/addons/homeCatalogs.js";
import { Platform } from "../../../platform/index.js";
import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const CatalogOrderScreen = {
  async mount() {
    if (ExperienceModeStore.isEssential()) {
      await Router.navigate("plugin", {}, { replaceHistory: true, skipStackPush: true });
      return;
    }
    this.container = document.getElementById("catalogOrder");
    ScreenUtils.show(this.container);
    this.mountToken = (this.mountToken || 0) + 1;
    this.focusRow = Number.isFinite(this.focusRow) ? this.focusRow : 0;
    this.focusCol = Number.isFinite(this.focusCol) ? this.focusCol : 0;
    this.renderLoading();

    // Android exposes the Catalog Order surface immediately and observes the
    // addon state independently. Manifest resolution must not keep the route
    // pending or make Back/D-pad wait for a remote addon response.
    void this.render().catch((error) => {
      if (Router.getCurrent() === "catalogOrder") {
        console.warn("Catalog order background load failed", error);
      }
    });
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons({ includeMediaServers: true });
    const collections = CollectionsStore.get();
    const prefs = HomeCatalogStore.get();
    return {
      items: buildOrderedHomeCatalogItems(
        addons,
        collections,
        prefs.order,
        prefs.disabled,
        prefs.customTitles
      )
    };
  },

  setRowColumns(row, cols) {
    this.rowColumns.set(row, cols);
  },

  getRows() {
    return [...this.rowColumns.keys()].sort((left, right) => left - right);
  },

  getCols(row) {
    return this.rowColumns.get(row) || [0];
  },

  normalizeFocus() {
    const rows = this.getRows();
    if (!rows.length) {
      this.focusRow = 0;
      this.focusCol = 0;
      return;
    }
    this.focusRow = rows.includes(this.focusRow)
      ? this.focusRow
      : rows[clamp(this.focusRow, 0, rows.length - 1)];
    const cols = this.getCols(this.focusRow);
    this.focusCol = cols.includes(this.focusCol) ? this.focusCol : cols[0];
  },

  ensureVisibility(target) {
    const container = this.container?.querySelector(".catalog-order-main");
    if (!container || !target) {
      return;
    }
    const anchor = target.closest(".catalog-order-card") || target;
    const pad = 56;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorTop = anchorRect.top - containerRect.top + container.scrollTop;
    const anchorBottom = anchorRect.bottom - containerRect.top + container.scrollTop;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (anchorBottom > viewBottom - pad) {
      container.scrollTop = Math.min(
        container.scrollHeight - container.clientHeight,
        Math.max(0, anchorBottom - container.clientHeight + pad)
      );
    } else if (anchorTop < viewTop + pad) {
      container.scrollTop = Math.max(0, anchorTop - pad);
    }
  },

  applyFocus() {
    this.container
      ?.querySelectorAll(".catalog-order-focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const target =
      this.container?.querySelector(
        `.catalog-order-focusable[data-row="${this.focusRow}"][data-col="${this.focusCol}"]`
      ) ||
      this.container?.querySelector(
        `.catalog-order-focusable[data-row="${this.focusRow}"][data-col="0"]`
      ) ||
      this.container?.querySelector(".catalog-order-focusable");

    if (!target) {
      return;
    }
    target.classList.add("focused");
    this.ensureVisibility(target);
    target.focus();
  },

  async moveItem(key, direction) {
    const current = this.model.items.map((item) => item.key);
    const index = current.indexOf(key);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= current.length) {
      return;
    }
    const reordered = [...current];
    const moved = reordered.splice(index, 1)[0];
    reordered.splice(nextIndex, 0, moved);
    HomeCatalogStore.setOrder(reordered);
    this.focusRow = nextIndex;
    await this.render();
  },

  async toggleItem(disableKey) {
    HomeCatalogStore.toggleDisabled(disableKey);
    await this.render();
  },

  async render() {
    const mountToken = this.mountToken;
    this.model = await this.collectModel();
    if (mountToken !== this.mountToken || Router.getCurrent() !== "catalogOrder") {
      return;
    }
    this.rowColumns = new Map();
    const itemsHtml = this.model.items
      .map((item, index) => {
        const cols = [];
        if (item.canMoveUp) {
          cols.push(0);
        }
        if (item.canMoveDown) {
          cols.push(1);
        }
        cols.push(2);
        this.setRowColumns(index, cols);

        return `
        <article class="catalog-order-card">
          <div class="catalog-order-card-copy">
            <h2>${escapeHtml(item.catalogName)} - ${escapeHtml(toDisplayTypeLabel(item.type))}</h2>
            <p class="catalog-order-card-subtitle">${escapeHtml(item.addonName)}</p>
            ${item.isDisabled ? '<p class="catalog-order-card-disabled">Disabled on Home</p>' : ""}
          </div>
          <div class="catalog-order-card-actions">
            <button type="button"
                    class="catalog-order-action ${item.canMoveUp ? "catalog-order-focusable" : "is-disabled"}"
                    ${item.canMoveUp ? `data-row="${index}" data-col="0" data-action="up" data-key="${escapeHtml(item.key)}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
              <span class="material-icons" aria-hidden="true">arrow_upward</span>
            </button>
            <button type="button"
                    class="catalog-order-action ${item.canMoveDown ? "catalog-order-focusable" : "is-disabled"}"
                    ${item.canMoveDown ? `data-row="${index}" data-col="1" data-action="down" data-key="${escapeHtml(item.key)}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
              <span class="material-icons" aria-hidden="true">arrow_downward</span>
            </button>
            <button type="button"
                    class="catalog-order-action catalog-order-focusable catalog-order-toggle${item.isDisabled ? " is-disabled-state" : ""}"
                    data-row="${index}"
                    data-col="2"
                    data-action="toggle"
                    data-disable-key="${escapeHtml(item.disableKey)}"
                    tabindex="-1">${item.isDisabled ? "Enable" : "Disable"}</button>
          </div>
        </article>
      `;
      })
      .join("");

    this.container.innerHTML = `
      <div class="catalog-order-shell">
        <main class="catalog-order-main">
          <h1 class="catalog-order-title">Reorder Home Catalogs</h1>
          <p class="catalog-order-subtitle">This controls catalog row order on Home (Classic + Modern + Grid).</p>
          <section class="catalog-order-list">
            ${this.model.items.length ? itemsHtml : '<p class="catalog-order-empty">No home catalogs available yet.</p>'}
          </section>
        </main>
      </div>
    `;

    this.container.querySelectorAll(".catalog-order-focusable[data-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusRow = Number(node.dataset.row || 0);
        this.focusCol = Number(node.dataset.col || 0);
        this.applyFocus();
        await this.activateFocused();
      });
    });

    this.normalizeFocus();
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container?.querySelector(".catalog-order-focusable.focused");
    if (!current) {
      return;
    }

    const action = String(current.dataset.action || "");
    if (action === "up") {
      await this.moveItem(String(current.dataset.key || ""), -1);
    } else if (action === "down") {
      await this.moveItem(String(current.dataset.key || ""), 1);
    } else if (action === "toggle") {
      await this.toggleItem(String(current.dataset.disableKey || ""));
    }
  },

  moveFocus(deltaRow, deltaCol = 0) {
    if (deltaCol !== 0) {
      const cols = this.getCols(this.focusRow);
      const currentIndex = Math.max(0, cols.indexOf(this.focusCol));
      this.focusCol = cols[clamp(currentIndex + deltaCol, 0, cols.length - 1)];
      this.applyFocus();
      return;
    }

    const rows = this.getRows();
    const currentIndex = Math.max(0, rows.indexOf(this.focusRow));
    this.focusRow = rows[clamp(currentIndex + deltaRow, 0, rows.length - 1)] || 0;
    const cols = this.getCols(this.focusRow);
    this.focusCol = cols.includes(this.focusCol) ? this.focusCol : cols[0];
    this.applyFocus();
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (code === 38) this.moveFocus(-1);
      else if (code === 40) this.moveFocus(1);
      else if (code === 37) this.moveFocus(0, -1);
      else if (code === 39) this.moveFocus(0, 1);
      return;
    }

    if (code === 13) {
      // Prevent the focused button's native click from also firing, otherwise
      // the action runs twice and rows jump two slots at a time.
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.activateFocused();
    }
  },

  cleanup() {
    this.mountToken = (this.mountToken || 0) + 1;
    ScreenUtils.hide(this.container);
  },

  renderLoading() {
    this.rowColumns = new Map();
    this.container.innerHTML = `
      <div class="catalog-order-shell">
        <main class="catalog-order-main">
          <h1 class="catalog-order-title">Reorder Home Catalogs</h1>
          <p class="catalog-order-subtitle">This controls catalog row order on Home (Classic + Modern + Grid).</p>
          <section class="catalog-order-list catalog-order-loading">
            ${renderLoadingIndicator()}
            <span>Loading...</span>
          </section>
        </main>
      </div>
    `;
  }
};
