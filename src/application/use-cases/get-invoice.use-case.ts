import { Inject, Injectable } from '@nestjs/common';
import { Invoice, INVOICE_REPOSITORY, InvoiceRepository } from '../../domain';

@Injectable()
export class GetInvoiceUseCase {
  constructor(@Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository) {}

  execute(id: string): Promise<Invoice | null> {
    return this.invoices.findById(id);
  }
}
