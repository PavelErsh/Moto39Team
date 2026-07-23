.PHONY: install run dev lint format test migrate makemigrations stamp \
        create-admin make-admin list-users \
        docker-up docker-down front-install front-dev front-build front-lint \
        deploy deploy-setup


# ---------- Backend ----------

install:
	pip install -r requirements.txt

run:
	uvicorn app.main:app --host 0.0.0.0 --port 8000

dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

lint:
	ruff check .
	black --check .

format:
	ruff check . --fix
	black .

test:
	pytest -v

makemigrations:
	alembic revision --autogenerate -m "$(m)"

migrate:
	alembic upgrade head

downgrade:
	alembic downgrade -1

# Пометить текущую БД как применённую до указанной ревизии
# (полезно, если БД уже была создана вручную/через create_all).
# Пример: make stamp rev=head
stamp:
	alembic stamp $(rev)

# ---------- Admin ----------

# make create-admin email=admin@example.com username=admin password=Secret123!
create-admin:
	python -m app.cli create-admin --email $(email) --username $(username) --password $(password)

# make make-admin username=Ershov     или    make make-admin email=x@y.z
make-admin:
	python -m app.cli make-admin $(if $(username),--username $(username),--email $(email))

list-users:
	python -m app.cli list-users


docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

# ---------- Frontend (React + Vite) ----------

front-install:
	cd frontend && npm install

front-dev:
	cd frontend && npm run dev

front-build:
	cd frontend && npm run build

front-lint:
	cd frontend && npm run lint

# ---------- Deploy ----------
# Первичная установка на сервер (docker, nginx, node, SSL и т.д.).
# Требует настроенного файла deploy/deploy.env
# (создать: cp deploy/env.example deploy/deploy.env).
deploy-setup:
	./deploy/deploy.sh --setup

# Обновление уже задеплоенного проекта: git pull + пересборка backend/frontend.
# Одна команда — и последняя версия на сервере.
deploy:
	./deploy/deploy.sh
