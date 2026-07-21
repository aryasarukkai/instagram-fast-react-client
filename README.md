<div align="center">
  <img src="landing/logo.png" alt="SpeedGram logo" width="160" height="160" />
  <h1>SpeedGram</h1>
  <p><strong>A fast, local-first, open-source Instagram desktop client.</strong></p>
  <p>React interface. Native Tauri host. Web and mobile protocol backends. No hosted proxy.</p>
</div>

> [!WARNING]
> SpeedGram is experimental pre-alpha software. It uses undocumented Instagram
> interfaces, is not affiliated with or endorsed by Meta or Instagram, and may
> trigger checkpoints or temporary account restrictions. Use only a secondary
> account during development.

## What SpeedGram is

SpeedGram is a desktop-first attempt to bring Instagram's mobile experience into
a fast, expressive native client. The project began as a React web app, but the
active product is now a **Tauri 2 desktop application** with local protocol engines
and encrypted session storage.

The architecture is moving toward two complementary Instagram sessions:

- A **browser-minted web session** for the broad Polaris web surface: feed,
  stories, Explore, profiles, comments, search, activity, and standard messaging.
- A stable **mobile session** powered by `instagrapi` for mobile-only data and
  interactions that Instagram does not expose on the web surface.

The old CORS-proxy extension is not part of normal app traffic. Historical browser
and encryption experiments remain in the repository for reference.

The first target is **Apple Silicon macOS**. Windows, Linux, Intel macOS, signing,
and notarization follow after the account and data boundaries are stable.

## Current status

The desktop foundation and **both backends are live**. The **web session backend now
powers the core experience**: the app captures a browser-minted Instagram session
(embedded webview login *or* manual cookie import) into the encrypted vault and
serves the feed, stories, comments, direct messages, and profiles through direct
Polaris web requests that closely replicate the real instagram.com web client. The
mobile `instagrapi` backend remains available for mobile-only capabilities and as a
fallback when no web session is present.

| Surface | Current state |
| --- | --- |
| Tauri shell and bundled Python sidecar | Implemented and locally packaged |
| Keychain-backed Stronghold vault | Implemented and tested (survives restart) |
| Web session: embedded login **and** manual cookie import (string or JSON) | Implemented; session validated on launch, expiry auto-clears |
| Native image proxy (`igimg://`) for CDN images incl. profile pics | Implemented |
| Home feed | **Web-backed**, cached across navigations with manual reload; mobile fallback |
| Story tray | **Web-backed** (read); playback not connected |
| Post comments | **Web-backed** |
| Direct inbox, thread history, polling for new DMs | **Web-backed** |
| Direct **send**, **replies**, shared post/reel rendering, reaction display, grouping | **Web-backed** (GraphQL send with page-scraped `fb_dtsg`/`lsd`) |
| Profile and profile posts | **Web-backed** (first grid page; pagination pending) |
| Account identity (username/avatar) | **Web-backed** |
| Mobile password login, 2FA, device identity, official-app approval | Implemented through the mobile engine |
| Explore grid, Reels, Activity/Notifications | Mobile engine only; web wiring pending |
| Likes, saves, shares, posting, creation | Not implemented (planned) |

There is no demo account or staged-data mode. Outside Tauri, the Vite build shows a
locked login screen and every Instagram data request rejects with `native_required`.

## How it fundamentally works

```text
┌──────────────────────────────────────────────────────────────┐
│ React + Vite renderer                                        │
│ Routes, capability-aware UI, normalized data only            │
└──────────────────────────┬───────────────────────────────────┘
                           │ allowlisted Tauri commands
┌──────────────────────────▼───────────────────────────────────┐
│ Rust / Tauri 2 host                                          │
│ • Command routing: web session present → web backend,        │
│   otherwise → mobile backend                                 │
│ • Keychain-backed Stronghold vault (cookies, creds, sessions)│
│ • Embedded Instagram login webview + cookie capture          │
│ • igimg:// image proxy (reqwest, server-side Referer+cookies)│
└──────────────┬────────────────────────────────┬──────────────┘
               │ private JSON-RPC (stdin/stdout) │ igimg://
┌──────────────▼─────────────────────────────┐  └─► Instagram image CDN
│ Python 3.12 sidecar — two transports        │
│ • Web backend: requests → www.instagram.com │
│   Polaris REST + GraphQL, full browser       │
│   headers, page-scraped fb_dtsg/lsd for      │
│   writes (DM send/reply)                      │
│ • Mobile backend: instagrapi → i.instagram   │
│ Both normalize to the same renderer contracts│
└──────────────┬──────────────────────────────┘
               ▼
           Instagram
```

