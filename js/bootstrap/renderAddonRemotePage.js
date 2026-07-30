import { AuthManager } from "../core/auth/authManager.js";
import { addonRepository } from "../data/repository/addonRepository.js";
import { HomeCatalogStore } from "../data/local/homeCatalogStore.js";
import { CollectionsStore } from "../data/local/collectionsStore.js";
import { buildOrderedHomeCatalogItems, toDisplayTypeLabel } from "../core/addons/homeCatalogs.js";
import { LibrarySyncService } from "../core/profile/librarySyncService.js";
import { ProfileSettingsSyncService } from "../core/profile/profileSettingsSyncService.js";
import { HomeCatalogSettingsSyncService } from "../core/profile/homeCatalogSettingsSyncService.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeAddonUrl(input) {
  let trimmed = String(input || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("stremio://")) {
    trimmed = trimmed.replace(/^stremio:\/\//i, "https://");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return "";
  }
  if (trimmed.endsWith("/manifest.json")) {
    trimmed = trimmed.slice(0, -"/manifest.json".length);
  }
  return trimmed.replace(/\/+$/, "");
}

function clonePrefs(prefs = {}) {
  return {
    order: Array.isArray(prefs.order) ? [...prefs.order] : [],
    disabled: Array.isArray(prefs.disabled) ? [...prefs.disabled] : [],
    customTitles:
      prefs.customTitles &&
      typeof prefs.customTitles === "object" &&
      !Array.isArray(prefs.customTitles)
        ? { ...prefs.customTitles }
        : {}
  };
}

function createShell() {
  document.title = "Nuvio TV - Manage Addons";
  document.body.innerHTML = `
    <div class="addon-remote-shell">
      <style>
        body {
          margin: 0;
          background: #000;
          color: #fff;
          font-family: "Segoe UI", Arial, sans-serif;
        }
        .addon-remote-shell {
          min-height: 100vh;
          background:
            radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 32%),
            #000;
        }
        .addon-remote-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 28px 18px 80px;
        }
        .addon-remote-header {
          padding: 20px 0 28px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .addon-remote-header h1 {
          margin: 0;
          font-size: 34px;
          line-height: 1.1;
        }
        .addon-remote-header p {
          margin: 10px 0 0;
          color: rgba(255, 255, 255, 0.66);
          font-size: 15px;
          line-height: 1.5;
        }
        .addon-remote-banner {
          margin-top: 18px;
          padding: 14px 16px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.78);
          font-size: 14px;
          line-height: 1.5;
        }
        .addon-remote-banner.is-warn {
          background: rgba(207, 102, 121, 0.14);
          color: rgba(255, 214, 220, 0.92);
        }
        .addon-remote-section {
          margin-top: 28px;
        }
        .addon-remote-label {
          margin: 0 0 12px;
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .addon-remote-add {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
        }
        .addon-remote-input {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          padding: 14px 18px;
          font-size: 15px;
        }
        .addon-remote-input::placeholder {
          color: rgba(255, 255, 255, 0.28);
        }
        .addon-remote-error {
          min-height: 20px;
          margin-top: 10px;
          color: #cf6679;
          font-size: 13px;
        }
        .addon-remote-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .addon-remote-card {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 14px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .addon-remote-order {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .addon-remote-copy {
          min-width: 0;
          flex: 1;
        }
        .addon-remote-copy strong,
        .addon-remote-copy span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .addon-remote-copy strong {
          font-size: 15px;
        }
        .addon-remote-copy span {
          margin-top: 3px;
          color: rgba(255, 255, 255, 0.54);
          font-size: 12px;
        }
        .addon-remote-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .addon-remote-btn {
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          background: transparent;
          color: #fff;
          padding: 10px 14px;
          font-size: 13px;
          cursor: pointer;
        }
        .addon-remote-btn:disabled {
          opacity: 0.28;
          cursor: default;
        }
        .addon-remote-btn-danger {
          border-color: rgba(207, 102, 121, 0.4);
          color: #ffb5c0;
        }
        .addon-remote-btn-toggle.is-disabled {
          border-color: rgba(207, 102, 121, 0.4);
          color: #ffb5c0;
        }
        .addon-remote-empty {
          padding: 18px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.54);
          text-align: center;
          font-size: 14px;
        }
        .addon-remote-save {
          width: 100%;
          margin-top: 28px;
          padding: 16px 18px;
          border-radius: 999px;
          border: none;
          background: #fff;
          color: #000;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }
        .addon-remote-save:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .addon-remote-status {
          margin-top: 14px;
          font-size: 13px;
          text-align: center;
          color: rgba(255, 255, 255, 0.62);
        }
      </style>
      <div class="addon-remote-page" data-addon-remote-root></div>
    </div>
  `;
}

