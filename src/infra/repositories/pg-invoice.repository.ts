import { Injectable } from '@nestjs/common';
import { AccessKey, Invoice, InvoiceRepository, InvoiceStatus, Money, RejectionReason } from '../../domain';
import { Database } from '../database/database';

interface InvoiceRow {
  id: string;
  access_key: string;
  status: InvoiceStatus;
  rejection_reasons: RejectionReason[];
  cnpj: string | null;
  amount: string | null;
  issued_at: Date | null;
  canceled: boolean | null;
  approved_at: Date | null;
  processed_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, access_key, status, rejection_reasons, cnpj, amount, issued_at,
  canceled, approved_at, processed_at, created_at`;

@Injectable()
export class PgInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Database) {}

  async insertIfAbsent(invoice: Invoice): Promise<{ invoice: Invoice; created: boolean }> {
    // ON CONFLICT waits for a concurrent transaction inserting the same key:
    // if it commits we fall into DO NOTHING; if it rolls back, this INSERT goes through.
    const inserted = await this.db.query<InvoiceRow>(
      `INSERT INTO invoices (id, access_key, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (access_key) DO NOTHING
       RETURNING ${COLUMNS}`,
      [invoice.id, invoice.accessKey.value, invoice.status, invoice.createdAt],
    );
    if (inserted.rows[0]) {
      return { invoice: this.toDomain(inserted.rows[0]), created: true };
    }
    const { rows } = await this.db.query<InvoiceRow>(
      `SELECT ${COLUMNS} FROM invoices WHERE access_key = $1`,
      [invoice.accessKey.value],
    );
    return { invoice: this.toDomain(rows[0]), created: false };
  }

  async findById(id: string): Promise<Invoice | null> {
    const { rows } = await this.db.query<InvoiceRow>(`SELECT ${COLUMNS} FROM invoices WHERE id = $1`, [id]);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findByAccessKeyForUpdate(accessKey: AccessKey): Promise<Invoice | null> {
    this.db.assertInTransaction('findByAccessKeyForUpdate');
    const { rows } = await this.db.query<InvoiceRow>(
      `SELECT ${COLUMNS} FROM invoices WHERE access_key = $1 FOR UPDATE`,
      [accessKey.value],
    );
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async saveResult(invoice: Invoice): Promise<boolean> {
    // The status guard in the WHERE clause never overwrites a terminal status, even with a stale instance.
    const { rowCount } = await this.db.query(
      `UPDATE invoices
          SET status = $2, rejection_reasons = $3, cnpj = $4, amount = $5, issued_at = $6,
              canceled = $7, approved_at = $8, processed_at = $9, updated_at = now()
        WHERE id = $1 AND status = 'ANALISE'`,
      [
        invoice.id,
        invoice.status,
        [...invoice.rejectionReasons],
        invoice.cnpj,
        invoice.amount?.toDecimal() ?? null,
        invoice.issuedAt,
        invoice.canceled,
        invoice.approvedAt,
        invoice.processedAt,
      ],
    );
    return rowCount === 1;
  }

  private toDomain(row: InvoiceRow): Invoice {
    return Invoice.restore({
      id: row.id,
      accessKey: AccessKey.create(row.access_key),
      status: row.status,
      rejectionReasons: row.rejection_reasons,
      cnpj: row.cnpj,
      amount: row.amount === null ? null : Money.fromDecimal(row.amount),
      issuedAt: row.issued_at,
      canceled: row.canceled,
      approvedAt: row.approved_at,
      processedAt: row.processed_at,
      createdAt: row.created_at,
    });
  }
}
