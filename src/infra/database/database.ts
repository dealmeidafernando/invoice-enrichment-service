import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { TransactionManager } from '../../domain';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Runs SQL on the current transaction, if there is one, or on the pool.
 * The transaction travels through AsyncLocalStorage, so repositories never receive a client
 * and the domain interfaces stay free of `pg`.
 */
@Injectable()
export class Database implements TransactionManager {
  private readonly context = new AsyncLocalStorage<PoolClient>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const client = this.context.getStore();
    return client ? client.query<R>(sql, params) : this.pool.query<R>(sql, params);
  }

  inTransaction(): boolean {
    return this.context.getStore() !== undefined;
  }

  /** Opens a transaction. Nested calls reuse the outer one. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction()) return work();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.context.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  assertInTransaction(operation: string): void {
    if (!this.inTransaction()) {
      throw new Error(`${operation} must run inside a transaction.`);
    }
  }
}
