/**
 * Envelope shared by every message. `messageId` is the message identity: a redelivery
 * carries the same messageId, and that is what the consumer deduplicates on.
 */
export interface Envelope<T> {
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  payload: T;
}

export const CONTRACT_VERSION = 1;

/** Outbound: the service asks the provider to enrich an invoice. */
export const TOPIC_ENRICHMENT_REQUESTED = 'invoice.enrichment.requested';

/** Inbound: the provider returns the lookup result for an access key. */
export const TOPIC_ENRICHMENT_COMPLETED = 'invoice.enrichment.completed';

export interface EnrichmentRequestedPayload {
  invoiceId: string;
  accessKey: string;
}

/**
 * Missing fields come as `null`; `canceled` is required.
 * `amount` is a decimal string ("1520.75") so JSON does not lose precision.
 * `issueDate` is ISO 8601.
 */
export interface EnrichmentCompletedPayload {
  accessKey: string;
  cnpj: string | null;
  amount: string | null;
  issueDate: string | null;
  canceled: boolean;
}
