import {
  AccessKey,
  EnrichmentResult,
  Invoice,
  InvoiceStatus,
  Money,
  RejectionReason,
  ResultForAnotherInvoiceError,
} from '../../src/domain';
import { generateAccessKey } from '../support/access-keys';

const CREATED_AT = new Date('2026-10-28T10:00:00Z');
const PROCESSED_AT = new Date('2026-10-28T10:05:00Z');
const accessKey = AccessKey.create(generateAccessKey(10));

function newInvoice(): Invoice {
  return Invoice.create({ id: 'invoice-1', accessKey, now: CREATED_AT });
}

function result(partial: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    accessKey,
    cnpj: '12345678000190',
    amount: Money.fromDecimal('1520.75'),
    issuedAt: new Date('2026-10-01T12:00:00-03:00'),
    canceled: false,
    ...partial,
  };
}

describe('Invoice', () => {
  describe('creation', () => {
    it('starts in ANALISE, with no approval date and no provider data', () => {
      const invoice = newInvoice();
      expect(invoice.status).toBe(InvoiceStatus.ANALISE);
      expect(invoice.approvedAt).toBeNull();
      expect(invoice.rejectionReasons).toEqual([]);
      expect(invoice.cnpj).toBeNull();
      expect(invoice.amount).toBeNull();
      expect(invoice.createdAt).toEqual(CREATED_AT);
    });
  });

  describe('approval', () => {
    it('approves when the result has CNPJ, amount and issue date and is not canceled', () => {
      const invoice = newInvoice();
      const decision = invoice.applyResult(result(), PROCESSED_AT);

      expect(decision).toBe('APPROVED');
      expect(invoice.status).toBe(InvoiceStatus.APROVADA);
      expect(invoice.approvedAt).toEqual(PROCESSED_AT);
      expect(invoice.rejectionReasons).toEqual([]);
      expect(invoice.cnpj).toBe('12345678000190');
      expect(invoice.amount?.toDecimal()).toBe('1520.75');
    });
  });

  describe('rejection', () => {
    it.each<[string, Partial<EnrichmentResult>, RejectionReason[]]>([
      ['canceled', { canceled: true }, [RejectionReason.INVOICE_CANCELED]],
      ['without CNPJ', { cnpj: null }, [RejectionReason.MISSING_CNPJ]],
      ['with empty CNPJ', { cnpj: '' }, [RejectionReason.MISSING_CNPJ]],
      ['without amount', { amount: null }, [RejectionReason.MISSING_AMOUNT]],
      ['without issue date', { issuedAt: null }, [RejectionReason.MISSING_ISSUE_DATE]],
      [
        'canceled and empty',
        { canceled: true, cnpj: null, amount: null, issuedAt: null },
        [
          RejectionReason.INVOICE_CANCELED,
          RejectionReason.MISSING_CNPJ,
          RejectionReason.MISSING_AMOUNT,
          RejectionReason.MISSING_ISSUE_DATE,
        ],
      ],
    ])('rejects a result %s and records the reason', (_case, partial, reasons) => {
      const invoice = newInvoice();
      const decision = invoice.applyResult(result(partial), PROCESSED_AT);

      expect(decision).toBe('REJECTED');
      expect(invoice.status).toBe(InvoiceStatus.REJEITADA);
      expect(invoice.rejectionReasons).toEqual(reasons);
      expect(invoice.approvedAt).toBeNull();
      expect(invoice.processedAt).toEqual(PROCESSED_AT);
    });

    it('keeps the received data even when rejecting', () => {
      const invoice = newInvoice();
      invoice.applyResult(result({ canceled: true }), PROCESSED_AT);
      expect(invoice.cnpj).toBe('12345678000190');
      expect(invoice.canceled).toBe(true);
    });
  });

  describe('terminal status', () => {
    it('ignores a second result after approval', () => {
      const invoice = newInvoice();
      invoice.applyResult(result(), PROCESSED_AT);

      const later = new Date('2026-10-28T11:00:00Z');
      const decision = invoice.applyResult(result({ canceled: true }), later);

      expect(decision).toBe('IGNORED');
      expect(invoice.status).toBe(InvoiceStatus.APROVADA);
      expect(invoice.approvedAt).toEqual(PROCESSED_AT);
      expect(invoice.canceled).toBe(false);
    });

    it('ignores a complete result after rejection', () => {
      const invoice = newInvoice();
      invoice.applyResult(result({ cnpj: null }), PROCESSED_AT);

      expect(invoice.applyResult(result(), new Date())).toBe('IGNORED');
      expect(invoice.status).toBe(InvoiceStatus.REJEITADA);
      expect(invoice.approvedAt).toBeNull();
    });
  });

  it('refuses a result for another access key', () => {
    const invoice = newInvoice();
    const other = AccessKey.create(generateAccessKey(11));
    expect(() => invoice.applyResult(result({ accessKey: other }), PROCESSED_AT)).toThrow(
      ResultForAnotherInvoiceError,
    );
    expect(invoice.status).toBe(InvoiceStatus.ANALISE);
  });
});
