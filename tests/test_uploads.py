"""Тесты общего хелпера загрузки изображений (app.api.v1._uploads)."""
from __future__ import annotations

import io

import pytest
from fastapi import HTTPException, UploadFile

from app.api.v1._uploads import _detect_extension, save_uploaded_image


def _make_upload(
    filename: str | None,
    content_type: str | None,
    content: bytes = b"fake",
) -> UploadFile:
    return UploadFile(
        filename=filename,
        file=io.BytesIO(content),
        headers={"content-type": content_type} if content_type else None,
    )


def test_detect_extension_from_filename():
    up = _make_upload("photo.PNG", "application/octet-stream")
    assert _detect_extension(up) == ".png"


def test_detect_extension_from_mime_when_filename_has_no_ext():
    up = _make_upload("blob", "image/jpeg")
    assert _detect_extension(up) == ".jpg"


def test_detect_extension_returns_empty_when_unknown():
    up = _make_upload("blob", "application/pdf")
    assert _detect_extension(up) == ""


def test_detect_extension_heic_from_mime():
    up = _make_upload("IMG_0001", "image/heic")
    assert _detect_extension(up) == ".heic"


@pytest.mark.asyncio
async def test_save_uploaded_image_accepts_blob_with_image_mime(
    tmp_path, monkeypatch,
):
    """Файл без расширения, но с корректным Content-Type: image/jpeg,
    должен успешно сохраниться (регрессия на 400 в /rides/upload-image)."""
    from app.core import config as _config

    monkeypatch.setattr(_config.settings, "UPLOAD_DIR", str(tmp_path))

    up = _make_upload("blob", "image/jpeg", content=b"\xff\xd8fake-jpeg-bytes")
    url = await save_uploaded_image(up, "rides")
    assert url.startswith("/media/rides/")
    assert url.endswith(".jpg")


@pytest.mark.asyncio
async def test_save_uploaded_image_rejects_unknown_type(tmp_path, monkeypatch):
    from app.core import config as _config

    monkeypatch.setattr(_config.settings, "UPLOAD_DIR", str(tmp_path))

    up = _make_upload("blob", "application/pdf", content=b"%PDF-1.4")
    with pytest.raises(HTTPException) as exc:
        await save_uploaded_image(up, "rides")
    assert exc.value.status_code == 400
