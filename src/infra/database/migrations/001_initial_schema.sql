-- Invoices ---------------------------------------------------------------------
CREATE TABLE invoices (
  id                 uuid        PRIMARY KEY,
  access_key         char(44)    NOT NULL,
  status             text        NOT NULL,
  rejection_reasons  text[]      NOT NULL DEFAULT '{}',
  cnpj               varchar(14),
  amount             numeric(15, 2),
  issued_at          timestamptz,
  canceled           boolean,
  approved_at        timestamptz,
  processed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- The same access key can never create two invoices. The database enforces it, even under concurrency.
  CONSTRAINT uq_invoices_access_key UNIQUE (access_key),
  -- Status values come from the business spec and are kept verbatim.
  CONSTRAINT ck_invoices_status CHECK (status IN ('ANALISE', 'APROVADA', 'REJEITADA')),
  -- Domain invariants repeated in the schema as a last line of defense.
  CONSTRAINT ck_invoices_approval CHECK ((status = 'APROVADA') = (approved_at IS NOT NULL)),
  CONSTRAINT ck_invoices_rejection_reason CHECK ((status = 'REJEITADA') = (cardinality(rejection_reasons) > 0))
);

-- Outbox: messages to publish, written in the same transaction as the invoice ------
CREATE TABLE outbox (
  id            uuid        PRIMARY KEY,            -- = envelope messageId
  topic         text        NOT NULL,
  envelope      jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'PENDING',
  attempts      integer     NOT NULL DEFAULT 0,
  last_error    text,
  available_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'PUBLISHED'))
);
CREATE INDEX ix_outbox_pending ON outbox (available_at) WHERE status = 'PENDING';

-- Queue: simulates the external broker (a managed one is out of scope) ------------
-- Each row is a DELIVERY. The same message (message_id) may appear in more than one
-- row, as it does in an at-least-once broker.
CREATE TABLE queue_messages (
  delivery_id   bigserial   PRIMARY KEY,
  message_id    uuid        NOT NULL,
  topic         text        NOT NULL,
  envelope      jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'READY',
  attempts      integer     NOT NULL DEFAULT 0,
  available_at  timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz,
  CONSTRAINT ck_queue_messages_status CHECK (status IN ('READY', 'PROCESSING', 'DONE', 'DEAD'))
);
CREATE INDEX ix_queue_messages_consume ON queue_messages (topic, delivery_id)
  WHERE status IN ('READY', 'PROCESSING');

-- Inbox: messages already processed, per consumer (idempotency) -----------------
CREATE TABLE processed_messages (
  consumer      text        NOT NULL,
  message_id    uuid        NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);
