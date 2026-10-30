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

  // Complements required test 4 — the database itself refuses a second invoice for the same key
  it('refuses a second invoice with the same access key', async () => {
    const key = newAccessKey();
    await insert(key);
    await expect(insert(key)).rejects.toThrow(/uq_invoices_access_key/);
  });

  it('refuses APROVADA without an approval date (invariant repeated in the schema)', async () => {
    await insert(newAccessKey());
    await expect(pool.query(`UPDATE invoices SET status = 'APROVADA'`)).rejects.toThrow(
      /ck_invoices_approval/,
    );
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
