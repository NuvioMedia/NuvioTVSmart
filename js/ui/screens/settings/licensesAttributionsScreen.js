import { I18n } from "../../../i18n/index.js";
import { ScreenUtils } from "../../navigation/screen.js";

const SECTIONS = [
  {
    titleKey: "licenses_attributions_section_app",
    items: [["nuvio", "https://github.com/NuvioMedia/NuvioTVSmart"]]
  },
  {
    titleKey: "licenses_attributions_section_data",
    items: [
      ["tmdb", "https://www.themoviedb.org"],
      ["trakt", "https://trakt.tv"],
      ["simkl", "https://simkl.com"],
      ["premiumize", "https://www.premiumize.me"],
      ["torbox", "https://torbox.app"],
      ["mdblist", "https://mdblist.com"],
      ["introdb", "https://introdb.app/"],
      ["imdb", "https://developer.imdb.com/non-commercial-datasets/"]
    ]
  },
  {
    titleKey: "settings.sections.playback.label",
    items: [
      ["hls.js 1.7.3", "https://github.com/video-dev/hls.js", "Apache-2.0"],
      ["dash.js 5.2.1", "https://github.com/Dash-Industry-Forum/dash.js", "BSD-3-Clause"],
      ["JSZip 3.10.2", "https://github.com/Stuk/jszip", "MIT OR GPL-3.0-or-later"],
      ["libbitsub 1.12.1", "https://github.com/altqx/libbitsub", "MIT"]
    ]
  }
];

function t(key, fallback = key) {
  return I18n.t(key, {}, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const LicensesAttributionsScreen = {
  async mount() {
    this.container = document.getElementById("licensesAttributions");
    ScreenUtils.show(this.container);
    this.container.innerHTML = `
      <main class="licenses-screen">
        <header><h1>${escapeHtml(t("licenses_attributions_title", "Licenses & Attribution"))}</h1><p>${escapeHtml(t("licenses_attributions_section_data", "Data & services"))}</p></header>
        <div class="licenses-list">
          ${SECTIONS.map(
            (section) => `
            <section><h2>${escapeHtml(t(section.titleKey))}</h2>
              ${section.items.map(([id, url, license]) => `<button class="license-row focusable" data-url="${escapeHtml(url)}"><strong>${escapeHtml(license ? id : t(`licenses_attributions_${id}_title`, id))}</strong><span>${escapeHtml(license || t(`licenses_attributions_${id}_body`, ""))}</span></button>`).join("")}
            </section>`
          ).join("")}
        </div>
      </main>`;
    ScreenUtils.indexFocusables(this.container);
    this.onClickBound = this.onClick.bind(this);
    this.container.addEventListener("click", this.onClickBound);
    ScreenUtils.setInitialFocus(this.container);
  },

  onClick(event) {
    const url = event.target.closest("[data-url]")?.dataset.url;
    if (url) window.open?.(url, "_blank");
  },

  onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const key = event?.key;
    if (code === 38 || key === "ArrowUp") {
      event?.preventDefault?.();
      ScreenUtils.moveFocus(this.container, -1);
      this.revealFocused();
    } else if (code === 40 || key === "ArrowDown") {
      event?.preventDefault?.();
      ScreenUtils.moveFocus(this.container, 1);
      this.revealFocused();
    } else if (code === 13 || key === "Enter") {
      event?.preventDefault?.();
      this.container?.querySelector(".focusable.focused")?.click();
    }
  },

  // ScreenUtils.moveFocus focuses with preventScroll, so the list must scroll
  // the focused row into view itself (Android scrolls the panel the same way).
  revealFocused() {
    const scroller = this.container?.querySelector(".licenses-screen");
    const row = this.container?.querySelector(".focusable.focused");
    if (
      !scroller ||
      !row ||
      typeof scroller.getBoundingClientRect !== "function" ||
      typeof row.getBoundingClientRect !== "function"
    ) {
      return;
    }
    const view = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const margin = 8;
    if (rect.top < view.top + margin) {
      scroller.scrollTop += rect.top - view.top - margin;
    } else if (rect.bottom > view.bottom - margin) {
      scroller.scrollTop += rect.bottom - view.bottom + margin;
    }
  },

  cleanup() {
    this.container?.removeEventListener("click", this.onClickBound);
    ScreenUtils.hide(this.container);
  }
};
