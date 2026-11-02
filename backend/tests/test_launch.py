import json

import pytest
from botocore.exceptions import EndpointConnectionError
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.demo_seed import REQUESTS, seed_demo
from app.intake.form_config import FORM_CONFIG_PATH, load_form_config
from app.intake.models import Property, Unit
from app.intake.routes import limiter
from app.main import create_app
from app.photos import storage
from app.requests.models import MaintenanceRequest, RequestStatus
from app.residents.models import Resident
from app.settings import Settings
from tests.test_photos import FakeBucket


@pytest.fixture(autouse=True)
def bucket(monkeypatch):
    limiter.reset()
    fake = FakeBucket()
    monkeypatch.setattr(storage, "_client", lambda: fake)
    return fake


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=False)


class DownDatabase:
    def execute(self, statement):
        raise OperationalError("SELECT 1", {}, Exception("connection to secret-host failed"))


# T77


def test_placeholder_emergency_number_warns_and_still_boots(capsys):
    client = TestClient(create_app())

    assert "EMERGENCY NUMBER IS STILL THE PLACEHOLDER" in capsys.readouterr().out
    assert client.get("/health").status_code == 200


def test_real_emergency_number_does_not_warn(tmp_path, capsys):
    config = json.loads(FORM_CONFIG_PATH.read_text(encoding="utf-8"))
    config["emergency_number"] = "(212) 555-0100"
    path = tmp_path / "form_config.json"
    path.write_text(json.dumps(config), encoding="utf-8")

    create_app(path)

    assert "PLACEHOLDER" not in capsys.readouterr().out


def test_production_refuses_to_start_without_sentry():
    with pytest.raises(ValidationError, match="SENTRY_DSN"):
        Settings(_env_file=None, environment="production", sentry_dsn=None)


def test_production_starts_with_sentry():
    dsn = "https://key@example.invalid/1"
    assert Settings(_env_file=None, environment="production", sentry_dsn=dsn).sentry_dsn == dsn


def test_local_starts_without_sentry():
    assert Settings(_env_file=None, environment="local", sentry_dsn=None).sentry_dsn is None


# T78


def test_ready_passes_when_database_and_storage_answer(client):
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_down_fails_ready_and_not_health(client):
    client.app.dependency_overrides[get_db] = lambda: DownDatabase()

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"error": {"code": "service_unavailable", "message": "Not ready"}}
    assert client.get("/health").status_code == 200


def test_storage_down_fails_ready_and_not_health(client, bucket, monkeypatch):
    def down(Bucket):
        raise EndpointConnectionError(endpoint_url="https://secret-host.invalid")

    monkeypatch.setattr(bucket, "head_bucket", down)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert "secret-host" not in response.text
    assert client.get("/health").status_code == 200


def test_ready_is_rate_limited(client):
    statuses = [client.get("/health/ready").status_code for _ in range(31)]
    assert statuses == [200] * 30 + [429]


# T81


def seed(db) -> list[MaintenanceRequest]:
    seed_demo(db, load_form_config(FORM_CONFIG_PATH))
    return list(db.scalars(select(MaintenanceRequest)))


def test_demo_seed_has_an_urgent_request_and_a_contact_mismatch(db):
    requests = seed(db)

    assert len(requests) == len(REQUESTS)
    assert [r.tenant_name for r in requests if r.urgent] == ["Avery Stone"]
    assert [r.tenant_name for r in requests if r.needs_review] == ["Blake Rivera"]


def test_demo_seed_shows_every_status(db):
    assert {r.status for r in seed(db)} == set(RequestStatus)


def test_demo_seed_waiting_on_vendor_has_a_vendor(db):
    waiting = [r for r in seed(db) if r.status == RequestStatus.waiting_on_vendor]
    assert waiting and all(r.assignee_id for r in waiting)


def test_demo_seed_leaves_the_real_roster_alone(db):
    real = Property(name="Oak", address="1 Main St")
    db.add(real)
    db.flush()
    unit = Unit(property_id=real.id, label="1A")
    db.add(unit)
    db.flush()
    tenant = Resident(unit_id=unit.id, name="Real Tenant", email="real@example.com")
    db.add(tenant)
    db.flush()

    requests = seed(db)

    assert tenant.active
    assert real.id not in {r.property_id for r in requests}


def test_second_demo_seed_stops(db):
    seed(db)
    with pytest.raises(SystemExit, match="already loaded"):
        seed_demo(db, load_form_config(FORM_CONFIG_PATH))
