import { readFile } from "node:fs/promises";
import path from "node:path";

// Keep the upstream source and license intact. These two checked hooks expose
// per-dialogue placement without copying/forking ass.js or editing node_modules.
// A dependency change must fail explicitly instead of silently losing the hook.
export async function assSubtitleRuntimeSource(rootDir) {
  const directory = path.join(rootDir, "node_modules", "assjs");
  const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (metadata.version !== "0.1.10")
    throw new Error("Review ASS placement hooks for the installed ass.js version");
  let source = await readFile(path.join(directory, "dist", "ass.js"), "utf8");
  const replaceOnce = (before, after) => {
    if (source.split(before).length !== 2)
      throw new Error("ASS placement hook no longer matches upstream source");
    source = source.replace(before, after);
  };
  replaceOnce(
    "  return dialogue;\n}",
    "  const placementBox = store.playerSubtitlePlacement ? store.box?.getBoundingClientRect?.() : null;\n  applyAssSubtitlePlacement(dialogue, store, null, placementBox);\n  store.actives.forEach((active) => applyAssSubtitlePlacement(active, store, dialogue, placementBox));\n  return dialogue;\n}"
  );
  replaceOnce(
    "  // addDialogue(dialogue) {",
    `  setSubtitlePlacement(placement) {
    const previous = this.#store.playerSubtitlePlacement;
    if (previous && previous.viewportBottom === placement.viewportBottom && previous.overlayTop === placement.overlayTop && previous.userOffsetPx === placement.userOffsetPx) return;
    this.#store.playerSubtitlePlacement = placement;
    const placementBox = this.#store.box?.getBoundingClientRect?.() || null;
    this.#store.actives.forEach((dialogue) => applyAssSubtitlePlacement(dialogue, this.#store, null, placementBox));
  }

  // addDialogue(dialogue) {`
  );
  replaceOnce("export { ASS as default };", "globalThis.ASS = ASS;");
  return (
    'import { applyAssSubtitlePlacement } from "./js/core/player/assSubtitlePlacement.js";\n' +
    source
  );
}
