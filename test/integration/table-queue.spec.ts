import { Pool } from 'pg';

import { Delivery, NonRetryableMessageError, TableQueue } from '../../src/infra/messaging/table-queue';
import { cleanDatabase, createTestPool, envelope, sleep } from '../support/db';

const TOPIC = 'test.queue';
const NO_BACKOFF = { backoffBaseMs: 0 };

describe('Table queue (real Postgres)', () => {
  let pool: Pool;
  let queue: TableQueue;

  beforeAll(() => {
    pool = createTestPool();
    queue = new TableQueue(pool);
  });
  beforeEach(() => cleanDatabase(pool));
  afterAll(() => pool.end());

  const stateOf = async (messageId: string) =>
    (
      await pool.query(`SELECT status, attempts, last_error FROM queue_messages WHERE message_id = $1`, [
        messageId,
      ])
    ).rows;

  it('delivers the message to the handler and acks after it finishes', async () => {
    const msg = envelope(TOPIC, { n: 1 });
    await queue.publish(TOPIC, msg);

    const received: Delivery[] = [];
    const summary = await queue.consumeBatch(TOPIC, async (d) => void received.push(d));

    expect(summary).toEqual({ completed: 1, rescheduled: 0, dead: 0 });
    expect(received[0].messageId).toBe(msg.messageId);
    expect(received[0].envelope).toEqual(msg);
    expect(received[0].attempt).toBe(1);
    expect((await stateOf(msg.messageId))[0].status).toBe('DONE');
  });

  // Complements required test 5 — a failed delivery comes back (redelivery)
  it('redelivers the message when the handler fails', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);

    let calls = 0;
    const handler = async () => {
      calls++;
      if (calls === 1) throw new Error('database unavailable');
    };

    expect(await queue.consumeBatch(TOPIC, handler, NO_BACKOFF)).toEqual({
      completed: 0,
      rescheduled: 1,
      dead: 0,
    });
    expect((await stateOf(msg.messageId))[0]).toMatchObject({
      status: 'READY',
      last_error: 'database unavailable',
    });

    expect(await queue.consumeBatch(TOPIC, handler, NO_BACKOFF)).toEqual({
      completed: 1,
      rescheduled: 0,
      dead: 0,
    });
    expect(calls).toBe(2);
    expect((await stateOf(msg.messageId))[0]).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  it('honors the backoff: does not redeliver too early', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);
    await queue.consumeBatch(
      TOPIC,
      async () => {
        throw new Error('x');
      },
      { backoffBaseMs: 60_000 },
    );

    const handler = jest.fn();
    await queue.consumeBatch(TOPIC, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('moves to DEAD after the maximum number of attempts', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);
    const alwaysFails = async () => {
      throw new Error('always fails');
    };

    for (let i = 0; i < 3; i++) {
      await queue.consumeBatch(TOPIC, alwaysFails, { ...NO_BACKOFF, maxAttempts: 3 });
    }
    expect((await stateOf(msg.messageId))[0]).toMatchObject({ status: 'DEAD', attempts: 3 });

    const handler = jest.fn();
    await queue.consumeBatch(TOPIC, handler, NO_BACKOFF);
    expect(handler).not.toHaveBeenCalled();
  });

  it('sends a non-retryable error straight to DEAD', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);

    const summary = await queue.consumeBatch(TOPIC, async () => {
      throw new NonRetryableMessageError('invalid contract');
    });

    expect(summary.dead).toBe(1);
    expect((await stateOf(msg.messageId))[0]).toMatchObject({ status: 'DEAD', attempts: 1 });
  });

  it('recovers a delivery claimed by a process that died (visibility expired)', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);
    // Simulates a consumer that claimed and crashed without acking.
    await pool.query(
      `UPDATE queue_messages SET status = 'PROCESSING', attempts = 1,
              locked_until = now() - interval '1 second' WHERE message_id = $1`,
      [msg.messageId],
    );

    const received: Delivery[] = [];
    await queue.consumeBatch(TOPIC, async (d) => void received.push(d));

    expect(received).toHaveLength(1);
    expect(received[0].attempt).toBe(2);
  });

  it("does not take another consumer's claim while it is valid", async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);
    await pool.query(
      `UPDATE queue_messages SET status = 'PROCESSING', locked_until = now() + interval '1 minute'
        WHERE message_id = $1`,
      [msg.messageId],
    );

    const handler = jest.fn();
    await queue.consumeBatch(TOPIC, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('concurrent consumers never process the same delivery', async () => {
    const total = 30;
    for (let i = 0; i < total; i++) await queue.publish(TOPIC, envelope(TOPIC, { i }));

    const processed: string[] = [];
    const handler = async (d: Delivery) => {
      await sleep(5);
      processed.push(d.deliveryId);
    };
    const drain = async () => {
      while ((await queue.consumeBatch(TOPIC, handler, { batchSize: 4 })).completed > 0) {
        // Keep going until the queue is empty.
      }
    };
    await Promise.all([drain(), drain(), drain()]);

    expect(processed).toHaveLength(total);
    expect(new Set(processed).size).toBe(total);
  });

  // Complements required test 5 — the queue really delivers the same message twice
  it('the same message published twice becomes two deliveries (at-least-once)', async () => {
    const msg = envelope(TOPIC, {});
    await queue.publish(TOPIC, msg);
    await queue.publish(TOPIC, msg);

    const received: string[] = [];
    await queue.consumeBatch(TOPIC, async (d) => void received.push(d.messageId));

    // The queue does not deduplicate. The consumer does (inbox).
    expect(received).toEqual([msg.messageId, msg.messageId]);
  });

  it('only consumes the requested topic', async () => {
    await queue.publish('other.topic', envelope('other.topic', {}));
    const handler = jest.fn();
    await queue.consumeBatch(TOPIC, handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
