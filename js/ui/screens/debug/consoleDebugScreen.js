import { I18n } from "../../../i18n/index.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import {
  getConsoleDebugEvents,
  subscribeToConsoleDebugEvents
} from "../../../core/diagnostics/consoleDebugBuffer.js";
import { formatBootTimingSummary } from "../../../core/diagnostics/bootTiming.js";
import { Platform } from "../../../platform/index.js";
import { PluginServiceClient } from "../../../platform/pluginServiceClient.js";
import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatEventTime(timestamp) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function eventCountLabel(count) {
  return t("debug_console_event_count", [count], `${count} events`);
}

function isTizenSubtitleDiagnosticsEnabled() {
  return globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true;
}

function focusNode(node) {
  focusWithoutScroll(node);
}

function scrollIndicatorMarkup() {
  return `
    <span class="debug-console-scroll-indicator debug-console-scroll-indicator-up" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="M7.4 14.6 12 10l4.6 4.6" /></svg>
    </span>
    <span class="debug-console-scroll-indicator debug-console-scroll-indicator-down" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="m7.4 9.4 4.6 4.6 4.6-4.6" /></svg>
    </span>
  `;
}

export const ConsoleDebugScreen = {
  container: null,
  focusKey: "log",
  unsubscribe: null,
  logScrollTop: 0,

  async mount() {
    this.container = document.getElementById("debugConsole");
    ScreenUtils.show(this.container);
    this.focusKey = this.focusKey || "log";
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    if (!this.handleWheelBound) {
      this.handleWheelBound = this.handleWheel.bind(this);
      this.container.addEventListener("wheel", this.handleWheelBound, { passive: false });
      this.container.addEventListener("mousewheel", this.handleWheelBound, { passive: false });
    }
    if (!this.unsubscribe) {
      this.unsubscribe = subscribeToConsoleDebugEvents(() => {
        if (Router.getCurrent() !== "debugConsole") {
          return;
        }
        const list = this.getLogList();
        const maxScroll = list ? Math.max(0, list.scrollHeight - list.clientHeight) : 0;
        const shouldStickToBottom = !list || maxScroll - Number(list.scrollTop || 0) < 96;
        void this.render({ stickToBottom: shouldStickToBottom });
      });
    }
    // The service has its own process console. Pull its bounded, redacted
    // diagnostic ring when the user opens this screen so service-side
    // provider failures are copied into the same Settings console as app-side
    // warnings and errors.
    try {
      await PluginServiceClient.diagnostics();
    } catch (_) {
      // The client already emits a diagnostic for a failed diagnostics request.
    }
    await this.render({ stickToBottom: true });
  },

  cleanup() {
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    if (this.container && this.handleWheelBound) {
      this.container.removeEventListener("wheel", this.handleWheelBound);
      this.container.removeEventListener("mousewheel", this.handleWheelBound);
    }
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    this.unsubscribe = null;
    this.handleClickBound = null;
    this.handleWheelBound = null;
    this.logScrollTop = Number(this.getLogList()?.scrollTop || this.logScrollTop || 0);
    ScreenUtils.hide(this.container);
  },

  getLogList() {
    return this.container?.querySelector?.(".debug-console-log-list") || null;
  },

  renderEvents(events) {
    if (!events.length) {
      return `
        <div class="debug-console-empty">
          <div class="debug-console-empty-icon material-icons" aria-hidden="true">terminal</div>
          <div class="debug-console-empty-title">${escapeHtml(t("debug_console_empty_title", {}, "No warnings or errors"))}</div>
          <p class="debug-console-empty-copy">${escapeHtml(t("debug_console_empty_subtitle", {}, "Console warning/error events will appear here until the app is closed."))}</p>
        </div>
      `;
    }

    return events
      .map((event) => {
        const level = event.level === "error" ? "ERROR" : event.level === "info" ? "INFO" : "WARN";
        const message = event.args?.length ? event.args.join("\n\n") : event.message || "";
        return `
          <article class="debug-console-event debug-console-event-${escapeHtml(event.level)}">
            <header class="debug-console-event-header">
              <span class="debug-console-level">${escapeHtml(level)}</span>
              <span class="debug-console-time">${escapeHtml(formatEventTime(event.timestamp))}</span>
              <span class="debug-console-sequence">#${escapeHtml(event.id)}</span>
            </header>
            <pre class="debug-console-message">${escapeHtml(message)}</pre>
          </article>
        `;
      })
      .join("");
  },

  async render({ stickToBottom = false } = {}) {
    const previousScrollTop = Number(this.getLogList()?.scrollTop || this.logScrollTop || 0);
    const events = getConsoleDebugEvents();
    this.container.innerHTML = `
      <div class="debug-console-shell">
        <header class="debug-console-header">
          <button class="debug-console-back focusable" data-focus-key="back" data-action="back">
            <span class="material-icons" aria-hidden="true">arrow_back</span>
            <span>${escapeHtml(t("auth_qr_back", {}, "Back"))}</span>
          </button>
          <div class="debug-console-heading">
            <h1>${escapeHtml(t("about_debug_console_title", {}, "Console debug"))}</h1>
            <p>${escapeHtml(t("debug_console_subtitle", {}, "Last warnings and errors captured from this app session"))}</p>
            ${
              formatBootTimingSummary()
                ? `<p class="debug-console-boot-timing">${escapeHtml(`Boot timing: ${formatBootTimingSummary()}`)}</p>`
                : ""
            }
            ${
              Platform.isTizen()
                ? `<button class="debug-console-capture focusable" data-focus-key="diagnostics" data-action="toggle-tizen-diagnostics" aria-pressed="${isTizenSubtitleDiagnosticsEnabled() ? "true" : "false"}">
                  <span class="material-icons" aria-hidden="true">${isTizenSubtitleDiagnosticsEnabled() ? "stop_circle" : "play_circle"}</span>
                  <span>${escapeHtml(
                    t(
                      isTizenSubtitleDiagnosticsEnabled()
                        ? "debug_console_tizen_subtitle_capture_stop"
                        : "debug_console_tizen_subtitle_capture_start",
                      {},
                      isTizenSubtitleDiagnosticsEnabled()
                        ? "Stop Tizen subtitle capture"
                        : "Capture Tizen subtitle diagnostics"
                    )
                  )}</span>
                </button>`
                : ""
            }
          </div>
          <div class="debug-console-count">${escapeHtml(eventCountLabel(events.length))}</div>
        </header>
        <section class="debug-console-log-frame">
          ${scrollIndicatorMarkup()}
          <div class="debug-console-scroll-rail" aria-hidden="true">
            <span class="debug-console-scroll-thumb"></span>
          </div>
          <div class="debug-console-log-list focusable" data-focus-key="log" data-action="log" tabindex="0">
            ${this.renderEvents(events)}
          </div>
        </section>
      </div>
    `;

    const list = this.getLogList();
    if (list) {
      if (!this.handleScrollBound) {
        this.handleScrollBound = this.handleScroll.bind(this);
      }
      list.addEventListener("scroll", this.handleScrollBound, { passive: true });
      if (stickToBottom) {
        list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      } else {
        list.scrollTop = previousScrollTop;
      }
      this.logScrollTop = Number(list.scrollTop || 0);
    }

    ScreenUtils.indexFocusables(this.container);
    this.applyFocus();
    this.updateScrollChrome();
  },

  applyFocus() {
    const selector = `[data-focus-key="${this.focusKey || "log"}"]`;
    const target =
      this.container.querySelector(selector) ||
      this.container.querySelector("[data-focus-key='log']") ||
      this.container.querySelector(".focusable");
    this.container
      .querySelectorAll(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    if (target) {
      target.classList.add("focused");
      focusNode(target);
    }
  },

  handleScroll() {
    this.logScrollTop = Number(this.getLogList()?.scrollTop || 0);
    this.updateScrollChrome();
  },

  updateScrollChrome() {
    const list = this.getLogList();
    const frame = this.container?.querySelector?.(".debug-console-log-frame");
    const thumb = this.container?.querySelector?.(".debug-console-scroll-thumb");
    const rail = this.container?.querySelector?.(".debug-console-scroll-rail");
    if (!list || !frame || !thumb || !rail) {
      return;
    }

    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const scrollTop = Number(list.scrollTop || 0);
    frame.classList.toggle("can-scroll-backward", scrollTop > 1);
    frame.classList.toggle("can-scroll-forward", maxScroll > 1 && scrollTop < maxScroll - 1);
    frame.classList.toggle("can-scroll", maxScroll > 1);

    if (maxScroll <= 1) {
      thumb.style.height = "0px";
      thumb.style.transform = "translateY(0)";
      return;
    }

    const railHeight = Math.max(1, rail.clientHeight || 1);
    const thumbHeight = Math.max(
      48,
      Math.round((list.clientHeight / list.scrollHeight) * railHeight)
    );
    const top = Math.round((scrollTop / maxScroll) * Math.max(0, railHeight - thumbHeight));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${top}px)`;
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(".focusable");
    if (!target || !this.container?.contains?.(target)) {
      return;
    }
    event.preventDefault?.();
    this.focusKey = String(target.dataset.focusKey || this.focusKey || "log");
    this.applyFocus();
    if (target.dataset.action === "back") {
      await Router.back();
    } else if (target.dataset.action === "toggle-tizen-diagnostics") {
      this.toggleTizenSubtitleDiagnostics();
    }
  },

  toggleTizenSubtitleDiagnostics() {
    const enabled = !isTizenSubtitleDiagnosticsEnabled();
    globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ = enabled;
    globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY_STARTED_AT__ = enabled ? Date.now() : 0;
    this.focusKey = "diagnostics";
    void this.render({ stickToBottom: enabled });
  },

  scrollLog(direction) {
    const list = this.getLogList();
    if (!list) {
      return;
    }
    const delta = Math.max(160, Math.round((list.clientHeight || 600) * 0.72));
    list.scrollTop = Math.max(
      0,
      Math.min(
        list.scrollHeight - list.clientHeight,
        Number(list.scrollTop || 0) + direction * delta
      )
    );
    this.logScrollTop = Number(list.scrollTop || 0);
    this.updateScrollChrome();
  },

  handleWheel(event) {
    const delta = Number(event?.deltaY || event?.wheelDelta * -1 || 0);
    if (!delta) {
      return;
    }
    event?.preventDefault?.();
    this.focusKey = "log";
    this.applyFocus();
    this.scrollLog(delta < 0 ? -1 : 1);
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    const key = String(event?.key || event?.code || event?.keyName || "").toLowerCase();
    const current = this.container?.querySelector?.(".focusable.focused");

    if (code === 13 || code === 23) {
      event?.preventDefault?.();
      if (current?.dataset?.action === "back") {
        await Router.back();
      } else if (current?.dataset?.action === "toggle-tizen-diagnostics") {
        this.toggleTizenSubtitleDiagnostics();
      }
      return;
    }

    const isUp =
      code === 38 || code === 33 || key === "arrowup" || key === "up" || key === "pageup";
    const isDown =
      code === 40 || code === 34 || key === "arrowdown" || key === "down" || key === "pagedown";
    if (isUp || isDown) {
      event?.preventDefault?.();
      const direction = isUp ? -1 : 1;
      const hasDiagnosticsToggle = Boolean(
        this.container?.querySelector?.('[data-action="toggle-tizen-diagnostics"]')
      );
      if (current?.dataset?.action === "back" && direction > 0) {
        this.focusKey = hasDiagnosticsToggle ? "diagnostics" : "log";
        this.applyFocus();
        return;
      }
      if (current?.dataset?.action === "toggle-tizen-diagnostics") {
        this.focusKey = direction > 0 ? "log" : "back";
        this.applyFocus();
        return;
      }
      if (current?.dataset?.action === "log") {
        const list = this.getLogList();
        const atTop = Number(list?.scrollTop || 0) <= 1;
        if (direction < 0 && atTop) {
          this.focusKey = hasDiagnosticsToggle ? "diagnostics" : "back";
          this.applyFocus();
          return;
        }
        this.scrollLog(direction);
        return;
      }
      this.focusKey = direction > 0 ? "log" : "back";
      this.applyFocus();
    }
  }
};