**The core flow.** The user captures a real browser session — either by logging in
through the embedded Instagram webview, or by pasting cookies exported from a
logged-in browser (plain string or Cookie-Editor JSON). Those cookies are encrypted
in Stronghold, and the app enters on that web session. Every core Tauri command
(`feed_timeline`, `direct_threads`, `media_comments`, `user_profile`, …) checks for a
stored web session first and, if present, calls the sidecar's **web backend**, which
issues direct HTTPS requests to `www.instagram.com` with the web app id and a full
Chromium header set. Reads (feed, stories, comments, DMs, profile) are plain
authenticated GETs/POSTs; writes (sending or replying to a DM) replicate the exact
`IGDirectTextSendMutation` GraphQL call, scraping the per-session `fb_dtsg`/`lsd`
tokens from the page. Instagram's image CDN rejects direct webview requests for many
assets (especially profile pictures), so images route through a native `igimg://`
proxy that refetches them server-side with the right `Referer` and cookies. When no
web session exists, the same commands fall back to the mobile `instagrapi` sidecar.

See [speedgram/docs/web-api-surface.md](speedgram/docs/web-api-surface.md) for the
captured Polaris operation map that guides the web backend.

## Security model

- The Tauri renderer can invoke only explicit commands; it cannot spawn or read the
  sidecar directly.
- Rust owns the sidecar lifecycle, web-login window, backend routing, and secret
  vault.
- Mobile settings, raw credentials, and captured web cookies are encrypted in
  Stronghold using a random key retained in macOS Keychain.
- Native secrets are never returned to React or stored in `localStorage`, logs,
  telemetry, process arguments, or environment variables.
- Python normalizes private mobile responses before they cross into Rust or React.
- The web backend must likewise normalize responses in the native layer; raw
  GraphQL/REST payloads must not become renderer contracts.
- Telemetry is default-off and currently has no network collector.
- Logout destroys mobile session, device profile, stored credentials, and captured
  web-session records.
- No Charles Proxy, certificate interception, hosted CORS proxy, or plaintext
  credential fallback is part of the active architecture.

The embedded login scaffold is not production-ready yet. Before live use it must
enforce Instagram-only navigation and autofill origins, bind the captured session
to the intended account, minimize the cookie allowlist, and clear both Stronghold
and the native webview cookie store when the user disconnects it.

For the complete engineering constraints and known seams, read
[AGENTS.md](AGENTS.md).

## Authentication model

SpeedGram currently has two related but not yet unified authentication paths:

1. **Continue in Instagram** opens Instagram's real login page in a dedicated
   native webview, lets Instagram own its normal 2FA/checkpoint UI, and captures the
   browser session into Stronghold.
2. **Advanced mobile login** creates the `instagrapi` session needed by the current
   data commands and mobile-only features.

Fresh mobile accounts receive a deterministic device model from a small pool of
recent Android profiles, while UUIDs and persisted settings remain account-specific.
Existing saved sessions always keep their previous device identity.

An official-app approval is bound to the exact sidecar process that initiated it.
Do not restart or rebuild SpeedGram in the middle of that challenge.

Instagram's emailed/SMS “login link” remains Instagram-owned recovery. A future
passwordless flow may complete that official browser login externally and hand the
resulting session to SpeedGram through an explicit local channel. It is separate
from the current credential-autofill webview scaffold.

## Development setup

### Requirements

