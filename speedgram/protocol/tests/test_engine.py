from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from instagrapi.exceptions import ChallengeRequired, ClientError, PleaseWaitFewMinutes, TwoFactorRequired
from speedgram_protocol import ProtocolEngine, ProtocolError, normalize_timeline
from speedgram_protocol.engine import (
    _DEVICE_POOL,
    _normalize_slide_message,
    _normalize_slide_thread,
    normalize_direct_message,
)


class FakeClient:
    def __init__(self, settings: dict[str, Any] | None = None) -> None:
        self.settings = settings or {
            "device_settings": {"manufacturer": "Google/google", "model": "Pixel 8 Pro"}
        }
        self.device_settings = self.settings.get("device_settings", {"model": "Pixel 8 Pro"})
        self.username = None
        self.challenge_code_handler = None
        self.last_json: dict[str, Any] = {}
        self.login_mode = "success"
        self.feed: dict[str, Any] = {"feed_items": [], "more_available": False}
        self.approved = False

    def login(self, username: str, _password: str, verification_code: str = "") -> bool:
        self.username = username
        if self.login_mode == "2fa" and verification_code != "123456":
            self.last_json = {"two_factor_info": {"totp_two_factor_on": True}}
            raise TwoFactorRequired("verification required")
        if self.login_mode == "invalid_code" and verification_code:
            self.last_json = {"two_factor_info": {"sms_two_factor_on": True}}
            raise ClientError("invalid verification code")
        if self.login_mode == "invalid_code":
            self.last_json = {"two_factor_info": {"sms_two_factor_on": True}}
            raise TwoFactorRequired("verification required")
        if self.login_mode == "push" and not self.approved:
            self.last_json = {"two_factor_info": {"sms_two_factor_on": True}}
            raise TwoFactorRequired("verification required")
        if self.login_mode == "challenge":
            code = self.challenge_code_handler(username, "EMAIL")
            if code != "654321":
                raise ChallengeRequired("challenge required")
        if self.login_mode == "manual":
            self.last_json = {"bloks_action": "redirect", "challenge_context": "context"}
            raise ChallengeRequired("manual approval required")
        return True

    def challenge_bloks_redirect_dismiss(self) -> bool:
        self.login_mode = "success"
        return True

    def get_settings(self) -> dict[str, Any]:
        return self.settings

    def get_timeline_feed(self, **_kwargs: Any) -> dict[str, Any]:
        if self.login_mode == "rate_limit":
            raise PleaseWaitFewMinutes("slow down")
        return self.feed

    def logout(self) -> bool:
        return True


class ClientFactory:
    def __init__(self) -> None:
        self.next_mode = "success"
        self.instances: list[FakeClient] = []

    def __call__(self, settings: dict[str, Any] | None = None) -> FakeClient:
        client = FakeClient(settings)
        client.login_mode = self.next_mode
        self.instances.append(client)
        return client


def test_health_reports_pinned_engine() -> None:
    status = ProtocolEngine(client_factory=ClientFactory()).dispatch("health")
    assert status["engine"] == "instagrapi"
    assert status["engineVersion"] == "2.18.8"
    assert status["network"] == "idle"


def test_engine_rejects_arbitrary_methods() -> None:
    with pytest.raises(ProtocolError, match="Unsupported protocol method") as error:
        ProtocolEngine(client_factory=ClientFactory()).dispatch("request", {"url": "https://example.com"})
    assert error.value.code == "unsupported_method"


def test_password_login_and_export_never_put_secrets_in_auth_state() -> None:
    engine = ProtocolEngine(client_factory=ClientFactory())
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    assert state == {"status": "authenticated", "user": {"username": "secondary"}}
    assert "secret" not in str(state)
    exported = engine.dispatch("auth.export_session")
    assert exported["bundle"]["password"] == "secret"
    assert exported["bundle"]["settings"]["device_settings"]["manufacturer"] == "Google/google"


def test_two_factor_can_continue_on_the_same_client() -> None:
    factory = ClientFactory()
    factory.next_mode = "2fa"
    engine = ProtocolEngine(client_factory=factory)
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    assert state["status"] == "verification_required"
    assert state["verificationKind"] == "two_factor"
    assert state["verificationMethods"] == [
        "push_approval",
        "authenticator_code",
        "backup_code",
    ]
    completed = engine.dispatch(
        "auth.submit_code", {"operationId": state["operationId"], "code": "123 456"}
    )
    assert completed["status"] == "authenticated"
    assert len(factory.instances) == 1


def test_email_challenge_uses_code_handler_without_replacing_client() -> None:
    factory = ClientFactory()
    factory.next_mode = "challenge"
    engine = ProtocolEngine(client_factory=factory)
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    assert state["verificationKind"] == "email"
    completed = engine.dispatch(
        "auth.submit_code", {"operationId": state["operationId"], "code": "654321"}
    )
    assert completed["status"] == "authenticated"
    assert len(factory.instances) == 1


def test_manual_approval_retries_with_preserved_client() -> None:
    factory = ClientFactory()
    factory.next_mode = "manual"
    engine = ProtocolEngine(client_factory=factory)
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    assert state["status"] == "manual_approval_required"
    completed = engine.dispatch("auth.continue_manual", {"operationId": state["operationId"]})
    assert completed["status"] == "authenticated"
    assert len(factory.instances) == 1


def test_push_approval_retries_without_requiring_a_fake_code() -> None:
    factory = ClientFactory()
    factory.next_mode = "push"
    engine = ProtocolEngine(client_factory=factory)
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    assert state["verificationMethods"] == ["push_approval", "sms_code"]
    assert state["deviceName"] == "Pixel 8 Pro"
    factory.instances[0].approved = True
    completed = engine.dispatch("auth.continue_manual", {"operationId": state["operationId"]})
    assert completed["status"] == "authenticated"
    assert len(factory.instances) == 1


def test_invalid_code_is_recoverable_and_keeps_verification_state() -> None:
    factory = ClientFactory()
    factory.next_mode = "invalid_code"
    engine = ProtocolEngine(client_factory=factory)
    state = engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    retried = engine.dispatch(
        "auth.submit_code", {"operationId": state["operationId"], "code": "000000"}
    )
    assert retried["status"] == "verification_required"
    assert retried["errorCode"] == "invalid_verification_code"
    assert "000000" not in str(retried)


