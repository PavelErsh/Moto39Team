# Moto39Team

Full-stack приложение мотосообщества:

- **Backend**: FastAPI + async SQLAlchemy + Alembic + JWT
- **Frontend**: React 19 + TypeScript + Vite + React Router
  (адаптивная вёрстка «mobile-first» с бургер-меню)

## ✨ Возможности

### Backend

- FastAPI + Pydantic v2
- Async SQLAlchemy 2.0 (SQLite для dev, PostgreSQL для prod)
- Миграции через Alembic (async-совместимые)
- **JWT-авторизация**: access + refresh токены, OAuth2 password flow
- Хеширование паролей bcrypt (passlib)
- CORS для React dev-сервера
- Линтер и форматтер: **ruff** + **black**
- Тесты: **pytest** + `httpx.AsyncClient`
- Docker + docker-compose (API + PostgreSQL)

### Frontend

- React 19 + TypeScript + Vite
- React Router v7 (SPA-навигация)
- Axios с interceptors для `Authorization: Bearer` и **автообновления
  access-токена** по refresh
- Контекст авторизации (`AuthContext`) и защищённые маршруты
- **Полностью адаптивный дизайн**: `container` с `clamp()`,
  сетка `auto-fit`, брейкпоинты 900px / 720px / 480px,
  бургер-меню на мобильных, `min-height: 100dvh`, шрифт inputs 16px
  (без нежелательного зума на iOS Safari)
- Тёмная тема с оранжевыми акцентами (мото-стиль)
- ESLint (typescript-eslint + react-hooks + react-refresh)

## 📁 Структура проекта

```
Moto39Team/
├── app/                          # ← FastAPI backend
│   ├── api/
│   │   ├── deps.py
│   │   ├── router.py             # /api/v1
│   │   └── v1/
│   │       ├── auth.py           # /auth/register|login|refresh|me
│   │       └── users.py          # /users/me, /users/{id}
│   ├── core/
│   │   ├── config.py             # pydantic-settings
│   │   └── security.py           # bcrypt + JWT helpers
│   ├── crud/user.py
│   ├── db/
│   │   ├── base.py               # DeclarativeBase
│   │   ├── base_all.py           # импорт моделей для Alembic
│   │   └── session.py            # AsyncSession, get_db
│   ├── models/user.py            # ORM
│   ├── schemas/                  # Pydantic v2
│   └── main.py                   # приложение + CORS
│
├── frontend/                     # ← React SPA
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts         # axios + JWT + auto-refresh
│   │   │   └── auth.ts           # register / login / me / update
│   │   ├── components/
│   │   │   ├── Layout.tsx        # header (с бургером) + footer
│   │   │   └── ProtectedRoute.tsx
│   │   ├── context/
│   │   │   └── AuthContext.tsx   # user, login, logout, register…
│   │   ├── pages/
│   │   │   ├── HomePage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   └── CabinetPage.tsx   # профиль + редактирование
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css             # адаптивные стили
│   ├── index.html
│   ├── .env.example              # VITE_API_URL
│   ├── vite.config.ts
│   ├── tsconfig*.json
│   ├── eslint.config.js
│   └── package.json
│
├── migrations/                   # Alembic
├── tests/                        # pytest
├── alembic.ini
├── docker-compose.yml
├── Dockerfile
├── Makefile
├── pyproject.toml                # ruff / black / pytest
├── requirements.txt
├── .env.example
└── README.md
```

## 🚀 Быстрый старт

### 1) Backend

Требуется **Python 3.11+**.

```bash
git clone https://github.com/PavelErsh/Moto39Team.git
cd Moto39Team

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Схема БД управляется ТОЛЬКО через Alembic — таблицы автоматически
# при старте больше не создаются. Применяем миграции:
alembic upgrade head

# Если БД уже была создана вручную (например, старой версией с create_all),
# просто пометьте её текущее состояние без выполнения SQL:
#   alembic stamp head

# Создать первого администратора (или повысить существующего до админа
# и/или сбросить пароль):
python -m app.cli create-admin \
    --email admin@example.com \
    --username admin \
    --password Secret123!

# Dev-сервер
uvicorn app.main:app --reload
```

### CLI-команды администратора

```bash
python -m app.cli list-users                          # список пользователей
python -m app.cli make-admin --username <login>       # выдать права админа
python -m app.cli revoke-admin --username <login>     # забрать права
python -m app.cli create-admin --email ... --username ... --password ...
```

Через Makefile:

```bash
make list-users
make make-admin username=Ershov
make create-admin email=admin@ex.com username=admin password=Secret123!
```


