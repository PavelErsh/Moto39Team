#!/usr/bin/env bash
# =========================================================================
# Первичная установка Moto39Team на чистый Ubuntu-сервер (22.04 / 24.04).
#
# Что делает:
#   1. Устанавливает системные пакеты (docker, nginx, node 20, certbot, ...)
#   2. Клонирует репозиторий в SERVER_PROJECT_DIR
#   3. Создаёт .env (из .env.example) со сгенерированным SECRET_KEY
#   4. Поднимает backend через docker compose (миграции + api)
#   5. Собирает фронтенд (npm ci + npm run build)
#   6. Прописывает nginx-конфиг и получает Let's Encrypt-сертификат
#
# Запуск: скрипт запускается автоматически из deploy/deploy.sh с ключом
# --setup (при первом деплое), либо руками на сервере:
#     sudo bash deploy/setup-server.sh
# =========================================================================
set -euo pipefail

# ── Загрузить конфиг деплоя ────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/deploy.env"

if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${ENV_FILE}"; set +a
fi

: "${SERVER_PROJECT_DIR:?SERVER_PROJECT_DIR не задан (см. deploy/deploy.env)}"
: "${DOMAIN:?DOMAIN не задан (см. deploy/deploy.env)}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL не задан (см. deploy/deploy.env)}"
: "${GIT_REPO:?GIT_REPO не задан (см. deploy/deploy.env)}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DOMAIN_WWW="${DOMAIN_WWW:-}"

# Требуется sudo/root.
if [[ $EUID -ne 0 ]]; then
    echo "❌ Запустите скрипт под root: sudo bash $0"
    exit 1
fi

# Кто владелец каталога проекта (обычный юзер, если запуск через sudo).
OWNER_USER="${SUDO_USER:-root}"

log() { echo -e "\n\033[1;34m▶ $*\033[0m"; }

# ────────────────────────────────────────────────────────────────────────
log "1/6  Устанавливаю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates curl git ufw nginx \
    certbot python3-certbot-nginx \
    gnupg lsb-release

# --- Docker (официальный репозиторий) -----------------------------------
if ! command -v docker >/dev/null 2>&1; then
    log "   • Ставлю Docker Engine"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io \
                       docker-buildx-plugin docker-compose-plugin
fi
# Разрешаем OWNER_USER работать с docker без sudo.
usermod -aG docker "${OWNER_USER}" || true

# --- Node.js 20 ---------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ $(node -v | sed 's/v//;s/\..*//') -lt 20 ]]; then
    log "   • Ставлю Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# ────────────────────────────────────────────────────────────────────────
log "2/6  Настраиваю firewall (ufw)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
yes | ufw enable >/dev/null || true

# ────────────────────────────────────────────────────────────────────────
log "3/6  Клонирую репозиторий в ${SERVER_PROJECT_DIR}"
mkdir -p "$(dirname "${SERVER_PROJECT_DIR}")"
chown "${OWNER_USER}:${OWNER_USER}" "$(dirname "${SERVER_PROJECT_DIR}")"

if [[ ! -d "${SERVER_PROJECT_DIR}/.git" ]]; then
    sudo -u "${OWNER_USER}" git clone --branch "${GIT_BRANCH}" \
        "${GIT_REPO}" "${SERVER_PROJECT_DIR}"
else
    echo "   • Репозиторий уже склонирован — пропускаю"
fi
cd "${SERVER_PROJECT_DIR}"

# ────────────────────────────────────────────────────────────────────────
log "4/6  Готовлю .env для backend"
if [[ ! -f "${SERVER_PROJECT_DIR}/.env" ]]; then
    SECRET_KEY_GEN=$(openssl rand -hex 32)
    POSTGRES_PASSWORD_GEN=$(openssl rand -hex 16)
    CORS="https://${DOMAIN}"
    [[ -n "${DOMAIN_WWW}" ]] && CORS="${CORS},https://${DOMAIN_WWW}"

    # Генерируем VAPID-ключи для Web Push-уведомлений (PWA)
    VAPID_PRIVATE_PEM=$(mktemp)
    openssl ecparam -genkey -name prime256v1 -out "${VAPID_PRIVATE_PEM}" 2>/dev/null
    VAPID_PRIVATE_KEY_GEN=$(openssl ec -in "${VAPID_PRIVATE_PEM}" -outform DER 2>/dev/null \
        | base64 | tr -d '\n' | tr '/+' '_-' | tr -d '=')
    rm -f "${VAPID_PRIVATE_PEM}"

    cat > "${SERVER_PROJECT_DIR}/.env" <<EOF
