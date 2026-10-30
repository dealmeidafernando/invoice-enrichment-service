# Delivery plan — invoice-enrichment-service

Technical test: NF-e intake and enrichment pipeline (Node.js, NestJS, TypeScript, PostgreSQL, Docker).

## Goal

A simple, working solution that is easy to explain. The history is built in small slices: each one compiles, passes its tests and is committed on its own. A decision is recorded as an ADR before the code that implements it.

## Conventions

- Code, commits and README in English. ADRs in Portuguese (PT-BR), in `docs/adr/`, numbered in the order they were decided.
- Conventional Commits without scope, straight to `main`.
- ADRs follow a short Nygard format: Contexto, Opções avaliadas, Decisão, Motivo, Consequências.
- Each slice ends with lint, typecheck and tests passing (`make check`).

## Architecture decisions (ADRs)

| ADR  | Decision                                                                                      |
| ---- | --------------------------------------------------------------------------------------------- |
| 0001 | Simplified layered architecture: domain / application / infra / main / shared                 |
| 0002 | Integration tests against a real PostgreSQL                                                   |
| 0003 | The queue is simulated with a PostgreSQL table (at-least-once, real redelivery)               |
| 0004 | Transactional Outbox for the outbound message                                                 |
| 0005 | Duplicate key: `UNIQUE` + `ON CONFLICT`; the second request returns 200 with the same invoice |
| 0006 | Idempotent consumer: inbox (`messageId`) + status guard + row lock                            |
| 0007 | Message contracts: versioned envelope; `null` = rejection, malformed = `DEAD`                 |
| 0008 | Single process: API and background loops together (compose = API + PostgreSQL)                |
| 0009 | Explicit SQL with `pg` instead of an ORM                                                      |

## Slices and commits

| #   | Content                                                      | Commits                                                                                                                    |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Delivery plan, ADR template and ADR 0001                     | `docs: add delivery plan`                                                                                                  |
| 2   | Tooling                                                      | `chore: bootstrap NestJS project tooling`                                                                                  |
| 3   | Domain + unit tests                                          | `feat: add invoice domain with approval and rejection rules`                                                               |
| 4   | ADR 0002 + schema, migrations, test database                 | `docs: add ADR 0002 testing strategy with real PostgreSQL` · `feat: add database schema, migrations and test database`     |
| 5   | ADR 0003 + 0004                                              | `docs: add ADR 0003 table-backed queue and 0004 transactional outbox`                                                      |
| 6   | Table queue + outbox relay + tests                           | `feat: add table-backed queue and outbox relay`                                                                            |
| 7   | ADR 0005 + register/get invoice + tests                      | `docs: add ADR 0005 duplicate access key handling` · `feat: register invoice and enqueue enrichment request`               |
| 8   | ADR 0006 + 0007 + result consumer, simulated provider, tests | `docs: add ADR 0006 idempotent consumer and 0007 message contracts` · `feat: consume enrichment result and decide invoice` |
| 9   | ADR 0008 + workers, Dockerfile, compose with the API         | `docs: add ADR 0008 single process for API and workers` · `feat: run workers in-process and dockerize the API`             |
| 10  | CI                                                           | `ci: add GitHub Actions workflow`                                                                                          |
| 11  | README                                                       | `docs: add README with flow, contracts and scope`                                                                          |
| 12  | Makefile                                                     | `chore: add Makefile with the main developer commands`                                                                     |

## Required tests coverage

| Required by the test                                   | Slice |
| ------------------------------------------------------ | ----- |
| Invoice created in `ANALISE` and the outbound message  | 7     |
| Approval only after a complete result                  | 3, 8  |
| Rejection when canceled or incomplete                  | 3, 8  |
| Two requests with the same key                         | 7     |
| The same inbound message delivered twice (redelivery)  | 6, 8  |
| Publish failure neither loses nor approves the invoice | 6, 8  |
