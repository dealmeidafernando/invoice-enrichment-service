export const OUTBOX_REPOSITORY = Symbol('OutboxRepository');
export const INBOX_REPOSITORY = Symbol('InboxRepository');
export const TRANSACTION_MANAGER = Symbol('TransactionManager');

export interface OutboxMessage {
  messageId: string;
  topic: string;
  body: unknown;
}

/**
 * Transactional Outbox: the message is stored in the same transaction as the state change
 * and published afterwards by a relay. Must run inside a transaction.
 */
export interface OutboxRepository {
  add(message: OutboxMessage): Promise<void>;
}

/** Messages already processed per consumer (idempotency). Must run inside a transaction. */
export interface InboxRepository {
  /** true if the message is new and was recorded now; false if it was processed before. */
  registerIfNew(consumer: string, messageId: string): Promise<boolean>;
}

/** Runs `work` in one transaction. Repositories called inside join it; a throw rolls everything back. */
export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
}
