import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { Envelope } from '../../application/contracts/messages';
import { PG_POOL } from '../database/database';
import { TableQueue } from './table-queue';

export interface RelaySummary {
  published: number;
  failed: number;
}

/**
 * Reads the outbox and publishes to the queue, outside the request.
 * - Publish failure: the message stays PENDING and is retried after a backoff. The invoice is untouched.
 * - Published but crashed before commit: published again (at-least-once). The consumer is idempotent.
 * - Concurrent relays never publish the same row: FOR UPDATE SKIP LOCKED.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly queue: TableQueue,
  ) {}

  async publishPending(batchSize = 50, backoffBaseMs = 1000): Promise<RelaySummary> {
    const client = await this.pool.connect();
    const summary: RelaySummary = { published: 0, failed: 0 };
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        topic: string;
        envelope: Envelope<unknown>;
        attempts: number;
      }>(
        `SELECT id, topic, envelope, attempts
           FROM outbox
          WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );

      for (const row of rows) {
        try {
          await this.queue.publish(row.topic, row.envelope);
          await client.query(
            `UPDATE outbox SET status = 'PUBLISHED', published_at = now(), attempts = attempts + 1 WHERE id = $1`,
            [row.id],
          );
          summary.published++;
        } catch (error) {
          const delayMs = Math.min(backoffBaseMs * 2 ** row.attempts, 5 * 60_000);
          await client.query(
            `UPDATE outbox
                SET attempts = attempts + 1, last_error = $2, available_at = now() + make_interval(secs => $3)
              WHERE id = $1`,
            [row.id, String((error as Error)?.message ?? error), delayMs / 1000],
          );
          summary.failed++;
          this.logger.warn(`Failed to publish ${row.id} (${row.topic}): ${(error as Error)?.message}`);
        }
      }
      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
