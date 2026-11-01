"""The private photo bucket, through the S3 API. The keys stay on the server."""

import logging
from collections.abc import Iterable, Iterator
from functools import lru_cache

import boto3
from botocore.config import Config

from app.settings import settings

logger = logging.getLogger(__name__)


@lru_cache
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint_url,
        aws_access_key_id=settings.storage_access_key_id,
        aws_secret_access_key=settings.storage_secret_access_key,
        region_name=settings.storage_region,
        # Timeouts are short because a submit holds a database connection while it uploads.
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=5,
            read_timeout=30,
            retries={"total_max_attempts": 2},
        ),
    )


def upload(path: str, content: bytes, content_type: str) -> None:
    _client().put_object(
        Bucket=settings.storage_bucket, Key=path, Body=content, ContentType=content_type
    )


def delete(path: str) -> None:
    _client().delete_object(Bucket=settings.storage_bucket, Key=path)


def delete_quietly(paths: Iterable[str]) -> None:
    """For cleaning up after a failure, so one bad delete cannot hide the original error."""
    for path in paths:
        try:
            delete(path)
        except Exception:
            # The orphan report (app.photos.report) picks up whatever is left.
            logger.exception("could not delete photo file %s", path)


def signed_url(path: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.storage_bucket, "Key": path},
        ExpiresIn=settings.signed_url_seconds,
    )


def list_paths() -> Iterator[str]:
    pages = _client().get_paginator("list_objects_v2").paginate(Bucket=settings.storage_bucket)
    for page in pages:
        for item in page.get("Contents", []):
            yield item["Key"]
