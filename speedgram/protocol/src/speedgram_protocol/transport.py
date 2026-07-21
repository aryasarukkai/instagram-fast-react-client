"""Pluggable HTTP transport for the private (mobile) Instagram API.

instagrapi drives its private calls through a plain ``requests.Session`` whose
TLS/HTTP2 fingerprint reads as Python, not as an Android device. That mismatch —
Android app headers over a Python TLS stack — is stamped on every request and is
the strongest, most durable signal against a client pretending to be the app.

This module is the seam for fixing that without touching instagrapi's
request-building logic: the engine can hand a client a replacement session that
impersonates a real Android TLS stack. The seam is deliberately backend-agnostic.
Today it installs a curl_cffi session; tomorrow the same seam can host an
OkHttp-accurate TLS layer or an entirely different backend.

Honest ceiling: curl_cffi's Android profile is Chrome-on-Android, not Instagram's
native OkHttp/BoringSSL stack. It is a large step up from Python's fingerprint,
but a perfect app match needs a custom TLS profile beyond curl_cffi's presets.
"""

from __future__ import annotations

from typing import Any

# curl_cffi's Android *browser* impersonation target (see module docstring on why
# this is close-but-not-exact for the Instagram app).
_ANDROID_IMPERSONATE = "chrome131_android"


class TransportUnavailable(RuntimeError):
    """Raised when a requested transport backend is not installed."""


def android_transport(impersonate: str = _ANDROID_IMPERSONATE) -> Any:
    """Build a requests-compatible session that impersonates an Android TLS stack.

    Raises TransportUnavailable if the optional ``curl_cffi`` dependency is
    missing, so the default (plain requests) path keeps working without it.
    """
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError as exc:  # pragma: no cover - exercised only without the extra
        raise TransportUnavailable(
            "The Android transport needs the optional 'curl_cffi' dependency "
            "(install the 'impersonate' extra)."
        ) from exc
    return cffi_requests.Session(impersonate=impersonate)


def install_transport(client: Any, session: Any) -> Any:
    """Point an instagrapi client's private (mobile) calls at ``session``.

    Migrates the headers, cookies, proxy, and TLS-verify state instagrapi already
    configured during construction so the swap is transparent to the rest of the
    client. A no-op-safe helper: unknown session shapes are tolerated.
    """
    if session is None:
        return client
    old = getattr(client, "private", None)
    if old is not None:
        _migrate(old, session)
    client.private = session
    return client


def _migrate(old: Any, new: Any) -> None:
    old_headers = getattr(old, "headers", None)
    if old_headers:
        try:
            new.headers.update(dict(old_headers))
        except AttributeError:
            new.headers = dict(old_headers)
    for name, value in _cookie_items(getattr(old, "cookies", None)):
        setter = getattr(getattr(new, "cookies", None), "set", None)
        if callable(setter):
            setter(name, value)
    for attr in ("proxies", "verify"):
        value = getattr(old, attr, None)
        if value not in (None, {}):
            setattr(new, attr, value)


def _cookie_items(cookies: Any) -> list[tuple[str, str]]:
    if cookies is None:
        return []
    get_dict = getattr(cookies, "get_dict", None)
    if callable(get_dict):
        return list(get_dict().items())
    try:
        return [(cookie.name, cookie.value) for cookie in cookies]
    except TypeError:
        return []
