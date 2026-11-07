// Watch party in the player, mirroring Android PlayerRuntimeControllerParty.kt,
// the party parts of PlayerScreen.kt and ui/screens/party/PartyPanel.kt.
import { PlayerController } from "../../../core/player/playerController.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { PartyRepository } from "../../../core/party/partyRepository.js";
import {
  OwnSeekType,
  PAUSED_TOLERANCE_MS,
  PartyCorrectionType,
  PartySync
} from "../../../core/party/partySync.js";
import {
  PartyAction,
  PartyEventType,
  PartyMemberStatus,
  canControlParty,
  isPartyHost,
  isShareableStreamUrl,
  partyMediaKey,
  partyMember
} from "../../../core/party/partyModels.js";
import { openPartyMedia } from "../party/partyNavigation.js";
import {
  avatarStackMarkup,
  codeSectionMarkup,
  displayTitle,
  escapeHtml,
  experimentalNoteMarkup,
  formatPlaybackTime,
  formatPlayerTime,
  formatSpeedLabel,
  hostOnlyNoteMarkup,
  hostSettingsMarkup,
  membersSectionMarkup,
  moveListFocus,
  partyActionsMarkup,
  partyErrorMessage,
  seatsHeroMarkup,
  showConfirmDialog,
  showInviteDialog,
  t
} from "../party/partyUi.js";

const PARTY_TICK_MS = 250;
const BUFFERING_REPORT_DELAY_MS = 1000;
const OUTSIDE_TOGGLE_DELAY_MS = 1200;
const SEEK_SETTLE_MS = 2500;
const CORRECTION_INTERVAL_MS = 500;
const MAX_SEEK_LEAD_MS = 3000;
const BEHIND_DISPLAY_STEP_MS = 1000;
const DESCRIPTION_LIMIT = 600;
const PARTY_MESSAGE_MS = 2200;
const NOTICE_MS = 3000;

function monotonicNow() {
  const perf = globalThis.performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

function normalizedType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();
  return type === "tv" || type === "show" ? "series" : type;
}

function optionalInt(value) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isInteger(number)
    ? null
    : number;
}

