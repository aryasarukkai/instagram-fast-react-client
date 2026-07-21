import json
import sys
from typing import Any

from .engine import ProtocolEngine, ProtocolError


def response(
    request_id: Any,
    *,
    result: Any = None,
    error: str | None = None,
    code: str = "protocol_error",
) -> str:
    payload: dict[str, Any] = {"id": request_id}
    if error is None:
        payload["result"] = result
    else:
        payload["error"] = {"code": code, "message": error}
    return json.dumps(payload, separators=(",", ":"))


def main() -> None:
    engine = ProtocolEngine()
    for line in sys.stdin:
        request: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ProtocolError("invalid_request", "Requests must be JSON objects.")
            output = response(
                request.get("id"),
                result=engine.dispatch(request.get("method", ""), request.get("params")),
            )
        except ProtocolError as exc:
            request_id = request.get("id") if isinstance(request, dict) else None
            output = response(request_id, error=str(exc), code=exc.code)
        except (json.JSONDecodeError, TypeError, ValueError):
            request_id = request.get("id") if isinstance(request, dict) else None
            output = response(request_id, error="The protocol request was invalid.", code="invalid_request")
        except Exception:
            request_id = request.get("id") if isinstance(request, dict) else None
            output = response(request_id, error="The protocol engine could not complete the request.")
        print(output, flush=True)


if __name__ == "__main__":
    main()
