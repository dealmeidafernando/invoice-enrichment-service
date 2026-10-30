import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/** Replicas starting together must not migrate in parallel. The id is arbitrary. */
const MIGRATIONS_LOCK_ID = 7_042_026;
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATIONS_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files.filter((f) => !done.has(f))) {
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATIONS_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
