/**
 * Scroll a vertical container so the focused element (or its visual anchor)
 * stays comfortably inside the viewport, while snapping scrollTop back to 0
 * when focus returns to the topmost interactive row so any non-focusable
 * header or top padding above it is never left clipped off the top edge.
 */
export function scrollFocusedIntoContainer(
  container,
  target,
  { anchor = null, pad = 56, isTopRow = false } = {}
) {
  if (!container || !target) {
    return;
  }
  if (isTopRow) {
    container.scrollTop = 0;
    return;
  }
  const node = anchor || target;
  if (
    typeof container.getBoundingClientRect !== "function" ||
    typeof node.getBoundingClientRect !== "function"
  ) {
    target.scrollIntoView?.({ block: "nearest" });
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const currentScrollTop = Number(container.scrollTop) || 0;
  const rectHeight = Number(containerRect.bottom) - Number(containerRect.top);
  const clientHeight =
    Number.isFinite(container.clientHeight) && container.clientHeight > 0
      ? container.clientHeight
      : rectHeight;
  if (!(clientHeight > 0)) {
    return;
  }
  const hasScrollHeight = Number.isFinite(container.scrollHeight) && container.scrollHeight > 0;
  const maxScrollTop = hasScrollHeight
    ? Math.max(0, container.scrollHeight - clientHeight)
    : Number.POSITIVE_INFINITY;

  const topEdge = containerRect.top + pad;
  const bottomEdge = containerRect.bottom - pad;
  if (nodeRect.top < topEdge) {
    container.scrollTop = Math.max(0, currentScrollTop - (topEdge - nodeRect.top));
  } else if (nodeRect.bottom > bottomEdge) {
    const nextScrollTop = Math.max(0, currentScrollTop + (nodeRect.bottom - bottomEdge));
    container.scrollTop = Math.min(maxScrollTop, nextScrollTop);
  }
}
