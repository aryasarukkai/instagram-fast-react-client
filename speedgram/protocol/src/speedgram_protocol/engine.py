"""Stateful, allowlisted boundary around instagrapi.

Only normalized data leaves this process. Raw responses and credentials stay on the
private stdin/stdout pipe owned by the Tauri host.
"""

from __future__ import annotations

import hashlib
from importlib.metadata import version
import json
import re
import secrets
from typing import Any, Callable
import uuid

import requests

from instagrapi import Client
from instagrapi.exceptions import (
    AccountSuspended,
    BadCredentials,
    BadPassword,
    ChallengeError,
    ChallengeRequired,
    ClientError,
    ClientConnectionError,
    ClientRequestTimeout,
    ClientThrottledError,
    FeedbackRequired,
    LoginRequired,
    PleaseWaitFewMinutes,
    RateLimitError,
    TwoFactorRequired,
)


# Web (Polaris) backend constants — the desktop-web app identity.
_WEB_BASE = "https://www.instagram.com"
_WEB_APP_ID = "936619743392459"
_WEB_ASBD_ID = "359341"
_WEB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)
_WEB_SEC_CH_UA = '"Chromium";v="149", "Google Chrome";v="149", "Not)A;Brand";v="24"'


class ProtocolError(ValueError):
    """Safe error returned to the native host."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class VerificationCodeNeeded(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


def _string(value: Any, default: str = "") -> str:
    return str(value) if value not in (None, "") else default


def _integer(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _best_image(media: dict[str, Any]) -> str | None:
    candidates = media.get("image_versions2", {}).get("candidates", []) or []
    for candidate in candidates:
        url = candidate.get("url")
        if url:
            return str(url)
    return None


def _best_video(media: dict[str, Any]) -> str | None:
    versions = media.get("video_versions", []) or []
    for candidate in versions:
        url = candidate.get("url")
        if url:
            return str(url)
    return None


def _normalize_media_asset(media: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _string(media.get("id") or media.get("pk")),
        "imageUrl": _best_image(media),
        "videoUrl": _best_video(media),
        "width": _integer(media.get("original_width")),
        "height": _integer(media.get("original_height")),
    }


def _media_liked_by(media: Any) -> list[dict[str, Any]]:
    """Real liker context returned with feed media, capped for a compact facepile."""
    read = media.get if isinstance(media, dict) else lambda key, default=None: getattr(media, key, default)
    top_likers = read("top_likers", []) or []
    top_names = [_string(value) for value in top_likers if _string(value)]
    social_context = read("social_context", []) or []
    social_users: list[Any] = []
    if isinstance(social_context, dict):
        social_context = [social_context]
    for context in social_context if isinstance(social_context, list) else []:
        context_read = context.get if isinstance(context, dict) else lambda key, default=None: getattr(context, key, default)
        candidates = context_read("social_context_facepile_users", []) or []
        if isinstance(candidates, list):
            social_users.extend(candidates)

    facepile = social_users or (read("facepile_top_likers", []) or [])
    if not isinstance(facepile, list):
        facepile = []

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, value in enumerate(facepile[:3]):
        value_read = value.get if isinstance(value, dict) else lambda key, default=None: getattr(value, key, default)
        username = _string(value_read("username")) or (top_names[index] if index < len(top_names) else "")
        user_id = _string(value_read("pk") or value_read("id") or value_read("userID"))
        profile = _url(value_read("profile_pic_url"))
        identity = user_id or username or profile or str(index)
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append({
            "id": user_id,
            "username": username,
            "profilePictureUrl": profile,
        })

    # Some responses provide usernames and facepile photos in parallel arrays.
    for index, username in enumerate(top_names[:3]):
        if any(user["username"] == username for user in normalized):
            continue
        face = facepile[index] if index < len(facepile) else None
        face_read = face.get if isinstance(face, dict) else lambda key, default=None: getattr(face, key, default)
        normalized.append({
            "id": _string(face_read("pk") or face_read("id") or face_read("userID")),
            "username": username,
            "profilePictureUrl": _url(face_read("profile_pic_url")),
        })
        if len(normalized) == 3:
            break
    return normalized


def normalize_timeline_item(media: dict[str, Any]) -> dict[str, Any] | None:
    media_id = _string(media.get("id") or media.get("pk"))
    if not media_id:
        return None

    user = media.get("user") or {}
    caption = media.get("caption") or {}
    location = media.get("location") or {}
    media_type = _integer(media.get("media_type"))
    kind = {1: "image", 2: "video", 8: "carousel"}.get(media_type, "unknown")
    children = [
        _normalize_media_asset(child)
        for child in (media.get("carousel_media") or [])
        if isinstance(child, dict)
    ]

    return {
        "id": media_id,
        "kind": kind,
        "user": {
            "username": _string(user.get("username"), "instagram"),
            "fullName": _string(user.get("full_name")),
            "profilePictureUrl": user.get("profile_pic_url"),
            "verified": bool(user.get("is_verified", False)),
        },
        "caption": _string(caption.get("text")),
        "takenAt": _integer(media.get("taken_at")),
        "location": _string(location.get("name")),
        "likeCount": _integer(media.get("like_count")),
        "likedBy": _media_liked_by(media),
        "commentCount": _integer(media.get("comment_count")),
        "liked": bool(media.get("has_liked", False)),
        "saved": bool(media.get("has_viewer_saved", False)),
        "trackingToken": _string(media.get("organic_tracking_token")) or None,
        "loggingInfoToken": _string(media.get("logging_info_token")) or None,
        "imageUrl": _best_image(media),
        "videoUrl": _best_video(media),
        "children": children,
    }


def _url(value: Any) -> str | None:
    return str(value) if value else None


def _thread_image_url(value: Any) -> str | None:
    """Normalize Polaris' optional custom group image without exposing its wrapper."""
    if isinstance(value, dict):
        return _url(value.get("url") or value.get("uri"))
    return _url(value)


def _timestamp(value: Any) -> int:
    """Seconds since epoch from either a datetime or an already-numeric field."""
    if value is None:
        return 0
    epoch = getattr(value, "timestamp", None)
    if callable(epoch):
        try:
            return int(epoch())
        except (TypeError, ValueError, OSError):
            return 0
    return _integer(value)


def _user_short(user: Any) -> dict[str, Any]:
    """Normalize either an instagrapi UserShort model or a raw user dict."""
    get = user.get if isinstance(user, dict) else lambda key, default=None: getattr(user, key, default)
    return {
        "id": _string(get("pk") or get("id")),
        "username": _string(get("username"), "instagram"),
        "fullName": _string(get("full_name")),
        "profilePictureUrl": _url(get("profile_pic_url")),
        "verified": bool(get("is_verified", False)),
    }


def normalize_media_model(media: Any) -> dict[str, Any]:
    """Normalize an instagrapi Media model (reels, explore, profile grids)."""
    kind = {1: "image", 2: "video", 8: "carousel"}.get(_integer(getattr(media, "media_type", 0)), "unknown")
    clips = getattr(media, "clips_metadata", None)
    audio = None
    if clips is not None:
        music = getattr(clips, "music_info", None) if not isinstance(clips, dict) else clips.get("music_info")
        original = getattr(clips, "original_sound_info", None) if not isinstance(clips, dict) else clips.get("original_sound_info")
        for source, artist_key, title_key in (
            (music, "display_artist", "title"),
            (original, "original_audio_title", "original_audio_title"),
        ):
            if source is None:
                continue
            read = source.get if isinstance(source, dict) else lambda key, default=None: getattr(source, key, default)
            title = _string(read(title_key))
            artist = _string(read(artist_key))
            if title or artist:
                audio = " · ".join(part for part in (artist, title) if part)
                break

    return {
        "id": _string(getattr(media, "id", None) or getattr(media, "pk", None)),
        "code": _string(getattr(media, "code", None)),
        "kind": kind,
        "user": _user_short(getattr(media, "user", None)),
        "caption": _string(getattr(media, "caption_text", None)),
        "takenAt": _timestamp(getattr(media, "taken_at", None)),
        "location": _string(getattr(getattr(media, "location", None), "name", None)),
        "likeCount": _integer(getattr(media, "like_count", 0)),
        "likedBy": _media_liked_by(media),
        "commentCount": _integer(getattr(media, "comment_count", 0)),
        "viewCount": _integer(getattr(media, "play_count", None) or getattr(media, "view_count", 0)),
        "liked": bool(getattr(media, "has_liked", False)),
        "saved": bool(getattr(media, "viewer_has_saved", False)),
        "imageUrl": _url(getattr(media, "thumbnail_url", None)),
        "videoUrl": _url(getattr(media, "video_url", None)),
        "audio": audio,
        "children": [
            {
                "id": _string(getattr(resource, "pk", None)),
                "imageUrl": _url(getattr(resource, "thumbnail_url", None)),
                "videoUrl": _url(getattr(resource, "video_url", None)),
            }
            for resource in (getattr(media, "resources", None) or [])
        ],
    }


def _model_value(value: Any, key: str, default: Any = None) -> Any:
    """Read a field from either an instagrapi model or its raw dictionary form."""
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


def _direct_candidate_url(container: Any, key: str) -> str | None:
    versions = _model_value(container, key)
    if isinstance(versions, dict):
        versions = versions.get("candidates") or versions.get("items") or []
    if not isinstance(versions, list):
        return None
    for version in versions:
        url = _model_value(version, "url")
        if url:
            return _url(url)
    return None


def _direct_media_card(
    media: Any,
    *,
    fallback_id: str,
    share_type: str,
    caption: str = "",
) -> dict[str, Any] | None:
    if media is None:
        return None
    media_type = _integer(_model_value(media, "media_type"))
    kind = {1: "image", 2: "video", 8: "carousel"}.get(media_type, share_type)
    image_url = _url(_model_value(media, "thumbnail_url"))
    image_url = image_url or _direct_candidate_url(_model_value(media, "image_versions2"), "candidates")
    video_url = _url(_model_value(media, "video_url"))
    video_url = video_url or _direct_candidate_url(media, "video_versions")
    audio_url = _url(_model_value(media, "audio_url"))
    user = _model_value(media, "user")
    return {
        "id": _string(_model_value(media, "id") or _model_value(media, "media_id") or fallback_id),
        "code": _string(_model_value(media, "code")),
        "kind": kind,
        "shareType": share_type,
        "user": _user_short(user) if user is not None else _user_short({}),
        "caption": caption or _string(_model_value(media, "caption_text")),
        "imageUrl": image_url,
        "videoUrl": video_url,
        "audioUrl": audio_url,
        "children": [],
    }


