import json
import logging

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError
from sentry_sdk.transport import Transport

from app.main import create_app
from app.sentry import init_sentry, scrub_event
from app.settings import Settings

SECRET_EMAIL = "tenant@example.com"
SECRET_PHONE = "(555) 123-4567"


class Payload(BaseModel):
    count: int


def make_client() -> TestClient:
    """The real app setup plus routes that exist only for tests."""
    app: FastAPI = create_app()

    @app.post("/echo")
    def echo(payload: Payload):
        return payload

    @app.get("/boom")
    def boom():
        logging.getLogger("test").info("about to call %s", SECRET_PHONE)
        raise RuntimeError(f"failed for {SECRET_EMAIL}")

    return TestClient(app, raise_server_exceptions=False)


def test_health():
    response = make_client().get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_app_refuses_to_boot_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_404_uses_error_shape():
    response = make_client().get("/missing")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_405_keeps_allow_header():
    response = make_client().post("/health")
    assert response.status_code == 405
    assert response.headers["allow"] == "GET"
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_422_uses_error_shape_and_does_not_echo_input():
    response = make_client().post("/echo", json={"count": SECRET_EMAIL})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["fields"][0]["field"] == "body.count"
    assert SECRET_EMAIL not in response.text


def test_500_uses_error_shape_and_hides_details():
    response = make_client().get("/boom")
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Something went wrong"}
    }


def test_request_logs_are_json_with_request_id_and_no_query_string(capsys):
    client = make_client()
    client.get("/health?q=secret-tenant-name")
    client.get("/boom")

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    # httpx logs from the test client itself, outside any request
    lines = [line for line in lines if not line["logger"].startswith("httpx")]
    assert [(line.get("path"), line.get("status")) for line in lines] == [
        ("/health", 200),
        (None, None),
        ("/boom", 500),
    ]
    assert all(line["request_id"] for line in lines)
    assert lines[0]["request_id"] != lines[2]["request_id"]
    assert lines[1]["request_id"] == lines[2]["request_id"]
    assert not any("secret-tenant-name" in json.dumps(line) for line in lines)


class CaptureTransport(Transport):
    def __init__(self):
        super().__init__()
        self.events = []

    def capture_envelope(self, envelope):
        if event := envelope.get_event():
            self.events.append(event)


@pytest.fixture
def sentry_events():
    client = make_client()
    init_sentry("https://key@example.invalid/1")
    transport = CaptureTransport()
    sentry_sdk.get_client().transport = transport
    yield client, transport.events
    sentry_sdk.init()


def test_unhandled_error_reaches_sentry_without_personal_data(sentry_events):
    client, events = sentry_events
    client.get(
        "/boom?q=secret-tenant-name",
        headers={"Authorization": "Bearer secret-token", "X-Phone": SECRET_PHONE},
    )

    assert len(events) == 1
    event = events[0]
    assert event["exception"]["values"][-1]["type"] == "RuntimeError"
    assert event["exception"]["values"][-1]["value"] == "failed for [Filtered]"
    assert event["request"]["headers"]["authorization"] == "[Filtered]"
    assert "about to call [Filtered]" in json.dumps(event["breadcrumbs"])

    raw = json.dumps(event, default=str)
    for secret in (SECRET_EMAIL, SECRET_PHONE, "secret-token", "secret-tenant-name"):
        assert secret not in raw


def test_scrubber_removes_nested_fields_and_keeps_the_rest():
    event = {
        "event_id": "0123456789abcdef0123456789abcdef",
        "request": {
            "url": "http://testserver/x",
            "data": {"description": "the door code is 1234"},
            "cookies": {"session": "abc"},
            "query_string": "q=name",
        },
        "extra": {
            "tenant": {"phone": "5551234567", "Email": "a@b.co", "unit": "4B"},
            "items": [{"access_token": "abc"}, "call +15551234567", "token eyJa.eyJb.sig"],
        },
    }
    scrubbed = scrub_event(event, {})

    assert scrubbed["event_id"] == event["event_id"]
    assert scrubbed["request"] == {"url": "http://testserver/x"}
    assert scrubbed["extra"]["tenant"] == {
        "phone": "[Filtered]",
        "Email": "[Filtered]",
        "unit": "4B",
    }
    assert scrubbed["extra"]["items"] == [
        {"access_token": "[Filtered]"},
        "call [Filtered]",
        "token [Filtered]",
    ]
