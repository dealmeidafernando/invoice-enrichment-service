# Invoice Enrichment Service — Implementation Plan

> Executed inline, one task per commit. Claude prepares each slice; **Fernando reviews, runs the checks and commits** with the suggested message. Steps use `- [ ]` for tracking.

**Goal:** Deliver the NF-e intake and enrichment pipeline as 13 small, green commits, with 8 ADRs explaining the decisions.

**Architecture:** Simplified layers (domain / application / infra / main / shared). Invoice + outbound message are written in one transaction (outbox). A PostgreSQL table simulates the broker (at-least-once with redelivery). An idempotent consumer applies the provider's result.

**Tech Stack:** Node 22, NestJS 11, TypeScript, PostgreSQL 16, `pg`, zod, Jest + supertest, Docker Compose, yarn.

**Source:** working reference implementation at `../invoice-enrichment-service.reference/` (referred to as `REF/`). "Copy" means copy the file verbatim from `REF/` to the same path, unless the step shows a different version.

**ADR format (PT-BR, `docs/adr/NNNN-slug.md`):**

```markdown
# NNNN. Título

- Status: Aceito
- Data: 2026-10-29

## Contexto
## Opções avaliadas
## Decisão
## Motivo
## Consequências
```

**Checks used below:**

```bash
CHECK="yarn lint && yarn typecheck"
export DATABASE_URL_TEST=postgres://invoices:invoices@localhost:5432/invoices_test   # from Task 4 on
```

---

### Task 1: Project tooling

**Files (copy from REF):** `package.json`, `yarn.lock`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.dockerignore`, `.nvmrc`, `.env.example`

- [ ] **Step 1:** Copy the files.
- [ ] **Step 2:** Run `yarn install --frozen-lockfile && yarn lint`. Expected: no errors (there is no source yet, so typecheck starts at Task 3).
- [ ] **Step 3:** Confirm `git status` does not list `.env` or `node_modules`.
- [ ] **Step 4: Commit:** `chore: bootstrap NestJS project tooling`

### Task 2: ADR index + ADR 0001

**Files:** Create `docs/adr/README.md` (index table + the template above) and `docs/adr/0001-arquitetura-em-camadas-simplificada.md`.

ADR 0001 content:
- **Opções:** (a) Clean Architecture completa (ports/adapters, unit of work, clock, id generator) — reference project `nfe-enrichment-pipeline`; (b) simplified layers domain/application/infra/main/shared, as in `back-front-template`; (c) feature modules in Nest only, with no layers.
- **Decisão:** (b).
- **Motivo:** the rules (approval/rejection, terminal status) stay testable without a database or framework; fewer abstractions to explain; a test project does not need swappable clocks or id generators.
- **Consequências:** the domain does not import Nest/pg (ESLint `no-restricted-imports`); repository interfaces live in `domain/repositories`; Nest only appears in application/infra/main.

- [ ] **Step 1:** Write both files.
- [ ] **Step 2: Commit:** `docs(adr): add ADR template and 0001 layered architecture`

### Task 3: Domain

**Files (copy from REF):**
- `src/domain/errors/domain.error.ts`
- `src/domain/value-objects/access-key.ts`, `src/domain/value-objects/money.ts`
- `src/domain/entities/invoice.entity.ts`
- `src/domain/repositories/invoice.repository.ts`, `src/domain/repositories/message.repository.ts`
- `src/domain/index.ts`
- Tests: `test/support/access-keys.ts`, `test/unit/access-key.spec.ts`, `test/unit/money.spec.ts`, `test/unit/invoice.entity.spec.ts`

- [ ] **Step 1:** Copy the tests first and run `yarn test:unit`. Expected: FAIL (cannot find module `../../src/domain`).
- [ ] **Step 2:** Copy the `src/domain` files.
- [ ] **Step 3:** Run `$CHECK && yarn test:unit`. Expected: 3 suites PASS.
- [ ] **Step 4: Commit:** `feat(domain): add invoice entity with approval and rejection rules`

### Task 4: ADR 0008 + database

**ADR `0008-testes-de-integracao-com-postgres-real.md`:**
- **Opções:** (a) in-memory repositories + mocks; (b) Testcontainers; (c) real PostgreSQL from docker compose, with a separate database `invoices_test`.
- **Decisão:** (c), plus pure unit tests for the domain.
- **Motivo:** the critical rules (unique key under concurrency, `FOR UPDATE`, `SKIP LOCKED`, rollback) only exist in a real database; (b) adds a dependency and is slower to boot; compose is already required.
- **Consequências:** integration tests need `docker compose up -d postgres`; they run serially (`maxWorkers: 1`) and truncate tables.

**Files:**
- Copy: `src/infra/database/database.ts`, `src/infra/database/migrate.ts`, `src/infra/database/migrations/001_initial_schema.sql`, `docker/postgres-init/01-test-database.sql`, `test/support/global-setup.ts`
- Create `docker-compose.yml` with **only** the `postgres` service and the `pgdata` volume (copy `REF/docker-compose.yml` and remove the `api` service).
- Create `test/support/db.ts` (REF version **without** `envelope`, which arrives in Task 6):

```ts
import { Pool } from 'pg';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Run `docker compose up -d postgres` and ' +
        'export DATABASE_URL_TEST=postgres://invoices:invoices@localhost:5432/invoices_test',
    );
  }
  return url;
}

