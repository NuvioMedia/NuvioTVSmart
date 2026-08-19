# Plan: ASS/SSA subtitle support with ass.js

## Objective

Render fetched ASS/SSA subtitles through `assjs` while preserving the existing SRT/VTT and native subtitle paths.

The current pipeline converts non-VTT subtitle bodies to VTT in `js/ui/screens/player/playerScreen.js`. `sanitizeSubtitleText()` removes most ASS override blocks and `applySubtitleAssAlignmentToVtt()` preserves only limited `\an` alignment. The result is readable text, but not faithful ASS presentation.

The target is ASS rendering supported by the pinned ass.js version. This is not a promise of libass pixel equivalence.

## Constraints and decisions

- Use `assjs` v0.1.10, loaded lazily as a classic browser script.
- Keep ASS out of `STREAMING_LIBS`. `loadStreamingLibs()` and `warmStreamingLibs()` iterate every entry, so adding ASS there would load it during startup warmup.
- Add a separate `loadAssSubtitleLib()` API, called only after ASS content has been detected and a subtitle selection needs rendering.
- The dedicated loader tries the local asset first, then the CDN fallback, using the existing script-loading primitive.
- Keep ass.js outside `app.bundle.js`; copy its browser build into `dist/assets/libs` during the build.
- ASS selection is automatic. Do not add a new user-facing setting.
- SRT/VTT routing and output must remain unchanged.
- ASS renderer errors must not leave stale DOM, timers, or subtitle-selection state.
- Embedded/muxed ASS extraction is out of scope unless an existing platform path already exposes the raw ASS body.

## Required data flow

Do not make `createSubtitleObjectUrl()` sometimes return a URL and sometimes return subtitle text. Its current callers rely on a URL contract.

Introduce an explicit raw subtitle fetch/result boundary, reusing the existing direct-fetch and WebOS proxy behavior. The result should contain the body, source URL, content type, and resolved URL. Then:

1. Detect ASS from normalized content and metadata.
2. Route ASS bodies to the renderer. Only this branch may call `loadAssSubtitleLib()`.
3. Route all other bodies through the existing VTT/object-URL conversion path.

The detector must handle BOM, CRLF, `.ass`/`.ssa` URLs, ASS/SSA content types, and standard section headers such as `[Script Info]`, `[V4+ Styles]`, `[V4+ Styles+]`, and `[Events]`. It must reject SRT, VTT, and incidental ASS-like text in subtitle dialogue.

## Rendering paths

### Regular addon/sidecar subtitles

The current path eventually mounts an external `<track>` near `createElement("track")` in `playerScreen.js`. Change the flow so ASS content:

- clears the previous external track and overlay;
- activates ass.js with the raw body, current video element, and ASS container;
- preserves `selectedAddonSubtitleId`, selected indexes, dialog state, and selection-token behavior;
- never mounts raw ASS text as a VTT `<track>`.

SRT/VTT continues through the existing `<track>` path.

### TV HTML/AVPlay subtitles

`applyTvHtmlAddonSubtitle()` currently fetches text, calls `parseSubtitleCues()`, and renders the HTML overlay. Add the same ASS branch there. ASS must use the HTML overlay on AVPlay/Tizen because native AVPlay subtitle handling cannot consume ASS text directly.

If the current WebOS embedded subtitle path exposes an ASS body, route it through the same adapter. Do not add a new embedded-track extraction mechanism in this change.

## Renderer adapter

Add `js/core/player/assRenderer.js` as the only module that knows the ass.js API. It must:

- load and validate the global constructor;
- create an instance with the raw ASS body, video element, container, and verified resampling option;
- expose `setDelay(milliseconds)` with one documented conversion to ass.js seconds/sign;
- expose `destroy()` that calls the library cleanup method and clears renderer-owned DOM;
- expose capability/error results to the caller without throwing uncaught errors;
- reject stale activations after a newer subtitle selection token wins;
- avoid creating duplicate instances for the same active selection.

Verify the constructor, global name, delay semantics, destroy method, and resize behavior against the pinned package before implementing the adapter. Do not assume methods that are absent from the package.

## Overlay and lifecycle

Add `playerAssSubtitles` beside the existing HTML and bitmap subtitle layers. It must be absolutely positioned over the video, ignore pointer input, and remain below player controls.

Destroy the active ASS instance when subtitles are disabled, another subtitle is selected, playback is stopped, the media source changes, the player is destroyed, or a newer async selection supersedes it. Centralize destruction in the existing cleanup path where possible, then verify every teardown path reaches it.

When subtitle delay changes, update the existing instance instead of recreating it when the ass.js API supports that. Keep ASS-authored color, size, positioning, and outline styles separate from app-level HTML subtitle CSS.

Use the pinned library's supported resize behavior. Add a player-owned resize hook only if target browsers lack a required API and the package exposes a supported way to refresh its layout.

## Fallback

ASS must have a deliberate fallback, not raw ASS passed to a VTT track.

When ass.js cannot load, cannot parse the body, or is unavailable on the target browser:

