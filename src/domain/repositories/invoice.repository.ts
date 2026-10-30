import { Invoice } from '../entities/invoice.entity';
import { AccessKey } from '../value-objects/access-key';

export const INVOICE_REPOSITORY = Symbol('InvoiceRepository');

export interface InvoiceRepository {
  /** Must be atomic: concurrent calls with the same key store a single invoice. */
  insertIfAbsent(invoice: Invoice): Promise<{ invoice: Invoice; created: boolean }>;

  findById(id: string): Promise<Invoice | null>;

  /** Must run inside a transaction: the invoice stays locked until it ends. */
  findByAccessKeyForUpdate(accessKey: AccessKey): Promise<Invoice | null>;

  /** Writes only while the invoice is still in ANALISE; returns false otherwise. */
  saveResult(invoice: Invoice): Promise<boolean>;
}
