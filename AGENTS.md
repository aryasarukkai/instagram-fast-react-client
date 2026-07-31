# SpeedGram Engineering Guide

Last updated: July 20, 2026

## Product Direction

SpeedGram is an Apple Silicon macOS desktop app built with React, Tauri 2, Rust,
Python 3.12, and `instagrapi==2.18.8`. It is no longer a browser app with an
extension proxy.

The target architecture is a native dual-backend Instagram client:

- A browser-minted **web/Polaris session** supplies the broad core feature set.
- A stable **mobile/instagrapi session** supplies mobile-only gaps and selected
  interactions.
- Rust owns both sessions, chooses the backend for each command, and exposes only
  normalized contracts to React.

The web backend is currently a scaffold. Embedded login capture and encrypted web
session storage exist, but no data command consumes the web session yet. All
connected data commands still route through the mobile sidecar.

## Repository Layout

- `speedgram/src/`: React application and native command adapter
- `speedgram/src/auth/`: bootstrap and authentication state
- `speedgram/src/components/`: app shell and feature surfaces
- `speedgram/protocol/`: Python mobile engine and contract tests
- `speedgram/src-tauri/`: Rust host, Stronghold vault, sidecar, and web-login window
- `speedgram/docs/web-api-surface.md`: HAR-derived Polaris GraphQL/REST map
- `speedgram/scripts/build-protocol.sh`: Apple Silicon PyInstaller packaging
- `chrome-extension/`, `firefox-extension/`, `python-demo/`: legacy experiments

## Current System

### Renderer

Authenticated routes exist for Home, Explore, Reels, Direct, Activity, and Profile.
There is no demo account or staged-data mode. Outside Tauri, login is disabled and
all data calls reject with `native_required`.

Real data surfaces currently include:

- Home timeline and cursor pagination
- Story tray metadata
- Reels and Discover Reels
- Explore grid
- Profile and profile media
- Activity inbox
- Post comments, with on-demand reply threads
- Direct inbox, thread messages, Notes, and text sending

Story playback, post opening from grids, search, creation, calls, comment writing,
and most engagement actions remain disabled. Presence has a native/protocol command
but is not consumed by React. Profile pagination is returned by the engine but not
yet driven by its page.

