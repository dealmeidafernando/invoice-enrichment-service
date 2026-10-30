# Invoice Enrichment Service

[![CI](https://github.com/dealmeidafernando/invoice-enrichment-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dealmeidafernando/invoice-enrichment-service/actions/workflows/ci.yml)

Intake and enrichment pipeline for Brazilian electronic invoices (NF-e), built as a technical challenge.

A client sends the 44-digit **access key** of an invoice. The invoice is born incomplete, in `ANALISE`. An external provider looks up the key and returns the CNPJ, the amount, the issue date and whether the invoice is canceled. Only then is the invoice approved or rejected. The service:

- validates the access key (44 digits, modulo 11 check digit) and stores the invoice in **`ANALISE`**
- never calls the provider inside the request: it stores the invoice and an **outbound message** in the same transaction (outbox)
- consumes the provider's **result message** and moves the invoice to **`APROVADA`** or **`REJEITADA`** with the reasons
- guarantees **one invoice per key**, even with concurrent requests
- processes each result **once**, even when the same message is delivered again

The provider is simulated, and the message queue is a PostgreSQL table with real redelivery. Every technical decision, with the options considered and why: [docs/adr](docs/adr/README.md). The tests required by the challenge and where each one is: [§5.1](#51-required-tests).

## Development

### Pre-requisites

| Tool                    | Version                  | Install                                                         |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| Node.js                 | 22+ (pinned in `.nvmrc`) | [nvm](https://github.com/nvm-sh/nvm) → `nvm install && nvm use` |
| Yarn                    | 1.22+                    | `npm install -g yarn`                                           |
| Docker + Docker Compose | Docker 24+, Compose v2+  | [Docker Desktop](https://docs.docker.com/get-docker/)           |
| Make                    | any                      | preinstalled on macOS/Linux                                     |

Stack: Node.js, NestJS 11, TypeScript, PostgreSQL 16, Docker.

---

## 1. Getting Started

### 1.1. Clone the project

```bash
git clone git@github.com:dealmeidafernando/invoice-enrichment-service.git
cd invoice-enrichment-service
```

### 1.2. Install and configure

```bash
make setup    # yarn install + creates .env from .env.example
```

`.env` only holds local development values; it is git-ignored. It is needed only to run the API outside Docker (`make dev`).

### 1.3. Run the application

With Docker (API + PostgreSQL, with the simulated provider turned on):

```bash
make up       # API on http://localhost:3000 · PostgreSQL on :5432
make logs     # follow the API logs
make down     # stop everything (make reset also wipes the database)
```

The API applies the database migrations on startup.

Or without Docker for the API (PostgreSQL still comes from compose):

```bash
make dev      # starts PostgreSQL, loads .env and runs the API with the simulated provider
```

### 1.4. Testing if it's okay

```bash
make healthcheck
```

```json
{ "status": "ok", "database": "ok" }
```

Then play the full flow with a fresh access key:

```bash
make demo
```

It registers the invoice (`202`, `"status":"ANALISE"`), waits two seconds for the simulated provider and reads it back as `APROVADA`, with CNPJ, amount, issue date and `approvedAt`. Then it sends the same key again and gets `200`.

The same by hand, with `curl`:

```bash
curl -i -X POST localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{"accessKey":"35261012345678000190550010000000000000000017"}'

curl localhost:3000/invoices/<id from the response>
```

To generate other valid keys, use `generateAccessKey(n)` in [`test/support/access-keys.ts`](test/support/access-keys.ts).

---

## 2. Make Commands

Run `make help` to list them all. Each one wraps a `yarn` or `docker compose` command, so they can also be run directly.

### 2.1. Main commands

|            Command | Execute                                                          |
| -----------------: | :--------------------------------------------------------------- |
|       `make setup` | Install dependencies and create `.env`                           |
|          `make up` | Build and start API + PostgreSQL (Docker), waiting until healthy |
|        `make down` | Stop the containers                                              |
|       `make reset` | Stop the containers and wipe the database volume                 |
|        `make logs` | Follow the API logs                                              |
|          `make db` | Start only PostgreSQL                                            |
|         `make dev` | Run the API locally against the PostgreSQL container             |
| `make healthcheck` | Call `GET /health`                                               |
|        `make demo` | Register a new invoice and show it before and after the provider |

### 2.2. Quality commands

|                 Command | Execute                                              |
| ----------------------: | :--------------------------------------------------- |
|             `make test` | Run all tests (starts PostgreSQL if needed)          |
|        `make test-unit` | Run unit tests (no database)                         |
| `make test-integration` | Run integration tests (starts PostgreSQL if needed)  |
|            `make check` | Lint, typecheck and all tests, the same checks as CI |
|             `make lint` | Lint the code                                        |
|        `make typecheck` | Type-check without emitting                          |
|           `make format` | Format with Prettier                                 |

### 2.3. Others

|      Command | Execute                                             |
| -----------: | :-------------------------------------------------- |
| `make build` | Compile TypeScript to `dist/` (with the migrations) |
| `make clean` | Remove `dist/` and `coverage/`                      |

---

## 3. API

| Route               | Response                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /invoices`    | `202` new invoice in `ANALISE` (with `Location`) · `200` key already registered: same invoice · `400` invalid key |
| `GET /invoices/:id` | `200` invoice · `404` unknown id · `400` id is not a UUID                                                         |
| `GET /health`       | `200` when the database answers · `503` otherwise                                                                 |

Request and response:

```bash
POST /invoices
{ "accessKey": "35261012345678000190550010000000000000000017" }
```

```json
{
  "id": "83377e99-adf5-429c-8020-bc6c354d417b",
  "accessKey": "35261012345678000190550010000000000000000017",
  "status": "APROVADA",
  "rejectionReasons": [],
  "cnpj": "12345678000190",
  "amount": "1520.75",
  "issuedAt": "2026-10-01T15:00:00.000Z",
  "canceled": false,
  "approvedAt": "2026-10-29T23:59:07.512Z",
  "createdAt": "2026-10-29T23:59:06.201Z"
}
```

An optional `x-correlation-id` header is propagated to the outbound message and to the logs. If it is missing, one is generated.

---

## 4. Invoice Flow

### 4.1. End to end

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as API
    participant DB as PostgreSQL
    participant R as Outbox relay
    participant Q as Queue (table)
    participant P as Provider (simulated)
    participant W as Result consumer

    C->>API: POST /invoices { accessKey }
    API->>API: validate key (44 digits, mod 11)
    alt invalid key
        API-->>C: 400 INVALID_ACCESS_KEY (nothing written)
    else valid key
        API->>DB: BEGIN
        API->>DB: INSERT invoice (ANALISE) ON CONFLICT (access_key) DO NOTHING
        alt key already registered
            API->>DB: COMMIT
            API-->>C: 200 same invoice (no new message)
        else new invoice
            API->>DB: INSERT outbox (invoice.enrichment.requested)
            API->>DB: COMMIT
            API-->>C: 202 { id, status: ANALISE }
        end
    end

    loop every POLL_INTERVAL_MS
        R->>DB: SELECT PENDING outbox rows FOR UPDATE SKIP LOCKED
        R->>Q: publish invoice.enrichment.requested
        alt publish fails
            R->>DB: keep PENDING, retry with backoff (invoice stays in ANALISE)
        else published
            R->>DB: mark PUBLISHED
        end
    end

    Q->>P: invoice.enrichment.requested { invoiceId, accessKey }
    P->>Q: invoice.enrichment.completed { accessKey, cnpj, amount, issueDate, canceled }

    loop every POLL_INTERVAL_MS
        W->>Q: claim delivery (SKIP LOCKED, visibility timeout)
        W->>W: validate contract
        alt malformed message
            W->>Q: DEAD (no retry, invoice unchanged)
        else valid message
            W->>DB: BEGIN
            W->>DB: SELECT invoice FOR UPDATE by accessKey
            alt unknown key
                W->>DB: COMMIT (nothing written)
            else invoice found
                W->>DB: INSERT processed_messages (messageId)
                alt messageId already processed (redelivery)
                    W->>DB: COMMIT (invoice unchanged)
                else new message
                    W->>W: apply result (domain rules)
                    W->>DB: UPDATE invoice to APROVADA or REJEITADA WHERE status = 'ANALISE'
                    W->>DB: COMMIT
                end
            end
            alt processing failed
                W->>Q: back to READY with backoff (redelivery), DEAD after max attempts
            else processed
                W->>Q: ack (DONE)
            end
        end
    end
```

### 4.2. Statuses

```mermaid
stateDiagram-v2
    [*] --> ANALISE: POST /invoices
    ANALISE --> APROVADA: CNPJ, amount and issue date present, not canceled
    ANALISE --> REJEITADA: canceled, or CNPJ / amount / issue date missing
    APROVADA --> [*]
    REJEITADA --> [*]
```

`APROVADA` and `REJEITADA` are terminal. The status values come from the business spec and are kept verbatim; everything else in the code is in English.

| Provider result                                   | Invoice     | Stored                                                          |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| CNPJ, amount and issue date present, not canceled | `APROVADA`  | provider data + `approvedAt`                                    |
| `canceled: true`                                  | `REJEITADA` | reason `INVOICE_CANCELED`                                       |
| CNPJ, amount or issue date missing (`null`)       | `REJEITADA` | `MISSING_CNPJ`, `MISSING_AMOUNT`, `MISSING_ISSUE_DATE`          |
| Same message delivered again                      | unchanged   | nothing (deduplicated by `messageId`)                           |
| Another result after the invoice was decided      | unchanged   | nothing (the first result wins)                                 |
| Unknown access key                                | —           | nothing, not even the inbox (the result never creates invoices) |

Every reason found is stored, not only the first one. Provider data is kept even on rejection, for auditing.

### 4.3. Message contracts

Both messages share one envelope. `messageId` is the identity of the message: a redelivery carries the same `messageId`, and that is what the consumer deduplicates on. Details: [ADR 0007](docs/adr/0007-contrato-das-mensagens.md).

```jsonc
{
  "messageId": "uuid",
  "type": "<topic>",
  "version": 1,
  "occurredAt": "2026-10-29T22:50:00.000Z",
  "correlationId": "uuid", // from the x-correlation-id header of the POST
  "payload": {},
}
```

**Outbound: `invoice.enrichment.requested`** (service → provider)

```json
{
  "invoiceId": "83377e99-adf5-429c-8020-bc6c354d417b",
  "accessKey": "35261012345678000190550010000000000000000017"
}
```

**Inbound: `invoice.enrichment.completed`** (provider → service)

```json
{
  "accessKey": "35261012345678000190550010000000000000000017",
  "cnpj": "12345678000190",
  "amount": "1520.75",
  "issueDate": "2026-10-01T12:00:00-03:00",
  "canceled": false
}
```

| Field       | Type           | Rule                                                                         |
| ----------- | -------------- | ---------------------------------------------------------------------------- |
| `accessKey` | string         | 44 digits with a valid check digit                                           |
| `cnpj`      | string \| null | 14 digits; punctuation is stripped                                           |
| `amount`    | string \| null | decimal with a dot, up to 2 places; a string so JSON does not lose precision |
| `issueDate` | string \| null | ISO 8601                                                                     |
| `canceled`  | boolean        | required                                                                     |

A `null` field is a valid result: the invoice is rejected with a reason. A malformed message (wrong type, unreadable date, unknown version) is a contract error: it goes to `DEAD` without retries and the invoice does not change.

---

## 5. Tests

Integration tests run against a real PostgreSQL ([ADR 0002](docs/adr/0002-testes-de-integracao-com-postgres-real.md)), in a separate `invoices_test` database created by compose:

| Command                 | Runs                                             |
| ----------------------- | ------------------------------------------------ |
| `make test`             | all tests                                        |
| `make test-unit`        | domain and message contract, no database         |
| `make test-integration` | full flow over HTTP, queue, outbox relay, schema |

`make test` and `make test-integration` start PostgreSQL if needed and set `DATABASE_URL_TEST`. Without Make:

```bash
docker compose up -d postgres
export DATABASE_URL_TEST=postgres://invoices:invoices@localhost:5432/invoices_test
yarn test
```

Run **one** test file, or one test by name (with `DATABASE_URL_TEST` set):

```bash
yarn jest test/integration/invoice-flow.spec.ts
yarn jest -t "delivered twice"
```

The background loops are turned off in tests: each test moves relay → provider → consumer by hand, so it is deterministic. The provider is simulated by [`FakeProvider`](src/infra/messaging/fake-provider.ts), which publishes the result message.

### 5.1. Required tests

Each item of "Nos testes, mostre" has a main end-to-end test (HTTP + PostgreSQL + queue) and a narrower test that complements it. In the code, they are marked with `// Required test N` and `// Complements required test N`:

```bash
grep -rni "required test" test
```

| #   | Item do enunciado                                         | Main test ([`invoice-flow.spec.ts`](test/integration/invoice-flow.spec.ts))                                                                            | Complement                                                                                                                                  |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a criação da nota em `ANALISE` e a mensagem de ida        | `stores the invoice in ANALISE, with no approval date…` · `writes the outbound message to the outbox in the same request…`                             | [`outbox-relay.spec.ts`](test/integration/outbox-relay.spec.ts): the relay publishes the outbox message to the queue                        |
| 2   | a aprovação só depois de um resultado completo            | `stays in ANALISE while the provider has not answered` · `moves to APROVADA with an approval date after a complete result`                             | [`invoice.entity.spec.ts`](test/unit/invoice.entity.spec.ts): approval rule, no database                                                    |
| 3   | a rejeição quando o resultado vem cancelado ou incompleto | `a canceled result moves to REJEITADA…` · `a result missing CNPJ / amount / issue date / everything…`                                                  | [`invoice.entity.spec.ts`](test/unit/invoice.entity.spec.ts): every combination of reasons                                                  |
| 4   | duas requisições com a mesma chave                        | `concurrent requests with the same key create one invoice and one outbound message` (10 requests with `Promise.all`) · `a second request returns 200…` | [`database.spec.ts`](test/integration/database.spec.ts): the `UNIQUE` constraint refuses a second invoice                                   |
| 5   | a mesma mensagem de volta entregue duas vezes             | `the same inbound message delivered twice changes the invoice only once` (same envelope republished) · `…delivered twice in parallel…`                 | [`table-queue.spec.ts`](test/integration/table-queue.spec.ts): the queue really delivers a message twice, and redelivers it after a failure |

### 5.2. Other rules covered

| Rule                                                     | Where                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Invalid access key: `400`, nothing written               | `invoice-flow.spec.ts` › creation · `access-key.spec.ts`                  |
| The result never creates an invoice (unknown key)        | `invoice-flow.spec.ts` › idempotent consumption                           |
| A second, different result is ignored (terminal status)  | `invoice-flow.spec.ts` › idempotent consumption                           |
| Publish failure neither loses nor approves the invoice   | `invoice-flow.spec.ts` › failures · `outbox-relay.spec.ts`                |
| Processing failure: redelivery approves the invoice once | `invoice-flow.spec.ts` › failures · `table-queue.spec.ts`                 |
| Malformed message goes to `DEAD`, invoice unchanged      | `invoice-flow.spec.ts` › failures · `enrichment-completed.parser.spec.ts` |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, typecheck, build and all tests against a PostgreSQL service, and builds the Docker image.

---

## 6. Project Structure

```
src/
├─ domain/          pure business rules: Invoice, AccessKey, Money, errors, repository interfaces
├─ application/     use cases (register, get, process result) + message contracts
├─ infra/
│  ├─ database/     pool, transactions, migrations
│  ├─ repositories/ PostgreSQL repositories (invoice, outbox, inbox)
│  ├─ messaging/    table queue, outbox relay, result consumer, simulated provider, workers
│  └─ http/         controllers, presenter, error filter
├─ main/            Nest module (composition root) and bootstrap
└─ shared/          environment config (validated with zod)
test/               unit/ · integration/ · support/
docs/adr/           architecture decision records
docker/             PostgreSQL init (creates the test database)
```

The domain imports neither NestJS nor `pg`, and ESLint enforces it. Why this layout: [ADR 0001](docs/adr/0001-arquitetura-em-camadas-simplificada.md).

---

## 7. Configuration

All settings come from environment variables, validated at startup ([`src/shared/config/env.ts`](src/shared/config/env.ts)). Start from `.env.example`; it holds local development values only, no secrets.

| Variable             | Default         | Description                                                         |
| -------------------- | --------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`       | none (required) | PostgreSQL connection string                                        |
| `PORT`               | `3000`          | HTTP port                                                           |
| `MIGRATE_ON_STARTUP` | `true`          | Apply pending migrations when the API starts                        |
| `WORKERS_ENABLED`    | `true`          | Run the outbox relay and the result consumer inside the API process |
| `SIMULATE_PROVIDER`  | `false`         | Run the simulated provider (compose turns it on for the demo)       |
| `POLL_INTERVAL_MS`   | `500`           | Interval between runs of each background loop                       |
| `QUEUE_MAX_ATTEMPTS` | `5`             | Deliveries before a message goes to `DEAD`                          |
| `BACKOFF_BASE_MS`    | `1000`          | Base of the exponential backoff for redelivery and outbox retries   |
| `DATABASE_URL_TEST`  | none            | Test database, used only by the integration tests                   |

---

## 8. Out of Scope, and Why

| Item                                                     | Why                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real broker (SQS, RabbitMQ, Kafka)                       | Out of scope by the challenge. A PostgreSQL table simulates it with real redelivery; swapping only touches `TableQueue`.                                                                                                                                              |
| Real provider integration                                | The challenge asks for a simulated provider.                                                                                                                                                                                                                          |
| Separate worker process                                  | Compose is API + PostgreSQL. `SKIP LOCKED` already makes several replicas safe; splitting is one flag away ([ADR 0008](docs/adr/0008-processo-unico-para-api-e-workers.md)).                                                                                          |
| Invoice stuck in `ANALISE` if the provider never answers | Needs a reconciliation job that re-sends the request. The data for it already exists (`created_at`, outbox).                                                                                                                                                          |
| Reprocessing `DEAD` messages                             | Manual today (SQL). A redrive command is missing.                                                                                                                                                                                                                     |
| Cleanup of outbox, queue and inbox tables                | A production job would delete old rows. Today they grow without bound.                                                                                                                                                                                                |
| Authentication, rate limiting                            | Outside the requested domain.                                                                                                                                                                                                                                         |
| OpenAPI / Swagger                                        | Three HTTP routes, documented in [§3](#3-api). The critical contracts are asynchronous ([§4.3](#43-message-contracts), [ADR 0007](docs/adr/0007-contrato-das-mensagens.md)), which OpenAPI does not describe; AsyncAPI would be the right tool if the contracts grew. |
| Metrics and tracing                                      | Out of scope by the challenge. Logs carry `messageId` and `correlationId`, which is what a collector would use.                                                                                                                                                       |
| Ordering between messages                                | Not needed: the first result wins and statuses are terminal.                                                                                                                                                                                                          |
| CNPJ check digit in the result                           | The provider is the source of truth; only the format (14 digits) is validated.                                                                                                                                                                                        |

---

## 9. Use of AI

I used Claude Code as an implementation, review and testing partner. It generated most of the code and tests and drafted the ADRs. I made the architectural decisions and validated every slice before committing it.

**Decisions.** Every technical decision is recorded in [docs/adr](docs/adr/README.md), in PT-BR to help other developers understand them easily, with the options considered, the one chosen and why. Among them: simplifying the architecture of a previous reference project, the table-backed queue, the transactional outbox, answering `200` to a repeated key, and the idempotent consumer.

**What the validation caught.**

- The generated Jest config referenced a `globalSetup` file that did not exist yet, so the suite failed before running any test. Fixed by adding the integration project only together with the database.
- Supertest opened one server per request and raised `MaxListenersExceededWarning` in the 10-concurrent-requests test. Fixed by making the test app listen once.
- A test for "second request after the invoice was decided" depended on the consumer before it existed. It was split: an intermediate version first, the full one together with the consumer.
- Running the API in Docker confirmed the outbox guarantee: an invoice registered while the background loops were off stayed in `ANALISE` with its message `PENDING`, and was approved as soon as the loops started.

### Working principle

The recurring workflow was:

```text
Claude
  ↓
Explore / implement / review / generate
  ↓
Validate against the specification, ADRs, tests, and runtime behavior
  ↓
Accept, modify, or reject
  ↓
Final implementation
```

Claude reduced the cost of exploration and iteration; the final implementation reflects decisions recorded in the ADRs and validated through testing and real system behavior.

---

## 10. Further Documentation

| Document                                                            | Contents                                      |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [docs/adr](docs/adr/README.md)                                      | Index of the architecture decision records    |
| [ADR 0001](docs/adr/0001-arquitetura-em-camadas-simplificada.md)    | Simplified layered architecture               |
| [ADR 0002](docs/adr/0002-testes-de-integracao-com-postgres-real.md) | Integration tests against a real PostgreSQL   |
| [ADR 0003](docs/adr/0003-fila-simulada-em-tabela.md)                | Queue simulated with a PostgreSQL table       |
| [ADR 0004](docs/adr/0004-transactional-outbox.md)                   | Transactional outbox for the outbound message |
| [ADR 0005](docs/adr/0005-chave-de-acesso-duplicada.md)              | Duplicate access key                          |
| [ADR 0006](docs/adr/0006-consumo-idempotente.md)                    | Idempotent consumption of the result message  |
| [ADR 0007](docs/adr/0007-contrato-das-mensagens.md)                 | Message contracts                             |
| [ADR 0008](docs/adr/0008-processo-unico-para-api-e-workers.md)      | Single process for API and workers            |
| [docs/plans](docs/plans/2026-10-29-delivery-plan-design.md)         | Delivery plan: SDD            |
