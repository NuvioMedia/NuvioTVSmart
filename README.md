<div align="center">

  <img src="assets/brand/app_logo_wordmark.png" alt="Nuvio" width="300" />

  <p>
    <strong>Fork goal:</strong> run the Nuvio TV web client on a phone or tablet,
    served from your own machine over the local network.
  </p>

</div>

> **This is a personal fork of [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart).**
> It is not an official Nuvio product and it does not change Nuvio's product direction.
> Everything here is proposed back upstream as a pull request; nothing here is a fork-and-forget
> distribution. Upstream's README is the source of truth for what Nuvio TV is, which TVs it
> supports, and how to install it on Tizen and webOS.

## The goal of this repo

Nuvio TV already ships a browser tier: `npm run serve` starts a local web server and prints the
LAN URLs, so the exact same app the TV runs can be opened in any browser on the same network.
That tier, however, is still laid out for a TV. The stylesheet is a port of the Android TV app,
whose canvas is 960dp drawn at 1920px, so every dimension doubles dp to px. A phone is about
390dp wide, not 960dp, so the interface lands roughly 2.5x too large, and the only input path
wired up is the remote: focus rings and D-pad keys, with no click handler at all.

**The aim of this fork is to make that existing browser tier usable on touch screens, without
touching what a TV sees.** Not a rewrite, not a new UI, not a second client:

- Pointer and touch input in the focus engine, gated on device capability instead of on being
  a webOS build.
- A `.web-touch` layout tier that re-derives the existing layout at dp x 1, using the numbers
  from the official [Nuvio Mobile](https://github.com/NuvioMedia/NuvioMobile) app, so a phone
  gets the phone app's proportions rather than a shrunken TV.
- A tap-to-open sign-in link on the QR screen, which is otherwise impossible to use on the
  device that is already showing it.

Everything is scoped behind tier classes that the browser tier applies and the TV tiers never
do, so Tizen and webOS rendering is byte-identical. The changes are shared-web-app only; no
packaging, signing, installer, or wrapper behaviour is touched.

## Run it on a phone

This is the flow the fork exists to support. It needs a machine on the same network as the phone.

```bash
git clone https://github.com/chingavin1/NuvioTVWeb.git
cd NuvioTVWeb
git checkout feat/web-touch-client
npm install
cp local.example.properties local.properties   # fill in your own TMDB / Trakt / Supabase keys
npm run build
npm run serve
```

`serve` listens on `0.0.0.0:4173` by default, starts the bundled local media runtime, and prints
one `LAN URL:` line per network interface. Open one of those URLs on the phone. `HOST` and `PORT`
change the bind address and port. Sign in with the tap-to-open link on the QR screen instead of
scanning the code.

```bash
PORT=8080 npm run serve   # example
```

## Branches

| Branch                  | What it is                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                  | Tracks upstream `main`. Keeps this fork's landing page and README here; no code of its own.                                                                                                                                                                    |
| `feat/web-touch-client` | The contribution. 5 commits, 9 files, rebased on upstream `main`. This is the branch proposed upstream.                                                                                                                                                        |
| `fork/auth-stub`        | Local-only dev tooling (a stub auth server plus a Playwright devDependency) used to drive the QR flow while developing. Deliberately **not** proposed: `CONTRIBUTING.md` does not accept added dependencies without prior approval, so it stays out of the PR. |

## Contributing back

All of this is meant to land upstream, in [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart),
and the [contribution rules](https://github.com/NuvioMedia/NuvioTVSmart/blob/main/CONTRIBUTING.md)
apply unchanged: UI changes need a linked, documented issue, and before/after proof. The upstream
PR template check runs in CI and will fail a PR that lacks an approving issue or screenshots, so
the fork's branch carries no claim that this is already accepted work.

## Development

```bash
npm run build          # generates dist/ (bundle.css, bundled JS)
npm run lint
npm run test           # repo test suite
npm run test:perf      # performance-sensitive units
npx prettier --check . # formatting, also run by the pre-commit hook
```

Two things worth knowing before editing CSS, both learned the hard way:

- `css/components.css` is **not** processed by the build. `build.mjs` puts it in `orderedSet` and
  then filters `orderedSet` out of `extraFiles`, so new rules belong in a numbered
  `css/components-NN.css` file. `components.css` only carries `@import`s.
- `scripts/test-legacy-css-colors.mjs` enforces the Tizen 5 colour token rule. Copy the colour
  syntax used by the neighbouring rule rather than inventing one with `var()` indirection.

For TV packaging and the full platform support matrix (Tizen 4/5/6, webOS 5/6, installer,
AltStore IPA, Android APK, webOS IPK), see the
[upstream README](https://github.com/NuvioMedia/NuvioTVSmart#readme). Nothing in this fork changes
that behaviour, and this fork publishes no releases of its own.

## Credit and license

The app, the artwork and the original implementation belong to
[NuvioMedia](https://github.com/NuvioMedia). Layout values referenced by the touch tier come from
[NuvioMobile](https://github.com/NuvioMedia/NuvioMobile), used here under the same license.

[GNU General Public License v3.0](./LICENSE) - the same license as upstream, and the fork stays
under it.