export function createPlayerPartyMethods() {
  return {
    // ---- identity of what this player is showing ----
    partyContentType() {
      return normalizedType(this.params?.itemType);
    },
    partySeason() {
      return optionalInt(this.params?.season);
    },
    partyEpisode() {
      return optionalInt(this.params?.episode);
    },
    partyKey() {
      return partyMediaKey(
        this.partyContentType(),
        String(this.params?.itemId || ""),
        this.partySeason(),
        this.partyEpisode()
      );
    },
    canUseParty() {
      const type = this.partyContentType();
      return (
        Boolean(String(this.params?.itemId || "").trim()) &&
        Boolean(type) &&
        type !== "cloud" &&
        !this.isExternalFrameMode?.()
      );
    },
    isPartySynced() {
      return PartyRepository.getState().party?.mediaKey === this.partyKey();
    },
    isPartyControlLocked() {
      const party = PartyRepository.getState().party;
      return Boolean(party) && !canControlParty(party) && party.mediaKey === this.partyKey();
    },
    partyBlocksControl() {
      if (!this.isPartyControlLocked()) return false;
      this.showPartyMessage(t("party_host_only_note"));
      return true;
    },
    showPartyMessage(text) {
      const toast = this.uiRefs?.aspectToast;
      if (!toast) return;
      toast.textContent = text;
      toast.classList.remove("hidden");
      clearTimeout(this.aspectToastTimer);
      this.aspectToastTimer = setTimeout(() => toast.classList.add("hidden"), PARTY_MESSAGE_MS);
    },

    // ---- playback primitives ----
    partyHasActivePlayIntent() {
      return !this.getPlaybackControlPaused();
    },
    partyPositionMs() {
      const seconds = Number(this.getPlaybackCurrentSeconds());
      return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : null;
    },
    partyDurationMs() {
      const seconds = Number(this.getPlaybackDurationSeconds());
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
    },
    partyIsLoading() {
      return Boolean(this.bufferingActive || this.loadingVisible || this.seekLoading);
    },
    partyPlaybackEnded() {
      return Boolean(PlayerController.video?.ended || this.postPlayPlaybackEnded);
    },
    partyInBackground() {
      return typeof document !== "undefined" && document.visibilityState === "hidden";
    },
    partyHasError() {
      return Boolean(this.isStartupErrorVisible?.());
    },
    applyPartyPaused(paused, force) {
      if (!force && this.partyHasActivePlayIntent() === !paused) return;
      if (paused) {
        PlayerController.pause();
        this.paused = true;
        this.updateMediaSessionPlaybackState?.();
        this.renderControlButtons();
        this.schedulePauseOverlay?.();
      } else {
        this.dismissPauseOverlay?.();
        PlayerController.resume();
        this.paused = false;
        this.updateMediaSessionPlaybackState?.();
        this.renderControlButtons();
      }
    },
    partySeekTo(positionMs) {
      const durationMs = this.partyDurationMs();
      const target = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
      this.seekPlaybackSeconds(Math.max(0, target) / 1000);
    },
    partyNudgeSupported() {
      if (this.partyNudgeUnsupported) return false;
      const rates = PlayerController.getSupportedPlaybackRates?.();
      return !(Array.isArray(rates) && rates.length === 1 && Number(rates[0]) === 1);
    },
    setPartyPlaybackRate(rate) {
      const target = Number(rate);
      if (!Number.isFinite(target) || typeof PlayerController.setPlaybackRate !== "function")
        return Promise.resolve(false);
      return Promise.resolve(PlayerController.setPlaybackRate(target))
        .catch(() => false)
        .then((applied) => {
          if (this.playerRouteActive) this.renderControlButtons();
          return Boolean(applied);
        });
    },
    applyPartyRate(rate) {
      if (Math.abs(this.getPlaybackSpeed() - rate) <= 0.01) return;
      void this.setPartyPlaybackRate(rate);
    },
    clearPartyNudge(playback = PartyRepository.getPlayback()) {
      if (this.partyRateNudge == null) return;
      this.partyRateNudge = null;
      void this.setPartyPlaybackRate(playback?.rate ?? 1);
    },
    applyPartyNudge(rate) {
      if (!this.partyNudgeSupported()) return;
      if (this.partyRateNudge === rate) return;
      this.partyRateNudge = rate;
      void this.setPartyPlaybackRate(rate).then((applied) => {
        if (applied || this.partyRateNudge !== rate) return;
        // This engine cannot change speed: drift is corrected by seeking instead.
        this.partyNudgeUnsupported = true;
        this.partyRateNudge = null;
      });
    },
    setPartyBehind(behind) {
      if (this.partyBehind === behind) return;
      this.partyBehind = behind;
      if (!behind) this.partyBehindMs = null;
      this.renderPartyPill();
      if (this.partyPanelVisible) this.renderPartyPanel();
    },

    // ---- what the party sees from this player ----
    currentPartyMedia() {
      const candidate = this.getCurrentStreamCandidate?.() || null;
      const raw = candidate?.raw || {};
      const hints = { ...(raw.behaviorHints || {}), ...(candidate?.behaviorHints || {}) };
      const resolve = candidate?.clientResolve || raw.clientResolve || {};
      const infoHash =
        String(candidate?.infoHash || raw.infoHash || resolve.infoHash || "").trim() || null;
      const fileIdx = [candidate?.fileIdx, raw.fileIdx, resolve.fileIdx].find(
        (value) => Number.isInteger(Number(value)) && value !== null && value !== ""
      );
      const videoSize = Number(hints.videoSize);
      const type = this.partyContentType();
      // Android sends the player's metadata description; Smart keeps it in the pause overlay meta.
      const overlayMeta = this.pauseOverlayMeta || {};
      const description = String(overlayMeta.description || this.params?.description || "").trim();
      return {
        type,
        meta_id: String(this.params?.itemId || ""),
        meta_type: type,
        video_id: this.params?.videoId || null,
        season: this.partySeason(),
        episode: this.partyEpisode(),
        title: String(this.params?.itemTitle || this.params?.playerTitle || ""),
        episode_title:
          this.params?.playerEpisodeTitle ||
          this.params?.episodeTitle ||
          overlayMeta.episodeTitle ||
          null,
        description: description ? description.slice(0, DESCRIPTION_LIMIT) : null,
        poster: this.params?.poster || null,
        background:
          this.params?.playerBackdropUrl ||
          this.params?.backdrop ||
          overlayMeta.backdropUrl ||
          null,
        logo: this.params?.playerLogoUrl || this.params?.logo || overlayMeta.logoUrl || null,
        source: {
          info_hash: infoHash,
          file_idx: fileIdx == null ? null : Number(fileIdx),
          filename: hints.filename || resolve.filename || null,
          video_size: Number.isFinite(videoSize) && videoSize > 0 ? videoSize : null,
          binge_group: hints.bingeGroup || null,
          name: this.getCurrentStreamDisplayName?.() || candidate?.name || candidate?.title || null
        }
      };
    },
    currentPartyStream() {
      const candidate = this.getCurrentStreamCandidate?.() || null;
      if (!candidate) return null;
      const raw = candidate.raw || {};
      // Local torrent engines play from this device; debrid links resolved to
      // remote HTTP stay shareable, as on Android.
      const torrent = Boolean(
        candidate.engineFs || raw.engineFs || candidate.tizenP2p || raw.tizenP2p
      );
      const server = Boolean(
        candidate.serverPlayback ||
        raw.serverPlayback ||
        candidate.clientResolve?.mediaServer ||
        raw.clientResolve?.mediaServer
      );
      if (torrent || server) return null;
      const url = String(this.activePlaybackUrl || candidate.url || "").trim();
      if (!isShareableStreamUrl(url)) return null;
      const hints = { ...(raw.behaviorHints || {}), ...(candidate.behaviorHints || {}) };
      const playbackHeaders = PlayerController.currentPlaybackHeaders || {};
      const headers = Object.keys(playbackHeaders).length
        ? playbackHeaders
        : hints.proxyHeaders?.request || {};
      const videoSize = Number(hints.videoSize);
      return {
        media_key: this.partyKey(),
        url,
        headers: { ...headers },
        response_headers: { ...(hints.proxyHeaders?.response || {}) },
        name: this.getCurrentStreamDisplayName?.() || candidate.name || null,
        description: candidate.description || raw.description || null,
        addon_name: candidate.addonName || "",
        addon_id: candidate.addonId || "",
        addon_logo: candidate.addonLogo || null,
        filename: hints.filename || null,
        video_size: Number.isFinite(videoSize) && videoSize > 0 ? videoSize : null,
        binge_group: hints.bingeGroup || null,
        stream_type: null,
        badges: []
      };
    },
    partyBaseRate() {
      return PartyRepository.getPlayback()?.rate ?? this.getPlaybackSpeed();
    },
    publishPartyPlayback({
      positionMs = this.partyPositionMs() ?? 0,
      rate = this.partyBaseRate(),
      paused = !this.partyHasActivePlayIntent()
    } = {}) {
      if (!this.isPartySynced()) return;
      PartyRepository.publishPlayback(paused, positionMs, rate);
    },
    partyResumePositionMs() {
      if (!this.isPartySynced()) return null;
      const playback = PartyRepository.getPlayback();
      if (!playback) return null;
      if (playback.media_key != null && playback.media_key !== this.partyKey()) return null;
      return PartySync.expectedPositionMs(playback, PartyRepository.nowMs());
    },

    // ---- user commands while in a party ----
    toggleOwnPlayback() {
      if (this.partyHasActivePlayIntent()) {
        this.setPartyBehind(true);
        this.applyPartyPaused(true, true);
      } else if (this.partyBehind) {
        this.applyPartyPaused(false, true);
      } else {
        this.partyBlocksControl();
      }
      this.setControlsVisible?.(true, { focus: false });
      this.resetControlsAutoHide?.();
    },
    /** Returns the seek target, or null when the seek must not happen (Android ownSeekTarget). */
    ownSeekTarget(targetMs) {
      const playback = PartyRepository.getPlayback();
      if (!playback) return targetMs;
      const partyPositionMs = PartySync.expectedPositionMs(
        playback,
        PartyRepository.nowMs(),
        this.partyDurationMs()
      );
      const seek = PartySync.ownSeek(targetMs, partyPositionMs, Boolean(this.partyBehind));
      if (seek.type === OwnSeekType.Behind) {
        this.setPartyBehind(true);
        return seek.positionMs;
      }
      if (seek.type === OwnSeekType.CatchUp) {
        this.setPartyBehind(false);
        return null;
      }
      this.partyBlocksControl();
      return null;
    },
    /** Applies the party rules to a user seek; returns the target to seek to, or null. */
    partyUserSeekTarget(targetMs) {
      return this.isPartyControlLocked() ? this.ownSeekTarget(targetMs) : targetMs;
    },
    catchUpParty() {
      this.setPartyBehind(false);
    },
    startParty() {
      void PartyRepository.create(this.currentPartyMedia()).then((error) => {
        if (error) this.showPartyMessage(partyErrorMessage(error));
        else if (this.partyPanelVisible) this.renderPartyPanel();
      });
      if (this.partyPanelVisible) this.renderPartyPanel();
    },
    leavePartyPlayback() {
      const current = PartyRepository.getState().party;
      if (!current) return;
      const playback = PartyRepository.getPlayback();
      const othersWatching = Object.values(current.presence).some(
        (presence) =>
          presence.member_id !== current.memberId &&
          presence.media_key === current.mediaKey &&
          presence.status !== PartyMemberStatus.Browsing
      );
      if (current.mediaKey === this.partyKey() && playback && !playback.paused && !othersWatching) {
        PartyRepository.publishPlayback(
          true,
          this.partyPositionMs() ?? playback.position_ms,
          playback.rate
        );
      }
      PartyRepository.setLocalStatus(PartyMemberStatus.Browsing, null);
    },
    handlePartyMediaChange(media) {
      const key = partyMediaKey(media.meta_type, media.meta_id, media.season, media.episode);
      if (key === this.partyKey()) return;
      const next = this.resolveNextEpisodeInfo?.();
      if (
        media.meta_id === String(this.params?.itemId || "") &&
        next &&
        next.hasAired !== false &&
        Number(next.season) === media.season &&
        Number(next.episode) === media.episode
      ) {
        void this.playNextEpisode({ userInitiated: true });
        return;
      }
      this.showPartyPanel();
    },

    // ---- lifecycle ----
    bindParty(navigationContext = {}) {
      this.unbindParty();
      // Android keeps the previous key inside one player: only a player that
      // replaces a player (next episode) carries it over.
      const fromPlayer =
        navigationContext?.previousRoute === "player" && !navigationContext?.isBackNavigation;
      if (!fromPlayer) this.partyPreviousKey = null;
      this.partyBehind = false;
      this.partyBehindMs = null;
      this.partyRateNudge = null;
      this.partyNudgeUnsupported = false;
      this.partyPanelVisible = false;
      this.partyNotice = null;
      this.ensurePartyUi();
      const resumeMs = this.partyResumePositionMs();
      if (resumeMs != null) {
        this.pendingPlaybackRestore = {
          timeSeconds: resumeMs / 1000,
          paused: false,
          attempts: 0,
          lastAttemptAt: 0
        };
      }
      let partyId = PartyRepository.getState().party?.id || null;
      this.partyUnsubscribers = [
        PartyRepository.subscribeState((state) => {
          const nextId = state.party?.id || null;
          if (nextId !== partyId) {
            partyId = nextId;
            if (nextId) this.startPartySync();
            else this.stopPartySync();
          }
          this.renderControlButtons();
          this.renderPartyPill();
          if (this.partyPanelVisible) this.renderPartyPanel();
        }),
        PartyRepository.subscribePlayback(() => this.renderPartyPill()),
        PartyRepository.subscribeAvailable(() => this.renderControlButtons()),
        PartyRepository.subscribeNotices((notice) => {
          this.partyNotice = notice;
          clearTimeout(this.partyNoticeTimer);
          this.partyNoticeTimer = setTimeout(() => {
            this.partyNotice = null;
            this.renderPartyPill();
          }, NOTICE_MS);
          this.renderPartyPill();
        }),
        PartyRepository.subscribeEvents((event) => {
          if (event?.type === PartyEventType.MediaChanged) this.handlePartyMediaChange(event.media);
        })
      ];
      if (partyId) this.startPartySync();
      this.renderPartyPill();
    },
    unbindParty() {
      this.partyUnsubscribers?.forEach((unsubscribe) => unsubscribe());
      this.partyUnsubscribers = [];
      clearTimeout(this.partyNoticeTimer);
      this.partyNoticeTimer = null;
      this.stopPartySync();
    },
    ensurePartyUi() {
      const root = this.uiRefs?.root;
      if (!root) return;
      if (!root.querySelector("#playerPartyPill")) {
        root.insertAdjacentHTML(
          "beforeend",
          `<div id="playerPartyPill" class="player-party-pill hidden" aria-live="polite"></div>
           <div id="playerPartyScrim" class="player-party-scrim hidden"></div>
           <aside id="playerPartyPanel" class="player-party-panel hidden" aria-label="${escapeHtml(t("party_title"))}"></aside>`
        );
      }
      this.partyRefs = {
        pill: root.querySelector("#playerPartyPill"),
        scrim: root.querySelector("#playerPartyScrim"),
        panel: root.querySelector("#playerPartyPanel")
      };
      const panel = this.partyRefs.panel;
      if (panel && !panel.dataset.pointerBound) {
        panel.dataset.pointerBound = "true";
        panel.addEventListener("click", (event) => {
          const node = event.target?.closest?.("[data-party-action]");
          if (!node || !panel.contains(node) || !node.classList.contains("focusable")) return;
          event.stopPropagation();
          panel
            .querySelectorAll(".focusable.focused")
            .forEach((entry) => entry.classList.remove("focused"));
          node.classList.add("focused");
          this.partyPanelFocusKey = node.dataset.focusKey || "";
          this.activatePartyPanelAction(node);
        });
        this.partyRefs.scrim?.addEventListener("click", () => this.dismissPartyPanel());
      }
    },

    // ---- sync loop (Android runPartySync) ----
    startPartySync() {
      this.stopPartySync();
      const sync = {
        bufferingSince: null,
        mismatchSince: null,
        lastSeek: null,
        lastCorrection: null,
        lastSeq: null,
        lastStatus: null,
        lastShared: undefined,
        wasInBackground: false,
        wasRendered: false,
        publishedInitial: false,
        seekLeadMs: 0,
        measureSeekLead: false,
        wasBehind: false
      };
      this.partySync = sync;
      this.partySyncTimer = setInterval(() => {
        if (this.partySync !== sync) return;
        try {
          this.partySyncTick(sync);
        } catch (error) {
          console.warn("[party] sync tick failed", error);
        }
      }, PARTY_TICK_MS);
    },
    stopPartySync() {
      if (this.partySyncTimer) clearInterval(this.partySyncTimer);
      this.partySyncTimer = null;
      this.partySync = null;
      this.clearPartyNudge();
      this.setPartyBehind(false);
    },
    partySyncTick(sync) {
      const current = PartyRepository.getState().party;
      if (!current) {
        this.stopPartySync();
        return;
      }
      const key = this.partyKey();
      const now = monotonicNow();

      const previousKey = this.partyPreviousKey;
      if (previousKey !== key) {
        this.partyPreviousKey = key;
        this.setPartyBehind(false);
        if (previousKey != null && current.mediaKey === previousKey)
          void PartyRepository.publishMedia(this.currentPartyMedia(), 0);
      }

      const sharing = isPartyHost(current) && current.sharing;
      const shared = sharing ? this.currentPartyStream() : null;
      const sharedSignature = JSON.stringify(shared);
      if (sharedSignature !== sync.lastShared) {
        sync.lastShared = sharedSignature;
        if (sharing) PartyRepository.shareStream(shared);
      }

      const inBackground = this.partyInBackground();
      if (sync.wasInBackground && !inBackground) sync.lastSeq = null;
      sync.wasInBackground = inBackground;
      const rendered = Boolean(this.hasPresentedPlaybackFrame);
      if (rendered && !sync.wasRendered) sync.lastSeq = null;
      sync.wasRendered = rendered;
      const loading = this.partyIsLoading();
      const hasError = this.partyHasError();
      const ended = this.partyPlaybackEnded();
      let behindGap = null;
      const playbackNow = PartyRepository.getPlayback();
      if (playbackNow && this.partyBehind && current.mediaKey === key) {
        const local = this.partyPositionMs();
        if (local != null)
          behindGap =
            PartySync.expectedPositionMs(
              playbackNow,
              PartyRepository.nowMs(),
              this.partyDurationMs()
            ) - local;
      }
      let status;
      if (hasError || inBackground) status = PartyMemberStatus.Browsing;
      else if (behindGap != null) status = PartyMemberStatus.Behind;
      else if (!rendered) status = PartyMemberStatus.Loading;
      else if (loading && !ended) {
        if (sync.bufferingSince == null) sync.bufferingSince = now;
        status =
          now - sync.bufferingSince > BUFFERING_REPORT_DELAY_MS
            ? PartyMemberStatus.Buffering
            : PartyMemberStatus.Ready;
      } else {
        sync.bufferingSince = null;
        status = PartyMemberStatus.Ready;
      }
      const reportedBehind =
        status === PartyMemberStatus.Behind && behindGap != null
          ? PartySync.reportedGapMs(behindGap)
          : null;
      const statusSignature = `${status}|${key}|${reportedBehind ?? ""}`;
      if (statusSignature !== sync.lastStatus) {
        sync.lastStatus = statusSignature;
        PartyRepository.setLocalStatus(status, key, reportedBehind);
      }

      const positionMs = this.partyPositionMs();
      if (current.mediaKey !== key || positionMs == null || hasError || inBackground) {
        this.clearPartyNudge();
        return;
      }
      const durationMs = this.partyDurationMs();
      const playback = PartyRepository.getPlayback();
      if (!playback) {
        if (rendered && !sync.publishedInitial && isPartyHost(current)) {
          sync.publishedInitial = true;
          PartyRepository.publishPlayback(
            !this.partyHasActivePlayIntent(),
            positionMs,
            this.getPlaybackSpeed()
          );
        }
        return;
      }
      sync.publishedInitial = true;
      if (!rendered) return;
      if (this.partyBehind && canControlParty(current)) this.setPartyBehind(false);
      if (this.partyBehind) {
        this.clearPartyNudge(playback);
        sync.mismatchSince = null;
        const gap =
          PartySync.expectedPositionMs(playback, PartyRepository.nowMs(), durationMs) - positionMs;
        if (PartySync.shouldRejoin(gap, this.partyHasActivePlayIntent() && !loading)) {
          this.setPartyBehind(false);
        } else {
          const shown = this.partyBehindMs;
          if (shown == null || Math.abs(gap - shown) >= BEHIND_DISPLAY_STEP_MS) {
            this.partyBehindMs = Math.max(0, gap);
            this.renderPartyPill();
            if (this.partyPanelVisible) this.renderPartyPanel();
          }
          sync.wasBehind = true;
          return;
        }
      }
      if (sync.wasBehind) {
        sync.wasBehind = false;
        sync.lastSeq = null;
        if (!canControlParty(current)) this.showPartyMessage(t("party_caught_up"));
      }

      const expected = PartySync.expectedPositionMs(playback, PartyRepository.nowMs(), durationMs);
      const identity = `${playback.seq}|${playback.member_id ?? ""}`;
      if (identity !== sync.lastSeq) {
        const forced = sync.lastSeq == null;
        sync.lastSeq = identity;
        this.applyPartyPaused(playback.paused, forced);
        const own = playback.member_id === current.memberId && !forced;
        if ((!own || playback.paused) && Math.abs(positionMs - expected) > PAUSED_TOLERANCE_MS) {
          this.partySeekTo(playback.paused ? expected : expected + sync.seekLeadMs);
          sync.measureSeekLead = !playback.paused;
        }
        sync.lastSeek = now;
        if (this.partyRateNudge == null && Math.abs(this.getPlaybackSpeed() - playback.rate) > 0.01)
          this.applyPartyRate(playback.rate);
        sync.mismatchSince = null;
        return;
      }

      if (loading || this.seekPreviewSeconds != null || ended) {
        sync.mismatchSince = null;
        return;
      }

      const playing = this.partyHasActivePlayIntent();
      if (playing === playback.paused) {
        if (sync.mismatchSince == null) sync.mismatchSince = now;
        if (now - sync.mismatchSince > OUTSIDE_TOGGLE_DELAY_MS) {
          sync.mismatchSince = null;
          if (canControlParty(current))
            PartyRepository.publishPlayback(!playing, positionMs, playback.rate);
          else if (playing) this.applyPartyPaused(playback.paused, true);
          else this.setPartyBehind(true);
        }
        return;
      }
      sync.mismatchSince = null;

      const settled = sync.lastSeek == null || now - sync.lastSeek > SEEK_SETTLE_MS;
      const due =
        sync.lastCorrection == null || now - sync.lastCorrection >= CORRECTION_INTERVAL_MS;
      if (!settled || !due) return;
      sync.lastCorrection = now;
      const drift = positionMs - expected;
      if (sync.measureSeekLead && !playback.paused) {
        sync.measureSeekLead = false;
        if (Math.abs(drift) < MAX_SEEK_LEAD_MS)
          sync.seekLeadMs = Math.min(MAX_SEEK_LEAD_MS, Math.max(0, sync.seekLeadMs - drift));
      }
      const correction = PartySync.correction(
        positionMs,
        expected,
        playback,
        this.partyRateNudge != null
      );
      if (correction.type === PartyCorrectionType.Seek) {
        this.clearPartyNudge(playback);
        const target = playback.paused
          ? correction.positionMs
          : correction.positionMs + sync.seekLeadMs;
        this.partySeekTo(durationMs > 0 ? Math.min(target, durationMs) : target);
        sync.lastSeek = now;
        sync.measureSeekLead = !playback.paused;
      } else if (correction.type === PartyCorrectionType.Nudge) {
        this.applyPartyNudge(correction.rate);
      } else {
        this.clearPartyNudge(playback);
      }
    },

    // ---- status pill (Android PartyStatusPill) ----
    partyNoticeText(notice) {
      switch (notice?.action) {
        case PartyAction.Paused:
          return t("party_action_paused", [notice.name]);
        case PartyAction.Resumed:
          return t("party_action_resumed", [notice.name]);
        case PartyAction.Seeked:
          return t("party_action_seeked", [notice.name, formatPlayerTime(notice.positionMs)]);
        case PartyAction.Speed:
          return t("party_action_speed", [notice.name, formatSpeedLabel(notice.rate)]);
        default:
          return null;
      }
    },
    renderPartyPill() {
      const pill = this.partyRefs?.pill;
      if (!pill) return;
      const party = PartyRepository.getState().party;
      if (!party) {
        if (!pill.classList.contains("hidden")) pill.classList.add("hidden");
        pill.dataset.signature = "";
        return;
      }
      const playback = PartyRepository.getPlayback();
      const waitingNames =
        playback?.paused && playback?.waiting
          ? PartySync.waitingMemberIds(party, new Set())
              .filter((id) => id !== party.memberId)
              .map((id) => partyMember(party, id)?.display_name)
              .filter(Boolean)
          : [];
      const noticeText = this.partyNotice ? this.partyNoticeText(this.partyNotice) : null;
      const pausedBehind =
        Boolean(this.partyBehind) && !this.partyHasActivePlayIntent() && !this.partyIsLoading();
      let message = null;
      if (!party.connected) message = t("party_reconnecting");
      else if (waitingNames.length) message = t("party_waiting_for", [waitingNames.join(", ")]);
      else if (playback?.waiting) message = t("party_waiting");
      else if (noticeText) message = noticeText;
      else if (pausedBehind) message = t("party_paused_for_you");
      else if (this.partyBehind && this.partyBehindMs != null)
        message = t("party_behind", [formatPlaybackTime(this.partyBehindMs)]);
      const visible =
        (Boolean(this.controlsVisible) ||
          waitingNames.length > 0 ||
          !party.connected ||
          noticeText != null ||
          pausedBehind) &&
        !this.partyPanelVisible &&
        !this.partyHasError();
      const signature = JSON.stringify([
        visible,
        message,
        party.members.map((member) => [member.id, member.avatar_url, member.avatar_color])
      ]);
      if (pill.dataset.signature === signature) return;
      pill.dataset.signature = signature;
      pill.classList.toggle("hidden", !visible);
      pill.innerHTML = `${avatarStackMarkup(party.members, { size: "pill", ring: "pill" })}${message ? `<span class="player-party-pill-text">${escapeHtml(message)}</span>` : ""}`;
    },

    // ---- side panel (Android PartyPanel) ----
    togglePartyPanel() {
      if (this.partyPanelVisible) this.dismissPartyPanel();
      else this.showPartyPanel();
    },
    showPartyPanel() {
      this.cancelSeekPreview?.({ commit: false });
      if (this.sourcesPanelVisible) this.closeSourcesPanel?.();
      if (this.subtitleDialogVisible) this.closeSubtitleDialog?.();
      if (this.audioDialogVisible) this.closeAudioDialog?.();
      if (this.speedDialogVisible) this.closeSpeedDialog?.();
      if (this.episodePanelVisible) this.hideEpisodePanel?.();
      this.moreActionsVisible = false;
      this.partyPanelVisible = true;
      this.partyPanelFocusKey = "";
      this.setControlsVisible?.(true, { focus: false });
      this.clearControlsAutoHide?.();
      this.dismissPauseOverlay?.();
      this.renderControlButtons();
      this.renderPartyPanel();
      this.renderPartyPill();
    },
    dismissPartyPanel() {
      if (!this.partyPanelVisible) return;
      this.partyPanelVisible = false;
      this.renderPartyPanel();
      this.renderPartyPill();
      this.renderControlButtons();
      this.focusFirstControl?.();
      this.resetControlsAutoHide?.();
      if (this.paused) this.schedulePauseOverlay?.();
    },
    renderPartyPanel() {
      const panel = this.partyRefs?.panel;
      const scrim = this.partyRefs?.scrim;
      if (!panel) return;
      const visible = Boolean(this.partyPanelVisible) && !this.partyHasError();
      panel.classList.toggle("hidden", !visible);
      scrim?.classList.toggle("hidden", !visible);
      if (!visible) {
        panel.innerHTML = "";
        return;
      }
      const focused = panel.querySelector(".focusable.focused");
      const focusKey = focused?.dataset?.focusKey || this.partyPanelFocusKey || "";
      const state = PartyRepository.getState();
      const party = state.party;
      const body = party ? this.renderPartyPanelParty(party) : this.renderPartyPanelStart(state);
      panel.innerHTML = `
        <div class="player-party-panel-header">
          <h2 class="player-party-panel-title">${escapeHtml(t("party_title"))}</h2>
          <button class="player-party-close focusable" data-party-action="close" data-focus-key="close">${escapeHtml(t("action_close", [], "Close"))}</button>
        </div>
        <div class="player-party-panel-body">${body}</div>`;
      this.restorePartyPanelFocus(focusKey);
    },
    renderPartyPanelStart(state) {
      const available = PartyRepository.isAvailable();
      const canStart = PartyRepository.canUse();
      let action;
      if (!available)
        action = `<div class="party-note">${escapeHtml(t("party_unavailable"))}</div>`;
      else if (!canStart)
        action = `<div class="party-note">${escapeHtml(t("party_sign_in_required"))}</div>`;
      else
        action = `<button class="player-party-button is-primary${state.busy ? " is-disabled" : " focusable"}" data-party-action="start" data-focus-key="start">${escapeHtml(t("party_start_action"))}</button>`;
      return `
        <div class="player-party-start">
          ${seatsHeroMarkup(this.partyProfile, "lg")}
          <h3 class="player-party-start-title">${escapeHtml(t("party_start_title"))}</h3>
          <p class="player-party-start-description">${escapeHtml(t("party_start_description"))}</p>
          ${action}
          ${experimentalNoteMarkup()}
        </div>`;
    },
    renderPartyPanelParty(party) {
      const playerMedia = this.currentPartyMedia();
      const playerKey = this.partyKey();
      const behind = this.partyBehind ? (this.partyBehindMs ?? 0) : null;
      const canShare = this.currentPartyStream() != null;
      const behindBlock =
        behind != null
          ? `<div class="player-party-block">
               <p class="player-party-text">${escapeHtml(t("party_behind_title", [formatPlaybackTime(behind)]))}</p>
               <button class="player-party-button is-primary focusable" data-party-action="catchUp" data-focus-key="catchUp">${escapeHtml(t("party_catch_up"))}</button>
             </div>`
          : "";
      const otherMedia =
        playerKey !== party.mediaKey
          ? `<div class="player-party-block">
               <p class="player-party-text">${escapeHtml(t("party_now_watching", [displayTitle(party.media)]))}</p>
               <button class="player-party-button is-primary focusable" data-party-action="watchWithParty" data-focus-key="watchWithParty">${escapeHtml(t("party_watch_with_party"))}</button>
               ${isPartyHost(party) ? `<button class="player-party-button focusable" data-party-action="switch" data-focus-key="switch">${escapeHtml(t("party_switch", [displayTitle(playerMedia)]))}</button>` : ""}
             </div>`
          : "";
      return `
        ${codeSectionMarkup(party, "md")}
        <div class="player-party-details">
          ${behindBlock}
          ${otherMedia}
          ${membersSectionMarkup(party, { selfBehindMs: behind })}
          ${isPartyHost(party) ? hostSettingsMarkup(party, { sharingNote: canShare ? "" : t("party_share_unavailable") }) : ""}
          ${!isPartyHost(party) && party.hostOnly ? hostOnlyNoteMarkup() : ""}
          ${partyActionsMarkup(party)}
        </div>`;
    },
    restorePartyPanelFocus(focusKey) {
      const panel = this.partyRefs?.panel;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll(".focusable"));
      nodes.forEach((node) => {
        if (!node.dataset.focusKey) {
          const action = node.dataset.partyAction;
          node.dataset.focusKey =
            action === "remove" ? `remove:${node.dataset.memberId}` : `action:${action}`;
        }
      });
      const preferred =
        (focusKey && nodes.find((node) => node.dataset.focusKey === focusKey)) ||
        panel.querySelector(
          "[data-party-action='catchUp'],[data-party-action='watchWithParty'],[data-party-action='start']"
        ) ||
        nodes.find((node) => node.dataset.partyAction !== "close") ||
        nodes[0];
      nodes.forEach((node) => node.classList.remove("focused"));
      if (!preferred) return;
      preferred.classList.add("focused");
      this.partyPanelFocusKey = preferred.dataset.focusKey || "";
      focusWithoutScroll(preferred);
      // Like Android's panel list, only the panel's own list scrolls. scrollIntoView
      // would also scroll the overflow-hidden player root while the panel slides in
      // from off-screen, leaving the whole player UI shifted left.
      const list = preferred.closest(".player-party-details");
      if (list) {
        const nodeRect = preferred.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        if (nodeRect.top < listRect.top) list.scrollTop -= listRect.top - nodeRect.top;
        else if (nodeRect.bottom > listRect.bottom)
          list.scrollTop += nodeRect.bottom - listRect.bottom;
      }
      this.resetPartyRootScroll();
    },
    resetPartyRootScroll() {
      const root = this.uiRefs?.root;
      if (root && (root.scrollLeft || root.scrollTop)) {
        root.scrollLeft = 0;
        root.scrollTop = 0;
      }
    },
    activatePartyPanelAction(node) {
      const party = PartyRepository.getState().party;
      switch (node?.dataset?.partyAction) {
        case "close":
          this.dismissPartyPanel();
          break;
        case "start":
          this.startParty();
          break;
        case "catchUp":
          this.catchUpParty();
          this.dismissPartyPanel();
          break;
        case "watchWithParty":
          if (party) {
            const media = party.media;
            this.dismissPartyPanel();
            void openPartyMedia(media);
          }
          break;
        case "switch":
          if (party) {
            const media = this.currentPartyMedia();
            showConfirmDialog({
              title: t("party_switch_title"),
              message: t("party_switch_message", [displayTitle(media)]),
              confirmLabel: t("party_switch_confirm"),
              onConfirm: () =>
                void PartyRepository.publishMedia(
                  this.currentPartyMedia(),
                  this.partyPositionMs() ?? 0
                )
            });
          }
          break;
        case "leave":
          this.dismissPartyPanel();
          void PartyRepository.leave();
          break;
        case "end":
          showConfirmDialog({
            title: t("party_end_title"),
            message: t("party_end_message"),
            confirmLabel: t("party_end"),
            onConfirm: () => {
              this.dismissPartyPanel();
              void PartyRepository.end();
            }
          });
          break;
        case "remove": {
          const member = party?.members.find((entry) => entry.id === node.dataset.memberId);
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
          if (party) void showInviteDialog(party);
          break;
        case "hostOnly":
          if (party) void PartyRepository.setHostOnly(!party.hostOnly);
          break;
        case "sharing":
          if (party) PartyRepository.setSharing(!party.sharing);
          break;
        default:
          break;
      }
    },
    /** Panel keys: the panel owns every key while it is open (Android side panel). */
    handlePartyPanelKey(event) {
      const panel = this.partyRefs?.panel;
      if (!this.partyPanelVisible || !panel) return false;
      const keyCode = Number(event?.keyCode || 0);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (keyCode === 38 || keyCode === 40) {
        const focused = moveListFocus(panel, keyCode === 40 ? 1 : -1);
        if (focused) this.partyPanelFocusKey = focused.dataset.focusKey || "";
        this.resetPartyRootScroll();
        return true;
      }
      if (keyCode === 37 || keyCode === 39) {
        return true;
      }
      if (keyCode === 13 || event?.key === "Enter") {
        if (!event?.repeat)
          this.activatePartyPanelAction(panel.querySelector(".focusable.focused"));
        return true;
      }
      return true;
    },
    loadPartyProfile() {
      const token = this.playerMountToken;
      void PartyRepository.getProfile()
        .then((profile) => {
          if (token !== this.playerMountToken) return;
          this.partyProfile = profile;
          if (this.partyPanelVisible && !PartyRepository.getState().party) this.renderPartyPanel();
        })
        .catch(() => {});
    },
    isPartyButtonAvailable() {
      return PartyRepository.isAvailable() && this.canUseParty();
    }
  };
}
