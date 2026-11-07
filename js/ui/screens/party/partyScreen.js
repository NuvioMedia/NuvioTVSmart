// Watch party screen, mirroring Android ui/screens/party/PartyScreen.kt:
// join with a code (keypad + preview), the "You're in" moment, and the
// party overview with members, host settings and actions.
import { ScreenUtils } from "../../navigation/screen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { Router } from "../../navigation/routerState.js";
import { PartyRepository } from "../../../core/party/partyRepository.js";
import {
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  PartyError,
  isPartyHost,
  isPartyPreviewFull,
  isValidPartyCode,
  normalizePartyCode,
  partyErrorOf
} from "../../../core/party/partyModels.js";
import { openPartyMedia } from "./partyNavigation.js";
import {
  actionRowMarkup,
  avatarStackMarkup,
  codeSectionMarkup,
  codeSlotsMarkup,
  escapeHtml,
  experimentalNoteMarkup,
  hostName,
  hostOnlyNoteMarkup,
  hostSettingsMarkup,
  mediaHeaderMarkup,
  moveListFocus,
  mediaTitleMarkup,
  memberAvatarMarkup,
  membersSectionMarkup,
  partyActionsMarkup,
  partyErrorMessage,
  seatsHeroMarkup,
  showConfirmDialog,
  showInviteDialog,
  t
} from "./partyUi.js";

