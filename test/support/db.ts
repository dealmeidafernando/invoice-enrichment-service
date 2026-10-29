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
