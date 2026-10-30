import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Pool } from 'pg';
import { GetInvoiceUseCase } from '../application/use-cases/get-invoice.use-case';
import { ProcessEnrichmentResultUseCase } from '../application/use-cases/process-enrichment-result.use-case';
import { RegisterInvoiceUseCase } from '../application/use-cases/register-invoice.use-case';
import { INBOX_REPOSITORY, INVOICE_REPOSITORY, OUTBOX_REPOSITORY, TRANSACTION_MANAGER } from '../domain';
import { Database, PG_POOL } from '../infra/database/database';
import { DomainErrorFilter } from '../infra/http/domain-error.filter';
import { HealthController } from '../infra/http/health.controller';
import { InvoicesController } from '../infra/http/invoices.controller';
import { EnrichmentCompletedConsumer } from '../infra/messaging/enrichment-completed.consumer';
import { FakeProvider } from '../infra/messaging/fake-provider';
import { OutboxRelay } from '../infra/messaging/outbox-relay';
import { TableQueue } from '../infra/messaging/table-queue';
import { WorkersService } from '../infra/messaging/workers.service';
import { PgInvoiceRepository } from '../infra/repositories/pg-invoice.repository';
import { PgInboxRepository, PgOutboxRepository } from '../infra/repositories/pg-message.repository';
import { ENV, Env, loadEnv } from '../shared/config/env';

/** Composition root: the only place that binds domain interfaces to infra implementations. */
@Module({
  controllers: [InvoicesController, HealthController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 10 }),
    },
    Database,

    { provide: TRANSACTION_MANAGER, useExisting: Database },
    { provide: INVOICE_REPOSITORY, useClass: PgInvoiceRepository },
    { provide: OUTBOX_REPOSITORY, useClass: PgOutboxRepository },
    { provide: INBOX_REPOSITORY, useClass: PgInboxRepository },

    RegisterInvoiceUseCase,
    ProcessEnrichmentResultUseCase,
    GetInvoiceUseCase,

    TableQueue,
    OutboxRelay,
    EnrichmentCompletedConsumer,
    FakeProvider,
    WorkersService,

    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