def _direct_xma_card(value: Any, *, fallback_id: str, share_type: str) -> dict[str, Any] | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    image_url = _url(_model_value(value, "preview_url") or _model_value(value, "header_icon_url"))
    video_url = _url(_model_value(value, "video_url"))
    title = _string(_model_value(value, "title") or _model_value(value, "title_text"))
    username = _string(_model_value(value, "header_title_text"), "instagram")
    if not image_url and not video_url and not title:
        return None
    return {
        "id": _string(_model_value(value, "preview_media_fbid") or fallback_id),
        "code": "",
        "kind": "video" if video_url else "image",
        "shareType": share_type,
        "user": {
            "id": "",
            "username": username,
            "fullName": "",
            "profilePictureUrl": _url(_model_value(value, "header_icon_url")),
            "verified": False,
        },
        "caption": title,
        "imageUrl": image_url,
        "videoUrl": video_url,
        "audioUrl": None,
        "children": [],
    }


def _direct_message_share(message: Any, item_id: str) -> dict[str, Any] | None:
    for field, share_type in (("clip", "reel"), ("media_share", "post")):
        value = _model_value(message, field)
        if value is not None:
            card = normalize_media_model(value)
            card["shareType"] = share_type
            card["audioUrl"] = None
            return card

    media = _model_value(message, "media")
    if media is not None:
        audio_url = _url(_model_value(media, "audio_url"))
        return _direct_media_card(
            media,
            fallback_id=item_id,
            share_type="voice" if audio_url else "attachment",
        )

    visual = _model_value(message, "visual_media")
    if visual is not None:
        content = _model_value(visual, "media")
        return _direct_media_card(content, fallback_id=item_id, share_type="disappearing")

    for field, share_type in (("xma_share", "post"), ("generic_xma", "post")):
        card = _direct_xma_card(_model_value(message, field), fallback_id=item_id, share_type=share_type)
        if card:
            return card

    for field, share_type in (("reel_share", "reel"), ("story_share", "story"), ("felix_share", "video")):
        payload = _model_value(message, field)
        if not isinstance(payload, dict):
            continue
        nested = payload.get("media") or payload.get("clip") or payload.get("reel")
        if isinstance(nested, dict):
            card = normalize_timeline_item(nested)
            if card:
                card["shareType"] = share_type
                card["audioUrl"] = None
                return card
        card = _direct_xma_card(payload, fallback_id=item_id, share_type=share_type)
        if card:
            return card

    link = _model_value(message, "link")
    context = _model_value(link, "link_context") if link is not None else None
    if context is not None:
        return {
            "id": _string(_model_value(context, "link_url") or item_id),
            "code": "",
            "kind": "link",
            "shareType": "link",
            "user": _user_short({}),
            "caption": _string(_model_value(context, "link_title") or _model_value(context, "link_summary")),
            "imageUrl": _url(_model_value(context, "link_image_url")),
            "videoUrl": None,
            "audioUrl": None,
            "url": _url(_model_value(context, "link_url")),
            "children": [],
        }

    animated = _model_value(message, "animated_media")
    if isinstance(animated, dict):
        images = animated.get("images") or {}
        preview = images.get("fixed_height") or images.get("fixed_width") or {}
        image_url = _url(preview.get("url")) if isinstance(preview, dict) else None
        if image_url:
            return {
                "id": item_id,
                "code": "",
                "kind": "image",
                "shareType": "gif",
                "user": _user_short({}),
                "caption": "",
                "imageUrl": image_url,
                "videoUrl": None,
                "audioUrl": None,
                "children": [],
            }
    return None


def _direct_reactions(message: Any) -> list[str]:
    reactions = _model_value(message, "reactions")
    if reactions is None:
        return []
    likes = _model_value(reactions, "likes", []) or []
    count = len(likes) or _integer(_model_value(reactions, "likes_count"))
    out = ["❤️"] * count
    for reaction in _model_value(reactions, "emojis", []) or []:
        emoji = _string(_model_value(reaction, "emoji"))
        if emoji:
            out.append(emoji)
    return out


def normalize_story_tray(payload: dict[str, Any], viewer_id: str = "") -> dict[str, Any]:
    """Reels tray: who has an unseen story, in Instagram's own order."""
    items: list[dict[str, Any]] = []
    for tray in payload.get("tray", []) or []:
        if not isinstance(tray, dict):
            continue
        user = tray.get("user") or {}
        latest = _integer(tray.get("latest_reel_media"))
        seen = _integer(tray.get("seen"))
        tray_id = _string(tray.get("id") or user.get("pk"))
        items.append(
            {
                "id": tray_id,
                "user": _user_short(user),
                "mediaCount": _integer(tray.get("media_count")),
                "latestAt": latest,
                "unseen": bool(latest and latest > seen),
                "own": bool(viewer_id) and tray_id == viewer_id,
            }
        )
    return {"items": items}


def normalize_comment(comment: Any) -> dict[str, Any]:
    return {
        "id": _string(getattr(comment, "pk", None)),
        "user": _user_short(getattr(comment, "user", None)),
        "text": _string(getattr(comment, "text", None)),
        "createdAt": _timestamp(getattr(comment, "created_at_utc", None)),
        "likeCount": _integer(getattr(comment, "like_count", 0)),
        "liked": bool(getattr(comment, "has_liked", False)),
        "replyTo": _string(getattr(comment, "replied_to_comment_id", None)) or None,
    }


