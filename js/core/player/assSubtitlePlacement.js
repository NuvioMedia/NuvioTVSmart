// Called from the pinned ass.js runtime at creation and when overlays/settings
// change. Work in screen pixels, then convert back into the renderer's box.
// A whole-frame CSS translation would also move positioned signs and drawings.
function eligible(dialogue, store) {
  return (
    dialogue?.$div?.style &&
    dialogue.align?.v === 0 &&
    !dialogue.pos &&
    !dialogue.move &&
    !dialogue.org &&
    !dialogue.clip &&
    !dialogue.effect &&
    dialogue.slices?.length &&
    !dialogue.slices.some((slice) =>
      slice.fragments.some((fragment) => {
        const tag = { ...store.styles?.[slice.style]?.tag, ...fragment.tag };
        return (
          fragment.drawing ||
          fragment.keyframes?.length ||
          ["frx", "fry", "frz", "fax", "fay"].some((key) => Number(tag[key] || 0) !== 0)
        );
      })
    )
  );
}
export function applyAssSubtitlePlacement(dialogue, store, pending = null, measuredBox = null) {
  if (!eligible(dialogue, store)) return false;
  const div = dialogue.$div;
  const placement = store.playerSubtitlePlacement;
  if (
    !placement ||
    !Number.isFinite(placement.viewportBottom) ||
    (!measuredBox && !store.box?.getBoundingClientRect) ||
    !(store.height > 0)
  )
    return false;
  const box = measuredBox || store.box.getBoundingClientRect();
  const scaleY = box.height / store.height;
  if (!(scaleY > 0) || !Number.isFinite(dialogue.y)) return false;
  const originalBottom = box.top + dialogue.y * scaleY;
  const active = [...(store.actives || []), dialogue, pending].filter((entry) =>
    eligible(entry, store)
  );
  const lowestBottom = Math.max(...active.map((entry) => box.top + entry.y * scaleY));
  const allowedBottom = Math.min(
    box.bottom,
    placement.viewportBottom,
    Number.isFinite(placement.overlayTop) ? placement.overlayTop : Infinity
  );
  // Use one lift for the entire ordinary-bottom stack. Clamping every cue to
  // the overlay edge independently would make simultaneous dialogues overlap.
  const shift = Math.max(Number(placement.userOffsetPx || 0), lowestBottom - allowedBottom);
  const bottom = Math.max(box.top + Number(dialogue.height || 0) * scaleY, originalBottom - shift);
  const top = `${(bottom - box.top) / scaleY}px`;
  if (div.style.top !== top) div.style.top = top;
  return true;
}
