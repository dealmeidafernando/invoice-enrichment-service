import { InvalidMoneyError } from '../errors/domain.error';

/** Amount in BRL stored as integer cents (bigint). Never float: 0.1 + 0.2 !== 0.3. */
export class Money {
  private constructor(readonly cents: bigint) {}

  /** Accepts "1520.75", "1520.7" or "1520". Rejects negatives, commas and more than 2 decimals. */
  static fromDecimal(text: string): Money {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) {
      throw new InvalidMoneyError(`Invalid amount: "${text}". Use the format 1234.56.`);
    }
    const [, integer, fraction = ''] = match;
    return new Money(BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0')));
  }

  toDecimal(): string {
    const units = this.cents / 100n;
    const rest = (this.cents % 100n).toString().padStart(2, '0');
    return `${units}.${rest}`;
  }
}