def test_same_account_retry_reuses_device_profile() -> None:
    factory = ClientFactory()
    factory.next_mode = "2fa"
    engine = ProtocolEngine(client_factory=factory)
    engine.dispatch("auth.login", {"username": "secondary", "password": "first"})
    engine.dispatch("auth.login", {"username": "secondary", "password": "corrected"})
    assert len(factory.instances) == 1


def test_restore_and_logout() -> None:
    engine = ProtocolEngine(client_factory=ClientFactory())
    state = engine.dispatch(
        "auth.restore",
        {"bundle": {"username": "secondary", "password": "secret", "settings": {"cookies": {}}}},
    )
    assert state["status"] == "authenticated"
    assert engine.dispatch("auth.logout") == {"status": "signed_out"}


def test_timeline_is_normalized_and_paginated() -> None:
    factory = ClientFactory()
    engine = ProtocolEngine(client_factory=factory)
    engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    factory.instances[0].feed = {
        "feed_items": [
            {
                "media_or_ad": {
                    "id": "42_7",
                    "media_type": 1,
                    "user": {"username": "maya", "full_name": "Maya", "is_verified": True},
                    "caption": {"text": "hello"},
                    "taken_at": 1_700_000_000,
                    "like_count": 12,
                    "top_likers": ["mutual_friend"],
                    "facepile_top_likers": [{"id": "8", "profile_pic_url": "https://cdn.example/mutual.jpg"}],
                    "comment_count": 3,
                    "image_versions2": {"candidates": [{"url": "https://cdn.example/image.jpg"}]},
                }
            },
            {"suggested_users": {"users": []}},
        ],
        "next_max_id": "next-page",
        "more_available": True,
    }
    page = engine.dispatch("feed.timeline")
    assert page["nextCursor"] == "next-page"
    assert page["hasMore"] is True
    assert page["items"] == [
        {
            "id": "42_7",
            "kind": "image",
            "user": {
                "username": "maya",
                "fullName": "Maya",
                "profilePictureUrl": None,
                "verified": True,
            },
            "caption": "hello",
            "takenAt": 1_700_000_000,
            "location": "",
            "likeCount": 12,
            "likedBy": [{
                "id": "8",
                "username": "mutual_friend",
                "profilePictureUrl": "https://cdn.example/mutual.jpg",
            }],
            "commentCount": 3,
            "liked": False,
            "saved": False,
            "trackingToken": None,
            "loggingInfoToken": None,
            "imageUrl": "https://cdn.example/image.jpg",
            "videoUrl": None,
            "children": [],
        }
    ]


def test_gif_messages_normalize_from_web_and_mobile_shapes() -> None:
    web = _normalize_slide_message(
        {
            "id": "gif-web",
            "message_id": "mid.$gif-web",
            "sender_fbid": "5",
            "content_type": "INSTAGRAM_MESSAGING_ANIMATED_IMAGE",
            "content": {
                "animated_media": {
                    "alt_text": "celebration",
                    "preview_cdn_url": "https://cdn.example/gif.webp",
                    "attachment_mp4_url": "https://cdn.example/gif.mp4",
                }
            },
        },
        "42",
    )
    assert web["share"]["shareType"] == "gif"
    assert web["share"]["videoUrl"] == "https://cdn.example/gif.mp4"

    mobile = normalize_direct_message(
        SimpleNamespace(
            id="gif-mobile",
            item_type="animated_media",
            user_id="5",
            is_sent_by_viewer=False,
            text=None,
            timestamp=0,
            animated_media={
                "images": {"fixed_height": {"url": "https://cdn.example/gif.gif"}}
            },
            reply=None,
            reactions=None,
        )
    )
    assert mobile["share"]["shareType"] == "gif"
    assert mobile["share"]["imageUrl"] == "https://cdn.example/gif.gif"


def test_slide_reply_preserves_rich_media_context_and_client_context() -> None:
    item = _normalize_slide_message(
        {
            "id": "reply-1",
            "message_id": "mid.$reply-1",
            "offline_threading_id": "offline-1",
            "sender_fbid": "42",
            "content_type": "TEXT",
            "content": {"text_body": "perfect"},
            "replied_to_message": {
                "id": "reel-1",
                "message_id": "mid.$reel-1",
                "content_type": "IG_REEL_SHARE_XMA",
                "content": {
                    "xma": {
                        "target_id": "media-1",
                        "target_url": "https://www.instagram.com/reel/code/",
                        "header_title_text": "creator",
                    }
                },
            },
        },
        "42",
    )

    assert item["clientContext"] == "offline-1"
    assert item["reply"] == "Reel from @creator"


def test_slide_thread_exposes_group_image_and_reaction_activity_preview() -> None:
    thread = _normalize_slide_thread(
        {
            "thread_id": "group-1",
            "thread_title": "Design crew",
            "thread_image_url": "https://cdn.example/group.jpg",
            "viewer_id": "viewer",
            "is_group": True,
            "marked_as_unread": True,
            "last_activity_timestamp_ms": "1700000001000",
            "users": [{"id": "member", "username": "member"}],
            "slide_messages": {
                "edges": [
                    {
                        "node": {
                            "id": "reaction-1",
                            "message_id": "mid.$reaction-1",
                            "sender_fbid": "member",
                            "content_type": "REACTION_LOG_XMAT",
                            "content": {"is_reaction_action_log": True},
                            "timestamp_ms": "1700000001000",
                        }
                    },
                    {
                        "node": {
                            "id": "message-1",
                            "message_id": "mid.$message-1",
                            "sender_fbid": "viewer",
                            "content_type": "TEXT",
                            "content": {"text_body": "hello"},
                            "timestamp_ms": "1700000000000",
                        }
                    },
                ]
            },
        }
    )

    assert thread["threadImageUrl"] == "https://cdn.example/group.jpg"
    assert thread["lastPreview"] == "Liked a message"
    assert thread["lastReadMessageId"] == "mid.$reaction-1"
    assert [item["text"] for item in thread["messages"]] == ["hello"]


def test_rate_limit_is_a_safe_protocol_error() -> None:
    factory = ClientFactory()
    engine = ProtocolEngine(client_factory=factory)
    engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    factory.instances[0].login_mode = "rate_limit"
    with pytest.raises(ProtocolError) as error:
        engine.dispatch("feed.timeline")
    assert error.value.code == "rate_limited"


class DeviceAwareClient(FakeClient):
    def set_device(self, device: dict[str, Any], reset: bool = False, hydrate_app_profile: bool = False) -> bool:
        self.device_settings = dict(device)
        self.settings["device_settings"] = self.device_settings
        return True


