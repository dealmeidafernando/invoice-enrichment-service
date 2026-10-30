import { Pool } from 'pg';
import { Database } from '../../src/infra/database/database';
import { OutboxRelay } from '../../src/infra/messaging/outbox-relay';
import { TableQueue } from '../../src/infra/messaging/table-queue';
import { PgOutboxRepository } from '../../src/infra/repositories/pg-message.repository';
import { cleanDatabase, createTestPool, envelope, sleep } from '../support/db';

const TOPIC = 'test.relay';

describe('OutboxRelay (real Postgres)', () => {
  let pool: Pool;
  let db: Database;
  let outbox: PgOutboxRepository;
  let queue: TableQueue;

  beforeAll(() => {
    pool = createTestPool();
    db = new Database(pool);
    outbox = new PgOutboxRepository(db);
  });
  beforeEach(async () => {
    await cleanDatabase(pool);
    queue = new TableQueue(pool);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => pool.end());

  const writeToOutbox = async () => {
    const env = envelope(TOPIC, { x: 1 });
    await db.run(() => outbox.add({ messageId: env.messageId, topic: TOPIC, body: env }));
    return env;
  };

  // Complements required test 1 — the outbound message leaves the outbox and reaches the queue
  it('publishes pending messages and marks them PUBLISHED', async () => {
    const env = await writeToOutbox();

    expect(await new OutboxRelay(pool, queue).publishPending()).toEqual({ published: 1, failed: 0 });

    const { rows: out } = await pool.query(`SELECT status, published_at FROM outbox WHERE id = $1`, [
      env.messageId,
    ]);
    expect(out[0].status).toBe('PUBLISHED');
    expect(out[0].published_at).not.toBeNull();
    const { rows: queued } = await pool.query(`SELECT envelope FROM queue_messages WHERE message_id = $1`, [
      env.messageId,
    ]);
    expect(queued[0].envelope).toEqual(env);
  });

  it('a publish failure does not lose the message: it stays PENDING and goes out on retry', async () => {
    const env = await writeToOutbox();
    jest.spyOn(queue, 'publish').mockRejectedValueOnce(new Error('broker unavailable'));
    const relay = new OutboxRelay(pool, queue);

    expect(await relay.publishPending(50, 0)).toEqual({ published: 0, failed: 1 });
    const { rows } = await pool.query(`SELECT status, attempts, last_error FROM outbox WHERE id = $1`, [
      env.messageId,
    ]);
    expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'broker unavailable' });
    expect((await pool.query(`SELECT 1 FROM queue_messages`)).rowCount).toBe(0);

    expect(await relay.publishPending(50, 0)).toEqual({ published: 1, failed: 0 });
    expect(
      (await pool.query(`SELECT 1 FROM queue_messages WHERE message_id = $1`, [env.messageId])).rowCount,
    ).toBe(1);
  });

  it('concurrent relays never publish the same row twice', async () => {
    for (let i = 0; i < 10; i++) await writeToOutbox();
    const publish = queue.publish.bind(queue);
    // A slow publish keeps the rows locked, so the three relays really compete for them.
    jest.spyOn(queue, 'publish').mockImplementation(async (topic, env) => {
      await sleep(10);
      await publish(topic, env);
    });

    await Promise.all([1, 2, 3].map(() => new OutboxRelay(pool, queue).publishPending()));

    const { rows } = await pool.query(
      `SELECT count(*)::int AS total, count(DISTINCT message_id)::int AS distinct_messages FROM queue_messages`,
    );
    expect(rows[0]).toEqual({ total: 10, distinct_messages: 10 });
  });
});
