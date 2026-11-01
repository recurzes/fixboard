import re

import sentry_sdk

_FILTERED = "[Filtered]"
_SENSITIVE_KEY_PARTS = (
    "phone",
    "email",
    "description",
    "tenant_name",
    "token",
    "authorization",
    "cookie",
)
# Personal data can also end up inside exception messages and log lines.
_SENSITIVE_VALUE = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"  # email
    r"|(?i:bearer)\s+[\w.~+/=-]+"  # bearer token
    r"|\beyJ[\w-]+\.[\w-]+\.[\w-]+"  # JWT
    r"|(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b"  # US phone
)


def _scrub(value):
    if isinstance(value, dict):
        return {
            k: _FILTERED
            if isinstance(k, str) and any(part in k.lower() for part in _SENSITIVE_KEY_PARTS)
            else _scrub(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    if isinstance(value, str):
        return _SENSITIVE_VALUE.sub(_FILTERED, value)
    return value


def scrub_event(event, hint):
    request = event.get("request", {})
    for field in ("data", "cookies", "query_string"):
        request.pop(field, None)
    return _scrub(event)


def init_sentry(dsn: str | None) -> None:
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        before_send=scrub_event,
        include_local_variables=False,
        max_request_body_size="never",
    )
