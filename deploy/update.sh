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

log "4/4  Обновляю nginx-конфиг из шаблона и перезагружаю nginx"
# Пересобираем /etc/nginx/sites-available/moto39team из актуального шаблона
# в репозитории (deploy/nginx/moto39team.conf.template). Без этого правки
# конфига, приезжающие с git pull, никогда бы не доехали до прод-сервера.
NGINX_TEMPLATE="${PROJECT_DIR}/deploy/nginx/moto39team.conf.template"
NGINX_CONF="/etc/nginx/sites-available/moto39team"
DEPLOY_ENV="${SCRIPT_DIR}/deploy.env"

if [[ -f "${NGINX_TEMPLATE}" && -f "${NGINX_CONF}" ]]; then
    # Подхватываем DOMAIN / DOMAIN_WWW из deploy.env, если он есть на сервере;
    # иначе — вытаскиваем из уже установленного конфига (обратная совместимость).
    if [[ -f "${DEPLOY_ENV}" ]]; then
        # shellcheck disable=SC1090
        set -a; source "${DEPLOY_ENV}"; set +a
    fi
    DOMAIN="${DOMAIN:-$(awk '/^\s*server_name /{print $2; exit}' "${NGINX_CONF}" | tr -d ';')}"
    DOMAIN_WWW="${DOMAIN_WWW:-$(awk '/^\s*server_name /{print $3; exit}' "${NGINX_CONF}" | tr -d ';')}"

    if [[ -n "${DOMAIN}" ]]; then
        TMP_CONF="$(mktemp)"
        sed \
            -e "s|__DOMAIN__|${DOMAIN}|g" \
            -e "s|__DOMAIN_WWW__|${DOMAIN_WWW}|g" \
            -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
            "${NGINX_TEMPLATE}" > "${TMP_CONF}"

        if ! cmp -s "${TMP_CONF}" "${NGINX_CONF}"; then
            echo "   • Найдены изменения в nginx-шаблоне — обновляю ${NGINX_CONF}"
            if command -v sudo >/dev/null 2>&1; then
                sudo cp "${TMP_CONF}" "${NGINX_CONF}"
            else
                cp "${TMP_CONF}" "${NGINX_CONF}"
            fi
        else
            echo "   • Nginx-конфиг без изменений"
        fi
        rm -f "${TMP_CONF}"
    else
        echo "   • Не удалось определить DOMAIN — пропускаю обновление конфига"
    fi
fi

if command -v sudo >/dev/null 2>&1; then
    sudo nginx -t && sudo systemctl reload nginx
else
    nginx -t && systemctl reload nginx
fi

echo -e "\n\033[1;32m✔ Обновление завершено.\033[0m"
