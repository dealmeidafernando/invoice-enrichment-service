import { Invoice } from '../entities/invoice.entity';
import { AccessKey } from '../value-objects/access-key';

export const INVOICE_REPOSITORY = Symbol('InvoiceRepository');

export interface InvoiceRepository {
  /**
   * Inserts unless the access key already exists. Uniqueness is enforced by a database
   * constraint, not by "check then insert". Returns the stored invoice (new or existing).
   */
  insertIfAbsent(invoice: Invoice): Promise<{ invoice: Invoice; created: boolean }>;

  findById(id: string): Promise<Invoice | null>;

  /** Locks the row until the transaction ends (SELECT ... FOR UPDATE). Must run inside a transaction. */
  findByAccessKeyForUpdate(accessKey: AccessKey): Promise<Invoice | null>;

  /** Persists the outcome only while the invoice is still in ANALISE. Returns false when nothing changed. */
  saveResult(invoice: Invoice): Promise<boolean>;
}
