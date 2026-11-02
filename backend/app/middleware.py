from fastapi import HTTPException
from starlette.datastructures import MutableHeaders

from app.photos.images import MAX_PHOTO_BYTES, MAX_PHOTOS

# A full set of photos, plus the form fields and multipart framing.
MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 2 * 1024 * 1024


class BodyLimitMiddleware:
    """Counts the bytes actually received, because a chunked upload declares no Content-Length."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    # FastAPI's HTTPException, because it turns any other error here into a 400.
                    raise HTTPException(413, "This request is too large")
            return message

        await self.app(scope, limited_receive, send)


class ReferrerPolicyMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_policy(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Referrer-Policy"] = "no-referrer"
            await send(message)

        await self.app(scope, receive, send_with_policy)
