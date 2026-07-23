#!/usr/bin/env bash
# =========================================================================
# Одна команда деплоя: подключается к серверу по SSH и обновляет проект.
#
# При первом запуске (или с флагом --setup) на сервере выполняется
# полная установка: docker, nginx, node, клонирование, SSL и т.д.
# Все последующие запуски — просто git pull + пересборка (update.sh).
#
# Использование:
#     ./deploy/deploy.sh              # обычное обновление
#     ./deploy/deploy.sh --setup      # первичная установка
#     make deploy                     # то же самое, что и без флагов
#     make deploy-setup               # то же самое, что --setup
#
# Конфигурация — в deploy/deploy.env (создать из deploy/env.example).
# =========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/deploy.env"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "❌ Не найден ${ENV_FILE}"
    echo "   Создайте его:"
    echo "       cp deploy/env.example deploy/deploy.env"
    echo "       nano deploy/deploy.env"
    exit 1
fi

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

: "${SERVER_HOST:?SERVER_HOST не задан в deploy/deploy.env}"
: "${SERVER_USER:?SERVER_USER не задан в deploy/deploy.env}"
: "${SERVER_PROJECT_DIR:?SERVER_PROJECT_DIR не задан в deploy/deploy.env}"
SERVER_PORT="${SERVER_PORT:-22}"

MODE="update"
if [[ "${1:-}" == "--setup" ]]; then
    MODE="setup"
fi

SSH_OPTS=(-p "${SERVER_PORT}" -o StrictHostKeyChecking=accept-new)
SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"

log() { echo -e "\n\033[1;34m▶ $*\033[0m"; }

# --- Проверка, установлен ли уже проект на сервере ----------------------
if [[ "${MODE}" == "update" ]]; then
    if ! ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" \
            "test -d '${SERVER_PROJECT_DIR}/.git'" 2>/dev/null; then
        echo "ℹ Проект на сервере ещё не установлен — переключаюсь на --setup."
        MODE="setup"
    fi
fi

# =========================================================================
if [[ "${MODE}" == "setup" ]]; then
    log "Первичная установка на ${SERVER_HOST}"

    # 1. Заливаем deploy/ на сервер во временный каталог.
    log "Копирую deploy/ на сервер"
    ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "mkdir -p /tmp/moto39team-bootstrap"
    scp -P "${SERVER_PORT}" -r \
        "${SCRIPT_DIR}"/*.sh \
        "${SCRIPT_DIR}"/deploy.env \
        "${SCRIPT_DIR}"/nginx \
        "${SSH_TARGET}:/tmp/moto39team-bootstrap/"

    # 2. Запускаем setup-server.sh под sudo.
    log "Запускаю setup-server.sh на сервере (может занять несколько минут)"
    # shellcheck disable=SC2087
    ssh -t "${SSH_OPTS[@]}" "${SSH_TARGET}" bash <<EOF
        set -e
        # Переносим deploy.env туда, откуда его прочитает setup-server.sh
        # (setup-server.sh ищет deploy.env рядом с собой).
        chmod +x /tmp/moto39team-bootstrap/*.sh
        sudo bash /tmp/moto39team-bootstrap/setup-server.sh
EOF
    echo -e "\n\033[1;32m✔ Первичная установка завершена.\033[0m"
    echo "  Открой: https://${DOMAIN:-<домен>}"
    exit 0
fi

# =========================================================================
# Обычное обновление
log "Обновляю ${SERVER_PROJECT_DIR} на ${SERVER_HOST}"
ssh -t "${SSH_OPTS[@]}" "${SSH_TARGET}" bash <<EOF
    set -e
    cd '${SERVER_PROJECT_DIR}'
    bash deploy/update.sh
EOF

echo -e "\n\033[1;32m✔ Deploy завершён.\033[0m"
