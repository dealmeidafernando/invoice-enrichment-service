export const OUTBOX_REPOSITORY = Symbol('OutboxRepository');
export const INBOX_REPOSITORY = Symbol('InboxRepository');
export const TRANSACTION_MANAGER = Symbol('TransactionManager');

export interface OutboxMessage {
  messageId: string;
  topic: string;
  body: unknown;
}

/** Must run in the same transaction as the state change the message announces. */
export interface OutboxRepository {
  add(message: OutboxMessage): Promise<void>;
}

/** Must run in the same transaction as the state change, so a failure lets the redelivery through. */
export interface InboxRepository {
  registerIfNew(consumer: string, messageId: string): Promise<boolean>;
}

/** Repositories called inside `work` join the transaction; a throw rolls everything back. */
export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
}
