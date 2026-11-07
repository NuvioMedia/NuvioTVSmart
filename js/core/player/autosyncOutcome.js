/**
 * A no-fit is confirmed only when the subtitle was compared with every embedded reference
 * and every comparison produced an ambiguous result. A missing result (too few cues, an
 * implausible transform) or a reference that failed to load proves nothing, so it stays silent.
 * Ported from Android AutoSyncNoFitTracker.isConfirmedNoFit.
 */
export function isConfirmedAutoSyncNoFit({
  evaluatedReferences = 0,
  ambiguousReferences = 0,
  requestedReferences = 0
} = {}) {
  const evaluated = Math.max(0, Math.trunc(Number(evaluatedReferences) || 0));
  const ambiguous = Math.max(0, Math.trunc(Number(ambiguousReferences) || 0));
  const requested = Math.max(0, Math.trunc(Number(requestedReferences) || 0));
  return evaluated > 0 && ambiguous === evaluated && evaluated >= requested;
}
