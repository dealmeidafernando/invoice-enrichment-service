/** A redelivery carries the same `messageId`: consumers deduplicate on it. */
export interface Envelope<T> {
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  payload: T;
}

export const CONTRACT_VERSION = 1;

export const TOPIC_ENRICHMENT_REQUESTED = 'invoice.enrichment.requested';

export const TOPIC_ENRICHMENT_COMPLETED = 'invoice.enrichment.completed';

export interface EnrichmentRequestedPayload {
  invoiceId: string;
  accessKey: string;
}

/** `amount` is a decimal string ("1520.75") so JSON never rounds it; `issueDate` is ISO 8601. */
export interface EnrichmentCompletedPayload {
  accessKey: string;
  cnpj: string | null;
  amount: string | null;
  issueDate: string | null;
  canceled: boolean;
}
