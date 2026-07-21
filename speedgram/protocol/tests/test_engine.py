from __future__ import annotations

from typing import Any

import pytest

from instagrapi.exceptions import ChallengeRequired, ClientError, PleaseWaitFewMinutes, TwoFactorRequired
from speedgram_protocol import ProtocolEngine, ProtocolError, normalize_timeline
from speedgram_protocol.engine import _DEVICE_POOL


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
            "commentCount": 3,
            "liked": False,
            "saved": False,
            "imageUrl": "https://cdn.example/image.jpg",
            "videoUrl": None,
            "children": [],
        }
    ]


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


def test_web_threads_normalizes_inbox(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "inbox": {
            "threads": [
                {
                    "thread_id": "340282",
                    "thread_title": "aeri",
                    "users": [{"pk": "5", "username": "aeri"}],
                    "last_activity_at": 1_700_000_000_000_000,
                    "items": [
                        {"item_id": "1", "user_id": "5", "item_type": "text", "text": "hi", "timestamp": 1_700_000_000_000_000},
                        {"item_id": "2", "user_id": "42", "item_type": "text", "text": "hey", "timestamp": 1_700_000_001_000_000},
                    ],
                }
            ]
        }
    }
    fake = FakeRequests(FakeResponse(200, payload))
    monkeypatch.setattr(engine_module, "requests", fake)

    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch("web.threads", {"cookies": {"sessionid": "s", "ds_user_id": "42"}})
    thread = result["items"][0]
    assert thread["id"] == "340282"
    assert thread["title"] == "aeri"
    assert thread["lastActivityAt"] == 1_700_000_000  # microseconds reduced to seconds
    # API items are newest-first; the normalizer reverses them for top-to-bottom display.
    assert thread["messages"][0]["text"] == "hey"
    assert thread["messages"][0]["mine"] is True  # viewer 42's own message
    assert thread["messages"][1]["text"] == "hi"
    assert thread["messages"][1]["mine"] is False
    assert "/api/v1/direct_v2/inbox/" in fake.calls[0]["url"]


def test_web_thread_returns_items_chronologically(monkeypatch) -> None:
    from speedgram_protocol import engine as engine_module

    payload = {
        "thread": {
            "thread_id": "340282",
            "items": [
                {"item_id": "2", "user_id": "42", "item_type": "text", "text": "second"},
                {"item_id": "1", "user_id": "5", "item_type": "text", "text": "first"},
            ],
        }
    }
    monkeypatch.setattr(engine_module, "requests", FakeRequests(FakeResponse(200, payload)))
    engine = ProtocolEngine(client_factory=ClientFactory())
    result = engine.dispatch("web.thread", {"cookies": {"sessionid": "s", "ds_user_id": "42"}, "threadId": "340282"})
    # newest-first API order reversed → oldest ("first") at top
    assert [m["text"] for m in result["items"]] == ["first", "second"]
    assert result["items"][1]["mine"] is True


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
    # First a GET to scrape tokens, then the GraphQL POST.
    assert fake.calls[0]["method"] == "GET"
    post = fake.calls[1]
    assert post["method"] == "POST" and post["url"].endswith("/api/graphql")
    body = post["data"]
    assert body["fb_dtsg"] == "DTSG_TOKEN"
    assert body["lsd"] == "LSD_TOKEN"
    assert body["fb_api_req_friendly_name"] == "IGDirectTextSendMutation"
    assert '"ig_thread_igid":"34"' in body["variables"]
    assert '"sensitive_string_value":"hello"' in body["variables"]


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
