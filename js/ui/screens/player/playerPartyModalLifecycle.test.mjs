import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [partySource, cleanupSource] = await Promise.all([
  readFile(new URL("./playerParty.js", import.meta.url), "utf8"),
  readFile(new URL("./playerScreenMethods-73-cleanup.js", import.meta.url), "utf8")
]);

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("playerParty destroys active confirm dialogs on dismiss/cleanup and discards late invite dialogs", async () => {
  let destroyedCount = 0;
  let inviteDeferred = null;

  const ctx = vm.createContext({
    internals: {
      PlayerController: { stopAndRelease() {}, setPlaybackRate() {} },
      streamRepository: { setLocalPluginSearchPaused() {} },
      TrackingScrobbleService: { isEnabled: () => false, stop() {} },
      ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS: 0
    },
    PlayerController: { stopAndRelease() {}, setPlaybackRate() {} },
    PartyRepository: {
      getState: () => ({ party: null }),
      getPlayback: () => null,
      leave() {},
      end() {},
      removeMember() {},
      setHostOnly() {},
      setSharing() {},
      publishMedia() {}
    },
    PartyAction: {},
    PartyEventType: {},
    PartyMemberStatus: {},
    PartySync: {},
    OwnSeekType: {},
    PAUSED_TOLERANCE_MS: 1000,
    PartyCorrectionType: {},
    canControlParty: () => true,
    isPartyHost: () => true,
    isShareableStreamUrl: () => true,
    partyMediaKey: () => "",
    partyMember: () => null,
    openPartyMedia: () => {},
    focusWithoutScroll: () => {},
    avatarStackMarkup: () => "",
    codeSectionMarkup: () => "",
    displayTitle: () => "Movie",
    escapeHtml: (v) => String(v || ""),
    experimentalNoteMarkup: () => "",
    formatPlaybackTime: () => "",
    formatPlayerTime: () => "",
    formatSpeedLabel: () => "",
    hostOnlyNoteMarkup: () => "",
    hostSettingsMarkup: () => "",
    membersSectionMarkup: () => "",
    moveListFocus: () => null,
    noticeMarkup: () => "",
    panelStateBadgeMarkup: () => "",
    playerNoticeMarkup: () => "",
    seatsHeroMarkup: () => "",
    t: (k) => k,
    showConfirmDialog: () => ({
      destroyed: false,
      destroy() {
        this.destroyed = true;
        destroyedCount += 1;
      }
    }),
    showInviteDialog: () => inviteDeferred.promise,
    setTimeout,
    clearTimeout,
    performance: { now: () => 0 }
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${stripModule(partySource)}\n${stripModule(cleanupSource)}\nglobalThis.api = { ...createPlayerPartyMethods(), ...createPlayerScreenMethods73() };`,
    ctx
  );

  const partyObj = { id: "party-1", hostId: "u1", members: [] };
  ctx.PartyRepository.getState = () => ({ party: partyObj });
  const player = Object.assign(Object.create(ctx.api), {
    playerRouteActive: true,
    playerMountToken: 1,
    partyPanelVisible: true,
    partyUnsubscribers: [],
    partyRefs: { panel: { hidden: false } },
    renderPartyPanel() {},
    renderControlButtons() {},
    resetPartyRootScroll() {},
    resetControlsAutoHide() {},
    schedulePauseOverlay() {},
    closeStreamInfo() {},
    leavePartyPlayback() {},
    cancelSourceLoad() {},
    cancelTizenAvPlayConnectionRetryBudgetReset() {},
    resetNextEpisodeLaunchPresentation() {},
    resetStillWatchingPromptState() {},
    dismissPausedScreen() {},
    closeDialog() {},
    clearSubtitleDelayOverlayTimer() {},
    resetSubtitleAutoSyncState() {},
    resetAutomaticSubtitleSyncState() {},
    clearPauseOverlayMetaTimer() {},
    clearNextEpisodeAutoPlayTimer() {},
    clearBufferingSpinnerTimer() {},
    clearPlaybackStallGuardTimer() {},
    clearCurrentEngineFsRetryTimer() {},
    disposeAssSubtitleRenderer() {},
    detachVideoEvents() {},
    releaseCurrentEngineFsStreamBestEffort() {},
    syncActiveWatchProgress() {}
  });

  // 1. Open "end" confirm dialog then dismissPartyPanel() -> must destroy active dialog.
  player.activatePartyPanelAction({ dataset: { partyAction: "end" } });
  player.dismissPartyPanel();
  assert.equal(destroyedCount, 1, "dismissPartyPanel must destroy active party confirm dialog");

  // 2. Open "invite" async dialog, then cleanup() before it resolves -> late dialog must be destroyed.
  inviteDeferred = deferred();
  player.partyPanelVisible = true;
  player.activatePartyPanelAction({ dataset: { partyAction: "invite" } });
  player.cleanup();

  let inviteDestroyed = 0;
  inviteDeferred.resolve({
    destroy() {
      inviteDestroyed += 1;
    }
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    inviteDestroyed,
    1,
    "late-resolving invite dialog after PlayerScreen cleanup must be destroyed immediately"
  );
});
