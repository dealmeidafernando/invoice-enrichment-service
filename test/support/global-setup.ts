import { runMigrations } from '../../src/infra/database/migrate';
import { createTestPool } from './db';

/** Runs once before the integration suite: applies migrations to the test database. */
export default async function globalSetup(): Promise<void> {
  const pool = createTestPool();
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
