"""Stateful, allowlisted boundary around instagrapi.

Only normalized data leaves this process. Raw responses and credentials stay on the
private stdin/stdout pipe owned by the Tauri host.
"""

from __future__ import annotations

import hashlib
from importlib.metadata import version
import secrets
from typing import Any, Callable

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
        "commentCount": _integer(media.get("comment_count")),
        "liked": bool(media.get("has_liked", False)),
        "saved": bool(media.get("has_viewer_saved", False)),
        "imageUrl": _best_image(media),
        "videoUrl": _best_video(media),
        "children": children,
    }


def _url(value: Any) -> str | None:
    return str(value) if value else None


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


def normalize_thread(thread: Any, viewer_id: str) -> dict[str, Any]:
    users = [_user_short(user) for user in (getattr(thread, "users", None) or [])]
    title = _string(getattr(thread, "thread_title", None)) or ", ".join(user["username"] for user in users)
    messages = [normalize_direct_message(message) for message in (getattr(thread, "messages", None) or [])]
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
        "muted": bool(getattr(thread, "muted", False)),
        "pending": bool(getattr(thread, "pending", False)),
        "lastActivityAt": _timestamp(getattr(thread, "last_activity_at", None)),
        "unread": not seen,
        "messages": list(reversed(messages)),
    }


def normalize_direct_message(message: Any) -> dict[str, Any]:
    item_type = _string(getattr(message, "item_type", None), "text")
    shared = getattr(message, "media_share", None) or getattr(message, "clip", None)
    return {
        "id": _string(getattr(message, "id", None)),
        "userId": _string(getattr(message, "user_id", None)),
        "mine": bool(getattr(message, "is_sent_by_viewer", False)),
        "kind": item_type,
        "text": _string(getattr(message, "text", None)),
        "timestamp": _timestamp(getattr(message, "timestamp", None)),
        "share": normalize_media_model(shared) if shared is not None else None,
        "reply": _string(getattr(getattr(message, "reply", None), "text", None)) or None,
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
        message = self._guarded(lambda: client.direct_answer(thread_id, text), "this message")
        return {"message": normalize_direct_message(message)}

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

    def dispatch(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        handlers = {
            "health": self.health,
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
            "user.profile": self.user_profile,
            "user.medias": self.user_medias,
            "activity.inbox": self.activity_inbox,
            "direct.threads": self.direct_threads,
            "direct.thread": self.direct_thread,
            "direct.send": self.direct_send,
            "direct.notes": self.direct_notes,
            "direct.presence": self.direct_presence,
        }
        handler = handlers.get(method)
        if handler is None:
            raise ProtocolError("unsupported_method", f"Unsupported protocol method: {method}")
        return handler(params)
