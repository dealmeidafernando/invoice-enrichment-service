import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { TOPIC_ENRICHMENT_COMPLETED, TOPIC_ENRICHMENT_REQUESTED } from '../../application/contracts/messages';
import { ENV, Env } from '../../shared/config/env';
import { EnrichmentCompletedConsumer } from './enrichment-completed.consumer';
import { FakeProvider } from './fake-provider';
import { OutboxRelay } from './outbox-relay';
import { TableQueue } from './table-queue';

/** The next run is scheduled only after the current one ends, so a loop never overlaps itself. */
@Injectable()
export class WorkersService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkersService.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<void>>();
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly relay: OutboxRelay,
    private readonly queue: TableQueue,
    private readonly consumer: EnrichmentCompletedConsumer,
    private readonly provider: FakeProvider,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WORKERS_ENABLED) return;
    this.running = true;
    const options = { maxAttempts: this.env.QUEUE_MAX_ATTEMPTS, backoffBaseMs: this.env.BACKOFF_BASE_MS };

    this.loop('outbox-relay', () => this.relay.publishPending(50, this.env.BACKOFF_BASE_MS));
    this.loop('enrichment-consumer', () =>
      this.queue.consumeBatch(TOPIC_ENRICHMENT_COMPLETED, (d) => this.consumer.handle(d), options),
    );
    if (this.env.SIMULATE_PROVIDER) {
      this.loop('fake-provider', () =>
        this.queue.consumeBatch(TOPIC_ENRICHMENT_REQUESTED, (d) => this.provider.handle(d), options),
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    this.timers.forEach(clearTimeout);
    await Promise.all(this.inFlight);
  }

  private loop(name: string, task: () => Promise<unknown>, delayMs = 0): void {
    if (!this.running) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = task()
        .then(() => undefined)
        .catch((error) => this.logger.error(`${name} failed: ${(error as Error)?.message}`))
        .finally(() => {
          this.inFlight.delete(run);
          this.loop(name, task, this.env.POLL_INTERVAL_MS);
        });
      this.inFlight.add(run);
    }, delayMs);
    this.timers.add(timer);
  }
}