const AddonRemotePage = {
  async mount() {
    createShell();
    this.root = document.querySelector("[data-addon-remote-root]");
    this.addonDraft = "";
    this.addError = "";
    this.statusMessage = "";
    this.isSaving = false;
    this.isBootstrapping = true;
    this.authReady = false;
    this.catalogPrefs = clonePrefs(HomeCatalogStore.get());
    this.savedState = { urls: [], order: [], disabled: [] };
    this.draftAddons = [];
    this.collections = [];
    this.catalogItems = [];
    this.render();

    try {
      await AuthManager.bootstrap();
    } catch (error) {
      console.warn("Addon remote auth bootstrap failed", error);
    }

    this.authReady = true;
    await this.loadCurrentState();
  },

  buildCurrentState() {
    return {
      urls: this.draftAddons.map((addon) => addon.baseUrl),
      order: this.catalogItems.map((item) => item.key),
      disabled: this.catalogItems.filter((item) => item.isDisabled).map((item) => item.disableKey)
    };
  },

  isDirty() {
    return JSON.stringify(this.buildCurrentState()) !== JSON.stringify(this.savedState);
  },

  rebuildCatalogItems() {
    const nextItems = buildOrderedHomeCatalogItems(
      this.draftAddons,
      this.collections,
      this.catalogPrefs.order,
      this.catalogPrefs.disabled,
      this.catalogPrefs.customTitles
    );
    this.catalogItems = nextItems;
    this.catalogPrefs = {
      order: nextItems.map((item) => item.key),
      disabled: nextItems.filter((item) => item.isDisabled).map((item) => item.disableKey),
      customTitles: this.catalogPrefs.customTitles || {}
    };
  },

  async loadCurrentState() {
    this.isBootstrapping = true;
    this.render();

    this.draftAddons = await addonRepository.getInstalledAddons({ includeDisabled: true });
    this.collections = CollectionsStore.get();
    this.catalogPrefs = clonePrefs(HomeCatalogStore.get());
    this.rebuildCatalogItems();
    this.savedState = this.buildCurrentState();
    this.isBootstrapping = false;
    this.render();
  },

  async addAddon() {
    const normalizedUrl = normalizeAddonUrl(this.addonDraft);
    if (!normalizedUrl) {
      this.addError = "Enter a valid http or https addon URL.";
      this.render();
      return;
    }
    if (this.draftAddons.some((addon) => addon.baseUrl === normalizedUrl)) {
      this.addError = "That addon is already in the list.";
      this.render();
      return;
    }

    this.addError = "";
    this.statusMessage = "";
    this.render();

    const result = await addonRepository.fetchAddon(normalizedUrl);
    if (result.status !== "success") {
      this.addError = result.message || "Unable to load that addon.";
      this.render();
      return;
    }

    this.draftAddons = [...this.draftAddons, result.data];
    this.addonDraft = "";
    this.rebuildCatalogItems();
    this.render();
  },

  moveAddon(index, delta) {
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= this.draftAddons.length) {
      return;
    }
    const next = [...this.draftAddons];
    const moved = next.splice(index, 1)[0];
    next.splice(nextIndex, 0, moved);
    this.draftAddons = next;
    this.rebuildCatalogItems();
    this.render();
  },

  removeAddon(index) {
    if (index < 0 || index >= this.draftAddons.length) {
      return;
    }
    this.draftAddons = this.draftAddons.filter((_, currentIndex) => currentIndex !== index);
    this.rebuildCatalogItems();
    this.render();
  },

  moveCatalog(index, delta) {
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= this.catalogItems.length) {
      return;
    }
    const nextOrder = [...this.catalogPrefs.order];
    const moved = nextOrder.splice(index, 1)[0];
    nextOrder.splice(nextIndex, 0, moved);
    this.catalogPrefs.order = nextOrder;
    this.rebuildCatalogItems();
    this.render();
  },

  toggleCatalog(disableKey) {
    const disabled = new Set(this.catalogPrefs.disabled);
    if (disabled.has(disableKey)) {
      disabled.delete(disableKey);
    } else {
      disabled.add(disableKey);
    }
    this.catalogPrefs.disabled = [...disabled];
    this.rebuildCatalogItems();
    this.render();
  },

  async saveChanges() {
    if (this.isSaving || !this.isDirty()) {
      return;
    }
    this.isSaving = true;
    this.statusMessage = "";
    this.render();

    try {
      const addonUrls = this.draftAddons.map((addon) => addon.baseUrl);
      await addonRepository.setAddonOrder(addonUrls);
      HomeCatalogStore.setOrder(this.catalogPrefs.order);
      HomeCatalogStore.set({ disabled: this.catalogPrefs.disabled });

      if (AuthManager.isAuthenticated) {
        await LibrarySyncService.push();
        await ProfileSettingsSyncService.push();
        await HomeCatalogSettingsSyncService.push();
      }

      this.savedState = this.buildCurrentState();
      this.statusMessage = AuthManager.isAuthenticated
        ? "Addon and home catalog changes saved and pushed to your synced profile."
        : "Changes saved in this browser.";
    } catch (error) {
      console.warn("Addon remote save failed", error);
      this.statusMessage = "Could not save changes.";
    } finally {
      this.isSaving = false;
      this.render();
    }
  },

  bindEvents() {
    this.root.querySelector("[data-action='draft']")?.addEventListener("input", (event) => {
      this.addonDraft = String(event.target?.value || "");
      if (this.addError) {
        this.addError = "";
        this.render();
      }
    });

    this.root.querySelector("[data-action='draft']")?.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await this.addAddon();
      }
    });

    this.root.querySelector("[data-action='add']")?.addEventListener("click", async () => {
      await this.addAddon();
    });

    this.root.querySelector("[data-action='save']")?.addEventListener("click", async () => {
      await this.saveChanges();
    });

    this.root.querySelectorAll("[data-addon-up]").forEach((node) => {
      node.addEventListener("click", () => {
        this.moveAddon(Number(node.dataset.addonUp || 0), -1);
      });
    });

    this.root.querySelectorAll("[data-addon-down]").forEach((node) => {
      node.addEventListener("click", () => {
        this.moveAddon(Number(node.dataset.addonDown || 0), 1);
      });
    });

    this.root.querySelectorAll("[data-addon-remove]").forEach((node) => {
      node.addEventListener("click", () => {
        this.removeAddon(Number(node.dataset.addonRemove || 0));
      });
    });

    this.root.querySelectorAll("[data-catalog-up]").forEach((node) => {
      node.addEventListener("click", () => {
        this.moveCatalog(Number(node.dataset.catalogUp || 0), -1);
      });
    });

    this.root.querySelectorAll("[data-catalog-down]").forEach((node) => {
      node.addEventListener("click", () => {
        this.moveCatalog(Number(node.dataset.catalogDown || 0), 1);
      });
    });

    this.root.querySelectorAll("[data-catalog-toggle]").forEach((node) => {
      node.addEventListener("click", () => {
        this.toggleCatalog(String(node.dataset.catalogToggle || ""));
      });
    });
  },

  render() {
    if (!this.root) {
      return;
    }

    const infoBanner = this.authReady
      ? AuthManager.isAuthenticated
        ? "Signed in. Addon and home catalog changes can be pushed through the web sync backend."
        : "Signed out. Changes save only in this browser unless you sign in on this phone."
      : "Checking account state...";

    const addonCards = this.draftAddons.length
      ? this.draftAddons
          .map(
            (addon, index) => `
          <article class="addon-remote-card">
            <div class="addon-remote-order">
              <button class="addon-remote-btn" data-addon-up="${index}" ${index === 0 ? "disabled" : ""}>Up</button>
              <button class="addon-remote-btn" data-addon-down="${index}" ${index === this.draftAddons.length - 1 ? "disabled" : ""}>Down</button>
            </div>
            <div class="addon-remote-copy">
              <strong>${escapeHtml(addon.displayName || addon.name || addon.baseUrl)}</strong>
              <span>${escapeHtml(addon.baseUrl)}</span>
              ${addon.description ? `<span>${escapeHtml(addon.description)}</span>` : ""}
            </div>
            <div class="addon-remote-actions">
              <button class="addon-remote-btn addon-remote-btn-danger" data-addon-remove="${index}">Remove</button>
            </div>
          </article>
        `
          )
          .join("")
      : '<div class="addon-remote-empty">No addons in this draft yet.</div>';

    const catalogCards = this.catalogItems.length
      ? this.catalogItems
          .map(
            (item, index) => `
          <article class="addon-remote-card">
            <div class="addon-remote-order">
              <button class="addon-remote-btn" data-catalog-up="${index}" ${index === 0 ? "disabled" : ""}>Up</button>
              <button class="addon-remote-btn" data-catalog-down="${index}" ${index === this.catalogItems.length - 1 ? "disabled" : ""}>Down</button>
            </div>
            <div class="addon-remote-copy">
              <strong>${escapeHtml(item.catalogName)}${item.isDisabled ? ' <span style="color:#ffb5c0;">Disabled</span>' : ""}</strong>
              <span>${escapeHtml(`${item.addonName} - ${toDisplayTypeLabel(item.type)}`)}</span>
            </div>
            <div class="addon-remote-actions">
              <button class="addon-remote-btn addon-remote-btn-toggle${item.isDisabled ? " is-disabled" : ""}"
                      data-catalog-toggle="${escapeHtml(item.disableKey)}">
                ${item.isDisabled ? "Enable" : "Disable"}
              </button>
            </div>
          </article>
        `
          )
          .join("")
      : '<div class="addon-remote-empty">No Home catalogs available from the current addons.</div>';

    this.root.innerHTML = `
      <header class="addon-remote-header">
        <h1>Addons</h1>
        <p>Manage addons and home catalogs from your phone.</p>
        <div class="addon-remote-banner${AuthManager.isAuthenticated ? "" : " is-warn"}">${escapeHtml(infoBanner)}</div>
      </header>

      <section class="addon-remote-section">
        <p class="addon-remote-label">Add addon</p>
        <div class="addon-remote-add">
          <input class="addon-remote-input"
                 type="url"
                 value="${escapeHtml(this.addonDraft)}"
                 placeholder="https://example.com/manifest.json"
                 data-action="draft" />
          <button class="addon-remote-btn" data-action="add">Add</button>
        </div>
        <div class="addon-remote-error">${escapeHtml(this.addError)}</div>
      </section>

      <section class="addon-remote-section">
        <p class="addon-remote-label">Installed addons</p>
        <div class="addon-remote-list">${this.isBootstrapping ? '<div class="addon-remote-empty">Loading addons...</div>' : addonCards}</div>
      </section>

      <section class="addon-remote-section">
        <p class="addon-remote-label">Home catalogs</p>
        <div class="addon-remote-list">${this.isBootstrapping ? '<div class="addon-remote-empty">Loading catalogs...</div>' : catalogCards}</div>
      </section>

      <button class="addon-remote-save" data-action="save" ${this.isSaving || !this.isDirty() ? "disabled" : ""}>
        ${this.isSaving ? "Saving..." : "Save changes"}
      </button>
      <div class="addon-remote-status">${escapeHtml(this.statusMessage)}</div>
    `;

    this.bindEvents();
  }
};

export async function renderAddonRemotePage() {
  await AddonRemotePage.mount();
}
