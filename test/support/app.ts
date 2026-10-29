import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  TOPIC_ENRICHMENT_COMPLETED,
  TOPIC_ENRICHMENT_REQUESTED,
} from '../../src/application/contracts/messages';
import { PG_POOL } from '../../src/infra/database/database';
import { EnrichmentCompletedConsumer } from '../../src/infra/messaging/enrichment-completed.consumer';
import { FakeProvider } from '../../src/infra/messaging/fake-provider';
import { OutboxRelay } from '../../src/infra/messaging/outbox-relay';
import { BatchSummary, TableQueue } from '../../src/infra/messaging/table-queue';
import { AppModule } from '../../src/main/app.module';
import { testDatabaseUrl } from './db';

export interface TestApp {
  app: INestApplication;
  pool: Pool;
  queue: TableQueue;
  relay: OutboxRelay;
  provider: FakeProvider;
  consumer: EnrichmentCompletedConsumer;
  runRelay(): Promise<unknown>;
  runProvider(): Promise<BatchSummary>;
  runConsumer(): Promise<BatchSummary>;
  /** One worker "tick": relay -> fake provider -> result consumer. */
  runFullFlow(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Boots the whole application against the test database with the loops disabled.
 * The test advances each stage by hand, so it is deterministic.
 */
export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.WORKERS_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // Listen once, so supertest reuses the server instead of opening one per request.
  await app.listen(0);

  const queue = app.get(TableQueue);
  const relay = app.get(OutboxRelay);
  const provider = app.get(FakeProvider);
  const consumer = app.get(EnrichmentCompletedConsumer);
  const noBackoff = { backoffBaseMs: 0 };

  const runRelay = () => relay.publishPending(50, 0);
  const runProvider = () =>
    queue.consumeBatch(TOPIC_ENRICHMENT_REQUESTED, (d) => provider.handle(d), noBackoff);
  const runConsumer = () =>
    queue.consumeBatch(TOPIC_ENRICHMENT_COMPLETED, (d) => consumer.handle(d), noBackoff);

  return {
    app,
    pool: app.get(PG_POOL),
    queue,
    relay,
    provider,
    consumer,
    runRelay,
    runProvider,
    runConsumer,
    async runFullFlow() {
      await runRelay();
      await runProvider();
      await runConsumer();
    },
    close: () => app.close(),
  };
}