const KEYPAD_COLUMNS = 8;
const JOINED_DELAY_MS = 1600;
const BLOCKING_SUBMIT_ERRORS = new Set([
  PartyError.NotFound,
  PartyError.Removed,
  PartyError.RateLimited
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const PartyScreen = {
  async mount(params = {}) {
    this.container = document.getElementById("watchParty");
    ScreenUtils.show(this.container);
    this.mountToken = (this.mountToken || 0) + 1;
    const party = PartyRepository.getState().party;
    const initialCode = String(params?.code || "");
    this.pendingCode =
      isValidPartyCode(initialCode) && normalizePartyCode(initialCode) !== party?.code
        ? normalizePartyCode(initialCode)
        : "";
    this.joining = !party || Boolean(this.pendingCode);
    this.joined = null;
    this.previewMedia = null;
    this.profile = null;
    this.focusKey = "";
    this.resetJoinState();
    this.unsubscribers = [
      PartyRepository.subscribeState(() => this.scheduleRender()),
      PartyRepository.subscribeAvailable(() => this.scheduleRender())
    ];
    this.render();
    const token = this.mountToken;
    PartyRepository.getProfile()
      .then((profile) => {
        if (token !== this.mountToken) return;
        this.profile = profile;
        this.scheduleRender();
      })
      .catch(() => {});
    if (this.mode() === "join") void this.startJoinEntry(token);
  },

  resetJoinState() {
    this.code = "";
    this.error = null;
    this.preview = null;
    this.previewing = false;
    this.previewToken = 0;
    this.prefilled = isValidPartyCode(this.pendingCode);
    if (!this.prefilled)
      this.code = normalizePartyCode(this.pendingCode).slice(0, PARTY_CODE_LENGTH);
  },

  async startJoinEntry(token) {
    if (this.blockedError()) {
      this.focusFirstKey();
      return;
    }
    if (this.prefilled) {
      const target = this.pendingCode;
      await wait(250);
      for (let index = 0; index < target.length; index += 1) {
        await wait(60);
        if (token !== this.mountToken) return;
        this.code = target.slice(0, index + 1);
        this.render();
      }
      this.lookUp(target);
    }
    if (token === this.mountToken) this.focusFirstKey();
  },

  mode() {
    const party = PartyRepository.getState().party;
    if (this.joined) return "joined";
    if (party && !this.joining) return "party";
    return "join";
  },

  blockedError() {
    if (!PartyRepository.isAvailable()) return PartyError.Unavailable;
    if (!PartyRepository.canUse()) return PartyError.SignInRequired;
    return null;
  },

  scheduleRender() {
    if (this.renderFrame) return;
    const run = () => {
      this.renderFrame = null;
      if (this.container && Router.getCurrent?.() === "watchParty") this.render();
    };
    this.renderFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(run)
        : setTimeout(run, 16);
  },

  render() {
    if (!this.container) return;
    const focused = this.container.querySelector(".focusable.focused");
    const focusKey = focused?.dataset?.focusKey || this.focusKey;
    const mode = this.mode();
    const party = PartyRepository.getState().party;
    const shown = this.joined || party;
    const backdropMedia = mode === "join" ? this.previewMedia : shown?.media;
    const backdrop = backdropMedia ? backdropMedia.background || backdropMedia.poster : "";
    const subtitle =
      mode !== "join" && shown && hostName(shown)
        ? t("party_hosted_by", [hostName(shown)])
        : t("party_settings_description");
    let body = "";
    if (mode === "join") body = this.renderJoin();
    else if (mode === "joined") body = this.renderJoined(shown);
    else body = this.renderParty(party);
    this.container.innerHTML = `
      <div class="party-screen party-screen-${mode}">
        ${backdrop ? `<div class="party-backdrop" style="background-image:url('${escapeHtml(backdrop).replace(/'/g, "%27")}')"></div><div class="party-backdrop-scrim"></div>` : ""}
        <div class="party-screen-content">
          <header class="party-screen-header">
            <h1 class="party-screen-title">${escapeHtml(t("party_title"))}</h1>
            <p class="party-screen-subtitle">${escapeHtml(subtitle)}</p>
          </header>
          <div class="party-screen-body">${body}</div>
        </div>
      </div>`;
    ScreenUtils.indexFocusables(this.container);
    this.restoreFocus(focusKey);
  },

  renderJoin() {
    const state = PartyRepository.getState();
    const blocked = this.blockedError();
    const shownError = blocked || this.error;
    const busy = state.busy || this.previewing;
    const canSubmit = isValidPartyCode(this.code) && !BLOCKING_SUBMIT_ERRORS.has(this.error);
    const enabled = !blocked;
    const activeIndex =
      !blocked && !state.busy ? Math.min(this.code.length, PARTY_CODE_LENGTH - 1) : null;
    const preview = this.preview?.media
      ? `
        <div class="party-preview">
          ${mediaHeaderMarkup(this.preview.media)}
          <div class="party-preview-host">
            ${this.preview.host ? `${memberAvatarMarkup(this.preview.host, { size: "sm" })}<span class="party-preview-host-name">${escapeHtml(t("party_hosted_by", [this.preview.host.display_name]))}</span>` : ""}
            <span class="party-preview-seats">${escapeHtml(t("party_seats", [this.preview.members, this.preview.max_members]))}</span>
          </div>
        </div>`
      : `
        <div class="party-join-intro">
          ${seatsHeroMarkup(this.profile, "xl")}
          <h2 class="party-join-title">${escapeHtml(t("party_join_title"))}</h2>
          <p class="party-join-description">${escapeHtml(t("party_join_description"))}</p>
        </div>`;
    const keys = PARTY_CODE_ALPHABET.split("");
    let keypadRows = "";
    for (let row = 0; row < keys.length; row += KEYPAD_COLUMNS) {
      keypadRows += `<div class="party-keypad-row">${keys
        .slice(row, row + KEYPAD_COLUMNS)
        .map(
          (character) =>
            `<button class="party-key${enabled ? " focusable" : " is-disabled"}" data-focus-key="key:${character}" data-party-key="${character}">${character}</button>`
        )
        .join("")}</div>`;
    }
    const submitEnabled = enabled && canSubmit && !busy;
    return `
      <div class="party-join">
        <div class="party-join-left">
          ${preview}
          <div class="party-join-code${this.shaking ? " is-shaking" : ""}">${codeSlotsMarkup(this.code, { activeIndex, size: "xl" })}</div>
          <div class="party-join-error">${shownError ? escapeHtml(partyErrorMessage(shownError)) : "&nbsp;"}</div>
          ${experimentalNoteMarkup()}
          ${this.preview?.media ? "" : `<div class="party-note party-host-hint">${escapeHtml(t("party_host_hint"))}</div>`}
        </div>
        <div class="party-keypad">
          ${keypadRows}
          <div class="party-keypad-row">
            <button class="party-key party-key-delete${enabled ? " focusable" : " is-disabled"}" data-focus-key="key:delete" data-party-key="delete" aria-label="${escapeHtml(t("action_delete", [], "Delete"))}"><span class="material-icons" aria-hidden="true">backspace</span></button>
            <button class="party-key party-key-submit${submitEnabled ? " focusable" : " is-disabled"}" data-focus-key="key:submit" data-party-key="submit">${escapeHtml(t("party_join_action"))}</button>
          </div>
        </div>
      </div>`;
  },

  renderJoined(party) {
    return `
      <div class="party-joined">
        ${avatarStackMarkup(party.members, { size: "xl", ring: "screen" })}
        <h2 class="party-joined-title">${escapeHtml(t("party_joined_title"))}</h2>
        ${mediaTitleMarkup(party.media, { centered: true })}
      </div>`;
  },

  renderParty(party) {
    if (!party) return "";
    return `
      <div class="party-overview">
        <div class="party-overview-left">
          ${mediaHeaderMarkup(party.media)}
          ${codeSectionMarkup(party, "lg")}
        </div>
        <div class="party-overview-right">
          <div class="settings-group-card party-card">
            ${actionRowMarkup("watch", t("party_watch_with_party"), { icon: "play_arrow" })}
            ${partyActionsMarkup(party)}
          </div>
          <div class="settings-group-card party-card">
            ${membersSectionMarkup(party)}
            ${!isPartyHost(party) && party.hostOnly ? hostOnlyNoteMarkup() : ""}
          </div>
          ${isPartyHost(party) ? `<div class="settings-group-card party-card">${hostSettingsMarkup(party)}</div>` : ""}
        </div>
      </div>`;
  },

  restoreFocus(focusKey) {
    const nodes = Array.from(this.container.querySelectorAll(".focusable"));
    nodes.forEach((node, index) => {
      if (!node.dataset.focusKey) {
        const action = node.dataset.partyAction;
        node.dataset.focusKey =
          action === "remove"
            ? `remove:${node.dataset.memberId}`
            : action
              ? `action:${action}`
              : `index:${index}`;
      }
    });
    const target =
      (focusKey && nodes.find((node) => node.dataset.focusKey === focusKey)) ||
      (this.mode() === "party"
        ? this.container.querySelector("[data-party-action='watch']")
        : null) ||
      (this.mode() === "join" ? this.container.querySelector(".party-key.focusable") : null) ||
      nodes[0];
    nodes.forEach((node) => node.classList.remove("focused"));
    if (!target) return;
    target.classList.add("focused");
    this.focusKey = target.dataset.focusKey || "";
    focusWithoutScroll(target);
    target.scrollIntoView?.({ block: "nearest" });
  },

  focusByKey(focusKey) {
    this.focusKey = focusKey;
    this.restoreFocus(focusKey);
  },

  focusFirstKey() {
    if (this.mode() === "join") this.focusByKey(`key:${PARTY_CODE_ALPHABET[0]}`);
  },

  async reject(error) {
    this.error = error;
    this.shaking = true;
    this.render();
    await wait(420);
    this.shaking = false;
    this.render();
  },

  changeCode(value) {
    if (PartyRepository.getState().busy || value === this.code) return;
    this.code = value;
    this.error = null;
    this.preview = null;
    this.previewMedia = null;
    this.previewToken += 1;
    this.previewing = false;
    if (isValidPartyCode(value)) this.lookUp(value);
    this.render();
  },

  lookUp(target) {
    const token = ++this.previewToken;
    this.previewing = true;
    this.render();
    PartyRepository.preview(target).then((result) => {
      if (token !== this.previewToken || !this.container) return;
      this.previewing = false;
      const failure = partyErrorOf(result.error);
      if (failure == null && result.media) {
        this.preview = result;
        this.previewMedia = result.media;
        if (isPartyPreviewFull(result)) this.error = PartyError.Full;
        this.render();
        this.focusByKey("key:submit");
        return;
      }
      if (failure != null && failure !== PartyError.Network) {
        void this.reject(failure);
        return;
      }
      this.render();
    });
  },

  async submit() {
    if (!isValidPartyCode(this.code) || PartyRepository.getState().busy || this.blockedError())
      return;
    const token = this.mountToken;
    this.error = null;
    const result = await PartyRepository.join(this.code);
    if (token !== this.mountToken) return;
    const joinedParty = PartyRepository.getState().party;
    if (result == null && joinedParty) {
      this.pendingCode = "";
      this.joining = false;
      this.joined = joinedParty;
      this.render();
      await wait(JOINED_DELAY_MS);
      if (token !== this.mountToken || !this.joined) return;
      const media = this.joined.media;
      this.joined = null;
      void openPartyMedia(media);
      return;
    }
    await this.reject(result || PartyError.Network);
  },

  activate(node) {
    if (!node) return;
    const key = node.dataset.partyKey;
    if (key) {
      if (key === "delete") this.changeCode(this.code.slice(0, -1));
      else if (key === "submit") void this.submit();
      else if (this.code.length < PARTY_CODE_LENGTH) this.changeCode(this.code + key);
      return;
    }
    const party = PartyRepository.getState().party;
    if (!party) return;
    switch (node.dataset.partyAction) {
      case "watch":
        void openPartyMedia(party.media);
        break;
      case "leave":
        void PartyRepository.leave();
        break;
      case "end":
        showConfirmDialog({
          title: t("party_end_title"),
          message: t("party_end_message"),
          confirmLabel: t("party_end"),
          onConfirm: () => void PartyRepository.end()
        });
        break;
      case "remove": {
        const member = party.members.find((entry) => entry.id === node.dataset.memberId);
        if (!member) return;
        showConfirmDialog({
          title: t("party_remove_title", [member.display_name]),
          message: t("party_remove_message"),
          confirmLabel: t("party_remove"),
          onConfirm: () => void PartyRepository.removeMember(member.id)
        });
        break;
      }
      case "invite":
        void showInviteDialog(party);
        break;
      case "hostOnly":
        void PartyRepository.setHostOnly(!party.hostOnly);
        break;
      case "sharing":
        PartyRepository.setSharing(!party.sharing);
        break;
      default:
        break;
    }
  },

  onKeyDown(event) {
    if (!this.container) return;
    if (this.mode() === "join" && !this.blockedError()) {
      const character =
        String(event?.key || "").length === 1 ? String(event.key).toUpperCase() : "";
      if (!event?.ctrlKey && !event?.altKey && !event?.metaKey) {
        if (character && PARTY_CODE_ALPHABET.includes(character)) {
          event.preventDefault?.();
          if (this.code.length < PARTY_CODE_LENGTH) this.changeCode(this.code + character);
          return;
        }
        if (event?.key === "Backspace" || event?.key === "Delete") {
          event.preventDefault?.();
          this.changeCode(this.code.slice(0, -1));
          return;
        }
      }
    }
    const keyCode = Number(event?.keyCode || 0);
    if (this.mode() === "party" && (keyCode === 38 || keyCode === 40)) {
      event.preventDefault?.();
      const focused = moveListFocus(this.container, keyCode === 40 ? 1 : -1);
      if (focused) this.focusKey = focused.dataset.focusKey || "";
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      const focused = this.container.querySelector(".focusable.focused");
      if (focused) {
        this.focusKey = focused.dataset.focusKey || "";
        focused.scrollIntoView?.({ block: "nearest" });
      }
      return;
    }
    if (Number(event?.keyCode) === 13 || event?.key === "Enter") {
      event.preventDefault?.();
      this.activate(this.container.querySelector(".focusable.focused"));
    }
  },

  consumeBackRequest() {
    return false;
  },

  cleanup() {
    this.mountToken = (this.mountToken || 0) + 1;
    this.previewToken += 1;
    this.unsubscribers?.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    if (this.renderFrame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.renderFrame);
      clearTimeout(this.renderFrame);
      this.renderFrame = null;
    }
    this.joined = null;
    ScreenUtils.hide(this.container);
  }
};