API поднимается на <http://localhost:8000>:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>

### 2) Frontend

Требуется **Node.js 20+**.

```bash
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:8000/api/v1
npm install
npm run dev
```

Открой <http://localhost:5173>.

> В `.env` (или `frontend/.env`) можно поменять `VITE_API_URL`, если API
> запущен по другому адресу. Порт `:5173` уже добавлен в CORS-белый
> список бэкенда.

### 3) Быстро одной командой (через Makefile)

```bash
make install        # python deps
make dev            # backend :8000 с автоперезагрузкой
# в другом терминале:
make front-install  # npm deps
make front-dev      # frontend :5173
```

## 📱 Адаптивность

Frontend спроектирован **mobile-first** и одинаково хорошо работает
на мобильных, планшетах и десктопах:

| Разрешение    | Что происходит                                            |
|---------------|-----------------------------------------------------------|
| **> 900px**   | Личный кабинет в две колонки (профиль + форма)            |
| **≤ 900px**   | Колонки схлопываются в одну                               |
| **≤ 720px**   | Шапка превращается в **бургер-меню** (fullscreen drawer)  |
| **≤ 480px**   | Кнопки CTA во всю ширину, `features` в один столбец, `meta` перестраивается |

Также учтено:

- `viewport-fit=cover` + `100dvh` — корректная высота на iOS/Android
- `font-size: 16px` у полей ввода → Safari не зумит при фокусе
- `-webkit-tap-highlight-color: transparent`
- `prefers-reduced-motion` — уменьшение анимаций

## 🐳 Запуск backend в Docker

```bash
docker compose up -d --build
```

Поднимутся:

- `db` — PostgreSQL 16 (только внутри docker-сети)
- `api` — FastAPI на <http://127.0.0.1:8000> (с автоприменением миграций)

Остановить:

```bash
docker compose down
```

## 🚢 Деплой на прод-сервер одной командой

В репозитории есть готовые скрипты в каталоге `deploy/`:

