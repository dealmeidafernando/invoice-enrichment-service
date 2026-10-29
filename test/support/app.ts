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
