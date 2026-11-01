import io
import json
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jwt import PyJWKClientConnectionError
from jwt.algorithms import ECAlgorithm
from pydantic import ValidationError
from sqlalchemy import select

from app.db import get_db
from app.main import create_app
from app.settings import Settings, settings
from app.staff import auth, seed
from app.staff.models import StaffUser

KID = "test-key"
SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def make_token(sub=None, key=SIGNING_KEY, algorithm="ES256", kid=KID, **claims) -> str:
    payload = {
        "sub": str(sub or uuid4()),
        "aud": auth.AUDIENCE,
        "exp": datetime.now(UTC) + timedelta(hours=1),
        **claims,
    }
    payload = {name: value for name, value in payload.items() if value is not None}
    return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": kid} if kid else None)


def tamper(token: str) -> str:
    """Swaps the payload for another user's, keeping the original signature."""
    header, _, signature = token.split(".")
    _, forged, _ = make_token().split(".")
    return f"{header}.{forged}.{signature}"


@pytest.fixture(autouse=True)
def fake_jwks(monkeypatch):
    """Serves the test public key from the real client, so key lookup still runs."""
    public = ECAlgorithm.to_jwk(SIGNING_KEY.public_key(), as_dict=True)
    jwk_set = {"keys": [{**public, "kid": KID, "alg": "ES256", "use": "sig"}]}
    monkeypatch.setattr(auth.jwks, "fetch_data", lambda: jwk_set)


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def add_staff(db, active: bool = True) -> StaffUser:
    staff = StaffUser(name="Sam", email="sam@example.com", auth_id=uuid4(), active=active)
    db.add(staff)
    db.flush()
    return staff


def get_me(client, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.get("/api/staff/me", headers=headers)


def test_valid_token_decodes_to_the_user_id():
    user_id = uuid4()
    assert auth.verify_token(make_token(user_id)) == user_id


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        tamper(make_token()),
        make_token(key=OTHER_KEY),
        make_token(aud="anon"),
        make_token(aud=None),
        make_token(exp=None),
        make_token(sub="not-a-uuid"),
        make_token(kid=None),
        make_token(kid="unknown-key"),
        make_token(exp=datetime.now(UTC) - timedelta(seconds=1)),
        make_token(key="s" * 32, algorithm="HS256"),
        make_token(key=None, algorithm="none"),
    ],
    ids=[
        "garbage",
        "tampered",
        "wrong-key",
        "wrong-audience",
        "no-audience",
        "no-expiry",
        "bad-subject",
        "no-kid",
        "unknown-kid",
        "expired",
        "shared-secret-algorithm",
        "unsigned",
    ],
)
def test_bad_tokens_are_rejected(token):
    with pytest.raises(HTTPException) as error:
        auth.verify_token(token)
    assert error.value.status_code == 401


def test_key_server_outage_is_503_not_401(monkeypatch):
    def fail():
        raise PyJWKClientConnectionError("down")

    monkeypatch.setattr(auth.jwks, "fetch_data", fail)
    monkeypatch.setattr(auth.jwks, "jwk_set_cache", None)
    with pytest.raises(HTTPException) as error:
        auth.verify_token(make_token())
    assert error.value.status_code == 503


def test_app_refuses_to_boot_without_supabase_url(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_no_token_gets_401(db, client):
    response = get_me(client)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthorized"


def test_non_bearer_scheme_gets_401(db, client):
    headers = {"Authorization": f"Basic {make_token()}"}
    assert client.get("/api/staff/me", headers=headers).status_code == 401


def test_bad_token_gets_401(db, client):
    assert get_me(client, tamper(make_token(add_staff(db).auth_id))).status_code == 401


def test_expired_token_gets_401(db, client):
    expired = datetime.now(UTC) - timedelta(seconds=1)
    assert get_me(client, make_token(add_staff(db).auth_id, exp=expired)).status_code == 401


def test_non_staff_user_gets_403(db, client):
    response = get_me(client, make_token())
    assert response.status_code == 403
    assert response.json() == {"error": {"code": "forbidden", "message": "Staff access only"}}


def test_inactive_staff_gets_403(db, client):
    staff = add_staff(db, active=False)
    assert get_me(client, make_token(staff.auth_id)).status_code == 403


def test_valid_staff_gets_name_and_email(db, client):
    staff = add_staff(db)
    response = get_me(client, make_token(staff.auth_id))
    assert response.status_code == 200
    assert response.json() == {"name": "Sam", "email": "sam@example.com"}


def fake_urlopen(monkeypatch, result):
    """Replaces the Supabase call and returns the list of requests it received."""
    requests = []

    def urlopen(request, timeout):
        requests.append(request)
        if isinstance(result, Exception):
            raise result
        return io.BytesIO(json.dumps(result).encode())

    monkeypatch.setattr(seed, "urlopen", urlopen)
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    return requests


def test_seeded_account_can_call_me(db, client, monkeypatch):
    auth_id = uuid4()
    requests = fake_urlopen(monkeypatch, {"id": str(auth_id)})

    seed.create_staff(db, " Sam Lee ", " SAM@Example.com ", "hunter2-long")
    db.flush()

    assert requests[0].full_url == "https://test.supabase.invalid/auth/v1/admin/users"
    assert requests[0].get_header("Apikey") == "service-key"
    assert requests[0].get_header("Authorization") == "Bearer service-key"
    assert json.loads(requests[0].data) == {
        "email": "sam@example.com",
        "password": "hunter2-long",
        "email_confirm": True,
    }
    response = get_me(client, make_token(auth_id))
    assert response.json() == {"name": "Sam Lee", "email": "sam@example.com"}


def test_seed_refuses_existing_staff_email_without_calling_supabase(db, monkeypatch):
    add_staff(db)
    requests = fake_urlopen(monkeypatch, {"id": str(uuid4())})

    with pytest.raises(SystemExit, match="already exists"):
        seed.create_staff(db, "Sam", "sam@example.com", "hunter2-long")
    assert requests == []


def test_seed_reports_supabase_refusal_and_adds_no_row(db, monkeypatch):
    body = io.BytesIO(b'{"error_code":"email_exists"}')
    fake_urlopen(monkeypatch, HTTPError("url", 422, "Unprocessable", {}, body))

    with pytest.raises(SystemExit, match="422.*email_exists") as error:
        seed.create_staff(db, "Sam", "sam@example.com", "hunter2-long")
    assert "hunter2-long" not in str(error.value)
    assert db.scalars(select(StaffUser)).all() == []


def test_seed_stops_without_service_key(monkeypatch):
    monkeypatch.setattr(settings, "supabase_service_key", None)
    with pytest.raises(SystemExit, match="SUPABASE_SERVICE_KEY"):
        seed.create_auth_user("sam@example.com", "hunter2-long")