The Reels tab is a TikTok-style vertical, scroll-snapped, autoplaying feed. When a
web session is present it is served by the Rust-owned web ClipsTab backend
(`web.reels`, mirroring Polaris' `PolarisClipsTabDesktop*` queries) with cursor +
`seenIds` pagination driven by the page; it falls back to the mobile `feed.reels`
engine otherwise. Feed and reel videos share one autoplay/mute controller
(`src/videoFeed.js` + `FeedVideo`): videos play only while they dominate the
viewport, start muted, and stay unmuted app-wide once the user unmutes, until
reload. The share sheet targets Direct **threads** (the web ranked share sheet
exposes thread ids and member avatars, never recipient user ids).

Chat themes are the only approved `localStorage` use. They are explicitly local UI
preferences and never contain Instagram account material.

### Rust/Tauri host

The renderer command surface is:

- `runtime_status()`
- `auth_get_state()`
- `auth_begin_login({ username, password })`
- `auth_submit_code({ operationId, code })`
- `auth_continue_manual({ operationId })`
- `auth_cancel()`
- `auth_logout()`
- `feed_timeline({ cursor? })`
- `feed_stories()`
- `feed_reels({ cursor?, source? })`
- `feed_explore()`
- `media_comments({ mediaId })`
- `media_comment_replies({ mediaId, commentId, cursor? })`
- `user_profile({ username? })`
- `user_medias({ userId?, username?, cursor? })`
- `activity_inbox()`
- `direct_threads()`
- `direct_thread({ threadId })`
- `direct_send({ threadId, text })`
- `direct_notes()`
- `direct_presence()`
- `direct_share_targets()`
- `save_web_credentials({ username, password })`
- `begin_web_login()`
- `web_session_status()`
- `clear_web_session()`
- `telemetry_set_consent({ enabled })`

Mobile data commands use `call_with_restore`, which makes one restoration attempt
from the Stronghold session when the sidecar reports `not_authenticated` or becomes
unavailable.

### Mobile protocol engine

Rust exclusively starts
`speedgram-protocol-aarch64-apple-darwin` over private line-delimited JSON-RPC. The
webview has no shell capability and never reads sidecar streams.

The Python engine owns one stateful `instagrapi.Client`, normalizes every response,
and maps errors to safe codes. Fresh accounts deterministically select one recent
Android model from `_DEVICE_POOL`; account-specific UUIDs and restored device
settings remain stable. Do not claim every account appears as a Pixel 8 Pro.

The engine supports authentication, feed, stories, Reels, Explore, comments,
profiles, profile media, activity, Direct threads/messages, Notes, presence, and
text sending. Every new protocol method must remain allowlisted and must receive a
contract test before UI integration.

### Web-session scaffold

`Continue in Instagram` currently:

1. Saves the entered username/password in Stronghold.
2. Opens Instagram's real login page in a dedicated Tauri webview.
3. Autofills without submitting so Instagram owns 2FA and checkpoints.
4. Polls the native cookie store for `sessionid`.
5. Saves the captured browser cookie bundle in Stronghold.

This is not a finished login path. `web_captured` does not unlock the app,
`auth_get_state` restores only the mobile session, and no feed/data command reads
the web-session record.

## Required Web-Login Hardening

Treat these as blockers before another live embedded-login test:

1. Guard the initialization script with an exact Instagram origin check. Tauri
   initialization scripts run on every top-level navigation; credentials must never
   autofill on an unexpected origin.
2. Add a navigation allowlist for the login webview and define the small set of
   Meta/Instagram hosts required by login and checkpoints.
3. Bind captured `ds_user_id`/session data to the intended account before saving it.
4. Allowlist only the minimum cookies required by the web client instead of storing
   the entire Instagram jar.
5. Clear the native webview cookie store as well as Stronghold. The current
   `clear_web_session()` deletes only the encrypted record and can recapture a stale
   webview session.
6. Give users a visible way to clear stored web credentials/session before mobile
   authentication succeeds.
7. Replace the single top-level `AuthState` gate with account state plus independent
   web/mobile capability states.

The dedicated login webview must never receive Tauri command capabilities.

## Authentication Model

Mobile public states remain:

- `signed_out`
- `authenticating`
- `verification_required`
- `manual_approval_required`
- `authenticated`
- `error`

The web scaffold additionally emits `web_login_started`, `web_captured`,
`web_idle`, and web-login error outcomes. These must become a separate capability
state rather than being mixed into the mobile `AuthState` union.

The mobile engine preserves one client through a live challenge. Official-app
approval is bound to the exact sidecar process that initiated it; restarting or
rebuilding mid-challenge invalidates the operation.

The provisional device profile is stored after a login reaches the engine. The
password and complete mobile session are persisted only after authentication.
Logout deletes mobile session, device profile, stored credentials, and web-session
records.

## Live-Test Safety

Live testing remains paused until ordinary Instagram browser login is healthy and
the embedded-login blockers above are resolved.

- Do not initiate or automate login attempts without the user's explicit test.
- Do not add background login retries or approval polling.
- Do not rotate proxies, networks, or device identity during recovery/challenges.
- Do not request or inspect user credentials, cookies, or session tokens.
- Use only a secondary account.
- Stop all automatic requests after a rate limit, checkpoint, restriction, or
  feedback-required response.

Add an authentication cooldown/circuit breaker before resuming live tests.

## Backend Routing Direction

The intended default routing is:

| Feature family | Preferred backend | Current backend |
| --- | --- | --- |
| Feed, stories, Explore, profiles, comments, search, activity | Web/Polaris | Mobile |
| Standard Direct inbox/thread/send/read | Web/Polaris + realtime | Mobile |
| Reels and Notes | Capability-dependent | Mobile |
| Mobile-only creation and rich interactions | Mobile | Mostly not implemented |
| Public fallback lookups | Explicitly selected | Opportunistic inside instagrapi |

Do not implement silent cross-backend retry for write operations. Reads may use a
fallback only when identity, rate-limit behavior, and error semantics are explicit.

## Security Invariants

- Never place passwords, codes, cookies, session IDs, authorization data, raw HAR
  data, or protocol payloads in logs, telemetry, process arguments, environment
  variables, fixtures, screenshots, or `localStorage`.
- After user entry, persisted account secrets remain behind Rust and Stronghold;
  native commands never return them to React.
- The random Stronghold key remains in macOS Keychain.
- Both web and mobile responses are normalized before crossing into the renderer.
- Telemetry stays default-off with no network collector until separately designed.
- Logout destroys every stored account/session/device record and native browser
  session material.
- Never restore the plaintext password fallback.
- Do not add certificate interception, TLS bypasses, or aggressive checkpoint
  reverse-engineering without a separately approved milestone.
- Direct sending and future likes/comments are write operations: apply stricter
  cooldowns, explicit user intent, idempotency where possible, and rollback UI.

## Build and Verification

Run from `speedgram/`:

```bash
npm install
npm run protocol:build
npm test
npm run lint
npm run build
npm audit --audit-level=high
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build -- --debug --bundles app
```

The current verified baseline is 17 React tests, 47 Python tests, and 6 Rust tests,
plus clean lint, Vite build, dependency audit, and Clippy. Update counts when tests
change; passing counts do not replace live acceptance.

## Roadmap

### Phase 1 — Dual-session foundation

- Complete the seven embedded-login hardening blockers.
- Model account identity separately from web/mobile session capabilities.
- Add cooldowns, expiry states, migrations, and explicit disconnect controls.

### Phase 2 — Web core backend

- Build the Rust-owned Polaris GraphQL/REST client.
- Route feed, stories, Explore, profiles, comments, activity, and search through it.
- Add a web Direct client and web-session renewal.
- Reuse existing renderer contracts rather than leaking raw web payloads.

### Phase 3 — Mobile capability backend

- Formalize backend selection and read-only fallback policy.
- Complete story playback, Reels/profile pagination, Notes, and presence.
- Prototype passwordless external-browser session import.

### Phase 4 — Realtime and interactions

- Add Direct realtime, presence, receipts, replies, shares, and rich messages.
- Add explicit likes, saves, comments, story state, and safe creation workflows.
- Add per-action rate limits, optimistic rollback, and account safety controls.

### Phase 5 — Product hardening

- Complete secondary-account end-to-end acceptance.
- Expand contract, expiry, crash, vault migration, accessibility, and performance
  coverage.
- Add Developer ID signing/notarization, then evaluate other desktop targets.
