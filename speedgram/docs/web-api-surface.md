# Instagram web (Polaris) API surface

Derived from real logged-in `www.instagram.com` session captures (HAR), including
`interactions4.har`. This is the map for the **core/web backend** — the features
SpeedGram serves from the browser-minted session.

## Transport

- Host: `https://www.instagram.com`
- Two shapes: `POST /api/graphql` (dominant — Polaris is GraphQL-first) and REST
  `GET/POST /api/v1/*`.
- Key request headers observed: `x-ig-app-id` (web app id), `x-csrftoken`,
  `x-asbd-id`, `x-fb-lsd`, `x-ig-www-claim`, `x-web-session-id`,
  `x-bloks-version-id`, `x-fb-friendly-name` (names the GraphQL op).
- Realtime: WebSockets to `edge-chat.instagram.com/chat` and
  `gateway.instagram.com/ws/realtime` (live DMs, presence) — not yet consumed.

## GraphQL operations wired in SpeedGram

| Feature | Friendly name | doc_id | Protocol method |
| --- | --- | --- | --- |
| Like | `usePolarisLikeMediaXIGLikeMutation` | `27182485238052618` | `web.like` |
| Unlike | `usePolarisLikeMediaXIGUnlikeMutation` | `27345296031770102` | `web.unlike` |
| Save | `usePolarisSaveMediaSaveMutation` | `27365486596441074` | `web.save` |
| Unsave | `usePolarisSaveMediaUnsaveMutation` | `27371251859134880` | `web.unsave` |
| DM text / reply / forward | `IGDirectTextSendMutation` | `26911679871773184` | `web.send`, `web.forward` |
| DM react (create) | `IGDirectReactionSendMutation` | `24374451552236906` | `web.react` |
| Mark thread read | `useIGDMarkThreadAsReadMutation` | `27356881703909995` | `web.mark_read` |
| Share post to DM | `IGDirectMediaShareMutation` | `27442850591982122` | `web.share_media` |
| Translate message | `IGDMessageTranslationStoreQuery` | `27167970989506587` | `web.translate` |
| Share sheet targets | `PolarisShareSheetV3NullStateQuery` | `36651079954537487` | `web.share_targets` |
| Direct inbox hydration | `PolarisDirectInboxQuery` | `27262915580045003` | `web.threads` |
| Direct thread hydration | `IGDThreadDetailQuery` | `28395443243391552` | `web.thread` |

### ID rules from HAR

- Media mutations use the **bare media pk** (strip `_{userId}`).
- Feed media can include `top_likers`, `facepile_top_likers`, and
  `social_context_facepile_users`; these are normalized as real `likedBy` users for
  the desktop viewer rather than synthesized client-side.
- Like/save `actor_id` / form `av` is the viewer **FBID** (`fbid_v2`), not `ds_user_id`.
- Like needs `tracking_token` from the feed item (`organic_tracking_token`).
- Save needs `logging_info_token` from the feed item when present.
- DM react/reply/mark-read prefer GraphQL `mid.$…` message ids.
- Media share to a 1:1 uses `recipient_users` as a JSON string of the peer IG pk.

## Other GraphQL operations observed (not yet wired)

- **DMs**: `IGDInboxHeaderOffMsysQuery`, `IGDirectStoryShareMutation`,
  `IGDOmniPickerNullStateListQuery`, `useIGDSystemFolderUnreadThreadCountQuery`,
  `useIGDMarkThreadAsReadValidationMutation`, `IGDForwardingNullStateQuery`
- **Presence/realtime**: `IGPresenceUnifiedSetupQuery` (+ edge-chat WS)
- **Feed**: `PolarisFeedRootPaginationCachedQuery`, `PolarisFeedEmptySULSearchUsersQuery`
- **Stories**: `PolarisStoriesV3ReelPageGalleryPaginationQuery`,
  `PolarisStoriesV3SeenMutation`, `usePolarisStoriesV4LikeMutation`
- **Profile**: `PolarisProfilePageContentQuery`, `PolarisProfilePostsQuery`,
  `PolarisProfileStoryHighlightsTrayContentQuery`, `PolarisProfileNoteBubbleQuery`,
  `PolarisProfileSuggestedUsersWithPreloadableQuery`
- **Search**: `PolarisSearchBoxRefetchableQuery`, `PolarisSearchNullStateQuery`
- **Settings/viewer**: `PolarisViewerSettingsQuery`

## REST v1 endpoints used today

- `POST /api/v1/feed/timeline/` — home feed
- `GET /api/v1/feed/reels_tray/` — story tray
- `GET /api/v1/media/{id}/comments/`
- `GET /api/v1/users/web_profile_info/`, `GET /api/v1/users/{id}/info/`

Also observed (not wired): `GET /api/v1/discover/web/explore_grid/`,
`GET /api/v1/media/{id}/info/`, mental-wellbeing telemetry (ignore).

## Implication

DM inbox/thread hydration and interactions (send/reply/forward/react/read), feed
engagement (like/save/share), comments read, profile, and stories tray are reachable
on the web surface. Direct currently hydrates with the same Polaris GraphQL
operations seen in the web client, then uses a silent adaptive refresh until the
realtime socket transport is wired. Story playback/seen, comment writes, and rich
creation remain later milestones. Explore/Reels/Activity still prefer the mobile
sidecar when no web-equivalent path is wired.
