import request from 'supertest';
import { generateAccessKey, newAccessKey } from '../support/access-keys';
import { createTestApp, TestApp } from '../support/app';
import { cleanDatabase } from '../support/db';

describe('Invoice flow (API + real Postgres)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => cleanDatabase(t.pool));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => t.close());

  const http = () => request(t.app.getHttpServer());
  const register = (accessKey: unknown) => http().post('/invoices').send({ accessKey });
  const getInvoice = async (id: string) => (await http().get(`/invoices/${id}`).expect(200)).body;
  const count = async (table: string) =>
    (await t.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
  const queueStatus = async (topic: string) =>
    (
      await t.pool.query(`SELECT status FROM queue_messages WHERE topic = $1 ORDER BY delivery_id`, [topic])
    ).rows.map((r) => r.status);

  describe('creation', () => {
    it('stores the invoice in ANALISE, with no approval date, and returns 202 with Location', async () => {
      const key = newAccessKey();
      const res = await register(key).expect(202);

      expect(res.body).toMatchObject({
        accessKey: key,
        status: 'ANALISE',
        approvedAt: null,
        rejectionReasons: [],
      });
      expect(res.headers.location).toBe(`/invoices/${res.body.id}`);
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'ANALISE', approvedAt: null });
    });

    it('writes the outbound message to the outbox in the same request, and the relay publishes it', async () => {
      const key = newAccessKey();
      const res = await register(key).set('x-correlation-id', 'corr-123').expect(202);

      const { rows } = await t.pool.query(`SELECT status, envelope FROM outbox`);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('PENDING');
      expect(rows[0].envelope).toMatchObject({
        type: 'invoice.enrichment.requested',
        version: 1,
        correlationId: 'corr-123',
        payload: { invoiceId: res.body.id, accessKey: key },
      });
      // The request never talks to the broker.
      expect(await count('queue_messages')).toBe(0);

      await t.runRelay();
      expect(await queueStatus('invoice.enrichment.requested')).toEqual(['READY']);
    });

    it.each([
      ['too short', '123'],
      [
        'wrong check digit',
        generateAccessKey(1).slice(0, 43) + ((Number(generateAccessKey(1)[43]) + 1) % 10),
      ],
      ['not a string', 123],
      ['missing', undefined],
    ])('an invalid access key (%s) returns 400 and writes nothing', async (_case, key) => {
      const res = await register(key).expect(400);

      expect(res.body.code).toBe('INVALID_ACCESS_KEY');
      expect(await count('invoices')).toBe(0);
      expect(await count('outbox')).toBe(0);
    });
  });

  describe('idempotent intake', () => {
    it('concurrent requests with the same key create one invoice and one outbound message', async () => {
      const key = newAccessKey();
      const responses = await Promise.all(Array.from({ length: 10 }, () => register(key)));

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 200, 200, 200, 200, 200, 200, 200, 200, 202,
      ]);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await count('invoices')).toBe(1);
      expect(await count('outbox')).toBe(1);
    });

    it('a second request returns 200 with the same invoice and writes no new message', async () => {
      const key = newAccessKey();
      const first = await register(key).expect(202);

      const second = await register(key).expect(200);
      expect(second.body).toEqual(first.body);
      expect(second.headers.location).toBe(`/invoices/${first.body.id}`);
      expect(await count('outbox')).toBe(1);
    });
  });
});
