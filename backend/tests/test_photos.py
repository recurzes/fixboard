import json
from io import BytesIO
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from fastapi.testclient import TestClient
from PIL import ExifTags, Image
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.intake.models import Property, Unit
from app.intake.routes import limiter
from app.main import create_app
from app.photos import images, storage
from app.photos.images import clean_image
from app.photos.models import Photo
from app.photos.report import find_orphans
from app.requests.models import MaintenanceRequest
from app.settings import settings

GPS_LATITUDE = (14.0, 35.0, 0.0)
REAL_CLIENT = storage._client


class FakeBucket:
    """Stands in for the S3 client, so the real wrapper in app.photos.storage still runs."""

    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.fail_uploads_after: int | None = None
        self.uploads = 0
        self.fail_deletes = False

    def put_object(self, Bucket, Key, Body, ContentType):
        assert Bucket == settings.storage_bucket
        if self.fail_uploads_after is not None and self.uploads >= self.fail_uploads_after:
            raise EndpointConnectionError(endpoint_url="https://storage.test.invalid")
        self.uploads += 1
        self.files[Key] = Body

    def delete_object(self, Bucket, Key):
        if self.fail_deletes:
            raise ClientError({"Error": {"Code": "500"}}, "DeleteObject")
        self.files.pop(Key, None)

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return self

    def paginate(self, Bucket):
        return [{"Contents": [{"Key": key} for key in self.files]}, {}]


@pytest.fixture(autouse=True)
def bucket(monkeypatch):
    limiter.reset()
    fake = FakeBucket()
    monkeypatch.setattr(storage, "_client", lambda: fake)
    return fake


@pytest.fixture
def unit(db) -> Unit:
    property_ = Property(name="Oak", address="1 Main St")
    db.add(property_)
    db.flush()
    unit = Unit(property_id=property_.id, label="1A")
    db.add(unit)
    # Committed to the fixture's outer transaction, so a failed submit's rollback keeps the unit.
    db.commit()
    return unit


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    # So a forced 500 comes back as the response, as it would for a real caller.
    return TestClient(app, raise_server_exceptions=False)


def image_bytes(format="JPEG", size=(4, 2), mode="RGB", **save) -> bytes:
    output = BytesIO()
    Image.new(mode, size, "red").save(output, format=format, **save)
    return output.getvalue()


def exif_with_gps(orientation: int = 1) -> Image.Exif:
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = orientation
    exif[ExifTags.Base.Make] = "SECRET-CAMERA"
    exif.get_ifd(ExifTags.IFD.GPSInfo)[ExifTags.GPS.GPSLatitude] = GPS_LATITUDE
    return exif


def submit(client, unit: Unit, photos: list[bytes] = (), key: str | None = None, **overrides):
    body = {
        "unit_id": unit.id,
        "tenant_name": "Pat Lee",
        "email": "pat@example.com",
        "category": "plumbing",
        "description": "The sink is clogged",
        "entry_permission": "notify_first",
        "followup_answers": {"problem": "leak", "location": "kitchen"},
        "not_an_emergency": True,
        **overrides,
    }
    return client.post(
        "/api/public/requests",
        data={"data": json.dumps(body)},
        files=[("photos", ("photo.jpg", photo, "image/jpeg")) for photo in photos],
        headers={"Idempotency-Key": key or uuid4().hex},
    )


def count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def assert_nothing_saved(db, bucket) -> None:
    assert count(db, MaintenanceRequest) == 0
    assert count(db, Photo) == 0
    assert bucket.files == {}


# T44


def test_signed_url_is_signed_and_expires(monkeypatch):
    monkeypatch.setattr(storage, "_client", REAL_CLIENT)  # signing is local, so nothing connects

    url = storage.signed_url("requests/1/a.jpg")

    assert "/photos/requests/1/a.jpg?" in url
    assert "X-Amz-Signature=" in url
    assert f"X-Amz-Expires={storage.SIGNED_URL_SECONDS}" in url


# T45


@pytest.mark.parametrize(
    "content",
    [
        b"not an image",
        b"",
        b"%PDF-1.7 pretending to be a jpg",
        image_bytes("GIF", mode="P"),
        image_bytes("WEBP"),
        image_bytes()[:40],  # truncated
    ],
)
def test_wrong_type_is_rejected_whatever_the_file_claims(db, client, unit, bucket, content):
    response = submit(client, unit, [content])

    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.photos.0"
    assert_nothing_saved(db, bucket)


