import { Inject, Injectable } from '@nestjs/common';
import {
  EnrichmentDecision,
  EnrichmentResult,
  INBOX_REPOSITORY,
  InboxRepository,
  INVOICE_REPOSITORY,
  InvoiceRepository,
  TRANSACTION_MANAGER,
  TransactionManager,
} from '../../domain';

export const ENRICHMENT_RESULT_CONSUMER = 'process-enrichment-result';

export interface ProcessEnrichmentResultInput {
  messageId: string;
  result: EnrichmentResult;
}

export type ProcessEnrichmentResultOutput = EnrichmentDecision | 'INVOICE_NOT_FOUND' | 'DUPLICATE';

@Injectable()
export class ProcessEnrichmentResultUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transaction: TransactionManager,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(INBOX_REPOSITORY) private readonly inbox: InboxRepository,
  ) {}

  execute(input: ProcessEnrichmentResultInput): Promise<ProcessEnrichmentResultOutput> {
    return this.transaction.run(async () => {
      // Lock first: two concurrent deliveries of the same message are serialized here,
      // and the second one finds the messageId already in the inbox.
      const invoice = await this.invoices.findByAccessKeyForUpdate(input.result.accessKey);
      if (!invoice) return 'INVOICE_NOT_FOUND';

      if (!(await this.inbox.registerIfNew(ENRICHMENT_RESULT_CONSUMER, input.messageId))) {
        return 'DUPLICATE';
      }

      const decision = invoice.applyResult(input.result, new Date());
      if (decision !== 'IGNORED' && !(await this.invoices.saveResult(invoice))) {
        throw new Error(`Invoice ${invoice.id} left ANALISE while locked.`);
      }
      return decision;
    });
  }
}
