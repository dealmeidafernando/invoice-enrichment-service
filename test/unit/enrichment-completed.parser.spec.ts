import { randomUUID } from 'node:crypto';
import { TOPIC_ENRICHMENT_COMPLETED } from '../../src/application/contracts/messages';
import { NonRetryableMessageError } from '../../src/infra/messaging/table-queue';
import { parseEnrichmentCompleted } from '../../src/infra/messaging/enrichment-completed.consumer';
import { generateAccessKey } from '../support/access-keys';

const accessKey = generateAccessKey(42);

function message(payload: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) {
  return {
    messageId: randomUUID(),
    type: TOPIC_ENRICHMENT_COMPLETED,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload: {
      accessKey,
      cnpj: '12.345.678/0001-90',
      amount: '1520.75',
      issueDate: '2026-10-01T12:00:00-03:00',
      canceled: false,
      ...payload,
    },
    ...envelope,
  };
}

describe('parseEnrichmentCompleted', () => {
  it('converts a complete result to domain types', () => {
    const { result } = parseEnrichmentCompleted(message());
    expect(result.accessKey.value).toBe(accessKey);
    expect(result.cnpj).toBe('12345678000190');
    expect(result.amount?.toDecimal()).toBe('1520.75');
    expect(result.issuedAt?.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(result.canceled).toBe(false);
  });

  it('a missing field becomes null: a business outcome, not a contract error', () => {
    const { result } = parseEnrichmentCompleted(message({ cnpj: null, amount: undefined, issueDate: '' }));
    expect(result.cnpj).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.issuedAt).toBeNull();
  });

  it.each<[string, unknown]>([
    ['a non-object envelope', 'text'],
    ['an invalid messageId', message({}, { messageId: '123' })],
    ['a wrong type', message({}, { type: 'other' })],
    ['an unknown version', message({}, { version: 2 })],
    ['a missing payload', message({}, { payload: null })],
    ['a missing canceled flag', message({ canceled: undefined })],
    ['canceled as a string', message({ canceled: 'false' })],
    ['an invalid access key', message({ accessKey: '123' })],
    ['a 13-digit CNPJ', message({ cnpj: '1234567800019' })],
    ['amount as a number', message({ amount: 1520.75 })],
    ['amount with a comma', message({ amount: '1520,75' })],
    ['an unreadable date', message({ issueDate: 'yesterday' })],
  ])('rejects %s as non-retryable', (_case, input) => {
    expect(() => parseEnrichmentCompleted(input)).toThrow(NonRetryableMessageError);
  });
});
