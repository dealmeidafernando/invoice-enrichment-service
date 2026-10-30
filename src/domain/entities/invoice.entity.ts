import { ResultForAnotherInvoiceError } from '../errors/domain.error';
import { AccessKey } from '../value-objects/access-key';
import { Money } from '../value-objects/money';

/** Values kept verbatim from the business spec: they are part of the public contract. */
export enum InvoiceStatus {
  ANALISE = 'ANALISE',
  APROVADA = 'APROVADA',
  REJEITADA = 'REJEITADA',
}

export enum RejectionReason {
  INVOICE_CANCELED = 'INVOICE_CANCELED',
  MISSING_CNPJ = 'MISSING_CNPJ',
  MISSING_AMOUNT = 'MISSING_AMOUNT',
  MISSING_ISSUE_DATE = 'MISSING_ISSUE_DATE',
}

/** `null` means "not informed by the provider": it leads to a rejection, not to an error. */
export interface EnrichmentResult {
  readonly accessKey: AccessKey;
  readonly cnpj: string | null;
  readonly amount: Money | null;
  readonly issuedAt: Date | null;
  readonly canceled: boolean;
}

export type EnrichmentDecision = 'APPROVED' | 'REJECTED' | 'IGNORED';

export interface InvoiceProps {
  id: string;
  accessKey: AccessKey;
  status: InvoiceStatus;
  rejectionReasons: RejectionReason[];
  cnpj: string | null;
  amount: Money | null;
  issuedAt: Date | null;
  canceled: boolean | null;
  approvedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
}

export class Invoice {
  private constructor(private props: InvoiceProps) {}

  static create(params: { id: string; accessKey: AccessKey; now: Date }): Invoice {
    return new Invoice({
      id: params.id,
      accessKey: params.accessKey,
      status: InvoiceStatus.ANALISE,
      rejectionReasons: [],
      cnpj: null,
      amount: null,
      issuedAt: null,
      canceled: null,
      approvedAt: null,
      processedAt: null,
      createdAt: params.now,
    });
  }

  static restore(props: InvoiceProps): Invoice {
    return new Invoice({ ...props, rejectionReasons: [...props.rejectionReasons] });
  }

  applyResult(result: EnrichmentResult, now: Date): EnrichmentDecision {
    if (!result.accessKey.equals(this.props.accessKey)) {
      throw new ResultForAnotherInvoiceError(
        `Result for access key ${result.accessKey.value} applied to invoice ${this.props.id}.`,
      );
    }
    if (this.props.status !== InvoiceStatus.ANALISE) {
      return 'IGNORED';
    }

    const reasons = Invoice.rejectionReasonsFor(result);
    // Received data is kept even on rejection, for auditing.
    this.props.cnpj = result.cnpj;
    this.props.amount = result.amount;
    this.props.issuedAt = result.issuedAt;
    this.props.canceled = result.canceled;
    this.props.processedAt = now;

    if (reasons.length > 0) {
      this.props.status = InvoiceStatus.REJEITADA;
      this.props.rejectionReasons = reasons;
      return 'REJECTED';
    }
    this.props.status = InvoiceStatus.APROVADA;
    this.props.approvedAt = now;
    return 'APPROVED';
  }

  private static rejectionReasonsFor(result: EnrichmentResult): RejectionReason[] {
    const reasons: RejectionReason[] = [];
    if (result.canceled) reasons.push(RejectionReason.INVOICE_CANCELED);
    if (!result.cnpj) reasons.push(RejectionReason.MISSING_CNPJ);
    if (!result.amount) reasons.push(RejectionReason.MISSING_AMOUNT);
    if (!result.issuedAt) reasons.push(RejectionReason.MISSING_ISSUE_DATE);
    return reasons;
  }

  get id(): string {
    return this.props.id;
  }
  get accessKey(): AccessKey {
    return this.props.accessKey;
  }
  get status(): InvoiceStatus {
    return this.props.status;
  }
  get rejectionReasons(): readonly RejectionReason[] {
    return this.props.rejectionReasons;
  }
  get cnpj(): string | null {
    return this.props.cnpj;
  }
  get amount(): Money | null {
    return this.props.amount;
  }
  get issuedAt(): Date | null {
    return this.props.issuedAt;
  }
  get canceled(): boolean | null {
    return this.props.canceled;
  }
  get approvedAt(): Date | null {
    return this.props.approvedAt;
  }
  get processedAt(): Date | null {
    return this.props.processedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
