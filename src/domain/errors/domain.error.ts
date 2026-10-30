export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidAccessKeyError extends DomainError {
  readonly code = 'INVALID_ACCESS_KEY';
}

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

export class ResultForAnotherInvoiceError extends DomainError {
  readonly code = 'RESULT_FOR_ANOTHER_INVOICE';
}
