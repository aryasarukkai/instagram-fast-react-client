# Polaris web API: comments, replies, comment likes, share sheet

Source: HAR capture `interactions8-commen.har` (logged-in `www.instagram.com` desktop
web session, Chromium 149 / macOS, 2026-07-21). All tokens, cookies, CSRF values,
`fb_dtsg`, `lsd`, `jazoest`, `__csr`/`__hsdp`/`__hblp` blobs and session ids are
intentionally **omitted or marked `<REDACTED>`** below.

Two kinds of evidence appear here:

1. **Observed traffic** — requests/responses actually present in the HAR.
2. **Client-bundle definitions** — endpoint templates and Relay operation ids read
   out of the Polaris JS bundles that are also in the HAR. These are authoritative
   for the request shape but were not exercised during the capture.

Each section marks which applies.

---

## 0. Common transport

Two GraphQL transports and one REST transport are used.

### REST (`PolarisInstapi`)

```
GET/POST https://www.instagram.com/api/v1/...
```

Headers seen on every authenticated REST call:

| Header | Value |
| --- | --- |
| `x-ig-app-id` | `936619743392459` (web app id) |
| `x-asbd-id` | `359341` |
| `x-csrftoken` | `<REDACTED>` (mirrors the `csrftoken` cookie) |
| `x-ig-www-claim` | `<REDACTED>` (rotating; echo back the value from the previous response's `x-ig-set-www-claim`) |
| `x-requested-with` | `XMLHttpRequest` |
| `x-web-session-id` | short opaque per-tab id, e.g. `aaaaaa:bbbbbb:cccccc` |
| `x-ig-max-touch-points` | `0` |
| `referer` | the post permalink, e.g. `https://www.instagram.com/p/<shortcode>/` |

Cookies (`sessionid`, `ds_user_id`, `csrftoken`, `mid`, …) ride on the request
implicitly. Not reproduced here.

### GraphQL

```
POST https://www.instagram.com/api/graphql        # "www executable" Relay ops
POST https://www.instagram.com/graphql/query      # ops with an XDT root field
Content-Type: application/x-www-form-urlencoded
```

Extra headers: `x-fb-friendly-name: <operation name>`, `x-fb-lsd: <REDACTED>`,
`x-ig-app-id`, `x-asbd-id`, `x-csrftoken: <REDACTED>`; `/graphql/query` also sends
`x-root-field-name` (e.g. `fetch__XDTMediaDict`,
`xdt_api__v1__feed__timeline__connection`) and `x-bloks-version-id`.

Body fields that matter (the rest are Comet plumbing):

```
av=<viewer ig user id>            # e.g. 17841450859296213 (actor id, not ds_user_id)
__a=1  __d=www  __comet_req=7  __user=0  dpr=2
__crn=comet.igweb.PolarisFeedRoute
fb_api_caller_class=RelayModern
fb_api_req_friendly_name=<operation name>
server_timestamps=true
variables=<url-encoded JSON>
doc_id=<persisted query id>
fb_dtsg=<REDACTED>  jazoest=<REDACTED>  lsd=<REDACTED>
__hs / __rev / __s / __hsi / __spin_* / __dyn / __csr / __hsdp / __hblp / __sjsp  = build+session env
```

---

## 1. Fetch comments on a media — OBSERVED

```
GET https://www.instagram.com/api/v1/media/{media_id}/comments/
      ?can_support_threading=true
      &permalink_enabled=false
```

Client definitions (`PolarisAPIGetInitialComments`, `PolarisAPIGetPaginationComments`):

* initial load query params: `can_support_threading=true`,
  `permalink_enabled=<bool>`, `sort_order=<string|undefined>`,
  `target_comment_id=<comment id|null>`
  (`target_comment_id` + `permalink_enabled=true` is the deep-link-to-a-comment case,
  used for `/p/<shortcode>/c/<comment_id>/` routes)
* pagination: `can_support_threading=true`, then **either** `min_id=<cursor>` (newer /
  "load newer", `paging_direction` implied) **or** `max_id=<cursor>` (older),
  plus `sort_order=<n>`.

Route preloads embedded in `/ajax/bulk-route-definitions/` confirm the same shape:
`{"method":"GET","url":"/api/v1/media/{media_id}/comments/","params":{"path":{"media_id":…},"query":{"can_support_threading":true,"target_comment_id":null,"permalink_enabled":false}}}`.

### Response shape

```jsonc
{
  "status": "ok",
  "comment_count": 37357,
  "comments": [ Comment, ... ],          // 15 per page in the capture
  "has_more_comments": false,            // legacy/parent flag
  "has_more_headload_comments": true,    // true => more to load via next_min_id
  "next_min_id": "{\"cached_comments_cursor\":\"18111141689282426\",\"bifilter_token\":\"…\"}",
                                          // opaque JSON *string* — pass verbatim as min_id
  "is_ranked": true,
  "threading_enabled": true,
  "comment_likes_enabled": true,
  "liked_by_media_owner_badge_enabled": true,
  "can_view_more_preview_comments": false,
  "caption": { …Comment-shaped caption object…, "content_type": "comment" },
  "caption_is_edited": false,
  "comment_filter_param": "no_filter",
  "filter_options": [], "sort_options": [], "ai_topic_filters": [],
  "quick_response_emojis": [{"unicode": "❤️"}, …],   // 8 entries
  "initiate_at_top": true, "insert_new_comment_to_top": true,
  "scroll_behavior": 1, "comment_cover_pos": "bottom", "media_header_display": "none",
  "has_more_headload_fb_comments": false, "fb_comments": [],
  "should_render_upsell": false, "foundation_improvements_enabled": true
}
```

`Comment` (union of all keys seen on the top-level list):

```jsonc
{
  "pk": "18031720616648438",            // comment id (string)
  "strong_id__": "18031720616648438",
  "media_id": "3946222890672862011",
  "user_id": "54481180331",
  "user": {
    "pk", "pk_id", "id", "strong_id__", "fbid_v2",
    "username", "full_name", "is_verified", "is_private", "is_mentionable",
    "profile_pic_id", "profile_pic_url", "latest_reel_media",
    "qe_use_smaller_comment_like_tap_target"
  },
  "text": "…",
  "type": 0,                            // 0 = top-level comment, 2 = reply (see §2)
  "status": "Active",
  "created_at": 1784655609, "created_at_utc": …, "created_at_for_fb_app": …,
  "comment_like_count": 5711,
  "has_liked_comment": false,
  "has_disliked_comment": false,
  "comment_index": 1,                   // rank position
  "is_ranked_comment": true,

  // --- threading / replies ---
  "child_comment_count": 1,
  "preview_child_comments": [ ChildComment, … ],   // inline replies; often []
  "num_head_child_comments": 1,
  "has_more_head_child_comments": true,
  "has_more_tail_child_comments": false,
  "other_preview_users": [],

  // --- misc flags ---
  "bit_flags": 0, "content_type": "comment",
  "did_report_as_spam": false, "is_covered": false, "is_edited": false,
  "is_text_editable": false, "share_enabled": true, "private_reply_status": 0,
  "inline_composer_display_condition": "never",
  "is_photo_comments_enabled_for_comment_author": false,
  "meta_ai_comment_type": "NONE",
  "keywords_data": [], "liked_by_media_coauthors": [],
  "has_translation": true,              // only on some comments
  "giphy_media_info": {                 // GIF comments
    "gif_media_id", "id", "title", "username", "is_sticker", "strong_id__",
    "images": { "fixed_height": { "url", "mp4", "webp", "width", "height",
                                  "size", "mp4_size", "webp_size" } }
  }
}
```

Pagination summary: **`has_more_headload_comments` + `next_min_id`** drive "load more
comments" on web. `next_min_id` is a JSON string
(`{"cached_comments_cursor":…, "bifilter_token":…}`) and must be passed back
unparsed as the `min_id` query param.

### Related: `/api/v1/media/{media_id}/info/` — OBSERVED

Returns `{num_results, more_available, auto_load_more_enabled, status, items:[Media]}`.
Comment-relevant fields on `items[0]`:
`comment_count`, `preview_comments` (array, empty here), `can_view_more_preview_comments`,
`comment_likes_enabled`, `is_comments_gif_composer_enabled`,
`is_photo_comments_composer_enabled_for_author`, `hide_view_all_comment_entrypoint`,
`comment_inform_treatment {action_type, should_have_inform_treatment, text, url}`,
`is_visual_reply_commenter_notice_enabled`, plus like/share fields
(`like_count`, `has_liked`, `top_likers`, `facepile_top_likers`,
`like_and_view_counts_disabled`, `hidden_likes_string_variant`,
`can_viewer_reshare`, `share_count_disabled`, `has_shared_to_fb`).

---

## 2. Fetch comment replies (child comments) — OBSERVED

```
GET https://www.instagram.com/api/v1/media/{media_id}/comments/{parent_comment_id}/child_comments/
      ?min_id=
      &is_chronological=true
      &paging_direction=view_more
```

Client definition (`PolarisAPIGetChildComments(mediaId, parentCommentId, minId, chronological)`):
query = `{ min_id: minId ?? undefined }` merged with
`{ is_chronological: true, paging_direction: "view_more" }` when the chronological flag
is set. First page sends `min_id=` (empty).

### Response shape

```jsonc
{
  "status": "ok",
  "child_comment_count": 8,
  "child_comments": [ ChildComment, … ],   // 7 returned for count 8 (parent excluded)
  "has_more_head_child_comments": false,
  "has_more_tail_child_comments": false,
  "is_ranked_replies": false,
  "liked_by_media_owner_badge_enabled": true,
  "parent_comment": { …full Comment object, type:0, no child_* fields… }
}
```

`ChildComment`:

```jsonc
{
  "pk": "18109169189076965",
  "strong_id__": "18109169189076965",
  "media_id": "3946222890672862011",
  "parent_comment_id": "18109412317804113",
  "replied_to_comment_id": "18109412317804113",   // == parent for a flat reply;
                                                  // points at the reply being answered
                                                  // when the user replied to a reply
  "child_comment_index": 0,                       // ordering within the thread
  "type": 2,                                      // 2 = child comment
  "text": "@eqwerzz …",                           // @-mention is plain text in the body
  "user_id": "72051522250",
  "user": { pk, pk_id, id, strong_id__, fbid_v2, username, full_name,
            is_verified, is_private, is_mentionable,
            profile_pic_id, profile_pic_url,
            qe_use_smaller_comment_like_tap_target },
  "comment_like_count": 6,
  "has_liked_comment": false, "has_disliked_comment": false,
  "created_at": …, "created_at_utc": …, "created_at_for_fb_app": …,
  "status": "Active", "content_type": "comment", "bit_flags": 0,
  "did_report_as_spam": false, "is_covered": false, "is_edited": false,
  "is_text_editable": false, "is_ranked_comment": false,
  "is_photo_comments_enabled_for_comment_author": false,
  "meta_ai_comment_type": "NONE", "private_reply_status": 0,
  "share_enabled": true, "liked_by_media_coauthors": []
}
```

Nesting model: **exactly two levels.** Parent comments carry counters
(`child_comment_count`, `num_head_child_comments`,
`has_more_head_child_comments`, `has_more_tail_child_comments`) and an optional
inline `preview_child_comments` array. The full thread is a separate REST call whose
children are flat and link upward via `parent_comment_id` / `replied_to_comment_id`.
There is no `next_max_child_cursor` in this capture — reply paging is driven by
`min_id` plus the `has_more_head_child_comments` / `has_more_tail_child_comments`
booleans (`paging_direction=view_more`).

---

## 3. Like / unlike a comment — CLIENT-BUNDLE ONLY (not exercised in this HAR)

Web does **not** use a REST `comment/like` endpoint. `PolarisCommentActions` commits
Relay mutations:

```
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name = PolarisCommentActionsLikeMutation
doc_id                   = 27184292767848867
variables                = {"input":{"comment_id":"<comment pk>"}}
```

```
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name = PolarisCommentActionsUnlikeMutation
doc_id                   = 27318337671093716
variables                = {"input":{"comment_id":"<comment pk>"}}
```

Response root field: `xig_comment_like` (type `XIGCommentLikeMutationResponse`); the
client selects only `__typename`, i.e. success is signalled by absence of `errors`.
Both are marked `is_fully_www_executable`, so they go to `/api/graphql` (no
`x-root-field-name`). The client optimistically flips
`has_liked_comment` / `comment_like_count` and rolls back on error
(`LIKE_COMMENT_REQUESTED` → `_SUCCEEDED` / `_FAILED`).

Related, same module: `PolarisAPIApproveRestrictedComment` →
`POST /api/v1/web/restrict_action/approve_restricted_comment/`.

---

## 4. Post a comment / post a reply — CLIENT-BUNDLE ONLY (not exercised in this HAR)

`PolarisAPICommentOnPost`:

```
POST https://www.instagram.com/api/v1/web/comments/{media_id}/add/
Content-Type: application/x-www-form-urlencoded    (PolarisInstapi apiPost)

comment_text=<string>
replied_to_comment_id=<parent comment pk | omitted for a top-level comment>
```

Returns the API envelope; the client uses `response.data` (a single created comment
object, same shape as §1/§2 entries — `pk`, `text`, `user`, `created_at`, `status`,
`type`, and `parent_comment_id`/`replied_to_comment_id` for replies).

Delete: `POST /api/v1/web/comments/{media_id}/delete/{comment_id}/`.

Note: a reply is just an add-comment call with `replied_to_comment_id`. When replying
to a reply, web sets `replied_to_comment_id` to the *reply's* id while the server
still reports `parent_comment_id` as the thread root (see §2).

---

## 5. Share sheet / share-to-direct recipients

### 5a. Ranked recipient list — OBSERVED (GraphQL, current path)

```
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name = PolarisShareSheetV3NullStateQuery
doc_id                   = 36651079954537487
variables = {"input":{"count_per_page":20,"is_private_share":false,"views":["RESHARE_SHARE_SHEET"]}}
```

The Direct-composer variant of the same backend field:

```
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name = IGDOmniPickerNullStateListQuery
doc_id                   = 27657376130569675
variables = {"input":{"count_per_page":20,"is_private_share":false,"views":["DIRECT_USER_SEARCH_NULLSTATE"]}}
```

Other known ids for the same family (from the bundle):
`IGDShareSheetV3DialogNullStateQuery` = `26777619091940446` (same
`{count_per_page:20, is_private_share:false, views:["RESHARE_SHARE_SHEET"]}` input).

Observed response (from `IGDOmniPickerNullStateListQuery`; the share-sheet query
returns the same field):

```jsonc
{
  "data": {
    "get_paginated_share_sheet_ranked_items": {
      "ranked_items": [
        {
          "__typename": "ShareSheetUser",
          "__isShareSheetItem": "ShareSheetUser",
          "share_sheet_item_id": "71263369307",
          "pk": "71263369307",
          "username": "…",
          "full_name": "…",
          "profile_pic_url": "https://scontent-…cdninstagram.com/…",
          "is_verified": false,
          "is_meta_ai_bot": false,
          "interop_messaging_user_fbid": "178…"
        }
        // 20 items, all ShareSheetUser in this capture; the
        // __isShareSheetItem/__typename split implies thread/group variants exist
      ]
    }
  },
  "extensions": { "server_metadata": { "request_start_time_ms", "time_at_flush_ms" },
                  "is_final": true }
}
```

No page-info/cursor object was returned alongside `ranked_items`; paging is via
`count_per_page` on the input. Typed-query search was not exercised in this capture.

### 5b. Post share bar (who to share this media with, inline under a post) — OBSERVED (request only)

```
POST https://www.instagram.com/graphql/query
x-root-field-name        = fetch__XDTMediaDict
fb_api_req_friendly_name = PolarisShareSheetV3PostShareBarQuery
doc_id                   = 27671932525779232
variables                = {"media_id":"3946426249878543390"}
```

Selects `XDTMediaDict` fields (incl. `user { is_private }` and a bloks app url) to
decide whether resharing is allowed. Response body was not captured.

Supporting request: `GET /ajax/bootloader-endpoint/?modules=PolarisShareSheetV3PostShareBarRoot.react&nb_modules=PolarisShareSheetV3Root.react,PolarisShareSheetV3ContactSearchRoot.react` — confirms the module set
(`PolarisShareSheetV3ContactSearch.entrypoint` preloads the null-state query above).

### 5c. Legacy REST recipients — CLIENT-BUNDLE ONLY

Still present in the Direct API module:

```
GET /api/v1/direct_v2/ranked_recipients/?mode=reshare&query=<text>&show_threads=false   // share sheet
GET /api/v1/direct_v2/ranked_recipients/?mode=raven&query=<text>&show_threads=true      // camera/raven
```

Neighbouring Direct endpoints in the same module (useful for a web Direct client):
`/api/v1/direct_v2/inbox/`, `/pending_inbox/`, `/threads/`,
`/threads/{thread_id}/items/{item_id}/seen/`, `/threads/broadcast/{text,link,
configure_photo,animated_media,forward,story_share,reel_share,reel_react,
share_avatar_sticker,live_viewer_invite}/`, `/create_group_thread/`
(`recipient_users=JSON`), `/threads/{id}/add_user/`, `/threads/{id}/remove_users/`,
`/threads/approve_multiple/`, `/threads/decline_all/`, `/threads/decline_multiple/`,
`/get_presence/`, `/in_thread_message_search/`, `/search_secondary/`,
`/has_interop_upgraded/`, `/icebreakers/get_suggested_icebreakers/`,
`/quick_reply/{create,update,delete}/`.

---

## 6. Gaps in this capture

* No comment-like/unlike, add-comment, or reply-post request was actually made — §3
  and §4 are reconstructed from the shipped Polaris bundle, so the **response**
  shapes for those are unverified.
* `preview_child_comments` was empty on every top-level comment in the captured
  pages; its element shape is assumed identical to `ChildComment` (§2).
* Share-sheet search-as-you-type (non-null-state) and the actual "send to direct"
  mutation were not captured.
* Other comment-related persisted queries present in the bundle, not exercised:
  `PolarisPostCommentsContainerQuery` = `26297736713236852`,
  `PolarisClipsDesktopCommentsPopoverQuery` = `26898197033164947`,
  `PolarisCommentTranslationPromptQuery` = `37170391372551639`,
  `PolarisPostCommentTranslationPromptQuery` = `27104361862549445`.
* `doc_id`s and `x-asbd-id`/`x-ig-app-id` values rotate with Instagram web builds;
  treat them as capability-checked configuration, not constants.