def _web_seconds(value: Any) -> int:
    """Web/private timestamps are microseconds since epoch; reduce to seconds."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number // 1_000_000 if number > 10_000_000_000 else number


def _web_share(item: dict[str, Any]) -> dict[str, Any] | None:
    """Extract a shared post/reel from a DM item into the normalized post shape."""
    for key in ("media_share", "media"):
        media = item.get(key)
        if isinstance(media, dict):
            share = normalize_timeline_item(media)
            if share:
                share["shareType"] = "post"
                share["audioUrl"] = None
                return share
    clip = item.get("clip")
    if isinstance(clip, dict):
        media = clip.get("clip") if isinstance(clip.get("clip"), dict) else clip
        share = normalize_timeline_item(media) if isinstance(media, dict) else None
        if share:
            share["shareType"] = "reel"
            share["audioUrl"] = None
            return share
    visual = item.get("visual_media")
    if isinstance(visual, dict) and isinstance(visual.get("media"), dict):
        share = normalize_timeline_item(visual["media"])
        if share:
            share["shareType"] = "disappearing"
            share["audioUrl"] = None
            return share
    # Newer XMA reel/post share cards carry a preview image + target url.
    for key in ("xma_clip", "xma_media_share", "xma_story_share", "xma_share", "generic_xma"):
        cards = item.get(key)
        card = cards[0] if isinstance(cards, list) and cards else cards
        if isinstance(card, dict):
            preview = card.get("preview_url") or card.get("header_icon_url")
            video = card.get("video_url")
            if preview or video:
                share_type = "reel" if key == "xma_clip" else ("story" if key == "xma_story_share" else "post")
                return {
                    "id": _string(card.get("target_url") or item.get("item_id")),
                    "kind": "video" if video else "image",
                    "shareType": share_type,
                    "user": {
                        "username": _string(card.get("header_title_text"), "instagram"),
                        "fullName": "",
                        "profilePictureUrl": _url(card.get("header_icon_url")),
                        "verified": False,
                    },
                    "caption": _string(card.get("title_text")),
                    "imageUrl": _url(preview),
                    "videoUrl": _url(video),
                    "audioUrl": None,
                    "children": [],
                }
    return None


def _normalize_web_profile_user(user: dict[str, Any]) -> dict[str, Any]:
    """Normalize the user object from web_profile_info (GraphQL edge shape)."""
    return {
        "id": _string(user.get("id")),
        "username": _string(user.get("username"), "instagram"),
        "fullName": _string(user.get("full_name")),
        "profilePictureUrl": _url(user.get("profile_pic_url_hd") or user.get("profile_pic_url")),
        "verified": bool(user.get("is_verified", False)),
        "biography": _string(user.get("biography")),
        "isPrivate": bool(user.get("is_private", False)),
        "mediaCount": _integer((user.get("edge_owner_to_timeline_media") or {}).get("count")),
        "followerCount": _integer((user.get("edge_followed_by") or {}).get("count")),
        "followingCount": _integer((user.get("edge_follow") or {}).get("count")),
    }


def _normalize_web_grid_media(node: dict[str, Any]) -> dict[str, Any]:
    """Normalize a profile-grid media node (web GraphQL) into the post shape."""
    is_video = bool(node.get("is_video"))
    typename = _string(node.get("__typename"))
    kind = "video" if is_video else ("carousel" if "Sidecar" in typename else "image")
    caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
    caption = _string(caption_edges[0].get("node", {}).get("text")) if caption_edges else ""
    likes = node.get("edge_liked_by") or node.get("edge_media_preview_like") or {}
    return {
        "id": _string(node.get("id")),
        "code": _string(node.get("shortcode")),
        "kind": kind,
        "user": _user_short(node.get("owner")),
        "caption": caption,
        "takenAt": _integer(node.get("taken_at_timestamp")),
        "location": "",
        "likeCount": _integer(likes.get("count")),
        "commentCount": _integer((node.get("edge_media_to_comment") or {}).get("count")),
        "viewCount": _integer(node.get("video_view_count")),
        "liked": False,
        "saved": False,
        "imageUrl": _url(node.get("display_url") or node.get("thumbnail_src")),
        "videoUrl": _url(node.get("video_url")) if is_video else None,
        "audio": None,
        "children": [],
    }


def _media_pk(media_id: str) -> str:
    """Bare media pk — web GraphQL likes/saves reject the `{pk}_{user}` form."""
    return _string(media_id).split("_", 1)[0]


def _web_reply_text(item: dict[str, Any]) -> str | None:
    quoted = item.get("replied_to_message") or item.get("reply")
    if isinstance(quoted, dict):
        return _string(quoted.get("text")) or None
    return None


def _web_reactions(item: dict[str, Any]) -> list[str]:
    reactions = item.get("reactions")
    if not isinstance(reactions, dict):
        return []
    out: list[str] = []
    for _ in reactions.get("likes") or []:
        out.append("❤️")  # red heart, forced emoji presentation
    for emoji in reactions.get("emojis") or []:
        value = emoji.get("emoji") if isinstance(emoji, dict) else None
        if value:
            out.append(_string(value))
    return out


def _normalize_web_message(message: dict[str, Any], viewer_id: str) -> dict[str, Any]:
    user_id = _string(message.get("user_id"))
    item_id = _string(message.get("item_id") or message.get("id"))
    # Prefer the GraphQL `mid.$…` form when present — reactions/read/reply need it.
    message_id = _string(message.get("message_id") or message.get("client_context")) or item_id
    if message_id and not message_id.startswith("mid.") and item_id.startswith("mid."):
        message_id = item_id
    return {
        "id": item_id,
        "messageId": message_id or item_id,
        "clientContext": _string(message.get("client_context") or message.get("offline_threading_id")) or None,
        "userId": user_id,
        "mine": bool(viewer_id and user_id == viewer_id),
        "kind": _string(message.get("item_type"), "text"),
        "text": _string(message.get("text")),
        "timestamp": _web_seconds(message.get("timestamp")),
        "share": _web_share(message),
        "reply": _web_reply_text(message),
        "reactions": _web_reactions(message),
    }


def _normalize_web_thread(thread: dict[str, Any], viewer_id: str) -> dict[str, Any]:
    users = [_user_short(user) for user in (thread.get("users") or []) if isinstance(user, dict)]
    title = _string(thread.get("thread_title")) or ", ".join(user["username"] for user in users)
    items = thread.get("items") or []
    messages = [
        _normalize_web_message(item, viewer_id)
        for item in items
        if isinstance(item, dict) and item.get("item_type") != "action_log"
    ]
    last_activity = thread.get("last_activity_at")
    unread = False
    last_seen = thread.get("last_seen_at")
    if isinstance(last_seen, dict) and viewer_id in last_seen:
        try:
            unread = int(last_seen[viewer_id].get("timestamp", 0)) < int(last_activity or 0)
        except (TypeError, ValueError, AttributeError):
            unread = False
    return {
        "id": _string(thread.get("thread_id") or thread.get("id")),
        "title": title,
        "users": users,
        "isGroup": bool(thread.get("is_group", False)),
        "threadImageUrl": _thread_image_url(thread.get("thread_image_url")),
        "muted": bool(thread.get("muted", False)),
        "pending": bool(thread.get("pending", False)),
        "lastActivityAt": _web_seconds(last_activity),
        "unread": unread,
        "lastReadMessageId": _string((items[0] if items and isinstance(items[0], dict) else {}).get("message_id")) or None,
        "messages": list(reversed(messages)),
    }


def _slide_share(message: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize Polaris Slide/XMA message content without exposing raw payloads."""
    content = message.get("content") if isinstance(message.get("content"), dict) else {}
    content_type = _string(message.get("content_type"))
    xma = content.get("xma") if isinstance(content.get("xma"), dict) else None
    if xma:
        preview = xma.get("preview_image") if isinstance(xma.get("preview_image"), dict) else {}
        icon = xma.get("header_icon") if isinstance(xma.get("header_icon"), dict) else {}
        target_url = _string(xma.get("target_url"))
        share_type = "story" if content_type == "MONTAGE_SHARE_XMA" else (
            "reel" if "/reel/" in target_url or "/reels/" in target_url else "post"
        )
        return {
            "id": _string(xma.get("target_id") or message.get("message_id") or message.get("id")),
            "code": "",
            "kind": "video" if share_type in {"reel", "story"} else "image",
            "shareType": share_type,
            "user": {
                "id": "",
                "username": _string(xma.get("header_title_text"), "instagram"),
                "fullName": "",
                "profilePictureUrl": _url(icon.get("url")),
                "verified": _string(xma.get("verified_type")).lower() not in {"", "none", "not_verified"},
            },
            "caption": _string(xma.get("title_text") or content.get("xma_text_body")),
            "imageUrl": _url(preview.get("url") or preview.get("fallback_url")),
            "videoUrl": None,
            "audioUrl": None,
            "children": [],
        }

    attachments = content.get("attachments") if isinstance(content.get("attachments"), list) else []
    if attachments and isinstance(attachments[0], dict):
        attachment = attachments[0]
        return {
            "id": _string(attachment.get("attachment_fbid") or message.get("message_id")),
            "code": "",
            "kind": "image",
            "shareType": "attachment",
            "user": _user_short({}),
            "caption": "",
            "imageUrl": _url(attachment.get("attachment_cdn_url") or attachment.get("preview_cdn_url")),
            "videoUrl": None,
            "audioUrl": None,
            "children": [],
        }

    animated = content.get("animated_media")
    if isinstance(animated, dict):
        animated = [animated]
    if isinstance(animated, list) and animated and isinstance(animated[0], dict):
        media = animated[0]
        return {
            "id": _string(message.get("message_id") or message.get("id")),
            "code": "",
            "kind": "video" if media.get("attachment_mp4_url") else "image",
            "shareType": "gif",
            "user": _user_short({}),
            "caption": _string(media.get("alt_text")),
            "imageUrl": _url(media.get("attachment_webp_url") or media.get("preview_cdn_url")),
            "videoUrl": _url(media.get("attachment_mp4_url")),
            "audioUrl": None,
            "children": [],
        }

    preview_url = _url(content.get("preview_url"))
    if preview_url:
        return {
            "id": _string(message.get("message_id") or message.get("id")),
            "code": "",
            "kind": "image",
            "shareType": "sticker",
            "user": _user_short({}),
            "caption": _string(content.get("alt_text")),
            "imageUrl": preview_url,
            "videoUrl": None,
            "audioUrl": None,
            "children": [],
        }
    return None


def _slide_reactions(message: dict[str, Any]) -> list[str]:
    raw = message.get("msg_reactions") or message.get("reactions") or []
    if not isinstance(raw, list):
        return []
    reactions: list[str] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        value = _string(item.get("reaction") or item.get("emoji"))
        if value:
            reactions.append(value)
    return reactions


def _slide_user(user: dict[str, Any]) -> dict[str, Any]:
    """Use the messaging FBID namespace emitted by Slide message senders."""
    normalized = _user_short(user)
    normalized["id"] = _string(
        user.get("interop_messaging_user_fbid")
        or user.get("fbid_v2")
        or user.get("id")
        or user.get("pk")
    )
    return normalized


def _slide_reply_preview(message: dict[str, Any]) -> str | None:
    """Return the quoted text or a useful label for replied-to rich media."""
    replied = message.get("replied_to_message")
    if not isinstance(replied, dict):
        return None
    content = replied.get("content") if isinstance(replied.get("content"), dict) else {}
    text = _string(content.get("text_body") or replied.get("text_body")).strip()
    if text:
        return text
    share = _slide_share(replied)
    if share:
        label = {
            "reel": "Reel",
            "story": "Story",
            "gif": "GIF",
            "attachment": "Photo",
            "sticker": "Sticker",
        }.get(_string(share.get("shareType")), "Post")
        username = _string((share.get("user") or {}).get("username"))
        if username and username != "instagram":
            return f"{label} from @{username.lstrip('@')}"
        return label
    content_type = _string(replied.get("content_type")).upper()
    if "ANIMATED" in content_type:
        return "GIF"
    if "VOICE" in content_type or "AUDIO" in content_type:
        return "Voice message"
    return "Attachment"


def _slide_last_preview(edges: list[Any], viewer_id: str) -> str | None:
    """Surface invisible reaction activity in the inbox without rendering a log bubble."""
    for edge in edges:
        node = edge.get("node") if isinstance(edge, dict) else None
        if not isinstance(node, dict):
            continue
        if node.get("content_type") != "REACTION_LOG_XMAT":
            return None
        sender_id = _string(node.get("sender_fbid") or (node.get("sender") or {}).get("id"))
        return "You liked a message" if viewer_id and sender_id == viewer_id else "Liked a message"
    return None


def _slide_latest_message_id(edges: list[Any]) -> str | None:
    for edge in edges:
        node = edge.get("node") if isinstance(edge, dict) else None
        if not isinstance(node, dict):
            continue
        return _string(node.get("message_id") or node.get("id")) or None
    return None


def _normalize_slide_message(message: dict[str, Any], viewer_id: str) -> dict[str, Any]:
    content = message.get("content") if isinstance(message.get("content"), dict) else {}
    sender = message.get("sender") if isinstance(message.get("sender"), dict) else {}
    sender_user = sender.get("user_dict") if isinstance(sender.get("user_dict"), dict) else {}
    sender_id = _string(
        message.get("sender_fbid")
        or sender.get("id")
        or sender_user.get("interop_messaging_user_fbid")
        or sender_user.get("fbid_v2")
        or sender.get("igid")
        or sender_user.get("id")
    )
    message_id = _string(message.get("message_id") or message.get("id"))
    timestamp_ms = _integer(message.get("timestamp_ms"))
    return {
        "id": _string(message.get("id") or message_id),
        "messageId": message_id,
        "clientContext": _string(message.get("offline_threading_id")) or None,
        "userId": sender_id,
        "mine": bool(viewer_id and sender_id == viewer_id),
        "kind": _string(message.get("content_type"), "text").lower(),
        "text": _string(content.get("text_body") or message.get("text_body")),
        "timestamp": timestamp_ms // 1000 if timestamp_ms > 10_000_000_000 else timestamp_ms,
        "share": _slide_share(message),
        "reply": _slide_reply_preview(message),
        "reactions": _slide_reactions(message),
    }