class DeviceAwareFactory(ClientFactory):
    def __call__(self, settings: dict[str, Any] | None = None) -> DeviceAwareClient:
        client = DeviceAwareClient(settings)
        client.login_mode = self.next_mode
        self.instances.append(client)
        return client


def _login_device(username: str) -> dict[str, Any]:
    factory = DeviceAwareFactory()
    engine = ProtocolEngine(client_factory=factory)
    engine.dispatch("auth.login", {"username": username, "password": "secret"})
    return factory.instances[0].device_settings


def test_fresh_login_seeds_a_pool_device_deterministically() -> None:
    first = _login_device("maya.creates")
    assert first in _DEVICE_POOL
    # Same account always lands on the same hardware profile across sessions.
    assert _login_device("maya.creates") == first


def test_restored_session_keeps_its_saved_device() -> None:
    factory = DeviceAwareFactory()
    engine = ProtocolEngine(client_factory=factory)
    saved = {"cookies": {}, "device_settings": {"model": "Pixel 6a", "manufacturer": "Google/google"}}
    engine.dispatch(
        "auth.restore",
        {"bundle": {"username": "secondary", "password": "secret", "settings": saved}},
    )
    # Restore must not overwrite the persisted device with a pool profile.
    assert factory.instances[0].device_settings == saved["device_settings"]


class FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Any:
        return self._payload


class FakeRequests:
    RequestException = Exception

    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        return self.response


def test_web_timeline_uses_the_session_and_normalizes(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "feed_items": [
            {
                "media_or_ad": {
                    "id": "9_1",
                    "media_type": 1,
                    "user": {"username": "maya"},
                    "image_versions2": {"candidates": [{"url": "https://cdn/x.jpg"}]},
                }
            }
        ],
        "next_max_id": "page2",
        "more_available": True,
    }
    fake = FakeRequests(FakeResponse(200, payload))
    monkeypatch.setattr(engine_module, "requests", fake)

    engine = ProtocolEngine(client_factory=ClientFactory())
    page = engine.dispatch("web.timeline", {"cookies": {"sessionid": "s", "csrftoken": "t"}})

    assert page["items"][0]["id"] == "9_1"
    assert page["nextCursor"] == "page2"
    assert fake.calls[0]["url"].endswith("/api/v1/feed/timeline/")
    assert fake.calls[0]["headers"]["X-IG-App-ID"] == "936619743392459"


def test_web_comments_normalizes(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "comments": [
            {
                "pk": "17900",
                "user": {"pk": "5", "username": "aeri", "profile_pic_url": "https://cdn/a.jpg"},
                "text": "love this",
                "created_at_utc": 1_700_000_000,
                "comment_like_count": 12,
                "has_liked_comment": True,
            }
        ],
        "next_min_id": "min123",
    }
    fake = FakeRequests(FakeResponse(200, payload))
    monkeypatch.setattr(engine_module, "requests", fake)

    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch(
        "web.comments", {"cookies": {"sessionid": "s"}, "mediaId": "42"}
    )
    assert result["items"][0]["id"] == "17900"
    assert result["items"][0]["user"]["username"] == "aeri"
    assert result["items"][0]["text"] == "love this"
    assert result["items"][0]["liked"] is True
    assert result["nextCursor"] == "min123"
    assert "/api/v1/media/42/comments/" in fake.calls[0]["url"]


def test_web_comments_nests_preview_replies_and_quick_emojis(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "comments": [
            {
                "pk": "18109412317804113",
                "user": {"pk": "5", "username": "aeri"},
                "text": "parent",
                "created_at_utc": 1_700_000_000,
                "child_comment_count": 8,
                "preview_child_comments": [
                    {
                        "pk": "18109169189076965",
                        "user": {"pk": "6", "username": "bo"},
                        "text": "reply",
                        "created_at_utc": 1_700_000_100,
                    }
                ],
            }
        ],
        "quick_response_emojis": [{"unicode": "❤️"}, {"unicode": "😭"}],
    }
    fake = FakeRequests(FakeResponse(200, payload))
    monkeypatch.setattr(engine_module, "requests", fake)

    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch("web.comments", {"cookies": {"sessionid": "s"}, "mediaId": "42"})

    parent, reply = result["items"]
    assert parent["replyCount"] == 8
    assert parent["replyTo"] is None
    # Previewed replies are flattened but carry their parent so the sheet can nest them.
    assert reply["replyTo"] == "18109412317804113"
    assert result["quickEmojis"] == ["❤️", "😭"]


def test_web_comment_replies_pages_with_min_id(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "child_comment_count": 8,
        "child_comments": [
            {
                "pk": "18109169189076965",
                "user": {"pk": "6", "username": "bo"},
                "text": "absolutely right",
                "created_at_utc": 1_700_000_100,
                "comment_like_count": 6,
                "parent_comment_id": "18109412317804113",
                "replied_to_comment_id": "18109412317804113",
            }
        ],
        "has_more_head_child_comments": False,
        "has_more_tail_child_comments": True,
    }
    fake = FakeRequests(FakeResponse(200, payload))
    monkeypatch.setattr(engine_module, "requests", fake)

    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch(
        "web.comment_replies",
        {"cookies": {"sessionid": "s"}, "mediaId": "42", "commentId": "18109412317804113"},
    )

    assert result["items"][0]["id"] == "18109169189076965"
    assert result["items"][0]["replyTo"] == "18109412317804113"
    assert result["items"][0]["likeCount"] == 6
    assert result["replyCount"] == 8
    # Instagram exposes no reply cursor: the last id we hold is the next min_id.
    assert result["nextCursor"] == "18109169189076965"
    url = fake.calls[0]["url"]
    assert "/api/v1/media/42/comments/18109412317804113/child_comments/" in url
    assert "is_chronological=true" in url and "paging_direction=view_more" in url


def test_web_comment_replies_requires_ids() -> None:
    engine = ProtocolEngine(client_factory=ClientFactory())
    with pytest.raises(ProtocolError) as excinfo:
        engine.dispatch("web.comment_replies", {"cookies": {"sessionid": "s"}, "mediaId": "42"})
    assert excinfo.value.code == "invalid_request"