def test_oversize_photo_is_rejected(db, client, unit, bucket, monkeypatch):
    photo = image_bytes()
    monkeypatch.setattr(images, "MAX_PHOTO_BYTES", len(photo) - 1)

    response = submit(client, unit, [photo])

    assert response.status_code == 422
    assert "10 MB" in response.json()["error"]["fields"][0]["message"]
    assert_nothing_saved(db, bucket)


def test_exactly_the_size_limit_is_accepted(client, unit, monkeypatch):
    photo = image_bytes()
    monkeypatch.setattr(images, "MAX_PHOTO_BYTES", len(photo))
    assert submit(client, unit, [photo]).status_code == 201


def test_sixth_photo_is_rejected_and_five_are_accepted(db, client, unit, bucket):
    response = submit(client, unit, [image_bytes()] * 6)
    assert response.status_code == 422
    assert response.json()["error"]["fields"][0]["field"] == "body.photos"
    assert_nothing_saved(db, bucket)

    assert submit(client, unit, [image_bytes()] * 5).status_code == 201
    assert len(bucket.files) == 5


def test_decompression_bomb_is_rejected(db, client, unit, bucket, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1)
    assert submit(client, unit, [image_bytes(size=(4, 4))]).status_code == 422
    assert_nothing_saved(db, bucket)


def test_heic_is_accepted_and_stored_as_jpeg():
    photo = clean_image(BytesIO(image_bytes("HEIF", size=(64, 64))))

    assert photo.content_type == "image/jpeg"
    assert Image.open(BytesIO(photo.content)).format == "JPEG"


# T46


@pytest.mark.parametrize("format", ["JPEG", "PNG", "HEIF"])
def test_gps_and_other_exif_are_removed(format):
    original = image_bytes(format, size=(64, 64), exif=exif_with_gps())
    assert Image.open(BytesIO(original)).getexif().get_ifd(ExifTags.IFD.GPSInfo)

    photo = clean_image(BytesIO(original))

    assert not Image.open(BytesIO(photo.content)).getexif()
    assert b"SECRET-CAMERA" not in photo.content


def test_png_text_chunks_are_removed():
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Comment", "SECRET-NOTE")

    photo = clean_image(BytesIO(image_bytes("PNG", pnginfo=info)))

    assert b"SECRET-NOTE" not in photo.content


def test_orientation_is_applied_before_exif_is_removed():
    sideways = image_bytes(size=(4, 2), exif=exif_with_gps(orientation=6))

    photo = clean_image(BytesIO(sideways))

    assert Image.open(BytesIO(photo.content)).size == (2, 4)


def test_png_keeps_its_transparency():
    transparent = image_bytes("PNG", mode="RGBA")
    photo = clean_image(BytesIO(transparent))

    assert photo.content_type == "image/png"
    assert Image.open(BytesIO(photo.content)).mode == "RGBA"


# T47


def test_deleting_a_request_removes_its_photo_rows(db, client, unit):
    submit(client, unit, [image_bytes()])
    assert count(db, Photo) == 1

    db.execute(delete(MaintenanceRequest))

    assert count(db, Photo) == 0


# T48


def test_request_with_three_photos_is_stored_and_readable(db, client, unit, bucket):
    response = submit(client, unit, [image_bytes(), image_bytes("PNG"), image_bytes()])

    assert response.status_code == 201
    saved = db.scalar(select(MaintenanceRequest))
    assert response.json() == {"reference_number": saved.reference_number}

    photos = db.scalars(select(Photo).order_by(Photo.id)).all()
    assert [photo.content_type for photo in photos] == ["image/jpeg", "image/png", "image/jpeg"]
    assert set(bucket.files) == {photo.storage_path for photo in photos}
    for photo in photos:
        assert photo.request_id == saved.id
        assert photo.storage_path.startswith(f"requests/{saved.id}/")
        assert photo.size_bytes == len(bucket.files[photo.storage_path])
        assert photo.uploaded_at is not None
        Image.open(BytesIO(bucket.files[photo.storage_path])).verify()