# Сгенерировано deploy/setup-server.sh на $(date -Iseconds)
APP_NAME=Moto39Team
APP_ENV=production
DEBUG=False

POSTGRES_USER=postgres
POSTGRES_PASSWORD=${POSTGRES_PASSWORD_GEN}
POSTGRES_DB=moto39team

DATABASE_URL=postgresql+asyncpg://postgres:${POSTGRES_PASSWORD_GEN}@db:5432/moto39team

SECRET_KEY=${SECRET_KEY_GEN}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
REFRESH_TOKEN_EXPIRE_DAYS=7

CORS_ORIGINS=${CORS}
CORS_ORIGIN_REGEX=

UPLOAD_DIR=uploads

VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY_GEN}
VAPID_CLAIMS_EMAIL=mailto:${LETSENCRYPT_EMAIL}
EOF
    chown "${OWNER_USER}:${OWNER_USER}" "${SERVER_PROJECT_DIR}/.env"
    chmod 600 "${SERVER_PROJECT_DIR}/.env"
    echo "   • .env создан, ключи сгенерированы"
else
    echo "   • .env уже существует — не перезаписываю"
fi

# frontend/.env — по умолчанию оставляем VITE_API_URL закомментированным
# (фронт ходит по относительному /api/v1 — через nginx на тот же домен).
if [[ ! -f "${SERVER_PROJECT_DIR}/frontend/.env" ]]; then
    cp "${SERVER_PROJECT_DIR}/frontend/.env.example" \
       "${SERVER_PROJECT_DIR}/frontend/.env"
    chown "${OWNER_USER}:${OWNER_USER}" "${SERVER_PROJECT_DIR}/frontend/.env"
fi

# ────────────────────────────────────────────────────────────────────────
log "5/6  Поднимаю backend (docker compose) + собираю frontend"
cd "${SERVER_PROJECT_DIR}"

sudo -u "${OWNER_USER}" -H bash -lc "
    set -e
    cd '${SERVER_PROJECT_DIR}'
    docker compose up -d --build
    cd frontend
    npm ci
    npm run build
"

# ────────────────────────────────────────────────────────────────────────
log "6/6  Настраиваю Nginx + HTTPS"
mkdir -p /var/www/certbot

NGINX_TEMPLATE="${SERVER_PROJECT_DIR}/deploy/nginx/moto39team.conf.template"
NGINX_CONF="/etc/nginx/sites-available/moto39team"

SERVER_NAMES="${DOMAIN}"
[[ -n "${DOMAIN_WWW}" ]] && SERVER_NAMES="${DOMAIN} ${DOMAIN_WWW}"

sed \
    -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__DOMAIN_WWW__|${DOMAIN_WWW}|g" \
    -e "s|__PROJECT_DIR__|${SERVER_PROJECT_DIR}|g" \
    "${NGINX_TEMPLATE}" > "${NGINX_CONF}"

ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/moto39team
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

# --- Let's Encrypt ------------------------------------------------------
CERTBOT_ARGS=(-d "${DOMAIN}")
[[ -n "${DOMAIN_WWW}" ]] && CERTBOT_ARGS+=(-d "${DOMAIN_WWW}")

if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    log "   • Получаю SSL-сертификат Let's Encrypt"
    certbot --nginx "${CERTBOT_ARGS[@]}" \
        --agree-tos --redirect --no-eff-email \
        -m "${LETSENCRYPT_EMAIL}" --non-interactive
else
    echo "   • Сертификат уже существует — пропускаю"
fi

systemctl reload nginx

# ────────────────────────────────────────────────────────────────────────
echo -e "\n\033[1;32m✔ Готово! Сайт доступен по адресу: https://${DOMAIN}\033[0m"
echo
echo "Следующие шаги:"
echo "  • Создать первого админа:"
echo "      cd ${SERVER_PROJECT_DIR} && \\"
echo "        docker compose exec api python -m app.cli create-admin \\"
echo "          --email admin@${DOMAIN} --username admin --password 'СильныйПароль!'"
echo
echo "  • Обновления в дальнейшем — одной командой с локальной машины:"
echo "      make deploy"
