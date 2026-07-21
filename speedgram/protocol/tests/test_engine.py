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
