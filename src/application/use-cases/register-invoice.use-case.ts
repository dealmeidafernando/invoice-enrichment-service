import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AccessKey,
  Invoice,
  INVOICE_REPOSITORY,
  InvoiceRepository,
  OUTBOX_REPOSITORY,
  OutboxRepository,
  TRANSACTION_MANAGER,
  TransactionManager,
} from '../../domain';
import {
  CONTRACT_VERSION,
  EnrichmentRequestedPayload,
  Envelope,
  TOPIC_ENRICHMENT_REQUESTED,
} from '../contracts/messages';

export interface RegisterInvoiceInput {
  accessKey: unknown;
  correlationId: string;
}

export interface RegisterInvoiceOutput {
  invoice: Invoice;
  /** false when the key already existed: the same invoice is returned and no new message is written. */
  created: boolean;
}

@Injectable()
export class RegisterInvoiceUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transaction: TransactionManager,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: RegisterInvoiceInput): Promise<RegisterInvoiceOutput> {
    // Throws InvalidAccessKeyError before touching the database (HTTP 400).
    const accessKey = AccessKey.create(input.accessKey);
    const candidate = Invoice.create({ id: randomUUID(), accessKey, now: new Date() });

    // Invoice and outbound message commit together. The broker is never called here.
    return this.transaction.run(async () => {
      const { invoice, created } = await this.invoices.insertIfAbsent(candidate);
      if (created) {
        const envelope: Envelope<EnrichmentRequestedPayload> = {
          messageId: randomUUID(),
          type: TOPIC_ENRICHMENT_REQUESTED,
          version: CONTRACT_VERSION,
          occurredAt: new Date().toISOString(),
          correlationId: input.correlationId,
          payload: { invoiceId: invoice.id, accessKey: invoice.accessKey.value },
        };
        await this.outbox.add({ messageId: envelope.messageId, topic: envelope.type, body: envelope });
      }
      return { invoice, created };
    });
  }
}
