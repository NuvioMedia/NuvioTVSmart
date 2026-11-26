import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { I18n } from "../../../i18n/index.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../../components/reorderSession.js";

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

/** Android's add-on order in TvReorderList form: Enter moves, Enter again saves. */
export const AddonOrderScreen = {
  async mount() {
    this.container = document.getElementById("addonOrder");
    ScreenUtils.show(this.container);
    this.mountToken = (this.mountToken || 0) + 1;
    const mountToken = this.mountToken;
    this.focusIndex = Number.isFinite(this.focusIndex) ? this.focusIndex : 0;
    this.reorderSession = null;
    this.isSavingOrder = false;
    this.addons = [];
    this.renderLoading();
    await this.loadAddons();
    if (mountToken !== this.mountToken) {
      return;
    }
    await this.render();
  },

  async loadAddons() {
    const token = this.mountToken;
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    if (token !== this.mountToken) {
      return;
    }
    this.addons = (Array.isArray(addons) ? addons : []).map((addon) => ({
      url: String(addon?.url || addon?.baseUrl || "").trim(),
      name: String(addon?.displayName || addon?.name || addon?.url || "").trim(),
      version: String(addon?.version || "").trim()
    }));
  },

  async render() {
    if (Router.getCurrent() !== "addonOrder") {
      return;
    }
    const movingKey = this.reorderSession?.movingKey || "";
    const rows = this.addons
      .map((addon, index) => {
        const isMoving = movingKey === addon.url;
        const locked = Boolean(movingKey) && !isMoving;
        if (!isMoving && this.focusIndex === index && movingKey) {
          this.focusIndex = this.addons.findIndex((entry) => entry.url === movingKey);
        }
        return `<article class="addon-order-card${isMoving ? " is-moving" : ""}">
          <div class="addon-order-copy">
            <h2>${escapeHtml(addon.name)}</h2>
            ${addon.version ? `<p>${escapeHtml(`v${addon.version}`)}</p>` : ""}
          </div>
          ${
            locked
              ? ""
              : `<button type="button"
                    class="catalog-order-action catalog-order-reorder addon-order-focusable"
                    data-index="${index}" data-url="${escapeHtml(addon.url)}"
                    data-action="${isMoving ? "done" : "reorder"}"
                    tabindex="-1">
                  <span class="material-icons" aria-hidden="true">${isMoving ? "check" : "reorder"}</span>
                  ${isMoving ? `<span class="catalog-order-done-label">${escapeHtml(t("collections_done", "Done"))}</span>` : ""}
                </button>`
          }
        </article>`;
      })
      .join("");

    this.container.innerHTML = `
      <div class="catalog-order-shell">
        <main class="catalog-order-main">
          <h1 class="catalog-order-title">${escapeHtml(t("addon_order_title", "Add-on order"))}</h1>
          <p class="catalog-order-subtitle">${escapeHtml(
            t("addon_order_subtitle", "Controls which add-on is asked for sources first.")
          )}</p>
          <section class="catalog-order-list">
            ${this.addons.length ? rows : `<p class="catalog-order-empty">${escapeHtml(t("addon_order_empty", "No add-ons installed."))}</p>`}
          </section>
        </main>
      </div>
    `;

    this.container.querySelectorAll(".addon-order-focusable").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusIndex = Number(node.dataset.index || 0);
        this.applyFocus();
        await this.activateFocused();
      });
    });
    this.applyFocus();
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="catalog-order-shell">
        <main class="catalog-order-main">
          <h1 class="catalog-order-title">${escapeHtml(t("addon_order_title", "Add-on order"))}</h1>
          <section class="catalog-order-list catalog-order-loading">
            ${renderLoadingIndicator()}
            <span>Loading...</span>
          </section>
        </main>
      </div>
    `;
  },

  applyFocus() {
    this.container
      ?.querySelectorAll(".addon-order-focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const nodes = Array.from(this.container?.querySelectorAll(".addon-order-focusable") || []);
    if (!nodes.length) {
      return;
    }
    this.focusIndex = Math.max(0, Math.min(nodes.length - 1, this.focusIndex));
    const target = nodes[this.focusIndex];
    this.focusIndex = Number(target.dataset.index || this.focusIndex);
    target.classList.add("focused");
    target.focus?.({ preventScroll: true });
    if (this.focusIndex === 0) {
      const scroller = this.container?.querySelector(".catalog-order-main");
      if (scroller) {
        scroller.scrollTop = 0;
        return;
      }
    }
    target.scrollIntoView?.({ block: "nearest" });
  },

  async startReorder(index) {
    if (typeof addonRepository.canEdit === "function" && !addonRepository.canEdit()) {
      return;
    }
    const addon = this.addons[index];
    if (!addon || isReordering(this.reorderSession)) {
      return;
    }
    this.reorderSession = createReorderSession({ keys: this.addons.map((entry) => entry.url) });
    if (!beginReorder(this.reorderSession, addon.url)) {
      this.reorderSession = null;
      return;
    }
    this.focusIndex = index;
    await this.render();
  },

  async moveReorder(delta) {
    if (!moveReorderBy(this.reorderSession, delta)) {
      return;
    }
    this.applyReorderOrder();
    this.focusIndex = this.reorderSession.keys.indexOf(this.reorderSession.movingKey);
    await this.render();
  },

  applyReorderOrder() {
    const byUrl = new Map(this.addons.map((addon) => [addon.url, addon]));
    this.addons = (this.reorderSession?.keys || []).map((url) => byUrl.get(url)).filter(Boolean);
  },

  async finishReorder() {
    if (!isReordering(this.reorderSession) || this.isSavingOrder) {
      return;
    }
    const token = this.mountToken;
    const keys = confirmReorder(this.reorderSession);
    // Rows missing from this screen (disabled or unreachable add-ons) keep their slot:
    // setAddonOrder replaces the installed list with whatever it receives.
    const visibleKeys = new Set(keys.map((url) => addonRepository.normalizeUrl(url)));
    const mergedKeys = [...addonRepository.getInstalledAddonUrls()];
    let next = 0;
    mergedKeys.forEach((url, index) => {
      if (!visibleKeys.has(addonRepository.normalizeUrl(url))) {
        return;
      }
      mergedKeys[index] = keys[next];
      next += 1;
    });
    for (; next < keys.length; next += 1) {
      mergedKeys.push(keys[next]);
    }
    this.reorderSession = null;
    this.isSavingOrder = true;
    try {
      await addonRepository.setAddonOrder(mergedKeys, { silent: false });
      if (token !== this.mountToken) {
        return;
      }
      await this.loadAddons();
      if (token !== this.mountToken) {
        return;
      }
      await this.render();
    } finally {
      if (token === this.mountToken) {
        this.isSavingOrder = false;
      }
    }
  },

  async cancelReorderState() {
    if (!isReordering(this.reorderSession)) {
      return false;
    }
    const movingKey = this.reorderSession.movingKey;
    cancelReorder(this.reorderSession);
    this.applyReorderOrder();
    this.reorderSession = null;
    const restoredIndex = this.addons.findIndex((entry) => entry.url === movingKey);
    if (restoredIndex >= 0) {
      this.focusIndex = restoredIndex;
    }
    await this.render();
    return true;
  },

  async activateFocused() {
    const node = this.container?.querySelector(".addon-order-focusable.focused");
    if (!node) {
      return;
    }
    if (String(node.dataset.action || "") === "reorder") {
      await this.startReorder(Number(node.dataset.index || 0));
    } else {
      await this.finishReorder();
    }
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (this.isSavingOrder) {
      if (code === 13 || code === 37 || code === 38 || code === 39 || code === 40) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
      }
      return;
    }
    if (isReordering(this.reorderSession)) {
      if (code === 38 || code === 40) {
        event?.preventDefault?.();
        await this.moveReorder(code === 38 ? -1 : 1);
        return;
      }
      if (code === 37 || code === 39) {
        event?.preventDefault?.();
        return;
      }
      if (code === 13) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (event?.repeat) {
          return;
        }
        await this.finishReorder();
        return;
      }
    }
    if (code === 38 || code === 40) {
      event?.preventDefault?.();
      this.focusIndex += code === 38 ? -1 : 1;
      this.applyFocus();
      return;
    }
    if (code === 13) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (event?.repeat) {
        return;
      }
      await this.activateFocused();
    }
  },

  consumeBackRequest() {
    if (isReordering(this.reorderSession)) {
      void this.cancelReorderState();
      return true;
    }
    return false;
  },

  cleanup() {
    this.mountToken = (this.mountToken || 0) + 1;
    this.isSavingOrder = false;
    this.reorderSession = null;
    ScreenUtils.hide(this.container);
  }
};
