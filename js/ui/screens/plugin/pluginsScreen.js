import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import {
  isExternalDexRepository,
  isVideoEasyScraper,
  PLUGIN_REPOSITORY_TYPES
} from "../../../core/player/pluginModels.js";

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
    return new Date(timestamp).toLocaleString();
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

function button({ focusKey, action, label, icon = "", disabled = false, destructive = false }) {
  return `
    <button class="plugins-action plugins-focusable focusable${destructive ? " is-destructive" : ""}${disabled ? " is-disabled" : ""}"
            data-focus-key="${escapeHtml(focusKey)}"
            data-action="${escapeHtml(action)}"
            aria-disabled="${disabled ? "true" : "false"}"
            ${disabled ? "disabled" : ""}>
      ${icon ? `<span class="material-icons" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function toggleButton({ focusKey, action, checked, disabled = false }) {
  return `
    <button class="plugins-toggle plugins-focusable focusable${disabled ? " is-disabled" : ""}"
            data-focus-key="${escapeHtml(focusKey)}"
            data-action="${escapeHtml(action)}"
            aria-pressed="${checked ? "true" : "false"}"
            aria-disabled="${disabled ? "true" : "false"}"
            ${disabled ? "disabled" : ""}>
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

export const PluginsScreen = {
  async mount() {
    this.container = document.getElementById("plugins");
    ScreenUtils.show(this.container);
    this.focusKey = this.focusKey || "add:input";
    this.addDraft = this.addDraft || "";
    this.routeEnterPending = true;
    this.busy = false;
    this.statusMessage = "";
    this.statusKind = "";
    this.statusTimer = 0;
    this.testResult = null;
    this.diagnosticsProviderId = null;
    this.testAbortController = null;
    this.pendingScraperEnable = null;
    this.bindEvents();
    await this.probeRuntime();
    this.render();
  },

  async probeRuntime() {
    try {
      await PluginManager.getRuntimeStatus({ probe: true });
    } catch (error) {
      this.setStatus(String(error?.message || error || ""), "error");
    }
  },

  bindEvents() {
    if (this.eventsBound || !this.container) return;
    this.eventsBound = true;
    this.container.addEventListener("input", (event) => {
      const input = event.target?.closest?.("[data-action='repository-input']");
      if (input) this.addDraft = String(input.value || "");
    });
    this.container.addEventListener("click", (event) => {
      const target = event.target?.closest?.("[data-action]");
      if (!target || !this.container.contains(target) || target.disabled) return;
      event.preventDefault();
      this.focusKey = String(target.dataset.focusKey || this.focusKey || "");
      this.applyFocus();
      void this.activateTarget(target);
    });
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

  editable(model = this.model) {
    return !model?.readOnly && !this.busy;
  },

  visibleProviders(repositoryId, model = this.model) {
    return (model?.scrapers || []).filter(
      (entry) => entry.repositoryId === repositoryId && (!model.readOnly || entry.enabled !== false)
    );
  },

  providerRows(repository, model, { flat = false, providers: providerOverride = null } = {}) {
    const externalDex = isExternalDexRepository(repository);
    const providers = Array.isArray(providerOverride)
      ? providerOverride
      : this.visibleProviders(repository.id, model);
    if (!providers.length) {
      const metadataCount = Array.isArray(repository.metadata?.pluginLists)
        ? repository.metadata.pluginLists.length
        : 0;
      return `<p class="plugins-empty-copy">${escapeHtml(
        externalDex && metadataCount
          ? t(
              "plugin_external_lists_count",
              { count: metadataCount },
              `${metadataCount} external plugin lists synced; binaries are not executed.`
            )
          : t(
              "plugin_no_provider_code",
              {},
              "No executable providers are available from this repository."
            )
      )}</p>`;
    }
    const rows = providers
      .map((provider) => {
        const executable =
          !externalDex &&
          repository.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
          provider.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
        const runtimeUnavailable = executable && model.runtime?.executable !== true;
        const toggleDisabled = !this.editable(model) || !executable || runtimeUnavailable;
        const enabled = executable && provider.enabled !== false;
        const unavailable = executable && provider.codeAvailable === false;
        const testable =
          executable &&
          provider.enabled !== false &&
          !runtimeUnavailable &&
          !unavailable &&
          !this.busy;
        const testResult = this.testResult?.scraperId === provider.id ? this.testResult : null;
        const testStreams = Array.isArray(testResult?.results) ? testResult.results : [];
        const typeBadges = (provider.supportedTypes || []).map(providerTypeBadge).join("");
        const diagnostics = Array.isArray(testResult?.diagnostics?.steps)
          ? testResult.diagnostics.steps
          : [];
        const diagnosticsExpanded = this.diagnosticsProviderId === provider.id;
        return `
          <div class="plugins-provider-row">
            <div class="plugins-provider-copy">
              <div class="plugins-provider-title-row">
                <strong>${escapeHtml(provider.name)}</strong>
                ${typeBadges}
              </div>
              <span class="plugins-provider-version">${escapeHtml(
                t("plugin_version", { version: provider.version }, `Version ${provider.version}`)
              )}</span>
              ${
                unavailable
                  ? `<span>${escapeHtml(
                      t(
                        "plugin_code_unavailable",
                        {},
                        "Code unavailable; the previous cached version is retained if present."
                      )
                    )}</span>`
                  : executable
                    ? ""
                    : `<span>${escapeHtml(
                        t(
                          "plugin_external_metadata_only",
                          {},
                          "Metadata only; never executed on Web TV"
                        )
                      )}</span>`
              }
            </div>
            ${
              executable
                ? `<div class="plugins-provider-actions">
              ${button({
                focusKey: `test:${provider.id}`,
                action: `test-scraper:${provider.id}`,
                label: t("plugin_test_btn", {}, "Test"),
                icon: "play_arrow",
                disabled: !testable
              })}
              ${
                model.readOnly
                  ? ""
                  : toggleButton({
                      focusKey: `scraper:${provider.id}`,
                      action: `toggle-scraper:${provider.id}`,
                      checked: enabled,
                      disabled: toggleDisabled
                    })
              }
            </div>`
                : `<span class="plugins-provider-badge">${escapeHtml(t("plugin_metadata_only", {}, "Metadata only"))}</span>`
            }
          </div>
          ${
            testResult
              ? `<div class="plugins-test-result">
            <strong>${escapeHtml(t("plugin_test_results", { count: testStreams.length }, `Test results (${testStreams.length} streams)`))}</strong>
            ${
              testStreams.length
                ? testStreams
                    .slice(0, 3)
                    .map(
                      (stream) =>
                        `<span>${escapeHtml([stream.title || stream.name || "", stream.quality || ""].filter(Boolean).join(" · "))}</span>`
                    )
                    .join("")
                : `<span>${escapeHtml(t("plugin_test_no_results", {}, "No results found"))}</span>`
            }
            ${
              testStreams.length > 3
                ? `<span>${escapeHtml(
                    t(
                      "plugin_and_more",
                      { count: testStreams.length - 3 },
                      `… and ${testStreams.length - 3} more`
                    )
                  )}</span>`
                : ""
            }
            ${
              diagnostics.length
                ? `<button class="plugins-test-diagnostics-toggle plugins-focusable focusable"
                    data-focus-key="diagnostics:${provider.id}"
                    data-action="toggle-diagnostics:${provider.id}"
                    aria-expanded="${diagnosticsExpanded ? "true" : "false"}">
                    ${escapeHtml(
                      t(
                        diagnosticsExpanded
                          ? "plugin_diagnostics_collapse"
                          : "plugin_diagnostics_expand",
                        {},
                        diagnosticsExpanded
                          ? "Diagnostics (tap to collapse)"
                          : "Diagnostics (tap to expand)"
                      )
                    )}
                  </button>
                  ${
                    diagnosticsExpanded
                      ? `<pre class="plugins-test-diagnostics">${escapeHtml(diagnostics.join("\n"))}</pre>`
                      : ""
                  }`
                : ""
            }
          </div>`
              : ""
          }
        `;
      })
      .join("");
    return flat
      ? rows
      : `
      <div class="plugins-provider-list">
        ${rows}
      </div>
    `;
  },

  providerSection(model) {
    const repositoriesById = new Map(
      (model.repositories || []).map((repository) => [repository.id, repository])
    );
    const providers = (model.scrapers || []).filter(
      (provider) =>
        repositoriesById.has(provider.repositoryId) &&
        (!model.readOnly || provider.enabled !== false)
    );
    if (!providers.length) return "";
    const rows = providers
      .map((provider) =>
        this.providerRows(repositoriesById.get(provider.repositoryId), model, {
          flat: true,
          providers: [provider]
        })
      )
      .join("");
    return `
      <section class="plugins-settings-card plugins-provider-section">
        <div class="plugins-section-heading">
          <div>
            <h2>${escapeHtml(t("plugin_providers_section", { count: providers.length }, `Providers (${providers.length})`))}</h2>
          </div>
        </div>
        <div class="plugins-provider-list plugins-provider-section-list">${rows}</div>
      </section>
    `;
  },

  repositoryCard(repository, model) {
    const providers = this.visibleProviders(repository.id, model);
    const externalDex = isExternalDexRepository(repository);
    const executable = !externalDex && repository.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
    const runtimeUnavailable = executable && model.runtime?.executable !== true;
    const metadataRefreshable = externalDex && !/\.cs3(?:$|[?#])/i.test(repository.url || "");
    const editable = this.editable(model);
    const allEnabled = providers.some(
      (entry) => entry.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS && entry.enabled !== false
    );
    const unavailableCount = providers.filter(
      (entry) => entry.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS && entry.codeAvailable === false
    ).length;
    const providerCount = Math.max(Number(repository.scraperCount) || 0, providers.length);
    const updated = dateLabel(repository.lastUpdated);
    return `
      <article class="plugins-repository-card${executable ? (runtimeUnavailable ? " is-runtime-unavailable" : "") : " is-metadata-only"}">
        <div class="plugins-repository-header">
          <div class="plugins-repository-copy">
            <h2>${escapeHtml(repository.name)}</h2>
            ${
              externalDex
                ? `<p class="plugins-repository-type">${escapeHtml(repositoryTypeLabel(PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX))}</p>`
                : ""
            }
            ${
              runtimeUnavailable
                ? `<p class="plugins-warning">${escapeHtml(t("plugin_tv_model_unsupported", {}, "Plugins are not available on this TV model. Add-ons, playback, library, and sync remain available."))}</p>`
                : ""
            }
            ${
              externalDex
                ? `<p class="plugins-warning">${escapeHtml(t("plugin_dex_unsupported", {}, "CloudStream/DEX plugins are not supported on Web TV."))}</p>`
                : repository.type === PLUGIN_REPOSITORY_TYPES.UNKNOWN
                  ? `<p class="plugins-warning">${escapeHtml(t("plugin_unknown_preserved", {}, "Repository type is unknown; it is preserved and disabled until it can be identified safely."))}</p>`
                  : ""
            }
            <p class="plugins-repository-meta">${escapeHtml(
              executable
                ? t(
                    "plugin_providers_count",
                    { count: providerCount },
                    `${providerCount} providers`
                  )
                : t(
                    "plugin_external_preserved",
                    {},
                    "Synced and preserved without downloading or converting DEX code"
                  )
            )}${updated ? ` · ${escapeHtml(t("plugin_updated_format", { date: updated }, `Updated: ${updated}`))}` : ""}</p>
            ${unavailableCount ? `<p class="plugins-warning">${escapeHtml(t("plugin_unavailable_count", { count: unavailableCount }, `${unavailableCount} provider code item(s) could not be refreshed`))}</p>` : ""}
          </div>
          ${
            model.readOnly
              ? ""
              : `<div class="plugins-repository-actions">
            ${
              executable
                ? button({
                    focusKey: `all:${repository.id}`,
                    action: `toggle-all:${repository.id}:${allEnabled ? "0" : "1"}`,
                    label: allEnabled
                      ? t("plugin_disable_all", {}, "Disable all")
                      : t("plugin_enable_all", {}, "Enable all"),
                    icon: allEnabled ? "visibility_off" : "visibility",
                    disabled: !editable || runtimeUnavailable
                  })
                : ""
            }
            ${
              executable || metadataRefreshable
                ? button({
                    focusKey: `refresh:${repository.id}`,
                    action: `refresh:${repository.id}`,
                    label: t("settings.plugins.refreshRepository", {}, "Refresh repository"),
                    icon: "refresh",
                    disabled: !editable
                  })
                : ""
            }
            ${
              externalDex
                ? ""
                : button({
                    focusKey: `remove:${repository.id}`,
                    action: `remove:${repository.id}`,
                    label: t("settings.plugins.removeRepository", {}, "Remove repository"),
                    icon: "delete",
                    disabled: !editable || repository.type === PLUGIN_REPOSITORY_TYPES.UNKNOWN,
                    destructive: true
                  })
            }
          </div>`
          }
        </div>
      </article>
    `;
  },

  render() {
    this.model = PluginManager.getSummary();
    const model = this.model;
    const enterClass = this.routeEnterPending ? " nuvio-route-slide-enter" : "";
    const repositories = Array.isArray(model.repositories) ? model.repositories : [];
    this.container.innerHTML = `
      <div class="plugins-route-shell">
        <div class="plugins-route-content${enterClass}">
          <header class="plugins-content-header">
            <div>
              <h1 class="plugins-title">${escapeHtml(t("plugin_title", {}, "Plugins"))}</h1>
            </div>
          </header>
          <main class="plugins-main">
            <div class="plugins-panel">
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
                  ${button({ focusKey: "add:submit", action: "add-repository", label: t("plugin_add_btn", {}, "Add"), icon: "add" })}
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

              ${repositories.length ? `<section class="plugins-repository-list">${repositories.map((repository) => this.repositoryCard(repository, model)).join("")}</section>` : `<section class="plugins-settings-card plugins-empty-card"><p>${escapeHtml(t("plugin_no_repos", {}, "No repositories added yet. Add a repository to get started."))}</p></section>`}

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

  applyFocus() {
    const focusables = Array.from(this.container?.querySelectorAll?.(".plugins-focusable") || []);
    focusables.forEach((node) => node.classList.remove("focused"));
    if (!focusables.length) return;
    const target =
      focusables.find((node) => node.dataset.focusKey === this.focusKey && !node.disabled) ||
      focusables.find((node) => !node.disabled) ||
      focusables[0];
    if (!target) return;
    this.focusKey = String(target.dataset.focusKey || this.focusKey || "");
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    try {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (_) {}
  },

  async activateTarget(target) {
    const action = String(target?.dataset?.action || "");
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
    if (!action || action === "repository-input" || this.busy) return;
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
    const [kind, id, flag] = action.split(":");
    if (kind === "toggle-all") {
      PluginManager.setAllScrapersEnabled(id, flag === "1");
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
    this.busy = true;
    this.setStatus(t("plugin_adding", {}, "Adding repository…"));
    this.render();
    try {
      const repository = await PluginManager.addRepository(value);
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
      this.setStatus(
        String(
          error?.message || error || t("plugin_error_add_repo", {}, "Failed to add repository")
        ),
        "error"
      );
    } finally {
      this.busy = false;
      this.render();
    }
  },

  async refreshRepository(repositoryId) {
    if (this.busy) return;
    this.busy = true;
    this.setStatus(t("plugin_refreshing", {}, "Refreshing…"));
    this.render();
    try {
      const result = await PluginManager.refreshRepository(repositoryId);
      this.setStatus(
        result?.ok === false
          ? result.reason
          : t("plugin_repo_refreshed", {}, "Repository refreshed."),
        result?.ok === false ? "error" : "success"
      );
    } catch (error) {
      this.setStatus(
        String(error?.message || error || t("plugin_error_refresh", {}, "Failed to refresh")),
        "error"
      );
    } finally {
      this.busy = false;
      this.render();
    }
  },

  async testScraper(scraperId) {
    if (this.busy) return;
    this.busy = true;
    this.testResult = null;
    this.diagnosticsProviderId = null;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this.testAbortController = controller;
    this.setStatus(t("plugin_test_btn", {}, "Test"));
    this.render();
    try {
      const result = await PluginManager.testScraper(scraperId, {
        signal: controller?.signal || null
      });
      this.testResult = { scraperId, ...result };
      const count = Array.isArray(result?.results) ? result.results.length : 0;
      this.setStatus(
        count
          ? t("plugin_test_results", { count }, `Test results (${count} streams)`)
          : t("plugin_test_no_results", {}, "No results found"),
        count ? "success" : ""
      );
    } catch (error) {
      this.testResult = null;
      this.setStatus(
        t(
          "plugin_error_test",
          { message: String(error?.message || error || "") },
          `Test failed: ${String(error?.message || error || "")}`
        ),
        "error"
      );
    } finally {
      if (this.testAbortController === controller) this.testAbortController = null;
      this.busy = false;
      this.render();
    }
  },

  async onKeyDown(event) {
    if (this.pendingScraperEnable) {
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        this.pendingScraperEnable = null;
        this.render();
        return;
      }
      const code = Number(event?.keyCode || 0);
      if (code === 13) {
        event?.preventDefault?.();
        const current = this.container?.querySelector?.(
          ".plugins-confirm-dialog .plugins-focusable.focused"
        );
        if (current) await this.activateTarget(current);
        return;
      }
      if ([37, 39].includes(code)) {
        event?.preventDefault?.();
        ScreenUtils.handleDpadNavigation(
          event,
          this.container,
          ".plugins-confirm-dialog .plugins-focusable"
        );
      }
      return;
    }
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }
    const code = Number(event?.keyCode || 0);
    if (code === 13) {
      event?.preventDefault?.();
      const current = this.container?.querySelector?.(".plugins-focusable.focused");
      if (current) await this.activateTarget(current);
      return;
    }
    if (event?.target?.matches?.("input") && (code === 37 || code === 39)) {
      return;
    }
    if ([38, 40, 37, 39].includes(code)) {
      ScreenUtils.handleDpadNavigation(event, this.container, ".plugins-focusable");
    }
  },

  consumeBackRequest() {
    if (this.pendingScraperEnable) {
      this.pendingScraperEnable = null;
      this.render();
      return true;
    }
    return false;
  },

  cleanup() {
    this.routeEnterPending = false;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = 0;
    this.testAbortController?.abort?.();
    this.testAbortController = null;
    this.busy = false;
    this.testResult = null;
    this.diagnosticsProviderId = null;
    this.pendingScraperEnable = null;
    ScreenUtils.hide(this.container);
  }
};
