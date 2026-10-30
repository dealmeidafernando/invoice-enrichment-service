import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CONTRACT_VERSION, TOPIC_ENRICHMENT_COMPLETED } from '../../application/contracts/messages';
import { ProcessEnrichmentResultUseCase } from '../../application/use-cases/process-enrichment-result.use-case';
import { AccessKey, DomainError, EnrichmentResult, Money } from '../../domain';
import { Delivery, NonRetryableMessageError } from './table-queue';

/** `null`, absent or "" all mean "not informed". Any other non-string is a contract error. */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null));

const envelopeSchema = z.object({
  messageId: z.string().uuid(),
  type: z.literal(TOPIC_ENRICHMENT_COMPLETED),
  version: z.literal(CONTRACT_VERSION),
  correlationId: z.string().nullish(),
  payload: z.object({
    accessKey: z.string(),
    cnpj: optionalText,
    amount: optionalText,
    issueDate: optionalText,
    canceled: z.boolean(),
  }),
});

function invalidContract(reason: string): never {
  throw new NonRetryableMessageError(`Invalid contract on ${TOPIC_ENRICHMENT_COMPLETED}: ${reason}`);
}

/**
 * A malformed message is a contract error and goes to DEAD.
 * A missing field is a valid result: the domain rejects the invoice.
 */
export function parseEnrichmentCompleted(envelope: unknown): {
  messageId: string;
  correlationId: string | null;
  result: EnrichmentResult;
} {
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    invalidContract(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'envelope'}: ${i.message}`).join('; '),
    );
  }
  const { messageId, correlationId, payload } = parsed.data;

  try {
    const cnpj = payload.cnpj?.replace(/[.\-/]/g, '') ?? null;
    if (cnpj !== null && !/^\d{14}$/.test(cnpj)) invalidContract('cnpj must have 14 digits');

    const issuedAt = payload.issueDate === null ? null : new Date(payload.issueDate);
    if (issuedAt && Number.isNaN(issuedAt.getTime())) invalidContract('issueDate must be ISO 8601');

    return {
      messageId,
      correlationId: correlationId ?? null,
      result: {
        accessKey: AccessKey.create(payload.accessKey),
        cnpj,
        amount: payload.amount === null ? null : Money.fromDecimal(payload.amount),
        issuedAt,
        canceled: payload.canceled,
      },
    };
  } catch (error) {
    // Invalid data will not become valid on retry: send it straight to DEAD.
    if (error instanceof DomainError) invalidContract(error.message);
    throw error;
  }
}

@Injectable()
export class EnrichmentCompletedConsumer {
  private readonly logger = new Logger(EnrichmentCompletedConsumer.name);

  constructor(private readonly processResult: ProcessEnrichmentResultUseCase) {}

  async handle(delivery: Delivery): Promise<void> {
    const { messageId, correlationId, result } = parseEnrichmentCompleted(delivery.envelope);
    const outcome = await this.processResult.execute({ messageId, result });
    this.logger.log(
      JSON.stringify({
        event: 'enrichment.processed',
        outcome,
        messageId,
        correlationId,
        accessKey: result.accessKey.value,
        attempt: delivery.attempt,
      }),
    );
  }
}
