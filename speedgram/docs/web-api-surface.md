# Instagram web (Polaris) API surface

Derived from real logged-in `www.instagram.com` session captures (HAR), including
`interactions4.har` and `interactions8.har`. This is the map for the **core/web
backend** — the features SpeedGram serves from the browser-minted session.

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
| Comment like | `PolarisCommentActionsLikeMutation` | `27184292767848867` | `web.comment_like` |
| Follow | `usePolarisFollowMutation` | `26508036048874888` | `web.follow` |
| Unfollow | `usePolarisUnfollowMutation` | `27789106940691111` | `web.unfollow` |

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
- Comment like uses `input.{comment_id,actor_id,client_mutation_id}` (FBID actor).
- Follow/unfollow use `target_user_id` plus `container_module` / `nav_chain`.
- Comment unlike had no GraphQL op in `interactions8.har`; web uses
  `POST /api/v1/media/{comment_id}/comment_unlike/`.
- Incoming follow requests use `notif_name=private_user_follow_request` plus
  `inline_follow.user_info.friendship_status.incoming_request`; accept/delete map to
  `friendships/approve` and `friendships/ignore`.
- Comment threading is **two levels only** (`interactions8-commen.har`). Parents carry
  `child_comment_count` and `preview_child_comments`; children are flat with
  `parent_comment_id` + `replied_to_comment_id` (these diverge when replying to a
  reply). `type: 0` is top-level, `type: 2` is a reply.
- Replies have **no cursor field**. Paging is `min_id` plus
  `has_more_head_child_comments` / `has_more_tail_child_comments`, so the next
  `min_id` is the last reply id already held.
- The comments response also carries `quick_response_emojis` — the emoji row the
  mobile sheet renders above its composer.
- Writing a comment (`POST /api/v1/web/comments/{media_id}/add/` with `comment_text`
  and optional `replied_to_comment_id`) appears in the Polaris bundle but was never
  fired in any capture. It stays **unwired** until a capture verifies it.

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
- `GET /api/v1/media/{id}/comments/?can_support_threading=true&permalink_enabled=false`
- `GET /api/v1/media/{id}/comments/{commentId}/child_comments/?min_id=&is_chronological=true&paging_direction=view_more`
  — comment replies (`web.comment_replies`)
- `GET /api/v1/users/web_profile_info/`, `GET /api/v1/users/{id}/info/`
- `POST /api/v1/news/inbox/` — notifications (`web.activity`; body `fb_dtsg` + `jazoest`)
- `POST /api/v1/media/{comment_id}/comment_unlike/` — comment unlike (`web.comment_unlike`)
- `POST /api/v1/friendships/approve/{user_id}/` — accept follow request
- `POST /api/v1/friendships/ignore/{user_id}/` — delete/ignore follow request

Also observed (not wired): `GET /api/v1/discover/web/explore_grid/`,
`GET /api/v1/media/{id}/info/`, `GET /api/v1/friendships/pending/`,
mental-wellbeing telemetry (ignore).

## Implication

DM inbox/thread hydration and interactions (send/reply/forward/react/read), feed
engagement (like/save/share), comment like, follow/unfollow, notifications inbox,
comments read, profile, and stories tray are reachable on the web surface. Direct
currently hydrates with the same Polaris GraphQL operations seen in the web client,
then uses a silent adaptive refresh until the realtime socket transport is wired.
Story playback/seen, comment writes, and rich creation remain later milestones.
Explore/Reels still prefer the mobile sidecar when no web-equivalent path is wired.