export function createTestPool(): Pool {
  return new Pool({ connectionString: testDatabaseUrl(), max: 20 });
}

export async function cleanDatabase(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE invoices, outbox, queue_messages, processed_messages RESTART IDENTITY');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- Create `test/integration/database.spec.ts` (new — guards the schema and the transaction helper):

```ts
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Database } from '../../src/infra/database/database';
import { newAccessKey } from '../support/access-keys';
import { cleanDatabase, createTestPool } from '../support/db';

describe('Database (real Postgres)', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    pool = createTestPool();
    db = new Database(pool);
  });
  beforeEach(() => cleanDatabase(pool));
  afterAll(() => pool.end());

  const insert = (key: string) =>
    db.query(`INSERT INTO invoices (id, access_key, status) VALUES ($1, $2, 'ANALISE')`, [randomUUID(), key]);
  const countInvoices = async () => (await pool.query(`SELECT count(*)::int AS n FROM invoices`)).rows[0].n;

  it('refuses a second invoice with the same access key', async () => {
    const key = newAccessKey();
    await insert(key);
    await expect(insert(key)).rejects.toThrow(/uq_invoices_access_key/);
  });

  it('refuses APROVADA without an approval date (invariant repeated in the schema)', async () => {
    await insert(newAccessKey());
    await expect(pool.query(`UPDATE invoices SET status = 'APROVADA'`)).rejects.toThrow(/ck_invoices_approval/);
  });

  it('rolls back everything written inside a failed transaction', async () => {
    await expect(
      db.run(async () => {
        await insert(newAccessKey());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await countInvoices()).toBe(0);
  });
});
```

- [ ] **Step 1:** `docker compose up -d postgres`. Wait for `docker compose ps` to show it as healthy.
- [ ] **Step 2:** Add the files and run `$CHECK && yarn test`. Expected: 4 suites PASS (3 unit + database).
- [ ] **Step 3: Commit (2 commits):**
  - `git add docs/adr/0008-*` → `docs(adr): 0008 testing strategy with real PostgreSQL`
  - the rest → `feat(db): add schema, migrations and test database`

### Task 5: ADR 0002 + 0003

**`0002-fila-simulada-em-tabela.md`:**
- **Opções:** (a) in-memory queue (EventEmitter/array); (b) PostgreSQL table `queue_messages`; (c) a real broker in compose (RabbitMQ).
- **Decisão:** (b).
- **Motivo:** the spec requires redelivery in a test. A table gives at-least-once with ack, backoff, visibility timeout and dead-letter, survives restarts and allows several consumers (`FOR UPDATE SKIP LOCKED`). (a) loses messages on restart and does not show redelivery honestly. (c) is out of scope ("barramento gerenciado") and adds infrastructure.
- **Consequências:** publishing uses its own connection (never the service's transaction), like a real broker. Swapping in a real broker only touches `TableQueue`. Polling adds latency (~500 ms).

**`0003-transactional-outbox.md`:**
- **Opções:** (a) publish inside the request after the INSERT; (b) commit, then publish with retry in memory; (c) Transactional Outbox: write the message to `outbox` in the same transaction and let a relay publish it.
- **Decisão:** (c).
- **Motivo:** rule "falha ao publicar não pode perder a nota nem aprová-la no request". (a) and (b) can leave the invoice without a message (crash between commit and publish) or fail the request after storing it.
- **Consequências:** delivery is at-least-once (the relay may publish twice), so the consumer must be idempotent (ADR 0005). The invoice stays in `ANALISE` until the result arrives.

- [ ] **Step 1:** Write both ADRs and update the index in `docs/adr/README.md`.
- [ ] **Step 2: Commit:** `docs(adr): 0002 table-backed queue and 0003 transactional outbox`

### Task 6: Table queue + outbox relay

**Files (copy from REF):**
- `src/application/contracts/messages.ts`
- `src/infra/messaging/table-queue.ts`, `src/infra/messaging/outbox-relay.ts`
- `src/infra/repositories/pg-message.repository.ts`
- `test/support/db.ts` (full REF version: adds `envelope()` and its imports)
- `test/integration/table-queue.spec.ts`, `test/integration/outbox-relay.spec.ts`

- [ ] **Step 1:** Copy the tests and `db.ts`, then run `yarn test:integration`. Expected: FAIL (modules not found).
- [ ] **Step 2:** Copy the source files.
- [ ] **Step 3:** Run `$CHECK && yarn test`. Expected: all PASS. Check that the run includes `redelivers the message when the handler fails` and `a publish failure does not lose the message`.
- [ ] **Step 4: Commit:** `feat(messaging): add table queue and outbox relay`

### Task 7: ADR 0004

**`0004-chave-duplicada.md`:**
- **Opções:** (a) `SELECT` before `INSERT` in the application; (b) `UNIQUE (access_key)` and return **409 Conflict**; (c) `UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING` and return **200 with the existing invoice** (202 when it was created).
- **Decisão:** (c).
- **Motivo:** (a) races under concurrent requests. Between (b) and (c), the client is just resending the same key (a retry after a timeout, for example), so an idempotent answer is more useful than an error. The client gets the id and can follow the status. The database guarantees uniqueness even under concurrency.
- **Consequências:** the second request writes no new outbound message. 202 and 200 tell "created now" apart from "already existed".

- [ ] **Step 1:** Write the ADR and update the index.
- [ ] **Step 2: Commit:** `docs(adr): 0004 duplicate access key handling`

### Task 8: Register and get invoice

**Files (copy from REF):**
- `src/shared/config/env.ts`
- `src/application/use-cases/register-invoice.use-case.ts`, `src/application/use-cases/get-invoice.use-case.ts`
- `src/infra/repositories/pg-invoice.repository.ts`
- `src/infra/http/invoices.controller.ts`, `src/infra/http/health.controller.ts`, `src/infra/http/domain-error.filter.ts`, `src/infra/http/presenters/invoice.presenter.ts`
- `src/main/main.ts`

**Create `src/main/app.module.ts`** (partial — no consumer, fake provider or workers yet):

```ts
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Pool } from 'pg';
import { GetInvoiceUseCase } from '../application/use-cases/get-invoice.use-case';
import { RegisterInvoiceUseCase } from '../application/use-cases/register-invoice.use-case';
import { INBOX_REPOSITORY, INVOICE_REPOSITORY, OUTBOX_REPOSITORY, TRANSACTION_MANAGER } from '../domain';
import { Database, PG_POOL } from '../infra/database/database';
import { DomainErrorFilter } from '../infra/http/domain-error.filter';
import { HealthController } from '../infra/http/health.controller';
import { InvoicesController } from '../infra/http/invoices.controller';
import { OutboxRelay } from '../infra/messaging/outbox-relay';
import { TableQueue } from '../infra/messaging/table-queue';
import { PgInvoiceRepository } from '../infra/repositories/pg-invoice.repository';
import { PgInboxRepository, PgOutboxRepository } from '../infra/repositories/pg-message.repository';
import { ENV, Env, loadEnv } from '../shared/config/env';

/** Composition root: the only place that binds domain interfaces to infra implementations. */
@Module({
  controllers: [InvoicesController, HealthController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 10 }),
    },
    Database,

    { provide: TRANSACTION_MANAGER, useExisting: Database },
    { provide: INVOICE_REPOSITORY, useClass: PgInvoiceRepository },
    { provide: OUTBOX_REPOSITORY, useClass: PgOutboxRepository },
    { provide: INBOX_REPOSITORY, useClass: PgInboxRepository },

    RegisterInvoiceUseCase,
    GetInvoiceUseCase,

    TableQueue,
    OutboxRelay,

    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
```

**Create `test/support/app.ts`** (partial):

```ts
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PG_POOL } from '../../src/infra/database/database';
import { OutboxRelay } from '../../src/infra/messaging/outbox-relay';
import { TableQueue } from '../../src/infra/messaging/table-queue';
import { AppModule } from '../../src/main/app.module';
import { testDatabaseUrl } from './db';

export interface TestApp {
  app: INestApplication;
  pool: Pool;
  queue: TableQueue;
  runRelay(): Promise<unknown>;
  close(): Promise<void>;
}

/** Boots the application against the test database with the background loops disabled. */
export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.WORKERS_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // Listen once, so supertest reuses the server instead of opening one per request.
  await app.listen(0);

  const relay = app.get(OutboxRelay);
  return {
    app,
    pool: app.get(PG_POOL),
    queue: app.get(TableQueue),
    runRelay: () => relay.publishPending(50, 0),
    close: () => app.close(),
  };
}
```

**Create `test/integration/invoice-flow.spec.ts`** (partial), assembled from `REF/test/integration/invoice-flow.spec.ts`:
- Imports: only `request`, `generateAccessKey, newAccessKey`, `createTestApp, TestApp`, `cleanDatabase` (drop `TOPIC_ENRICHMENT_COMPLETED`, `ProcessEnrichmentResultUseCase` and `INVOICE_REPOSITORY, InvoiceRepository`, which would be unused).
- Lines 9–28 (setup and helpers), lines 29–80 (`describe('creation')`), lines 145–168 (`describe('idempotent intake')`), then close with `});`.

- [ ] **Step 1:** Create the 3 test-side files and run `yarn test:integration`. Expected: FAIL (modules not found).
- [ ] **Step 2:** Copy the source files and create `app.module.ts`.
- [ ] **Step 3:** Run `$CHECK && yarn test`. Expected: all PASS. The run includes `creation` (ANALISE, outbound message, 400) and `idempotent intake` (10 concurrent requests → 1 invoice, 1 message).
- [ ] **Step 4 (optional, manual):** `DATABASE_URL=postgres://invoices:invoices@localhost:5432/invoices WORKERS_ENABLED=false yarn start:dev`, then `curl -i -X POST localhost:3000/invoices -H 'content-type: application/json' -d '{"accessKey":"35261012345678000190550010000000000000000017"}'` → `202`.
- [ ] **Step 5: Commit:** `feat(invoices): register invoice and enqueue enrichment request`

### Task 9: ADR 0005 + 0006

**`0005-consumo-idempotente.md`:**
- **Opções:** (a) status guard only (`WHERE status = 'ANALISE'`); (b) inbox table `processed_messages (consumer, message_id)` only; (c) inbox + status guard + `SELECT ... FOR UPDATE` on the invoice before checking the inbox.
- **Decisão:** (c).
- **Motivo:** (a) covers "do not change again" but cannot tell a redelivery from a new message, and gives no audit trail. (b) alone does not stop a second, *different* result for the same key. The lock serializes two parallel deliveries of the same message. The inbox is written in the same transaction as the change, so a failure rolls both back and the redelivery is processed again.
- **Consequências:** the unknown key is checked **before** the inbox, so nothing is written ("a mensagem de volta não cria nota"). The first result wins and later ones are `IGNORED`.

**`0006-contrato-das-mensagens.md`:**
- **Opções:** (a) bare payload; (b) envelope `{ messageId, type, version, occurredAt, correlationId, payload }`. For missing fields: (i) treat as contract error; (ii) `null` = valid result, rejected with a reason.
- **Decisão:** (b) + (ii). `amount` is a decimal string, `issueDate` is ISO 8601, `canceled` is required. A malformed message (wrong type, unreadable date, unknown version) is non-retryable and goes straight to `DEAD`.
- **Motivo:** `messageId` is what makes dedup possible (ADR 0005). `version` allows evolving the contract. The spec says "sem esses dados vai para REJEITADA e grava o motivo", so missing data is a business outcome, not an error. Retrying a malformed message would never help. An amount as a string avoids float precision loss.
- **Consequências:** validation uses zod in `infra/messaging`; the reasons are `INVOICE_CANCELED`, `MISSING_CNPJ`, `MISSING_AMOUNT`, `MISSING_ISSUE_DATE` (all of them are stored, not only the first).

- [ ] **Step 1:** Write both ADRs and update the index.
- [ ] **Step 2: Commit:** `docs(adr): 0005 idempotent consumer and 0006 message contracts`

### Task 10: Enrichment result consumer

**Files (copy from REF):**
- `src/application/use-cases/process-enrichment-result.use-case.ts`
- `src/infra/messaging/enrichment-completed.consumer.ts`, `src/infra/messaging/fake-provider.ts`
- `test/unit/enrichment-completed.parser.spec.ts`
- `test/support/app.ts` (full REF version: adds `provider`, `consumer`, `runProvider`, `runConsumer`, `runFullFlow`)
- `test/integration/invoice-flow.spec.ts` (full REF version: adds approval, rejection, idempotent consumption, failures)

**Modify `src/main/app.module.ts`:** add the imports and providers `ProcessEnrichmentResultUseCase`, `EnrichmentCompletedConsumer` and `FakeProvider`. This is `REF/src/main/app.module.ts` without the `WorkersService` import and provider.

- [ ] **Step 1:** Copy the tests and run `yarn test`. Expected: FAIL (modules not found).
- [ ] **Step 2:** Copy the source files and edit `app.module.ts`.
- [ ] **Step 3:** Run `$CHECK && yarn test`. Expected: all PASS. The run includes `the same inbound message delivered twice changes the invoice only once`, the parallel variant, `unknown key ... (not even the inbox)` and `invalid contract goes to DEAD`.
- [ ] **Step 4: Commit:** `feat(enrichment): consume enrichment result and decide invoice`

### Task 11: ADR 0007 + workers and Docker

**`0007-processo-unico.md`:**
- **Opções:** (a) API and background loops in one process; (b) separate `worker` container from the same image (`APP_ROLE`); (c) Nest microservices / `@nestjs/schedule`.
- **Decisão:** (a), with `WORKERS_ENABLED` and `SIMULATE_PROVIDER` flags.
- **Motivo:** the spec asks for compose with "a API e o PostgreSQL" and allows simulating the queue "no próprio processo". One process is simpler to run and explain. `SKIP LOCKED` already makes several replicas safe. (c) adds a dependency for a 20-line loop.
- **Consequências:** the HTTP and worker loads scale together. Splitting later only needs a flag. Tests turn the loops off and drive each stage by hand.

**Files:**
- Copy: `src/infra/messaging/workers.service.ts`, `src/main/app.module.ts` (full REF version), `Dockerfile`, `docker-compose.yml` (full REF version, with the `api` service)

- [ ] **Step 1:** Copy the files and run `$CHECK && yarn test`. Expected: all PASS.
- [ ] **Step 2:** Run `docker compose up -d --build`, wait for `curl -sf localhost:3000/health`, then run:
  ```bash
  curl -s -X POST localhost:3000/invoices -H 'content-type: application/json' \
    -d '{"accessKey":"35261012345678000190550010000000000000000017"}'
  sleep 2 && curl -s localhost:3000/invoices/<id>
  ```
  Expected: `ANALISE`, then `APROVADA` with `approvedAt`.
- [ ] **Step 3: Commit (2 commits):**
  - `docs(adr): 0007 single process for API and workers`
  - `feat(app): run workers in-process and dockerize the API`

### Task 12: CI

**Files:** copy `.github/workflows/ci.yml`.

- [ ] **Step 1:** Check that `node-version-file: .nvmrc` and `yarn install --frozen-lockfile` match the repo.
- [ ] **Step 2: Commit:** `ci: add GitHub Actions workflow`

### Task 13: README + AI usage log

**Files:**
- `README.md`: start from `REF/README.md` and adjust it:
  - In "Design decisions", link each decision to its ADR (`docs/adr/000N-*.md`) and shorten the text that is repeated in the ADRs.
  - Replace the "Use of AI" section with a short paragraph linking to `AI_LOG.md`.
  - Check that it still covers what the spec requires: how to run, how to test, the invoice flow, both message contracts, what was left out and why.
- `AI_LOG.md`, in the style of `happy-robot/carrier-sales-api/CLAUDE_LOG.md`:
  - **AI contribution:** what Claude Code generated (scaffold, domain, outbox/queue, tests, Docker, CI, ADR drafts).
  - **Human judgment and validation:** the decisions, one line per ADR, plus what was changed during review. Fernando writes this from the notes kept during Tasks 1–12.
  - **What the validation caught:** the real findings, for example the supertest `MaxListenersExceededWarning` fixed by listening once in `test/support/app.ts`, and the plain hand-written parser replaced by zod.
  - **Working principle:** the same flow diagram as the reference.

- [ ] **Step 1:** Write both files.
- [ ] **Step 2:** Final check: `$CHECK && yarn build && yarn test`. Then `git grep -nE "password|secret|token"` should only match the local-dev credentials, which are commented as such.
- [ ] **Step 3: Commit:** `docs: add README and AI usage log`

---

## Self-review

- **Coverage of "Nos testes, mostre":** creation + outbound message (Task 8); approval only after a complete result (Tasks 3, 10); rejection canceled/incomplete (Tasks 3, 10); two requests with the same key (Task 8); same inbound message twice (Tasks 6, 10); publish failure (Tasks 6, 10).
- **Coverage of "Como entregar":** README (Task 13); compose API + PostgreSQL (Task 11); AI usage told (Task 13); no secrets (`.gitignore` in Task 1, check in Task 13).
- **Consistency:** `TestApp` grows from Task 8 (partial) to Task 10 (full REF). `app.module.ts` grows in Tasks 8 → 10 → 11. `test/support/db.ts` gains `envelope` in Task 6. Every partial version compiles on its own (no unused imports).
