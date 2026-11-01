import io
import json
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jwt import PyJWKClientConnectionError
from jwt.algorithms import OKPAlgorithm
from pydantic import ValidationError
from sqlalchemy import select

from app.db import get_db
from app.main import create_app
from app.settings import Settings, settings
from app.staff import auth, seed
from app.staff.models import StaffUser

KID = "test-key"
SIGNING_KEY = ed25519.Ed25519PrivateKey.generate()
OTHER_KEY = ed25519.Ed25519PrivateKey.generate()


def make_token(sub=None, key=SIGNING_KEY, algorithm="EdDSA", kid=KID, **claims) -> str:
    payload = {
        "sub": str(sub or uuid4()),
        "aud": auth.ORIGIN,
        "iss": auth.ORIGIN,
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
    public = OKPAlgorithm.to_jwk(SIGNING_KEY.public_key(), as_dict=True)
    jwk_set = {"keys": [{**public, "kid": KID, "alg": "EdDSA", "use": "sig"}]}
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
        make_token(aud="https://other.neon.invalid"),
        make_token(aud=None),
        make_token(iss="https://other.neon.invalid"),
        make_token(iss=None),
        make_token(exp=None),
        make_token(sub="not-a-uuid"),
        make_token(kid=None),
        make_token(kid="unknown-key"),
        make_token(exp=datetime.now(UTC) - timedelta(seconds=1)),
        make_token(key="s" * 32, algorithm="HS256"),
        make_token(key=ec.generate_private_key(ec.SECP256R1()), algorithm="ES256"),
        make_token(key=None, algorithm="none"),
    ],
    ids=[
        "garbage",
        "tampered",
        "wrong-key",
        "wrong-audience",
        "no-audience",
        "wrong-issuer",
        "no-issuer",
        "no-expiry",
        "bad-subject",
        "no-kid",
        "unknown-kid",
        "expired",
        "shared-secret-algorithm",
        "other-asymmetric-algorithm",
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


def test_app_refuses_to_boot_without_neon_auth_url(monkeypatch):
    monkeypatch.delenv("NEON_AUTH_URL", raising=False)
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
    """Replaces the Neon call and returns the list of requests it received."""
    requests = []

    def urlopen(request, timeout):
        requests.append(request)
        if isinstance(result, Exception):
            raise result
        return io.BytesIO(json.dumps(result).encode())

    monkeypatch.setattr(seed, "urlopen", urlopen)
    monkeypatch.setattr(settings, "neon_api_key", "api-key")
    monkeypatch.setattr(settings, "neon_project_id", "project")
    monkeypatch.setattr(settings, "neon_branch_id", "branch")
    return requests


def test_seeded_account_can_call_me(db, client, monkeypatch):
    auth_id = uuid4()
    requests = fake_urlopen(monkeypatch, {"id": str(auth_id)})

    seed.create_staff(db, " Sam Lee ", " SAM@Example.com ")
    db.flush()

    assert (
        requests[0].full_url
        == "https://console.neon.tech/api/v2/projects/project/branches/branch/auth/users"
    )
    assert requests[0].get_header("Authorization") == "Bearer api-key"
    assert json.loads(requests[0].data) == {"email": "sam@example.com", "name": "Sam Lee"}
    response = get_me(client, make_token(auth_id))
    assert response.json() == {"name": "Sam Lee", "email": "sam@example.com"}


def test_seed_refuses_existing_staff_email_without_calling_neon(db, monkeypatch):
    add_staff(db)
    requests = fake_urlopen(monkeypatch, {"id": str(uuid4())})

    with pytest.raises(SystemExit, match="already exists"):
        seed.create_staff(db, "Sam", "sam@example.com")
    assert requests == []


def test_seed_reports_neon_refusal_and_adds_no_row(db, monkeypatch):
    body = io.BytesIO(b'{"error_code":"email_exists"}')
    fake_urlopen(monkeypatch, HTTPError("url", 422, "Unprocessable", {}, body))

    with pytest.raises(SystemExit, match="422.*email_exists"):
        seed.create_staff(db, "Sam", "sam@example.com")
    assert db.scalars(select(StaffUser)).all() == []


@pytest.mark.parametrize("setting", ["neon_api_key", "neon_project_id", "neon_branch_id"])
def test_seed_stops_without_neon_settings(monkeypatch, setting):
    fake_urlopen(monkeypatch, {"id": str(uuid4())})
    monkeypatch.setattr(settings, setting, None)
    with pytest.raises(SystemExit, match="NEON_API_KEY"):
        seed.create_auth_user("sam@example.com", "Sam")
