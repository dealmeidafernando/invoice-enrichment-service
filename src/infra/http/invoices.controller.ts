import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { GetInvoiceUseCase } from '../../application/use-cases/get-invoice.use-case';
import { RegisterInvoiceUseCase } from '../../application/use-cases/register-invoice.use-case';
import { InvoicePresenter, InvoiceResponse } from './presenters/invoice.presenter';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly registerInvoice: RegisterInvoiceUseCase,
    private readonly getInvoice: GetInvoiceUseCase,
  ) {}

  /**
   * 202: the invoice was stored in ANALISE; enrichment continues asynchronously.
   * 200: the access key already existed; same invoice, no new message (idempotent).
   * 400: invalid access key.
   */
  @Post()
  async create(
    @Body() body: { accessKey?: unknown } | undefined,
    @Headers('x-correlation-id') correlationIdHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceResponse> {
    const correlationId = correlationIdHeader || randomUUID();
    const { invoice, created } = await this.registerInvoice.execute({
      accessKey: body?.accessKey,
      correlationId,
    });
    res.status(created ? HttpStatus.ACCEPTED : HttpStatus.OK);
    res.setHeader('Location', `/invoices/${invoice.id}`);
    res.setHeader('x-correlation-id', correlationId);
    return InvoicePresenter.toHttp(invoice);
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<InvoiceResponse> {
    const invoice = await this.getInvoice.execute(id);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found.`);
    return InvoicePresenter.toHttp(invoice);
  }
}
