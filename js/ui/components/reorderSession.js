/**
 * Android TvReorderList semantics for the DOM screens: Enter starts moving a
 * row, Up/Down reorder it live, Enter confirms and Back restores the order.
 * Locked rows (pinned collections) never move and cannot be crossed.
 */
export function createReorderSession({ keys = [], lockedKeys = [] } = {}) {
  return {
    keys: [...keys],
    original: [...keys],
    movingKey: "",
    lockedKeys: new Set(lockedKeys)
  };
}

export function isReordering(session) {
  return Boolean(session?.movingKey);
}

export function beginReorder(session, key) {
  const normalized = String(key || "");
  if (
    !session ||
    session.movingKey ||
    !session.keys.includes(normalized) ||
    session.lockedKeys.has(normalized)
  ) {
    return false;
  }
  session.movingKey = normalized;
  return true;
}

export function moveReorderBy(session, delta) {
  if (!isReordering(session) || !delta) {
    return false;
  }
  const from = session.keys.indexOf(session.movingKey);
  const to = from + (delta > 0 ? 1 : -1);
  if (from < 0 || to < 0 || to >= session.keys.length || session.lockedKeys.has(session.keys[to])) {
    return false;
  }
  const keys = [...session.keys];
  [keys[from], keys[to]] = [keys[to], keys[from]];
  session.keys = keys;
  return true;
}

export function confirmReorder(session) {
  if (!session) {
    return [];
  }
  session.movingKey = "";
  return [...session.keys];
}

export function cancelReorder(session) {
  if (!session) {
    return [];
  }
  const original = [...session.original];
  session.keys = [...original];
  session.movingKey = "";
  return original;
}
