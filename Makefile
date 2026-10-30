# Developer commands. Run `make help` to list them.

API_URL           ?= http://localhost:3000
DATABASE_URL_TEST ?= postgres://invoices:invoices@localhost:5432/invoices_test

export DATABASE_URL_TEST

.PHONY: help setup install up down reset logs db dev healthcheck demo \
        test test-unit test-integration lint typecheck format build check clean

help: ## List the commands
	@grep -E '^[a-z-]+:.*## ' Makefile | awk -F':.*## ' '{printf "  \033[36m%-17s\033[0m %s\n", $$1, $$2}'

# ---- setup & run ---------------------------------------------------------------------------
setup: install ## Install dependencies and create .env from .env.example
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

install: ## Install dependencies
	yarn install --frozen-lockfile

up: ## Build and start API + PostgreSQL (Docker), waiting until healthy
	docker compose up --build -d --wait
	@echo "API on $(API_URL) · logs: make logs · try it: make demo"

down: ## Stop the containers
	docker compose down

reset: ## Stop the containers and wipe the database volume
	docker compose down -v

logs: ## Follow the API logs
	docker compose logs -f api

db: ## Start only PostgreSQL, waiting until healthy
	docker compose up -d --wait postgres

dev: db ## Run the API locally (PostgreSQL in Docker, simulated provider on)
	@test -f .env || (echo "missing .env: run make setup" && exit 1)
	set -a && . ./.env && set +a && SIMULATE_PROVIDER=true yarn start:dev

healthcheck: ## Call GET /health
	@curl -sS $(API_URL)/health && echo

demo: ## Register a new invoice and show it before and after the provider answers
	@KEY=$$(npx ts-node --transpile-only -e "import { generateAccessKey } from './test/support/access-keys'; console.log(generateAccessKey(Math.floor(Math.random() * 1e9)))"); \
	echo "POST /invoices { accessKey: $$KEY }"; \
	RES=$$(curl -sS -X POST $(API_URL)/invoices -H 'content-type: application/json' -d "{\"accessKey\":\"$$KEY\"}"); \
	echo "$$RES"; \
	ID=$$(echo "$$RES" | sed -E 's/.*"id":"([^"]+)".*/\1/'); \
	echo; echo "waiting 2s for the provider..."; sleep 2; \
	echo "GET /invoices/$$ID"; \
	curl -sS $(API_URL)/invoices/$$ID && echo; \
	echo; echo "POST again with the same key:"; \
	curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST $(API_URL)/invoices -H 'content-type: application/json' -d "{\"accessKey\":\"$$KEY\"}"

# ---- quality -------------------------------------------------------------------------------
test: db ## Run all tests (starts PostgreSQL if needed)
	yarn test

test-unit: ## Run unit tests (no database)
	yarn test:unit

test-integration: db ## Run integration tests (real PostgreSQL)
	yarn test:integration

lint: ## Lint the code
	yarn lint

typecheck: ## Type-check without emitting
	yarn typecheck

format: ## Format with Prettier
	yarn format

build: ## Compile TypeScript to dist/
	yarn build

check: lint typecheck test ## Run lint, typecheck and all tests (same as CI)

clean: ## Remove dist/ and coverage/
	rm -rf dist coverage