def _normalize_slide_thread(thread: dict[str, Any]) -> dict[str, Any]:
    viewer = thread.get("viewer") if isinstance(thread.get("viewer"), dict) else {}
    viewer_id = _string(
        viewer.get("interop_messaging_user_fbid")
        or viewer.get("fbid_v2")
        or thread.get("viewer_id")
        or viewer.get("id")
    )
    users = [_slide_user(user) for user in (thread.get("users") or []) if isinstance(user, dict)]
    edges = (thread.get("slide_messages") or {}).get("edges") or []
    messages = [
        _normalize_slide_message(edge["node"], viewer_id)
        for edge in reversed(edges)
        if isinstance(edge, dict) and isinstance(edge.get("node"), dict)
        and edge["node"].get("content_type") not in {
            "REACTION_LOG_XMAT", "ADD_PARTICIPANT_XMAT", "REMOVE_PARTICIPANT_XMAT",
        }
    ]
    title = _string(thread.get("thread_title")) or ", ".join(user["username"] for user in users)
    last_activity_ms = _integer(thread.get("last_activity_timestamp_ms"))
    return {
        "id": _string(thread.get("thread_id") or thread.get("id")),
        "title": title,
        "users": users,
        "isGroup": bool(thread.get("is_group", False)),
        "threadImageUrl": _thread_image_url(thread.get("thread_image_url")),
        "muted": bool(thread.get("is_muted", False)),
        "pending": _string(thread.get("folder")).lower() in {"pending", "requests"},
        "lastActivityAt": last_activity_ms // 1000 if last_activity_ms > 10_000_000_000 else last_activity_ms,
        "unread": bool(thread.get("marked_as_unread", False)),
        "lastPreview": _slide_last_preview(edges, viewer_id),
        "lastReadMessageId": _slide_latest_message_id(edges),
        "messages": messages,
    }


def _normalize_web_comment(comment: dict[str, Any]) -> dict[str, Any]:
    """Normalize a comment from the web REST API (raw dict, not an instagrapi model)."""
    return {
        "id": _string(comment.get("pk") or comment.get("id")),
        "user": _user_short(comment.get("user")),
        "text": _string(comment.get("text")),
        "createdAt": _timestamp(comment.get("created_at_utc") or comment.get("created_at")),
        "likeCount": _integer(comment.get("comment_like_count") or comment.get("like_count")),
        "liked": bool(comment.get("has_liked_comment") or comment.get("has_liked", False)),
        "replyTo": _string(comment.get("replied_to_comment_id")) or None,
    }


def normalize_thread(thread: Any, viewer_id: str) -> dict[str, Any]:
    users = [_user_short(user) for user in (getattr(thread, "users", None) or [])]
    title = _string(getattr(thread, "thread_title", None)) or ", ".join(user["username"] for user in users)
    messages = [normalize_direct_message(message) for message in (getattr(thread, "messages", None) or [])]
    latest_message_id = messages[0]["messageId"] if messages else None
    is_seen = getattr(thread, "is_seen", None)
    seen = True
    if callable(is_seen) and viewer_id:
        try:
            seen = bool(is_seen(viewer_id))
        except Exception:
            seen = True
    return {
        "id": _string(getattr(thread, "id", None)),
        "title": title,
        "users": users,
        "isGroup": bool(getattr(thread, "is_group", False)),
        "threadImageUrl": _thread_image_url(getattr(thread, "thread_image_url", None)),
        "muted": bool(getattr(thread, "muted", False)),
        "pending": bool(getattr(thread, "pending", False)),
        "lastActivityAt": _timestamp(getattr(thread, "last_activity_at", None)),
        "unread": not seen,
        "lastReadMessageId": latest_message_id,
        "messages": list(reversed(messages)),
    }


def normalize_direct_message(message: Any) -> dict[str, Any]:
    item_type = _string(getattr(message, "item_type", None), "text")
    item_id = _string(getattr(message, "id", None))
    return {
        "id": item_id,
        "messageId": item_id,
        "clientContext": _string(getattr(message, "client_context", None)) or None,
        "userId": _string(getattr(message, "user_id", None)),
        "mine": bool(getattr(message, "is_sent_by_viewer", False)),
        "kind": item_type,
        "text": _string(getattr(message, "text", None)),
        "timestamp": _timestamp(getattr(message, "timestamp", None)),
        "share": _direct_message_share(message, item_id),
        "reply": _string(getattr(getattr(message, "reply", None), "text", None)) or None,
        "reactions": _direct_reactions(message),
    }


def normalize_note(note: Any) -> dict[str, Any]:
    return {
        "id": _string(getattr(note, "id", None)),
        "user": _user_short(getattr(note, "user", None)),
        "text": _string(getattr(note, "text", None)),
        "createdAt": _timestamp(getattr(note, "created_at", None)),
    }


def normalize_activity(payload: dict[str, Any]) -> dict[str, Any]:
    """Activity inbox stories, reduced to text the interface can render."""
    items: list[dict[str, Any]] = []
    for bucket in ("new_stories", "old_stories"):
        for story in payload.get(bucket, []) or []:
            if not isinstance(story, dict):
                continue
            args = story.get("args") or {}
            text = _string(args.get("text"))
            if not text:
                continue
            profile = (args.get("profile_image") or "")
            items.append(
                {
                    "id": _string(story.get("pk") or args.get("timestamp")),
                    "text": text,
                    "username": _string(args.get("profile_name")),
                    "profilePictureUrl": _url(profile),
                    "timestamp": _integer(args.get("timestamp")),
                    "thumbnailUrl": _url((args.get("media") or [{}])[0].get("image") if args.get("media") else None),
                    "unread": bucket == "new_stories",
                }
            )
    return {"items": items}


def normalize_user(user: Any) -> dict[str, Any]:
    return {
        **_user_short(user),
        "biography": _string(getattr(user, "biography", None)),
        "isPrivate": bool(getattr(user, "is_private", False)),
        "mediaCount": _integer(getattr(user, "media_count", 0)),
        "followerCount": _integer(getattr(user, "follower_count", 0)),
        "followingCount": _integer(getattr(user, "following_count", 0)),
        "profilePictureUrl": _url(getattr(user, "profile_pic_url_hd", None) or getattr(user, "profile_pic_url", None)),
    }


