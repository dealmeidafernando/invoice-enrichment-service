# Invoice Enrichment Service

Intake and enrichment pipeline for Brazilian electronic invoices (NF-e), built as a technical challenge.

A client sends the 44-digit **access key** of an invoice. The invoice is born incomplete, in `ANALISE`. An external provider looks up the key and returns the CNPJ, the amount, the issue date and whether the invoice is canceled. Only then is the invoice approved or rejected. The service:

- validates the access key (44 digits, modulo 11 check digit) and stores the invoice in **`ANALISE`**
- never calls the provider inside the request: it stores the invoice and an **outbound message** in the same transaction (outbox)
- consumes the provider's **result message** and moves the invoice to **`APROVADA`** or **`REJEITADA`** with the reasons
- guarantees **one invoice per key**, even with concurrent requests
- processes each result **once**, even when the same message is delivered again

The provider is simulated, and the message queue is a PostgreSQL table with real redelivery. Every technical decision, with the options considered and why: [docs/adr](docs/adr/README.md).

## Development

### Pre-requisites

| Tool                    | Version                  | Install                                                         |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| Node.js                 | 22+ (pinned in `.nvmrc`) | [nvm](https://github.com/nvm-sh/nvm) → `nvm install && nvm use` |
| Yarn                    | 1.22+                    | `npm install -g yarn`                                           |
| Docker + Docker Compose | Docker 24+, Compose v2+  | [Docker Desktop](https://docs.docker.com/get-docker/)           |

Stack: Node.js, NestJS 11, TypeScript, PostgreSQL 16, Docker.

---

## 1. Getting Started

### 1.1. Clone the project

```bash
git clone git@github.com:dealmeidafernando/invoice-enrichment-service.git
cd invoice-enrichment-service
```

### 1.2. Run the application

With Docker (API + PostgreSQL, with the simulated provider turned on):

```bash
docker compose up --build -d   # API on http://localhost:3000 · PostgreSQL on :5432
docker compose logs -f api     # follow the API logs
docker compose down            # stop everything (add -v to also wipe the database)
```

The API applies the database migrations on startup.

Or without Docker for the API (PostgreSQL still comes from compose):

```bash
yarn install
docker compose up -d postgres
cp .env.example .env
set -a && . ./.env && set +a   # load the variables into the shell
SIMULATE_PROVIDER=true yarn start:dev
```

### 1.3. Testing if it's okay

```bash
curl localhost:3000/health
```

```json
{ "status": "ok", "database": "ok" }
```

Then send an invoice (sample key with a valid check digit) and read it back a second later:

```bash
curl -i -X POST localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{"accessKey":"35261012345678000190550010000000000000000017"}'

curl localhost:3000/invoices/<id from the response>
```

The first call returns `202` with `"status":"ANALISE"`. About a second later, the simulated provider has answered and the invoice is `APROVADA`, with CNPJ, amount, issue date and `approvedAt`. Sending the same key again returns `200` with the same invoice.

To generate other valid keys, use `generateAccessKey(n)` in [`test/support/access-keys.ts`](test/support/access-keys.ts).

---

## 2. Commands

|                     Command | Execute                                               |
| --------------------------: | :---------------------------------------------------- |
| `docker compose up --build` | Build and start API + PostgreSQL                      |
|            `yarn start:dev` | Run the API locally (needs the variables in `.env`)   |
|                `yarn build` | Compile TypeScript to `dist/` (with the migrations)   |
|                `yarn start` | Run the compiled API                                  |
|                 `yarn test` | Run all tests (needs PostgreSQL, see [§5](#5-tests))  |
|            `yarn test:unit` | Run unit tests (no database)                          |
|     `yarn test:integration` | Run integration tests (real PostgreSQL)               |
|                 `yarn lint` | Lint the code                                         |
|            `yarn typecheck` | Type-check without emitting                           |
|               `yarn format` | Format with Prettier                                  |

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
  "payload": {}
}
```

**Outbound: `invoice.enrichment.requested`** (service → provider)

```json
{ "invoiceId": "83377e99-adf5-429c-8020-bc6c354d417b", "accessKey": "35261012345678000190550010000000000000000017" }
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

```bash
yarn install
docker compose up -d postgres
export DATABASE_URL_TEST=postgres://invoices:invoices@localhost:5432/invoices_test

yarn test                  # everything
yarn test:unit             # domain and message contract, no database
yarn test:integration      # full flow over HTTP, queue, outbox relay, schema
```

Run **one** test file, or one test by name:

```bash
yarn jest test/integration/invoice-flow.spec.ts
yarn jest -t "delivered twice"
```

The background loops are turned off in tests: each test moves relay → provider → consumer by hand, so it is deterministic. The provider is simulated by [`FakeProvider`](src/infra/messaging/fake-provider.ts), which publishes the result message.

| Required by the challenge                                  | Where                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| Invoice created in `ANALISE` and the outbound message      | `invoice-flow.spec.ts` › creation                             |
| Approval only after a complete result                      | `invoice-flow.spec.ts` › approval · `invoice.entity.spec.ts`  |
| Rejection when the result is canceled or incomplete        | `invoice-flow.spec.ts` › rejection · `invoice.entity.spec.ts` |
| Two requests with the same key (also 10 concurrent)        | `invoice-flow.spec.ts` › idempotent intake                    |
| The same result message delivered twice (also in parallel) | `invoice-flow.spec.ts` › idempotent consumption               |
| Unknown key: consumption ends without writing              | `invoice-flow.spec.ts` › idempotent consumption               |
| Publish failure neither loses nor approves the invoice     | `invoice-flow.spec.ts` › failures · `outbox-relay.spec.ts`    |
| Redelivery after a processing failure                      | `invoice-flow.spec.ts` › failures · `table-queue.spec.ts`     |

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

| Item                                                     | Why                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real broker (SQS, RabbitMQ, Kafka)                       | Out of scope by the challenge. A PostgreSQL table simulates it with real redelivery; swapping only touches `TableQueue`.                                                    |
| Real provider integration                                | The challenge asks for a simulated provider.                                                                                                                                |
| Separate worker process                                  | Compose is API + PostgreSQL. `SKIP LOCKED` already makes several replicas safe; splitting is one flag away ([ADR 0008](docs/adr/0008-processo-unico-para-api-e-workers.md)). |
| Invoice stuck in `ANALISE` if the provider never answers | Needs a reconciliation job that re-sends the request. The data for it already exists (`created_at`, outbox).                                                                |
| Reprocessing `DEAD` messages                             | Manual today (SQL). A redrive command is missing.                                                                                                                           |
| Cleanup of outbox, queue and inbox tables                | A production job would delete old rows. Today they grow without bound.                                                                                                      |
| Authentication, rate limiting                            | Outside the requested domain.                                                                                                                                               |
| Metrics and tracing                                      | Out of scope by the challenge. Logs carry `messageId` and `correlationId`, which is what a collector would use.                                                             |
| Ordering between messages                                | Not needed: the first result wins and statuses are terminal.                                                                                                                |
| CNPJ check digit in the result                           | The provider is the source of truth; only the format (14 digits) is validated.                                                                                              |

---

## 9. Use of AI

I used Claude Code as an implementation, review and testing partner. It generated most of the code and tests and drafted the ADRs. I made the architectural decisions and validated every slice before committing it.

**Decisions.** Every technical decision is recorded in [docs/adr](docs/adr/README.md) PT-BR to help others developers understand easily, with the options considered, the one chosen and why. Among them: simplifying the architecture of a previous reference project, the table-backed queue, the transactional outbox, answering `200` to a repeated key, and the idempotent consumer.

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
| [docs/plans](docs/plans/2026-10-29-delivery-plan-design.md)         | Delivery plan: slices and commits             |