class DirectHydrationFakeRequests:
    """Serves page tokens plus captured-shape Polaris inbox/thread GraphQL data."""

    RequestException = Exception

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    @staticmethod
    def message(message_id: str, sender: str, text: str, timestamp_ms: str) -> dict[str, Any]:
        return {
            "id": message_id,
            "message_id": f"mid.${message_id}",
            "sender_fbid": sender,
            "content_type": "TEXT",
            "content": {"text_body": text},
            "timestamp_ms": timestamp_ms,
            "msg_reactions": [],
        }

    def thread(self) -> dict[str, Any]:
        return {
            "thread_id": "340282",
            "thread_key": "fb-thread-key",
            "thread_fbid": "fb-thread-key",
            "thread_title": "aeri",
            "viewer_id": "viewer-igid",
            "viewer": {
                "id": "viewer-igid",
                "interop_messaging_user_fbid": "viewer-fbid",
            },
            "users": [{
                "id": "user-igid",
                "interop_messaging_user_fbid": "5",
                "username": "aeri",
                "profile_pic_url": "https://cdn.example/aeri.jpg",
            }],
            "last_activity_timestamp_ms": "1700000001000",
            "marked_as_unread": True,
            "is_muted": False,
            "is_group": False,
            "slide_messages": {
                "edges": [
                    {"node": self.message("2", "viewer-fbid", "second", "1700000001000")},
                    {"node": self.message("1", "5", "first", "1700000000000")},
                ]
            },
        }

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET":
            html = '["DTSGInitialData",[],{"token":"DTSG_TOKEN"}] ["LSD",[],{"token":"LSD_TOKEN"}]'
            return type("R", (), {"status_code": 200, "text": html, "json": lambda self: {}})()
        operation = kwargs["data"]["fb_api_req_friendly_name"]
        if operation == "PolarisDirectInboxQuery":
            payload = {
                "data": {
                    "get_slide_mailbox_for_iris_subscription": {
                        "threads_by_folder": {
                            "edges": [{"node": {"as_ig_direct_thread": self.thread()}}]
                        }
                    }
                }
            }
        else:
            payload = {
                "data": {
                    "get_slide_thread_nullable": {"as_ig_direct_thread": self.thread()}
                }
            }
        return FakeResponse(200, payload)