def normalize_timeline(payload: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for entry in payload.get("feed_items", []) or []:
        if not isinstance(entry, dict):
            continue
        media = entry.get("media_or_ad") or entry.get("media")
        if not isinstance(media, dict):
            continue
        normalized = normalize_timeline_item(media)
        if normalized is not None and normalized["kind"] != "unknown":
            items.append(normalized)

    cursor = payload.get("next_max_id")
    has_more = bool(payload.get("more_available") and cursor)
    return {
        "items": items,
        "nextCursor": str(cursor) if cursor else None,
        "hasMore": has_more,
    }


# Realistic, recent Android hardware profiles. instagrapi ships a single default
# device, so without this every first-time login would present the same hardware
# fingerprint, distinguished only by random UUIDs. Fields match instagrapi's
# config.DEVICE_SETTINGS schema; app version and UUIDs are left to instagrapi.
_DEVICE_POOL: tuple[dict[str, Any], ...] = (
    {
        "android_version": 34, "android_release": "14",
        "dpi": "480dpi", "resolution": "1344x2992",
        "manufacturer": "Google/google", "device": "husky",
        "model": "Pixel 8 Pro", "cpu": "husky",
    },
    {
        "android_version": 33, "android_release": "13",
        "dpi": "512dpi", "resolution": "1440x3120",
        "manufacturer": "Google/google", "device": "cheetah",
        "model": "Pixel 7 Pro", "cpu": "cheetah",
    },
    {
        "android_version": 34, "android_release": "14",
        "dpi": "600dpi", "resolution": "1440x3088",
        "manufacturer": "samsung", "device": "dm3q",
        "model": "SM-S918B", "cpu": "qcom",
    },
    {
        "android_version": 33, "android_release": "13",
        "dpi": "480dpi", "resolution": "1080x2340",
        "manufacturer": "samsung", "device": "r0q",
        "model": "SM-S901B", "cpu": "qcom",
    },
    {
        "android_version": 34, "android_release": "14",
        "dpi": "450dpi", "resolution": "1080x2412",
        "manufacturer": "OnePlus", "device": "OP594DL1",
        "model": "CPH2449", "cpu": "qcom",
    },
)


def _seed_device(client: Any, username: str) -> None:
    """Give a fresh client a stable, realistic device profile.

    The profile is derived from the username so one account stays on one device
    across retries, while different accounts spread across the pool. This runs
    only for brand-new logins; restored sessions carry their own saved device.
    """
    set_device = getattr(client, "set_device", None)
    if not callable(set_device):
        return
    digest = hashlib.sha256(username.strip().casefold().encode("utf-8")).digest()
    set_device(dict(_DEVICE_POOL[digest[0] % len(_DEVICE_POOL)]))


class ProtocolEngine:
    """One account session and a deliberately small RPC surface."""

    def __init__(self, client_factory: Callable[..., Any] = Client) -> None:
        self._client_factory = client_factory
        self._client: Any | None = None
        self._username: str | None = None
        self._password: str | None = None
        self._operation_id: str | None = None
        self._pending_code: str | None = None
        self._state = self._signed_out()
        self._web_actor_id_cache: str | None = None
        self._web_mutation_counter = 0
        self._web_device_id = str(uuid.uuid4())
        self._web_thread_keys: dict[str, str] = {}
        self._web_token_cache: dict[str, str] | None = None
        self._web_token_owner: str | None = None

    @staticmethod
    def _signed_out() -> dict[str, Any]:
        return {"status": "signed_out"}

    def health(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "engine": "instagrapi",
            "engineVersion": version("instagrapi"),
            "network": "idle",
            "session": self._state["status"],
        }

    def auth_state(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        return dict(self._state)

    def _new_client(
        self,
        settings: dict[str, Any] | None = None,
        seed_username: str | None = None,
    ) -> Any:
        try:
            client = self._client_factory(settings=settings)
        except TypeError:
            client = self._client_factory(settings)
        client.challenge_code_handler = self._challenge_code_handler
        if not settings and seed_username:
            _seed_device(client, seed_username)
        return client

    def _challenge_code_handler(self, _username: str, choice: Any) -> str:
        if self._pending_code:
            code, self._pending_code = self._pending_code, None
            return code
        label = _string(getattr(choice, "name", choice), "code").lower()
        kind = "email" if "email" in label else "sms" if "sms" in label else "code"
        raise VerificationCodeNeeded(kind)

    def _authenticated(self) -> dict[str, Any]:
        username = _string(getattr(self._client, "username", None), self._username or "instagram")
        self._operation_id = None
        self._pending_code = None
        self._state = {
            "status": "authenticated",
            "user": {"username": username},
        }
        return dict(self._state)

    def _device_name(self) -> str:
        settings = getattr(self._client, "device_settings", {}) or {}
        return _string(settings.get("model"), "Android device")

    def _verification_methods(self, kind: str) -> list[str]:
        if kind == "email":
            return ["email_code"]
        if kind == "sms":
            return ["sms_code"]
        if kind == "code":
            return ["verification_code"]

        info = getattr(self._client, "last_json", {}) or {}
        two_factor = info.get("two_factor_info", {}) if isinstance(info, dict) else {}
        methods = ["push_approval"]
        if two_factor.get("totp_two_factor_on"):
            methods.extend(["authenticator_code", "backup_code"])
        if two_factor.get("sms_two_factor_on"):
            methods.append("sms_code")
        if len(methods) == 1:
            methods.extend(["authenticator_code", "backup_code"])
        return methods

    def _verification(
        self,
        kind: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        self._operation_id = self._operation_id or secrets.token_urlsafe(12)
        self._state = {
            "status": "verification_required",
            "operationId": self._operation_id,
            "verificationKind": kind,
            "verificationMethods": self._verification_methods(kind),
            "deviceName": self._device_name(),
        }
        if error_code:
            self._state["errorCode"] = error_code
        if error_message:
            self._state["errorMessage"] = error_message
        return dict(self._state)

    def _manual_approval(self) -> dict[str, Any]:
        self._operation_id = self._operation_id or secrets.token_urlsafe(12)
        self._state = {
            "status": "manual_approval_required",
            "operationId": self._operation_id,
            "message": "Approve this login in the official Instagram app, then continue here.",
        }
        return dict(self._state)

    def _failure(self, code: str, message: str, retry_after: int | None = None) -> dict[str, Any]:
        self._state = {"status": "error", "code": code, "message": message}
        if retry_after:
            self._state["retryAfter"] = retry_after
        return dict(self._state)

    def _run_login(self, verification_code: str = "") -> dict[str, Any]:
        if self._client is None or not self._username or not self._password:
            return self._failure("session_expired", "Start a new login to continue.")
        self._state = {"status": "authenticating"}
        try:
            logged_in = self._client.login(
                self._username,
                self._password,
                verification_code=verification_code,
            )
            if not logged_in:
                return self._failure("invalid_credentials", "Instagram did not accept this login.")
            return self._authenticated()
        except VerificationCodeNeeded as exc:
            return self._verification(exc.kind)
        except TwoFactorRequired:
            return self._verification("two_factor")
        except (BadPassword, BadCredentials):
            return self._failure("invalid_credentials", "Check the username and password, then try again.")
        except AccountSuspended:
            return self._failure("account_restricted", "Instagram reports that this account is restricted.")
        except (PleaseWaitFewMinutes, RateLimitError, ClientThrottledError):
            return self._failure("rate_limited", "Instagram asked this device to slow down.", 300)
        except (ClientConnectionError, ClientRequestTimeout):
            return self._failure("network_error", "Instagram could not be reached. Check the connection and retry.")
        except LoginRequired:
            return self._failure("session_expired", "Instagram requires a fresh login.")
        except (ChallengeRequired, ChallengeError):
            return self._manual_approval()
        except FeedbackRequired:
            return self._failure("account_restricted", "Instagram paused requests for this account.")
        except ClientError:
            if verification_code:
                return self._verification(
                    "two_factor",
                    error_code="invalid_verification_code",
                    error_message="Instagram did not accept that code. Use a fresh code or approve the login in Instagram.",
                )
            return self._failure(
                "instagram_rejected",
                "Instagram rejected this login request. Review the official app before retrying.",
            )

    def auth_login(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        params = params or {}
        username = _string(params.get("username")).strip()
        password = _string(params.get("password"))
        if not username or not password:
            raise ProtocolError("invalid_request", "Username and password are required.")
        same_account = self._client is not None and (self._username or "").casefold() == username.casefold()
        self._username, self._password = username, password
        self._operation_id = secrets.token_urlsafe(12)
        self._pending_code = None
        settings = params.get("settings")
        if not same_account:
            self._client = self._new_client(
                settings if isinstance(settings, dict) else None,
                seed_username=username,
            )
        return self._run_login()

    def auth_restore(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        bundle = (params or {}).get("bundle")
        if not isinstance(bundle, dict):
            self._state = self._signed_out()
            return dict(self._state)
        username = _string(bundle.get("username")).strip()
        password = _string(bundle.get("password"))
        settings = bundle.get("settings")
        if not username or not password or not isinstance(settings, dict):
            self._state = self._signed_out()
            return dict(self._state)
        self._username, self._password = username, password
        self._client = self._new_client(settings)
        self._operation_id = secrets.token_urlsafe(12)
        return self._run_login()

    def auth_submit_code(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        params = params or {}
        if not self._operation_id or not secrets.compare_digest(
            _string(params.get("operationId")), self._operation_id
        ):
            raise ProtocolError("invalid_operation", "This verification request is no longer active.")
        code = _string(params.get("code")).replace(" ", "").replace("-", "")
        if not code:
            raise ProtocolError("invalid_request", "Enter the verification code.")
        self._pending_code = code
        return self._run_login(verification_code=code)

    def auth_continue_manual(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        params = params or {}
        if not self._operation_id or not secrets.compare_digest(
            _string(params.get("operationId")), self._operation_id
        ):
            raise ProtocolError("invalid_operation", "This approval request is no longer active.")
        last_json = getattr(self._client, "last_json", {}) or {}
        is_bloks_redirect = bool(
            isinstance(last_json, dict)
            and last_json.get("bloks_action")
            and last_json.get("challenge_context")
        )
        try:
            dismiss = getattr(self._client, "challenge_bloks_redirect_dismiss", None)
            if is_bloks_redirect and callable(dismiss):
                dismiss()
        except ChallengeRequired:
            return self._manual_approval()
        return self._run_login()

    def auth_cancel(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._client = None
        self._username = None
        self._password = None
        self._operation_id = None
        self._pending_code = None
        self._state = self._signed_out()
        return dict(self._state)

    def auth_logout(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._client is not None:
            try:
                logout = getattr(self._client, "logout", None)
                if callable(logout):
                    logout()
            except Exception:
                pass
        return self.auth_cancel()

    def auth_export_session(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._state.get("status") != "authenticated" or self._client is None:
            raise ProtocolError("not_authenticated", "No authenticated session is available.")
        return {
            "bundle": {
                "username": self._username,
                "password": self._password,
                "settings": self._client.get_settings(),
            }
        }

    def auth_export_device(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._client is None or not self._username:
            raise ProtocolError("no_device_profile", "No Instagram device profile is available.")
        return {
            "bundle": {
                "username": self._username,
                "settings": self._client.get_settings(),
            }
        }

    def feed_timeline(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._state.get("status") != "authenticated" or self._client is None:
            raise ProtocolError("not_authenticated", "Log in before loading the timeline.")
        cursor = (params or {}).get("cursor")
        reason = "pagination" if cursor else "cold_start_fetch"
        try:
            payload = self._client.get_timeline_feed(reason=reason, max_id=cursor or None)
            return normalize_timeline(payload)
        except (PleaseWaitFewMinutes, RateLimitError, ClientThrottledError):
            raise ProtocolError("rate_limited", "Instagram asked this device to slow down.")
        except LoginRequired:
            self._state = self._failure("session_expired", "Instagram requires a fresh login.")
            raise ProtocolError("session_expired", "Instagram requires a fresh login.")
        except (ChallengeRequired, ChallengeError, FeedbackRequired):
            raise ProtocolError("account_restricted", "Instagram paused timeline requests for this account.")
        except (ClientConnectionError, ClientRequestTimeout):
            raise ProtocolError("network_error", "Instagram could not be reached.")

    def _require_client(self) -> Any:
        if self._state.get("status") != "authenticated" or self._client is None:
            raise ProtocolError("not_authenticated", "Log in before loading Instagram data.")
        return self._client

    def _guarded(self, action: Callable[[], Any], subject: str) -> Any:
        """Run one Instagram call, mapping every failure to a safe protocol error."""
        try:
            return action()
        except (PleaseWaitFewMinutes, RateLimitError, ClientThrottledError):
            raise ProtocolError("rate_limited", "Instagram asked this device to slow down.")
        except LoginRequired:
            self._state = self._failure("session_expired", "Instagram requires a fresh login.")
            raise ProtocolError("session_expired", "Instagram requires a fresh login.")
        except (ChallengeRequired, ChallengeError, FeedbackRequired):
            raise ProtocolError("account_restricted", f"Instagram paused {subject} requests for this account.")
        except (ClientConnectionError, ClientRequestTimeout):
            raise ProtocolError("network_error", "Instagram could not be reached.")
        except ProtocolError:
            raise
        except ClientError:
            raise ProtocolError("instagram_rejected", f"Instagram did not return {subject}.")
        except Exception:
            raise ProtocolError("unexpected_error", f"SpeedGram could not load {subject}.")

    def _viewer_id(self) -> str:
        return _string(getattr(self._client, "user_id", None))

    def feed_stories(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        payload = self._guarded(lambda: client.get_reels_tray_feed("pull_to_refresh"), "stories")
        return normalize_story_tray(payload if isinstance(payload, dict) else {}, self._viewer_id())

    def feed_reels(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        amount = min(max(_integer(params.get("amount")) or 10, 1), 30)
        last_pk = _string(params.get("cursor"))
        source = "explore" if params.get("source") == "explore" else "following"
        fetch = client.explore_reels if source == "explore" else client.reels
        medias = self._guarded(lambda: fetch(amount=amount, last_media_pk=last_pk or 0), "reels")
        items = [normalize_media_model(media) for media in (medias or [])]
        return {
            "items": items,
            "nextCursor": _string(getattr(medias[-1], "pk", None)) if medias else None,
            "hasMore": bool(items),
        }

    def feed_explore(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        payload = self._guarded(client.explore_page, "explore")
        items: list[dict[str, Any]] = []
        sections = (payload or {}).get("sectional_items", []) if isinstance(payload, dict) else []
        for section in sections:
            if not isinstance(section, dict):
                continue
            layout = section.get("layout_content") or {}
            groups = layout.get("medias") or layout.get("one_by_two_item", {}).get("clips", {}).get("items", []) or []
            for entry in groups:
                media = entry.get("media") if isinstance(entry, dict) else None
                normalized = normalize_timeline_item(media) if isinstance(media, dict) else None
                if normalized is not None and normalized["kind"] != "unknown":
                    items.append(normalized)
        return {"items": items}

    def media_comments(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        media_id = _string(params.get("mediaId"))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        amount = min(max(_integer(params.get("amount")) or 20, 1), 50)
        comments = self._guarded(lambda: client.media_comments(media_id, amount=amount), "comments")
        return {"items": [normalize_comment(comment) for comment in (comments or [])]}

    def media_like(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        self._guarded(lambda: client.media_like(media_id), "like")
        return {"liked": True, "mediaId": media_id}

    def media_unlike(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        self._guarded(lambda: client.media_unlike(media_id), "unlike")
        return {"liked": False, "mediaId": media_id}

    def media_save(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        self._guarded(lambda: client.media_save(media_id), "save")
        return {"saved": True, "mediaId": media_id}

    def media_unsave(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        self._guarded(lambda: client.media_unsave(media_id), "unsave")
        return {"saved": False, "mediaId": media_id}

    def user_profile(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        username = _string((params or {}).get("username")) or _string(self._username)
        user = self._guarded(lambda: client.user_info_by_username(username), "this profile")
        return {"user": normalize_user(user)}

    def user_medias(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        user_id = _string(params.get("userId"))
        if not user_id:
            username = _string(params.get("username")) or _string(self._username)
            user_id = _string(self._guarded(lambda: client.user_id_from_username(username), "this profile"))
        amount = min(max(_integer(params.get("amount")) or 18, 1), 50)
        cursor = _string(params.get("cursor"))
        medias, next_cursor = self._guarded(
            lambda: client.user_medias_paginated(user_id, amount=amount, end_cursor=cursor),
            "these posts",
        )
        return {
            "items": [normalize_media_model(media) for media in (medias or [])],
            "nextCursor": next_cursor or None,
            "hasMore": bool(next_cursor),
            "userId": user_id,
        }

    def activity_inbox(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        payload = self._guarded(lambda: client.news_inbox_v1(mark_as_seen=False), "notifications")
        return normalize_activity(payload if isinstance(payload, dict) else {})

    def direct_threads(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        amount = min(max(_integer((params or {}).get("amount")) or 15, 1), 40)
        threads = self._guarded(
            lambda: client.direct_threads(amount=amount, thread_message_limit=12),
            "messages",
        )
        viewer = self._viewer_id()
        return {"items": [normalize_thread(thread, viewer) for thread in (threads or [])]}

    def direct_thread(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        thread_id = _string(params.get("threadId"))
        if not thread_id:
            raise ProtocolError("invalid_request", "A thread id is required.")
        amount = min(max(_integer(params.get("amount")) or 25, 1), 60)
        messages = self._guarded(lambda: client.direct_messages(thread_id, amount=amount), "this conversation")
        return {"items": [normalize_direct_message(message) for message in reversed(messages or [])]}

    def direct_send(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        thread_id = _string(params.get("threadId"))
        text = _string(params.get("text")).strip()
        if not thread_id or not text:
            raise ProtocolError("invalid_request", "A thread id and message text are required.")
        # Mobile direct_answer has no reply-id argument; replyToMessageId is web-only.
        message = self._guarded(lambda: client.direct_answer(thread_id, text), "this message")
        return {"message": normalize_direct_message(message)}

    def direct_mark_read(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        thread_id = _string(params.get("threadId"))
        message_id = _string(params.get("messageId"))
        if not thread_id or not message_id:
            raise ProtocolError("invalid_request", "A thread id and message id are required.")
        exact_seen = getattr(client, "direct_message_seen", None)
        if callable(exact_seen):
            self._guarded(lambda: exact_seen(thread_id, message_id), "read receipt")
            return {"ok": True}
        seen = getattr(client, "direct_send_seen", None)
        if not callable(seen):
            return {"ok": False}
        self._guarded(lambda: seen(thread_id), "read receipt")
        return {"ok": True}

    def direct_react(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        params = params or {}
        thread_id = _string(params.get("threadId"))
        message_id = _string(params.get("messageId"))
        emoji = _string(params.get("emoji"))
        if not thread_id or not message_id or not emoji:
            raise ProtocolError("invalid_request", "A thread id, message id, and emoji are required.")
        react = getattr(client, "direct_send_reaction", None)
        if not callable(react):
            raise ProtocolError("unsupported_action", "Message reactions are not available.")
        self._guarded(lambda: react(thread_id, message_id, emoji=emoji), "reaction")
        return {"ok": True, "emoji": emoji, "messageId": message_id}

    def direct_notes(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        notes = self._guarded(client.get_notes, "notes")
        return {"items": [normalize_note(note) for note in (notes or [])]}

    def direct_presence(self, _params: dict[str, Any] | None = None) -> dict[str, Any]:
        client = self._require_client()
        payload = self._guarded(client.direct_active_presence, "presence")
        presence = (payload or {}).get("user_presence", {}) if isinstance(payload, dict) else {}
        return {
            "users": {
                _string(user_id): {
                    "active": bool(entry.get("is_active")),
                    "lastActivityAt": _integer(entry.get("last_activity_at_ms")) // 1000,
                }
                for user_id, entry in presence.items()
                if isinstance(entry, dict)
            }
        }

    # --- Web (core) backend: the browser-minted session drives www.instagram.com
    # directly, reusing the same normalizers as the mobile path. ---

    def _web_cookies(self, params: dict[str, Any] | None) -> dict[str, Any]:
        cookies = (params or {}).get("cookies") or {}
        if not isinstance(cookies, dict) or not cookies.get("sessionid"):
            raise ProtocolError("not_authenticated", "No Instagram web session is available.")
        return cookies

    @staticmethod
    def _web_headers(cookies: dict[str, Any], referer: str | None = None) -> dict[str, str]:
        # Mirror a real Chromium web session as closely as possible — Instagram's
        # spam/automation checks weigh these heavily. Matches the header set
        # captured from instagram.com in a real browser.
        return {
            "User-Agent": _WEB_USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            # Accept-Encoding is intentionally omitted so requests/urllib3 advertise
            # exactly what this build can decode (gzip, deflate, + br/zstd when the
            # decoders are bundled) — matching Chrome without risking undecodable bodies.
            "X-IG-App-ID": _WEB_APP_ID,
            "X-CSRFToken": _string(cookies.get("csrftoken")),
            "X-ASBD-ID": _WEB_ASBD_ID,
            "X-IG-WWW-Claim": _string(cookies.get("x-ig-www-claim")) or "0",
            "X-Requested-With": "XMLHttpRequest",
            "X-IG-Max-Touch-Points": "0",
            "Referer": referer or f"{_WEB_BASE}/",
            "Origin": _WEB_BASE,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Ch-Ua": _WEB_SEC_CH_UA,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"macOS"',
            "Priority": "u=1, i",
        }

    def _web_send_raw(
        self,
        method: str,
        path: str,
        cookies: dict[str, Any],
        data: dict[str, Any] | None = None,
        referer: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> requests.Response:
        headers = self._web_headers(cookies, referer=referer)
        if extra_headers:
            headers.update(extra_headers)
        try:
            response = requests.request(
                method,
                f"{_WEB_BASE}{path}",
                headers=headers,
                cookies=cookies,
                data=data,
                timeout=15,
            )
        except requests.RequestException as exc:
            raise ProtocolError("network_error", "Instagram could not be reached.") from exc
        if response.status_code in (401, 403):
            raise ProtocolError(
                "session_expired",
                "The Instagram web session is no longer valid. Import fresh cookies.",
            )
        if response.status_code == 429:
            raise ProtocolError("rate_limited", "Instagram asked this device to slow down.")
        return response

    def _web_request(
        self,
        method: str,
        path: str,
        cookies: dict[str, Any],
        data: dict[str, Any] | None = None,
        referer: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        response = self._web_send_raw(method, path, cookies, data, referer, extra_headers)
        if response.status_code != 200:
            raise ProtocolError(
                "web_request_failed", f"Instagram returned status {response.status_code}."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProtocolError(
                "web_request_failed", "Instagram returned an unexpected response."
            ) from exc
        return payload if isinstance(payload, dict) else {}

    def _fetch_web_tokens(self, cookies: dict[str, Any]) -> dict[str, str]:
        """Scrape the fb_dtsg / lsd write tokens Instagram embeds in the page JS.
        These are required for GraphQL mutations (sending a DM)."""
        response = self._web_send_raw("GET", "/", cookies)
        html = response.text if response.status_code == 200 else ""

        def find(*patterns: str) -> str:
            for pattern in patterns:
                match = re.search(pattern, html)
                if match:
                    return match.group(1)
            return ""

        return {
            "fb_dtsg": find(
                r'\["DTSGInitialData",\[\],\{"token":"([^"]+)"',
                r'"dtsg":\s*\{\s*"token":\s*"([^"]+)"',
                r'name="fb_dtsg"\s+value="([^"]+)"',
            ),
            "lsd": find(
                r'\["LSD",\[\],\{"token":"([^"]+)"',
                r'"lsd":\s*\{\s*"token":\s*"([^"]+)"',
            ),
            "rev": find(r'"__spin_r":(\d+)', r'"client_revision":(\d+)', r'"rev":(\d+)'),
            "spin_t": find(r'"__spin_t":(\d+)'),
            "spin_b": find(r'"__spin_b":"([^"]+)"', r'"haste_session":"([^"]+)"'),
            "hs": find(r'"haste_session":"([^"]+)"'),
        }

    def _web_tokens(self, cookies: dict[str, Any]) -> dict[str, str]:
        """Cache page-scoped GraphQL tokens in memory for the active web account."""
        # A digest lets a freshly imported session for the same account invalidate
        # the cache without retaining another plaintext copy of its cookie values.
        session_fingerprint = "\x1f".join(
            _string(cookies.get(name)) for name in ("ds_user_id", "sessionid", "csrftoken")
        )
        owner = hashlib.sha256(session_fingerprint.encode("utf-8")).hexdigest()
        if self._web_token_cache is not None and self._web_token_owner == owner:
            return self._web_token_cache
        tokens = self._fetch_web_tokens(cookies)
        self._web_token_cache = tokens
        self._web_token_owner = owner
        return tokens

    def _web_actor_id(self, cookies: dict[str, Any]) -> str:
        """FBID used as actor_id / av for Polaris like/save mutations (not ds_user_id)."""
        if self._web_actor_id_cache:
            return self._web_actor_id_cache
        user_id = _string(cookies.get("ds_user_id"))
        if not user_id:
            raise ProtocolError("not_authenticated", "The web session has no user id.")
        payload = self._web_request("GET", f"/api/v1/users/{user_id}/info/", cookies)
        user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
        actor = _string(user.get("fbid_v2") or user.get("fbid") or user.get("pk") or user_id)
        self._web_actor_id_cache = actor
        return actor

    def _next_mutation_id(self) -> str:
        self._web_mutation_counter += 1
        return str(self._web_mutation_counter)

    def _web_graphql(
        self,
        cookies: dict[str, Any],
        *,
        friendly_name: str,
        doc_id: str,
        variables: dict[str, Any],
        referer: str | None = None,
        root_field: str | None = None,
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        """POST /api/graphql with the same form body shape as the real Polaris client."""
        tokens = self._web_tokens(cookies)
        fb_dtsg = tokens.get("fb_dtsg")
        if not fb_dtsg:
            raise ProtocolError(
                "web_request_failed",
                "Could not obtain an Instagram send token — try re-importing the session.",
            )
        lsd = tokens.get("lsd", "")
        jazoest = "2" + str(sum(bytearray(fb_dtsg, "utf-8")))
        av = actor_id or _string(cookies.get("ds_user_id"))
        data = {
            "av": av,
            "__a": "1",
            "__comet_req": "7",
            "fb_dtsg": fb_dtsg,
            "jazoest": jazoest,
            "lsd": lsd,
            "__spin_r": tokens.get("rev", ""),
            "__spin_b": tokens.get("spin_b", ""),
            "__spin_t": tokens.get("spin_t", ""),
            "__rev": tokens.get("rev", ""),
            "__hs": tokens.get("hs", ""),
            "fb_api_caller_class": "RelayModern",
            "fb_api_req_friendly_name": friendly_name,
            "server_timestamps": "true",
            "doc_id": doc_id,
            "variables": json.dumps(variables, separators=(",", ":")),
        }
        extra_headers = {
            "X-FB-Friendly-Name": friendly_name,
            "X-FB-LSD": lsd,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if root_field:
            extra_headers["X-Root-Field-Name"] = root_field
        response = self._web_send_raw(
            "POST",
            "/api/graphql",
            cookies,
            data=data,
            referer=referer or f"{_WEB_BASE}/",
            extra_headers=extra_headers,
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProtocolError("web_request_failed", "Instagram returned an unexpected response.") from exc
        if response.status_code != 200 or payload.get("errors"):
            raise ProtocolError("web_request_failed", "Instagram rejected the request.")
        return payload if isinstance(payload, dict) else {}

    def web_timeline(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        cursor = (params or {}).get("cursor")
        data = {
            "reason": "pagination" if cursor else "cold_start_fetch",
            "is_pull_to_refresh": "0",
        }
        if cursor:
            data["max_id"] = _string(cursor)
        return normalize_timeline(self._web_request("POST", "/api/v1/feed/timeline/", cookies, data))

    def web_stories(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        payload = self._web_request("GET", "/api/v1/feed/reels_tray/", cookies)
        return normalize_story_tray(payload, viewer_id=_string(cookies.get("ds_user_id")))

    def web_comments(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        payload = self._web_request(
            "GET",
            f"/api/v1/media/{media_id}/comments/?can_support_threading=true&permalink_enabled=false",
            cookies,
        )
        raw = payload.get("comments")
        comments = raw if isinstance(raw, list) else []
        return {
            "items": [_normalize_web_comment(c) for c in comments if isinstance(c, dict)],
            "nextCursor": _string(payload.get("next_min_id")) or None,
        }

    def web_threads(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        variables = {
            "device_id_for_iris_subscription": self._web_device_id,
            "__relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider": False,
            "__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider": True,
            "__relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider": 5,
            "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": False,
            "__relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider": True,
        }
        payload = self._web_graphql(
            cookies,
            friendly_name="PolarisDirectInboxQuery",
            doc_id="27262915580045003",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/inbox/",
        )
        mailbox = (payload.get("data") or {}).get("get_slide_mailbox_for_iris_subscription") or {}
        edges = ((mailbox.get("threads_by_folder") or {}).get("edges") or [])
        raw_threads = [
            (edge.get("node") or {}).get("as_ig_direct_thread")
            for edge in edges
            if isinstance(edge, dict)
        ]
        threads = [thread for thread in raw_threads if isinstance(thread, dict)]
        self._web_thread_keys = {
            _string(thread.get("thread_id") or thread.get("id")): _string(
                thread.get("thread_key") or thread.get("thread_fbid")
            )
            for thread in threads
        }
        return {"items": [_normalize_slide_thread(thread) for thread in threads]}

    def web_thread(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        thread_id = _string((params or {}).get("threadId"))
        if not thread_id:
            raise ProtocolError("invalid_request", "A thread id is required.")
        thread_key = self._web_thread_keys.get(thread_id, thread_id)
        variables = {
            "min_uq_seq_id": None,
            "thread_fbid": thread_key,
            "__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider": False,
            "__relay_internal__pv__IGDInitialMessagePageCountrelayprovider": 20,
            "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": False,
        }
        payload = self._web_graphql(
            cookies,
            friendly_name="IGDThreadDetailQuery",
            doc_id="28395443243391552",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/t/{thread_id}/",
        )
        container = (payload.get("data") or {}).get("get_slide_thread_nullable") or {}
        thread = container.get("as_ig_direct_thread")
        if not isinstance(thread, dict):
            raise ProtocolError("web_request_failed", "Instagram did not return this conversation.")
        return {"items": _normalize_slide_thread(thread)["messages"]}

    def web_send(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        viewer = _string(cookies.get("ds_user_id"))
        thread_id = _string((params or {}).get("threadId"))
        text = _string((params or {}).get("text")).strip()
        if not thread_id or not text:
            raise ProtocolError("invalid_request", "A thread id and message text are required.")
        offline_threading_id = str(secrets.randbits(63))
        reply_to = _string((params or {}).get("replyToMessageId")) or None
        is_mid = bool(reply_to and reply_to.startswith("mid."))
        variables = {
            "ig_thread_igid": thread_id,
            "offline_threading_id": offline_threading_id,
            "recipient_igids": None,
            "replied_to_client_context": None,
            "replied_to_item_id": None if is_mid else reply_to,
            "reply_to_message_id": reply_to if is_mid else None,
            "sampled": None,
            "text": {"sensitive_string_value": text},
            "mentions": None,
            "mentioned_user_ids": None,
            "commands": None,
            "forwarded_from_thread_id": None,
            "is_forwarded_from_own_message": None,
            "send_attribution": "igd_web_chat_tab:in_thread",
        }
        self._web_graphql(
            cookies,
            friendly_name="IGDirectTextSendMutation",
            doc_id="26911679871773184",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/t/{thread_id}/",
            root_field="xdt_send_message",
        )
        return {
            "message": {
                "id": offline_threading_id,
                "messageId": f"mid.${offline_threading_id}",
                "clientContext": offline_threading_id,
                "userId": viewer,
                "mine": True,
                "kind": "text",
                "text": text,
                "timestamp": 0,
                "share": None,
                "reply": None,
                "reactions": [],
            }
        }

    def web_like(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        actor_id = self._web_actor_id(cookies)
        tracking = _string((params or {}).get("trackingToken")) or None
        variables = {
            "input": {
                "actor_id": actor_id,
                "client_mutation_id": self._next_mutation_id(),
                "container_module": "feed_timeline",
                "media_id": media_id,
                "tracking_token": tracking,
            }
        }
        self._web_graphql(
            cookies,
            friendly_name="usePolarisLikeMediaXIGLikeMutation",
            doc_id="27182485238052618",
            variables=variables,
            actor_id=actor_id,
        )
        return {"liked": True, "mediaId": media_id}

    def web_unlike(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        actor_id = self._web_actor_id(cookies)
        tracking = _string((params or {}).get("trackingToken")) or None
        variables = {
            "input": {
                "actor_id": actor_id,
                "client_mutation_id": self._next_mutation_id(),
                "media_id": media_id,
                "tracking_token": tracking,
            }
        }
        self._web_graphql(
            cookies,
            friendly_name="usePolarisLikeMediaXIGUnlikeMutation",
            doc_id="27345296031770102",
            variables=variables,
            actor_id=actor_id,
        )
        return {"liked": False, "mediaId": media_id}

    def web_save(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        actor_id = self._web_actor_id(cookies)
        logging_token = _string((params or {}).get("loggingInfoToken")) or None
        variables = {
            "input": {
                "actor_id": actor_id,
                "client_mutation_id": self._next_mutation_id(),
                "container_module": "feed_timeline",
                "inventory_source": "media_or_ad",
                "logging_info_token": logging_token,
                "media_id": media_id,
                "nav_chain": "PolarisFeedRoot:feedPage:1:via_cold_start",
            }
        }
        self._web_graphql(
            cookies,
            friendly_name="usePolarisSaveMediaSaveMutation",
            doc_id="27365486596441074",
            variables=variables,
            actor_id=actor_id,
        )
        return {"saved": True, "mediaId": media_id}

    def web_unsave(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        if not media_id:
            raise ProtocolError("invalid_request", "A media id is required.")
        actor_id = self._web_actor_id(cookies)
        variables = {
            "input": {
                "actor_id": actor_id,
                "client_mutation_id": self._next_mutation_id(),
                "media_id": media_id,
            }
        }
        self._web_graphql(
            cookies,
            friendly_name="usePolarisSaveMediaUnsaveMutation",
            doc_id="27371251859134880",
            variables=variables,
            actor_id=actor_id,
        )
        return {"saved": False, "mediaId": media_id}

    def web_mark_read(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        thread_id = _string((params or {}).get("threadId"))
        message_id = _string((params or {}).get("messageId"))
        if not thread_id or not message_id:
            raise ProtocolError("invalid_request", "A thread id and message id are required.")
        variables = {
            "metadata": {"ig_thread_igid": thread_id},
            "data": {"item_id": "", "message_id": message_id},
        }
        self._web_graphql(
            cookies,
            friendly_name="useIGDMarkThreadAsReadMutation",
            doc_id="27356881703909995",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/t/{thread_id}/",
        )
        return {"ok": True}

    def web_react(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        thread_id = _string((params or {}).get("threadId"))
        message_id = _string((params or {}).get("messageId"))
        emoji = _string((params or {}).get("emoji"))
        if not thread_id or not message_id or not emoji:
            raise ProtocolError("invalid_request", "A thread id, message id, and emoji are required.")
        variables = {
            "input": {
                "emoji": emoji,
                "item_id": "",
                "message_id": message_id,
                "reaction_status": "created",
                "thread_id": thread_id,
            }
        }
        self._web_graphql(
            cookies,
            friendly_name="IGDirectReactionSendMutation",
            doc_id="24374451552236906",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/t/{thread_id}/",
        )
        return {"ok": True, "emoji": emoji, "messageId": message_id}

    def web_share_media(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        media_id = _media_pk(_string((params or {}).get("mediaId")))
        user_id = _string((params or {}).get("userId"))
        if not media_id or not user_id:
            raise ProtocolError("invalid_request", "A media id and recipient user id are required.")
        offline_threading_id = str(secrets.randbits(63))
        variables = {
            "send_data": {
                "forwarded_from_thread_id": None,
                "is_forwarded_from_own_message": None,
                "offline_threading_id": offline_threading_id,
                "recipient_users": json.dumps([user_id]),
                "thread_id": None,
            },
            "data": {"media_id": media_id},
        }
        self._web_graphql(
            cookies,
            friendly_name="IGDirectMediaShareMutation",
            doc_id="27442850591982122",
            variables=variables,
        )
        return {"ok": True, "messageId": offline_threading_id}

    def web_forward(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        viewer = _string(cookies.get("ds_user_id"))
        to_thread = _string((params or {}).get("toThreadId"))
        from_thread = _string((params or {}).get("fromThreadId"))
        text = _string((params or {}).get("text")).strip()
        if not to_thread or not from_thread or not text:
            raise ProtocolError(
                "invalid_request",
                "A destination thread, source thread, and message text are required.",
            )
        offline_threading_id = str(secrets.randbits(63))
        variables = {
            "ig_thread_igid": to_thread,
            "offline_threading_id": offline_threading_id,
            "recipient_igids": None,
            "replied_to_client_context": None,
            "replied_to_item_id": None,
            "reply_to_message_id": None,
            "sampled": None,
            "text": {"sensitive_string_value": text},
            "mentions": None,
            "mentioned_user_ids": None,
            "commands": None,
            "forwarded_from_thread_id": from_thread,
            "is_forwarded_from_own_message": False,
            "send_attribution": None,
        }
        self._web_graphql(
            cookies,
            friendly_name="IGDirectTextSendMutation",
            doc_id="26911679871773184",
            variables=variables,
            referer=f"{_WEB_BASE}/direct/t/{to_thread}/",
            root_field="xdt_send_message",
        )
        return {
            "message": {
                "id": offline_threading_id,
                "messageId": f"mid.${offline_threading_id}",
                "userId": viewer,
                "mine": True,
                "kind": "text",
                "text": text,
                "timestamp": 0,
                "share": None,
                "reply": None,
                "reactions": [],
            }
        }

    def web_translate(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        message_id = _string((params or {}).get("messageId"))
        content = _string((params or {}).get("text"))
        if not message_id or not content:
            raise ProtocolError("invalid_request", "A message id and text are required.")
        dialect = _string((params or {}).get("dialect")) or "en_US"
        variables = {
            "message_id": message_id,
            "content": content,
            "target_dialect_code": dialect,
        }
        payload = self._web_graphql(
            cookies,
            friendly_name="IGDMessageTranslationStoreQuery",
            doc_id="27167970989506587",
            variables=variables,
        )
        rows = (payload.get("data") or {}).get("igd_detect_and_translate_text_content_query")
        if not isinstance(rows, list) or not rows:
            raise ProtocolError("translate_unavailable", "Translation is not available for this message.")
        row = rows[0] if isinstance(rows[0], dict) else {}
        translated = _string(row.get("translated_text")) or None
        if not translated or row.get("error_code"):
            raise ProtocolError("translate_unavailable", "Translation is not available for this message.")
        return {"translatedText": translated, "messageId": message_id}

    def web_share_targets(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        variables = {
            "input": {
                "count_per_page": 20,
                "is_private_share": False,
                "views": ["RESHARE_SHARE_SHEET"],
            }
        }
        payload = self._web_graphql(
            cookies,
            friendly_name="PolarisShareSheetV3NullStateQuery",
            doc_id="36651079954537487",
            variables=variables,
        )
        ranked = ((payload.get("data") or {}).get("get_paginated_share_sheet_ranked_items") or {}).get(
            "ranked_items"
        )
        items: list[dict[str, Any]] = []
        if isinstance(ranked, list):
            for entry in ranked:
                if not isinstance(entry, dict):
                    continue
                thread_id = _string(entry.get("thread_id") or entry.get("share_sheet_item_id"))
                title = _string(entry.get("thread_title"))
                users_raw = entry.get("users") if isinstance(entry.get("users"), list) else []
                users = [_user_short(u) for u in users_raw if isinstance(u, dict)]
                if not title and users:
                    title = ", ".join(u["username"] for u in users)
                if thread_id:
                    items.append({"threadId": thread_id, "title": title, "users": users})
        return {"items": items}

    def _web_profile_info(self, cookies: dict[str, Any], username: str) -> dict[str, Any]:
        if not username:
            raise ProtocolError("invalid_request", "A username is required.")
        payload = self._web_request(
            "GET",
            f"/api/v1/users/web_profile_info/?username={username}",
            cookies,
            referer=f"{_WEB_BASE}/{username}/",
        )
        user = (payload.get("data") or {}).get("user")
        if not isinstance(user, dict):
            raise ProtocolError("web_request_failed", "Instagram returned no profile.")
        return user

    def web_profile(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        username = _string((params or {}).get("username"))
        user = self._web_profile_info(cookies, username)
        return {"user": _normalize_web_profile_user(user)}

    def web_medias(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        username = _string((params or {}).get("username"))
        user = self._web_profile_info(cookies, username)
        media = user.get("edge_owner_to_timeline_media") or {}
        edges = media.get("edges") if isinstance(media.get("edges"), list) else []
        items = [
            _normalize_web_grid_media(edge.get("node") or {})
            for edge in edges
            if isinstance(edge, dict) and isinstance(edge.get("node"), dict)
        ]
        return {"items": items, "nextCursor": None, "hasMore": False, "userId": _string(user.get("id"))}

    def web_account(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        cookies = self._web_cookies(params)
        user_id = _string(cookies.get("ds_user_id"))
        if not user_id:
            raise ProtocolError("not_authenticated", "The web session has no user id.")
        payload = self._web_request("GET", f"/api/v1/users/{user_id}/info/", cookies)
        user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
        actor = _string(user.get("fbid_v2") or user.get("fbid"))
        if actor:
            self._web_actor_id_cache = actor
        return {
            "id": _string(user.get("pk") or user_id),
            "username": _string(user.get("username")),
            "fullName": _string(user.get("full_name")),
            "profilePictureUrl": user.get("profile_pic_url"),
        }

    def dispatch(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        handlers = {
            "health": self.health,
            "web.timeline": self.web_timeline,
            "web.stories": self.web_stories,
            "web.account": self.web_account,
            "web.profile": self.web_profile,
            "web.medias": self.web_medias,
            "web.comments": self.web_comments,
            "web.threads": self.web_threads,
            "web.thread": self.web_thread,
            "web.send": self.web_send,
            "web.like": self.web_like,
            "web.unlike": self.web_unlike,
            "web.save": self.web_save,
            "web.unsave": self.web_unsave,
            "web.mark_read": self.web_mark_read,
            "web.react": self.web_react,
            "web.share_media": self.web_share_media,
            "web.forward": self.web_forward,
            "web.translate": self.web_translate,
            "web.share_targets": self.web_share_targets,
            "auth.state": self.auth_state,
            "auth.login": self.auth_login,
            "auth.restore": self.auth_restore,
            "auth.submit_code": self.auth_submit_code,
            "auth.continue_manual": self.auth_continue_manual,
            "auth.cancel": self.auth_cancel,
            "auth.logout": self.auth_logout,
            "auth.export_session": self.auth_export_session,
            "auth.export_device": self.auth_export_device,
            "feed.timeline": self.feed_timeline,
            "feed.stories": self.feed_stories,
            "feed.reels": self.feed_reels,
            "feed.explore": self.feed_explore,
            "media.comments": self.media_comments,
            "media.like": self.media_like,
            "media.unlike": self.media_unlike,
            "media.save": self.media_save,
            "media.unsave": self.media_unsave,
            "user.profile": self.user_profile,
            "user.medias": self.user_medias,
            "activity.inbox": self.activity_inbox,
            "direct.threads": self.direct_threads,
            "direct.thread": self.direct_thread,
            "direct.send": self.direct_send,
            "direct.mark_read": self.direct_mark_read,
            "direct.react": self.direct_react,
            "direct.notes": self.direct_notes,
            "direct.presence": self.direct_presence,
        }
        handler = handlers.get(method)
        if handler is None:
            raise ProtocolError("unsupported_method", f"Unsupported protocol method: {method}")
        return handler(params)
