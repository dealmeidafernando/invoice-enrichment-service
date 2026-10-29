import request from 'supertest';
import { TOPIC_ENRICHMENT_COMPLETED } from '../../src/application/contracts/messages';
import { ProcessEnrichmentResultUseCase } from '../../src/application/use-cases/process-enrichment-result.use-case';
import { INVOICE_REPOSITORY, InvoiceRepository } from '../../src/domain';
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

  describe('approval', () => {
    it('stays in ANALISE while the provider has not answered', async () => {
      const res = await register(newAccessKey()).expect(202);
      await t.runRelay();

      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'ANALISE', approvedAt: null });
    });

    it('moves to APROVADA with an approval date after a complete result', async () => {
      const res = await register(newAccessKey()).expect(202);
      await t.runFullFlow();

      const invoice = await getInvoice(res.body.id);
      expect(invoice).toMatchObject({
        status: 'APROVADA',
        rejectionReasons: [],
        cnpj: '12345678000190',
        amount: '1520.75',
        canceled: false,
      });
      expect(new Date(invoice.approvedAt).getTime()).not.toBeNaN();
    });
  });

  describe('rejection', () => {
    it('a canceled result moves to REJEITADA with reason INVOICE_CANCELED', async () => {
      const key = newAccessKey();
      t.provider.respondWith(key, { canceled: true });
      const res = await register(key).expect(202);
      await t.runFullFlow();

      expect(await getInvoice(res.body.id)).toMatchObject({
        status: 'REJEITADA',
        rejectionReasons: ['INVOICE_CANCELED'],
        approvedAt: null,
      });
    });

    it.each([
      ['CNPJ', { cnpj: null }, ['MISSING_CNPJ']],
      ['amount', { amount: null }, ['MISSING_AMOUNT']],
      ['issue date', { issueDate: null }, ['MISSING_ISSUE_DATE']],
      [
        'everything',
        { cnpj: null, amount: null, issueDate: null },
        ['MISSING_CNPJ', 'MISSING_AMOUNT', 'MISSING_ISSUE_DATE'],
      ],
    ])(
      'a result missing %s moves to REJEITADA with the matching reasons',
      async (_case, partial, reasons) => {
        const key = newAccessKey();
        t.provider.respondWith(key, partial);
        const res = await register(key).expect(202);
        await t.runFullFlow();

        expect(await getInvoice(res.body.id)).toMatchObject({
          status: 'REJEITADA',
          rejectionReasons: reasons,
          approvedAt: null,
        });
      },
    );
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

    it('a second request returns 200 with the same invoice, even after it was decided', async () => {
      const key = newAccessKey();
      const first = await register(key).expect(202);
      await t.runFullFlow();

      const second = await register(key).expect(200);
      expect(second.body).toMatchObject({ id: first.body.id, status: 'APROVADA' });
      expect(await count('outbox')).toBe(1);
    });
  });

  describe('idempotent consumption (redelivery)', () => {
    it('the same inbound message delivered twice changes the invoice only once', async () => {
      const key = newAccessKey();
      const res = await register(key).expect(202);
      const result = await t.provider.publishResult(key);
      await t.queue.publish(TOPIC_ENRICHMENT_COMPLETED, result); // broker redelivers the same messageId
      const spy = jest.spyOn(t.app.get(ProcessEnrichmentResultUseCase), 'execute');

      expect(await t.runConsumer()).toEqual({ completed: 2, rescheduled: 0, dead: 0 });

      expect(await Promise.all(spy.mock.results.map((r) => r.value))).toEqual(['APPROVED', 'DUPLICATE']);
      const invoice = await getInvoice(res.body.id);
      expect(invoice.status).toBe('APROVADA');
      expect(await count('processed_messages')).toBe(1);
    });

    it('the same inbound message delivered twice in parallel changes the invoice only once', async () => {
      const key = newAccessKey();
      await register(key).expect(202);
      const result = await t.provider.publishResult(key);
      await t.queue.publish(TOPIC_ENRICHMENT_COMPLETED, result);
      const spy = jest.spyOn(t.app.get(ProcessEnrichmentResultUseCase), 'execute');

      // Two consumers, one delivery each, running at the same time.
      const one = { batchSize: 1, backoffBaseMs: 0 };
      await Promise.all([
        t.queue.consumeBatch(TOPIC_ENRICHMENT_COMPLETED, (d) => t.consumer.handle(d), one),
        t.queue.consumeBatch(TOPIC_ENRICHMENT_COMPLETED, (d) => t.consumer.handle(d), one),
      ]);

      const outcomes = await Promise.all(spy.mock.results.map((r) => r.value));
      expect(outcomes.sort()).toEqual(['APPROVED', 'DUPLICATE']);
    });

    it('a second, different result for the same key is ignored (terminal status)', async () => {
      const key = newAccessKey();
      const res = await register(key).expect(202);
      await t.runFullFlow();
      const approved = await getInvoice(res.body.id);

      t.provider.respondWith(key, { canceled: true });
      await t.provider.publishResult(key);
      await t.runConsumer();

      expect(await getInvoice(res.body.id)).toEqual(approved);
    });

    it('an inbound message for an unknown key ends without writing anything (not even the inbox)', async () => {
      await t.provider.publishResult(newAccessKey());

      expect(await t.runConsumer()).toEqual({ completed: 1, rescheduled: 0, dead: 0 });
      expect(await count('invoices')).toBe(0);
      expect(await count('processed_messages')).toBe(0);
    });
  });

  describe('failures', () => {
    it('a publish failure neither loses nor approves the invoice; the message goes out on retry', async () => {
      const res = await register(newAccessKey()).expect(202);
      jest.spyOn(t.queue, 'publish').mockRejectedValueOnce(new Error('broker unavailable'));

      await t.runRelay();
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'ANALISE' });
      expect((await t.pool.query(`SELECT status, attempts FROM outbox`)).rows[0]).toEqual({
        status: 'PENDING',
        attempts: 1,
      });

      await t.runFullFlow();
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'APROVADA' });
    });

    it('a failure while processing the result triggers a redelivery that approves the invoice once', async () => {
      const res = await register(newAccessKey()).expect(202);
      await t.runRelay();
      await t.runProvider();
      const useCase = t.app.get(ProcessEnrichmentResultUseCase);
      jest.spyOn(useCase, 'execute').mockRejectedValueOnce(new Error('database blip'));

      expect(await t.runConsumer()).toEqual({ completed: 0, rescheduled: 1, dead: 0 });
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'ANALISE' });
      expect(await queueStatus(TOPIC_ENRICHMENT_COMPLETED)).toEqual(['READY']);

      expect(await t.runConsumer()).toEqual({ completed: 1, rescheduled: 0, dead: 0 });
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'APROVADA' });
      const { rows } = await t.pool.query(`SELECT attempts FROM queue_messages WHERE topic = $1`, [
        TOPIC_ENRICHMENT_COMPLETED,
      ]);
      expect(rows[0].attempts).toBe(2);
    });

    it('a failure after the inbox write rolls it back, so the redelivery is still processed', async () => {
      const res = await register(newAccessKey()).expect(202);
      await t.runRelay();
      await t.runProvider();
      // Fails inside the transaction, after the inbox insert: everything must roll back.
      jest
        .spyOn(t.app.get<InvoiceRepository>(INVOICE_REPOSITORY), 'saveResult')
        .mockRejectedValueOnce(new Error('write failed'));

      expect(await t.runConsumer()).toMatchObject({ rescheduled: 1 });
      expect(await count('processed_messages')).toBe(0);

      expect(await t.runConsumer()).toMatchObject({ completed: 1 });
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'APROVADA' });
    });

    it('an inbound message with an invalid contract goes to DEAD without changing the invoice', async () => {
      const key = newAccessKey();
      const res = await register(key).expect(202);
      t.provider.respondWith(key, { amount: '1520,75' });
      await t.provider.publishResult(key);

      expect(await t.runConsumer()).toEqual({ completed: 0, rescheduled: 0, dead: 1 });
      expect(await queueStatus(TOPIC_ENRICHMENT_COMPLETED)).toEqual(['DEAD']);
      expect(await getInvoice(res.body.id)).toMatchObject({ status: 'ANALISE' });
    });
  });
});
