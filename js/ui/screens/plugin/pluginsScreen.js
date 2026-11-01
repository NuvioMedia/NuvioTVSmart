import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { StartupSyncService } from "../../../core/profile/startupSyncService.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import {
  isExternalDexRepository,
  isVideoEasyScraper,
  PLUGIN_REPOSITORY_TYPES
} from "../../../core/player/pluginModels.js";

import { createPluginsScreenMethods01 } from "./pluginsScreenMethods-01-mount.js";
import { createPluginsScreenMethods02 } from "./pluginsScreenMethods-02-provider-rows.js";
import { createPluginsScreenMethods04 } from "./pluginsScreenMethods-04-refresh-repository.js";

export {
  ScreenUtils,
  Router,
  Platform,
  I18n,
  PluginManager,
  ProfileManager,
  StartupSyncService,
  renderLoadingIndicator,
  isExternalDexRepository,
  isVideoEasyScraper,
  PLUGIN_REPOSITORY_TYPES,
  t,
  escapeHtml,
  dateLabel,
  repositoryTypeLabel,
  button,
  toggleButton,
  toggleIndicator,
  providerTypeBadge,
  runtimeNotice
};
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateLabel(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleString(I18n.getLocale());
  } catch (_) {
    return "";
  }
}

function repositoryTypeLabel(type) {
  if (type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS) {
    return t("plugin_type_nuvio_js", {}, "Nuvio JS · executable");
  }
  if (type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX) {
    return t("plugin_type_external_dex", {}, "CloudStream DEX · metadata only");
  }
  if (type === PLUGIN_REPOSITORY_TYPES.LEGACY) {
    return t("plugin_type_legacy", {}, "Legacy URL template · preserved only");
  }
  return t("plugin_type_unknown", {}, "Unknown type · disabled");
}