- Apple Silicon Mac
- Xcode Command Line Tools
- Node.js 22 and npm
- Current stable Rust toolchain
- [`uv`](https://docs.astral.sh/uv/)

Python 3.12 and the pinned protocol dependencies are managed through `uv`.

### Run the native app

```bash
git clone https://github.com/aryasarukkai/instagram-fast-react-client.git
cd instagram-fast-react-client/speedgram
npm install
npm run protocol:build
npm run tauri dev
```

The packaged Apple Silicon protocol engine is created at:

```text
speedgram/src-tauri/binaries/speedgram-protocol-aarch64-apple-darwin
```

### Browser boundary check

```bash
cd speedgram
npm run dev
```

This intentionally shows the locked login screen. Real login and Instagram data
are available only inside the Tauri shell.

### Build a local macOS app

```bash
cd speedgram
npm run protocol:build
npm run tauri build -- --debug --bundles app
```

The local bundle is written to:

```text
speedgram/src-tauri/target/debug/bundle/macos/SpeedGram.app
```

Developer ID signing and notarization are not configured yet.

## Tests and checks

Run from `speedgram/`:

```bash
npm test
npm run lint
npm run build
npm audit --audit-level=high
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm test` runs the React/Vitest boundary tests, Python protocol contract tests,
and Rust sidecar/vault tests. Live Instagram login must never be part of automated
testing.

## Live-account safety

Live testing is manual and must use a secondary account. The user enters all
credentials and verification codes themselves; secrets must never be placed in
issues, terminal commands, fixtures, screenshots, or logs.

Stop immediately after a rate limit, repeated checkpoint, feedback-required
response, unexpected recovery prompt, or normal browser login failure. Do not
rotate proxies, randomize device identity, or hammer retries. Resolve warnings in
the official Instagram app and allow the account to recover before another test.

## Roadmap

### Shipped

- Dual-backend routing (web session preferred, mobile fallback) behind the same
  normalized command contracts.
- Web session capture two ways: embedded Instagram login webview, and manual cookie
  import (string or Cookie-Editor JSON).
- Encrypted vault that survives restart; web session validated on launch with
  automatic clear-and-relogin on expiry.
- Web core reads: feed, stories tray, comments, direct inbox + full thread history,
  profiles + post grid, account identity.
- Web direct **writes**: sending and replying to messages via the real GraphQL
  mutation with page-scraped session tokens.
- Direct polish: shared post/reel rendering, reaction display, message grouping,
  new-DM polling, send/scroll animations.
- Native `igimg://` image proxy for CDN assets that reject direct webview requests.
- Home feed caching with a manual "reload" affordance; bootstrap preloads feed,
  stories, and DMs so the app opens populated.

### Next

- **Post interactions**: likes, saves, and shares through their Polaris mutations
  (writes — captured per-action from real traffic to match the client exactly).
- **Remaining web reads**: Explore grid, Reels, Activity/Notifications.
- **Pagination**: home feed "load more", profile grid, and Reels beyond the first page.
- **Realtime Direct**: replace inbox polling with the `edge-chat` websocket surface;
  presence, typing, read receipts.
- **Story playback** and rich story creation.

### Mobile capability backend (extras)

- Use `instagrapi` for the genuinely mobile-only surface the web API doesn't expose
  (chat polls, view-once/vanish messages, rich story creation).
- Harden the mobile transport toward an Android-coherent TLS fingerprint
  (curl_cffi seam already scaffolded in `protocol/.../transport.py`).

### Hardening and distribution

- Strict origin/navigation rules on the embedded login window; minimize the cookie
  allowlist; clear webview cookie store on disconnect.
- Write-specific rate limiting, optimistic rollback, and clear failure UI.
- Broader contract, crash-recovery, expiry, and migration coverage.
- macOS Developer ID signing and notarization; evaluate Intel macOS, Windows, Linux.

## Repository map

```text
instagram-fast-react-client/
├── speedgram/
│   ├── src/                 React renderer and routes
│   ├── src/auth/            Bootstrap and account state
│   ├── protocol/            Python mobile protocol engine
│   ├── docs/                Captured API-surface notes
│   ├── scripts/             Sidecar packaging
│   └── src-tauri/           Rust host, vault, webview, and commands
├── chrome-extension/        Legacy browser experiment
├── firefox-extension/       Legacy browser experiment
├── python-demo/             Legacy browser-encryption experiment
├── landing/                 Project assets
└── AGENTS.md                Active engineering guide
```

## Contributing

SpeedGram welcomes careful, security-conscious contributions. Read
[AGENTS.md](AGENTS.md) before changing authentication, storage, or protocol code.

- Keep native commands small and allowlisted.
- Keep account secrets behind Rust and Stronghold.
- Normalize both web and mobile responses before they reach React.
- Preserve stable identity and stop on anti-abuse responses.
- Add tests for every state transition and error mapping.
- Never commit credentials, cookies, session bundles, captured traffic, or raw
  private account responses.

## License, credit, and contact

SpeedGram is licensed under [GPL-3.0](LICENSE).

The mobile protocol engine depends on the MIT-licensed
[`instagrapi`](https://github.com/subzeroid/instagrapi) project. SpeedGram is an
independent project and is not affiliated with or endorsed by Meta Platforms or
Instagram.

Contact: [arya@amm.lol](mailto:arya@amm.lol)

Project: [github.com/aryasarukkai/instagram-fast-react-client](https://github.com/aryasarukkai/instagram-fast-react-client)

Made with ❤️ by Arya Sarukkai.
