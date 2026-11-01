from dataclasses import dataclass
from io import BytesIO
from typing import BinaryIO

from fastapi import UploadFile
from fastapi.exceptions import RequestValidationError
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

MAX_PHOTOS = 5
MAX_PHOTO_BYTES = 10 * 1024 * 1024
# Only these parsers run, so the real file type decides and the name or stated type never does.
# Pillow's decompression bomb check stays on, and raises while opening or loading.
_ACCEPTED_FORMATS = ("JPEG", "PNG", "HEIF")


@dataclass
class CleanPhoto:
    content: bytes
    content_type: str
    extension: str


def clean_image(file: BinaryIO) -> CleanPhoto:
    """Re-encodes from pixels only, which drops EXIF (including GPS) and anything else attached."""
    with Image.open(file, formats=_ACCEPTED_FORMATS) as image:
        is_png = image.format == "PNG"
        # Before EXIF goes, or phone photos end up sideways.
        upright = ImageOps.exif_transpose(image)
        mode = "RGBA" if is_png and upright.has_transparency_data else "RGB"
        clean = upright.convert(mode)
    clean.info.clear()

    output = BytesIO()
    if is_png:
        clean.save(output, format="PNG", optimize=True)
        return CleanPhoto(output.getvalue(), "image/png", "png")
    # HEIC becomes JPEG too, because most browsers cannot show HEIC to staff.
    clean.save(output, format="JPEG", quality=85)
    return CleanPhoto(output.getvalue(), "image/jpeg", "jpg")


def clean_uploads(uploads: list[UploadFile]) -> list[CleanPhoto]:
    if len(uploads) > MAX_PHOTOS:
        message = f"At most {MAX_PHOTOS} photos are allowed"
        raise RequestValidationError([{"loc": ("body", "photos"), "msg": message}])

    photos, errors = [], []
    for index, upload in enumerate(uploads):
        loc = ("body", "photos", index)
        if upload.size is None or upload.size > MAX_PHOTO_BYTES:
            errors.append({"loc": loc, "msg": "Each photo must be 10 MB or smaller"})
            continue
        try:
            photos.append(clean_image(upload.file))
        except Exception:
            # Decoders raise many types on hostile or corrupt files, and all of them mean the same.
            errors.append({"loc": loc, "msg": "Photos must be JPG, PNG, or HEIC images"})
    if errors:
        raise RequestValidationError(errors)
    return photos
