#!/usr/bin/env bash
# =========================================================================
# Обновление уже задеплоенного Moto39Team до последней версии из git.
# Запускается автоматически из deploy/deploy.sh или вручную на сервере:
#     bash deploy/update.sh
# =========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

log() { echo -e "\n\033[1;34m▶ $*\033[0m"; }

log "1/4  git fetch && git pull"
git fetch --all --prune
git pull --ff-only

log "2/4  Пересобираю и перезапускаю backend (docker compose)"
docker compose up -d --build
# Миграции применяются автоматически (см. command в docker-compose.yml),
# но на всякий случай явно дожмём их, если контейнер уже был запущен:
docker compose exec -T api alembic upgrade head || true

log "3/4  Собираю frontend"
cd frontend
npm ci
npm run build
cd ..

log "4/4  Перечитываю nginx"
if command -v sudo >/dev/null 2>&1; then
    sudo nginx -t && sudo systemctl reload nginx
else
    nginx -t && systemctl reload nginx
fi

echo -e "\n\033[1;32m✔ Обновление завершено.\033[0m"
