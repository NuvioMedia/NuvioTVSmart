# Contributing

Thanks for helping improve NuvioTV Web.

## Strict rules - read before opening anything

These rules are enforced strictly. Issues and PRs that do not follow them will be closed without review.
---

## What PRs are for

Pull requests are accepted only when they fit one of these categories:

- Reproducible bug fixes for documented issues
- Smart TV UI glitch fixes for visible bugs or regressions, with before/after proof
- Remote-control navigation fixes for documented focus or input issues
- Platform-specific fixes for Samsung Tizen or LG webOS that restore expected behavior
- Playback fixes that address a linked, reproducible issue
- Packaging or installer fixes that address a documented install/build problem
- Behavior bug fixes that restore expected behavior without changing product direction
- Small maintenance work that does not change UI, UX, behavior, dependencies, architecture, platform contracts, or public APIs
- Small documentation fixes that improve accuracy
- Translation/localization updates
  Pull requests are not accepted for:
- New major features
- Product direction changes
- UX/UI redesigns
- Cosmetic-only UI changes
- "Minor polish" changes to colors, spacing, typography, icons, copy, layout, animations, or visual style
- Behavior changes that are not tied to a reproducible bug or approved feature request
- Playback behavior changes without a linked issue or maintainer approval
- Refactors without a clear maintenance need
- Dependency additions or architecture changes without prior approval
- Broad platform rewrites for Tizen, webOS, or installer tooling
- Changes that affect packaged app identifiers, signing, distribution, or release flow without approval
  Translation PRs are allowed, as long as they stay focused on translation/localization work and do not bundle unrelated feature, UI, playback, platform, or installer changes.

---

## UI changes

Do not open a pull request for a UI change just because it looks better, cleaner, more modern, or more consistent to you.
NuvioTV Web is optimized for TV-first usage, so UI changes are especially sensitive. A small visual change can affect remote-control navigation, focus behavior, readability, overscan, performance, or compatibility on older Smart TV browsers.
UI PRs are accepted only when they fix a specific, documented glitch or bug, such as:

- Broken layout
- Overlapping or clipped text
- Unreadable content
- Incorrect visual state
- Remote/focus navigation glitches
- Missing, trapped, or incorrect focus states
- A visible regression from a previous version
- A crash, blank screen, or unusable screen caused by UI code
- Platform-specific rendering issues on Samsung Tizen or LG webOS
- Layout issues caused by TV resolution, scaling, overscan, or legacy browser behavior
  Every UI PR must include:
- A linked bug issue
- The affected platform or platforms
- Device model and platform version, when possible
- A short explanation of the exact glitch being fixed
- Before and after screenshots or a short video
- The smallest possible change that fixes the glitch
  Cosmetic-only UI PRs will be closed, even if the change is small.

---

## Behavior changes

Behavior includes, but is not limited to, playback, stream/source selection, audio/subtitle track selection, resume state, watched state, search, sync, settings defaults, navigation, focus movement, error handling, caching, networking, storage, account-related flows, platform detection, installer behavior, package generation, and wrapper synchronization.
Do not open a PR that changes behavior unless one of these is true:

- It fixes a linked, reproducible bug or regression and restores the intended behavior.
- It links an approved feature request where a maintainer explicitly approved implementation.
  Behavior PRs must explain:
- The old behavior
- The broken or unwanted behavior
- The new behavior
- The affected platform or platforms
- How the behavior was tested
  Minor behavior tweaks are still behavior changes. They need the same issue link or approval.

---

## Platform-specific changes

NuvioTV Web supports multiple Smart TV targets from a shared web codebase.
Platform-specific changes must be handled carefully because a fix for one target can easily break another.
Platform-specific PRs must include:

- The affected platform: Samsung Tizen, LG webOS, browser development mode, or installer
- Device model, emulator, or simulator used for testing
- Platform version when available
- Whether the change affects only one platform or shared code
- Manual testing notes
- Any known risk for the other supported platforms
  Do not make platform-specific changes in shared code unless the impact on the other platforms has been considered and tested.
  Examples of platform-specific areas include:
- Samsung Tizen Web APIs
- LG webOS APIs
- Platform media playback adapters
- Audio and subtitle track handling
- Remote-control key handling
- Focus navigation differences
- Fullscreen behavior
- Package metadata
- Tizen `.wgt` packaging
- webOS `.ipk` packaging
- Homebrew or TizenBrew wrapper behavior
- Nuvio WebTV Installer behavior

---

## Playback changes

Playback changes are high-risk and must be tied to a documented issue or explicit maintainer approval.
Playback includes, but is not limited to:

- Media URL handling
- Stream/source selection
- HLS/DASH behavior
- Audio track selection
- Subtitle loading and selection
- Resume and seek behavior
- Player lifecycle
- Platform media APIs
- webOS Luna/media commands
- Tizen AVPlay behavior
- Codec fallback behavior
- Error recovery
- Debrid or external source resolution behavior
  Playback PRs must include:
- A linked bug issue or approved feature request
- Reproduction steps
- Affected platform and device model
- Sample media characteristics when relevant, such as codec, container, audio format, subtitles, or stream type
- Expected vs actual behavior
- Testing notes
- Regression risk, especially for the other TV platform
  Do not bundle playback fixes with UI cleanup, refactors, formatting, or unrelated changes.

---

## Installer, packaging, and wrapper changes

Changes to installer, packaging, metadata, or wrapper sync logic must be small and justified.
This includes:

- `npm run package:tizen`
- `npm run package:webos`
- Tizen `.wgt` generation
- webOS `.ipk` generation
- App identifiers
- Manifest or metadata generation
- `local.properties` / environment property handling
- `sync:tizen`
- `sync:webos`
- Nuvio WebTV Installer compatibility
- TizenBrew wrapper support
- webOS Homebrew metadata support
  PRs in this area must include:
- The exact command tested
- The target platform
- Whether the generated package was installed successfully
- Device/emulator/simulator used for testing
- Any changes to app identifiers, package IDs, or metadata
  Do not change package identifiers, app IDs, signing-related behavior, release paths, or distribution assumptions without prior approval.

---

## Large PRs and large changes

**Any large PR or change that is not a simple bug fix must be discussed and approved via a feature request issue first.**

1. Open a **Feature Request** issue describing the change.
2. Wait for explicit maintainer approval on that issue.
3. Link the approved issue in your PR description.
   PRs that introduce large changes without a linked, approved feature request **will not be reviewed at all** and will be closed immediately. No exceptions.
   This applies to UI changes, behavior changes, playback changes, new features, architecture changes, dependency additions, platform rewrites, installer changes, large refactors, migrations, and changes that affect product direction.
   Approval means a maintainer has clearly said the implementation is approved. A feature request being open, popular, or labeled `enhancement` is not approval.

---

## Where to ask questions

- Use **Issues** for bugs, feature requests, setup help, installation help, platform-specific problems, and general support.

---

## Bug reports (rules)

To keep issues fixable, bug reports should include:

- A short, specific issue title that describes the bug
- App version, release version, or commit hash
- Platform: Samsung Tizen, LG webOS, browser, or installer
- Device model
- Platform version, when available
- Install method, such as WebTV Installer, TizenBrew, Homebrew Channel, manual WGT, manual IPK, or local development build
- Steps to reproduce, with exact steps
- Expected vs actual behavior
- Frequency: always, sometimes, or once
- Screenshots or video when the issue is visual
- Logs when relevant
  Do not leave the title as just `[Bug]:` or another generic placeholder.
  Logs are optional for most issues, but they are required for crashes, blank screens, install failures, package failures, playback failures, or platform API errors.

### Useful logs

For webOS, include logs from your preferred webOS tooling when possible.
For local repository tooling, useful commands may include:

```sh
npm run logs:webos -- -d lg
npm run inspect:webos -- -d lg
```

For Tizen, include relevant Tizen Studio, device, console, or install logs when possible.

For browser development mode, include console errors and network errors from the browser developer tools.

---

## Feature requests (rules)

Please include:

- The problem you are solving
- The affected platform or platforms
- Your proposed solution
- Alternatives considered, if any
- Any compatibility risks for Samsung Tizen, LG webOS, browser development mode, installer, or wrapper projects

Opening a feature request does **not** mean a pull request will be accepted for it.

If the feature affects product scope, UX direction, playback behavior, platform behavior, installer behavior, or adds a significant new surface area, do not start implementation unless a maintainer explicitly approves it first.

**Large changes require an approved feature request before any PR is submitted.** See the [Large PRs and large changes](#large-prs-and-large-changes) section above.

---

## Before opening a PR

Please make sure your PR is all of the following:

- Allowed by this policy
- Small in scope and focused on one problem
- Clearly aligned with the current direction of the project
- Not cosmetic-only
- Not changing behavior unless it fixes a linked bug or has explicit approval
- Not changing UI unless it fixes a linked glitch/bug and includes visual proof
- Not changing playback unless it fixes a linked bug or has explicit approval
- Not changing installer, packaging, app identifiers, or wrapper behavior without clear need or approval
- Not bundling refactors, cleanups, formatting, or drive-by changes with a bug fix
- Tested manually and/or automatically in a way that matches the risk
- Tested on the affected platform when the issue is platform-specific
- Linked to an approved feature request issue if large, directional, or non-trivial

PRs will be closed without review if they:

- Are cosmetic-only UI changes
- Change behavior without a linked bug or approved feature request
- Change playback without a linked bug or approved feature request
- Change UI without screenshots/video
- Bundle unrelated changes
- Leave the PR template incomplete
- Add dependencies, architecture changes, platform rewrites, installer rewrites, or broad refactors without approval

Review time is reserved for bugs, regressions, stability, translations, documentation accuracy, and approved work.

---

## One issue per problem

Please open separate issues for separate bugs/features. It makes tracking, fixing, and closing issues much faster.
