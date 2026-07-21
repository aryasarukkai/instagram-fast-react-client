# SpeedGram desktop development

This directory contains the active SpeedGram application: React/Vite, Tauri 2,
Rust, Stronghold, and a bundled Python 3.12 `instagrapi` sidecar.

The product is moving toward a dual-backend native architecture:

- A browser-minted web/Polaris session for broad Instagram web features
- A stable mobile/instagrapi session for mobile-only capabilities

The embedded web login and encrypted cookie capture are scaffolded, but all
connected data commands still use the mobile sidecar. See the
[repository README](../README.md) for status and roadmap, and
[AGENTS.md](../AGENTS.md) for implementation constraints and known blockers.

## Requirements

- Apple Silicon macOS
- Xcode Command Line Tools
- Node.js 22 and npm
- Current stable Rust toolchain
- [`uv`](https://docs.astral.sh/uv/)

`uv` installs the pinned Python 3.12 environment used by the sidecar.

## Native development

```bash
npm install
npm run protocol:build
npm run tauri dev
```

The protocol build creates:

```text
src-tauri/binaries/speedgram-protocol-aarch64-apple-darwin
```

`npm run dev` is only a browser-boundary check. It shows a locked login screen and
rejects every Instagram data command. Use `npm run tauri dev` for the application.

## Verification

```bash
npm test
npm run lint
npm run build
npm audit --audit-level=high
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Automated tests cover renderer boundaries, mobile protocol contracts, sidecar
behavior, redaction, and Stronghold records. Live Instagram login is never part of
automated verification.

## Local app bundle

```bash
npm run protocol:build
npm run tauri build -- --debug --bundles app
```

Output:

```text
src-tauri/target/debug/bundle/macos/SpeedGram.app
```

Developer ID signing and notarization are not configured yet.

## Current feature surface

The mobile engine and React UI currently cover timeline pagination, story tray,
Reels, Explore, profile/posts, activity, comments, Direct threads/messages, Notes,
and text sending. Some surfaces are read-only or do not yet drive returned cursors.

The web login captures an encrypted browser session but does not yet unlock routes
or power data requests. Search, story playback, creation, calls, and most engagement
actions remain disabled.

## Non-negotiable boundaries

- After user entry, persisted account secrets remain behind Rust and Stronghold.
- The embedded login window must be origin-locked before further live testing.
- Both backend payloads must be normalized before React sees them.
- No credentials, cookies, sessions, or raw account responses in logs,
  `localStorage`, telemetry, arguments, environment variables, or fixtures.
- Stop on checkpoints, restrictions, feedback-required responses, or rate limits.
- Use only a secondary account during live development.
