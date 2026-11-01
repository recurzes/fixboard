from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class FormClosed(HTTPException):
    """Has its own code, so the frontend can tell the kill switch from an outage."""

    code = "form_closed"

    def __init__(self):
        super().__init__(503, "The request form is closed, please call the office")


def _error(status: int, code: str, message: str, headers=None, **extra) -> JSONResponse:
    content = {"error": {"code": code, "message": message, **extra}}
    return JSONResponse(content, status_code=status, headers=headers)


async def _http_error(request: Request, exc: HTTPException) -> JSONResponse:
    code = getattr(exc, "code", HTTPStatus(exc.status_code).name.lower())
    return _error(exc.status_code, code, str(exc.detail), exc.headers)


async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Only location and message: FastAPI's default also echoes the submitted input.
    fields = [
        {"field": ".".join(str(part) for part in err["loc"]), "message": err["msg"]}
        for err in exc.errors()
    ]
    return _error(422, "validation_error", "Invalid request", fields=fields)


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # Starlette re-raises after this response, so the server log and Sentry still see the error.
    return _error(500, "internal_error", "Something went wrong")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)
