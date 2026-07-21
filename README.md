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

The desktop foundation and a large mobile-backed feature surface are implemented.
The web-session backend is an active work in progress: the app can open Instagram's
real login in a dedicated native webview and capture the resulting session into
Stronghold, but web data commands and unified dual-session routing are not connected
yet.

| Surface | Current state |
| --- | --- |
| Tauri shell and bundled Python sidecar | Implemented and locally packaged |
| Keychain-backed Stronghold vault | Implemented and tested |
| Embedded Instagram web login/session capture | Scaffold implemented; hardening and routing remain |
| Mobile password login and stable device identity | Implemented; live validation still cautious |
| 2FA codes and official-app approval | Implemented with contract coverage |
| Home timeline and pagination | Implemented through the mobile engine |
| Story tray | Read-only mobile implementation; playback not connected |
| Reels and Discover Reels | Read-only mobile implementation |
| Explore grid | Read-only mobile implementation |
| Profile and profile posts | Read-only mobile implementation |
| Activity and post comments | Read-only mobile implementation |
| Direct inbox, threads, Notes, and text sending | Implemented through the mobile engine; live validation pending |
| Presence | Protocol command implemented; UI integration pending |
| Search, posting, rich interactions, and creation | Planned or disabled |

There is no demo account or staged-data mode. Outside Tauri, the Vite build shows a
locked login screen and every Instagram data request rejects with `native_required`.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ React + Vite renderer                                        │
│ Routes, capability-aware UI, normalized data only            │
└──────────────────────────┬───────────────────────────────────┘
                           │ allowlisted Tauri commands
┌──────────────────────────▼───────────────────────────────────┐
│ Rust / Tauri 2 host                                          │
│ Window ownership, backend routing, redaction, Keychain vault │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │ web session                   │ private JSON-RPC
┌───────────────▼──────────────┐  ┌─────────────▼──────────────┐
│ Instagram web/Polaris client │  │ Python 3.12 mobile sidecar │
│ GraphQL, REST, realtime       │  │ instagrapi + normalization │
│ Planned data transport        │  │ Implemented data transport │
└───────────────┬──────────────┘  └─────────────┬──────────────┘
                └───────────────┬────────────────┘
                                ▼
                            Instagram
```

Today, all connected data commands still route through the mobile sidecar. The
embedded web login stores a browser session for the next stage of the architecture;
it does not yet power feed, messaging, or other app routes.

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

### Phase 1 — Dual-session foundation

- Harden the embedded Instagram login window with strict origin/navigation rules.
- Separate web-session and mobile-session state from the top-level account state.
- Bind every stored session to one normalized account identity.
- Clear both encrypted records and native webview cookies on disconnect/logout.
- Add authentication cooldowns and redacted post-approval diagnostics.

### Phase 2 — Web core backend

- Add a Rust-owned Polaris GraphQL/REST client using the captured web session.
- Route feed, stories, Explore, profiles, comments, activity, search, and standard
  Direct features through the web backend.
- Normalize web payloads into the same public contracts already used by React.
- Add expiry detection and an explicit web-session renewal flow.

### Phase 3 — Mobile capability backend

- Keep `instagrapi` for mobile-only reads, creation surfaces, and unsupported web
  interactions.
- Formalize per-command backend selection and safe fallback rules.
- Complete story playback, Reels pagination, profile pagination, Notes, and presence.
- Add a passwordless browser-session import experiment without silently retrying
  password login.

### Phase 4 — Messaging and interactions

- Add realtime Direct updates and presence through the web socket surface.
- Support read receipts, media shares, replies, and safe rich-message rendering.
- Add likes, saves, comments, story seen state, and other explicit user actions.
- Require write-specific rate limiting, optimistic rollback, and clear failure UI.

### Phase 5 — Product hardening and distribution

- Complete uninterrupted secondary-account acceptance tests.
- Add broader contract, crash-recovery, expiry, and migration coverage.
- Audit accessibility, performance, and renderer memory use.
- Add macOS Developer ID signing and notarization.
- Evaluate Intel macOS, Windows, and Linux packaging.

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
