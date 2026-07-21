# Instagram web (Polaris) API surface

Derived from a real logged-in `www.instagram.com` session capture (HAR). This is the
map for the **core/web backend** — the features SpeedGram serves from the
browser-minted session, no mobile private API needed.

## Transport

- Host: `https://www.instagram.com`
- Two shapes: `POST /api/graphql` (dominant — Polaris is GraphQL-first) and REST
  `GET/POST /api/v1/*`.
- Key request headers observed: `x-ig-app-id` (web app id), `x-csrftoken`,
  `x-asbd-id`, `x-fb-lsd`, `x-ig-www-claim`, `x-web-session-id`,
  `x-bloks-version-id`, `x-fb-friendly-name` (names the GraphQL op).
- Realtime: WebSockets to `edge-chat.instagram.com/chat` and
  `gateway.instagram.com/ws/realtime` (live DMs, presence).

## GraphQL operations (x-fb-friendly-name) by feature

- **DMs**: `PolarisDirectInboxQuery`, `IGDInboxHeaderOffMsysQuery`,
  `IGDThreadDetailQuery`, `IGDirectTextSendMutation`,
  `useIGDMarkThreadAsReadMutation`, `IGDirectStoryShareMutation`,
  `IGDOmniPickerNullStateListQuery`, `useIGDSystemFolderUnreadThreadCountQuery`
- **Presence/realtime**: `IGPresenceUnifiedSetupQuery` (+ edge-chat WS)
- **Feed**: `PolarisFeedRootPaginationCachedQuery`, `PolarisFeedEmptySULSearchUsersQuery`
- **Stories**: `PolarisStoriesV3ReelPageGalleryPaginationQuery`,
  `PolarisStoriesV3SeenMutation`, `usePolarisStoriesV4LikeMutation`
- **Profile**: `PolarisProfilePageContentQuery`, `PolarisProfilePostsQuery`,
  `PolarisProfileStoryHighlightsTrayContentQuery`, `PolarisProfileNoteBubbleQuery`
  (Notes render on web), `PolarisProfileSuggestedUsersWithPreloadableQuery`
- **Engagement**: `usePolarisLikeMediaXIGLikeMutation`
- **Search**: `PolarisSearchBoxRefetchableQuery`, `PolarisSearchNullStateQuery`
- **Settings/viewer**: `PolarisViewerSettingsQuery`

## REST v1 endpoints observed

- `GET /api/v1/feed/reels_tray/` — story tray *is* on web
- `GET /api/v1/media/{id}/info/`, `GET /api/v1/media/{id}/comments/`
- `GET /api/v1/discover/web/explore_grid/`
- `GET /api/v1/web/get_profile_pic_props/{username}/`
- `POST /api/v1/web/fxcal/ig_sso_users/`
- `*/mental_well_being/*` — screen-time telemetry (ignore)

## Implication

DMs (send/read/inbox/thread), feed, stories (view/seen/like), profile + Notes,
likes, and search are all reachable on the web surface. The mobile-only residue is
the interactive/creation cluster: chat polls, view-once/"special" messages, and
rich story creation — those stay on the mobile (instagrapi) backend.