def test_request_without_photos_is_still_accepted(db, client, unit, bucket):
    assert submit(client, unit).status_code == 201
    assert count(db, MaintenanceRequest) == 1
    assert bucket.files == {}


def test_repeat_submit_does_not_upload_again(db, client, unit, bucket):
    key = uuid4().hex
    first = submit(client, unit, [image_bytes()], key)
    second = submit(client, unit, [image_bytes()], key)

    assert second.status_code == 201
    assert second.json() == first.json()
    assert bucket.uploads == 1
    assert count(db, Photo) == 1


def test_filled_honeypot_does_not_touch_images(db, client, unit, bucket):
    response = submit(client, unit, [b"not an image"], website="https://spam.example")

    assert response.status_code == 201
    assert_nothing_saved(db, bucket)


def test_unit_limit_is_checked_before_images(client, unit, bucket, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_unit_per_hour", 0)
    assert submit(client, unit, [b"not an image"]).status_code == 429


def test_closed_form_is_checked_before_images(db, client, unit, bucket, monkeypatch):
    monkeypatch.setattr(settings, "public_form_enabled", False)

    assert submit(client, unit, [image_bytes()]).json()["error"]["code"] == "form_closed"
    assert_nothing_saved(db, bucket)


def test_invalid_json_returns_422_without_echoing_it(client):
    response = client.post(
        "/api/public/requests",
        data={"data": "SECRET{"},
        headers={"Idempotency-Key": uuid4().hex},
    )

    assert response.status_code == 422
    assert "SECRET" not in response.text


# T49, T50


def force_commit_failure(db, monkeypatch) -> None:
    def failing_commit():
        raise OperationalError("COMMIT", {}, Exception("database went away"))

    monkeypatch.setattr(db, "commit", failing_commit)


def test_database_failure_leaves_no_request_and_no_files(db, client, unit, bucket, monkeypatch):
    force_commit_failure(db, monkeypatch)

    response = submit(client, unit, [image_bytes(), image_bytes()])

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Something went wrong"}
    }
    assert bucket.uploads == 2
    assert_nothing_saved(db, bucket)


def test_storage_down_leaves_no_request(db, caplog, client, unit, bucket):
    bucket.fail_uploads_after = 0

    response = submit(client, unit, [image_bytes()])

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "service_unavailable",
            "message": "Could not save your photos, please call the office",
        }
    }
    assert "photo upload failed" in caplog.text
    assert_nothing_saved(db, bucket)


def test_storage_failing_midway_removes_the_files_already_uploaded(db, client, unit, bucket):
    bucket.fail_uploads_after = 2

    assert submit(client, unit, [image_bytes()] * 3).status_code == 503

    assert bucket.uploads == 2
    assert_nothing_saved(db, bucket)


def test_invalid_image_among_good_ones_leaves_no_request(db, client, unit, bucket):
    response = submit(client, unit, [image_bytes(), b"not an image"])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["fields"][0]["field"] == "body.photos.1"
    assert bucket.uploads == 0
    assert_nothing_saved(db, bucket)


def test_failed_cleanup_is_logged_and_left_for_the_report(
    db, caplog, client, unit, bucket, monkeypatch
):
    force_commit_failure(db, monkeypatch)
    bucket.fail_deletes = True

    assert submit(client, unit, [image_bytes()]).status_code == 500

    assert count(db, MaintenanceRequest) == 0
    assert "could not delete photo file" in caplog.text
    assert find_orphans(db) == list(bucket.files)


def test_failed_submit_can_be_retried_with_the_same_key(db, client, unit, bucket):
    key = uuid4().hex
    bucket.fail_uploads_after = 0
    assert submit(client, unit, [image_bytes()], key).status_code == 503

    bucket.fail_uploads_after = None
    assert submit(client, unit, [image_bytes()], key).status_code == 201
    assert count(db, MaintenanceRequest) == 1
    assert count(db, Photo) == 1


# T51


def test_report_lists_a_planted_orphan_and_nothing_else(db, client, unit, bucket):
    submit(client, unit, [image_bytes()])
    assert find_orphans(db) == []

    bucket.files["requests/999/planted.jpg"] = b"x"

    assert find_orphans(db) == ["requests/999/planted.jpg"]
    assert "requests/999/planted.jpg" in bucket.files