| Файл                                    | Что делает                                                             |
|-----------------------------------------|------------------------------------------------------------------------|
| `deploy/env.example`                    | Шаблон конфигурации (SSH-хост, домен, email для Let's Encrypt)         |
| `deploy/deploy.sh`                      | Точка входа: с локальной машины идёт по SSH и запускает setup/update   |
| `deploy/setup-server.sh`                | Первичная установка на чистый Ubuntu (docker, nginx, node, SSL, ...)   |
| `deploy/update.sh`                      | Обновление проекта: `git pull` + пересборка backend + frontend         |
| `deploy/nginx/moto39team.conf.template` | Nginx-конфиг: React SPA + прокси на FastAPI (`/api`, `/media`, `/docs`)|

### Требования к серверу

- **Ubuntu 22.04 / 24.04**, доступ по SSH.
- DNS вашего домена уже указывает A-записью на IP сервера.
- На сервере есть пользователь с правами `sudo` (например, `deploy`).

### Первый деплой (полная установка)

На **локальной машине** в корне проекта:

```bash
cp deploy/env.example deploy/deploy.env
nano deploy/deploy.env      # укажи SERVER_HOST, DOMAIN, LETSENCRYPT_EMAIL и т.д.

make deploy-setup
# или: ./deploy/deploy.sh --setup
```

Скрипт сам:

1. Установит docker + docker compose plugin, nginx, node 20, certbot.
2. Настроит firewall (`ufw`) — открыты `OpenSSH` и `Nginx Full`.
3. Склонирует репозиторий в `SERVER_PROJECT_DIR` (по умолчанию `/var/www/Moto39Team`).
4. Создаст `.env` с автоматически сгенерированными `SECRET_KEY` и паролем БД.
5. Поднимет backend через `docker compose` (миграции применятся автоматически).
6. Соберёт фронтенд (`npm ci && npm run build`).
7. Пропишет nginx-конфиг с проксированием `/api` и `/media` на FastAPI.
8. Получит SSL-сертификат Let's Encrypt и включит редирект HTTP → HTTPS.

После окончания открой `https://your-domain.ru` — сайт готов.

Первого администратора создать так:

```bash
ssh deploy@your-server-ip
cd /var/www/Moto39Team
docker compose exec api python -m app.cli create-admin \
    --email admin@your-domain.ru --username admin --password 'СильныйПароль!'
```

### Последующие релизы (одна команда)

Закоммитил изменения → запушил в `main` → на своей машине:

```bash
make deploy
# или: ./deploy/deploy.sh
```

Что произойдёт на сервере:

- `git pull` в каталоге проекта
- `docker compose up -d --build` (пересборка api, миграции)
- `npm ci && npm run build` (свежая статика фронта)
- `nginx -t && systemctl reload nginx`

Ошибок нет → в проде уже новая версия.

### Как это устроено

```
Интернет ──► Nginx (80/443)
                 ├── /                 → frontend/dist (React SPA)
                 ├── /api/…            → 127.0.0.1:8000  (FastAPI)
                 ├── /media/…          → 127.0.0.1:8000  (загруженные файлы)
                 └── /docs, /redoc, /openapi.json, /health → FastAPI
Docker:
  • moto39team-db   — PostgreSQL 16 (том pg_data)
  • moto39team-api  — uvicorn :8000 (слушает только localhost)
```

### Полезное

```bash
# Логи backend в реальном времени
ssh deploy@server 'cd /var/www/Moto39Team && docker compose logs -f api'

# Статус контейнеров
ssh deploy@server 'cd /var/www/Moto39Team && docker compose ps'

# Обновить только nginx-конфиг (после правки шаблона)
ssh deploy@server 'sudo cp /var/www/Moto39Team/deploy/nginx/moto39team.conf.template \
    /etc/nginx/sites-available/moto39team && sudo nginx -t && sudo systemctl reload nginx'
```

## 🔐 JWT-авторизация

Реализованы два типа токенов:

| Токен          | Живёт              | Назначение                              |
|----------------|--------------------|-----------------------------------------|
| `access_token` | 30 минут (default) | Авторизация запросов (`Bearer`)         |
| `refresh_token`| 7 дней (default)   | Получение новой пары токенов            |

Параметры настраиваются в `.env`:

```env
SECRET_KEY=change-me-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
```

Frontend хранит токены в `localStorage` (`moto39_access_token` /
`moto39_refresh_token`) и **автоматически обновляет** access-токен при
любом 401-ответе через axios-интерсептор
(`frontend/src/api/client.ts`).

### Пример работы с API вручную

```bash
# 1. Регистрация
curl -X POST http://localhost:8000/api/v1/auth/register \
     -H 'Content-Type: application/json' \
     -d '{
           "email": "user@example.com",
           "username": "user1",
           "password": "strongpass123",
           "full_name": "User One"
         }'

# 2. Логин (OAuth2 password flow — form-urlencoded!)
curl -X POST http://localhost:8000/api/v1/auth/login \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'username=user1&password=strongpass123'
# => { "access_token": "...", "refresh_token": "...", "token_type": "bearer" }

# 3. Защищённый эндпоинт
curl http://localhost:8000/api/v1/auth/me \
     -H 'Authorization: Bearer <ACCESS_TOKEN>'

# 4. Обновление токена
curl -X POST http://localhost:8000/api/v1/auth/refresh \
     -H 'Content-Type: application/json' \
     -d '{"refresh_token": "<REFRESH_TOKEN>"}'
```

## 📚 REST API

| Метод | Путь                        | Описание                              | Авторизация        |
|-------|-----------------------------|---------------------------------------|--------------------|
| GET   | `/`                         | Info                                  | нет                |
| GET   | `/health`                   | Health-check                          | нет                |
| POST  | `/api/v1/auth/register`     | Регистрация                           | нет                |
| POST  | `/api/v1/auth/login`        | Логин, выдаёт токены                  | нет                |
| POST  | `/api/v1/auth/refresh`      | Обновить пару токенов                 | нет                |
| GET   | `/api/v1/auth/me`           | Текущий пользователь                  | Bearer             |
| GET   | `/api/v1/users/me`          | Профиль текущего пользователя         | Bearer             |
| PATCH | `/api/v1/users/me`          | Обновить свой профиль                 | Bearer             |
| GET   | `/api/v1/users/{user_id}`   | Пользователь по id                    | Bearer (superuser) |

## 🖥 Маршруты фронтенда

| Путь         | Страница               | Требует авторизации |
|--------------|------------------------|---------------------|
| `/`          | Главная (лендинг)      | нет                 |
| `/register`  | Регистрация            | нет                 |
| `/login`     | Вход                   | нет                 |
| `/cabinet`   | Личный кабинет         | да                  |
| `/moto`      | Мой гараж              | да                  |
| `/riders`    | Райдеры                | да                  |
| `/u/:username` | Публичный профиль    | да                  |
| `/calendar`  | Мотокалендарь          | нет (просмотр всем) |
| `/admin`     | Админка                | только `is_superuser` |
| `/map`       | Карта                  | да                  |

### 📅 Мотокалендарь и админка

- `/calendar` — общий список мото-мероприятий (дата · название ·
  организатор · место). Доступен всем.
- `/admin` — раздел для администраторов (пользователей с флагом
  `is_superuser`). В нём две вкладки:
  - **Мероприятия** — добавление / редактирование / удаление событий
    календаря.
  - **Пользователи** — выдача и снятие прав администратора, блокировка /
    разблокировка (нельзя снять права/деактивировать самого себя).

REST-эндпоинты:

| Метод | Путь                                             | Доступ            |
|-------|--------------------------------------------------|-------------------|
| GET   | `/api/v1/events`                                 | все               |
| POST  | `/api/v1/events`                                 | admin             |
| PATCH | `/api/v1/events/{id}`                            | admin             |
| DELETE| `/api/v1/events/{id}`                            | admin             |
| GET   | `/api/v1/admin/users`                            | admin             |
| PATCH | `/api/v1/admin/users/{id}/superuser`             | admin             |
| PATCH | `/api/v1/admin/users/{id}/active`                | admin             |


## 🧪 Тесты и линтеры

```bash
# Backend
make test           # pytest
make lint           # ruff + black --check
make format         # автоформат

# Frontend
make front-lint     # eslint
make front-build    # проверка компиляции TypeScript + сборка
```

## 🗃️ Миграции Alembic

```bash
alembic revision --autogenerate -m "add something"
alembic upgrade head
alembic downgrade -1
```

## 🛠️ Все команды Makefile

```bash
# Backend
make install         # установить python-зависимости
make dev             # uvicorn с auto-reload
make run             # uvicorn без reload
make lint            # ruff + black --check
make format          # автоформат
make test            # pytest
make makemigrations m="..."  # новая миграция
make migrate         # применить миграции
make docker-up       # docker compose up
make docker-down     # docker compose down

# Frontend
make front-install   # npm install
make front-dev       # vite dev-сервер :5173
make front-build     # production-сборка в frontend/dist
make front-lint      # eslint
```

## 📱 Мобильное приложение (Capacitor) с фоновым GPS

Веб-версия шлёт координаты только пока страница «Карта» открыта в
браузере. Чтобы райдер продолжал светиться на карте даже с закрытым/
свёрнутым приложением, фронт можно собрать в нативную обёртку Capacitor
(Android + iOS) — она стартует фоновый geolocation-сервис сразу после
логина.

Как это работает под капотом:

- Плагин `@capacitor-community/background-geolocation` регистрирует
  watcher, который слушает GPS.
- На **Android** запускается foreground-service с постоянным
  уведомлением («MOTO39 · Трекинг активен»). Пока уведомление висит,
  ОС не убивает процесс и продолжает присылать координаты, даже когда
  приложение свёрнуто.
- На **iOS** используются significant-location-changes: система будит
  приложение при заметном перемещении и отдаёт координаты (в т.ч.
  после перезагрузки телефона).
- Каждая координата отправляется на существующий эндпоинт
  `POST /users/me/location`, а остальные райдеры видят её на «Карте»
  через `GET /users/locations`.
- Старт трекера привязан к `AuthContext`: он стартует, как только
  появляется авторизованный пользователь, и останавливается при
  логауте. На вебе `startBackgroundLocation()` — это no-op.

### Первичная настройка (один раз)

```bash
cd frontend
cp .env.example .env
# Обязательно укажите публичный URL API — capacitor:// не понимает /api/v1:
#   VITE_API_URL=https://moto39team.ru/api/v1
npm install
npm run build

# Добавляем нативные проекты (создадут папки frontend/android и frontend/ios)
npx cap add android
npx cap add ios      # только на macOS
npx cap sync
```

### Android: разрешения для фонового GPS

В `frontend/android/app/src/main/AndroidManifest.xml` внутри `<manifest>`
добавьте:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

### iOS: разрешения для фонового GPS

В `frontend/ios/App/App/Info.plist` добавьте описания и включите
Background Mode `location`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOTO39 показывает вашу позицию другим райдерам на карте.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>MOTO39 обновляет вашу позицию для друзей, даже когда приложение свёрнуто.</string>
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
</array>
```

### Запуск на устройстве

```bash
# После любых правок кода:
npm run build && npx cap sync

# Android (Android Studio + подключённый девайс/эмулятор):
npx cap open android    # или npm run cap:run:android

# iOS (Xcode на macOS):
npx cap open ios        # или npm run cap:run:ios
```

При первом запуске приложение спросит доступ к геолокации «Always». Если
пользователь его выдал, координаты уходят на сервер каждые ~30 секунд
(или сразу, если райдер сдвинулся более чем на ~20 м), даже когда
приложение свёрнуто или экран заблокирован.

## � Лицензия

MIT
