# Delivery plan — invoice-enrichment-service

Technical test: NF-e intake and enrichment pipeline (Node.js, NestJS, TypeScript, PostgreSQL, Docker).

## Goal

A simple, working solution that is easy to explain. The history is built in small slices: each one compiles, passes its tests and is committed by me.

## Conventions

- Code, commits and README in English. ADRs in Portuguese (PT-BR), in `docs/adr/`.
- Conventional Commits, straight to `main`.
- ADRs follow a short Nygard format: Contexto, Opções avaliadas, Decisão, Motivo, Consequências. They start with status `Aceito`.
- Each slice ends with `yarn lint && yarn typecheck && yarn test` passing.

## Architecture decisions (ADRs)

| ADR | Decision |
|---|---|
| 0001 | Simplified layered architecture: domain / application / infra / main / shared |
| 0002 | Integration tests against a real PostgreSQL |
| 0003 | The queue is simulated with a PostgreSQL table (at-least-once, real redelivery) |
| 0004 | Transactional Outbox for the outbound message |
| 0005 | Duplicate key: `UNIQUE` + `ON CONFLICT`; the second request returns 200 with the same invoice |
| 0006 | Idempotent consumer: inbox (`messageId`) + status guard + row lock |
| 0007 | Message contracts: versioned envelope; `null` = rejection, malformed = `DEAD` |
| 0008 | Single process: API and background loops together (compose = API + PostgreSQL) |

## Slices and commits

| # | Content | Commit |
|---|---|---|
| 1 | Tooling | `chore: bootstrap NestJS project tooling` |
| 2 | ADR template/index + ADR 0001 | `docs: add ADR template and 0001 layered architecture` |
| 3 | Domain + unit tests | `feat: add invoice entity with approval and rejection rules` |
| 4 | ADR 0002 + schema, migrations, compose (postgres), test setup | `docs: 0002 testing strategy` / `feat: add schema, migrations and test database` |
| 5 | ADR 0003 + 0004 | `docs: 0003 table-backed queue and 0004 transactional outbox` |
| 6 | Table queue + outbox relay + tests | `feat: add table queue and outbox relay` |
| 7 | ADR 0005 | `docs: 0005 duplicate access key handling` |
| 8 | Register/get invoice + tests | `feat: register invoice and enqueue enrichment request` |
| 9 | ADR 0006 + 0007 | `docs: 0006 idempotent consumer and 0007 message contracts` |
| 10 | Result consumer + fake provider + tests | `feat: consume enrichment result and decide invoice` |
| 11 | ADR 0008 + workers, Dockerfile, compose API | `docs: 0008 single process` / `feat: run workers in-process and dockerize API` |
| 12 | CI | `ci: add GitHub Actions workflow` |
| 13 | README + AI usage log | `docs: add README and AI usage log` |

## Required tests coverage

| Required by the test | Slice |
|---|---|
| Invoice created in `ANALISE` and the outbound message | 8 |
| Approval only after a complete result | 3, 10 |
| Rejection when canceled or incomplete | 3, 10 |
| Two requests with the same key | 8 |
| The same inbound message delivered twice (redelivery) | 6, 10 |
| Publish failure neither loses nor approves the invoice | 6, 10 |

## Source

A working reference implementation lives outside the repository, in `../invoice-enrichment-service.reference/`. Each slice is brought from it and adjusted.
