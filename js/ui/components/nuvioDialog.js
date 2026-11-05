/**
 * NuvioDialog — reusable dialog component matching ATV NuvioDialog.kt
 *
 * ATV source: ui/components/NuvioDialog.kt
 *
 * Specs (all dp→vw at 320dpi, 1920px screen = 960dp wide):
 *   Default width:    520dp = 54.2vw  (520/960)
 *   Options width:    360dp = 37.5vw  (360/960)
 *   Delete width:     420dp = 43.75vw (420/960)
 *   Corner radius:    16dp  = 32px
 *   Padding:          24dp  = 48px
 *   Border:           1dp   = 2px, color #333333
 *   Background:       #1A1A1A (BackgroundElevated)
 *   Scrim:            rgba(0,0,0,0.72)
 *   Column gap:       16dp  = 32px
 *   Title:            titleLarge → 20sp=40px, Medium(500), TextPrimary=#FFFFFF
 *   Subtitle:         bodyMedium → 14sp=28px, Normal(400), TextSecondary=#B3B3B3
 *
 * Enter: fadeIn(200ms) + scale(0.92→1.0, 280ms, FastOutSlowIn)
 * Exit:  fadeOut(150ms) + scale(1.0→0.94, 150ms, ease-in)
 *
 * Button specs (ATV TV Material3 Button defaults):
 *   Shape:              pill (border-radius: 999px)
 *   Padding:            16dp v, 20dp h = 32px / 40px
 *   Unfocused bg:       #242424 (BackgroundCard), text #FFFFFF
 *   Focused bg:         #F5F5F5 (Secondary), text #111111
 *   Danger unfocused:   #4A2323, text #FFFFFF
 *   Danger focused:     #FF5252, text #FFFFFF
 *   Transition:         200ms cubic-bezier(0.22,1,0.36,1)
 *
 * Usage:
 *   const dialog = new NuvioDialog({
 *     title: 'Profile Options',
 *     widthVw: 37.5,       // vw, optional (default 54.2vw = 520dp)
 *     subtitle: '...',     // optional
 *     onDismiss: () => {}, // called on backdrop click or Escape
 *     buttons: [
 *       { label: 'Edit',    key: 'edit',   onAction: () => {} },
 *       { label: 'Delete',  key: 'delete', danger: true, onAction: () => {} },
 *     ]
 *   });
 *   dialog.mount(document.body);   // appends backdrop+dialog to element
 *   dialog.destroy();              // animated exit then removes from DOM
 */

export class NuvioDialog {
  constructor({
    title,
    subtitle = null,
    error = null,
    widthVw = 54.2,
    buttons = [],
    onDismiss = null,
    panelClassName = "",
    actionsClassName = "",
    content = null,
    onVerticalNavigate = null,
    onKey = null,
    suppressEnterUntilKeyUp = false
  }) {
    this.title = title;
    this.subtitle = subtitle;
    this.error = error;
    this.widthVw = widthVw;
    this.buttons = buttons;
    this.onDismiss = onDismiss;
    this.panelClassName = panelClassName;
    this.actionsClassName = actionsClassName;
    this.content = content;
    this.onVerticalNavigate = onVerticalNavigate;
    this.onKey = onKey;
    this.suppressEnterUntilKeyUp = Boolean(suppressEnterUntilKeyUp);

    this._focusedIndex = 0;
    this._destroyed = false;
    this._backdrop = null;
    this._panel = null;
    this._buttonEls = [];
    this._enterSuppressed = this.suppressEnterUntilKeyUp;
    this._keyHandler = this._onKey.bind(this);
    this._keyUpHandler = this._onKeyUp.bind(this);
  }

