import { MdbListAccount } from "./mdbListAccount.js";
import { MdbListTracking, mdbMutationTarget } from "./mdbListTracking.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

let timer = null,
  session = null,
  failures = 0;
function clearTimer() {
  if (timer != null) clearTimeout(timer);
  timer = null;
}
function contextKey(context) {
  return JSON.stringify([
    context.contentId,
    context.contentType,
    context.seasonNumber,
    context.episodeNumber
  ]);
}
async function send(action, context, captured) {
  try {
    MdbListAccount.check(captured.scope);
    if (failures >= 3 || !mdbMutationTarget(context, MdbListTracking.getSnapshot())) return;
    await MdbListTracking.scrobble(captured.scope, action, context);
    if (session === captured) failures = 0;
  } catch (error) {
    if (session === captured) failures++;
    if (error.code !== "mdblist_scope_changed")
      console.warn(`MDBList ${action} failed`, error.code || error.message);
  }
}
export const MdbListScrobbleService = {
  isEnabled() {
    return MdbListAccount.connected();
  },
  start(context) {
    clearTimer();
    if (context.isLive === true) {
      this.cancel();
      return;
    }
    const scope = MdbListAccount.scope(),
      key = contextKey(context);
    if (
      !session ||
      session.key !== key ||
      session.scope.generation !== scope.generation ||
      session.scope.profileId !== scope.profileId ||
      session.scope.sessionGeneration !== scope.sessionGeneration ||
      session.scope.profileRevision !== scope.profileRevision
    ) {
      session = { scope, key };
      failures = 0;
    }
    const captured = session;
    timer = setTimeout(() => {
      timer = null;
      void send("start", context, captured);
    }, 15000);
  },
  pause(context) {
    clearTimer();
    if (session?.key === contextKey(context)) void send("pause", context, session);
  },
  stop(context) {
    clearTimer();
    if (session?.key === contextKey(context)) void send("stop", context, session);
    session = null;
    failures = 0;
  },
  cancel() {
    clearTimer();
    session = null;
    failures = 0;
  }
};
registerSessionTeardownHandler(() => MdbListScrobbleService.cancel());