1. Destroy any partial renderer and clear its container.
2. Convert ASS `Dialogue:` events to plain VTT cues using their start/end timestamps and sanitized dialogue text.
3. Preserve basic line breaks and safe text formatting only; discard unsupported ASS positioning/animation tags.
4. Use the existing native/HTML VTT path.
5. Keep the subtitle selected if the fallback succeeds; otherwise leave subtitles off and report one actionable warning.

The fallback converter must be isolated and tested. It must not change the existing SRT/VTT converter.

## Files

| File                                   | Change                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`    | Add pinned `assjs` dependency.                                                                                                                                                  |
| `scripts/build.mjs`                    | Copy the verified ass.js browser build and license into `dist/assets/libs`.                                                                                                     |
| `js/core/player/assSubtitleLoader.js`  | Add `loadAssSubtitleLib()`: local asset first, CDN fallback, one in-flight promise, and global-constructor validation. This loader must remain independent of `STREAMING_LIBS`. |
| `js/runtime/loadStreamingLibs.js`      | No ASS entry or behavior change. Keep ASS excluded from `STREAMING_LIBS`, `loadStreamingLibs()`, and `warmStreamingLibs()`.                                                     |
| `js/core/player/assSubtitle.js`        | ASS detection plus isolated ASS-to-VTT fallback conversion.                                                                                                                     |
| `js/core/player/assRenderer.js`        | ass.js lifecycle adapter, delay conversion, and error boundary; call `loadAssSubtitleLib()` only after ASS detection.                                                           |
| `js/ui/screens/player/playerScreen.js` | Raw-body fetch boundary, routing, selection state, cleanup, and delay updates.                                                                                                  |
| Existing player markup/CSS owner       | Add and position `playerAssSubtitles`; follow existing overlay conventions.                                                                                                     |
| Focused tests                          | Detection, fallback conversion, loader laziness, routing, stale selection, delay, and cleanup.                                                                                  |

## Delivery order

1. Inspect the pinned `assjs` package: browser artifact, global export, API, license, syntax, and documented browser requirements.
2. Add detector and ASS-to-VTT fallback tests before changing player routing.
3. Add the dependency, build copy, and dedicated `assSubtitleLoader.js`; leave `loadStreamingLibs.js` unchanged.
4. Add loader tests proving startup streaming warmup does not request ass.js and repeated ASS selections share one in-flight load.
5. Add the renderer adapter and overlay container.
6. Introduce the explicit raw subtitle-body result without changing SRT/VTT behavior.
7. Route regular addon and TV HTML/AVPlay ASS selections through the adapter.
8. Add fallback, stale-token handling, cleanup, delay, and resize behavior.
9. Run focused tests, build verification, and real player smoke tests.

## Acceptance criteria

- Valid sidecar/addon ASS and SSA bodies use ass.js when the library is available.
- Timing and supported ASS positioning/styles are preserved; unsupported features degrade without crashing.
- SRT/VTT behavior and native track selection remain unchanged.
- Raw ASS is never mounted as a VTT `<track>`.
- Renderer load, parse, and runtime errors invoke the tested plain-text VTT fallback or leave subtitles cleanly disabled.
- Switching, disabling, stopping, seeking, source changes, and stale async selections cannot leave an ASS instance, DOM, timer, or incorrect selected state behind.
- Delay updates use verified ass.js units and sign.
- `loadStreamingLibs()` and `warmStreamingLibs()` never request ass.js.
- The production build contains the local library and license, while normal playback does not load ass.js before ASS selection.

## Verification

- Run focused Node tests covering:
  - ASS/SSA detection with BOM, CRLF, URL metadata, and content-type metadata;
  - SRT/VTT and incidental-text negatives;
  - ASS dialogue timestamp/text conversion and malformed-event handling;
  - dedicated loader laziness, local/CDN fallback, constructor validation, and in-flight deduplication;
  - startup `loadStreamingLibs()`/`warmStreamingLibs()` never requesting ass.js;
  - stale activation rejection;
  - renderer error fallback;
  - delay conversion and destroy-on-cleanup.
- Run `npm run build` and verify the expected asset/license paths and successful bundle generation.
- Confirm the normal player path does not request ass.js before an ASS subtitle is selected.
- Run `npm run serve` with ASS fixtures covering plain dialogue, multiple styles, `\an`, `\pos`, karaoke, BOM, CRLF, and malformed input.
- Exercise subtitle on/off, switching, seek, pause/resume, source change, and delay adjustment; inspect visible output and console warnings.
- Block the local asset and CDN separately, then together, and verify the documented fallback behavior.
- Verify on Chromium 63/Tizen and Chromium 68/webOS-class environments where available. Record unsupported ass.js features rather than claiming universal ASS support.

## Risks

- **Browser compatibility:** the pinned browser build may use syntax or APIs unavailable on Chromium 63/68. Validate before relying on it; retain fallback for unsupported environments.
- **API mismatch:** constructor/global/delay/destroy/resize assumptions must come from the pinned package, not memory.
- **ASS fidelity:** DOM rendering is not libass pixel-equivalent. Acceptance is limited to supported ass.js behavior.
- **Performance:** complex karaoke and animation may be expensive on TV browsers. Measure representative files and avoid adding a competing polling loop.
- **Fallback quality:** plain VTT fallback intentionally loses advanced styling but must preserve readable timing and dialogue.