  _scheduleFrame(callback) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 0);
  }

  _eventKey(e) {
    const key = String(e?.key || "");
    const keyName = String(e?.keyName || e?.detail?.keyName || "");
    const code = String(e?.code || "");
    const keyCode = Number(e?.keyCode || e?.which || 0);
    const normalized = (key || keyName || code).toLowerCase();
    return {
      isBack:
        keyCode === 8 ||
        keyCode === 27 ||
        keyCode === 461 ||
        keyCode === 10009 ||
        ["escape", "esc", "backspace", "goback", "back", "return"].includes(normalized),
      isDown: keyCode === 40 || normalized === "arrowdown" || normalized === "down",
      isRight: keyCode === 39 || normalized === "arrowright" || normalized === "right",
      isUp: keyCode === 38 || normalized === "arrowup" || normalized === "up",
      isLeft: keyCode === 37 || normalized === "arrowleft" || normalized === "left",
      isEnter: keyCode === 13 || normalized === "enter" || normalized === "ok",
      isSpace: keyCode === 32 || normalized === " "
    };
  }

  mount(container = document.body) {
    this._ambientHandler = () => this._dismiss();
    document.addEventListener("nuvio:ambient-shown", this._ambientHandler);
    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "nuvio-dialog-backdrop";
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("role", "dialog");

    // Panel
    const panel = document.createElement("div");
    panel.className = `nuvio-dialog-panel${this.panelClassName ? ` ${this.panelClassName}` : ""}`;
    panel.style.maxWidth = `${this.widthVw}vw`;

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "nuvio-dialog-title";
    titleEl.textContent = this.title;
    panel.appendChild(titleEl);

    // Optional subtitle
    if (this.subtitle) {
      const subtitleEl = document.createElement("div");
      subtitleEl.className = "nuvio-dialog-subtitle";
      subtitleEl.textContent = this.subtitle;
      panel.appendChild(subtitleEl);
    }

    if (this.error) {
      const errorEl = document.createElement("div");
      errorEl.className = "nuvio-dialog-error";
      errorEl.textContent = this.error;
      panel.appendChild(errorEl);
    }

    if (this.content) {
      const content = typeof this.content === "function" ? this.content(panel) : this.content;
      if (content) {
        panel.appendChild(content);
      }
    }

    // Buttons
    if (this.buttons.length > 0) {
      const actions = document.createElement("div");
      actions.className = `nuvio-dialog-actions${this.actionsClassName ? ` ${this.actionsClassName}` : ""}`;

      this.buttons.forEach((btn, i) => {
        const el = document.createElement("button");
        el.className =
          "nuvio-dialog-button" +
          (btn.danger ? " nuvio-dialog-button-danger" : "") +
          (btn.selected ? " selected" : "") +
          (btn.className ? ` ${btn.className}` : "");
        this._setButtonSelected(el, Boolean(btn.selected));
        const label = document.createElement("span");
        label.className = "nuvio-dialog-button-label";
        label.textContent = btn.label;
        el.appendChild(label);
        el.dataset.key = btn.key || String(i);
        el.addEventListener("click", () => {
          if (btn.onAction) btn.onAction();
        });
        actions.appendChild(el);
        this._buttonEls.push(el);
      });

      panel.appendChild(actions);
    }

    backdrop.appendChild(panel);
    container.appendChild(backdrop);
    document.body?.classList?.add("nuvio-modal-open");

    this._backdrop = backdrop;
    this._panel = panel;

    // Dismiss on backdrop click (outside panel)
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this._dismiss();
    });

    // Keyboard navigation
    window.addEventListener("keydown", this._keyHandler, { capture: true });
    window.addEventListener("keyup", this._keyUpHandler, { capture: true });

    // Focus first button after 2 frames (matches ATV LaunchedEffect repeat(2) { withFrameNanos })
    this._scheduleFrame(() => this._scheduleFrame(() => this._focusIndex(0)));

    // Trigger enter animation
    this._scheduleFrame(() => {
      backdrop.classList.add("nuvio-dialog-backdrop-enter");
      panel.classList.add("nuvio-dialog-panel-enter");
    });

    return this;
  }

  setButtonSelected(key, selected) {
    const normalizedKey = String(key || "");
    const el = this._buttonEls.find((button) => button.dataset.key === normalizedKey);
    if (!el) return false;
    this._setButtonSelected(el, Boolean(selected));
    return true;
  }

  _createCheckElement() {
    const check = document.createElement("span");
    check.className = "nuvio-dialog-button-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML =
      '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"></path></svg>';
    return check;
  }

  _setButtonSelected(el, selected) {
    el.classList.toggle("selected", selected);
    let existing = null;
    for (let index = 0; index < el.children.length; index += 1) {
      const child = el.children[index];
      if (child && child.classList && child.classList.contains("nuvio-dialog-button-check")) {
        existing = child;
        break;
      }
    }
    if (selected && !existing) {
      const check = this._createCheckElement();
      if (el.firstChild) {
        el.insertBefore(check, el.firstChild);
      } else {
        el.appendChild(check);
      }
    } else if (!selected && existing) {
      if (existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }
  }

  _focusIndex(i) {
    if (this._buttonEls.length === 0) return;
    const clamped = Math.max(0, Math.min(i, this._buttonEls.length - 1));
    this._focusedIndex = clamped;
    this._buttonEls.forEach((el, idx) => {
      el.classList.toggle("focused", idx === clamped);
    });
    this._buttonEls[clamped]?.focus({ preventScroll: true });
  }

  _onKey(e) {
    if (this._destroyed) return;
    const key = this._eventKey(e);

    if (key.isBack) {
      e.preventDefault();
      e.stopPropagation();
      this._dismiss();
      return;
    }

    if (typeof this.onKey === "function" && this.onKey(key) === true) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (key.isDown || key.isRight) {
      if (
        key.isDown &&
        typeof this.onVerticalNavigate === "function" &&
        this.onVerticalNavigate(1) === true
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._focusIndex(this._focusedIndex + 1);
      return;
    }

    if (key.isUp || key.isLeft) {
      if (
        key.isUp &&
        typeof this.onVerticalNavigate === "function" &&
        this.onVerticalNavigate(-1) === true
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._focusIndex(this._focusedIndex - 1);
      return;
    }

    if (key.isEnter || key.isSpace) {
      e.preventDefault();
      e.stopPropagation();
      if (this._enterSuppressed) {
        return;
      }
      const btn = this.buttons[this._focusedIndex];
      if (btn?.onAction) btn.onAction();
      return;
    }
  }

  _onKeyUp(e) {
    if (this._destroyed) return;
    const key = this._eventKey(e);
    if (key.isEnter || key.isSpace) {
      this._enterSuppressed = false;
      if (this.suppressEnterUntilKeyUp) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  _dismiss() {
    if (this._destroyed) return;
    if (this.onDismiss) this.onDismiss();
    this.destroy();
  }

  destroy({ afterExit = null } = {}) {
    if (this._destroyed) return;
    this._destroyed = true;
    document.removeEventListener("nuvio:ambient-shown", this._ambientHandler);
    window.removeEventListener("keydown", this._keyHandler, { capture: true });
    window.removeEventListener("keyup", this._keyUpHandler, { capture: true });

    const backdrop = this._backdrop;
    const panel = this._panel;
    if (!backdrop) {
      if (typeof afterExit === "function") afterExit();
      return;
    }

    // Exit animation
    backdrop.classList.remove("nuvio-dialog-backdrop-enter");
    panel.classList.remove("nuvio-dialog-panel-enter");
    backdrop.classList.add("nuvio-dialog-backdrop-exit");
    panel.classList.add("nuvio-dialog-panel-exit");

    // Remove after animation completes (150ms exit)
    setTimeout(() => backdrop.remove(), 200);
    setTimeout(() => {
      if (!document.querySelector(".nuvio-dialog-backdrop")) {
        document.body?.classList?.remove("nuvio-modal-open");
      }
      if (typeof afterExit === "function") afterExit();
    }, 220);
  }
}
