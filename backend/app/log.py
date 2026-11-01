import json
import logging
import sys
import time
from contextvars import ContextVar
from datetime import UTC, datetime
from uuid import uuid4

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

logger = logging.getLogger(__name__)

# Allowlist, so a stray `extra=` can never put tenant data in the logs.
_EXTRA_FIELDS = ("method", "path", "status", "duration_ms")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        entry |= {f: getattr(record, f) for f in _EXTRA_FIELDS if hasattr(record, f)}
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.handlers.clear()
    uvicorn_logger.propagate = True
    # uvicorn's access log includes query strings, and the staff search `q` can hold tenant names.
    logging.getLogger("uvicorn.access").disabled = True


class RequestLogMiddleware:
    """Gives each request an id and writes one access line, without the query string or body."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        # Not reset afterwards: the 500 handler and uvicorn's traceback log run outside this
        # middleware and need the id. Each request runs in its own task, so it cannot leak.
        request_id_var.set(uuid4().hex)
        started = time.perf_counter()
        status = 500  # stays 500 if the app raises before responding

        async def send_with_status(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_with_status)
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
