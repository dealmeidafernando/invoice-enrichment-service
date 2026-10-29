import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CONTRACT_VERSION,
  EnrichmentCompletedPayload,
  EnrichmentRequestedPayload,
  Envelope,
  TOPIC_ENRICHMENT_COMPLETED,
} from '../../application/contracts/messages';
import { Delivery, TableQueue } from './table-queue';

type FakeResult = Omit<EnrichmentCompletedPayload, 'accessKey'>;

const COMPLETE_RESULT: FakeResult = {
  cnpj: '12345678000190',
  amount: '1520.75',
  issueDate: '2026-10-01T12:00:00-03:00',
  canceled: false,
};

/**
 * Simulates the external provider: consumes the outbound message and publishes the inbound one.
 * Not part of the service in production; used by the tests and the docker compose demo.
 */
@Injectable()
export class FakeProvider {
  private readonly responses = new Map<string, FakeResult>();

  constructor(private readonly queue: TableQueue) {}

  /** Sets what the provider answers for an access key. Default: a complete result. */
  respondWith(accessKey: string, result: Partial<FakeResult>): void {
    this.responses.set(accessKey, { ...COMPLETE_RESULT, ...result });
  }

  async handle(delivery: Delivery): Promise<void> {
    const request = delivery.envelope as Envelope<EnrichmentRequestedPayload>;
    await this.publishResult(request.payload.accessKey, request.correlationId);
  }

  async publishResult(
    accessKey: string,
    correlationId: string = randomUUID(),
  ): Promise<Envelope<EnrichmentCompletedPayload>> {
    const envelope: Envelope<EnrichmentCompletedPayload> = {
      messageId: randomUUID(),
      type: TOPIC_ENRICHMENT_COMPLETED,
      version: CONTRACT_VERSION,
      occurredAt: new Date().toISOString(),
      correlationId,
      payload: { accessKey, ...(this.responses.get(accessKey) ?? COMPLETE_RESULT) },
    };
    await this.queue.publish(TOPIC_ENRICHMENT_COMPLETED, envelope);
    return envelope;
  }
}
