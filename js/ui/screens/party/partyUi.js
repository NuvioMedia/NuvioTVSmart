// Shared watch party markup, mirroring Android ui/screens/party/PartyUi.kt,
// PartyCode.kt and PartyDetails.kt.
import { I18n } from "../../../i18n/index.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import {
  PARTY_CODE_LENGTH,
  PartyError,
  PartyMemberStatus,
  formatPartyCode,
  isPartyHost,
  partyMember
} from "../../../core/party/partyModels.js";

export const PartyPresenceState = Object.freeze({
  Watching: "watching",
  Busy: "busy",
  Away: "away",
  Offline: "offline"
});

export function t(key, params = [], fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Android detail formatPlaybackTime: mm:ss, or h:mm:ss. */
export function formatPlaybackTime(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Android player formatTime: m:ss, or h:mm:ss. */
export function formatPlayerTime(milliseconds) {
  const millis = Number(milliseconds || 0);
  if (millis <= 0) return "0:00";
  const total = Math.floor(millis / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatSpeedLabel(rate) {
  return `${Number(rate)}x`;
}

export function partyErrorMessage(error) {
  switch (error) {
    case PartyError.NotFound:
      return t("party_error_not_found");
    case PartyError.Full:
      return t("party_error_full");
    case PartyError.Removed:
      return t("party_error_removed");
    case PartyError.Ended:
      return t("party_error_ended");
    case PartyError.RateLimited:
      return t("party_error_rate_limited");
    case PartyError.SignInRequired:
      return t("party_sign_in_required");
    case PartyError.Unavailable:
      return t("party_unavailable");
    default:
      return t("party_error_network");
  }
}

export function episodeLabel(media) {
  if (media?.season == null || media?.episode == null) return "";
  const label = t("party_episode_format", [media.season, media.episode]);
  return media.episode_title ? `${label} · ${media.episode_title}` : label;
}

export function displayTitle(media) {
  if (!media) return "";
  if (media.season == null || media.episode == null) return media.title || "";
  const label = t("party_episode_format", [media.season, media.episode]);
  return media.title ? `${media.title} · ${label}` : label;
}

function presenceOf(party, member) {
  return (
    party.presence[member.id] ||
    (member.id === party.memberId
      ? {
          member_id: member.id,
          status: PartyMemberStatus.Browsing,
          media_key: null,
          behind_ms: null
        }
      : null)
  );
}

export function presenceState(party, member) {
  const presence = presenceOf(party, member);
  if (!presence) return PartyPresenceState.Offline;
  if (presence.media_key !== party.mediaKey) return PartyPresenceState.Away;
  switch (presence.status) {
    case PartyMemberStatus.Ready:
      return PartyPresenceState.Watching;
    case PartyMemberStatus.Loading:
    case PartyMemberStatus.Buffering:
      return PartyPresenceState.Busy;
    default:
      return PartyPresenceState.Away;
  }
}

export function memberBehindMs(party, member) {
  const presence = presenceOf(party, member);
  if (
    !presence ||
    presence.status !== PartyMemberStatus.Behind ||
    presence.media_key !== party.mediaKey
  )
    return null;
  return presence.behind_ms ?? 0;
}

export function memberStatusText(party, member) {
  const presence = presenceOf(party, member);
  if (!presence) return t("party_status_offline");
  if (presence.media_key !== party.mediaKey) {
    return presence.status === PartyMemberStatus.Browsing
      ? t("party_status_choosing")
      : t("party_status_elsewhere");
  }
  switch (presence.status) {
    case PartyMemberStatus.Ready:
    case PartyMemberStatus.Behind:
      return t("party_status_ready");
    case PartyMemberStatus.Buffering:
      return t("party_status_buffering");
    case PartyMemberStatus.Loading:
      return t("party_status_loading");
    default:
      return t("party_status_choosing");
  }
}

function initialOf(name) {
  const trimmed = String(name || "").trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : "N";
}

function safeColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(color || "")) ? color : "";
}

export function avatarMarkup(
  { name, imageUrl, color },
  { size = "md", presence = null, ring = "" } = {}
) {
  const background = safeColor(color);
  const image = imageUrl
    ? `<img class="party-avatar-image" src="${escapeHtml(imageUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : "";
  return `
    <span class="party-avatar party-avatar-${size}${ring ? ` party-avatar-ring-${ring}` : ""}">
      <span class="party-avatar-circle"${background ? ` style="background:${background}"` : ""}>
        <span class="party-avatar-initial">${escapeHtml(initialOf(name))}</span>${image}
      </span>
      ${presence ? `<span class="party-presence-dot party-presence-${presence}"><span></span></span>` : ""}
    </span>`;
}

export function memberAvatarMarkup(member, options) {
  return avatarMarkup(
    { name: member.display_name, imageUrl: member.avatar_url, color: member.avatar_color },
    options
  );
}

export function avatarStackMarkup(members, { size = "sm", ring = "" } = {}) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  return `
    <span class="party-avatar-stack party-avatar-stack-${size}">
      ${shown.map((member) => memberAvatarMarkup(member, { size, ring })).join("")}
      ${extra > 0 ? `<span class="party-avatar party-avatar-${size}${ring ? ` party-avatar-ring-${ring}` : ""}"><span class="party-avatar-circle party-avatar-extra"><span class="party-avatar-initial">+${extra}</span></span></span>` : ""}
    </span>`;
}

export function openSeatMarkup(size = "md") {
  return `<span class="party-open-seat party-avatar-${size}"><span class="material-icons" aria-hidden="true">add</span></span>`;
}

export function seatsHeroMarkup(profile, size = "lg") {
  return `
    <span class="party-seats-hero party-seats-hero-${size}">
      ${avatarMarkup({ name: profile?.name, imageUrl: profile?.imageUrl, color: profile?.color }, { size, ring: "hero" })}
      ${openSeatMarkup(size)}${openSeatMarkup(size)}
    </span>`;
}

export function codeSlotsMarkup(code, { activeIndex = null, size = "md" } = {}) {
  const value = String(code || "");
  let slots = "";
  for (let index = 0; index < PARTY_CODE_LENGTH; index += 1) {
    const character = value[index] || "";
    const active = index === activeIndex;
    slots += `
      <span class="party-code-slot${active ? " is-active" : ""}${character ? " is-filled" : ""}">
        <span class="party-code-char">${character ? escapeHtml(character) : active ? '<span class="party-code-caret"></span>' : ""}</span>
        <span class="party-code-line"></span>
      </span>`;
  }
  return `<div class="party-code-slots party-code-slots-${size}" dir="ltr" aria-label="${escapeHtml(formatPartyCode(value))}">${slots}</div>`;
}

export function codeSectionMarkup(party, size = "md") {
  const label = party.connected
    ? `<span class="party-code-label">${escapeHtml(t("party_code_label"))}</span>`
    : `<span class="party-code-label is-reconnecting"><span class="party-pulsing-dot"></span>${escapeHtml(t("party_reconnecting"))}</span>`;
  return `<div class="party-code-section">${label}${codeSlotsMarkup(party.code, { size })}</div>`;
}

export function seatDotsMarkup(filled, total) {
  let dots = "";
  for (let index = 0; index < total; index += 1)
    dots += `<span class="party-seat-dot${index < filled ? " is-filled" : ""}"></span>`;
  return `<span class="party-seat-dots">${dots}</span>`;
}

/** Member rows; focusable rows carry data-party-action for the host's remove action and the invite row. */
export function membersSectionMarkup(party, { selfBehindMs = null } = {}) {
  const host = isPartyHost(party);
  const rows = party.members
    .map((member) => {
      const removable = host && member.id !== party.memberId;
      const behind = member.id === party.memberId ? selfBehindMs : memberBehindMs(party, member);
      const status =
        behind != null
          ? t("party_behind", [formatPlaybackTime(behind)])
          : memberStatusText(party, member);
      const name =
        member.id === party.memberId
          ? `${member.display_name} (${t("party_you")})`
          : member.display_name;
      const content = `
        ${memberAvatarMarkup(member, { size: "md", presence: presenceState(party, member) })}
        <span class="party-member-copy">
          <span class="party-member-name-row">
            <span class="party-member-name">${escapeHtml(name)}</span>
            ${member.id === party.hostMemberId ? `<span class="party-member-host">${escapeHtml(t("party_host"))}</span>` : ""}
          </span>
          <span class="party-member-status">${escapeHtml(status)}</span>
        </span>
        ${removable ? '<span class="party-member-remove material-icons" aria-hidden="true">close</span>' : ""}`;
      return removable
        ? `<button class="party-row party-member-row focusable" data-party-action="remove" data-member-id="${escapeHtml(member.id)}" aria-label="${escapeHtml(t("party_remove"))}">${content}</button>`
        : `<div class="party-row party-member-row is-static">${content}</div>`;
    })
    .join("");
  const invite =
    party.members.length < party.maxMembers
      ? `<button class="party-row party-invite-row focusable" data-party-action="invite">${openSeatMarkup("md")}<span class="party-member-name is-muted">${escapeHtml(t("party_open_seat"))}</span></button>`
      : "";
  return `
    <div class="party-members">
      <div class="party-members-header">
        <span class="party-members-seats">${escapeHtml(t("party_seats", [party.members.length, party.maxMembers]))}</span>
        ${seatDotsMarkup(party.members.length, party.maxMembers)}
      </div>
      ${rows}${invite}
    </div>`;
}

export function hostOnlyNoteMarkup() {
  return `<div class="party-note party-host-only-note"><span class="material-icons" aria-hidden="true">lock</span><span>${escapeHtml(t("party_host_only_note"))}</span></div>`;
}

function toggleRowMarkup(action, title, subtitle, checked) {
  return `
    <button class="settings-action-row settings-toggle-row party-toggle-row focusable" data-party-action="${action}" data-role="toggle">
      <span class="settings-row-copy">
        <span class="settings-row-title">${escapeHtml(title)}</span>
        <span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>
      </span>
      <span class="settings-row-tail">
        <span class="settings-toggle-pill${checked ? " is-checked" : ""}"><span class="settings-toggle-thumb"></span></span>
      </span>
    </button>`;
}

export function hostSettingsMarkup(party, { sharingNote = "" } = {}) {
  return `
    <div class="party-host-settings">
      ${toggleRowMarkup("hostOnly", t("party_host_only_title"), t("party_host_only_description"), party.hostOnly)}
      ${toggleRowMarkup("sharing", t("party_share_title"), t("party_share_description"), party.sharing)}
      ${party.sharing && sharingNote ? `<div class="party-note">${escapeHtml(sharingNote)}</div>` : ""}
    </div>`;
}

export function actionRowMarkup(action, title, { icon = "", primary = false } = {}) {
  return `
    <button class="settings-action-row party-action-row focusable${primary ? " is-primary" : ""}" data-party-action="${action}" data-role="action">
      ${icon ? `<span class="settings-row-leading-icon material-icons" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
      <span class="settings-row-copy"><span class="settings-row-title">${escapeHtml(title)}</span></span>
    </button>`;
}

export function partyActionsMarkup(party) {
  return `
    ${actionRowMarkup("leave", t("party_leave"), { icon: "logout" })}
    ${isPartyHost(party) && party.members.length > 1 ? actionRowMarkup("end", t("party_end"), { icon: "stop_circle" }) : ""}`;
}

export function experimentalNoteMarkup() {
  return `<div class="party-note party-experimental-note">${escapeHtml(t("party_experimental"))}</div>`;
}

export function mediaTitleMarkup(media, { centered = false } = {}) {
  if (!media) return "";
  const logo = String(media.logo || "").trim();
  const label = episodeLabel(media);
  const textTitle = media.title
    ? `<h2 class="party-media-title"${logo ? " hidden" : ""}>${escapeHtml(media.title)}</h2>`
    : "";
  const title = logo
    ? `<img class="party-media-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(media.title)}" onerror="if(this.nextElementSibling)this.nextElementSibling.hidden=false;this.remove()" />${textTitle}`
    : textTitle;
  return `
    <div class="party-media-heading${centered ? " is-centered" : ""}">
      ${title}
      ${label ? `<div class="party-media-episode">${escapeHtml(label)}</div>` : ""}
    </div>`;
}

export function mediaHeaderMarkup(media) {
  if (!media) return "";
  return `
    <div class="party-media-header">
      ${mediaTitleMarkup(media)}
      ${media.description ? `<p class="party-media-description">${escapeHtml(media.description)}</p>` : ""}
    </div>`;
}

export function hostName(party) {
  return partyMember(party, party?.hostMemberId)?.display_name || "";
}

/** Android ConfirmDialog: Cancel is focused first. */
export function showConfirmDialog({ title, message, confirmLabel, onConfirm, onDismiss = null }) {
  let dialog = null;
  dialog = new NuvioDialog({
    title,
    subtitle: message,
    widthVw: 43.75,
    onDismiss: () => onDismiss?.(),
    buttons: [
      {
        key: "cancel",
        label: t("action_cancel", [], "Cancel"),
        onAction: () => {
          dialog?.destroy();
          onDismiss?.();
        }
      },
      {
        key: "confirm",
        label: confirmLabel,
        onAction: () => {
          dialog?.destroy();
          onConfirm();
        }
      }
    ]
  });
  dialog.mount(document.body);
  return dialog;
}

/** Android InviteDialog: QR code of the invite link plus the code. */
export async function showInviteDialog(party, { onDismiss = null } = {}) {
  const { QrCodeGenerator } = await import("../../../core/qr/qrCodeGenerator.js");
  let dialog = null;
  dialog = new NuvioDialog({
    title: t("party_open_seat"),
    widthVw: 66.7,
    panelClassName: "party-invite-dialog",
    onDismiss: () => onDismiss?.(),
    content: () => {
      const wrap = document.createElement("div");
      wrap.className = "party-invite-body";
      const canvas = document.createElement("canvas");
      canvas.className = "party-invite-qr";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", t("party_invite_qr"));
      try {
        QrCodeGenerator.generate(canvas, party.inviteLink, 420);
      } catch (error) {
        console.warn("[party] QR generation failed", error);
        canvas.hidden = true;
      }
      const copy = document.createElement("div");
      copy.className = "party-invite-copy";
      copy.innerHTML = `
        <div class="party-invite-scan">${escapeHtml(t("party_invite_scan"))}</div>
        ${codeSlotsMarkup(party.code, { size: "lg" })}
        <div class="party-invite-share">${escapeHtml(t("party_invite_share"))}</div>`;
      wrap.appendChild(canvas);
      wrap.appendChild(copy);
      return wrap;
    },
    buttons: [
      {
        key: "close",
        label: t("action_close", [], "Close"),
        onAction: () => {
          dialog?.destroy();
          onDismiss?.();
        }
      }
    ]
  });
  dialog.mount(document.body);
  return dialog;
}

/** Up/Down through a vertical list in DOM order (spatial navigation can skip stacked tall rows). */
export function moveListFocus(container, delta) {
  const nodes = Array.from(container?.querySelectorAll(".focusable") || []).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!nodes.length) return null;
  const current = container.querySelector(".focusable.focused");
  const index = current ? nodes.indexOf(current) : -1;
  const target = nodes[Math.max(0, Math.min(nodes.length - 1, index + delta))];
  if (!target || target === current) return current;
  current?.classList.remove("focused");
  target.classList.add("focused");
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    target.focus?.();
  }
  target.scrollIntoView?.({ block: "nearest" });
  return target;
}
