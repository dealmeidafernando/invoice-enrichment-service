import { Invoice, InvoiceStatus, RejectionReason } from '../../../domain';

export interface InvoiceResponse {
  id: string;
  accessKey: string;
  status: InvoiceStatus;
  rejectionReasons: RejectionReason[];
  cnpj: string | null;
  amount: string | null;
  issuedAt: string | null;
  canceled: boolean | null;
  approvedAt: string | null;
  createdAt: string;
}

export class InvoicePresenter {
  static toHttp(invoice: Invoice): InvoiceResponse {
    return {
      id: invoice.id,
      accessKey: invoice.accessKey.value,
      status: invoice.status,
      rejectionReasons: [...invoice.rejectionReasons],
      cnpj: invoice.cnpj,
      amount: invoice.amount?.toDecimal() ?? null,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      canceled: invoice.canceled,
      approvedAt: invoice.approvedAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
