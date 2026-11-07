/**
 * A long Back (the first repeated key-down) exits the post-play recommendations immediately,
 * while a short Back keeps its existing meaning (stop the trailer, return to the player or
 * leave). Ported from Android's post-play hold-back handling.
 */
export function shouldExitPostPlayOnLongBack({
  postPlayVisible = false,
  isBack = false,
  repeat = false,
  modalOpen = false
} = {}) {
  return Boolean(postPlayVisible && isBack && repeat && !modalOpen);
}