function button({
  focusKey,
  action,
  label,
  icon = "",
  disabled = false,
  destructive = false,
  variant = "surface",
  focusableWhileBusy = false,
  loading = false
}) {
  const nativeDisabled = disabled && !focusableWhileBusy;
  return `
    <button class="plugins-action plugins-focusable focusable${variant === "primary" ? " is-primary" : ""}${destructive ? " is-destructive" : ""}${disabled ? " is-disabled" : ""}"
            data-focus-key="${escapeHtml(focusKey)}"
            data-action="${escapeHtml(action)}"
            aria-disabled="${disabled ? "true" : "false"}"
            ${nativeDisabled ? "disabled" : ""}>
      ${loading ? renderLoadingIndicator({ className: "plugins-action-loading-spinner" }) : icon ? `<span class="material-icons" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function toggleButton({ focusKey, action, checked, disabled = false, focusableWhileBusy = false }) {
  const nativeDisabled = disabled && !focusableWhileBusy;
  return `
    <button class="plugins-toggle plugins-focusable focusable${disabled ? " is-disabled" : ""}"
            data-focus-key="${escapeHtml(focusKey)}"
            data-action="${escapeHtml(action)}"
            aria-pressed="${checked ? "true" : "false"}"
            aria-disabled="${disabled ? "true" : "false"}"
            ${nativeDisabled ? "disabled" : ""}>
      <span class="plugins-toggle-pill${checked ? " is-checked" : ""}"><span></span></span>
    </button>
  `;
}

function toggleIndicator({ checked }) {
  return `
    <span class="plugins-toggle plugins-toggle-indicator" aria-hidden="true">
      <span class="plugins-toggle-pill${checked ? " is-checked" : ""}"><span></span></span>
    </span>
  `;
}

function providerTypeBadge(type) {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  const colorClass =
    normalized === "movie"
      ? "is-movie"
      : ["series", "show", "tv"].includes(normalized)
        ? "is-tv"
        : "is-neutral";
  return `<span class="plugins-type-badge ${colorClass}">${escapeHtml(normalized.toUpperCase())}</span>`;
}

function runtimeNotice(model) {
  const runtime = model?.runtime || {};
  if (runtime.supportLevel === "unsupported") {
    return `
      <section class="plugins-runtime-card is-warning is-unsupported" role="status">
        <span class="plugins-runtime-icon material-icons" aria-hidden="true">error_outline</span>
        <div class="plugins-runtime-copy">
          <strong>${escapeHtml(t("plugin_runtime_heading", {}, "TV plugin runtime"))}</strong>
          <span>${escapeHtml(t("plugin_runtime_unsupported", {}, "Execution unavailable on this TV runtime"))}</span>
        </div>
      </section>
    `;
  }
  if (runtime.supportLevel === "limited" && runtime.executable === true) {
    return `
      <section class="plugins-runtime-card is-warning is-limited" role="status">
        <span class="plugins-runtime-icon material-icons" aria-hidden="true">info_outline</span>
        <div class="plugins-runtime-copy">
          <strong>${escapeHtml(t("plugin_runtime_heading", {}, "TV plugin runtime"))}</strong>
          <span>${escapeHtml(t("plugin_runtime_limited", {}, "Plugin support is limited on this TV. Some providers may be slower or unavailable."))}</span>
        </div>
      </section>
    `;
  }
  return "";
}

export const PluginsScreen = {
  ...createPluginsScreenMethods01(),
  ...createPluginsScreenMethods02(),
  ensureStartupSyncSubscription() {
    if (this.unsubscribeStartupSyncPullCompleted) {
      return;
    }
    // Android's PluginViewModel observes the local plugin state; entering the
    // screen does not start another remote pull. Re-render when the
    // Android-aligned startup/warm pull has reconciled that local state.
    this.unsubscribeStartupSyncPullCompleted = StartupSyncService.subscribeToPullCompleted(
      ({ profileId } = {}) => {
        if (Router.getCurrent() !== "plugins" || this.busy || this.hasActiveTextInput()) {
          return;
        }
        const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
        if (profileId && String(profileId) !== activeProfileId) {
          return;
        }
        this.render();
      }
    );
  },
  hasActiveTextInput() {
    const active = document.activeElement;
    return Boolean(
      active && this.container?.contains?.(active) && active.matches?.("input, textarea")
    );
  },
  setStatus(message = "", kind = "") {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = 0;
    }
    this.statusMessage = String(message || "");
    this.statusKind = kind;
    const duration = kind === "success" ? 3000 : kind === "error" ? 5000 : 0;
    if (this.statusMessage && duration) {
      const messageSnapshot = this.statusMessage;
      const kindSnapshot = this.statusKind;
      this.statusTimer = setTimeout(() => {
        this.statusTimer = 0;
        if (this.statusMessage !== messageSnapshot || this.statusKind !== kindSnapshot) return;
        this.statusMessage = "";
        this.statusKind = "";
        if (this.container && !this.container.hidden) this.render();
      }, duration);
    }
  },
  render() {
    this.model = PluginManager.getSummary();
    const model = this.model;
    const enterClass = this.routeEnterPending ? " nuvio-route-fade-enter" : "";
    const repositories = Array.isArray(model.repositories) ? model.repositories : [];
    this.container.innerHTML = `
        <div class="plugins-route-shell">
          <div class="plugins-route-content${enterClass}">
            <main class="plugins-main">
              <div class="plugins-panel">
                ${runtimeNotice(model)}

                ${
                  model.readOnly
                    ? `<section class="plugins-readonly-card">
                  <span class="plugins-readonly-icon material-icons" aria-hidden="true">lock</span>
                  <span>${escapeHtml(t("plugin_readonly_notice", {}, "Using primary profile's plugins; changes are disabled"))}</span>
                </section>`
                    : ""
                }

                ${
                  model.readOnly
                    ? ""
                    : `<section class="plugins-settings-card">
                  <div class="plugins-section-heading">
                    <div>
                      <h2>${escapeHtml(t("plugin_add_repository", {}, "Add repository"))}</h2>
                    </div>
                  </div>
                  <div class="plugins-add-row">
                    <input class="plugins-repository-input plugins-focusable focusable"
                           data-focus-key="add:input"
                           data-action="repository-input"
                           type="text"
                           autocomplete="off"
                           autocapitalize="none"
                           spellcheck="false"
                           placeholder="${escapeHtml(t("plugin_url_or_short_code_placeholder", {}, "URL or short code"))}"
                           value="${escapeHtml(this.addDraft)}" />
                    ${button({
                      focusKey: "add:submit",
                      action: "add-repository",
                      label: t("plugin_add_btn", {}, "Add"),
                      icon: "add",
                      variant: "primary",
                      disabled: this.busy,
                      loading: this.busyAction === "add-repository"
                    })}
                  </div>
                  ${this.statusMessage && !["success", "error"].includes(this.statusKind) ? `<p class="plugins-status-message">${escapeHtml(this.statusMessage)}</p>` : ""}
                </section>`
                }

                <section class="plugins-settings-card plugins-setting-card plugins-focusable focusable"
                         data-focus-key="global:enabled"
                         data-action="toggle-global"
                         tabindex="0"
                         aria-pressed="${model.pluginsEnabled ? "true" : "false"}"
                         aria-disabled="${this.busy || model.readOnly ? "true" : "false"}">
                  <div class="plugins-setting-row">
                    <div><strong>${escapeHtml(t("plugin_enable_plugins_title", {}, "Enable plugin providers globally"))}</strong><span>${escapeHtml(t("plugin_enable_plugins_subtitle", {}, "Use plugin providers during stream discovery"))}</span></div>
                    ${toggleIndicator({ checked: model.pluginsEnabled })}
                  </div>
                </section>

                <section class="plugins-settings-card plugins-setting-card plugins-focusable focusable"
                         data-focus-key="global:group"
                         data-action="toggle-group"
                         tabindex="0"
                         aria-pressed="${model.groupStreamsByRepository ? "true" : "false"}"
                         aria-disabled="${this.busy || model.readOnly ? "true" : "false"}">
                  <div class="plugins-setting-row">
                    <div><strong>${escapeHtml(t("plugin_group_by_repository_title", {}, "Group plugin providers by repository"))}</strong><span>${escapeHtml(t("plugin_group_by_repository_subtitle", {}, "In Streams, show one provider per repository instead of one per source"))}</span></div>
                    ${toggleIndicator({ checked: model.groupStreamsByRepository })}
                  </div>
                </section>

                <section class="plugins-section-label">
                  <h2>${escapeHtml(t("plugin_repositories_section", { count: repositories.length }, `Repositories (${repositories.length})`))}</h2>
                </section>

                ${repositories.length ? `<section class="plugins-repository-list">${repositories.map((repository) => this.repositoryCard(repository, model)).join("")}</section>` : `<section class="plugins-empty-card"><p>${escapeHtml(t("plugin_no_repos", {}, "No repositories added yet. Add a repository to get started."))}</section>`}

                ${this.providerSection(model)}
              </div>
            </main>
          </div>
          ${
            this.statusMessage && ["success", "error"].includes(this.statusKind)
              ? `<div class="plugins-message-overlay ${escapeHtml(this.statusKind)}" role="status" aria-live="polite">
            <span class="material-icons" aria-hidden="true">${this.statusKind === "success" ? "check_circle" : "error"}</span>
            <span>${escapeHtml(this.statusMessage)}</span>
          </div>`
              : ""
          }
          ${
            this.pendingScraperEnable
              ? `<div class="plugins-confirm-backdrop">
            <section class="plugins-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="plugins-risky-title">
              <h2 id="plugins-risky-title">${escapeHtml(t("plugin_risky_enable_title", {}, "Enable provider?"))}</h2>
              <p>${escapeHtml(t("plugin_risky_enable_message", { name: this.pendingScraperEnable.scraperName }, `${this.pendingScraperEnable.scraperName} is known to cause crashes on some content. Enable anyway?`))}</p>
              <div class="plugins-confirm-actions">
                ${button({ focusKey: "risky:cancel", action: "dismiss-risky-scraper", label: t("plugin_risky_enable_cancel", {}, "Cancel") })}
                ${button({ focusKey: "risky:confirm", action: "confirm-risky-scraper", label: t("plugin_risky_enable_confirm", {}, "Enable") })}
              </div>
            </section>
          </div>`
              : ""
          }
        </div>
      `;
    this.routeEnterPending = false;
    ScreenUtils.indexFocusables(this.container, ".plugins-focusable");
    this.applyFocus();
  },
  rememberFocusedTarget(target = null) {
    const focused = target || this.container?.querySelector?.(".plugins-focusable.focused");
    if (!focused || !this.container?.contains?.(focused)) return null;
    this.focusKey = String(focused.dataset.focusKey || this.focusKey || "");
    return focused;
  },
  ensureMainVisibility(target) {
    const container = this.container?.querySelector?.(".plugins-main");
    if (!container || !target || target.closest?.(".plugins-confirm-dialog")) return;
    const providerRow = target.closest?.(".plugins-provider-row");
    const testResult =
      target.dataset?.action?.startsWith("test-scraper:") &&
      providerRow?.nextElementSibling?.classList?.contains("plugins-test-result")
        ? providerRow.nextElementSibling
        : null;
    const anchor =
      testResult ||
      target.closest?.(
        ".plugins-provider-row, .plugins-test-result, .plugins-repository-card, .plugins-settings-card, .plugins-section-label"
      ) ||
      target;
    const pad = 56;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorTop = anchorRect.top - containerRect.top + container.scrollTop;
    const anchorBottom = anchorRect.bottom - containerRect.top + container.scrollTop;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

    if (anchorBottom > viewBottom - pad) {
      container.scrollTop = Math.min(
        maxScrollTop,
        Math.max(0, anchorBottom - container.clientHeight + pad)
      );
    } else if (anchorTop < viewTop + pad) {
      container.scrollTop = Math.max(0, anchorTop - pad);
    }
  },
  applyFocus() {
    const focusables = Array.from(this.container?.querySelectorAll?.(".plugins-focusable") || []);
    focusables.forEach((node) => node.classList.remove("focused"));
    const enabledFocusables = focusables.filter((node) => !node.disabled);
    const nonTextFocusables = enabledFocusables.filter(
      (node) => !node.matches?.("input, textarea")
    );
    if (!enabledFocusables.length) return;
    const target =
      enabledFocusables.find((node) => node.dataset.focusKey === this.focusKey) ||
      nonTextFocusables[0] ||
      enabledFocusables[0];
    if (!target) return;
    target.classList.add("focused");
    this.rememberFocusedTarget(target);
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    this.ensureMainVisibility(target);
  },
  moveFocusWithinHorizontalRow(direction) {
    const current = this.container?.querySelector?.(".plugins-focusable:not([disabled]).focused");
    const row = current?.closest?.(
      ".plugins-add-row, .plugins-repository-actions, .plugins-provider-actions"
    );
    if (!current || !row) return false;

    const rowFocusables = Array.from(
      row.querySelectorAll(".plugins-focusable:not([disabled])")
    ).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const currentIndex = rowFocusables.indexOf(current);
    if (currentIndex < 0) return false;

    const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
    const next = rowFocusables[nextIndex];
    if (!next) return true;

    current.classList.remove("focused");
    next.classList.add("focused");
    this.rememberFocusedTarget(next);
    try {
      next.focus({ preventScroll: true });
    } catch (_) {
      next.focus();
    }
    this.ensureMainVisibility(next);
    return true;
  },
  async activateTarget(target) {
    const action = String(target?.dataset?.action || "");
    if (
      !action ||
      action === "repository-input" ||
      this.busy ||
      target?.disabled ||
      target?.getAttribute?.("aria-disabled") === "true"
    ) {
      return;
    }
    if (action === "dismiss-risky-scraper") {
      this.pendingScraperEnable = null;
      this.render();
      return;
    }
    if (action === "confirm-risky-scraper") {
      const pending = this.pendingScraperEnable;
      this.pendingScraperEnable = null;
      if (pending?.scraperId) PluginManager.setScraperEnabled(pending.scraperId, true);
      this.render();
      return;
    }
    if (action === "toggle-global") {
      PluginManager.setPluginsEnabled(!this.model.pluginsEnabled);
      this.render();
      return;
    }
    if (action === "toggle-group") {
      PluginManager.setGroupStreamsByRepository(!this.model.groupStreamsByRepository);
      this.render();
      return;
    }
    if (action === "add-repository") {
      await this.addRepository();
      return;
    }
    // Scraper IDs intentionally use `repositoryId:manifestId`, so preserve
    // every segment instead of truncating the ID at its first colon.
    const [kind, ...actionParts] = action.split(":");
    const id = actionParts.join(":");
    if (kind === "toggle-all") {
      const flag = actionParts.pop();
      const repositoryId = actionParts.join(":");
      PluginManager.setAllScrapersEnabled(repositoryId, flag === "1");
      this.render();
      return;
    }
    if (kind === "toggle-scraper") {
      const scraper = this.model.scrapers.find((entry) => entry.id === id);
      if (
        scraper &&
        scraper.enabled === false &&
        isVideoEasyScraper(scraper.id, scraper.name, scraper.filename)
      ) {
        this.pendingScraperEnable = { scraperId: scraper.id, scraperName: scraper.name };
        this.focusKey = "risky:cancel";
        this.render();
        return;
      }
      if (scraper) PluginManager.setScraperEnabled(id, scraper.enabled === false);
      this.render();
      return;
    }
    if (kind === "test-scraper") {
      await this.testScraper(id);
      return;
    }
    if (kind === "toggle-diagnostics") {
      this.diagnosticsProviderId = this.diagnosticsProviderId === id ? null : id;
      this.render();
      return;
    }
    if (kind === "refresh") {
      await this.refreshRepository(id);
      return;
    }
    if (kind === "remove") {
      if (await PluginManager.removeRepository(id)) {
        this.setStatus(t("plugin_repo_removed", {}, "Repository removed."), "success");
      }
      this.render();
    }
  },
  async addRepository() {
    const value = String(this.addDraft || "").trim();
    if (!value || this.busy) {
      this.setStatus(t("plugin_error_invalid_url", {}, "Please enter a valid URL"), "error");
      this.render();
      return;
    }
    // Match Android's add flow: leave the native text input before the
    // asynchronous repository work starts, otherwise Tizen keeps routing D-pad
    // arrows to the still-focused input instead of the page focus graph.
    this.focusKey = "add:submit";
    const operationToken = this.beginBusyAction("add-repository");
    this.setStatus(t("plugin_adding", {}, "Adding repository…"));
    this.render();
    try {
      const repository = await PluginManager.addRepository(value);
      if (!this.isBusyActionActive(operationToken)) return;
      const providerCount = PluginManager.listScrapers(repository.id).length;
      this.addDraft = "";
      this.setStatus(
        t(
          "plugin_repo_added_with_providers",
          { name: repository.name, count: providerCount },
          `Added ${repository.name} with ${providerCount} providers.`
        ),
        "success"
      );
    } catch (error) {
      if (!this.isBusyActionActive(operationToken)) return;
      this.setStatus(
        String(
          error?.message || error || t("plugin_error_add_repo", {}, "Failed to add repository")
        ),
        "error"
      );
    } finally {
      if (this.finishBusyAction(operationToken)) {
        this.render();
      }
    }
  },
  ...createPluginsScreenMethods04()
};
