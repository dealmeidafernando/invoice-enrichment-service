import { Injectable } from '@nestjs/common';
import { InboxRepository, OutboxMessage, OutboxRepository } from '../../domain';
import { Database } from '../database/database';

@Injectable()
export class PgOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Database) {}

  async add(message: OutboxMessage): Promise<void> {
    // Outside a transaction the outbox is pointless: the invoice could be stored without its message.
    this.db.assertInTransaction('OutboxRepository.add');
    await this.db.query(`INSERT INTO outbox (id, topic, envelope) VALUES ($1, $2, $3)`, [
      message.messageId,
      message.topic,
      JSON.stringify(message.body),
    ]);
  }
}

@Injectable()
export class PgInboxRepository implements InboxRepository {
  constructor(private readonly db: Database) {}

  async registerIfNew(consumer: string, messageId: string): Promise<boolean> {
    // Shares the transaction with the state change: if the change fails, the record is
    // rolled back too and the redelivery is processed again.
    this.db.assertInTransaction('InboxRepository.registerIfNew');
    const { rowCount } = await this.db.query(
      `INSERT INTO processed_messages (consumer, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [consumer, messageId],
    );
    return rowCount === 1;
  }
}