def test_web_threads_uses_polaris_inbox_and_normalizes(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = DirectHydrationFakeRequests()
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch("web.threads", {"cookies": {"sessionid": "s", "ds_user_id": "42"}})

    thread = result["items"][0]
    assert thread["id"] == "340282"
    assert thread["title"] == "aeri"
    assert thread["lastActivityAt"] == 1_700_000_001
    assert thread["unread"] is True
    assert thread["users"][0]["id"] == "5"
    assert thread["users"][0]["profilePictureUrl"] == "https://cdn.example/aeri.jpg"
    assert [message["text"] for message in thread["messages"]] == ["first", "second"]
    assert thread["messages"][1]["mine"] is True
    post = next(call for call in fake.calls if call["method"] == "POST")
    assert post["data"]["fb_api_req_friendly_name"] == "PolarisDirectInboxQuery"
    assert post["data"]["doc_id"] == "27262915580045003"


def test_web_thread_uses_captured_thread_key_and_cached_page_tokens(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = DirectHydrationFakeRequests()
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}
    engine.dispatch("web.threads", {"cookies": cookies})
    result = engine.dispatch("web.thread", {"cookies": cookies, "threadId": "340282"})

    assert [message["text"] for message in result["items"]] == ["first", "second"]
    posts = [call for call in fake.calls if call["method"] == "POST"]
    assert posts[-1]["data"]["fb_api_req_friendly_name"] == "IGDThreadDetailQuery"
    assert posts[-1]["data"]["doc_id"] == "28395443243391552"
    assert '"thread_fbid":"fb-thread-key"' in posts[-1]["data"]["variables"]
    assert len([call for call in fake.calls if call["method"] == "GET"]) == 1


class SendFakeRequests:
    """Serves the token page (HTML) on GET, then a GraphQL ok on POST."""

    RequestException = Exception

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET":
            html = '["DTSGInitialData",[],{"token":"DTSG_TOKEN"}] ["LSD",[],{"token":"LSD_TOKEN"}]'
            return type("R", (), {"status_code": 200, "text": html, "json": lambda self: {}})()
        return FakeResponse(200, {"data": {"xdt_send_message": {"ok": True}}})


def test_web_send_uses_graphql_with_page_tokens(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = SendFakeRequests()
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch(
        "web.send", {"cookies": {"sessionid": "s", "ds_user_id": "42"}, "threadId": "34", "text": "hello"}
    )
    assert result["message"]["text"] == "hello"
    assert result["message"]["mine"] is True
    assert result["message"]["clientContext"]
    # First a GET to scrape tokens, then the GraphQL POST.
    assert fake.calls[0]["method"] == "GET"
    post = fake.calls[1]
    assert post["method"] == "POST" and post["url"].endswith("/api/graphql")
    body = post["data"]
    assert body["fb_dtsg"] == "DTSG_TOKEN"
    assert body["lsd"] == "LSD_TOKEN"
    assert body["fb_api_req_friendly_name"] == "IGDirectTextSendMutation"
    assert body["doc_id"] == "26911679871773184"
    assert '"ig_thread_igid":"34"' in body["variables"]
    assert '"sensitive_string_value":"hello"' in body["variables"]


class InteractionFakeRequests:
    """Serves token HTML, user info (fbid), and GraphQL ok responses."""

    RequestException = Exception

    def __init__(
        self,
        graphql_payload: dict[str, Any] | None = None,
        rest_payload: dict[str, Any] | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.graphql_payload = graphql_payload or {"data": {"ok": True}}
        self.rest_payload = rest_payload or {"status": "ok"}

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET" and url.rstrip("/").endswith("instagram.com"):
            html = '["DTSGInitialData",[],{"token":"DTSG_TOKEN"}] ["LSD",[],{"token":"LSD_TOKEN"}]'
            return type("R", (), {"status_code": 200, "text": html, "json": lambda self: {}})()
        if method == "GET" and "/api/v1/users/" in url and url.endswith("/info/"):
            return FakeResponse(200, {"user": {"pk": "42", "fbid_v2": "17841450859296213", "username": "me"}})
        if method == "POST" and "/api/graphql" not in url:
            return FakeResponse(200, self.rest_payload)
        return FakeResponse(200, self.graphql_payload)

    def graphql_posts(self) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["method"] == "POST" and c["url"].endswith("/api/graphql")]

    def rest_posts(self) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["method"] == "POST" and "/api/graphql" not in c["url"]]


def test_web_like_and_unlike_use_har_contracts(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests({"data": {"xig_media_like": {"media": {"has_liked": True}}}})
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    liked = engine.dispatch(
        "web.like",
        {"cookies": cookies, "mediaId": "3946249909356489892_54065316", "trackingToken": "tok"},
    )
    assert liked == {"liked": True, "mediaId": "3946249909356489892"}
    like_body = fake.graphql_posts()[0]["data"]
    assert like_body["fb_api_req_friendly_name"] == "usePolarisLikeMediaXIGLikeMutation"
    assert like_body["doc_id"] == "27182485238052618"
    assert like_body["av"] == "17841450859296213"
    assert '"media_id":"3946249909356489892"' in like_body["variables"]
    assert '"actor_id":"17841450859296213"' in like_body["variables"]

    fake.calls.clear()
    unliked = engine.dispatch("web.unlike", {"cookies": cookies, "mediaId": "3946249909356489892"})
    assert unliked["liked"] is False
    unlike_body = fake.graphql_posts()[0]["data"]
    assert unlike_body["fb_api_req_friendly_name"] == "usePolarisLikeMediaXIGUnlikeMutation"
    assert unlike_body["doc_id"] == "27345296031770102"


def test_web_save_and_unsave_use_har_contracts(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests()
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    saved = engine.dispatch(
        "web.save",
        {"cookies": cookies, "mediaId": "99", "loggingInfoToken": "logtok"},
    )
    assert saved["saved"] is True
    save_body = fake.graphql_posts()[0]["data"]
    assert save_body["fb_api_req_friendly_name"] == "usePolarisSaveMediaSaveMutation"
    assert save_body["doc_id"] == "27365486596441074"
    assert '"logging_info_token":"logtok"' in save_body["variables"]

    fake.calls.clear()
    unsaved = engine.dispatch("web.unsave", {"cookies": cookies, "mediaId": "99"})
    assert unsaved["saved"] is False
    assert fake.graphql_posts()[0]["data"]["doc_id"] == "27371251859134880"


def test_web_mark_read_react_share_forward_translate(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests(
        {
            "data": {
                "igd_detect_and_translate_text_content_query": [
                    {"translated_text": "hola", "error_code": None}
                ]
            }
        }
    )
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    assert engine.dispatch(
        "web.mark_read",
        {"cookies": cookies, "threadId": "340282", "messageId": "mid.$abc"},
    )["ok"] is True
    assert fake.graphql_posts()[0]["data"]["doc_id"] == "27356881703909995"

    fake.calls.clear()
    assert engine.dispatch(
        "web.react",
        {"cookies": cookies, "threadId": "17850", "messageId": "mid.$abc", "emoji": "😂"},
    )["emoji"] == "😂"
    react_body = fake.graphql_posts()[0]["data"]
    assert react_body["doc_id"] == "24374451552236906"
    assert '"reaction_status":"created"' in react_body["variables"]

    fake.calls.clear()
    shared = engine.dispatch(
        "web.share_media", {"cookies": cookies, "mediaId": "99_1", "threadId": "340282"}
    )
    assert shared["ok"] is True
    share_body = fake.graphql_posts()[0]["data"]
    assert share_body["fb_api_req_friendly_name"] == "IGDirectReelShareMutation"
    assert share_body["doc_id"] == "26212720875066239"
    assert '"ig_media_igid":"99"' in share_body["variables"]
    assert '"thread_id":"340282"' in share_body["variables"]
    assert '"recipient_users":null' in share_body["variables"]

    fake.calls.clear()
    # A bare user id (no existing thread) still shares via recipient_users.
    engine.dispatch("web.share_media", {"cookies": cookies, "mediaId": "99_1", "userId": "59241102400"})
    user_share = fake.graphql_posts()[0]["data"]
    assert user_share["doc_id"] == "26212720875066239"
    assert r'"recipient_users":"[\"59241102400\"]"' in user_share["variables"]
    assert '"thread_id":null' in user_share["variables"]

    fake.calls.clear()
    forwarded = engine.dispatch(
        "web.forward",
        {
            "cookies": cookies,
            "toThreadId": "dest",
            "fromThreadId": "src",
            "text": "forwarded note",
        },
    )
    assert forwarded["message"]["text"] == "forwarded note"
    fwd_vars = fake.graphql_posts()[0]["data"]["variables"]
    assert '"forwarded_from_thread_id":"src"' in fwd_vars
    assert '"ig_thread_igid":"dest"' in fwd_vars

    fake.calls.clear()
    translated = engine.dispatch(
        "web.translate",
        {"cookies": cookies, "messageId": "mid.$abc", "text": "hello"},
    )
    assert translated["translatedText"] == "hola"


def test_web_reels_uses_clips_container_and_pagination_queries(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    node = {
        "__typename": "XDTMediaDict",
        "id": "3945708384929752347_340804338",
        "pk": "3945708384929752347",
        "code": "DbB-N7vBKUb",
        "media_type": 2,
        "user": {"pk": "340804338", "username": "giovanni", "is_verified": True, "profile_pic_url": "u"},
        "has_liked": False,
        "like_count": 109714,
        "comment_count": 219,
        "view_count": None,
        "caption": {"text": "a caption"},
        "organic_tracking_token": "trk",
        "image_versions2": {"candidates": [{"width": 720, "url": "https://cdn/img.jpg"}]},
        "video_versions": [{"type": 101, "url": "https://cdn/video.mp4"}],
        "clips_metadata": {"music_info": {"music_asset_info": {"display_artist": "pupsies", "title": "misery."}}},
    }
    payload = {
        "data": {
            "xdt_api__v1__clips__home__connection_v2": {
                "edges": [{"node": {"media": node}}],
                "page_info": {"end_cursor": "CURSOR2", "has_next_page": True},
            }
        }
    }
    fake = InteractionFakeRequests(payload)
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    cold = engine.dispatch("web.reels", {"cookies": cookies})
    assert cold["hasMore"] is True
    assert cold["nextCursor"] == "CURSOR2"
    reel = cold["items"][0]
    assert reel["id"] == "3945708384929752347_340804338"
    assert reel["videoUrl"] == "https://cdn/video.mp4"
    assert reel["imageUrl"] == "https://cdn/img.jpg"
    assert reel["kind"] == "video"
    assert reel["likeCount"] == 109714
    assert reel["audio"] == "pupsies · misery."
    assert reel["trackingToken"] == "trk"
    assert reel["user"]["username"] == "giovanni"
    cold_body = fake.graphql_posts()[0]["data"]
    assert cold_body["fb_api_req_friendly_name"] == "PolarisClipsTabDesktopContainerQuery"
    assert cold_body["doc_id"] == "27865048666517472"

    fake.calls.clear()
    page = engine.dispatch(
        "web.reels", {"cookies": cookies, "cursor": "CURSOR2", "seenIds": ["3945708384929752347"]}
    )
    assert page["items"][0]["code"] == "DbB-N7vBKUb"
    page_body = fake.graphql_posts()[0]["data"]
    assert page_body["fb_api_req_friendly_name"] == "PolarisClipsTabDesktopPaginationQuery"
    assert page_body["doc_id"] == "28115468621393196"
    assert '"after":"CURSOR2"' in page_body["variables"]
    assert '\\"id\\":\\"3945708384929752347\\"' in page_body["variables"]


def test_web_share_targets_returns_threads_with_avatars(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "data": {
            "get_paginated_share_sheet_ranked_items": {
                "ranked_items": [
                    {
                        "thread_id": "340282366841710301281153316830215541743",
                        "thread_title": "AMM Ventures, LLC",
                        "users": [{"profile_pic_url": "a"}, {"profile_pic_url": "b"}],
                    },
                    {
                        "thread_id": "111",
                        "thread_title": "solo",
                        "users": [{"profile_pic_url": "c"}],
                    },
                ]
            }
        }
    }
    fake = InteractionFakeRequests(payload)
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())

    result = engine.dispatch("web.share_targets", {"cookies": {"sessionid": "s", "ds_user_id": "42"}})
    first, second = result["items"]
    assert first["threadId"] == "340282366841710301281153316830215541743"
    assert first["title"] == "AMM Ventures, LLC"
    assert first["avatars"] == ["a", "b"]
    assert first["isGroup"] is True
    assert second["isGroup"] is False
    body = fake.graphql_posts()[0]["data"]
    assert body["fb_api_req_friendly_name"] == "PolarisShareSheetV3NullStateQuery"
    assert body["doc_id"] == "36651079954537487"


def test_web_translate_unavailable_is_safe(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests(
        {"data": {"igd_detect_and_translate_text_content_query": [{"error_code": 9, "translated_text": None}]}}
    )
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    with pytest.raises(ProtocolError) as error:
        engine.dispatch(
            "web.translate",
            {"cookies": {"sessionid": "s", "ds_user_id": "42"}, "messageId": "mid.$a", "text": "x"},
        )
    assert error.value.code == "translate_unavailable"


def test_web_comment_like_and_unlike_use_har_contracts(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests({"data": {"xig_comment_like": {"ok": True}}})
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    liked = engine.dispatch("web.comment_like", {"cookies": cookies, "commentId": "180123"})
    assert liked == {"liked": True, "commentId": "180123"}
    post = fake.graphql_posts()[-1]
    assert post["data"]["fb_api_req_friendly_name"] == "PolarisCommentActionsLikeMutation"
    assert post["data"]["doc_id"] == "27184292767848867"
    assert '"comment_id":"180123"' in post["data"]["variables"]
    assert '"actor_id":"17841450859296213"' in post["data"]["variables"]

    unliked = engine.dispatch("web.comment_unlike", {"cookies": cookies, "commentId": "180123"})
    assert unliked == {"liked": False, "commentId": "180123"}
    rest = fake.rest_posts()[-1]
    assert rest["url"].endswith("/api/v1/media/180123/comment_unlike/")


def test_web_follow_and_unfollow_use_har_contracts(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests(
        {
            "data": {
                "xdt_create_friendship": {
                    "friendship_status": {"following": True, "outgoing_request": False}
                }
            }
        }
    )
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    followed = engine.dispatch("web.follow", {"cookies": cookies, "userId": "99"})
    assert followed == {"following": True, "outgoingRequest": False, "userId": "99"}
    post = fake.graphql_posts()[-1]
    assert post["data"]["fb_api_req_friendly_name"] == "usePolarisFollowMutation"
    assert post["data"]["doc_id"] == "26508036048874888"
    assert '"target_user_id":"99"' in post["data"]["variables"]

    fake.graphql_payload = {
        "data": {
            "xdt_destroy_friendship": {
                "friendship_status": {"following": False, "outgoing_request": False}
            }
        }
    }
    unfollowed = engine.dispatch("web.unfollow", {"cookies": cookies, "userId": "99"})
    assert unfollowed == {"following": False, "outgoingRequest": False, "userId": "99"}
    unfollow_post = fake.graphql_posts()[-1]
    assert unfollow_post["data"]["fb_api_req_friendly_name"] == "usePolarisUnfollowMutation"
    assert unfollow_post["data"]["doc_id"] == "27789106940691111"


def test_web_activity_uses_news_inbox(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    inbox = {
        "new_stories": [
            {
                "pk": "n1",
                "notif_name": "private_user_follow_request",
                "args": {
                    "text": "maya requested to follow you.",
                    "profile_name": "maya",
                    "profile_id": "7",
                    "profile_image": "https://cdn/p.jpg",
                    "timestamp": 1_700_000_000,
                    "inline_follow": {
                        "user_info": {
                            "id": "7",
                            "username": "maya",
                            "friendship_status": {
                                "following": False,
                                "followed_by": False,
                                "incoming_request": True,
                                "outgoing_request": False,
                            },
                        }
                    },
                },
            }
        ],
        "old_stories": [
            {
                "pk": "o1",
                "notif_name": "user_followed",
                "args": {
                    "text": "maya started following you.",
                    "profile_name": "maya",
                    "profile_id": "7",
                    "timestamp": 1_699_000_000,
                    "media": [{"image": "https://cdn/t.jpg"}],
                    "inline_follow": {
                        "user_info": {
                            "friendship_status": {
                                "following": False,
                                "followed_by": True,
                                "incoming_request": False,
                                "outgoing_request": False,
                            }
                        }
                    },
                },
            }
        ],
    }
    fake = InteractionFakeRequests(rest_payload=inbox)
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch("web.activity", {"cookies": {"sessionid": "s", "ds_user_id": "42"}})

    assert result["items"][0]["unread"] is True
    assert result["items"][0]["kind"] == "private_user_follow_request"
    assert result["items"][0]["incomingRequest"] is True
    assert result["items"][0]["userId"] == "7"
    assert result["items"][1]["unread"] is False
    assert result["items"][1]["followedBy"] is True
    assert result["items"][1]["thumbnailUrl"] == "https://cdn/t.jpg"
    rest = fake.rest_posts()[-1]
    assert rest["url"].endswith("/api/v1/news/inbox/")
    assert "fb_dtsg" in rest["data"]
    assert "jazoest" in rest["data"]


def test_web_follow_request_approve_and_decline(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    fake = InteractionFakeRequests(
        rest_payload={"friendship_status": {"incoming_request": False, "followed_by": True}}
    )
    monkeypatch.setattr(engine_module, "requests", fake)
    engine = ProtocolEngine(client_factory=ClientFactory())
    cookies = {"sessionid": "s", "ds_user_id": "42"}

    approved = engine.dispatch("web.follow_request_approve", {"cookies": cookies, "userId": "7"})
    assert approved["followedBy"] is True
    assert approved["incomingRequest"] is False
    assert fake.rest_posts()[-1]["url"].endswith("/api/v1/friendships/approve/7/")

    fake.rest_payload = {"friendship_status": {"incoming_request": False, "followed_by": False}}
    declined = engine.dispatch("web.follow_request_decline", {"cookies": cookies, "userId": "7"})
    assert declined["followedBy"] is False
    assert fake.rest_posts()[-1]["url"].endswith("/api/v1/friendships/ignore/7/")


def test_mobile_comment_like_and_follow(monkeypatch) -> None:
    engine, client = _authenticated_engine()
    liked: list[str] = []
    followed: list[str] = []
    approved: list[str] = []
    client.comment_like = lambda comment_id: liked.append(comment_id) or True
    client.comment_unlike = lambda comment_id: liked.append(f"u:{comment_id}") or True
    client.user_follow = lambda user_id: followed.append(user_id) or True
    client.user_unfollow = lambda user_id: followed.append(f"u:{user_id}") or True
    client.user_follow_request_approve = lambda user_id: approved.append(user_id) or True
    client.user_follow_request_decline = lambda user_id: approved.append(f"d:{user_id}") or True

    assert engine.dispatch("media.comment_like", {"commentId": "c1"}) == {
        "liked": True,
        "commentId": "c1",
    }
    assert engine.dispatch("media.comment_unlike", {"commentId": "c1"}) == {
        "liked": False,
        "commentId": "c1",
    }
    assert engine.dispatch("user.follow", {"userId": "7"}) == {
        "following": True,
        "outgoingRequest": False,
        "userId": "7",
    }
    assert engine.dispatch("user.unfollow", {"userId": "7"}) == {
        "following": False,
        "outgoingRequest": False,
        "userId": "7",
    }
    assert engine.dispatch("user.follow_request_approve", {"userId": "9"})["ok"] is True
    assert engine.dispatch("user.follow_request_decline", {"userId": "9"})["ok"] is True
    assert liked == ["c1", "u:c1"]
    assert followed == ["7", "u:7"]
    assert approved == ["9", "d:9"]


def test_timeline_preserves_engagement_tokens() -> None:
    page = normalize_timeline(
        {
            "feed_items": [
                {
                    "media_or_ad": {
                        "id": "9_1",
                        "media_type": 1,
                        "user": {"username": "maya"},
                        "organic_tracking_token": "track",
                        "logging_info_token": "log",
                        "image_versions2": {"candidates": [{"url": "https://cdn/x.jpg"}]},
                    }
                }
            ]
        }
    )
    assert page["items"][0]["trackingToken"] == "track"
    assert page["items"][0]["loggingInfoToken"] == "log"


def test_web_profile_and_medias_normalize(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "data": {
            "user": {
                "id": "42",
                "username": "maya",
                "full_name": "Maya",
                "biography": "hi",
                "profile_pic_url_hd": "https://cdn/p.jpg",
                "edge_followed_by": {"count": 1200},
                "edge_follow": {"count": 300},
                "edge_owner_to_timeline_media": {
                    "count": 2,
                    "edges": [
                        {"node": {"id": "9", "shortcode": "abc", "is_video": False,
                                   "display_url": "https://cdn/x.jpg",
                                   "edge_liked_by": {"count": 10},
                                   "edge_media_to_comment": {"count": 3}}},
                    ],
                },
            }
        }
    }
    monkeypatch.setattr(engine_module, "requests", FakeRequests(FakeResponse(200, payload)))
    engine = ProtocolEngine(client_factory=ClientFactory())

    profile = engine.dispatch("web.profile", {"cookies": {"sessionid": "s"}, "username": "maya"})
    assert profile["user"]["followerCount"] == 1200
    assert profile["user"]["mediaCount"] == 2
    assert profile["user"]["biography"] == "hi"

    medias = engine.dispatch("web.medias", {"cookies": {"sessionid": "s"}, "username": "maya"})
    assert medias["items"][0]["id"] == "9"
    assert medias["items"][0]["likeCount"] == 10
    assert medias["items"][0]["imageUrl"] == "https://cdn/x.jpg"


def test_web_timeline_requires_a_session() -> None:
    engine = ProtocolEngine(client_factory=ClientFactory())
    with pytest.raises(ProtocolError) as error:
        engine.dispatch("web.timeline", {"cookies": {"csrftoken": "t"}})
    assert error.value.code == "not_authenticated"


def test_web_session_expiry_is_a_safe_error(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    monkeypatch.setattr(engine_module, "requests", FakeRequests(FakeResponse(403, {})))
    engine = ProtocolEngine(client_factory=ClientFactory())
    with pytest.raises(ProtocolError) as error:
        engine.dispatch("web.timeline", {"cookies": {"sessionid": "s"}})
    assert error.value.code == "session_expired"


def test_normalizer_ignores_non_media_entries() -> None:
    assert normalize_timeline({"feed_items": [{"stories": []}]}) == {
        "items": [],
        "nextCursor": None,
        "hasMore": False,
    }


class Box:
    """Minimal stand-in for an instagrapi pydantic model."""

    def __init__(self, **fields: Any) -> None:
        for key, value in fields.items():
            setattr(self, key, value)


def _authenticated_engine(client_extras: dict[str, Any] | None = None) -> tuple[ProtocolEngine, FakeClient]:
    factory = ClientFactory()
    engine = ProtocolEngine(client_factory=factory)
    engine.dispatch("auth.login", {"username": "secondary", "password": "secret"})
    client = factory.instances[0]
    for key, value in (client_extras or {}).items():
        setattr(client, key, value)
    return engine, client


def test_data_methods_require_authentication() -> None:
    engine = ProtocolEngine(client_factory=ClientFactory())
    for method in ("feed.stories", "feed.reels", "direct.threads", "activity.inbox", "user.profile"):
        with pytest.raises(ProtocolError) as error:
            engine.dispatch(method)
        assert error.value.code == "not_authenticated"


def test_story_tray_marks_unseen_and_own_entries() -> None:
    engine, client = _authenticated_engine()
    client.user_id = "42"
    client.get_reels_tray_feed = lambda _reason: {
        "tray": [
            {"id": "42", "user": {"pk": "42", "username": "secondary"}, "latest_reel_media": 10, "seen": 10},
            {"id": "7", "user": {"pk": "7", "username": "maya"}, "latest_reel_media": 30, "seen": 12},
        ]
    }
    tray = engine.dispatch("feed.stories")
    assert [item["own"] for item in tray["items"]] == [True, False]
    assert [item["unseen"] for item in tray["items"]] == [False, True]


def test_reels_are_normalized_with_audio_and_cursor() -> None:
    engine, client = _authenticated_engine()
    media = Box(
        pk="991",
        id="991_7",
        code="abc",
        media_type=2,
        user=Box(pk="7", username="maya", full_name="Maya", profile_pic_url="https://cdn/p.jpg", is_verified=True),
        caption_text="green hour",
        taken_at=None,
        like_count=12,
        comment_count=3,
        play_count=900,
        video_url="https://cdn/v.mp4",
        thumbnail_url="https://cdn/t.jpg",
        clips_metadata={"music_info": {"display_artist": "band", "title": "song"}},
        resources=[],
    )
    client.reels = lambda amount, last_media_pk: [media]
    page = engine.dispatch("feed.reels", {"amount": 5})
    item = page["items"][0]
    assert item["kind"] == "video"
    assert item["user"]["username"] == "maya"
    assert item["audio"] == "band · song"
    assert item["videoUrl"] == "https://cdn/v.mp4"
    assert page["nextCursor"] == "991"


def test_direct_threads_and_send_are_normalized() -> None:
    engine, client = _authenticated_engine()
    client.user_id = "42"
    message = Box(id="m1", user_id="7", is_sent_by_viewer=False, item_type="text", text="hey", timestamp=None, reply=None)
    thread = Box(
        id="t1",
        thread_title="maya",
        users=[Box(pk="7", username="maya", full_name="", profile_pic_url=None, is_verified=False)],
        messages=[message],
        is_group=False,
        muted=False,
        pending=False,
        last_activity_at=None,
        is_seen=lambda _user_id: False,
    )
    client.direct_threads = lambda amount, thread_message_limit: [thread]
    client.direct_answer = lambda thread_id, text: Box(
        id="m2", user_id="42", is_sent_by_viewer=True, item_type="text", text=text, timestamp=None, reply=None
    )

    inbox = engine.dispatch("direct.threads")
    assert inbox["items"][0]["title"] == "maya"
    assert inbox["items"][0]["unread"] is True
    assert inbox["items"][0]["messages"][0]["text"] == "hey"

    sent = engine.dispatch("direct.send", {"threadId": "t1", "text": "hello"})
    assert sent["message"]["mine"] is True
    assert sent["message"]["text"] == "hello"

    with pytest.raises(ProtocolError) as error:
        engine.dispatch("direct.send", {"threadId": "t1", "text": "  "})
    assert error.value.code == "invalid_request"


def test_direct_rich_media_reactions_and_double_tap_are_normalized() -> None:
    engine, client = _authenticated_engine()
    reacted: list[tuple[str, str, str]] = []
    seen: list[tuple[str, str]] = []
    shared_video = Box(
        id="media-1",
        media_type=2,
        user=Box(pk="7", username="maya", full_name="Maya", profile_pic_url=None, is_verified=False),
        thumbnail_url="https://cdn.example/thumb.jpg",
        video_url="https://cdn.example/video.mp4",
        audio_url=None,
    )
    rich_message = Box(
        id="item-1",
        client_context="mid.item-1",
        user_id="7",
        is_sent_by_viewer=False,
        item_type="media",
        text=None,
        timestamp=None,
        reply=None,
        media=shared_video,
        reactions=Box(likes=[{}], likes_count=1, emojis=[Box(emoji="🔥")]),
    )
    client.direct_messages = lambda thread_id, amount: [rich_message]
    client.direct_send_reaction = lambda thread_id, message_id, emoji: reacted.append(
        (thread_id, message_id, emoji)
    ) or True
    client.direct_message_seen = lambda thread_id, message_id: seen.append((thread_id, message_id)) or True

    result = engine.dispatch("direct.thread", {"threadId": "t1"})
    item = result["items"][0]
    assert item["messageId"] == "item-1"
    assert item["clientContext"] == "mid.item-1"
    assert item["share"]["kind"] == "video"
    assert item["share"]["videoUrl"] == "https://cdn.example/video.mp4"
    assert item["reactions"] == ["❤️", "🔥"]

    reacted_result = engine.dispatch(
        "direct.react", {"threadId": "t1", "messageId": "item-1", "emoji": "❤️"}
    )
    assert reacted_result == {"ok": True, "emoji": "❤️", "messageId": "item-1"}
    assert reacted == [("t1", "item-1", "❤️")]
    assert engine.dispatch(
        "direct.mark_read", {"threadId": "t1", "messageId": "item-1"}
    ) == {"ok": True}
    assert seen == [("t1", "item-1")]


def test_data_failures_map_to_safe_codes() -> None:
    engine, client = _authenticated_engine()

    def throttled() -> dict[str, Any]:
        raise PleaseWaitFewMinutes("slow down")

    client.get_notes = throttled
    with pytest.raises(ProtocolError) as error:
        engine.dispatch("direct.notes")
    assert error.value.code == "rate_limited"

    def exploded(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise KeyError("password")

    client.news_inbox_v1 = exploded
    with pytest.raises(ProtocolError) as error:
        engine.dispatch("activity.inbox")
    assert error.value.code == "unexpected_error"
    assert "password" not in str(error.value)
