import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { Envelope } from '../../application/contracts/messages';
import { PG_POOL } from '../database/database';

export interface Delivery {
  deliveryId: string;
  messageId: string;
  envelope: Envelope<unknown>;
  /** 1 on the first delivery, 2 on the first redelivery, and so on. */
  attempt: number;
}

/** Thrown by a handler when retrying cannot help (invalid contract). Goes straight to DEAD. */
export class NonRetryableMessageError extends Error {
  override readonly name = 'NonRetryableMessageError';
}

export interface ConsumeOptions {
  batchSize?: number;
  /** How long a delivery stays claimed. If the process dies, it becomes available again after this. */
  visibilitySeconds?: number;
  /** After this many attempts the delivery goes to DEAD (dead-letter). */
  maxAttempts?: number;
  /** Wait before redelivery: base * 2^(attempt-1), capped at 5 min. 0 = immediate (tests). */
  backoffBaseMs?: number;
}

export interface BatchSummary {
  completed: number;
  rescheduled: number;
  dead: number;
}

const DEFAULTS: Required<ConsumeOptions> = {
  batchSize: 10,
  visibilitySeconds: 30,
  maxAttempts: 5,
  backoffBaseMs: 1000,
};

/**
 * Message broker simulated with the `queue_messages` table (a managed bus is out of scope).
 * Behaves like an at-least-once broker:
 * - publishing uses the pool, never the service's transaction (a real broker is another system);
 * - each row is a delivery; the same message may be delivered more than once;
 * - claiming uses FOR UPDATE SKIP LOCKED, so concurrent consumers never take the same delivery;
 * - ack only after the handler finishes; a failure reschedules with backoff (redelivery) or goes to DEAD;
 * - a delivery claimed by a process that died becomes available after the visibility timeout.
 */
@Injectable()
export class TableQueue {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async publish(topic: string, envelope: Envelope<unknown>): Promise<void> {
    await this.pool.query(`INSERT INTO queue_messages (message_id, topic, envelope) VALUES ($1, $2, $3)`, [
      envelope.messageId,
      topic,
      JSON.stringify(envelope),
    ]);
  }

  async consumeBatch(
    topic: string,
    handler: (delivery: Delivery) => Promise<void>,
    options: ConsumeOptions = {},
  ): Promise<BatchSummary> {
    const cfg = { ...DEFAULTS, ...options };
    const deliveries = await this.claim(topic, cfg.batchSize, cfg.visibilitySeconds);
    const summary: BatchSummary = { completed: 0, rescheduled: 0, dead: 0 };

    for (const delivery of deliveries) {
      try {
        await handler(delivery);
        await this.ack(delivery.deliveryId);
        summary.completed++;
      } catch (error) {
        const dead = error instanceof NonRetryableMessageError || delivery.attempt >= cfg.maxAttempts;
        await this.fail(delivery, error, dead, cfg.backoffBaseMs);
        summary[dead ? 'dead' : 'rescheduled']++;
      }
    }
    return summary;
  }

  private async claim(topic: string, batchSize: number, visibilitySeconds: number): Promise<Delivery[]> {
    const { rows } = await this.pool.query<{
      delivery_id: string;
      message_id: string;
      envelope: Envelope<unknown>;
      attempts: number;
    }>(
      `WITH candidates AS (
         SELECT delivery_id
           FROM queue_messages
          WHERE topic = $1
            AND (   (status = 'READY' AND available_at <= now())
                 OR (status = 'PROCESSING' AND locked_until < now()))
          ORDER BY delivery_id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE queue_messages q
          SET status = 'PROCESSING', attempts = q.attempts + 1,
              locked_until = now() + make_interval(secs => $3)
         FROM candidates c
        WHERE q.delivery_id = c.delivery_id
       RETURNING q.delivery_id, q.message_id, q.envelope, q.attempts`,
      [topic, batchSize, visibilitySeconds],
    );
    return rows
      .sort((a, b) => Number(a.delivery_id) - Number(b.delivery_id))
      .map((r) => ({
        deliveryId: r.delivery_id,
        messageId: r.message_id,
        envelope: r.envelope,
        attempt: r.attempts,
      }));
  }

  private async ack(deliveryId: string): Promise<void> {
    await this.pool.query(
      `UPDATE queue_messages SET status = 'DONE', done_at = now(), locked_until = NULL
        WHERE delivery_id = $1 AND status = 'PROCESSING'`,
      [deliveryId],
    );
  }

  private async fail(
    delivery: Delivery,
    error: unknown,
    dead: boolean,
    backoffBaseMs: number,
  ): Promise<void> {
    const delayMs = Math.min(backoffBaseMs * 2 ** (delivery.attempt - 1), 5 * 60_000);
    await this.pool.query(
      `UPDATE queue_messages
          SET status = $2, last_error = $3, locked_until = NULL,
              available_at = now() + make_interval(secs => $4)
        WHERE delivery_id = $1`,
      [
        delivery.deliveryId,
        dead ? 'DEAD' : 'READY',
        String((error as Error)?.message ?? error),
        delayMs / 1000,
      ],
    );
  }
}
