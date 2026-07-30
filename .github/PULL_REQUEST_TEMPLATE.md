## Summary

<!-- What changed in this PR? Keep it short and specific. -->

## PR type

<!-- Check exactly one. PRs outside these types are not accepted unless explicitly approved. -->

- [ ] Translation/localization only
- [ ] Critical bug fix
- [ ] Approved feature/change

## Affected area

<!-- Check every area affected by this PR. -->

- [ ] Shared web app
- [ ] Samsung Tizen
- [ ] LG webOS
- [ ] Browser development mode
- [ ] Playback
- [ ] Audio tracks
- [ ] Subtitles
- [ ] Focus / Remote navigation
- [ ] UI / Layout
- [ ] Resume / Watch progress
- [ ] Continue Watching
- [ ] Next Episode / Auto-play
- [ ] Packaging / Build
- [ ] Nuvio WebTV Installer compatibility
- [ ] TizenBrew wrapper
- [ ] webOS Homebrew wrapper
- [ ] Documentation
- [ ] Other

## Why

<!-- Why is this change needed? Explain the critical bug, localization update, or approved change. -->

## Issue or approval

<!-- Required for critical bug fixes and approved changes. Link the bug issue or approved feature request. -->
<!-- Examples: Fixes #123 / Approved in #456 / No linked issue: localization-only update. -->

## Reproduction steps

<!-- Required for critical bug fixes. For localization-only PRs, write: No reproduction steps - localization-only update. -->

## Old behavior

<!-- What happened before this PR? For localization-only PRs, write: Not applicable - localization-only update. -->

## New behavior

<!-- What happens after this PR? -->

## Platform impact

<!-- Explain which platforms were affected and whether this change touches shared code. -->

- Samsung Tizen:
- LG webOS:
- Browser development mode:
- Installer / packaging:
- Wrapper repositories:

## UI / behavior / playback impact

<!-- Check every box that applies. At least one must be checked. -->

- [ ] No UI change
- [ ] No behavior change
- [ ] No playback change
- [ ] UI changed only to fix a documented glitch/bug
- [ ] Behavior changed only to fix a documented bug/regression
- [ ] Playback changed only to fix a documented bug/regression
- [ ] UI change has explicit maintainer approval
- [ ] Behavior change has explicit maintainer approval
- [ ] Playback change has explicit maintainer approval

## Installer, packaging, or wrapper impact

<!-- Check every box that applies. -->

- [ ] No installer, packaging, or wrapper impact
- [ ] Tizen `.wgt` packaging changed
- [ ] webOS `.ipk` packaging changed
- [ ] App identifiers or metadata changed
- [ ] `local.properties` / environment handling changed
- [ ] `sync:tizen` changed
- [ ] `sync:webos` changed
- [ ] Nuvio WebTV Installer compatibility changed
- [ ] TizenBrew wrapper support changed
- [ ] webOS Homebrew metadata support changed

## Policy check

<!-- ALL boxes must be checked or the PR may be closed without review. -->

- [ ] I have read and understood `CONTRIBUTING.md`.
- [ ] This PR fits the current PR policy or has explicit maintainer approval.
- [ ] This PR is small, focused, and limited to one issue.
- [ ] This PR does not bundle unrelated refactors, cleanups, formatting, or drive-by changes.
- [ ] This PR does not add dependencies, architecture changes, platform rewrites, installer rewrites, or broad refactors without approval.
- [ ] This PR does not change UI unless it fixes a linked glitch/bug or has explicit approval.
- [ ] This PR does not change behavior unless it fixes a linked bug/regression or has explicit approval.
- [ ] This PR does not change playback unless it fixes a linked bug/regression or has explicit approval.
- [ ] This PR does not change installer, packaging, app identifiers, release flow, or wrapper behavior without clear need or approval.
- [ ] I included a linked issue, reproduction steps, and testing notes if this is a critical bug fix.
- [ ] I listed the testing performed below.

> Feature additions, broad UI changes, refactors, playback rewrites, platform rewrites, installer rewrites, and other non-critical changes may be closed or deferred without review while NuvioTV Web is being prepared for a stable Smart TV release.

## Scope boundaries

<!-- List anything intentionally not changed. If this is a bug fix, confirm it does not include extra UI polish, behavior tweaks, playback changes, or platform rewrites. -->

## Testing

<!-- What did you test and how? Include devices, TVs, emulators, simulators, commands, packages, and manual flows. Do not write only "not tested" unless this is localization-only. -->

### Devices / platforms tested

<!-- Examples: LG C1 webOS 6, LG B4 webOS 24, Samsung S90F Tizen 9.0, Chrome on macOS, Tizen emulator, webOS simulator. -->

### Commands tested

<!-- Include relevant commands if applicable. -->

```sh
# Examples:
npm run build
npm run package:tizen
npm run package:webos
npm run install:webos -- -d lg
npm run logs:webos -- -d lg
npm run inspect:webos -- -d lg
```

## Manual test flow

<!-- Describe the exact flow tested in the app. -->

## Screenshots / Video

<!-- Required for any UI, layout, focus, or visual change. Write "Not a UI change" only if no UI changed. -->

## Logs

<!-- Required for crashes, blank screens, install/package failures, playback failures, or platform API errors. Write "Not applicable" if not relevant. -->

## Regression risk

<!-- Describe what could break, especially across Samsung Tizen, LG webOS, browser development mode, installer, packaging, or wrappers. -->

## Breaking changes

<!-- Any breaking behavior/config/schema/package/app-id changes? If none, write: None. -->

## Linked issues

<!-- Required for critical bug fixes and approved changes. For localization-only PRs with no issue, write: No linked issue - localization-only update. -->
