"""Общий хелпер для загрузки изображений на сервер.

Инкапсулирует валидацию расширения/размера и сохранение файла в подкаталог
``UPLOAD_DIR/<subdir>``. Используется endpoint-ами для аватарок, фото
мотоциклов, мероприятий и мотосправки — чтобы правила и тексты ошибок
были одинаковыми.
"""
from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# HEIC/HEIF — стандартный формат iPhone. Отдельно ловим и показываем
# внятную подсказку пользователю.
HEIC_EXTENSIONS = {".heic", ".heif"}
MAX_IMAGE_SIZE = 16 * 1024 * 1024  # 16 MB


async def save_uploaded_image(file: UploadFile, subdir: str) -> str:
    """Сохранить загруженное изображение и вернуть относительный URL.

    :param file: файл из FastAPI (``File(...)``).
    :param subdir: подкаталог внутри ``UPLOAD_DIR`` (например, ``"avatars"``).
    :return: URL вида ``"/media/<subdir>/<name>"``.
    """
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext in HEIC_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Формат HEIC/HEIF не поддерживается. На iPhone включите "
                "«Настройки → Камера → Форматы → Наиболее совместимый», "
                "либо выберите фото и сохраните его как JPEG."
            ),
        )
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Неподдерживаемый формат. Разрешены: "
                + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS))
            ),
        )

    data = await file.read(MAX_IMAGE_SIZE + 1)
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Файл слишком большой (максимум "
                f"{MAX_IMAGE_SIZE // (1024 * 1024)} МБ)"
            ),
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл пуст",
        )

    upload_dir = Path(settings.UPLOAD_DIR) / subdir
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{secrets.token_urlsafe(16)}{ext}"
    dest = upload_dir / unique_name
    dest.write_bytes(data)

    return f"/media/{subdir}/{unique_name}"
