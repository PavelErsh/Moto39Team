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

# Небольшая обёртка: sudo, если он есть; иначе просто выполняем как есть
# (например, когда скрипт уже запущен из-под root).
if command -v sudo >/dev/null 2>&1 && [[ $EUID -ne 0 ]]; then
    SUDO="sudo"
else
    SUDO=""
fi

log "1/4  git fetch && git pull"
git fetch --all --prune
git pull --ff-only

log "2/4  Пересобираю и перезапускаю backend (docker compose)"

# Если в .env ещё нет VAPID-ключей для push-уведомлений — сгенерируем и добавим
ENV_FILE="${PROJECT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
    if ! grep -q "^VAPID_PRIVATE_KEY=" "${ENV_FILE}" 2>/dev/null; then
        echo "   • Генерирую VAPID-ключи для Web Push…"
        VAPID_PRIVATE_PEM=$(mktemp)
        openssl ecparam -genkey -name prime256v1 -out "${VAPID_PRIVATE_PEM}" 2>/dev/null
        VAPID_PRIVATE_KEY_NEW=$(openssl ec -in "${VAPID_PRIVATE_PEM}" -outform DER 2>/dev/null \
            | base64 | tr -d '\n' | tr '/+' '_-' | tr -d '=')
        rm -f "${VAPID_PRIVATE_PEM}"
        # Подбираем email из существующего LETSENCRYPT_EMAIL или из .env
        VAPID_EMAIL="mailto:admin@moto39team.ru"
        if grep -q "^LETSENCRYPT_EMAIL=" "${PROJECT_DIR}/deploy/deploy.env" 2>/dev/null; then
            VAPID_EMAIL="mailto:$(grep "^LETSENCRYPT_EMAIL=" "${PROJECT_DIR}/deploy/deploy.env" | cut -d= -f2-)"
        fi
        cat >> "${ENV_FILE}" <<EOF

# VAPID-ключи для Web Push-уведомлений (автоматически сгенерированы update.sh)
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY_NEW}
VAPID_CLAIMS_EMAIL=${VAPID_EMAIL}
EOF
        echo "   • VAPID-ключи добавлены в .env"
    fi
fi

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

# Подхватываем DOMAIN / DOMAIN_WWW / LETSENCRYPT_EMAIL из deploy.env,
# если он есть на сервере; иначе — вытаскиваем DOMAIN из уже установленного
# конфига (обратная совместимость).
if [[ -f "${DEPLOY_ENV}" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${DEPLOY_ENV}"; set +a
fi

if [[ -f "${NGINX_CONF}" ]]; then
    DOMAIN="${DOMAIN:-$(awk '/^\s*server_name /{print $2; exit}' "${NGINX_CONF}" | tr -d ';')}"
    DOMAIN_WWW="${DOMAIN_WWW:-$(awk '/^\s*server_name /{print $3; exit}' "${NGINX_CONF}" | tr -d ';')}"
else
    DOMAIN="${DOMAIN:-}"
    DOMAIN_WWW="${DOMAIN_WWW:-}"
fi

CONFIG_CHANGED=0
if [[ -f "${NGINX_TEMPLATE}" && -n "${DOMAIN}" ]]; then
    TMP_CONF="$(mktemp)"
    sed \
        -e "s|__DOMAIN__|${DOMAIN}|g" \
        -e "s|__DOMAIN_WWW__|${DOMAIN_WWW}|g" \
        -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
        "${NGINX_TEMPLATE}" > "${TMP_CONF}"

    # Если файла ещё нет ИЛИ он отличается от шаблона — раскатываем шаблон.
    # ВНИМАНИЕ: если у нас уже есть HTTPS-конфиг от certbot, шаблон (только
    # HTTP-блок) его затрёт. Ниже, если найдём Let's Encrypt-сертификат, мы
    # снова прогоним `certbot --nginx`, чтобы он навесил HTTPS-блок и редирект.
    if [[ ! -f "${NGINX_CONF}" ]] || ! cmp -s "${TMP_CONF}" "${NGINX_CONF}"; then
        echo "   • Обновляю ${NGINX_CONF} из шаблона"
        ${SUDO} cp "${TMP_CONF}" "${NGINX_CONF}"
        ${SUDO} ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/moto39team
        CONFIG_CHANGED=1
    else
        echo "   • Nginx-конфиг без изменений"
    fi
    rm -f "${TMP_CONF}"
elif [[ ! -f "${NGINX_TEMPLATE}" ]]; then
    echo "   • Шаблон ${NGINX_TEMPLATE} не найден — пропускаю обновление конфига"
else
    echo "   • Не удалось определить DOMAIN — пропускаю обновление конфига"
fi

# --- Восстанавливаем HTTPS после регенерации конфига --------------------
# Наш шаблон содержит только HTTP-блок. Certbot ранее добавлял в конфиг
# `listen 443 ssl`, `ssl_certificate ...` и редирект 80→443. Если мы
# только что перекатили конфиг из шаблона — этих строк там больше нет,
# и сайт перестаёт открываться по HTTPS (браузеры с HSTS вообще падают).
#
# Если для DOMAIN уже выпущен сертификат, просим certbot ещё раз
# отредактировать nginx-конфиг (`--nginx --reinstall`). Это идемпотентно.
if [[ ${CONFIG_CHANGED} -eq 1 && -n "${DOMAIN}" \
      && -d "/etc/letsencrypt/live/${DOMAIN}" ]] \
   && command -v certbot >/dev/null 2>&1; then
    echo "   • Восстанавливаю HTTPS через certbot --nginx"
    CERTBOT_ARGS=(-d "${DOMAIN}")
    [[ -n "${DOMAIN_WWW}" ]] && CERTBOT_ARGS+=(-d "${DOMAIN_WWW}")
    ${SUDO} certbot --nginx "${CERTBOT_ARGS[@]}" \
        --reinstall --redirect --non-interactive \
        ${LETSENCRYPT_EMAIL:+-m "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email} \
        || echo "   ⚠ certbot завершился с ошибкой — сайт может остаться на HTTP"
fi

${SUDO} nginx -t && ${SUDO} systemctl reload nginx

echo -e "\n\033[1;32m✔ Обновление завершено.\033[0m"
